"""仓储依赖注入（步骤 3A；M4 增加请求级用户作用域）。

按 settings.deploy_target 返回 Local（SQLAlchemy，用 get_db 的 Session）或
Supabase（PostgREST）实现。路由用 Depends(get_xxx_repo) 替换原来的直接
service/SQLAlchemy 调用；workers 模式代码路径不触碰 SQLAlchemy engine。

全部为 async def：workers 运行时（Pyodide）不支持线程，sync 依赖会被
FastAPI 包进 anyio.to_thread 直接失败（can't start new thread）。

M4 多用户隔离（workers/Supabase 实现专属；Local 实现忽略 user，行为不变）：
- 已认证用户 → owner_id=user["id"]：所有 select/update/delete 追加
  user_id=eq.<id> 过滤，insert 写入 user_id（跨用户访问自然 404）；
- legacy admin（旧凭证通道）→ see_all=True：不加过滤，看全部行；
- 匿名（仅可能到达无状态 allowlist 端点，正常不会触达这些仓储）→
  owner_id=None 且非 see_all：兜底作用域 user_id IS NULL，看不到任何用户数据。
"""
from __future__ import annotations

from typing import Any

from fastapi import Depends, Request

from app.core.config import settings
from app.core.database import get_db
from app.core.supabase_client import get_supabase_client

# workers bundle 不含 sqlalchemy：Session 仅作注解（FastAPI 注入不看它），
# 缺失时退化为 Any；Local* 实现只在 local 模式实例化（_workers_mode 分支）。
try:
    from sqlalchemy.orm import Session
except ImportError:  # workers bundle
    Session = Any  # type: ignore[assignment,misc]


def _workers_mode() -> bool:
    return settings.deploy_target == "workers"


def _request_scope(request: Request) -> tuple[str | None, bool]:
    """从 request.state 提取 (owner_id, see_all)。

    auth 中间件（workers 模式注册）负责设置 state.user / state.legacy_admin；
    local 模式无中间件，getattr 兜底为 (None, False)，但 local 走 Local 实现
    不消费该返回值。
    """
    if getattr(request.state, "legacy_admin", False):
        return None, True
    user = getattr(request.state, "user", None)
    if user:
        return user["id"], False
    return None, False


async def get_system_config_repo(request: Request, db: Session = Depends(get_db)):
    # 函数内 import（与其他 repo 一致）：system_configs 模块顶层引用了
    # sqlalchemy 相关名字（守卫过），延迟到首次调用再加载。
    from app.core.repositories.system_configs import (
        LocalSystemConfigRepository,
        SupabaseSystemConfigRepository,
    )

    if _workers_mode():
        # system_configs 全局共享（storage_mode 等），不做用户隔离
        return SupabaseSystemConfigRepository(get_supabase_client())
    return LocalSystemConfigRepository(db)


async def get_role_repo(request: Request, db: Session = Depends(get_db)):
    from app.core.repositories.roles import LocalRoleRepository, SupabaseRoleRepository

    if _workers_mode():
        owner_id, see_all = _request_scope(request)
        return SupabaseRoleRepository(get_supabase_client(), owner_id=owner_id, see_all=see_all)
    return LocalRoleRepository(db)


async def get_voice_repo(request: Request, db: Session = Depends(get_db)):
    from app.core.repositories.voice_profiles import (
        LocalVoiceProfileRepository,
        SupabaseVoiceProfileRepository,
    )

    if _workers_mode():
        owner_id, see_all = _request_scope(request)
        return SupabaseVoiceProfileRepository(
            get_supabase_client(), owner_id=owner_id, see_all=see_all
        )
    return LocalVoiceProfileRepository(db)


async def get_source_document_repo(request: Request, db: Session = Depends(get_db)):
    from app.core.repositories.source_documents import (
        LocalSourceDocumentRepository,
        SupabaseSourceDocumentRepository,
    )

    if _workers_mode():
        owner_id, see_all = _request_scope(request)
        return SupabaseSourceDocumentRepository(
            get_supabase_client(), owner_id=owner_id, see_all=see_all
        )
    return LocalSourceDocumentRepository(db)


async def get_tts_results_repo(request: Request, db: Session = Depends(get_db)):
    from app.core.repositories.tts_results import (
        LocalTTSResultRepository,
        SupabaseTTSResultRepository,
    )

    if _workers_mode():
        owner_id, see_all = _request_scope(request)
        return SupabaseTTSResultRepository(
            get_supabase_client(), owner_id=owner_id, see_all=see_all
        )
    return LocalTTSResultRepository(db)


async def get_segmented_repo(request: Request, db: Session = Depends(get_db)):
    from app.core.repositories.segmented_projects import (
        LocalSegmentedProjectRepository,
        SupabaseSegmentedProjectRepository,
    )

    if _workers_mode():
        owner_id, see_all = _request_scope(request)
        return SupabaseSegmentedProjectRepository(
            get_supabase_client(), owner_id=owner_id, see_all=see_all
        )
    return LocalSegmentedProjectRepository(db)


async def get_usage_repo(request: Request, db: Session = Depends(get_db)):
    """用量计量仓储（Phase 3）：workers 按用户作用域，local 单租户。"""
    from app.core.repositories.usage import (
        LocalUsageRepository,
        SupabaseUsageRepository,
    )

    if _workers_mode():
        owner_id, see_all = _request_scope(request)
        return SupabaseUsageRepository(
            get_supabase_client(), owner_id=owner_id, see_all=see_all
        )
    return LocalUsageRepository(db)


async def get_admin_stats_repo():
    """管理后台统计仓储（M5，Supabase-only；路由只在 workers 模式挂载）。"""
    from app.core.repositories.admin_stats import SupabaseAdminStatsRepository

    return SupabaseAdminStatsRepository(get_supabase_client())
