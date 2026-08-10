from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.repositories.deps import get_role_repo
from app.core.repositories.roles import RoleRepository
from app.schemas.common import ItemsOut
from app.schemas.role import RoleIn, RoleOut, RoleUpdate

router = APIRouter()


@router.get("/roles", response_model=ItemsOut[RoleOut])
async def list_roles(
    project_id: Optional[str] = Query(None),
    repo: RoleRepository = Depends(get_role_repo),
) -> dict:
    # async：Pyodide 不支持线程，sync def 端点在 workers 运行时经 anyio.to_thread 失败。
    # （步骤 5 已统一 async 化全部 workers 可达端点，静态扫描测试
    #  tests/unit/test_workers_async_deps.py 锁死回归。）
    return {"items": repo.list(project_id=project_id)}


@router.post("/roles", response_model=RoleOut, status_code=201)
async def create_role(payload: RoleIn, repo: RoleRepository = Depends(get_role_repo)) -> RoleOut:
    try:
        return repo.create(payload)
    except ValueError as exc:
        if str(exc) == "role_already_exists":
            raise HTTPException(status_code=409, detail="role_already_exists") from exc
        raise


@router.put("/roles/{role_id}", response_model=RoleOut)
async def update_role(
    role_id: str,
    payload: RoleUpdate,
    repo: RoleRepository = Depends(get_role_repo),
) -> RoleOut:
    role = repo.update(role_id, payload)
    if role is None:
        raise HTTPException(status_code=404, detail="role_not_found")
    return role


@router.delete("/roles/{role_id}", status_code=204)
async def delete_role(role_id: str, repo: RoleRepository = Depends(get_role_repo)) -> None:
    if not repo.delete(role_id):
        raise HTTPException(status_code=404, detail="role_not_found")
    return None
