from sqlalchemy import Column, String, DateTime, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from app.core.database import Base


class VoiceProfile(Base):
    __tablename__ = "voice_profiles"

    def __repr__(self):
        return f"<VoiceProfile(id={self.id}, name={self.name})>"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    audio_path = Column(String, nullable=False)

    # 外部音频 URL（七牛云、AWS S3 等云存储）
    external_audio_url = Column(String, nullable=True)

    # 千问声音克隆相关字段
    qwen_voice_id = Column(String, nullable=True)  # 千问返回的声音 ID
    role = Column(String, default="custom")  # 角色：male/female/custom
    is_cloned = Column(Boolean, default=False)  # 是否已完成克隆
    cloned_at = Column(DateTime, nullable=True)  # 克隆完成时间

    created_at = Column(DateTime, default=datetime.utcnow)