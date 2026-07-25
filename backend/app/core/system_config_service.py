from sqlalchemy.orm import Session
from app.models.system_config import SystemConfig

# 存储模式允许的值
STORAGE_MODE_BACKEND = "backend"
STORAGE_MODE_FRONTEND = "frontend"
VALID_STORAGE_MODES = {STORAGE_MODE_BACKEND, STORAGE_MODE_FRONTEND}


def get_config(db: Session, key: str, default: str = "") -> str:
    """读取配置值，不存在时返回 default"""
    row = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    return row.value if row else default


def set_config(db: Session, key: str, value: str) -> None:
    """写入配置值（upsert），不主动 commit，由调用方控制事务"""
    row = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    if row:
        row.value = value
    else:
        row = SystemConfig(key=key, value=value)
        db.add(row)


def get_storage_mode(db: Session) -> str:
    """获取当前存储模式，默认 backend"""
    mode = get_config(db, "storage_mode", STORAGE_MODE_FRONTEND)
    if mode not in VALID_STORAGE_MODES:
        return STORAGE_MODE_BACKEND
    return mode


def set_storage_mode(db: Session, mode: str) -> None:
    """设置存储模式，由调用方负责 commit"""
    if mode not in VALID_STORAGE_MODES:
        raise ValueError(f"Invalid storage mode: {mode}")
    set_config(db, "storage_mode", mode)


def is_frontend_storage(db: Session) -> bool:
    """判断当前是否为前端存储模式"""
    return get_storage_mode(db) == STORAGE_MODE_FRONTEND


# ----- Animation root folder (Remotion scaffold global setting) -----

ANIMATION_ROOT_FOLDER_KEY = "animation_root_folder"


NARRATION_GIT_REMOTE_KEY = "narration_git_remote"


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


def set_animation_root_folder(db: Session, value: str) -> None:
    """写入全局 Remotion 脚手架根目录（strip + expanduser）。

    不主动 commit，由调用方控制事务（与 set_storage_mode 一致）。
    """
    from pathlib import Path

    stripped = value.strip()
    normalized = str(Path(stripped).expanduser()) if stripped else ""
    set_config(db, ANIMATION_ROOT_FOLDER_KEY, normalized)