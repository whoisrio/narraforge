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

    async def batch_create_structure(self, pid, structure):
        self.calls.append((pid, structure))
        return self._ids


class _FakeRuntime:
    def __init__(self, backend):
        self.store = None
        self.backend = backend


def _patch(monkeypatch, structure):
    monkeypatch.setattr(
        "app.nodes.knowledge_video.split_chapters.get_stream_writer", lambda: (lambda p: None)
    )
    client = type("C", (), {})

    async def fake_create(**kw):
        return structure

    client.create = fake_create
    monkeypatch.setattr(
        "app.nodes.knowledge_video.split_chapters.get_instructor_client",
        lambda: (client, "m"),
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
async def test_backend_failure_is_soft_error(monkeypatch):
    structure = SegmentChapters(
        chapters=[ChapterStructure(chapter_title="c", segments=[Segment(text="t")])]
    )
    _patch(monkeypatch, structure)

    class _BadBackend:
        async def batch_create_structure(self, pid, structure):
            raise RuntimeError("backend down")

    state = {"project_id": "p1", "narration_script": "s", "current_stage": "split_chapters"}
    result = await split_chapters_node(state, _FakeRuntime(_BadBackend()))
    assert result["error"] is not None
    assert result["structured_segments"] == []
