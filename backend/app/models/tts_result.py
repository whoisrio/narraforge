from sqlalchemy import Column, String, DateTime, Float, Integer
from datetime import datetime
import uuid

from app.core.database import Base


class TTSResultRecord(Base):
    __tablename__ = "tts_results"

    def __repr__(self):
        return f"<TTSResultRecord(id={self.id}, text={self.text[:20]})>"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    text = Column(String, nullable=False)
    voice_id = Column(String, nullable=False)
    voice_name = Column(String, nullable=True)
    audio_path = Column(String, nullable=False)
    audio_format = Column(String, default="wav")
    speed = Column(Float, default=1.0)
    volume = Column(Float, default=80)
    pitch = Column(Float, default=1.0)  # 音调比率 0.5-2.0
    instruction = Column(String, default="音调偏高，语速中等，充满活力和感染力，适合广告配音")
    language = Column(String, default="Chinese")
    # 来源标记: None/"" = TTSSynthesis 历史；"segmented_tts" = 编辑器
    source = Column(String, nullable=True, default=None)
    created_at = Column(DateTime, default=datetime.utcnow)
