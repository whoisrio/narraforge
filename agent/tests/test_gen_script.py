"""Tests for the gen_script node."""
import pytest

from app.nodes.gen_script import gen_script_node, parse_markdown_chapters


def test_parse_markdown_chapters_splits_on_headings():
    md = "# Chapter One\ncontent one\n# Chapter Two\ncontent two"
    chapters = parse_markdown_chapters(md)
    assert len(chapters) == 2
    assert chapters[0]["title"] == "Chapter One"
    assert chapters[0]["content"] == "content one"


class _FakeStore:
    def __init__(self, items=None):
        self._items = items or []

    async def asearch(self, namespace, *, query=None, limit=10):
        return self._items


class _FakeBackend:
    def __init__(self, source_document="src text"):
        self._source = source_document

    async def get_project(self, project_id):
        return {"id": project_id, "source_document": self._source}


class _FakeRuntime:
    def __init__(self, store, backend):
        self.store = store
        self.backend = backend


def _make_writer(collector):
    def writer(payload):
        collector.append(payload)
    return writer


@pytest.mark.asyncio
async def test_gen_script_node_calls_llm_and_emits_milestones(monkeypatch):
    emitted = []

    async def fake_stream(messages, on_chunk=None, **kw):
        if on_chunk:
            await on_chunk("hello ")
            await on_chunk("world")
        return "hello world"

    monkeypatch.setattr("app.nodes.gen_script.stream_llm", fake_stream)
    monkeypatch.setattr("app.nodes.gen_script.get_stream_writer", lambda: _make_writer(emitted))

    state = {"project_id": "p1", "current_stage": "gen_script"}
    runtime = _FakeRuntime(_FakeStore(), _FakeBackend("src text"))

    result = await gen_script_node(state, runtime)

    assert result["narration_script"] == "hello world"
    assert result["current_stage"] == "script_review"
    assert result["error"] is None
    types = [e["type"] for e in emitted]
    assert "stage_start" in types
    assert "llm_call" in types
    assert "llm_response" in types
    assert "stage_complete" in types


@pytest.mark.asyncio
async def test_gen_script_node_empty_script_is_soft_error(monkeypatch):
    async def fake_stream(messages, on_chunk=None, **kw):
        return "   "

    monkeypatch.setattr("app.nodes.gen_script.stream_llm", fake_stream)
    monkeypatch.setattr("app.nodes.gen_script.get_stream_writer", lambda: _make_writer([]))

    state = {"project_id": "p1", "current_stage": "gen_script"}
    result = await gen_script_node(state, _FakeRuntime(_FakeStore(), _FakeBackend("src")))
    assert result["error"] is not None
    assert result["current_stage"] == "script_review"


@pytest.mark.asyncio
async def test_gen_script_node_backend_failure_is_soft_error(monkeypatch):
    async def fake_stream(messages, on_chunk=None, **kw):
        return "should not reach"

    monkeypatch.setattr("app.nodes.gen_script.stream_llm", fake_stream)
    monkeypatch.setattr("app.nodes.gen_script.get_stream_writer", lambda: _make_writer([]))

    class _BadBackend:
        async def get_project(self, project_id):
            raise RuntimeError("backend down")

    state = {"project_id": "p1", "current_stage": "gen_script"}
    result = await gen_script_node(state, _FakeRuntime(_FakeStore(), _BadBackend()))
    assert result["error"] is not None
    assert "源文档" in result["error"] or "backend" in result["error"].lower()
