"""Synthesis node: call the backend TTS endpoint for each segment.

Iterates over the structured segments produced by ``split_segment_node``,
calling the backend's per-segment synthesis endpoint. Emits progress events
(N/M) via ``get_stream_writer`` for the frontend's real-time progress bar.
"""
from __future__ import annotations

from langgraph.config import get_stream_writer

from app import backend_client


async def synthesis_node(state, runtime) -> dict:
    project_id = state["project_id"]
    structured = state.get("structured_segments", [])
    writer = get_stream_writer()

    async def emit(p):
        writer(p)

    if not structured:
        await emit(
            {"type": "stage_complete", "stage": "synthesis", "message": "无段落数据，跳过语音合成"}
        )
        return {"synthesis_results": [], "current_stage": "completed", "error": None}

    total = sum(len(ch.get("segments", [])) for ch in structured)
    await emit(
        {
            "type": "stage_start",
            "stage": "synthesis",
            "message": f"开始语音合成: {len(structured)} 章节, {total} 段落...",
        }
    )

    backend = getattr(runtime, "backend", None) or backend_client.BackendClient()
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
                await backend.synthesize_segment(project_id, cid, sid)
                results.append(
                    {"chapter_id": cid, "segment_id": sid, "audio_path": None, "duration_sec": None}
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
            if done % 1 == 0 or done == total:
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
    return {"synthesis_results": results, "current_stage": "completed", "error": None}