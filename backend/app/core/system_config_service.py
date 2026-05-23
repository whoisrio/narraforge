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
    mode = get_config(db, "storage_mode", STORAGE_MODE_BACKEND)
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