"""Tests for the kv quality_review node.

After the review_decision split, quality_review is LLM-only: it computes the
QualityReviewResult and writes it into state, then hands off to
review_decision. It must NOT call interrupt() -- otherwise resume replays the
LLM call for nothing.
"""
import pytest

from app.nodes.knowledge_video.quality_review import quality_review_node
from app.schemas import QualityReviewResult


class _FakeRuntime:
    store = None
    backend = None


PASS_REVIEW = QualityReviewResult(
    passed=True,
    dimensions=[{"name": "fidelity", "passed": True, "comment": "ok"}],
    issues=[],
)
FAIL_REVIEW = QualityReviewResult(
    passed=False,
    dimensions=[{"name": "markdown_residue", "passed": False, "comment": "残留 ```"}],
    issues=["第二章残留代码围栏"],
)


def _patch(monkeypatch, review):
    monkeypatch.setattr(
        "app.nodes.knowledge_video.quality_review.get_stream_writer", lambda: (lambda p: None)
    )

    async def fake_structured(schema, messages, **kw):
        return review, {"input_tokens": 5, "output_tokens": 7}

    monkeypatch.setattr(
        "app.nodes.knowledge_video.quality_review.structured_llm",
        fake_structured,
    )
    monkeypatch.setattr(
        "app.nodes.knowledge_video.quality_review.knowledge_video.get_prompt",
        lambda name, **kw: "PROMPT",
    )


STATE = {
    "project_id": "p1",
    "source_document": "原文",
    "narration_script": "旁白稿",
    "current_stage": "quality_review",
}


@pytest.mark.asyncio
async def test_writes_review_result_and_advances_to_decision(monkeypatch):
    _patch(monkeypatch, PASS_REVIEW)
    result = await quality_review_node(STATE, _FakeRuntime())
    assert result["review_result"] == PASS_REVIEW.model_dump()
    assert result["current_stage"] == "review_decision"


@pytest.mark.asyncio
async def test_failing_review_still_advances_to_decision(monkeypatch):
    """Even a failing LLM review must hand off to review_decision; the human
    (or the router) decides what to do -- quality_review does not interrupt."""
    _patch(monkeypatch, FAIL_REVIEW)
    result = await quality_review_node(STATE, _FakeRuntime())
    assert result["review_result"] == FAIL_REVIEW.model_dump()
    assert result["current_stage"] == "review_decision"


@pytest.mark.asyncio
async def test_records_stage_usage(monkeypatch):
    _patch(monkeypatch, PASS_REVIEW)
    result = await quality_review_node(STATE, _FakeRuntime())
    assert result["stage_usage"] == {"quality_review": {"input_tokens": 5, "output_tokens": 7}}


def test_module_does_not_call_interrupt():
    """Regression: quality_review must not import langgraph.interrupt.

    If it did, resume from a downstream interrupt would replay the LLM call.
    """
    import app.nodes.knowledge_video.quality_review as mod

    assert "interrupt" not in dir(mod), (
        "quality_review must NOT import interrupt; that belongs to review_decision"
    )
