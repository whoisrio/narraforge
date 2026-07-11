"""Async SQLite-backed LangGraph Store with FTS5 full-text search.

Provides AsyncSqliteStore, a custom Store implementation backed by
aiosqlite with FTS5 for text search.  Used by the workflow engine to
persist graph state, checkpoint data, and other key-value artifacts.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from collections.abc import Iterable
from datetime import datetime, timezone
from typing import Any

import aiosqlite
from langgraph.store.base import (
    BaseStore,
    GetOp,
    Item,
    ListNamespacesOp,
    Op,
    PutOp,
    Result,
    SearchItem,
    SearchOp,
)

logger = logging.getLogger(__name__)


def _ns_to_text(namespace: tuple[str, ...]) -> str:
    """Convert a namespace tuple to a dot-separated string."""
    return ".".join(namespace)


def _text_to_ns(text: str) -> tuple[str, ...]:
    """Convert a dot-separated string back to a namespace tuple."""
    return tuple(text.split("."))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class AsyncSqliteStore(BaseStore):
    """Async SQLite-backed LangGraph Store using FTS5 for full-text search.

    Provides ``aput``, ``aget``, ``asearch``, ``adelete`` convenience
    methods and fulfils the ``batch`` / ``abatch`` contract from
    ``langgraph.store.base.BaseStore``.

    Usage::

        store = create_workflow_store("workflow.db")
        await store.setup()

        await store.aput(("users", "123"), "prefs", {"theme": "dark"})
        item = await store.aget(("users", "123"), "prefs")
        results = await store.asearch(("users",), query="theme")
    """

    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self._conn: aiosqlite.Connection | None = None
        self._setup_done = False
        self._lock = asyncio.Lock()

    # -- connection management ------------------------------------------------

    async def _ensure_conn(self) -> aiosqlite.Connection:
        """Ensure the database connection and schema are ready.

        Combines connection creation and setup into a single lock-guarded
        call so there is no risk of deadlock between ``_get_conn`` and
        ``setup``.
        """
        if self._setup_done and self._conn is not None:
            return self._conn
        async with self._lock:
            if self._conn is None:
                self._conn = await aiosqlite.connect(self.db_path)
                await self._conn.execute("PRAGMA journal_mode=WAL")
            if not self._setup_done:
                await self._create_tables(self._conn)
                self._setup_done = True
        return self._conn

    async def setup(self) -> None:
        """Create tables and FTS5 virtual table if they do not exist.

        Safe to call multiple times; subsequent calls are no-ops.
        """
        await self._ensure_conn()

    @staticmethod
    async def _create_tables(conn: aiosqlite.Connection) -> None:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS store (
                prefix     TEXT    NOT NULL,
                key        TEXT    NOT NULL,
                value      TEXT    NOT NULL,
                created_at TEXT    NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (prefix, key)
            )
            """
        )
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_store_prefix ON store (prefix)"
        )
        await conn.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS store_fts
            USING fts5(prefix, key, value)
            """
        )
        await conn.commit()

    # -- BaseStore contract ---------------------------------------------------

    def batch(self, ops: Iterable[Op]) -> list[Result]:
        """Synchronous batch -- not supported.

        Use the async methods (``aput``, ``aget``, ``asearch``, ``adelete``)
        or ``abatch`` instead.
        """
        raise NotImplementedError(
            "AsyncSqliteStore does not support synchronous batch(). "
            "Use aput/aget/asearch/adelete or abatch instead."
        )

    async def abatch(self, ops: Iterable[Op]) -> list[Result]:
        """Execute a batch of store operations inside a single transaction."""
        conn = await self._ensure_conn()

        grouped: dict[type, list[tuple[int, Op]]] = defaultdict(list)
        total = 0
        for idx, op in enumerate(ops):
            grouped[type(op)].append((idx, op))
            total += 1

        results: list[Result] = [None] * total

        async with conn.cursor() as cur:
            await cur.execute("BEGIN")
            try:
                # Order matters: writes before reads so that gets/searches
                # within the same batch can see data written by puts.
                if PutOp in grouped:
                    await self._handle_puts(cur, grouped[PutOp])
                if GetOp in grouped:
                    await self._handle_gets(cur, grouped[GetOp], results)
                if SearchOp in grouped:
                    await self._handle_searches(cur, grouped[SearchOp], results)
                if ListNamespacesOp in grouped:
                    await self._handle_list_ns(
                        cur, grouped[ListNamespacesOp], results
                    )
                await cur.execute("COMMIT")
            except Exception:
                await cur.execute("ROLLBACK")
                raise

        return results

    # -- convenience async methods --------------------------------------------

    async def aput(
        self,
        namespace: tuple[str, ...],
        key: str,
        value: dict[str, Any] | None,
    ) -> None:
        """Store, update, or delete a single item.

        Pass ``value=None`` to delete the item.
        """
        await self.abatch([PutOp(namespace, key, value)])

    async def aget(
        self,
        namespace: tuple[str, ...],
        key: str,
    ) -> Item | None:
        """Retrieve a single item by namespace and key."""
        results = await self.abatch([GetOp(namespace, key)])
        return results[0]

    async def asearch(
        self,
        namespace_prefix: tuple[str, ...],
        *,
        query: str | None = None,
        limit: int = 10,
        offset: int = 0,
    ) -> list[SearchItem]:
        """Search for items within a namespace prefix.

        When *query* is provided, FTS5 full-text search is used.
        Otherwise returns items matching the prefix, newest first.
        """
        results = await self.abatch(
            [SearchOp(namespace_prefix, None, limit, offset, query)]
        )
        return results[0]

    async def adelete(
        self,
        namespace: tuple[str, ...],
        key: str,
    ) -> None:
        """Delete a single item."""
        await self.abatch([PutOp(namespace, key, None)])

    # -- operation handlers ---------------------------------------------------

    async def _handle_gets(
        self,
        cur: aiosqlite.Cursor,
        get_ops: list[tuple[int, GetOp]],
        results: list[Result],
    ) -> None:
        ns_keys: dict[str, list[tuple[int, str]]] = defaultdict(list)
        for idx, op in get_ops:
            ns_keys[_ns_to_text(op.namespace)].append((idx, op.key))

        for prefix, items in ns_keys.items():
            keys = [k for _, k in items]
            placeholders = ",".join("?" for _ in keys)
            await cur.execute(
                f"SELECT key, value, created_at, updated_at "
                f"FROM store WHERE prefix = ? AND key IN ({placeholders})",
                (prefix, *keys),
            )
            rows = await cur.fetchall()
            row_map = {row[0]: row for row in rows}
            for idx, key in items:
                row = row_map.get(key)
                if row:
                    results[idx] = Item(
                        key=row[0],
                        value=json.loads(row[1]),
                        namespace=_text_to_ns(prefix),
                        created_at=_parse_dt(row[2]),
                        updated_at=_parse_dt(row[3]),
                    )

    async def _handle_puts(
        self,
        cur: aiosqlite.Cursor,
        put_ops: list[tuple[int, PutOp]],
    ) -> None:
        # De-duplicate: last write wins per (namespace, key).
        dedup: dict[tuple[tuple[str, ...], str], PutOp] = {}
        for _, op in put_ops:
            dedup[(op.namespace, op.key)] = op

        for (ns_tuple, key), op in dedup.items():
            prefix = _ns_to_text(ns_tuple)
            now = _now_iso()
            if op.value is None:
                await cur.execute(
                    "DELETE FROM store WHERE prefix = ? AND key = ?",
                    (prefix, key),
                )
                await _fts_delete(cur, prefix, key)
            else:
                value_json = json.dumps(op.value, ensure_ascii=False)
                await cur.execute(
                    """
                    INSERT INTO store (prefix, key, value, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(prefix, key) DO UPDATE SET
                        value = excluded.value,
                        updated_at = excluded.updated_at
                    """,
                    (prefix, key, value_json, now, now),
                )
                await _fts_upsert(cur, prefix, key, value_json)

    async def _handle_searches(
        self,
        cur: aiosqlite.Cursor,
        search_ops: list[tuple[int, SearchOp]],
        results: list[Result],
    ) -> None:
        for idx, op in search_ops:
            prefix = _ns_to_text(op.namespace_prefix)
            prefix_pattern = prefix + "%"
            ns_tuple = _text_to_ns(prefix)

            if op.query:
                fts_query = _sanitise_fts_query(op.query)
                try:
                    await cur.execute(
                        """
                        SELECT key, value FROM store_fts
                        WHERE store_fts MATCH ?
                          AND prefix LIKE ?
                        ORDER BY rank
                        LIMIT ? OFFSET ?
                        """,
                        (fts_query, prefix_pattern, op.limit, op.offset),
                    )
                    fts_rows = await cur.fetchall()
                except Exception:
                    logger.debug(
                        "FTS query failed, falling back to LIKE", exc_info=True
                    )
                    fts_rows = None

                if fts_rows is None:
                    await cur.execute(
                        """
                        SELECT key, value, created_at, updated_at
                        FROM store
                        WHERE prefix LIKE ? AND value LIKE ?
                        ORDER BY updated_at DESC
                        LIMIT ? OFFSET ?
                        """,
                        (prefix_pattern, f"%{op.query}%", op.limit, op.offset),
                    )
                    rows = await cur.fetchall()
                else:
                    rows = await _enrich_fts_rows(cur, prefix, fts_rows)
            else:
                await cur.execute(
                    """
                    SELECT key, value, created_at, updated_at
                    FROM store
                    WHERE prefix LIKE ?
                    ORDER BY updated_at DESC
                    LIMIT ? OFFSET ?
                    """,
                    (prefix_pattern, op.limit, op.offset),
                )
                rows = await cur.fetchall()

            items: list[SearchItem] = []
            for row in rows:
                items.append(
                    SearchItem(
                        key=row[0],
                        value=json.loads(row[1]),
                        namespace=ns_tuple,
                        created_at=_parse_dt(row[2]),
                        updated_at=_parse_dt(row[3]),
                        score=None,
                    )
                )
            results[idx] = items

    async def _handle_list_ns(
        self,
        cur: aiosqlite.Cursor,
        list_ops: list[tuple[int, ListNamespacesOp]],
        results: list[Result],
    ) -> None:
        for idx, op in list_ops:
            where_parts: list[str] = []
            params: list[Any] = []
            if op.match_conditions:
                for cond in op.match_conditions:
                    if cond.match_type == "prefix":
                        where_parts.append("prefix LIKE ?")
                        params.append(
                            _ns_to_text(cond.path).replace("*", "%") + "%"
                        )
                    elif cond.match_type == "suffix":
                        where_parts.append("prefix LIKE ?")
                        params.append(
                            "%" + _ns_to_text(cond.path).replace("*", "%")
                        )
            where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
            limit = op.limit or 100
            offset = op.offset or 0
            await cur.execute(
                f"SELECT DISTINCT prefix FROM store {where_sql} "
                f"ORDER BY prefix LIMIT ? OFFSET ?",
                (*params, limit, offset),
            )
            rows = await cur.fetchall()
            results[idx] = [_text_to_ns(row[0]) for row in rows]

    # -- lifecycle ------------------------------------------------------------

    async def close(self) -> None:
        """Close the underlying database connection."""
        if self._conn is not None:
            await self._conn.close()
            self._conn = None
            self._setup_done = False

    async def __aenter__(self) -> AsyncSqliteStore:
        await self.setup()
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.close()


# -- FTS5 helpers --------------------------------------------------------------

async def _fts_upsert(
    cur: aiosqlite.Cursor,
    prefix: str,
    key: str,
    value_json: str,
) -> None:
    """Delete-then-insert into FTS5 to avoid duplicate rows."""
    await cur.execute(
        "DELETE FROM store_fts WHERE prefix = ? AND key = ?",
        (prefix, key),
    )
    await cur.execute(
        "INSERT INTO store_fts (prefix, key, value) VALUES (?, ?, ?)",
        (prefix, key, value_json),
    )


async def _fts_delete(
    cur: aiosqlite.Cursor,
    prefix: str,
    key: str,
) -> None:
    await cur.execute(
        "DELETE FROM store_fts WHERE prefix = ? AND key = ?",
        (prefix, key),
    )


async def _enrich_fts_rows(
    cur: aiosqlite.Cursor,
    prefix: str,
    fts_rows: list[tuple[str, str]],
) -> list[tuple[str, str, str | None, str | None]]:
    """Look up timestamps for FTS-matched rows from the store table."""
    if not fts_rows:
        return []
    keys = [r[0] for r in fts_rows]
    value_map = {r[0]: r[1] for r in fts_rows}
    placeholders = ",".join("?" for _ in keys)
    await cur.execute(
        f"SELECT key, created_at, updated_at "
        f"FROM store WHERE prefix = ? AND key IN ({placeholders})",
        (prefix, *keys),
    )
    meta_rows = await cur.fetchall()
    meta_map = {r[0]: (r[1], r[2]) for r in meta_rows}
    enriched: list[tuple[str, str, str | None, str | None]] = []
    for key in keys:
        value = value_map[key]
        created, updated = meta_map.get(key, (None, None))
        enriched.append((key, value, created, updated))
    return enriched


# -- general helpers -----------------------------------------------------------

def _parse_dt(raw: str | None) -> datetime:
    """Parse an ISO-8601 timestamp string, falling back to utcnow."""
    if raw:
        try:
            return datetime.fromisoformat(raw)
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def _sanitise_fts_query(query: str) -> str:
    """Escape special FTS5 operators so the user's text is treated literally."""
    tokens = query.strip().split()
    return " ".join(f'"{t}"' for t in tokens if t)


# -- public factory -----------------------------------------------------------

def create_workflow_store(db_path: str) -> AsyncSqliteStore:
    """Create an AsyncSqliteStore instance for the workflow engine.

    Args:
        db_path: Path to the SQLite database file.  Use ``":memory:"``
            for an in-memory store (useful in tests).

    Returns:
        An ``AsyncSqliteStore`` ready for ``await store.setup()``.
    """
    return AsyncSqliteStore(db_path)
