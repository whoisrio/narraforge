"""Tests for the kv synthesis node (engine-aware defaults + hard-fail on any error)."""
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


# ---------------------------------------------------------------------------
# Default engine (no tts_engine set) → edge_tts, unchanged behaviour
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_edge_tts_default_voice_when_engine_missing(monkeypatch):
    _patch_writer(monkeypatch)
    backend = _FakeBackend()
    state = {"project_id": "p1", "structured_segments": STRUCTURED}
    result = await kv_synthesis_node(state, _FakeRuntime(backend))

    assert len(backend.calls) == 2
    for call in backend.calls:
        assert call["params"] == {"engine": "edge_tts", "edge_voice": DEFAULT_EDGE_VOICE}
    assert result["current_stage"] == "scaffold_remotion"
    assert result["error"] is None
    assert len(result["synthesis_results"]) == 2


@pytest.mark.asyncio
async def test_edge_tts_explicit_engine(monkeypatch):
    _patch_writer(monkeypatch)
    backend = _FakeBackend()
    state = {"project_id": "p1", "structured_segments": STRUCTURED, "tts_engine": "edge_tts"}
    result = await kv_synthesis_node(state, _FakeRuntime(backend))
    for call in backend.calls:
        assert call["params"]["engine"] == "edge_tts"
        assert call["params"]["edge_voice"] == DEFAULT_EDGE_VOICE
    assert result["error"] is None


# ---------------------------------------------------------------------------
# mimo_tts → preset "冰糖"
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mimo_tts_uses_bingtang_preset(monkeypatch):
    _patch_writer(monkeypatch)
    backend = _FakeBackend()
    state = {"project_id": "p1", "structured_segments": STRUCTURED, "tts_engine": "mimo_tts"}
    result = await kv_synthesis_node(state, _FakeRuntime(backend))

    for call in backend.calls:
        assert call["params"] == {
            "engine": "mimo_tts",
            "mimo_mode": "preset",
            "mimo_preset_voice": "冰糖",
        }
    assert result["error"] is None
    assert result["current_stage"] == "scaffold_remotion"


# ---------------------------------------------------------------------------
# voxcpm → clone via VOXCPM_DEFAULT_ROLE_ID; missing env halts workflow
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_voxcpm_uses_default_role_id(monkeypatch):
    _patch_writer(monkeypatch)
    monkeypatch.setenv("VOXCPM_DEFAULT_ROLE_ID", "role-abc")
    backend = _FakeBackend()
    state = {"project_id": "p1", "structured_segments": STRUCTURED, "tts_engine": "voxcpm"}
    result = await kv_synthesis_node(state, _FakeRuntime(backend))

    for call in backend.calls:
        assert call["params"]["engine"] == "voxcpm"
        # role_id 用于让后端加载 clone 角色的音色参数
        assert call["params"]["role_id"] == "role-abc"
    assert result["error"] is None


@pytest.mark.asyncio
async def test_voxcpm_without_role_id_halts(monkeypatch):
    _patch_writer(monkeypatch)
    monkeypatch.delenv("VOXCPM_DEFAULT_ROLE_ID", raising=False)
    backend = _FakeBackend()
    state = {"project_id": "p1", "structured_segments": STRUCTURED, "tts_engine": "voxcpm"}
    result = await kv_synthesis_node(state, _FakeRuntime(backend))
    assert result["error"] is not None
    assert "voxcpm" in result["error"].lower() or "VOXCPM" in result["error"]
    assert result["current_stage"] == "synthesis"
    assert backend.calls == []


# ---------------------------------------------------------------------------
# Failure semantics: any per-segment failure sets error to halt scaffold
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_any_segment_failure_sets_error(monkeypatch):
    _patch_writer(monkeypatch)

    class _Flaky(_FakeBackend):
        async def synthesize_segment(self, pid, cid, sid, params=None):
            if sid == "s1":
                raise RuntimeError("tts boom")
            await super().synthesize_segment(pid, cid, sid, params=params)

    backend = _Flaky()
    state = {"project_id": "p1", "structured_segments": STRUCTURED}
    result = await kv_synthesis_node(state, _FakeRuntime(backend))
    # 已成功的段仍保留在 results 里，方便后续 resume
    assert len(result["synthesis_results"]) == 1
    assert result["synthesis_results"][0]["segment_id"] == "s2"
    # 但存在失败 -> 设 error，阻止 scaffold_remotion
    assert result["error"] is not None
    assert "s1" in result["error"] or "失败" in result["error"]


@pytest.mark.asyncio
async def test_empty_structure_skips(monkeypatch):
    _patch_writer(monkeypatch)
    backend = _FakeBackend()
    result = await kv_synthesis_node(
        {"project_id": "p1", "structured_segments": []}, _FakeRuntime(backend)
    )
    assert backend.calls == []
    assert result["current_stage"] == "scaffold_remotion"
    assert result["error"] is None
