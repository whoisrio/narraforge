"""分段语音项目 —— 后端模式持久化模型

v1: 项目 → 章节 → 段落 三层结构, schema_version=2
"""
from sqlalchemy import (
    Column,
    String,
    DateTime,
    JSON,
    Integer,
    Boolean,
    Float,
    ForeignKey,
)
from sqlalchemy.orm import relationship
from datetime import datetime

from app.core.database import Base


class SegmentedProject(Base):
    __tablename__ = "segmented_projects"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    schema_version = Column(Integer, nullable=False, default=2)
    layout = Column(String, nullable=False, default="vertical")
    active_chapter_id = Column(String, nullable=True)
    original_text = Column(String, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    chapters = relationship(
        "SegmentedProjectChapter",
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="SegmentedProjectChapter.position",
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<SegmentedProject(id={self.id}, name={self.name!r})>"


class SegmentedProjectChapter(Base):
    __tablename__ = "segmented_project_chapters"

    id = Column(String, primary_key=True)
    project_id = Column(
        String,
        ForeignKey("segmented_projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    position = Column(Integer, nullable=False)
    name = Column(String, nullable=False)
    engine = Column(String, nullable=True)
    default_params = Column(JSON, nullable=False, default=dict)
    split_config = Column(JSON, nullable=False, default=dict)
    original_text = Column(String, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("SegmentedProject", back_populates="chapters")
    segments = relationship(
        "SegmentedProjectSegment",
        back_populates="chapter",
        cascade="all, delete-orphan",
        order_by="SegmentedProjectSegment.position",
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<SegmentedProjectChapter(id={self.id}, name={self.name!r})>"


class SegmentedProjectSegment(Base):
    __tablename__ = "segmented_project_segments"

    id = Column(String, primary_key=True)
    chapter_id = Column(
        String,
        ForeignKey("segmented_project_chapters.id", ondelete="CASCADE"),
        nullable=False,
    )
    project_id = Column(
        String,
        ForeignKey("segmented_projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    position = Column(Integer, nullable=False)
    text = Column(String, nullable=False, default="")
    ssml = Column(String, nullable=True)
    emotion = Column(String, nullable=True)
    params = Column(JSON, nullable=False, default=dict)
    locked_params = Column(JSON, nullable=False, default=list)
    generated_params = Column(JSON, nullable=True)
    current_audio_path = Column(String, nullable=True)
    previous_audio_path = Column(String, nullable=True)
    audio_format = Column(String, nullable=False, default="mp3")
    duration_sec = Column(Float, nullable=True)
    audio_missing = Column(Boolean, nullable=False, default=False)
    generated_at = Column(DateTime, nullable=True)
    ssml_annotated_by_llm = Column(Boolean, nullable=False, default=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    chapter = relationship("SegmentedProjectChapter", back_populates="segments")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<SegmentedProjectSegment(id={self.id}, text={self.text[:20]!r})>"
