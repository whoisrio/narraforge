"""usage_events 仓储（Phase 3 用量计量：TTS 次数/字符、LLM token）。

- record_event 为 best-effort：任何失败只记 warning 不抛出——调用方是核心
  业务流程（合成/LLM 调用），计量不能拖垮主链路，与 stats_middleware 同约定。
- usage_for_project / usage_for_user 聚合：Local 用 SQL 聚合；Supabase 全量
  select + 内存聚合（规模假设同 admin_stats：单实例小团队量级）。
- 多用户隔离仅在 Supabase 实现（UserScope）：insert 写入 user_id，select 追加
  user_id=eq 过滤；Local 单租户忽略用户。
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Protocol, runtime_checkable

from app.core.supabase_client import SupabaseClient
from app.core.repositories.user_scope import UserScope

# workers bundle 不含 sqlalchemy / app.models：Local* 只在 local 模式实例化。
try:
    from sqlalchemy import case, func
    from sqlalchemy.orm import Session

    from app.models.usage_event import UsageEvent
except ImportError:  # workers bundle
    Session = Any  # type: ignore[assignment,misc]
    UsageEvent = None  # type: ignore[assignment,misc]

logger = logging.getLogger(__name__)

TABLE = "usage_events"


def _empty_bucket(project_id: str | None) -> dict:
    return {
        "project_id": project_id,
        "tts_count": 0,
        "chars": 0,
        "input_tokens": 0,
        "output_tokens": 0,
    }


@runtime_checkable
class UsageRepository(Protocol):
    def record_event(
        self,
        kind: str,
        chars: int = 0,
        input_tokens: int = 0,
        output_tokens: int = 0,
        project_id: str | None = None,
        estimated: bool = False,
    ) -> None: ...
    def usage_for_project(self, project_id: str) -> dict: ...
    def usage_for_user(self) -> list[dict]: ...


class LocalUsageRepository:
    """SQLAlchemy 实现（local 模式，单租户）。"""

    def __init__(self, db: Session):
        self._db = db

    def record_event(
        self,
        kind: str,
        chars: int = 0,
        input_tokens: int = 0,
        output_tokens: int = 0,
        project_id: str | None = None,
        estimated: bool = False,
    ) -> None:
        try:
            self._db.add(UsageEvent(
                id=str(uuid.uuid4()),
                project_id=project_id,
                kind=kind,
                chars=chars,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                estimated=estimated,
            ))
            self._db.commit()
        except Exception:  # noqa: BLE001 — best-effort，不拖垮主链路
            logger.warning("record usage event failed", exc_info=True)
            self._db.rollback()

    @staticmethod
    def _aggregate_query(query):
        return query.with_entities(
            UsageEvent.project_id,
            func.coalesce(func.sum(case((UsageEvent.kind == "tts", 1), else_=0)), 0),
            func.coalesce(func.sum(UsageEvent.chars), 0),
            func.coalesce(func.sum(UsageEvent.input_tokens), 0),
            func.coalesce(func.sum(UsageEvent.output_tokens), 0),
        )

    def usage_for_project(self, project_id: str) -> dict:
        row = (
            self._aggregate_query(
                self._db.query(UsageEvent).filter(UsageEvent.project_id == project_id)
            )
            .group_by(UsageEvent.project_id)
            .first()
        )
        if row is None:
            return _empty_bucket(project_id)
        return {
            "project_id": row[0],
            "tts_count": int(row[1]),
            "chars": int(row[2]),
            "input_tokens": int(row[3]),
            "output_tokens": int(row[4]),
        }

    def usage_for_user(self) -> list[dict]:
        # local 单租户：全部行按 project_id 分桶（含 NULL 桶）
        rows = (
            self._aggregate_query(self._db.query(UsageEvent))
            .group_by(UsageEvent.project_id)
            .all()
        )
        return [
            {
                "project_id": r[0],
                "tts_count": int(r[1]),
                "chars": int(r[2]),
                "input_tokens": int(r[3]),
                "output_tokens": int(r[4]),
            }
            for r in rows
        ]


class SupabaseUsageRepository(UserScope):
    """PostgREST 实现（workers 模式）。M4 用户归属作用域 + 内存聚合。"""

    def __init__(self, client: SupabaseClient, owner_id: str | None = None, see_all: bool = False):
        super().__init__(owner_id=owner_id, see_all=see_all)
        self._client = client

    def record_event(
        self,
        kind: str,
        chars: int = 0,
        input_tokens: int = 0,
        output_tokens: int = 0,
        project_id: str | None = None,
        estimated: bool = False,
    ) -> None:
        try:
            row = self._stamp_row({
                "id": str(uuid.uuid4()),
                "project_id": project_id,
                "kind": kind,
                "chars": chars,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "estimated": estimated,
            })
            self._client.insert(TABLE, [row])
        except Exception:  # noqa: BLE001 — best-effort，不拖垮主链路
            logger.warning("record usage event failed", exc_info=True)

    @staticmethod
    def _accumulate(bucket: dict, row: dict) -> None:
        if row.get("kind") == "tts":
            bucket["tts_count"] += 1
        bucket["chars"] += int(row.get("chars") or 0)
        bucket["input_tokens"] += int(row.get("input_tokens") or 0)
        bucket["output_tokens"] += int(row.get("output_tokens") or 0)

    def usage_for_project(self, project_id: str) -> dict:
        rows = self._client.select(
            TABLE, params=self._scope_params({"project_id": f"eq.{project_id}"})
        )
        bucket = _empty_bucket(project_id)
        for row in rows:
            self._accumulate(bucket, row)
        return bucket

    def usage_for_user(self) -> list[dict]:
        rows = self._client.select(TABLE, params=self._scope_params())
        buckets: dict[str | None, dict] = {}
        for row in rows:
            pid = row.get("project_id")
            bucket = buckets.setdefault(pid, _empty_bucket(pid))
            self._accumulate(bucket, row)
        return list(buckets.values())
