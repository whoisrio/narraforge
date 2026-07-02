"""Source document model — project-level source files (text/audio/path)."""

from sqlalchemy import Column, String, Integer, Float, Text, ForeignKey, DateTime

from app.core.database import Base
from app.core.time_utils import utcnow


class SourceDocument(Base):
    """项目级源文件 (文本/音频/路径引用)."""
    __tablename__ = "source_documents"

    id = Column(String, primary_key=True)
    project_id = Column(
        String,
        ForeignKey("segmented_projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_type = Column(String, nullable=False)  # 'paste' | 'audio' | 'path'
    title = Column(String, nullable=False)
    file_path = Column(String, nullable=True)
    pasted_text = Column(Text, nullable=True)
    audio_path = Column(String, nullable=True)
    file_size = Column(Integer, nullable=True)
    duration_sec = Column(Float, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
