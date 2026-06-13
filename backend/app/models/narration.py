"""Source 文档 & 旁白文档 (Narration) —— P2 V3

源是项目级全局资产. 旁白文档是 LLM 合成后的口播稿 (可多版本).
章节从旁白文档按 # H2 切片而来, chapter.original_text = 切片内容.
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
    UniqueConstraint,
    Index,
)
from sqlalchemy.orm import relationship
from datetime import datetime

from app.core.database import Base


class SourceDocument(Base):
    """项目级源文件 (文本/音频/路径引用).

    互斥字段: file_path / pasted_text / audio_path 三者只有一个非空.
    故意不存 transcript_text / word_count — 那些信息住在 chapter.original_text
    (旁白文档已经把它们吸进去了, 这里只记 "从哪来").
    """
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
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    project = relationship("SegmentedProject")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<SourceDocument(id={self.id}, type={self.source_type!r}, title={self.title!r})>"


class NarrationDocument(Base):
    """项目级旁白文档 (LLM 合成产物, 可多版本).

    version 语义:
      - 整稿重生成 → v{N+1} (大版本, version_kind='full')
      - 单章节再生成 → v{N}.{M+1} (小版本, version_kind='partial')

    body_markdown 包含完整旁白文档, 按 # 二级标题切分章节.
    可选 marker: <!-- CHAPTER: 标题 --> (LLM 建议输出, parser 自动 fallback H2).

    chapter_slices_json: 冗余存储, 避免每次解析 markdown
    结构: [{"chapter_index": 0, "title": "第 1 章", "start_char": 12, "end_char": 320}, ...]
    """
    __tablename__ = "narration_documents"
    __table_args__ = (
        UniqueConstraint("project_id", "version", name="uq_narration_project_version"),
        Index("idx_narration_project_generated", "project_id", "generated_at"),
    )

    id = Column(String, primary_key=True)
    project_id = Column(
        String,
        ForeignKey("segmented_projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    version = Column(String, nullable=False)  # 'v1', 'v2', 'v2.1'
    version_kind = Column(String, nullable=False, default="full")  # 'full' | 'partial'
    body_markdown = Column(Text, nullable=False)
    word_count = Column(Integer, nullable=False, default=0)
    source_ids_json = Column(Text, nullable=False, default="[]")  # JSON array of source ids
    prompt_hint = Column(Text, nullable=True)
    settings_json = Column(Text, nullable=False, default="{}")  # {target_chapters, target_words, language, engine}
    chapter_slices_json = Column(Text, nullable=True)  # JSON: [{chapter_index, title, start_char, end_char}]
    generated_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    project = relationship("SegmentedProject")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<NarrationDocument(id={self.id}, version={self.version!r}, project={self.project_id!r})>"
