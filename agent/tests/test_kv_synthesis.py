"""Tests for the kv synthesis node."""
import pytest

from app.nodes.knowledge_video.synthesis import DEFAULT_EDGE_VOICE, kv_synthesis_node


class _FakeBackend:
    def __init__(self):
        self.calls = []

    async def synthesize_segment(self, pid, cid, sid, params=None):
        self.calls.append({"pid": pid, "cid": cid, "sid": sid, "params": params})


class _FakeRuntime:
    def __init__(self, backend):
        self.store = None
        self.backend = backend


STRUCTURED = [
    {
        "chapter_title": "第一章",
        "_chapter_id": "c1",
        "segments": [
            {"text": "a", "_segment_id": "s1"},
            {"text": "b", "_segment_id": "s2"},
        ],
    }
]


def _patch_writer(monkeypatch):
    monkeypatch.setattr(
        "app.nodes.knowledge_video.synthesis.get_stream_writer", lambda: (lambda p: None)
    )


@pytest.mark.asyncio
async def test_synthesizes_each_segment_with_default_edge_voice(monkeypatch):
    _patch_writer(monkeypatch)
    backend = _FakeBackend()
    state = {"project_id": "p1", "structured_segments": STRUCTURED}
    result = await kv_synthesis_node(state, _FakeRuntime(backend))

    assert len(backend.calls) == 2
    for call in backend.calls:
        assert call["params"] == {"engine": "edge_tts", "edge_voice": DEFAULT_EDGE_VOICE}
    assert result["current_stage"] == "scaffold_remotion"
    assert len(result["synthesis_results"]) == 2
    assert result["error"] is None


@pytest.mark.asyncio
async def test_empty_structure_skips(monkeypatch):
    _patch_writer(monkeypatch)
    backend = _FakeBackend()
    result = await kv_synthesis_node(
        {"project_id": "p1", "structured_segments": []}, _FakeRuntime(backend)
    )
    assert backend.calls == []
    assert result["current_stage"] == "scaffold_remotion"


@pytest.mark.asyncio
async def test_segment_failure_continues_others(monkeypatch):
    _patch_writer(monkeypatch)

    class _FlakyBackend(_FakeBackend):
        async def synthesize_segment(self, pid, cid, sid, params=None):
            if sid == "s1":
                raise RuntimeError("tts boom")
            await super().synthesize_segment(pid, cid, sid, params=params)

    backend = _FlakyBackend()
    state = {"project_id": "p1", "structured_segments": STRUCTURED}
    result = await kv_synthesis_node(state, _FakeRuntime(backend))
    assert len(result["synthesis_results"]) == 1
    assert result["synthesis_results"][0]["segment_id"] == "s2"
