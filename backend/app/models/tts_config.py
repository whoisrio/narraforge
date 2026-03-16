from sqlalchemy import Column, String, Float, Integer, Boolean, DateTime, Enum as SQLEnum
from datetime import datetime
import uuid
import enum

from app.core.database import Base


class ModelProvider(str, enum.Enum):
    QWEN = "qwen"
    AZURE = "azure"
    OPENAI = "openai"


class Emotion(str, enum.Enum):
    HAPPY = "happy"
    SAD = "sad"
    NEUTRAL = "neutral"
    EXCITED = "excited"


class TTSConfig(Base):
    __tablename__ = "tts_configs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    provider = Column(SQLEnum(ModelProvider), default=ModelProvider.QWEN)
    model_name = Column(String, default="qwen-tts")
    speed = Column(Float, default=1.0)  # 0.5-2.0
    volume = Column(Float, default=80)  # 0-100
    pitch = Column(Integer, default=0)  # -12 到 +12
    emotion = Column(SQLEnum(Emotion), default=Emotion.NEUTRAL)
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)