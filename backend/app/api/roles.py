from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.role import RoleIn, RoleOut, RoleUpdate
from app.services import role_service as svc

router = APIRouter()


@router.get("/roles", response_model=list[RoleOut])
def list_roles(
    project_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> list[RoleOut]:
    return svc.list_roles(db, project_id=project_id)


@router.post("/roles", response_model=RoleOut, status_code=201)
def create_role(payload: RoleIn, db: Session = Depends(get_db)) -> RoleOut:
    try:
        role = svc.create_role(db, payload)
        db.commit()
    except ValueError as exc:
        db.rollback()
        if str(exc) == "role_already_exists":
            raise HTTPException(status_code=409, detail="role_already_exists") from exc
        raise
    return svc.role_to_out(role)


@router.put("/roles/{role_id}", response_model=RoleOut)
def update_role(role_id: str, payload: RoleUpdate, db: Session = Depends(get_db)) -> RoleOut:
    role = svc.update_role(db, role_id, payload)
    if role is None:
        raise HTTPException(status_code=404, detail="role_not_found")
    db.commit()
    db.refresh(role)
    return svc.role_to_out(role)


@router.delete("/roles/{role_id}", status_code=204)
def delete_role(role_id: str, db: Session = Depends(get_db)) -> None:
    if not svc.delete_role(db, role_id):
        raise HTTPException(status_code=404, detail="role_not_found")
    db.commit()
    return None
