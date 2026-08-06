"""GenScript node: fetch source document from backend -> narration script (streamed)."""
from __future__ import annotations

import re

from langgraph.config import get_stream_writer

from app import backend_client
from app.llm import stream_llm
from app.nodes.util import with_usage
from app.prompts import narration


def parse_markdown_chapters(script: str) -> list[dict[str, str]]:
    """Parse a markdown narration script into ``[{title, content}]``.

    Splits on ``#`` / ``##`` heading lines, and on the plain-text chapter
    markers ``【章节：标题】`` that the gen_script writing rules produce
    (rule: headings converted to plain-text markers, no markdown symbols).
    """
    chapters: list[dict[str, str]] = []
    current_title: str | None = None
    current_lines: list[str] = []
    for line in script.split("\n"):
        stripped = line.strip()
        marker = re.fullmatch(r"【章节：(.+)】", stripped)
        if line.startswith("# ") or line.startswith("## ") or marker:
            if current_title is not None:
                chapters.append(
                    {"title": current_title, "content": "\n".join(current_lines).strip()}
                )
            current_title = marker.group(1).strip() if marker else line.lstrip("#").strip()
            current_lines = []
        else:
            current_lines.append(line)
    if current_title is not None:
        chapters.append(
            {"title": current_title, "content": "\n".join(current_lines).strip()}
        )
    return chapters


async def gen_script_node(state, runtime) -> dict:
    """Transform the project's source document into a narration script.

    Fetches ``source_document`` from the backend, queries past director
    reject feedback from the LangGraph store, streams the LLM output, and
    emits milestone events via ``get_stream_writer``.
    """
    project_id = state["project_id"]
    writer = get_stream_writer()

    async def emit(payload):
        writer(payload)

    await emit({"type": "stage_start", "stage": "gen_script", "message": "开始生成旁白脚本..."})

    # 1. Fetch the source document from the backend.
    backend = getattr(runtime, "backend", None) or backend_client.BackendClient()
    try:
        project = await backend.get_project(project_id)
        source_document = project.get("source_document") or ""
    except Exception as exc:
        await emit(
            {"type": "error", "stage": "gen_script", "message": f"获取源文档失败: {exc}"}
        )
        return {"error": f"获取源文档失败: {exc}", "current_stage": "script_review"}

    # 2. Query past reject feedback from the store (best-effort).
    feedback_context = ""
    if runtime.store is not None:
        try:
            past = await runtime.store.asearch(
                ("director_feedback", project_id), query="reject feedback", limit=3
            )
            lines = [
                f"- {it.value.get('feedback', '')}"
                for it in past
                if it.value.get("feedback")
            ]
            if lines:
                feedback_context = "\n\n## 导演历史反馈（请参考）\n" + "\n".join(lines)
        except Exception:
            pass

    # 3. Stream the LLM call.
    await emit(
        {
            "type": "llm_call",
            "stage": "gen_script",
            "message": f"正在调用 LLM 生成脚本 (文档长度: {len(source_document)} 字)...",
            "data": {"doc_len": len(source_document)},
        }
    )

    script, usage = await stream_llm(
        [
            {"role": "system", "content": narration.get_prompt("gen_script")},
            {
                "role": "user",
                "content": f"请将以下源文档转化为视频旁白脚本：\n\n{source_document}{feedback_context}",
            },
        ],
    )

    if not script or not script.strip():
        await emit(
            {"type": "error", "stage": "gen_script", "message": "LLM 返回了空脚本"}
        )
        return {"error": "LLM 返回了空脚本，请重试", "current_stage": "script_review"}

    chapters = parse_markdown_chapters(script)
    preview = script[:200] + ("..." if len(script) > 200 else "")
    await emit(
        {
            "type": "llm_response",
            "stage": "gen_script",
            "message": f"脚本生成完成: {len(chapters)} 章节, {len(script)} 字",
            "data": {
                "chapters_count": len(chapters),
                "script_length": len(script),
                "script_preview": preview,
            },
        }
    )
    await emit(
        {
            "type": "stage_complete",
            "stage": "gen_script",
            "message": "脚本生成阶段完成",
            "data": {"usage": usage},
        }
    )

    return with_usage(
        "gen_script",
        usage,
        {
            "source_document": source_document,
            "narration_script": script,
            "script_chapters": chapters,
            "current_stage": "script_review",
            "error": None,
        },
    )
