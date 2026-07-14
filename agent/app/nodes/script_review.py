"""ScriptReview node: LLM auto-review (instructor) + human-in-the-loop interrupt.

Auto-rejects (without interrupting) when the LLM score is low or a critical
issue is found, up to ``MAX_AUTO_REJECT`` times -- then forces a human review
to prevent an infinite loop. On a passing review, interrupts for the director's
decision (approve/reject). Director feedback is persisted to the LangGraph
store and mined for structured preferences.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from langgraph.config import get_stream_writer
from langgraph.types import interrupt

from app.llm import get_instructor_client
from app.prompts.narration import get_prompt
from app.schemas import Preference, ReviewResult

MAX_AUTO_REJECT = 3


async def _extract_preference(runtime, project_id: str, feedback: str) -> None:
    """Best-effort: extract a structured preference from feedback, store it.

    Never raises -- preference extraction is a background enhancement that
    must not block the main workflow.
    """
    if runtime.store is None or not feedback:
        return
    try:
        client, model = get_instructor_client()
        pref = await client.create(
            response_model=Preference,
            model=model,
            max_retries=1,
            messages=[
                {"role": "system", "content": "你是一个偏好提取器，从用户的反馈中提取具体的创作偏好。"},
                {"role": "user", "content": get_prompt("preference_extract", feedback=feedback)},
            ],
        )
        await runtime.store.aput(
            ("director_preference", "global"),
            key=str(uuid4()),
            value={
                "preference": pref.preference,
                "category": pref.category,
                "extracted_from": feedback[:100],
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )
    except Exception:
        pass


async def script_review_node(state, runtime) -> dict:
    """Review the narration script: LLM auto-review, then human approval gate."""
    project_id = state["project_id"]
    run_id = state.get("run_id", "")
    writer = get_stream_writer()

    async def emit(p):
        writer(p)

    await emit({"type": "stage_start", "stage": "script_review", "message": "开始脚本审查..."})
    await emit(
        {"type": "llm_call", "stage": "script_review", "message": "正在调用 LLM 进行脚本审查..."}
    )

    client, model = get_instructor_client()
    review: ReviewResult = await client.create(
        response_model=ReviewResult,
        model=model,
        max_retries=2,
        messages=[
            {"role": "system", "content": get_prompt("script_review")},
            {"role": "user", "content": f"请审查以下旁白脚本：\n\n{state['narration_script']}"},
        ],
    )

    # Persist the LLM review (best-effort).
    if runtime.store is not None:
        try:
            await runtime.store.aput(
                ("director_feedback", project_id),
                key=f"review_{run_id}",
                value={
                    "type": "llm_review",
                    "review": review.model_dump(),
                    "run_id": run_id,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                },
            )
        except Exception:
            pass

    retry_count = state.get("review_retry_count", 0)
    should_auto_reject = retry_count < MAX_AUTO_REJECT and (
        review.has_critical_issue
        or review.overall_score < 3
        or any(d.status == "fail" for d in review.dimensions)
    )
    if should_auto_reject:
        await emit(
            {
                "type": "auto_reject",
                "stage": "script_review",
                "message": f"LLM 审查未通过（评分 {review.overall_score}/5），自动重新生成...",
                "data": {"review": review.model_dump(), "retry": retry_count + 1},
            }
        )
        return {
            "review_feedback": review,
            "review_status": "rejected",
            "current_stage": "gen_script",
            "review_retry_count": retry_count + 1,
            "error": None,
        }

    dims_summary = [
        {"name": d.name, "status": d.status, "comment": d.comment[:100]} for d in review.dimensions
    ]
    await emit(
        {
            "type": "interrupt",
            "stage": "script_review",
            "message": f"脚本审查完成，评分: {review.overall_score}/5，等待导演审批...",
            "data": {
                "review": review.model_dump(),
                "dimensions_summary": dims_summary,
                "overall_comment": review.overall_comment,
                "has_critical_issue": review.has_critical_issue,
            },
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
        edited_script = decision.get("edited_script", state["narration_script"])
        if decision.get("comment") and runtime.store is not None:
            try:
                await runtime.store.aput(
                    ("director_feedback", project_id),
                    key=f"comment_{run_id}",
                    value={
                        "type": "director_comment",
                        "comment": decision["comment"],
                        "action": "approve",
                        "run_id": run_id,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    },
                )
            except Exception:
                pass
            await _extract_preference(runtime, project_id, decision["comment"])
        return {
            "edited_script": edited_script,
            "review_feedback": review,
            "review_status": "approved",
            "current_stage": "split_segment",
            "error": None,
        }

    # Reject path: persist feedback, extract preference, loop back to gen_script.
    feedback = decision.get("feedback", "")
    if runtime.store is not None:
        try:
            await runtime.store.aput(
                ("director_feedback", project_id),
                key=f"reject_{run_id}",
                value={
                    "type": "reject_feedback",
                    "feedback": feedback,
                    "run_id": run_id,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                },
            )
        except Exception:
            pass
    if feedback:
        await _extract_preference(runtime, project_id, feedback)
    return {
        "review_feedback": review,
        "review_status": "rejected",
        "current_stage": "gen_script",
        "error": None,
    }
