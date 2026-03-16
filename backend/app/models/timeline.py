from sqlalchemy import Column, String, Float, DateTime, ForeignKey
from datetime import datetime
import uuid

from app.core.database import Base


class TimelineProject(Base):
    __tablename__ = "timeline_projects"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    video_path = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class TimelineSegment(Base):
    __tablename__ = "timeline_segments"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, ForeignKey("timeline_projects.id"), nullable=False)
    text = Column(String, nullable=False)
    start_time = Column(Float, nullable=False)
    end_time = Column(Float, nullable=False)
    audio_path = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)