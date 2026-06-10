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

    # 克隆引擎：'qwen'（千问CosyVoice）或 'mimo'（MiMo TTS）
    clone_engine = Column(String, nullable=True)  # 区分复刻来源

    # MiMo 声音复刻相关字段（预留）
    mimo_voice_id = Column(String, nullable=True)  # MiMo 声音复刻的标记

    # 用户自定义的声音描述，用于替代无意义的 voice_id 显示
    description = Column(String, nullable=True)

    # 参考音频的文字转录（VoxCPM Ultimate Clone 使用）
    prompt_text = Column(String, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)