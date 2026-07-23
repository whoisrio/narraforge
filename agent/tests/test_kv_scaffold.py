"""Tests for the kv scaffold_remotion node."""
import pytest

from app.nodes.knowledge_video.scaffold_remotion import (
    safe_project_dirname,
    scaffold_remotion_node,
)


class _FakeBackend:
    def __init__(self, result=None, exc=None, project=None):
        self._result = result
        self._exc = exc
        self._project = project or {"name": "示例项目"}
        self.calls = []
        self.project_calls = []

    async def get_project(self, pid):
        self.project_calls.append(pid)
        return self._project

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


# ---------------------------------------------------------------------------
# safe_project_dirname
# ---------------------------------------------------------------------------


def test_safe_project_dirname_replaces_illegal_chars():
    assert safe_project_dirname("hello/world") == "hello_world"
    assert safe_project_dirname("a:b*c?d\"e<f>g|h\\i") == "a_b_c_d_e_f_g_h_i"


def test_safe_project_dirname_keeps_chinese_and_spaces_collapsed():
    assert safe_project_dirname("知识 视频 项目") == "知识_视频_项目"


def test_safe_project_dirname_falls_back_when_empty():
    assert safe_project_dirname("") == "project"
    assert safe_project_dirname("   ") == "project"
    assert safe_project_dirname("///") == "project"


# ---------------------------------------------------------------------------
# scaffold_remotion_node
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_uses_animation_root_folder_and_project_name(monkeypatch, tmp_path):
    _patch_writer(monkeypatch)
    monkeypatch.setenv("ANIMATION_ROOT_FOLDER", str(tmp_path))
    backend = _FakeBackend(
        result={"project_dir": str(tmp_path / "示例项目"), "created": True, "chapters": 2},
        project={"name": "示例项目"},
    )
    state = {"project_id": "p1"}
    result = await scaffold_remotion_node(state, _FakeRuntime(backend))

    assert backend.calls[0]["target_dir"] == str(tmp_path / "示例项目")
    # 不再传 animation_brief
    assert backend.calls[0]["animation_brief"] is None
    assert result["remotion_project_dir"] == str(tmp_path / "示例项目")
    assert result["current_stage"] == "completed"
    assert result["error"] is None


@pytest.mark.asyncio
async def test_state_target_dir_overrides_env(monkeypatch, tmp_path):
    """显式传 target_dir 时优先级最高（例如用户在 UI 手动指定）。"""
    _patch_writer(monkeypatch)
    monkeypatch.setenv("ANIMATION_ROOT_FOLDER", str(tmp_path))
    backend = _FakeBackend(
        result={"project_dir": "/explicit/dir", "created": False, "chapters": 1},
    )
    state = {"project_id": "p1", "target_dir": "/explicit/dir"}
    result = await scaffold_remotion_node(state, _FakeRuntime(backend))
    assert backend.calls[0]["target_dir"] == "/explicit/dir"
    assert result["current_stage"] == "completed"


@pytest.mark.asyncio
async def test_missing_env_halts_with_error(monkeypatch):
    _patch_writer(monkeypatch)
    monkeypatch.delenv("ANIMATION_ROOT_FOLDER", raising=False)
    backend = _FakeBackend()
    state = {"project_id": "p1"}
    result = await scaffold_remotion_node(state, _FakeRuntime(backend))
    assert "ANIMATION_ROOT_FOLDER" in result["error"]
    assert result["current_stage"] == "scaffold_remotion"
    assert backend.calls == []


@pytest.mark.asyncio
async def test_backend_failure_sets_error(monkeypatch, tmp_path):
    _patch_writer(monkeypatch)
    monkeypatch.setenv("ANIMATION_ROOT_FOLDER", str(tmp_path))
    backend = _FakeBackend(exc=RuntimeError("npx_not_found"))
    result = await scaffold_remotion_node(
        {"project_id": "p1"}, _FakeRuntime(backend)
    )
    assert "npx_not_found" in result["error"]
    assert result["current_stage"] == "scaffold_remotion"


@pytest.mark.asyncio
async def test_never_sends_animation_brief(monkeypatch, tmp_path):
    """新契约：scaffold_remotion 不再传 animation_brief。"""
    _patch_writer(monkeypatch)
    monkeypatch.setenv("ANIMATION_ROOT_FOLDER", str(tmp_path))
    backend = _FakeBackend(
        result={"project_dir": str(tmp_path / "proj"), "created": False, "chapters": 0},
        project={"name": "proj"},
    )
    await scaffold_remotion_node({"project_id": "p1"}, _FakeRuntime(backend))
    assert backend.calls[0]["animation_brief"] is None
