"""PreflightCheck node (knowledge_video): confirm before overwriting content.

Fetches the project; if it already has chapters / synthesized audio /
animation briefs, interrupts with stats so the user can confirm the rebuild
or cancel without side effects.
"""
from __future__ import annotations

from langgraph.config import get_stream_writer
from langgraph.types import interrupt

from app import backend_client


async def preflight_check_node(state, runtime) -> dict:
    project_id = state["project_id"]
    writer = get_stream_writer()

    backend = getattr(runtime, "backend", None) or backend_client.BackendClient()
    try:
        project = await backend.get_project(project_id)
    except Exception as exc:
        writer({"type": "error", "stage": "preflight_check", "message": f"获取项目失败: {exc}"})
        return {"error": f"获取项目失败: {exc}", "current_stage": "preflight_check"}

    source_document = project.get("source_document") or ""
    if not source_document.strip():
        writer({"type": "error", "stage": "preflight_check", "message": "项目没有源文档"})
        return {
            "error": "项目没有源文档，请先在文本库添加源文档",
            "current_stage": "preflight_check",
        }

    chapters = project.get("chapters") or []
    total_segments = 0
    synthesized = 0
    has_brief = False
    for ch in chapters:
        for seg in ch.get("segments") or []:
            total_segments += 1
            audio = seg.get("audio") or {}
            if isinstance(audio, dict) and (audio.get("current") or {}).get("path"):
                synthesized += 1
            if seg.get("animation_spec"):
                has_brief = True

    if not chapters:
        writer(
            {"type": "stage_complete", "stage": "preflight_check", "message": "项目无已有内容，直接开始"}
        )
        return {
            "source_document": source_document,
            "current_stage": "gen_narration",
            "error": None,
        }

    stats = {
        "chapters": len(chapters),
        "segments": total_segments,
        "synthesized_segments": synthesized,
        "has_animation_brief": has_brief,
    }
    writer(
        {
            "type": "interrupt",
            "stage": "preflight_check",
            "message": f"项目已有 {stats['chapters']} 章节 / {synthesized} 段已合成音频，等待确认...",
            "data": stats,
        }
    )
    decision = interrupt(
        {
            "kind": "confirm_overwrite",
            "stats": stats,
            "available_actions": ["confirm", "cancel"],
        }
    )

    if decision.get("action") == "confirm":
        return {
            "source_document": source_document,
            "current_stage": "gen_narration",
            "error": None,
        }
    return {"error": "用户取消：保留已有内容", "current_stage": "preflight_check"}
