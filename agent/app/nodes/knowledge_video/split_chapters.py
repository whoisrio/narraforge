"""SplitChapters node (knowledge_video): split confirmed script, persist.

Mirrors narration's split_segment node but uses the kv prompt (all segments
are plain narration) and no director-preference lookup.
"""
from __future__ import annotations

from langgraph.config import get_stream_writer

from app import backend_client
from app.llm import structured_llm
from app.nodes.split_segment import engine_tag_policy, match_chapter_narrations
from app.nodes.util import with_usage
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
    tts_engine = state.get("tts_engine") or "mimo_tts"
    await emit(
        {
            "type": "llm_call",
            "stage": "split_chapters",
            "message": f"正在调用 LLM 拆分段落 (脚本长度: {len(script)} 字, 引擎: {tts_engine})...",
        }
    )

    structure, usage = await structured_llm(
        SegmentChapters,
        [
            {"role": "system", "content": knowledge_video.get_prompt("kv_split_chapters")},
            {
                "role": "user",
                "content": (
                    f"请将以下旁白稿拆分为结构化段落：\n\n{script}"
                    f"\n\n{engine_tag_policy(tts_engine)}"
                ),
            },
        ],
    )

    backend = getattr(runtime, "backend", None) or backend_client.BackendClient()
    try:
        ids = await backend.batch_create_structure(
            project_id,
            structure,
            narration_scripts=match_chapter_narrations(script, structure),
            engine=tts_engine,
            full_script=script,
        )
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
        {
            "type": "stage_complete",
            "stage": "split_chapters",
            "message": "章节拆分阶段完成",
            "data": {"usage": usage},
        }
    )

    return with_usage(
        "split_chapters",
        usage,
        {"structured_segments": structured, "current_stage": "synthesis", "error": None},
    )
