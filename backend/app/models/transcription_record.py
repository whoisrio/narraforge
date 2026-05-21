from sqlalchemy import Column, String, DateTime, Float
from datetime import datetime
import uuid

from app.core.database import Base


class TranscriptionRecord(Base):
    __tablename__ = "transcription_records"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=False, default="default_user")
    original_filename = Column(String, nullable=False)
    audio_path = Column(String, nullable=False)
    srt_file_id = Column(String, nullable=False)
    language = Column(String, nullable=True)
    language_probability = Column(Float, default=0.0)
    model_size = Column(String, default="large-v3")
    created_at = Column(DateTime, default=datetime.utcnow)
