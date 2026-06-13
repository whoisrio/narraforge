"""P2 v2: SourceDocument + NarrationDocument model + chapter 字段迁移."""
from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core.database import Base, engine
from app.models.narration import NarrationDocument, SourceDocument
from app.models.segmented_project import (
    SegmentedProject,
    SegmentedProjectChapter,
    SegmentedProjectSegment,
)


@pytest.fixture
def db_session():
    """干净内存 db, 独立 engine (不污染 conftest 的 session-wide engine)."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    # 独立 in-memory engine, 每个 fixture 实例独立, 不冲突
    test_engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=test_engine)
    Session = sessionmaker(bind=test_engine)
    session = Session()
    # SQLite 默认 FK off, 开启才能让 ondelete=CASCADE/SET NULL 真正生效
    session.execute(text("PRAGMA foreign_keys=ON"))
    session.commit()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=test_engine)
        test_engine.dispose()


def test_tables_created(db_session):
    """SourceDocument / NarrationDocument 表能建立."""
    assert SourceDocument.__tablename__ == "source_documents"
    assert NarrationDocument.__tablename__ == "narration_documents"
    # 实际查表能返回空
    assert db_session.query(SourceDocument).count() == 0
    assert db_session.query(NarrationDocument).count() == 0


def test_source_document_paste_round_trip(db_session):
    """粘贴型源: 创建 + 读取."""
    proj = SegmentedProject(id="p1", name="Test", schema_version=2, layout="vertical")
    db_session.add(proj)
    db_session.flush()

    src = SourceDocument(
        id="s1",
        project_id="p1",
        source_type="paste",
        title="notes.md",
        pasted_text="这是一些测试文本。",
        file_size=42,
    )
    db_session.add(src)
    db_session.commit()

    got = db_session.query(SourceDocument).filter_by(id="s1").first()
    assert got is not None
    assert got.source_type == "paste"
    assert got.pasted_text == "这是一些测试文本。"
    assert got.file_path is None
    assert got.audio_path is None
    assert got.title == "notes.md"


def test_source_document_audio_round_trip(db_session):
    """音频型源: 字段互斥."""
    proj = SegmentedProject(id="p2", name="Test2", schema_version=2, layout="vertical")
    db_session.add(proj)
    db_session.flush()

    src = SourceDocument(
        id="s2",
        project_id="p2",
        source_type="audio",
        title="interview.mp3",
        audio_path="/uploads/interview.mp3",
        file_size=1024000,
        duration_sec=272.5,
    )
    db_session.add(src)
    db_session.commit()

    got = db_session.query(SourceDocument).filter_by(id="s2").first()
    assert got.source_type == "audio"
    assert got.audio_path == "/uploads/interview.mp3"
    assert got.duration_sec == 272.5
    assert got.pasted_text is None


def test_source_cascade_delete_with_project(db_session):
    """项目删除时源级联删除."""
    proj = SegmentedProject(id="p3", name="T", schema_version=2, layout="vertical")
    db_session.add(proj)
    db_session.flush()
    db_session.add(SourceDocument(id="s3", project_id="p3", source_type="paste",
                                    title="x", pasted_text="y"))
    db_session.commit()

    db_session.delete(proj)
    db_session.commit()
    assert db_session.query(SourceDocument).count() == 0


def test_narration_document_full_version(db_session):
    """整稿旁白文档 v1: 写入并读回."""
    proj = SegmentedProject(id="p4", name="T", schema_version=2, layout="vertical")
    db_session.add(proj)
    db_session.flush()

    body = (
        "## 第 1 章 · 起源\n\n2026 年开年...\n\n"
        "## 第 2 章 · 路线\n\n先说 MLA...\n"
    )
    narr = NarrationDocument(
        id="n1",
        project_id="p4",
        version="v1",
        version_kind="full",
        body_markdown=body,
        word_count=42,
        source_ids_json='["s1","s2"]',
        prompt_hint="语气保持冷静",
        settings_json='{"target_chapters":2,"engine":"mimo"}',
        chapter_slices_json='[{"chapter_index":0,"title":"第 1 章","start_char":0,"end_char":18}]',
    )
    db_session.add(narr)
    db_session.commit()

    got = db_session.query(NarrationDocument).filter_by(id="n1").first()
    assert got.version == "v1"
    assert got.version_kind == "full"
    assert got.body_markdown == body
    assert got.word_count == 42
    assert got.source_ids_json == '["s1","s2"]'


def test_narration_unique_project_version(db_session):
    """(project_id, version) 联合唯一."""
    proj = SegmentedProject(id="p5", name="T", schema_version=2, layout="vertical")
    db_session.add(proj)
    db_session.flush()
    db_session.add(NarrationDocument(
        id="n2a", project_id="p5", version="v1", version_kind="full",
        body_markdown="a", word_count=1, source_ids_json="[]", settings_json="{}"
    ))
    db_session.commit()

    # 重复 v1
    db_session.add(NarrationDocument(
        id="n2b", project_id="p5", version="v1", version_kind="full",
        body_markdown="b", word_count=1, source_ids_json="[]", settings_json="{}"
    ))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_chapter_narration_fields(db_session):
    """Chapter 写入旁白关联字段并能读回."""
    proj = SegmentedProject(id="p6", name="T", schema_version=2, layout="vertical")
    db_session.add(proj)
    db_session.flush()
    # 必须先建 NarrationDocument 才能让 chapter.narration_document_id FK 满足
    narr = NarrationDocument(
        id="n1", project_id="p6", version="v1", version_kind="full",
        body_markdown="x", word_count=1, source_ids_json="[]", settings_json="{}"
    )
    db_session.add(narr)
    db_session.flush()

    ch = SegmentedProjectChapter(
        id="c1", project_id="p6", position=0, name="第 1 章",
        narration_document_id="n1", narration_version="v1",
        narration_slice_start=0, narration_slice_end=42,
    )
    db_session.add(ch)
    db_session.commit()

    got = db_session.query(SegmentedProjectChapter).filter_by(id="c1").first()
    assert got.narration_document_id == "n1"
    assert got.narration_version == "v1"
    assert got.narration_slice_start == 0
    assert got.narration_slice_end == 42
    assert got.narration_synced_at is None


def test_chapter_narration_set_null_on_delete(db_session):
    """旁白文档删除时 chapter.narration_document_id 设为 NULL (FK ON DELETE SET NULL)."""
    proj = SegmentedProject(id="p7", name="T", schema_version=2, layout="vertical")
    db_session.add(proj)
    db_session.flush()
    narr = NarrationDocument(
        id="n7", project_id="p7", version="v1", version_kind="full",
        body_markdown="x", word_count=1, source_ids_json="[]", settings_json="{}"
    )
    db_session.add(narr)
    db_session.flush()

    ch = SegmentedProjectChapter(
        id="c7", project_id="p7", position=0, name="第 1 章",
        narration_document_id="n7", narration_version="v1",
    )
    db_session.add(ch)
    db_session.commit()

    db_session.delete(narr)
    db_session.commit()
    got = db_session.query(SegmentedProjectChapter).filter_by(id="c7").first()
    assert got.narration_document_id is None  # SET NULL 生效


def test_project_active_narration_version(db_session):
    """Project.active_narration_version 字段读写."""
    proj = SegmentedProject(
        id="p8", name="T", schema_version=2, layout="vertical",
        active_narration_version="v2.1"
    )
    db_session.add(proj)
    db_session.commit()

    got = db_session.query(SegmentedProject).filter_by(id="p8").first()
    assert got.active_narration_version == "v2.1"
