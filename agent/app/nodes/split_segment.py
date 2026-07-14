"""SplitSegment node: split script into chapters+segments, persist to backend.

Uses instructor to get structured ``SegmentChapters`` from the LLM, then calls
the backend's ``chapters:batch`` endpoint to persist the full structure in one
transaction. The backend returns assigned ids which are attached to the chapter/
segment dicts for the synthesis node to reuse.
"""
from __future__ import annotations

from langgraph.config import get_stream_writer

from app import backend_client
from app.llm import get_instructor_client
from app.prompts import narration
from app.schemas import SegmentChapters


async def split_segment_node(state, runtime) -> dict:
    project_id = state["project_id"]
    writer = get_stream_writer()

    async def emit(p):
        writer(p)

    await emit({"type": "stage_start", "stage": "split_segment", "message": "开始段落拆分..."})

    # Query director preferences from the store (best-effort).
    pref_context = ""
    if runtime.store is not None:
        try:
            prefs = await runtime.store.asearch(
                ("director_preference", "global"), query="段落长度 拆分 风格", limit=3
            )
            lines = [
                f"- {it.value.get('preference', '')}"
                for it in prefs
                if it.value.get("preference")
            ]
            if lines:
                pref_context = "\n\n## 导演偏好参考\n" + "\n".join(lines)
        except Exception:
            pass

    script = state.get("edited_script") or state["narration_script"]
    await emit(
        {
            "type": "llm_call",
            "stage": "split_segment",
            "message": f"正在调用 LLM 拆分段落 (脚本长度: {len(script)} 字)...",
        }
    )

    client, model = get_instructor_client()
    structure: SegmentChapters = await client.create(
        response_model=SegmentChapters,
        model=model,
        max_retries=2,
        messages=[
            {"role": "system", "content": narration.get_prompt("split_segment")},
            {
                "role": "user",
                "content": f"请将以下旁白脚本拆分为结构化段落：\n\n{script}{pref_context}",
            },
        ],
    )

    # Persist to backend.
    backend = getattr(runtime, "backend", None) or backend_client.BackendClient()
    try:
        ids = await backend.batch_create_structure(project_id, structure)
    except Exception as exc:
        await emit(
            {"type": "error", "stage": "split_segment", "message": f"持久化失败: {exc}"}
        )
        return {
            "structured_segments": [],
            "current_stage": "synthesis",
            "error": f"持久化失败: {exc}",
        }

    # Attach backend-assigned ids onto the chapter/segment dicts so synthesis can
    # reuse them without re-fetching from the backend.
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
            "stage": "split_segment",
            "message": f"段落拆分完成: {len(structured)} 章节, {total} 段落",
            "data": {"chapters_count": len(structured), "segments_count": total},
        }
    )
    await emit(
        {"type": "stage_complete", "stage": "split_segment", "message": "段落拆分阶段完成"}
    )

    return {"structured_segments": structured, "current_stage": "synthesis", "error": None}