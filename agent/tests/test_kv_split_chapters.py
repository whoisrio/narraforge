"""Tests for the kv split_chapters node."""
import pytest

from app.nodes.knowledge_video.split_chapters import split_chapters_node
from app.schemas import (
    ChapterStructure,
    ChapterWithSegmentIds,
    Segment,
    SegmentChapters,
    SegmentWithId,
)


class _FakeBackend:
    def __init__(self, ids):
        self._ids = ids
        self.calls = []

    async def batch_create_structure(self, pid, structure, narration_scripts=None, engine=None, full_script=None):
        self.calls.append((pid, structure, narration_scripts, engine, full_script))
        return self._ids


class _FakeRuntime:
    def __init__(self, backend):
        self.store = None
        self.backend = backend


def _patch(monkeypatch, structure):
    monkeypatch.setattr(
        "app.nodes.knowledge_video.split_chapters.get_stream_writer", lambda: (lambda p: None)
    )

    async def fake_structured(schema, messages, **kw):
        return structure, None

    monkeypatch.setattr(
        "app.nodes.knowledge_video.split_chapters.structured_llm",
        fake_structured,
    )
    monkeypatch.setattr(
        "app.nodes.knowledge_video.split_chapters.knowledge_video.get_prompt",
        lambda name, **kw: "PROMPT",
    )


@pytest.mark.asyncio
async def test_split_uses_edited_script_and_backfills_ids(monkeypatch):
    structure = SegmentChapters(
        chapters=[ChapterStructure(chapter_title="c", segments=[Segment(text="t")])]
    )
    _patch(monkeypatch, structure)
    backend = _FakeBackend([ChapterWithSegmentIds(id="ch1", segments=[SegmentWithId(id="s1")])])
    state = {
        "project_id": "p1",
        "narration_script": "原始稿",
        "edited_script": "确认稿",
        "current_stage": "split_chapters",
    }
    result = await split_chapters_node(state, _FakeRuntime(backend))

    assert result["current_stage"] == "synthesis"
    assert result["error"] is None
    assert result["structured_segments"][0]["_chapter_id"] == "ch1"
    assert result["structured_segments"][0]["segments"][0]["_segment_id"] == "s1"
    # LLM 收到的应该是 edited_script
    sent = backend.calls[0][1]
    assert sent.chapters[0].chapter_title == "c"


@pytest.mark.asyncio
async def test_split_submits_chapter_narration_from_edited_script(monkeypatch):
    """章节旁白原文随 batch 提交，来源是 edited_script。"""
    structure = SegmentChapters(
        chapters=[ChapterStructure(chapter_title="第一章", segments=[Segment(text="t")])]
    )
    _patch(monkeypatch, structure)
    backend = _FakeBackend([ChapterWithSegmentIds(id="ch1", segments=[SegmentWithId(id="s1")])])
    state = {
        "project_id": "p1",
        "narration_script": "# 第一章\n旧原文",
        "edited_script": "# 第一章\n确认后的原文",
        "current_stage": "split_chapters",
    }
    result = await split_chapters_node(state, _FakeRuntime(backend))

    assert result["error"] is None
    _, _, narration_scripts, _, _fs = backend.calls[0]
    assert narration_scripts == ["确认后的原文"]


@pytest.mark.asyncio
async def test_backend_failure_is_soft_error(monkeypatch):
    structure = SegmentChapters(
        chapters=[ChapterStructure(chapter_title="c", segments=[Segment(text="t")])]
    )
    _patch(monkeypatch, structure)

    class _BadBackend:
        async def batch_create_structure(self, pid, structure, narration_scripts=None, engine=None, full_script=None):
            raise RuntimeError("backend down")

    state = {"project_id": "p1", "narration_script": "s", "current_stage": "split_chapters"}
    result = await split_chapters_node(state, _FakeRuntime(_BadBackend()))
    assert result["error"] is not None
    assert result["structured_segments"] == []


@pytest.mark.asyncio
async def test_split_chapters_voxcpm_injects_tag_whitelist(monkeypatch):
    """kv 图 voxcpm 引擎: user message 含 tag 白名单, batch 带 engine。"""
    structure = SegmentChapters(
        chapters=[ChapterStructure(chapter_title="c", segments=[Segment(text="t")])]
    )
    captured = {}

    async def fake_structured(schema, messages, **kw):
        captured["messages"] = messages
        return structure, None

    _patch(monkeypatch, structure)
    monkeypatch.setattr(
        "app.nodes.knowledge_video.split_chapters.structured_llm", fake_structured
    )
    backend = _FakeBackend([ChapterWithSegmentIds(id="ch1", segments=[SegmentWithId(id="s1")])])

    state = {
        "project_id": "p1",
        "narration_script": "s",
        "current_stage": "split_chapters",
        "tts_engine": "voxcpm",
    }
    result = await split_chapters_node(state, _FakeRuntime(backend))

    assert result["error"] is None
    user_msg = captured["messages"][1]["content"]
    assert "[laughing]" in user_msg
    assert "白名单" in user_msg
    _, _, _, engine, _fs = backend.calls[0]
    assert engine == "voxcpm"


@pytest.mark.asyncio
async def test_split_chapters_other_engine_forbids_tags(monkeypatch):
    """kv 图非 voxcpm 引擎: user message 含"不要插入"约束, batch 带 engine。"""
    structure = SegmentChapters(
        chapters=[ChapterStructure(chapter_title="c", segments=[Segment(text="t")])]
    )
    captured = {}

    async def fake_structured(schema, messages, **kw):
        captured["messages"] = messages
        return structure, None

    _patch(monkeypatch, structure)
    monkeypatch.setattr(
        "app.nodes.knowledge_video.split_chapters.structured_llm", fake_structured
    )
    backend = _FakeBackend([ChapterWithSegmentIds(id="ch1", segments=[SegmentWithId(id="s1")])])

    state = {
        "project_id": "p1",
        "narration_script": "s",
        "current_stage": "split_chapters",
        "tts_engine": "mimo_tts",
    }
    result = await split_chapters_node(state, _FakeRuntime(backend))

    assert result["error"] is None
    user_msg = captured["messages"][1]["content"]
    assert "不要插入" in user_msg
    _, _, _, engine, _fs = backend.calls[0]
    assert engine == "mimo_tts"
