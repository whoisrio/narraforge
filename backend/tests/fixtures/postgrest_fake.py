"""测试夹具：内存版 PostgREST，供 workers 模式集成测试使用。

实现 PostgREST 语义的常用子集：
- GET：eq / neq / is.null 过滤、or=(...) 组合、order=x.desc、select
- POST：普通插入；Prefer 含 resolution=merge-duplicates 时按主键 upsert
- PATCH / DELETE：eq 过滤后更新/删除；均返回表示（return=representation）

只覆盖仓储层用到的语义，不是完整 PostgREST。
"""
from __future__ import annotations

import json
from urllib.parse import parse_qs

import httpx

from app.core.supabase_client import SupabaseClient

# 各表主键（upsert 冲突判定）
_PRIMARY_KEYS = {
    "voice_profiles": "id",
    "system_configs": "key",
    "roles": "id",
    "source_documents": "id",
}


class FakePostgrestStore:
    """tables: {table: [row, ...]}，测试可直接播种/断言。"""

    def __init__(self):
        self.tables: dict[str, list[dict]] = {t: [] for t in _PRIMARY_KEYS}

    # ---- 过滤 ----
    def _matches(self, row: dict, params: dict) -> bool:
        for key, raw in params.items():
            if key in ("order", "select", "or"):
                continue
            op, _, value = raw.partition(".")
            cell = row.get(key)
            if op == "eq" and str(cell) != value:
                return False
            if op == "neq" and str(cell) == value:
                return False
            if op == "is" and value == "null" and cell is not None:
                return False
        or_clause = params.get("or")
        if or_clause:
            # 形如 (project_id.is.null,project_id.eq.p1)
            inner = or_clause.strip().strip("()")
            for alt in inner.split(","):
                field, _, cond = alt.partition(".")
                op, _, value = cond.partition(".")
                cell = row.get(field)
                if op == "is" and value == "null" and cell is None:
                    return True
                if op == "eq" and str(cell) == value:
                    return True
            return False
        return True

    def _sort(self, rows: list[dict], order: str | None) -> list[dict]:
        if not order:
            return rows
        field, _, direction = order.partition(".")
        return sorted(
            rows,
            key=lambda r: (r.get(field) is not None, r.get(field)),
            reverse=direction == "desc",
        )

    def handle(self, request: httpx.Request) -> httpx.Response:
        table = request.url.path.rsplit("/", 1)[-1]
        params = dict(request.url.params)
        rows = self.tables.setdefault(table, [])
        prefer = request.headers.get("Prefer", "")

        if request.method == "GET":
            matched = self._sort([r for r in rows if self._matches(r, params)], params.get("order"))
            return httpx.Response(200, json=matched)

        if request.method == "POST":
            body = json.loads(request.content)
            if "merge-duplicates" in prefer:
                pk = _PRIMARY_KEYS[table]
                for new_row in body:
                    for i, row in enumerate(rows):
                        if row.get(pk) == new_row.get(pk):
                            rows[i] = {**row, **new_row}
                            break
                    else:
                        rows.append(dict(new_row))
            else:
                rows.extend(dict(r) for r in body)
            return httpx.Response(201, json=body)

        if request.method == "PATCH":
            values = json.loads(request.content)
            updated = []
            for row in rows:
                if self._matches(row, params):
                    row.update(values)
                    updated.append(dict(row))
            return httpx.Response(200, json=updated)

        if request.method == "DELETE":
            deleted = [r for r in rows if self._matches(r, params)]
            self.tables[table] = [r for r in rows if not self._matches(r, params)]
            return httpx.Response(200, json=deleted)

        return httpx.Response(405, json={"message": "method not allowed"})


def make_fake_supabase_client() -> tuple[SupabaseClient, FakePostgrestStore]:
    store = FakePostgrestStore()
    client = SupabaseClient(
        "https://fake.supabase.co",
        "service-key",
        transport=httpx.MockTransport(store.handle),
    )
    return client, store
