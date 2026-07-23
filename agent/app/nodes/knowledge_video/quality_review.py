"""QualityReview node (knowledge_video): LLM auto-check only.

Runs the QualityReviewResult LLM check and writes it to state; the
subsequent ``review_decision`` node owns the human-in-the-loop interrupt.
Splitting the two keeps resume cheap: without this split, every human
approve/reject would replay the LLM call because LangGraph re-executes the
whole interrupting node on resume.
"""
from __future__ import annotations

from langgraph.config import get_stream_writer

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
            "type": "stage_complete",
            "stage": "quality_review",
            "message": f"{status_msg}，交由人工确认...",
            "data": {"review": review.model_dump(), "usage": usage},
        }
    )

    return with_usage(
        "quality_review",
        usage,
        {
            "review_result": review.model_dump(),
            "current_stage": "review_decision",
            "error": None,
        },
    )
