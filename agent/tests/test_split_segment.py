"""Tests for the split_segment node."""
import pytest

from app.nodes.split_segment import match_chapter_narrations, split_segment_node
from app.schemas import ChapterStructure, Segment, SegmentChapters


class _FakeStore:
    async def asearch(self, namespace, *, query=None, limit=10):
        return []


class _FakeBackend:
    def __init__(self, ids):
        self._ids = ids
        self.calls = []

    async def batch_create_structure(self, pid, structure, narration_scripts=None, engine=None, full_script=None):
        self.calls.append((pid, structure, narration_scripts, engine, full_script))
        return self._ids


class _FakeRuntime:
    def __init__(self, store, backend):
        self.store = store
        self.backend = backend


def _patch_llm(monkeypatch, structure, usage=None):
    async def fake_structured(schema, messages, **kw):
        return structure, usage

    monkeypatch.setattr("app.nodes.split_segment.structured_llm", fake_structured)
    monkeypatch.setattr("app.nodes.split_segment.get_stream_writer", lambda: (lambda p: None))


def test_match_chapter_narrations_maps_titles():
    script = "# 第一章\n原文一\n# 第二章\n原文二"
    structure = SegmentChapters(
        chapters=[
            ChapterStructure(chapter_title="第一章", segments=[Segment(text="t")]),
            ChapterStructure(chapter_title="未知章节", segments=[Segment(text="t")]),
        ]
    )
    # 标题匹配优先；匹配不到回退为该章 segments 拼接
    assert match_chapter_narrations(script, structure) == ["原文一", "t"]


def test_match_chapter_narrations_fallback_joins_segments_and_strips_tags():
    # LLM 格式漂移（无【章节：】/markdown 标记）时，用拆分结果回填且剥离 inline tag
    script = "没有任何章节标记的旁白稿。"
    structure = SegmentChapters(
        chapters=[
            ChapterStructure(
                chapter_title="Stream",
                segments=[
                    Segment(text="[Uhm] 第一段。"),
                    Segment(text="第二段 [laughing] 完。"),
                ],
            ),
        ]
    )
    assert match_chapter_narrations(script, structure) == ["第一段。\n\n第二段 完。"]


@pytest.mark.asyncio
async def test_split_segment_persists_and_returns_structure(monkeypatch):
    structure = SegmentChapters(
        chapters=[ChapterStructure(chapter_title="c", segments=[Segment(text="t")])]
    )
    _patch_llm(monkeypatch, structure)

    from app.schemas import ChapterWithSegmentIds, SegmentWithId

    backend = _FakeBackend(
        [ChapterWithSegmentIds(id="ch1", segments=[SegmentWithId(id="s1")])]
    )
    state = {
        "project_id": "p1",
        "narration_script": "s",
        "current_stage": "split_segment",
    }
    result = await split_segment_node(state, _FakeRuntime(_FakeStore(), backend))

    assert result["current_stage"] == "synthesis"
    assert result["structured_segments"][0]["_chapter_id"] == "ch1"
    assert result["structured_segments"][0]["segments"][0]["_segment_id"] == "s1"
    assert result["error"] is None
    assert len(backend.calls) == 1


@pytest.mark.asyncio
async def test_split_segment_submits_chapter_narration(monkeypatch):
    """每章旁白原文随 batch 提交；匹配不到标题的章节为 None。"""
    structure = SegmentChapters(
        chapters=[
            ChapterStructure(chapter_title="第一章", segments=[Segment(text="t")]),
            ChapterStructure(chapter_title="未知章节", segments=[Segment(text="t2")]),
        ]
    )
    _patch_llm(monkeypatch, structure)

    from app.schemas import ChapterWithSegmentIds, SegmentWithId

    backend = _FakeBackend(
        [
            ChapterWithSegmentIds(id="ch1", segments=[SegmentWithId(id="s1")]),
            ChapterWithSegmentIds(id="ch2", segments=[SegmentWithId(id="s2")]),
        ]
    )
    state = {
        "project_id": "p1",
        "narration_script": "# 第一章\n原文一\n# 第二章\n原文二",
        "current_stage": "split_segment",
    }
    result = await split_segment_node(state, _FakeRuntime(_FakeStore(), backend))

    assert result["error"] is None
    _, _, narration_scripts, _, _fs = backend.calls[0]
    assert narration_scripts == ["原文一", "t2"]  # 匹配失败回退为 segments 拼接


@pytest.mark.asyncio
async def test_split_segment_usage_reaches_stage_complete(monkeypatch):
    structure = SegmentChapters(
        chapters=[ChapterStructure(chapter_title="c", segments=[Segment(text="t")])]
    )
    usage = {"input_tokens": 8, "output_tokens": 4, "total_tokens": 12}
    _patch_llm(monkeypatch, structure, usage=usage)

    emitted = []
    monkeypatch.setattr(
        "app.nodes.split_segment.get_stream_writer", lambda: emitted.append
    )

    from app.schemas import ChapterWithSegmentIds, SegmentWithId

    backend = _FakeBackend(
        [ChapterWithSegmentIds(id="ch1", segments=[SegmentWithId(id="s1")])]
    )
    state = {
        "project_id": "p1",
        "narration_script": "s",
        "current_stage": "split_segment",
    }
    await split_segment_node(state, _FakeRuntime(_FakeStore(), backend))

    stage_complete = next(e for e in emitted if e["type"] == "stage_complete")
    assert stage_complete["data"]["usage"] == usage


@pytest.mark.asyncio
async def test_split_segment_backend_failure_is_soft_error(monkeypatch):
    structure = SegmentChapters(
        chapters=[ChapterStructure(chapter_title="c", segments=[Segment(text="t")])]
    )
    _patch_llm(monkeypatch, structure)

    class _BadBackend:
        async def batch_create_structure(self, pid, structure, narration_scripts=None, engine=None):
            raise RuntimeError("backend down")

    state = {
        "project_id": "p1",
        "narration_script": "s",
        "current_stage": "split_segment",
    }
    result = await split_segment_node(state, _FakeRuntime(_FakeStore(), _BadBackend()))
    assert result["error"] is not None
    assert result["structured_segments"] == []


def _patch_llm_capture(monkeypatch, structure, captured):
    """Like _patch_llm but records the messages sent to the LLM."""

    async def fake_structured(schema, messages, **kw):
        captured["messages"] = messages
        return structure, None

    monkeypatch.setattr("app.nodes.split_segment.structured_llm", fake_structured)
    monkeypatch.setattr("app.nodes.split_segment.get_stream_writer", lambda: (lambda p: None))


def _one_chapter_backend():
    from app.schemas import ChapterWithSegmentIds, SegmentWithId

    return _FakeBackend([ChapterWithSegmentIds(id="ch1", segments=[SegmentWithId(id="s1")])])


@pytest.mark.asyncio
async def test_split_segment_voxcpm_injects_tag_whitelist(monkeypatch):
    """voxcpm 引擎: user message 含非语言 tag 白名单策略。"""
    structure = SegmentChapters(
        chapters=[ChapterStructure(chapter_title="c", segments=[Segment(text="t")])]
    )
    captured = {}
    _patch_llm_capture(monkeypatch, structure, captured)
    backend = _one_chapter_backend()

    state = {
        "project_id": "p1",
        "narration_script": "s",
        "current_stage": "split_segment",
        "tts_engine": "voxcpm",
    }
    result = await split_segment_node(state, _FakeRuntime(_FakeStore(), backend))

    assert result["error"] is None
    user_msg = captured["messages"][1]["content"]
    assert "[laughing]" in user_msg
    assert "[Dissatisfaction-hnn]" in user_msg
    assert "白名单" in user_msg
    # batch 提交带 engine
    _, _, _, engine, _fs = backend.calls[0]
    assert engine == "voxcpm"


@pytest.mark.asyncio
async def test_split_segment_other_engine_forbids_tags(monkeypatch):
    """非 voxcpm 引擎: user message 含"不要插入"约束, batch 带 engine。"""
    structure = SegmentChapters(
        chapters=[ChapterStructure(chapter_title="c", segments=[Segment(text="t")])]
    )
    captured = {}
    _patch_llm_capture(monkeypatch, structure, captured)
    backend = _one_chapter_backend()

    state = {
        "project_id": "p1",
        "narration_script": "s",
        "current_stage": "split_segment",
        "tts_engine": "edge_tts",
    }
    result = await split_segment_node(state, _FakeRuntime(_FakeStore(), backend))

    assert result["error"] is None
    user_msg = captured["messages"][1]["content"]
    assert "不要插入" in user_msg
    assert "[laughing]" not in user_msg
    _, _, _, engine, _fs = backend.calls[0]
    assert engine == "edge_tts"
