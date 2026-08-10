"""仓储层（步骤 3A）。

workers 运行时没有原生 socket，持久化走 Supabase PostgREST；本地模式保持
SQLAlchemy + SQLite 零回退。每个域一个模块：Protocol + Local + Supabase 实现，
方法签名从现有 service/route 的实际调用提取（YAGNI）。

依赖注入（FastAPI）：见 deps.py —— 按 settings.deploy_target 返回 Local/Supabase
实现；Local 实现内部仍用 get_db 的 Session。
"""
from app.core.repositories.deps import (
    get_role_repo,
    get_source_document_repo,
    get_system_config_repo,
    get_voice_repo,
)

__all__ = [
    "get_role_repo",
    "get_source_document_repo",
    "get_system_config_repo",
    "get_voice_repo",
]
