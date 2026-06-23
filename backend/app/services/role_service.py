from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

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
        default_engine=role.default_engine,
        default_voice=role.default_voice,
        default_engine_params=role.default_engine_params or {},
        favorite_styles=role.favorite_styles or [],
        created_at=_to_iso(role.created_at),
        updated_at=_to_iso(role.updated_at),
    )


def list_roles(db: Session) -> list[RoleOut]:
    roles = db.query(Role).order_by(Role.updated_at.desc()).all()
    return [role_to_out(role) for role in roles]


def get_role(db: Session, role_id: str) -> Role | None:
    return db.query(Role).filter_by(id=role_id).first()


def create_role(db: Session, payload: RoleIn) -> Role:
    if get_role(db, payload.id) is not None:
        raise ValueError("role_already_exists")
    role = Role(
        id=payload.id,
        name=payload.name,
        avatar=payload.avatar,
        description=payload.description,
        role_kind=payload.role_kind,
        default_engine=payload.default_engine,
        default_voice=payload.default_voice,
        default_engine_params=payload.default_engine_params,
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
    db.delete(role)
    db.flush()
    return True
