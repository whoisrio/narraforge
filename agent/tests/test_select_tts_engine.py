"""Tests for the select_tts_engine node."""
import pytest

from app.nodes.select_tts_engine import (
    AVAILABLE_ENGINES,
    DEFAULT_ENGINE,
    make_select_tts_engine_node,
)


class _FakeRuntime:
    def __init__(self, backend):
        self.store = None
        self.backend = backend


class _FakeBackend:
    def __init__(self, project):
        self._project = project

    async def get_project(self, pid):
        return self._project


class _BadBackend:
    async def get_project(self, pid):
        raise RuntimeError("backend down")


def _patch(monkeypatch, resume_value, captured=None):
    def fake_interrupt(payload):
        if captured is not None:
            captured["payload"] = payload
        return resume_value

    monkeypatch.setattr("app.nodes.select_tts_engine.interrupt", fake_interrupt)
    monkeypatch.setattr(
        "app.nodes.select_tts_engine.get_stream_writer", lambda: (lambda p: None)
    )


@pytest.mark.asyncio
async def test_default_engine_from_first_chapter_voice(monkeypatch):
    node = make_select_tts_engine_node("split_segment")
    captured = {}
    _patch(monkeypatch, {"engine": "voxcpm"}, captured)
    backend = _FakeBackend({"chapters": [{"voice": {"engine": "edge_tts"}}]})

    result = await node({"project_id": "p1"}, _FakeRuntime(backend))

    assert captured["payload"]["default_engine"] == "edge_tts"
    assert result["tts_engine"] == "voxcpm"
    assert result["current_stage"] == "split_segment"
    assert result["error"] is None


@pytest.mark.asyncio
async def test_default_engine_falls_back_when_get_project_fails(monkeypatch):
    node = make_select_tts_engine_node("split_segment")
    captured = {}
    _patch(monkeypatch, {"engine": "mimo_tts"}, captured)

    await node({"project_id": "p1"}, _FakeRuntime(_BadBackend()))

    assert captured["payload"]["default_engine"] == DEFAULT_ENGINE


@pytest.mark.asyncio
async def test_default_engine_falls_back_without_chapters(monkeypatch):
    node = make_select_tts_engine_node("split_segment")
    captured = {}
    _patch(monkeypatch, {"engine": "mimo_tts"}, captured)

    await node({"project_id": "p1"}, _FakeRuntime(_FakeBackend({"chapters": []})))

    assert captured["payload"]["default_engine"] == DEFAULT_ENGINE


@pytest.mark.asyncio
async def test_interrupt_payload_shape(monkeypatch):
    node = make_select_tts_engine_node("split_chapters")
    captured = {}
    _patch(monkeypatch, {"engine": "edge_tts"}, captured)

    result = await node({"project_id": "p1"}, _FakeRuntime(_FakeBackend({})))

    payload = captured["payload"]
    assert payload["kind"] == "select_tts_engine"
    assert payload["available_engines"] == AVAILABLE_ENGINES
    assert payload["default_engine"] == DEFAULT_ENGINE
    assert payload["timeout_s"] == 120
    assert result["current_stage"] == "split_chapters"


@pytest.mark.asyncio
async def test_resume_with_invalid_engine_falls_back_to_default(monkeypatch):
    node = make_select_tts_engine_node("split_segment")
    _patch(monkeypatch, {"engine": "not_an_engine"})
    backend = _FakeBackend({"chapters": [{"voice": {"engine": "cosyvoice"}}]})

    result = await node({"project_id": "p1"}, _FakeRuntime(backend))

    assert result["tts_engine"] == "cosyvoice"


@pytest.mark.asyncio
async def test_resume_with_empty_value_falls_back_to_default(monkeypatch):
    node = make_select_tts_engine_node("split_segment")
    _patch(monkeypatch, {})

    result = await node({"project_id": "p1"}, _FakeRuntime(_BadBackend()))

    assert result["tts_engine"] == DEFAULT_ENGINE


@pytest.mark.asyncio
async def test_resume_with_none_falls_back_to_default(monkeypatch):
    node = make_select_tts_engine_node("split_segment")
    _patch(monkeypatch, None)

    result = await node({"project_id": "p1"}, _FakeRuntime(_BadBackend()))

    assert result["tts_engine"] == DEFAULT_ENGINE
