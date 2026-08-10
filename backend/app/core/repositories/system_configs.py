"""SystemConfig 键值仓储（步骤 3A）。

SystemConfigRepository 只有两个原语：get / set（upsert）。
所有高层语义（storage_mode、animation_root_folder、model_config.* 等）
都由调用方在这两个原语之上构建。
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable

from sqlalchemy.orm import Session

from app.core import system_config_service as svc
from app.core.supabase_client import SupabaseClient
from app.core.time_utils import utcnow

TABLE = "system_configs"


@runtime_checkable
class SystemConfigRepository(Protocol):
    def get(self, key: str, default: str = "") -> str: ...
    def set(self, key: str, value: str) -> None: ...


class LocalSystemConfigRepository:
    """薄封装现有 SQLAlchemy 代码；set 负责 commit（路由不再持有事务）。"""

    def __init__(self, db: Session):
        self._db = db

    def get(self, key: str, default: str = "") -> str:
        return svc.get_config(self._db, key, default)

    def set(self, key: str, value: str) -> None:
        svc.set_config(self._db, key, value)
        self._db.commit()


class SupabaseSystemConfigRepository:
    """PostgREST 实现：key=eq.x 过滤；set 走 upsert（merge-duplicates）。"""

    def __init__(self, client: SupabaseClient):
        self._client = client

    def get(self, key: str, default: str = "") -> str:
        row = self._client.select_one(
            TABLE, params={"key": f"eq.{key}", "select": "value"}
        )
        return row["value"] if row else default

    def set(self, key: str, value: str) -> None:
        self._client.insert(
            TABLE,
            [{"key": key, "value": value, "updated_at": utcnow().isoformat()}],
            upsert=True,
        )
