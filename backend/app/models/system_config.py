from sqlalchemy import Column, String, DateTime
from datetime import datetime
from app.core.database import Base


class SystemConfig(Base):
    """系统级配置键值存储，用于跨会话持久化的全局设置"""
    __tablename__ = "system_configs"

    key = Column(String, primary_key=True)
    value = Column(String, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)