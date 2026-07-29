from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.core.time_utils import utcnow
from app.models.role import Role
from app.schemas.role import RoleIn, RoleOut, RoleUpdate


def _to_iso(value: datetime | None) -> str:
    if value is None:
        return ""
    if value.tzinfo is None:
        return value.isoformat()
    return value.astimezone(timezone.utc).isoformat()


def role_to_out(role: Role) -> RoleOut:
    return RoleOut(
        id=role.id,
        name=role.name,
        avatar=role.avatar,
        description=role.description,
        role_kind=role.role_kind,
        project_id=role.project_id,
        voice=role.voice or {"engine": "edge_tts", "params": {}},
        favorite_styles=role.favorite_styles or [],
        created_at=_to_iso(role.created_at),
        updated_at=_to_iso(role.updated_at),
    )


def list_roles(db: Session, project_id: str | None = None) -> list[RoleOut]:
    query = db.query(Role)
    if project_id:
        query = query.filter(or_(Role.project_id == None, Role.project_id == project_id))
    else:
        query = query.filter(Role.project_id == None)
    roles = query.order_by(Role.updated_at.desc()).all()
    return [role_to_out(role) for role in roles]


def get_role(db: Session, role_id: str) -> Role | None:
    return db.query(Role).filter_by(id=role_id).first()


def create_role(db: Session, payload: RoleIn) -> Role:
    if get_role(db, payload.id) is not None:
        raise ValueError("role_already_exists")
    # The frontend uses "__scratchpad__" as a placeholder project id when no real
    # project is open (e.g. the global role library). It is not a real DB row, so
    # normalize it to NULL (global role) - otherwise the enforced FK rejects the insert.
    project_id = payload.project_id if payload.project_id != "__scratchpad__" else None
    role = Role(
        id=payload.id,
        name=payload.name,
        avatar=payload.avatar,
        description=payload.description,
        role_kind=payload.role_kind,
        project_id=project_id,
        voice=payload.voice,
        favorite_styles=payload.favorite_styles,
    )
    db.add(role)
    db.flush()
    return role


def update_role(db: Session, role_id: str, payload: RoleUpdate) -> Role | None:
    role = get_role(db, role_id)
    if role is None:
        return None
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(role, key, value)
    role.updated_at = utcnow()
    db.flush()
    return role


def delete_role(db: Session, role_id: str) -> bool:
    role = get_role(db, role_id)
    if role is None:
        return False
    _clean_role_references(db, role_id)
    db.delete(role)
    db.flush()
    return True


def _clean_role_references(db: Session, role_id: str) -> None:
    """删除角色前显式清理悬挂引用。

    DB 层 ondelete=SET NULL 依赖 SQLite PRAGMA foreign_keys=ON（已在 engine
    connect 时开启），这里显式清理是跨数据库都成立的保障；
    voice JSON 里的 {"source": "role", "role_id": ...} 没有任何 FK 可管，
    必须重置回 chapter 跟随。
    """
    from app.models.segmented_project import (
        SegmentedProject,
        SegmentedProjectSegment,
    )

    db.query(SegmentedProjectSegment).filter(
        SegmentedProjectSegment.role_id == role_id
    ).update({"role_id": None}, synchronize_session=False)
    db.query(SegmentedProject).filter(
        SegmentedProject.default_narrator_role_id == role_id
    ).update({"default_narrator_role_id": None}, synchronize_session=False)

    for seg in db.query(SegmentedProjectSegment).all():
        voice = seg.voice
        if (
            isinstance(voice, dict)
            and voice.get("source") == "role"
            and voice.get("role_id") == role_id
        ):
            seg.voice = {"source": "chapter"}
