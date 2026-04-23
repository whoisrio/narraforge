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
    pitch = Column(Integer, default=0)
    emotion = Column(String, default="neutral")
    language = Column(String, default="Chinese")
    created_at = Column(DateTime, default=datetime.utcnow)
