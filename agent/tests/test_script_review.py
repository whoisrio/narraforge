"""Tests for the script_review node."""
import pytest

from app.nodes.script_review import script_review_node
from app.schemas import ReviewDimension, ReviewResult


class _FakeStore:
    def __init__(self):
        self.put_calls = []

    async def aput(self, namespace, key, value):
        self.put_calls.append((namespace, key, value))

    async def asearch(self, namespace, *, query=None, limit=10):
        return []


class _FakeRuntime:
    def __init__(self, store):
        self.store = store
        self.backend = None


def _review(score=4, critical=False, fail=False):
    dims = [
        ReviewDimension(
            name="内容忠实度",
            status="fail" if fail else "pass",
            comment="ok",
        )
    ]
    return ReviewResult(
        dimensions=dims,
        overall_score=score,
        overall_comment="c",
        has_critical_issue=critical,
    )


def _patch_llm(monkeypatch, review):
    """Patch structured_llm to return (*review*, no usage)."""

    async def fake_structured(schema, messages, **kw):
        return review, None

    monkeypatch.setattr("app.nodes.script_review.structured_llm", fake_structured)
    monkeypatch.setattr("app.nodes.script_review.get_stream_writer", lambda: (lambda p: None))


@pytest.mark.asyncio
async def test_review_auto_reject_on_low_score(monkeypatch):
    """Score < 3 with retry_count < MAX -> auto reject, no interrupt."""
    _patch_llm(monkeypatch, _review(score=2))
    state = {
        "project_id": "p1",
        "narration_script": "s",
        "review_retry_count": 0,
        "current_stage": "script_review",
    }
    result = await script_review_node(state, _FakeRuntime(_FakeStore()))
    assert result["review_status"] == "rejected"
    assert result["current_stage"] == "gen_script"
    assert result["review_retry_count"] == 1


@pytest.mark.asyncio
async def test_review_interrupts_on_passing_score(monkeypatch):
    """Score >= 3 -> interrupt for human; approve advances to split_segment."""
    interrupted = {}

    def fake_interrupt(payload):
        interrupted["payload"] = payload
        return {"action": "approve", "edited_script": "edited", "comment": "good"}

    _patch_llm(monkeypatch, _review(score=4))
    monkeypatch.setattr("app.nodes.script_review.interrupt", fake_interrupt)

    state = {
        "project_id": "p1",
        "narration_script": "s",
        "review_retry_count": 0,
        "current_stage": "script_review",
    }
    result = await script_review_node(state, _FakeRuntime(_FakeStore()))
    assert result["review_status"] == "approved"
    assert result["edited_script"] == "edited"
    assert result["current_stage"] == "split_segment"
    assert "payload" in interrupted


@pytest.mark.asyncio
async def test_review_reject_loops_back_to_gen_script(monkeypatch):
    """Human reject -> review_status rejected, stage gen_script."""
    def fake_interrupt(payload):
        return {"action": "reject", "feedback": "fix the intro"}

    _patch_llm(monkeypatch, _review(score=4))
    monkeypatch.setattr("app.nodes.script_review.interrupt", fake_interrupt)

    state = {
        "project_id": "p1",
        "narration_script": "s",
        "review_retry_count": 0,
        "current_stage": "script_review",
    }
    result = await script_review_node(state, _FakeRuntime(_FakeStore()))
    assert result["review_status"] == "rejected"
    assert result["current_stage"] == "gen_script"


@pytest.mark.asyncio
async def test_review_forces_interrupt_after_max_auto_rejects(monkeypatch):
    """retry_count >= MAX_AUTO_REJECT -> even a failing score interrupts."""
    interrupted = {}

    def fake_interrupt(payload):
        interrupted["payload"] = payload
        return {"action": "approve"}

    _patch_llm(monkeypatch, _review(score=2, fail=True))
    monkeypatch.setattr("app.nodes.script_review.interrupt", fake_interrupt)

    state = {
        "project_id": "p1",
        "narration_script": "s",
        "review_retry_count": 3,  # at MAX
        "current_stage": "script_review",
    }
    result = await script_review_node(state, _FakeRuntime(_FakeStore()))
    assert "payload" in interrupted  # forced human review
    assert result["review_status"] == "approved"
