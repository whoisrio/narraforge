"""Tests for the kv gen_narration node."""
import pytest

from app.nodes.knowledge_video.gen_narration import gen_narration_node


class _FakeRuntime:
    store = None
    backend = None


def _patch(monkeypatch, script: str):
    monkeypatch.setattr(
        "app.nodes.knowledge_video.gen_narration.get_stream_writer", lambda: (lambda p: None)
    )

    async def fake_stream_llm(messages, on_chunk=None):
        return script

    monkeypatch.setattr("app.nodes.knowledge_video.gen_narration.stream_llm", fake_stream_llm)
    monkeypatch.setattr(
        "app.nodes.knowledge_video.gen_narration.knowledge_video.get_prompt",
        lambda name, **kw: "PROMPT",
    )


DOC = "# 第一章\n\n```\ncode here\n```\n\n![图](a.png)\n"
SCRIPT = "# 第一章\n\n转写后的旁白内容。\n"


@pytest.mark.asyncio
async def test_generates_script_and_source_map(monkeypatch):
    _patch(monkeypatch, SCRIPT)
    state = {"project_id": "p1", "source_document": DOC, "current_stage": "gen_narration"}
    result = await gen_narration_node(state, _FakeRuntime())

    assert result["narration_script"] == SCRIPT
    assert result["current_stage"] == "quality_review"
    assert result["error"] is None
    assert result["script_chapters"][0]["title"] == "第一章"
    kinds = {e["kind"] for e in result["source_structure_map"]}
    assert kinds == {"code", "image"}


@pytest.mark.asyncio
async def test_reject_feedback_is_included_in_prompt(monkeypatch):
    _patch(monkeypatch, SCRIPT)
    seen = {}

    async def fake_stream_llm(messages, on_chunk=None):
        seen["user"] = messages[1]["content"]
        return SCRIPT

    monkeypatch.setattr("app.nodes.knowledge_video.gen_narration.stream_llm", fake_stream_llm)
    state = {
        "project_id": "p1",
        "source_document": DOC,
        "review_status": "rejected",
        "review_result": {"passed": False, "dimensions": [], "issues": ["第二章缺失"]},
    }
    await gen_narration_node(state, _FakeRuntime())
    assert "第二章缺失" in seen["user"]


@pytest.mark.asyncio
async def test_empty_script_is_error(monkeypatch):
    _patch(monkeypatch, "  ")
    state = {"project_id": "p1", "source_document": DOC}
    result = await gen_narration_node(state, _FakeRuntime())
    assert result["error"] is not None
