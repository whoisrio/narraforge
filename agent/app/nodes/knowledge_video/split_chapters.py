"""SplitChapters node (knowledge_video): split confirmed script, persist.

Mirrors narration's split_segment node but uses the kv prompt (all segments
are plain narration) and no director-preference lookup.
"""
from __future__ import annotations

from langgraph.config import get_stream_writer

from app import backend_client
from app.llm import get_instructor_client
from app.prompts import knowledge_video
from app.schemas import SegmentChapters


async def split_chapters_node(state, runtime) -> dict:
    project_id = state["project_id"]
    writer = get_stream_writer()

    async def emit(p):
        writer(p)

    await emit(
        {"type": "stage_start", "stage": "split_chapters", "message": "开始章节拆分..."}
    )

    script = state.get("edited_script") or state["narration_script"]
    await emit(
        {
            "type": "llm_call",
            "stage": "split_chapters",
            "message": f"正在调用 LLM 拆分段落 (脚本长度: {len(script)} 字)...",
        }
    )

    client, model = get_instructor_client()
    structure: SegmentChapters = await client.create(
        response_model=SegmentChapters,
        model=model,
        max_retries=2,
        messages=[
            {"role": "system", "content": knowledge_video.get_prompt("kv_split_chapters")},
            {"role": "user", "content": f"请将以下旁白稿拆分为结构化段落：\n\n{script}"},
        ],
    )

    backend = getattr(runtime, "backend", None) or backend_client.BackendClient()
    try:
        ids = await backend.batch_create_structure(project_id, structure)
    except Exception as exc:
        await emit({"type": "error", "stage": "split_chapters", "message": f"持久化失败: {exc}"})
        return {
            "structured_segments": [],
            "current_stage": "synthesis",
            "error": f"持久化失败: {exc}",
        }

    structured = []
    for ch, ch_ids in zip(structure.chapters, ids):
        ch_dict = ch.model_dump()
        ch_dict["_chapter_id"] = ch_ids.id
        for seg, seg_id in zip(ch_dict["segments"], ch_ids.segments):
            seg["_segment_id"] = seg_id.id
        structured.append(ch_dict)

    total = sum(len(ch["segments"]) for ch in structured)
    await emit(
        {
            "type": "llm_response",
            "stage": "split_chapters",
            "message": f"拆分完成: {len(structured)} 章节, {total} 段落",
            "data": {"chapters_count": len(structured), "segments_count": total},
        }
    )
    await emit(
        {"type": "stage_complete", "stage": "split_chapters", "message": "章节拆分阶段完成"}
    )

    return {"structured_segments": structured, "current_stage": "synthesis", "error": None}
