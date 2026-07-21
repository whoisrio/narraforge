"""Tests for the kv quality_review node."""
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


def _patch(monkeypatch, review, decision):
    monkeypatch.setattr(
        "app.nodes.knowledge_video.quality_review.get_stream_writer", lambda: (lambda p: None)
    )
    client = type("C", (), {})

    async def fake_create(**kw):
        return review

    client.create = fake_create
    monkeypatch.setattr(
        "app.nodes.knowledge_video.quality_review.get_instructor_client",
        lambda: (client, "m"),
    )
    monkeypatch.setattr(
        "app.nodes.knowledge_video.quality_review.knowledge_video.get_prompt",
        lambda name, **kw: "PROMPT",
    )
    monkeypatch.setattr(
        "app.nodes.knowledge_video.quality_review.interrupt", lambda payload: decision
    )


STATE = {
    "project_id": "p1",
    "source_document": "原文",
    "narration_script": "旁白稿",
    "current_stage": "quality_review",
}


@pytest.mark.asyncio
async def test_passing_review_still_interrupts_and_approve_goes_to_split(monkeypatch):
    """审查通过也必须人工确认。"""
    _patch(monkeypatch, PASS_REVIEW, {"action": "approve"})
    result = await quality_review_node(STATE, _FakeRuntime())
    assert result["review_status"] == "approved"
    assert result["current_stage"] == "split_chapters"
    assert result["edited_script"] == "旁白稿"


@pytest.mark.asyncio
async def test_approve_with_edited_script(monkeypatch):
    _patch(monkeypatch, PASS_REVIEW, {"action": "approve", "edited_script": "改过的稿子"})
    result = await quality_review_node(STATE, _FakeRuntime())
    assert result["edited_script"] == "改过的稿子"


@pytest.mark.asyncio
async def test_failed_review_reject_loops_back_with_feedback(monkeypatch):
    _patch(monkeypatch, FAIL_REVIEW, {"action": "reject", "feedback": "请去掉所有残留标记"})
    result = await quality_review_node(STATE, _FakeRuntime())
    assert result["review_status"] == "rejected"
    assert result["current_stage"] == "gen_narration"
    assert "请去掉所有残留标记" in result["review_result"]["issues"]
    assert result["review_retry_count"] == 1


@pytest.mark.asyncio
async def test_interrupt_payload_has_script_review_actions(monkeypatch):
    seen = {}
    _patch(monkeypatch, FAIL_REVIEW, {"action": "approve"})
    monkeypatch.setattr(
        "app.nodes.knowledge_video.quality_review.interrupt",
        lambda payload: seen.setdefault("payload", payload) or {"action": "approve"},
    )
    await quality_review_node(STATE, _FakeRuntime())
    payload = seen["payload"]
    assert payload["script"] == "旁白稿"
    assert payload["review"]["passed"] is False
    assert payload["available_actions"] == ["approve", "reject"]
