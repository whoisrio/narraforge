"""Tests for the split_segment node."""
import pytest

from app.nodes.split_segment import split_segment_node
from app.schemas import ChapterStructure, Segment, SegmentChapters


class _FakeStore:
    async def asearch(self, namespace, *, query=None, limit=10):
        return []


class _FakeBackend:
    def __init__(self, ids):
        self._ids = ids
        self.calls = []

    async def batch_create_structure(self, pid, structure):
        self.calls.append((pid, structure))
        return self._ids


class _FakeRuntime:
    def __init__(self, store, backend):
        self.store = store
        self.backend = backend


def _patch_llm(monkeypatch, structure):
    client = type("C", (), {})

    async def fake_create(**kw):
        return structure

    client.create = fake_create
    monkeypatch.setattr("app.nodes.split_segment.get_instructor_client", lambda: (client, "m"))
    monkeypatch.setattr("app.nodes.split_segment.get_stream_writer", lambda: (lambda p: None))


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
async def test_split_segment_backend_failure_is_soft_error(monkeypatch):
    structure = SegmentChapters(
        chapters=[ChapterStructure(chapter_title="c", segments=[Segment(text="t")])]
    )
    _patch_llm(monkeypatch, structure)

    class _BadBackend:
        async def batch_create_structure(self, pid, structure):
            raise RuntimeError("backend down")

    state = {
        "project_id": "p1",
        "narration_script": "s",
        "current_stage": "split_segment",
    }
    result = await split_segment_node(state, _FakeRuntime(_FakeStore(), _BadBackend()))
    assert result["error"] is not None
    assert result["structured_segments"] == []
