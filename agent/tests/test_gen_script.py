"""Tests for the gen_script node."""
import pytest

from app.nodes.gen_script import gen_script_node, parse_markdown_chapters


def test_parse_markdown_chapters_splits_on_headings():
    md = "# Chapter One\ncontent one\n# Chapter Two\ncontent two"
    chapters = parse_markdown_chapters(md)
    assert len(chapters) == 2
    assert chapters[0]["title"] == "Chapter One"
    assert chapters[0]["content"] == "content one"


def test_parse_markdown_chapters_splits_on_plain_text_markers():
    # gen_script 写作规则把 markdown 标题转成纯文本【章节：...】标记，
    # 解析器必须同样能切分（旁白落库的章节匹配依赖它）。
    script = "开场白。\n【章节：Stream】\n内容一\n【章节：Event Stream】\n内容二"
    chapters = parse_markdown_chapters(script)
    assert [(c["title"], c["content"]) for c in chapters] == [
        ("Stream", "内容一"),
        ("Event Stream", "内容二"),
    ]


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
    usage = {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}

    async def fake_stream(messages, **kw):
        return "hello world", usage

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
    stage_complete = next(e for e in emitted if e["type"] == "stage_complete")
    assert stage_complete["data"]["usage"] == usage


@pytest.mark.asyncio
async def test_gen_script_node_empty_script_is_soft_error(monkeypatch):
    async def fake_stream(messages, **kw):
        return "   ", None

    monkeypatch.setattr("app.nodes.gen_script.stream_llm", fake_stream)
    monkeypatch.setattr("app.nodes.gen_script.get_stream_writer", lambda: _make_writer([]))

    state = {"project_id": "p1", "current_stage": "gen_script"}
    result = await gen_script_node(state, _FakeRuntime(_FakeStore(), _FakeBackend("src")))
    assert result["error"] is not None
    assert result["current_stage"] == "script_review"


@pytest.mark.asyncio
async def test_gen_script_node_backend_failure_is_soft_error(monkeypatch):
    async def fake_stream(messages, **kw):
        return "should not reach", None

    monkeypatch.setattr("app.nodes.gen_script.stream_llm", fake_stream)
    monkeypatch.setattr("app.nodes.gen_script.get_stream_writer", lambda: _make_writer([]))

    class _BadBackend:
        async def get_project(self, project_id):
            raise RuntimeError("backend down")

    state = {"project_id": "p1", "current_stage": "gen_script"}
    result = await gen_script_node(state, _FakeRuntime(_FakeStore(), _BadBackend()))
    assert result["error"] is not None
    assert "源文档" in result["error"] or "backend" in result["error"].lower()
