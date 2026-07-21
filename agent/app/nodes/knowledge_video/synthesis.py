"""Synthesis node (knowledge_video): edge-tts default voice per segment.

The kv workflow always uses the default edge-tts voice for now; a
project-level default voice setting is a later iteration (see spec §10).
"""
from __future__ import annotations

from langgraph.config import get_stream_writer

from app import backend_client

DEFAULT_EDGE_VOICE = "zh-CN-XiaoxiaoNeural"


async def kv_synthesis_node(state, runtime) -> dict:
    project_id = state["project_id"]
    structured = state.get("structured_segments", [])
    writer = get_stream_writer()

    async def emit(p):
        writer(p)

    if not structured:
        await emit(
            {
                "type": "stage_complete",
                "stage": "synthesis",
                "message": "无段落数据，跳过语音合成",
            }
        )
        return {"synthesis_results": [], "current_stage": "scaffold_remotion", "error": None}

    total = sum(len(ch.get("segments", [])) for ch in structured)
    await emit(
        {
            "type": "stage_start",
            "stage": "synthesis",
            "message": f"开始语音合成 (edge-tts {DEFAULT_EDGE_VOICE}): {total} 段落...",
        }
    )

    backend = getattr(runtime, "backend", None) or backend_client.BackendClient()
    params = {"engine": "edge_tts", "edge_voice": DEFAULT_EDGE_VOICE}
    results = []
    done = 0
    for ch in structured:
        cid = ch.get("_chapter_id")
        if not cid:
            continue
        for seg in ch.get("segments", []):
            sid = seg.get("_segment_id")
            if not sid:
                continue
            try:
                await backend.synthesize_segment(project_id, cid, sid, params=params)
                results.append(
                    {
                        "chapter_id": cid,
                        "segment_id": sid,
                        "audio_path": None,
                        "duration_sec": None,
                    }
                )
            except Exception as exc:
                await emit(
                    {
                        "type": "error",
                        "stage": "synthesis",
                        "message": f"段落 {sid} 合成失败: {exc}",
                    }
                )
            done += 1
            await emit(
                {
                    "type": "progress",
                    "stage": "synthesis",
                    "message": f"语音合成进度: {done}/{total}",
                    "data": {"completed": done, "total": total},
                }
            )

    await emit(
        {
            "type": "stage_complete",
            "stage": "synthesis",
            "message": f"语音合成完成: {len(results)} 段落",
            "data": {"total_segments": len(results)},
        }
    )
    return {
        "synthesis_results": results,
        "current_stage": "scaffold_remotion",
        "error": None,
    }
