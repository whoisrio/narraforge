"""Role 仓储（步骤 3A）。

方法签名提取自 role_service + roles.py 路由的实际调用（YAGNI）。
Local 薄封装 role_service（含删除前 segments/project 引用清理的 SQL）；
Supabase 走 PostgREST —— 注意：segments 引用清理依赖 segmented 三大表，
3B 迁移后需要在 Supabase 实现里补齐（当前 workers 模式下删除角色只删行）。
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable

from sqlalchemy.orm import Session

from app.core.supabase_client import SupabaseClient, SupabaseError
from app.core.time_utils import utcnow
from app.schemas.role import RoleIn, RoleOut, RoleUpdate
from app.services import role_service as svc

TABLE = "roles"


@runtime_checkable
class RoleRepository(Protocol):
    def list(self, project_id: str | None = None) -> list[RoleOut]: ...
    def create(self, payload: RoleIn) -> RoleOut: ...  # ValueError("role_already_exists")
    def update(self, role_id: str, payload: RoleUpdate) -> RoleOut | None: ...
    def delete(self, role_id: str) -> bool: ...


def _row_to_out(row: dict) -> RoleOut:
    return RoleOut(
        id=row["id"],
        name=row["name"],
        avatar=row.get("avatar"),
        description=row.get("description"),
        role_kind=row.get("role_kind") or "cast",
        project_id=row.get("project_id"),
        voice=row.get("voice") or {"engine": "edge_tts", "params": {}},
        favorite_styles=row.get("favorite_styles") or [],
        created_at=row.get("created_at") or "",
        updated_at=row.get("updated_at") or "",
    )


class LocalRoleRepository:
    """薄封装 role_service；事务（commit/rollback/refresh）从路由搬进这里。"""

    def __init__(self, db: Session):
        self._db = db

    def list(self, project_id: str | None = None) -> list[RoleOut]:
        return svc.list_roles(self._db, project_id=project_id)

    def create(self, payload: RoleIn) -> RoleOut:
        # svc.create_role 的 ValueError 在任何 flush 之前抛出，无需 rollback
        # （在共享外层事务的测试夹具里，rollback 会误伤已提交的数据）。
        role = svc.create_role(self._db, payload)
        try:
            self._db.commit()
        except Exception:
            self._db.rollback()
            raise
        return svc.role_to_out(role)

    def update(self, role_id: str, payload: RoleUpdate) -> RoleOut | None:
        role = svc.update_role(self._db, role_id, payload)
        if role is None:
            return None
        self._db.commit()
        self._db.refresh(role)
        return svc.role_to_out(role)

    def delete(self, role_id: str) -> bool:
        if not svc.delete_role(self._db, role_id):
            return False
        self._db.commit()
        return True


class SupabaseRoleRepository:
    """PostgREST 实现。删除不复制 segments 引用清理（3B 迁移 segmented 表后补齐）。"""

    def __init__(self, client: SupabaseClient):
        self._client = client

    def list(self, project_id: str | None = None) -> list[RoleOut]:
        if project_id:
            params = {"or": f"(project_id.is.null,project_id.eq.{project_id})"}
        else:
            params = {"project_id": "is.null"}
        params["order"] = "updated_at.desc"
        return [_row_to_out(row) for row in self._client.select(TABLE, params=params)]

    def create(self, payload: RoleIn) -> RoleOut:
        if self._client.select_one(TABLE, params={"id": f"eq.{payload.id}", "select": "id"}):
            raise ValueError("role_already_exists")
        # "__scratchpad__" 是前端占位符，非真实项目行，归一化为 NULL（对齐 local）
        project_id = payload.project_id if payload.project_id != "__scratchpad__" else None
        row = {
            "id": payload.id,
            "name": payload.name,
            "avatar": payload.avatar,
            "description": payload.description,
            "role_kind": payload.role_kind,
            "project_id": project_id,
            "voice": payload.voice,
            "favorite_styles": payload.favorite_styles,
        }
        try:
            inserted = self._client.insert(TABLE, [row])
        except SupabaseError as exc:
            if exc.status_code == 409:
                raise ValueError("role_already_exists") from exc
            raise
        return _row_to_out(inserted[0])

    def update(self, role_id: str, payload: RoleUpdate) -> RoleOut | None:
        values = payload.model_dump(exclude_unset=True)
        values["updated_at"] = utcnow().isoformat()  # 对齐 local 的 onupdate 语义
        rows = self._client.update(TABLE, values, params={"id": f"eq.{role_id}"})
        if not rows:
            return None
        return _row_to_out(rows[0])

    def delete(self, role_id: str) -> bool:
        return bool(self._client.delete(TABLE, params={"id": f"eq.{role_id}"}))
