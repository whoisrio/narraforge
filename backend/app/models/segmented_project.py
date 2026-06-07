"""分段语音项目 —— 后端模式持久化模型骨架

⚠️ 本期（v1）暂不启用：编辑器前端模式直接走 IndexedDB。
   预留此模型供 v2 后端模式接入。

字段命名与前端 TypeScript 类型保持一致以便后续无缝接入。
本文件被 import 也不会污染运行时 schema：不在 main.py / __init__ 中触发任何 import；
当 v2 真正接入时，再 import 这里并 create_all。
"""
from sqlalchemy import Column, String, DateTime, JSON, Integer, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime

from app.core.database import Base


class SegmentedProject(Base):
    __tablename__ = "segmented_projects"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    default_params = Column(JSON, nullable=False, default=dict)
    split_config = Column(JSON, nullable=False, default=dict)
    layout = Column(String, nullable=False, default='vertical')
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    segments = relationship(
        "SegmentedProjectSegment",
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="SegmentedProjectSegment.position",
    )


class SegmentedProjectSegment(Base):
    __tablename__ = "segmented_project_segments"
    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("segmented_projects.id", ondelete="CASCADE"), nullable=False)
    position = Column(Integer, nullable=False)
    text = Column(String, nullable=False, default="")
    ssml = Column(String, nullable=True)
    params = Column(JSON, nullable=False, default=dict)
    current_audio_id = Column(String, nullable=True)
    previous_audio_id = Column(String, nullable=True)
    duration_sec = Column(Integer, nullable=True)
    ssml_annotated_by_llm = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("SegmentedProject", back_populates="segments")
