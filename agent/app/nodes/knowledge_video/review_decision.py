"""ReviewDecision node (knowledge_video): human-in-the-loop interrupt gate.

Consumes ``review_result`` produced by the preceding ``quality_review`` node,
interrupts for a director's approve/reject, and routes accordingly. It calls
NO LLM: keeping the interrupt in a dedicated LLM-free node means resume is
free — LangGraph replays the whole interrupting node on resume, so any LLM
call in the same node would re-execute pointlessly on every human action.

Approve  -> current_stage=split_chapters, review_status=approved,
             edited_script pulled from human payload (fallback: narration_script).
Reject   -> current_stage=gen_narration, review_status=rejected,
             review_result.issues appended with human feedback,
             review_retry_count incremented so the loop is bounded upstream.
"""
from __future__ import annotations

from langgraph.config import get_stream_writer
from langgraph.types import interrupt


async def review_decision_node(state, runtime) -> dict:
    writer = get_stream_writer()

    async def emit(p):
        writer(p)

    review = state.get("review_result") or {}
    status_msg = (
        "审查通过" if review.get("passed") else f"审查发现 {len(review.get('issues') or [])} 个问题"
    )
    await emit(
        {
            "type": "interrupt",
            "stage": "review_decision",
            "message": f"{status_msg}，等待人工确认旁白稿...",
            "data": {"review": review},
        }
    )

    decision = interrupt(
        {
            "script": state["narration_script"],
            "review": review,
            "available_actions": ["approve", "reject"],
        }
    )

    if decision.get("action") == "approve":
        return {
            "edited_script": decision.get("edited_script", state["narration_script"]),
            "review_status": "approved",
            "current_stage": "split_chapters",
            "error": None,
        }

    # Reject: preserve any existing issues, append the human feedback (if any),
    # and loop back to gen_narration so the next iteration sees them in state.
    updated_review = dict(review)
    updated_review["issues"] = list(updated_review.get("issues") or [])
    feedback = decision.get("feedback", "")
    if feedback:
        updated_review["issues"].append(feedback)
    return {
        "review_result": updated_review,
        "review_status": "rejected",
        "current_stage": "gen_narration",
        "review_retry_count": state.get("review_retry_count", 0) + 1,
        "error": None,
    }
