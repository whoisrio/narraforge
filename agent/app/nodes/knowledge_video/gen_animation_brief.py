"""GenAnimationBrief node (knowledge_video): per-segment storyboard brief.

Builds the narration timeline from synthesized segment durations, asks the
LLM for a per-segment visual/animation brief (grounded in the source
document's code/image element map), then double-writes the result: per
segment into ``animation_spec_json`` (apply-animation-spec) and as
``animation_brief.json`` into the Remotion project (scaffold endpoint).
"""
from __future__ import annotations

from langgraph.config import get_stream_writer

from app import backend_client
from app.llm import get_instructor_client
from app.prompts import knowledge_video
from app.schemas import AnimationBrief


def _build_timeline(project: dict) -> list[dict]:
    """Flatten chapters into a timeline with per-segment start/end seconds.

    Durations come from ``segment.audio.current.duration_sec`` (0 when
    missing); the cursor accumulates across the whole project.
    """
    timeline: list[dict] = []
    cursor = 0.0
    for ch_pos, ch in enumerate(project.get("chapters") or []):
        ch_entry = {
            "chapter_position": ch_pos,
            "title": ch.get("name") or f"章节 {ch_pos + 1}",
            "segments": [],
        }
        for seg_pos, seg in enumerate(ch.get("segments") or []):
            audio = seg.get("audio") or {}
            duration = 0.0
            if isinstance(audio, dict):
                duration = float((audio.get("current") or {}).get("duration_sec") or 0.0)
            ch_entry["segments"].append(
                {
                    "id": seg.get("id"),
                    "position": seg_pos,
                    "text": seg.get("text") or "",
                    "start_sec": round(cursor, 3),
                    "end_sec": round(cursor + duration, 3),
                }
            )
            cursor += duration
        timeline.append(ch_entry)
    return timeline


async def gen_animation_brief_node(state, runtime) -> dict:
    project_id = state["project_id"]
    writer = get_stream_writer()

    async def emit(p):
        writer(p)

    await emit(
        {
            "type": "stage_start",
            "stage": "gen_animation_brief",
            "message": "开始生成动画分镜 brief...",
        }
    )

    backend = getattr(runtime, "backend", None) or backend_client.BackendClient()
    try:
        project = await backend.get_project(project_id)
    except Exception as exc:
        await emit(
            {"type": "error", "stage": "gen_animation_brief", "message": f"获取项目失败: {exc}"}
        )
        return {"error": f"获取项目失败: {exc}", "current_stage": "gen_animation_brief"}

    timeline = _build_timeline(project)
    source_elements = state.get("source_structure_map") or []

    await emit(
        {
            "type": "llm_call",
            "stage": "gen_animation_brief",
            "message": "正在调用 LLM 生成分镜 brief...",
        }
    )
    client, model = get_instructor_client()
    brief: AnimationBrief = await client.create(
        response_model=AnimationBrief,
        model=model,
        max_retries=2,
        messages=[
            {"role": "system", "content": knowledge_video.get_prompt("kv_animation_brief")},
            {
                "role": "user",
                "content": (
                    "以下是按时间轴排列的章节与旁白段落（含每段起止秒数），"
                    "以及原文档中的代码块/图片元素清单。请为每个段落生成动画分镜 brief。\n\n"
                    f"## 时间轴\n{timeline}\n\n## 原文特殊元素\n{source_elements}"
                ),
            },
        ],
    )

    # Attach timeline timestamps + segment ids onto each brief entry.
    brief_payload = brief.model_dump()
    items: list[dict] = []
    for ch in brief_payload["chapters"]:
        ch_pos = ch["chapter_position"]
        if ch_pos >= len(timeline):
            continue
        ch_tl = timeline[ch_pos]
        for seg_brief in ch["segments"]:
            seg_pos = seg_brief["segment_position"]
            if seg_pos >= len(ch_tl["segments"]):
                continue
            seg_tl = ch_tl["segments"][seg_pos]
            seg_brief["start_sec"] = seg_tl["start_sec"]
            seg_brief["end_sec"] = seg_tl["end_sec"]
            items.append(
                {
                    "segment_id": seg_tl["id"],
                    "chapter_position": ch_pos,
                    **seg_brief,
                }
            )

    try:
        await backend.apply_animation_spec(project_id, items)
        await backend.scaffold_remotion(project_id, animation_brief=brief_payload)
    except Exception as exc:
        await emit(
            {"type": "error", "stage": "gen_animation_brief", "message": f"brief 持久化失败: {exc}"}
        )
        return {"error": f"brief 持久化失败: {exc}", "current_stage": "gen_animation_brief"}

    total = sum(len(ch["segments"]) for ch in brief_payload["chapters"])
    await emit(
        {
            "type": "stage_complete",
            "stage": "gen_animation_brief",
            "message": f"分镜 brief 生成完成: {total} 段",
            "data": {"segments_count": total},
        }
    )
    return {
        "animation_brief": brief_payload,
        "current_stage": "completed",
        "error": None,
    }
