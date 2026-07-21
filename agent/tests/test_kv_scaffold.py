"""Tests for the kv scaffold_remotion node."""
import pytest

from app.nodes.knowledge_video.scaffold_remotion import scaffold_remotion_node


class _FakeBackend:
    def __init__(self, result=None, exc=None):
        self._result = result
        self._exc = exc
        self.calls = []

    async def scaffold_remotion(self, pid, target_dir=None, animation_brief=None):
        self.calls.append(
            {"pid": pid, "target_dir": target_dir, "animation_brief": animation_brief}
        )
        if self._exc:
            raise self._exc
        return self._result


class _FakeRuntime:
    def __init__(self, backend):
        self.store = None
        self.backend = backend


def _patch_writer(monkeypatch):
    monkeypatch.setattr(
        "app.nodes.knowledge_video.scaffold_remotion.get_stream_writer",
        lambda: (lambda p: None),
    )


@pytest.mark.asyncio
async def test_scaffold_success(monkeypatch):
    _patch_writer(monkeypatch)
    backend = _FakeBackend(result={"project_dir": "/tmp/rv", "created": True, "chapters": 2})
    state = {"project_id": "p1", "target_dir": "/tmp/rv"}
    result = await scaffold_remotion_node(state, _FakeRuntime(backend))

    assert backend.calls[0]["target_dir"] == "/tmp/rv"
    assert backend.calls[0]["animation_brief"] is None
    assert result["remotion_project_dir"] == "/tmp/rv"
    assert result["current_stage"] == "gen_animation_brief"
    assert result["error"] is None


@pytest.mark.asyncio
async def test_scaffold_failure_sets_error(monkeypatch):
    _patch_writer(monkeypatch)
    backend = _FakeBackend(exc=RuntimeError("npx_not_found"))
    result = await scaffold_remotion_node(
        {"project_id": "p1"}, _FakeRuntime(backend)
    )
    assert "npx_not_found" in result["error"]
    assert result["current_stage"] == "scaffold_remotion"
