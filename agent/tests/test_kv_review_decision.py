"""Tests for the kv review_decision node.

review_decision is the interrupt gate that consumes ``review_result`` from
state (produced by the preceding quality_review node) and routes on human
approve/reject. It must NOT call the LLM -- that's the whole point of splitting
it out from quality_review (otherwise resume replays the LLM call for nothing).
"""
import pytest

from app.nodes.knowledge_video.review_decision import review_decision_node


class _FakeRuntime:
    store = None
    backend = None


PASSED_REVIEW = {
    "passed": True,
    "dimensions": [{"name": "fidelity", "passed": True, "comment": "ok"}],
    "issues": [],
}
FAILED_REVIEW = {
    "passed": False,
    "dimensions": [{"name": "markdown_residue", "passed": False, "comment": "残留 ```"}],
    "issues": ["第二章残留代码围栏"],
}


def _patch(monkeypatch, decision):
    monkeypatch.setattr(
        "app.nodes.knowledge_video.review_decision.get_stream_writer",
        lambda: (lambda p: None),
    )
    monkeypatch.setattr(
        "app.nodes.knowledge_video.review_decision.interrupt", lambda payload: decision
    )


def _state(review, script="旁白稿", **extra):
    base = {
        "project_id": "p1",
        "source_document": "原文",
        "narration_script": script,
        "review_result": review,
        "current_stage": "review_decision",
    }
    base.update(extra)
    return base


@pytest.mark.asyncio
async def test_approve_routes_to_split_chapters(monkeypatch):
    _patch(monkeypatch, {"action": "approve"})
    result = await review_decision_node(_state(PASSED_REVIEW), _FakeRuntime())
    assert result["review_status"] == "approved"
    assert result["current_stage"] == "split_chapters"
    assert result["edited_script"] == "旁白稿"


@pytest.mark.asyncio
async def test_approve_uses_edited_script(monkeypatch):
    _patch(monkeypatch, {"action": "approve", "edited_script": "改过的稿子"})
    result = await review_decision_node(_state(PASSED_REVIEW), _FakeRuntime())
    assert result["edited_script"] == "改过的稿子"


@pytest.mark.asyncio
async def test_reject_loops_back_to_gen_narration_with_feedback(monkeypatch):
    _patch(monkeypatch, {"action": "reject", "feedback": "请去掉所有残留标记"})
    result = await review_decision_node(_state(FAILED_REVIEW), _FakeRuntime())
    assert result["review_status"] == "rejected"
    assert result["current_stage"] == "gen_narration"
    assert "请去掉所有残留标记" in result["review_result"]["issues"]
    assert result["review_retry_count"] == 1


@pytest.mark.asyncio
async def test_reject_without_feedback_still_loops_back(monkeypatch):
    _patch(monkeypatch, {"action": "reject"})
    result = await review_decision_node(_state(FAILED_REVIEW, review_retry_count=2), _FakeRuntime())
    assert result["review_status"] == "rejected"
    assert result["current_stage"] == "gen_narration"
    assert result["review_retry_count"] == 3
    # Existing issues preserved even without new feedback
    assert result["review_result"]["issues"] == FAILED_REVIEW["issues"]


@pytest.mark.asyncio
async def test_does_not_call_llm(monkeypatch):
    """The whole point of review_decision: no LLM call, so resume is cheap."""
    called = {"n": 0}

    async def boom(*a, **kw):  # pragma: no cover - must not be reached
        called["n"] += 1
        raise AssertionError("review_decision must not call structured_llm")

    # Even if structured_llm existed as an import target, it must never fire.
    # We assert this by importing the module and confirming it does not
    # reference structured_llm at all.
    import app.nodes.knowledge_video.review_decision as mod

    _patch(monkeypatch, {"action": "approve"})
    await review_decision_node(_state(PASSED_REVIEW), _FakeRuntime())
    assert "structured_llm" not in dir(mod), (
        "review_decision must not import structured_llm; keep it LLM-free"
    )
    assert called["n"] == 0


@pytest.mark.asyncio
async def test_interrupt_payload_shape(monkeypatch):
    seen = {}
    monkeypatch.setattr(
        "app.nodes.knowledge_video.review_decision.get_stream_writer",
        lambda: (lambda p: None),
    )
    monkeypatch.setattr(
        "app.nodes.knowledge_video.review_decision.interrupt",
        lambda payload: seen.setdefault("payload", payload) or {"action": "approve"},
    )
    await review_decision_node(_state(FAILED_REVIEW), _FakeRuntime())
    payload = seen["payload"]
    assert payload["script"] == "旁白稿"
    assert payload["review"] == FAILED_REVIEW
    assert payload["available_actions"] == ["approve", "reject"]
