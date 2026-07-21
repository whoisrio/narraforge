"""GenNarration node (knowledge_video): faithful markdown-strip rewrite.

Unlike narration's gen_script (creative rewrite), this prompt demands strict
fidelity to the source document: strip markdown, keep facts/order untouched.
Also records a deterministic map of code blocks / image refs for the
animation-brief node downstream.
"""
from __future__ import annotations

from langgraph.config import get_stream_writer

from app import backend_client
from app.llm import stream_llm
from app.nodes.gen_script import parse_markdown_chapters
from app.prompts import knowledge_video
from app.source_elements import extract_source_elements


async def gen_narration_node(state, runtime) -> dict:
    project_id = state["project_id"]
    writer = get_stream_writer()

    async def emit(payload):
        writer(payload)

    await emit(
        {"type": "stage_start", "stage": "gen_narration", "message": "开始生成旁白稿..."}
    )

    source_document = state.get("source_document") or ""
    if not source_document:
        backend = getattr(runtime, "backend", None) or backend_client.BackendClient()
        try:
            project = await backend.get_project(project_id)
            source_document = project.get("source_document") or ""
        except Exception as exc:
            await emit(
                {"type": "error", "stage": "gen_narration", "message": f"获取源文档失败: {exc}"}
            )
            return {"error": f"获取源文档失败: {exc}", "current_stage": "quality_review"}

    source_structure_map = extract_source_elements(source_document)

    # On a reject-regenerate loop, feed the issues back into the prompt.
    feedback_context = ""
    review = state.get("review_result") or {}
    issues = review.get("issues") or []
    if issues and state.get("review_status") == "rejected":
        feedback_context = "\n\n## 上次审查未通过的问题（请修正）\n" + "\n".join(
            f"- {i}" for i in issues
        )

    await emit(
        {
            "type": "llm_call",
            "stage": "gen_narration",
            "message": f"正在调用 LLM 转写旁白 (文档长度: {len(source_document)} 字)...",
            "data": {"doc_len": len(source_document)},
        }
    )

    chunk_count = 0
    acc_len = 0

    async def on_chunk(chunk: str):
        nonlocal chunk_count, acc_len
        chunk_count += 1
        acc_len += len(chunk)
        if chunk_count % 10 == 0:
            await emit(
                {
                    "type": "llm_streaming",
                    "stage": "gen_narration",
                    "message": f"正在生成旁白稿... ({acc_len} 字)",
                    "data": {"total_length": acc_len},
                }
            )

    script = await stream_llm(
        [
            {"role": "system", "content": knowledge_video.get_prompt("kv_gen_narration")},
            {
                "role": "user",
                "content": f"请将以下文档转写为视频旁白稿：\n\n{source_document}{feedback_context}",
            },
        ],
        on_chunk=on_chunk,
    )

    if not script or not script.strip():
        await emit({"type": "error", "stage": "gen_narration", "message": "LLM 返回了空旁白稿"})
        return {"error": "LLM 返回了空旁白稿，请重试", "current_stage": "quality_review"}

    chapters = parse_markdown_chapters(script)
    await emit(
        {
            "type": "llm_response",
            "stage": "gen_narration",
            "message": f"旁白稿生成完成: {len(chapters)} 章节, {len(script)} 字",
            "data": {"chapters_count": len(chapters), "script_length": len(script)},
        }
    )
    await emit(
        {"type": "stage_complete", "stage": "gen_narration", "message": "旁白稿生成阶段完成"}
    )

    return {
        "source_document": source_document,
        "source_structure_map": source_structure_map,
        "narration_script": script,
        "script_chapters": chapters,
        "current_stage": "quality_review",
        "error": None,
    }
