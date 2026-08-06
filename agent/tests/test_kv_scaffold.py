"""Tests for the kv scaffold_remotion node.

After the global-setting refactor, the node no longer reads
``ANIMATION_ROOT_FOLDER`` env and no longer resolves the target dir itself:
it only forwards a per-run ``state["target_dir"]`` override when present, and
otherwise lets the backend resolve (global DB setting > per-project path).
``safe_project_dirname`` moved to the backend service.
"""
import httpx
import pytest

from app.nodes.knowledge_video.scaffold_remotion import scaffold_remotion_node
from app.schemas import ScaffoldRemotionResponse


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
        if isinstance(self._result, dict):
            return ScaffoldRemotionResponse.model_validate(self._result)
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


def _http_status_error(status: int, detail: str) -> httpx.HTTPStatusError:
    request = httpx.Request(
        "POST", "http://x/api/segmented-projects/p1/scaffold-remotion"
    )
    response = httpx.Response(
        status_code=status, request=request, json={"detail": detail}
    )
    return httpx.HTTPStatusError("error", request=request, response=response)


@pytest.mark.asyncio
async def test_passes_target_dir_when_state_has_it(monkeypatch):
    _patch_writer(monkeypatch)
    backend = _FakeBackend(
        result={"project_dir": "/explicit/dir", "created": False, "chapters": 1},
    )
    state = {"project_id": "p1", "target_dir": "/explicit/dir"}
    result = await scaffold_remotion_node(state, _FakeRuntime(backend))

    assert backend.calls[0]["target_dir"] == "/explicit/dir"
    assert result["remotion_project_dir"] == "/explicit/dir"
    assert result["current_stage"] == "completed"
    assert result["error"] is None


@pytest.mark.asyncio
async def test_omits_target_dir_when_state_absent(monkeypatch):
    """No per-run override -> backend resolves (global setting / project path)."""
    _patch_writer(monkeypatch)
    backend = _FakeBackend(
        result={"project_dir": "/resolved/by/backend", "created": True, "chapters": 2},
    )
    state = {"project_id": "p1"}
    result = await scaffold_remotion_node(state, _FakeRuntime(backend))

    assert backend.calls[0]["target_dir"] is None
    assert result["remotion_project_dir"] == "/resolved/by/backend"
    assert result["current_stage"] == "completed"


@pytest.mark.asyncio
async def test_no_env_reading_anymore(monkeypatch):
    """ANIMATION_ROOT_FOLDER env must not be read; node works without it."""
    _patch_writer(monkeypatch)
    monkeypatch.delenv("ANIMATION_ROOT_FOLDER", raising=False)
    backend = _FakeBackend(
        result={"project_dir": "/x", "created": True, "chapters": 0},
    )
    result = await scaffold_remotion_node({"project_id": "p1"}, _FakeRuntime(backend))
    assert result["error"] is None
    assert result["current_stage"] == "completed"


@pytest.mark.asyncio
async def test_animation_root_not_configured_emits_guidance(monkeypatch):
    _patch_writer(monkeypatch)
    backend = _FakeBackend(exc=_http_status_error(422, "animation_root_not_configured"))
    result = await scaffold_remotion_node({"project_id": "p1"}, _FakeRuntime(backend))

    assert result["current_stage"] == "scaffold_remotion"
    assert "设置页" in result["error"]
    assert "ANIMATION_ROOT_FOLDER" not in result["error"]


@pytest.mark.asyncio
async def test_backend_failure_sets_error(monkeypatch):
    _patch_writer(monkeypatch)
    backend = _FakeBackend(exc=RuntimeError("npx_not_found"))
    result = await scaffold_remotion_node(
        {"project_id": "p1"}, _FakeRuntime(backend)
    )
    assert "npx_not_found" in result["error"]
    assert result["current_stage"] == "scaffold_remotion"


@pytest.mark.asyncio
async def test_never_sends_animation_brief(monkeypatch):
    _patch_writer(monkeypatch)
    backend = _FakeBackend(
        result={"project_dir": "/proj", "created": False, "chapters": 0},
    )
    await scaffold_remotion_node({"project_id": "p1"}, _FakeRuntime(backend))
    assert backend.calls[0]["animation_brief"] is None
