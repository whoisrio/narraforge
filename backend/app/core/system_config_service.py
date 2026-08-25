from typing import Any

from app.core.config import settings
from app.core.supabase_client import get_supabase_client

# workers bundle 不含 sqlalchemy / app.models：本模块被 workers 链路的
# config/tts/mimo_tts 路由顶层 import，必须可加载；SystemConfig/Session 只在
# local 调用路径（db.query）运行时引用。
try:
    from sqlalchemy.orm import Session

    from app.models.system_config import SystemConfig
except ImportError:  # workers bundle
    Session = Any  # type: ignore[assignment,misc]
    SystemConfig = None  # type: ignore[assignment,misc]

# 存储模式允许的值
STORAGE_MODE_BACKEND = "backend"
STORAGE_MODE_FRONTEND = "frontend"
VALID_STORAGE_MODES = {STORAGE_MODE_BACKEND, STORAGE_MODE_FRONTEND}


def _in_workers() -> bool:
    return settings.deploy_target == "workers"


def _workers_repo():
    """workers 模式的 system_configs 访问：Supabase PostgREST 仓储（延迟 import 防循环）。"""
    from app.core.repositories.system_configs import SupabaseSystemConfigRepository

    return SupabaseSystemConfigRepository(get_supabase_client())


def get_config(db: Session, key: str, default: str = "") -> str:
    """读取配置值，不存在时返回 default。workers 模式走 Supabase 仓储（db 为 None）。"""
    if _in_workers():
        return _workers_repo().get(key, default)
    row = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    return row.value if row else default


def set_config(db: Session, key: str, value: str) -> None:
    """写入配置值（upsert），不主动 commit，由调用方控制事务。
    workers 模式走 Supabase 仓储（自带提交语义，db 为 None）。"""
    if _in_workers():
        _workers_repo().set(key, value)
        return
    row = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    if row:
        row.value = value
    else:
        row = SystemConfig(key=key, value=value)
        db.add(row)


def get_storage_mode(db: Session) -> str:
    """获取当前存储模式，默认 frontend。

    workers 模式同样读 Supabase system_configs 的 storage_mode（get_config 已按
    deploy_target 分发），使 Vercel 部署下"后端存储"可用（音频进 Supabase Storage）。
    """
    mode = get_config(db, "storage_mode", STORAGE_MODE_FRONTEND)
    if mode not in VALID_STORAGE_MODES:
        return STORAGE_MODE_BACKEND
    return mode


def set_storage_mode(db: Session, mode: str) -> None:
    """设置存储模式，由调用方负责 commit。workers 模式经 Supabase 仓储写入（自带提交）。"""
    if mode not in VALID_STORAGE_MODES:
        raise ValueError(f"Invalid storage mode: {mode}")
    set_config(db, "storage_mode", mode)


def is_frontend_storage(db: Session) -> bool:
    """判断当前是否为前端存储模式（workers 模式同样按 storage_mode 判定）。"""
    return get_storage_mode(db) == STORAGE_MODE_FRONTEND


# ----- Animation root folder (Remotion scaffold global setting) -----

ANIMATION_ROOT_FOLDER_KEY = "animation_root_folder"


NARRATION_GIT_REMOTE_KEY = "narration_git_remote"

PRONUNCIATION_MAP_GLOBAL_KEY = "pronunciation_map_global"


def get_narration_git_remote(db: Session) -> str | None:
    """读取 narration git 远端地址；未设置或空字符串返回 None。"""
    value = get_config(db, NARRATION_GIT_REMOTE_KEY, default="").strip()
    return value or None


def set_narration_git_remote(db: Session, value: str) -> None:
    """写入 narration git 远端地址（strip）。不主动 commit。"""
    set_config(db, NARRATION_GIT_REMOTE_KEY, value.strip())


def get_animation_root_folder(db: Session) -> str | None:
    """读取全局 Remotion 脚手架根目录；未设置或空字符串返回 None。"""
    value = get_config(db, ANIMATION_ROOT_FOLDER_KEY, default="").strip()
    return value or None


def normalize_animation_root_folder(value: str) -> str:
    """归一化脚手架根目录（strip + expanduser）。纯函数，仓储/服务共用。"""
    from pathlib import Path

    stripped = value.strip()
    return str(Path(stripped).expanduser()) if stripped else ""


def set_animation_root_folder(db: Session, value: str) -> None:
    """写入全局 Remotion 脚手架根目录（strip + expanduser）。

    不主动 commit，由调用方控制事务（与 set_storage_mode 一致）。
    """
    set_config(db, ANIMATION_ROOT_FOLDER_KEY, normalize_animation_root_folder(value))