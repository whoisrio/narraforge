"""分段语音项目 —— 后端模式持久化模型

v1: 项目 → 章节 → 段落 三层结构, schema_version=2
v3: 简化模型 - voice/audio 合并为 JSON 字段, 移除旁白关联
"""
from sqlalchemy import (
    Column,
    String,
    DateTime,
    JSON,
    Integer,
    Float,
    ForeignKey,
    Text,
)
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.time_utils import utcnow


class SegmentedProject(Base):
    __tablename__ = "segmented_projects"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    schema_version = Column(Integer, nullable=False, default=2)
    layout = Column(String, nullable=False, default="vertical")
    active_chapter_id = Column(String, nullable=True)
    original_text = Column(String, nullable=True)
    animation_theme = Column(String, nullable=True)
    remotion_project_path = Column(String, nullable=True)
    source_document = Column(Text, nullable=True)  # deprecated: 内容改存文件，见 source_document_path
    source_document_path = Column(String, nullable=True)
    narration_document_path = Column(String, nullable=True)
    default_narrator_role_id = Column(
        String,
        ForeignKey("roles.id", ondelete="SET NULL"),
        nullable=True,
    )
    configs = Column(JSON, nullable=True)

    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

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
    voice = Column(JSON, nullable=False, default=dict)
    split_config = Column(JSON, nullable=False, default=dict)
    original_text = Column(String, nullable=True)
    narration_script = Column(Text, nullable=True)
    design_title = Column(String, nullable=True)

    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

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
    position = Column(Integer, nullable=False)
    text = Column(String, nullable=False, default="")
    emotion = Column(String, nullable=True)
    role_id = Column(String, ForeignKey("roles.id", ondelete="SET NULL"), nullable=True)
    segment_kind = Column(String, nullable=False, default="narration")
    voice = Column(JSON, nullable=False, default=lambda: {"source": "chapter"})
    generated_params = Column(JSON, nullable=True)
    audio = Column(JSON, nullable=True)
    generated_at = Column(DateTime, nullable=True)
    animation_spec_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    chapter = relationship("SegmentedProjectChapter", back_populates="segments")

    @property
    def project_id(self):
        return self.chapter.project_id if self.chapter else None

    @project_id.setter
    def project_id(self, value):
        pass  # project_id is derived from chapter relationship, setter for backwards-compat

    def __repr__(self) -> str:  # pragma: no cover
        return f"<SegmentedProjectSegment(id={self.id}, text={self.text[:20]!r})>"
