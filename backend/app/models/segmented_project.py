"""分段语音项目 —— 后端模式持久化模型

v1: 项目 → 章节 → 段落 三层结构, schema_version=2
v2 (P2): 章节可关联到旁白文档 (narration_document_id), original_text 来自旁白切片
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
    Text,
)
from sqlalchemy.orm import relationship
from datetime import datetime

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
    # P2 v2: 旁白文档当前活跃版本 (e.g. 'v2.1')
    active_narration_version = Column(String, nullable=True)
    # P2 v3: 整体动画主题 (e.g. 'dark-botanical', 'tech-blueprint', 'warm-paper')
    animation_theme = Column(String, nullable=True)
    # 默认关联的 Remotion 项目路径；导出音频优先写入其 public/audio 目录
    remotion_project_path = Column(String, nullable=True)
    # P7: 源文档 markdown 内容
    source_document = Column(Text, nullable=True)
    # P3: 默认旁白角色 (全局角色库引用) + 快照 (可复现生成)
    default_narrator_role_id = Column(
        String,
        ForeignKey("roles.id", ondelete="SET NULL"),
        nullable=True,
    )
    default_narrator_snapshot = Column(JSON, nullable=True)

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
    engine = Column(String, nullable=True)
    default_params = Column(JSON, nullable=False, default=dict)
    split_config = Column(JSON, nullable=False, default=dict)
    original_text = Column(String, nullable=True)
    design_title = Column(String, nullable=True)
    # P2 v2: 旁白文档关联
    narration_document_id = Column(
        String,
        ForeignKey("narration_documents.id", ondelete="SET NULL"),
        nullable=True,
    )
    narration_version = Column(String, nullable=True)        # e.g. 'v2.1'
    narration_slice_start = Column(Integer, nullable=True)   # char offset in body_markdown
    narration_slice_end = Column(Integer, nullable=True)
    narration_synced_at = Column(DateTime, nullable=True)

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
    project_id = Column(
        String,
        ForeignKey("segmented_projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    position = Column(Integer, nullable=False)
    text = Column(String, nullable=False, default="")
    ssml = Column(String, nullable=True)
    emotion = Column(String, nullable=True)
    # P3: 段落角色 (全局角色库引用) + 快照 + 类型 + 局部语气标注
    role_id = Column(String, ForeignKey("roles.id", ondelete="SET NULL"), nullable=True)
    role_snapshot = Column(JSON, nullable=True)
    segment_kind = Column(String, nullable=False, default="narration")
    prosody_marks = Column(JSON, nullable=False, default=list)
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
    # P2 v3: 完整动画规格 JSON (visual_concept / layout / phases / animations / emphasis ...)
    animation_spec_json = Column(Text, nullable=True)

    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    chapter = relationship("SegmentedProjectChapter", back_populates="segments")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<SegmentedProjectSegment(id={self.id}, text={self.text[:20]!r})>"
