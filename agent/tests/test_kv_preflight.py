"""Tests for the kv preflight_check node."""
import pytest

from app.nodes.knowledge_video.preflight import preflight_check_node


class _FakeBackend:
    def __init__(self, project):
        self._project = project

    async def get_project(self, pid):
        return self._project


class _FakeRuntime:
    def __init__(self, backend):
        self.store = None
        self.backend = backend


def _patch_common(monkeypatch, decision=None):
    monkeypatch.setattr(
        "app.nodes.knowledge_video.preflight.get_stream_writer", lambda: (lambda p: None)
    )
    if decision is not None:
        monkeypatch.setattr(
            "app.nodes.knowledge_video.preflight.interrupt", lambda payload: decision
        )


EMPTY_PROJECT = {"source_document": "# 标题\n内容", "chapters": []}

EXISTING_PROJECT = {
    "source_document": "# 标题\n内容",
    "chapters": [
        {
            "id": "c1",
            "segments": [
                {"id": "s1", "audio": {"current": {"path": "a/b.mp3"}}, "animation_spec": {"x": 1}},
                {"id": "s2", "audio": {}},
            ],
        }
    ],
}


@pytest.mark.asyncio
async def test_empty_project_proceeds_without_interrupt(monkeypatch):
    _patch_common(monkeypatch)
    result = await preflight_check_node(
        {"project_id": "p1"}, _FakeRuntime(_FakeBackend(EMPTY_PROJECT))
    )
    assert result["current_stage"] == "gen_narration"
    assert result["source_document"] == "# 标题\n内容"
    assert result["error"] is None


@pytest.mark.asyncio
async def test_existing_content_confirm_continues(monkeypatch):
    _patch_common(monkeypatch, decision={"action": "confirm"})
    result = await preflight_check_node(
        {"project_id": "p1"}, _FakeRuntime(_FakeBackend(EXISTING_PROJECT))
    )
    assert result["current_stage"] == "gen_narration"
    assert result["error"] is None


@pytest.mark.asyncio
async def test_existing_content_cancel_stops(monkeypatch):
    _patch_common(monkeypatch, decision={"action": "cancel"})
    result = await preflight_check_node(
        {"project_id": "p1"}, _FakeRuntime(_FakeBackend(EXISTING_PROJECT))
    )
    assert result["error"] is not None
    assert result["current_stage"] == "preflight_check"


@pytest.mark.asyncio
async def test_missing_source_document_errors(monkeypatch):
    _patch_common(monkeypatch)
    project = {"source_document": "", "chapters": []}
    result = await preflight_check_node(
        {"project_id": "p1"}, _FakeRuntime(_FakeBackend(project))
    )
    assert "源文档" in result["error"]


@pytest.mark.asyncio
async def test_interrupt_payload_contains_stats(monkeypatch):
    seen = {}

    def fake_interrupt(payload):
        seen["payload"] = payload
        return {"action": "cancel"}

    _patch_common(monkeypatch)
    monkeypatch.setattr("app.nodes.knowledge_video.preflight.interrupt", fake_interrupt)
    await preflight_check_node({"project_id": "p1"}, _FakeRuntime(_FakeBackend(EXISTING_PROJECT)))
    payload = seen["payload"]
    assert payload["kind"] == "confirm_overwrite"
    assert payload["available_actions"] == ["confirm", "cancel"]
    assert payload["stats"]["chapters"] == 1
    assert payload["stats"]["segments"] == 2
    assert payload["stats"]["synthesized_segments"] == 1
    assert "has_animation_brief" not in payload["stats"]
