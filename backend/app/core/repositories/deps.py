"""仓储依赖注入（步骤 3A）。

按 settings.deploy_target 返回 Local（SQLAlchemy，用 get_db 的 Session）或
Supabase（PostgREST）实现。路由用 Depends(get_xxx_repo) 替换原来的直接
service/SQLAlchemy 调用；workers 模式代码路径不触碰 SQLAlchemy engine。

全部为 async def：workers 运行时（Pyodide）不支持线程，sync 依赖会被
FastAPI 包进 anyio.to_thread 直接失败（can't start new thread）。
"""
from __future__ import annotations

from fastapi import Depends
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.supabase_client import get_supabase_client
from app.core.repositories.system_configs import (
    LocalSystemConfigRepository,
    SupabaseSystemConfigRepository,
    SystemConfigRepository,
)


def _workers_mode() -> bool:
    return settings.deploy_target == "workers"


async def get_system_config_repo(db: Session = Depends(get_db)) -> SystemConfigRepository:
    if _workers_mode():
        return SupabaseSystemConfigRepository(get_supabase_client())
    return LocalSystemConfigRepository(db)


async def get_role_repo(db: Session = Depends(get_db)):
    from app.core.repositories.roles import LocalRoleRepository, SupabaseRoleRepository

    if _workers_mode():
        return SupabaseRoleRepository(get_supabase_client())
    return LocalRoleRepository(db)


async def get_voice_repo(db: Session = Depends(get_db)):
    from app.core.repositories.voice_profiles import (
        LocalVoiceProfileRepository,
        SupabaseVoiceProfileRepository,
    )

    if _workers_mode():
        return SupabaseVoiceProfileRepository(get_supabase_client())
    return LocalVoiceProfileRepository(db)


async def get_source_document_repo(db: Session = Depends(get_db)):
    from app.core.repositories.source_documents import (
        LocalSourceDocumentRepository,
        SupabaseSourceDocumentRepository,
    )

    if _workers_mode():
        return SupabaseSourceDocumentRepository(get_supabase_client())
    return LocalSourceDocumentRepository(db)


async def get_segmented_repo(db: Session = Depends(get_db)):
    from app.core.repositories.segmented_projects import (
        LocalSegmentedProjectRepository,
        SupabaseSegmentedProjectRepository,
    )

    if _workers_mode():
        return SupabaseSegmentedProjectRepository(get_supabase_client())
    return LocalSegmentedProjectRepository(db)
