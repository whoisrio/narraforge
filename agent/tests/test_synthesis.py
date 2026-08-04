"""Tests for the synthesis node."""
import pytest

from app.nodes.synthesis import synthesis_node


class _FakeBackend:
    def __init__(self):
        self.calls = []

    async def synthesize_segment(self, pid, cid, sid):
        self.calls.append((cid, sid))


@pytest.mark.asyncio
async def test_synthesis_loops_segments_and_emits_progress(monkeypatch):
    emitted = []
    monkeypatch.setattr(
        "app.nodes.synthesis.get_stream_writer", lambda: (lambda p: emitted.append(p))
    )
    runtime = type("R", (), {"backend": _FakeBackend(), "store": None})()

    state = {
        "project_id": "p1",
        "structured_segments": [
            {
                "_chapter_id": "ch1",
                "segments": [
                    {"_segment_id": "s1", "text": "a"},
                    {"_segment_id": "s2", "text": "b"},
                ],
            },
            {"_chapter_id": "ch2", "segments": [{"_segment_id": "s3", "text": "c"}]},
        ],
        "current_stage": "synthesis",
    }
    result = await synthesis_node(state, runtime)

    assert len(runtime.backend.calls) == 3
    assert result["current_stage"] == "completed"
    assert len(result["synthesis_results"]) == 3
    progress_events = [e for e in emitted if e.get("type") == "progress"]
    assert progress_events[-1]["data"]["completed"] == 3
    assert progress_events[-1]["data"]["total"] == 3


@pytest.mark.asyncio
async def test_synthesis_empty_segments_skips(monkeypatch):
    monkeypatch.setattr(
        "app.nodes.synthesis.get_stream_writer", lambda: (lambda p: None)
    )
    runtime = type("R", (), {"backend": _FakeBackend(), "store": None})()
    result = await synthesis_node(
        {"project_id": "p1", "structured_segments": [], "current_stage": "synthesis"},
        runtime,
    )
    assert result["synthesis_results"] == []
    assert result["current_stage"] == "completed"


class _FakeBackendWithRecorded(_FakeBackend):
    async def get_recorded_segment_ids(self, pid):
        return {"s2"}


@pytest.mark.asyncio
async def test_synthesis_skips_recorded_segments(monkeypatch):
    """Segments with user-recorded audio (origin='recorded') must not be re-synthesized."""
    emitted = []
    monkeypatch.setattr(
        "app.nodes.synthesis.get_stream_writer", lambda: (lambda p: emitted.append(p))
    )
    runtime = type("R", (), {"backend": _FakeBackendWithRecorded(), "store": None})()

    state = {
        "project_id": "p1",
        "structured_segments": [
            {
                "_chapter_id": "ch1",
                "segments": [
                    {"_segment_id": "s1", "text": "a"},
                    {"_segment_id": "s2", "text": "b"},
                ],
            },
            {"_chapter_id": "ch2", "segments": [{"_segment_id": "s3", "text": "c"}]},
        ],
        "current_stage": "synthesis",
    }
    result = await synthesis_node(state, runtime)

    assert runtime.backend.calls == [("ch1", "s1"), ("ch2", "s3")]
    assert len(result["synthesis_results"]) == 2
    skip_events = [e for e in emitted if e.get("type") == "segment_skip"]
    assert len(skip_events) == 1
    assert "s2" in skip_events[0]["message"]
    # progress still counts the skipped segment
    progress_events = [e for e in emitted if e.get("type") == "progress"]
    assert progress_events[-1]["data"]["completed"] == 3