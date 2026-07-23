"""QualityReview node (knowledge_video): auto check + always-interrupt gate.

The LLM checks markdown residue / fidelity / chapter split / readability,
then the node ALWAYS interrupts for human confirmation of the narration
script (the review result rides along in the payload). Reject loops back to
gen_narration with the issues as feedback.
"""
from __future__ import annotations

from langgraph.config import get_stream_writer
from langgraph.types import interrupt

from app.llm import structured_llm
from app.nodes.util import with_usage
from app.prompts import knowledge_video
from app.schemas import QualityReviewResult


async def quality_review_node(state, runtime) -> dict:
    writer = get_stream_writer()

    async def emit(p):
        writer(p)

    await emit(
        {"type": "stage_start", "stage": "quality_review", "message": "开始基础质量审查..."}
    )

    review, usage = await structured_llm(
        QualityReviewResult,
        [
            {"role": "system", "content": knowledge_video.get_prompt("kv_quality_review")},
            {
                "role": "user",
                "content": (
                    f"原始文档：\n\n{state['source_document']}\n\n---\n\n"
                    f"请审查以下旁白稿：\n\n{state['narration_script']}"
                ),
            },
        ],
    )

    status_msg = "审查通过" if review.passed else f"审查发现 {len(review.issues)} 个问题"
    await emit(
        {
            "type": "interrupt",
            "stage": "quality_review",
            "message": f"{status_msg}，等待人工确认旁白稿...",
            "data": {"review": review.model_dump(), "usage": usage},
        }
    )

    decision = interrupt(
        {
            "script": state["narration_script"],
            "review": review.model_dump(),
            "available_actions": ["approve", "reject"],
        }
    )

    if decision.get("action") == "approve":
        return with_usage(
            "quality_review",
            usage,
            {
                "edited_script": decision.get("edited_script", state["narration_script"]),
                "review_result": review.model_dump(),
                "review_status": "approved",
                "current_stage": "split_chapters",
                "error": None,
            },
        )

    dumped = review.model_dump()
    feedback = decision.get("feedback", "")
    if feedback:
        dumped["issues"] = (dumped.get("issues") or []) + [feedback]
    return with_usage(
        "quality_review",
        usage,
        {
            "review_result": dumped,
            "review_status": "rejected",
            "current_stage": "gen_narration",
            "review_retry_count": state.get("review_retry_count", 0) + 1,
            "error": None,
        },
    )
