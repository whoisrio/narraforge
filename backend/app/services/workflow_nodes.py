"""Narration workflow node implementations.

Each node is an async function ``(state, runtime) -> dict`` that receives
the shared ``NarrationWorkflowState`` and returns a partial dict of fields
to merge back.  The LangGraph ``Runtime`` provides access to the durable
``store`` (for director feedback) and other runtime facilities.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from uuid import uuid4

from langgraph.runtime import Runtime
from langgraph.types import interrupt

from app.services.workflow_graph import NarrationWorkflowState

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

GEN_SCRIPT_SYSTEM_PROMPT = """\
# 角色定义
你是一位顶尖的AI科普旁白脚本作家。你的任务是将输入的AI科普原始文档，转化为一份可以直接用于视频配音的纯文本旁白脚本。听众是有一定技术背景的大众。

# 硬性写作规则
1. **章节划分**：严格按照原始文档的「二级标题」来划分旁白的章节。将所有 Markdown 格式的标题（如 ## 标题）转换为纯文本章节标记，格式为"【章节：原标题】"。每个章节构成一个独立的旁白段落。
2. **结论先行**：每个章节段落，都必须先用1-2句话提炼出该部分最核心的关键结论，再展开具体描述和通俗解释。
3. **数据保真**：严禁编纂任何数据或事实。旁白脚本的含义必须与原始文档严格一致。所有关键数据说明必须原样保留，但可以用更口语化的方式重新表达。
4. **移除标记**：最终输出的旁白脚本必须是纯文本，不得包含任何 Markdown 标记符号（如 #, *, -, ` 等）。

# 口语化与听觉设计规则
1. **绝对口语化**：完全打散书面语结构，每句话不超过25个字。大量使用"你想想看"、"咱们"、"其实吧"、"说白了就是"等口语词。
2. **术语快解释**：遇到专业术语，必须立即用一句话的生活比喻或通俗说法带过，绝不展开讲大故事。
   - 示例："这就用到了'自注意力机制'——说白了，就是让模型在海量信息中，一眼盯住最关键的部分。"
3. **听觉牵引感**：频繁使用设问（"这是怎么做到的呢？"）、感叹（"没错！"）、转折（"但问题来了……"）来牵引听众注意力，营造一对一的对话感。
4. **结构完整**：脚本必须具备"凤头-猪肚-豹尾"。
   - **开场**：用生活痛点、惊人事实或假设性提问瞬间抓住听众。
   - **结尾**：用金句总结升华，并包含互动引导（如"如果你觉得有意思，请分享给更多人"）。

# 输出格式

输出完整的 markdown 文档，使用 # 标记章节标题，段落之间用空行分隔。

不要输出任何元数据、说明或注释，只输出旁白脚本正文。
"""


SCRIPT_REVIEW_SYSTEM_PROMPT = """\
你是一位资深的视频导演助理，负责审查旁白脚本质量。

请从以下维度审查旁白脚本，并给出具体的改进建议：

## 审查维度

1.  **内容忠实度（一票否决项）**
    - 旁白含义是否与原始文档完全一致？是否存在编造数据、曲解原意的情况？
    - 原始文档中的关键数据说明是否被完整保留？
2.  **口语化与可讲度**
    - 每一句话是否都像"人话"？朗读起来是否顺口，没有任何生硬的书袋感？
    - 句子长度是否都控制在25字以内？长句是否已有效拆分？
3.  **结构清晰度与节奏**
    - 章节划分是否与原始文档的二级标题严格对应？
    - 每个章节是否做到了"结论先行"？逻辑是否由浅入深、流畅不跳跃？
    - 开场是否在3秒内抓住注意力？结尾是否有清晰的互动引导？
4.  **术语与比喻的恰当性**
    - 专业术语是否都做了一句话的快解释？比喻是否通俗准确，没有误导或引起歧义？
5. **吸引力**: 开头是否引人？结尾是否有力？
6. **时长**: 预估总时长是否合理？（假设每分钟 150-180 字）

## 输出格式

严格输出以下 JSON 格式，不要输出其他内容：

{
  "dimensions": [
    {
      "name": "内容忠实度",
      "status": "pass" | "warn" | "fail",
      "comment": "具体评价",
      "suggestion": "改进建议（仅 warn/fail 时填写）"
    },
    {
      "name": "口语化与可讲度",
      "status": "pass" | "warn" | "fail",
      "comment": "具体评价",
      "suggestion": null
    },
    {
      "name": "结构清晰度与节奏",
      "status": "pass" | "warn" | "fail",
      "comment": "具体评价",
      "suggestion": "改进建议"
    },
    {
      "name": "术语与比喻的恰当性",
      "status": "pass" | "warn" | "fail",
      "comment": "具体评价",
      "suggestion": null
    },
    {
      "name": "吸引力",
      "status": "pass" | "warn" | "fail",
      "comment": "具体评价",
      "suggestion": null
    },
    {
      "name": "时长",
      "status": "pass" | "warn" | "fail",
      "comment": "预估总时长 X 分钟",
      "suggestion": null
    }
  ],
  "overall_score": 4,
  "overall_comment": "总体评价，一句话概括主要优缺点",
  "has_critical_issue": false
}

字段说明：
- status: "pass" = 通过, "warn" = 建议改进, "fail" = 必须修改
- has_critical_issue: 若"内容忠实度"为 fail，则为 true（一票否决）
- overall_score: 1-5 分，3 分及以上视为可接受
"""


PREFERENCE_EXTRACT_PROMPT = """\
分析以下导演反馈，提取一条具体的创作偏好。

反馈内容：{feedback}

输出格式（JSON）：
{{
    "preference": "一句话描述偏好",
    "category": "pacing" | "style" | "length" | "tone" | "structure" | "other"
}}

只输出 JSON，不要其他内容。
"""

SPLIT_SEGMENT_SYSTEM_PROMPT = """\
你是一位专业的旁白脚本结构化分析师。

你的任务是将旁白脚本文档拆分为结构化的章节和段落，并为每个段落标注情绪和角色。

## 拆分规则

1. **章节**: 按 markdown 标题（# / ##）划分
2. **段落**: 每个自然段落为一个段落，每段 30-80 字
3. **过长段落**: 超过 80 字的段落，在语义自然的断点处拆分
4. **过短段落**: 少于 15 字的段落，考虑与相邻段落合并

## 情绪标注

为每个段落标注一种情绪，使用以下枚举值：
- neutral: 中性叙述
- happy: 积极、欢快
- sad: 沉重、感伤
- angry: 愤怒、激烈
- calm: 平静、舒缓
- excited: 兴奋、激动

## 角色标注

- narration: 旁白叙述（默认）
- 对话角色: 如果段落中包含角色对话，标注角色名称

## 输出格式

严格输出以下 JSON 格式，不要输出其他内容：

[
  {
    "chapter_title": "章节标题",
    "segments": [
      {
        "text": "段落文本",
        "emotion": "neutral",
        "role": "narration",
        "segment_kind": "narration"
      }
    ]
  }
]

## 注意

- segment_kind 只能是 "narration" 或 "dialogue"
- role 为 "narration" 时，segment_kind 必须为 "narration"
- role 为具体角色名时，segment_kind 为 "dialogue"
- 情绪标注要结合上下文语境，不是简单的关键词匹配
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def parse_markdown_chapters(script: str) -> list[dict[str, str]]:
    """Parse a markdown narration script into a list of chapter dicts.

    Each dict contains ``title`` (str) and ``content`` (str).
    Splits on ``#`` or ``##`` heading lines.
    """
    chapters: list[dict[str, str]] = []
    current_title: str | None = None
    current_lines: list[str] = []

    for line in script.split("\n"):
        if line.startswith("# ") or line.startswith("## "):
            if current_title is not None:
                chapters.append({
                    "title": current_title,
                    "content": "\n".join(current_lines).strip(),
                })
            current_title = line.lstrip("#").strip()
            current_lines = []
        else:
            current_lines.append(line)

    if current_title is not None:
        chapters.append({
            "title": current_title,
            "content": "\n".join(current_lines).strip(),
        })

    return chapters


# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------


async def gen_script_node(
    state: NarrationWorkflowState,
    runtime: Runtime,
) -> dict[str, object]:
    """GenScript node: transform the source document into a narration script.

    Steps:
    1. Query past director "reject" feedback from the LangGraph Store.
    2. Call the LLM with the system prompt + source document + feedback.
    3. Parse the returned markdown into chapter structures.
    4. Return state updates for the script-review stage.
    """
    # Late import to avoid circular dependency at module level
    from app.services.llm_client import call_agent_llm_streaming
    from app.services.workflow_progress import emit_progress

    project_id = state["project_id"]
    run_id = state["run_id"]

    await emit_progress(run_id, "gen_script", "stage_start", "开始生成旁白脚本...")

    # 1. Query historical reject feedback from the store
    namespace = ("director_feedback", project_id)
    feedback_context = ""
    if runtime.store is not None:
        try:
            past_feedback = await runtime.store.asearch(
                namespace, query="reject feedback", limit=3
            )
            if past_feedback:
                feedback_lines = [
                    f"- {item.value.get('feedback', '')}"
                    for item in past_feedback
                    if item.value.get("feedback")
                ]
                if feedback_lines:
                    feedback_context = (
                        "\n\n## 导演历史反馈（请参考）\n"
                        + "\n".join(feedback_lines)
                    )
        except Exception:
            logger.warning(
                "Failed to query director feedback for project %s",
                project_id,
                exc_info=True,
            )

    # 2. Call the LLM
    user_prompt = (
        f"请将以下源文档转化为视频旁白脚本：\n\n"
        f"{state['source_document']}{feedback_context}"
    )
    messages = [
        {"role": "system", "content": GEN_SCRIPT_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    logger.info(
        "gen_script_node: calling LLM for project %s (doc_len=%d)",
        project_id,
        len(state["source_document"]),
    )
    await emit_progress(
        run_id, "gen_script", "llm_call",
        f"正在调用 LLM 生成脚本 (文档长度: {len(state['source_document'])} 字)...",
    )

    # Stream LLM output and send chunks as progress events
    accumulated_text = ""
    chunk_count = 0

    async def on_chunk(chunk: str):
        nonlocal accumulated_text, chunk_count
        accumulated_text += chunk
        chunk_count += 1
        # Send progress every 10 chunks to avoid overwhelming SSE
        if chunk_count % 10 == 0:
            preview = accumulated_text[-200:] if len(accumulated_text) > 200 else accumulated_text
            await emit_progress(
                run_id, "gen_script", "llm_streaming",
                f"正在生成脚本... ({len(accumulated_text)} 字)",
                {"streaming_text": preview, "total_length": len(accumulated_text)},
            )

    script = await call_agent_llm_streaming(messages, on_chunk)

    if not script or not script.strip():
        logger.error("gen_script_node: LLM returned empty script")
        await emit_progress(run_id, "gen_script", "error", "LLM 返回了空脚本")
        return {
            "error": "LLM 返回了空脚本，请重试",
            "current_stage": "script_review",
        }

    # 3. Parse chapters from the returned markdown
    chapters = parse_markdown_chapters(script)

    logger.info(
        "gen_script_node: generated %d chapters, %d chars",
        len(chapters),
        len(script),
    )
    # Show script preview (first 200 chars)
    script_preview = script[:200] + "..." if len(script) > 200 else script
    await emit_progress(
        run_id, "gen_script", "llm_response",
        f"脚本生成完成: {len(chapters)} 章节, {len(script)} 字",
        {
            "chapters_count": len(chapters),
            "script_length": len(script),
            "script_preview": script_preview,
            "chapters": [{"title": ch["title"], "length": len(ch["content"])} for ch in chapters],
        },
    )

    # 4. Return state updates
    await emit_progress(run_id, "gen_script", "stage_complete", "脚本生成阶段完成")
    return {
        "narration_script": script,
        "script_chapters": chapters,
        "current_stage": "script_review",
        "error": None,
    }


# ---------------------------------------------------------------------------
# Script review helpers
# ---------------------------------------------------------------------------


async def _extract_preference(
    runtime: Runtime,
    project_id: str,
    feedback: str,
) -> None:
    """Extract a structured preference from director feedback and store it.

    Failures are logged but never propagate -- preference extraction is
    best-effort and must not block the main workflow.
    """
    from app.services.llm_client import call_agent_llm as call_llm, extract_json_object

    messages = [
        {
            "role": "system",
            "content": "你是一个偏好提取器，从用户的反馈中提取具体的创作偏好。",
        },
        {
            "role": "user",
            "content": PREFERENCE_EXTRACT_PROMPT.format(feedback=feedback),
        },
    ]

    try:
        raw = await asyncio.to_thread(call_llm, messages)
        json_str = extract_json_object(raw)
        if json_str is None:
            logger.warning(
                "_extract_preference: no JSON found in LLM response for project %s",
                project_id,
            )
            return
        pref = json.loads(json_str)

        if runtime.store is not None:
            await runtime.store.aput(
                ("director_preference", "global"),
                key=str(uuid4()),
                value={
                    "preference": pref["preference"],
                    "category": pref["category"],
                    "extracted_from": feedback[:100],
                    "created_at": datetime.now(timezone.utc).isoformat(),
                },
            )
    except Exception:
        logger.warning(
            "_extract_preference: failed for project %s",
            project_id,
            exc_info=True,
        )


# ---------------------------------------------------------------------------
# Script review node
# ---------------------------------------------------------------------------


async def script_review_node(
    state: NarrationWorkflowState,
    runtime: Runtime,
) -> dict[str, object]:
    """ScriptReview node: LLM auto-review + interrupt for human approval.

    Steps:
    1. Call the LLM to perform a multi-dimensional quality review.
    2. Persist the review result in the LangGraph Store.
    3. Interrupt execution and wait for the director's decision.
    4. On approve: store comment, extract preferences, advance to split_segment.
       On reject: store feedback, extract preferences, loop back to gen_script.
    """
    from app.services.llm_client import call_agent_llm_streaming, extract_json_object
    from app.services.workflow_progress import emit_progress

    project_id = state["project_id"]
    run_id = state["run_id"]

    await emit_progress(run_id, "script_review", "stage_start", "开始脚本审查...")

    # 1. LLM auto-review
    messages = [
        {"role": "system", "content": SCRIPT_REVIEW_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": f"请审查以下旁白脚本：\n\n{state['narration_script']}",
        },
    ]

    logger.info(
        "script_review_node: calling LLM for review, project %s",
        project_id,
    )
    await emit_progress(run_id, "script_review", "llm_call", "正在调用 LLM 进行脚本审查...")

    # Stream LLM output and send chunks as progress events
    accumulated_text = ""
    chunk_count = 0

    async def on_review_chunk(chunk: str):
        nonlocal accumulated_text, chunk_count
        accumulated_text += chunk
        chunk_count += 1
        if chunk_count % 5 == 0:
            await emit_progress(
                run_id, "script_review", "llm_streaming",
                f"正在生成审查报告... ({len(accumulated_text)} 字)",
                {"streaming_text": accumulated_text[-100:], "total_length": len(accumulated_text)},
            )

    review_raw = await call_agent_llm_streaming(messages, on_review_chunk)

    json_str = extract_json_object(review_raw)
    if json_str is None:
        logger.error(
            "script_review_node: LLM returned non-JSON review for project %s",
            project_id,
        )
        return {
            "review_feedback": {"error": "LLM 返回了非 JSON 格式的审查结果"},
            "review_status": "rejected",
            "current_stage": "gen_script",
            "error": "LLM 审查结果解析失败，请重试",
        }
    review = json.loads(json_str)

    # 2. Persist the LLM review to the store
    if runtime.store is not None:
        try:
            await runtime.store.aput(
                ("director_feedback", project_id),
                key=f"review_{run_id}",
                value={
                    "type": "llm_review",
                    "review": review,
                    "run_id": run_id,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                },
            )
        except Exception:
            logger.warning(
                "script_review_node: failed to store review for project %s",
                project_id,
                exc_info=True,
            )

    # 3. Interrupt and wait for human decision
    # Extract dimension summaries for display
    dimensions_summary = []
    for dim in review.get("dimensions", []):
        dimensions_summary.append({
            "name": dim.get("name", ""),
            "status": dim.get("status", "unknown"),
            "comment": dim.get("comment", "")[:100],  # Truncate
        })

    await emit_progress(
        run_id, "script_review", "interrupt",
        f"脚本审查完成，评分: {review.get('overall_score', '?')}/5，等待导演审批...",
        {
            "review": review,
            "dimensions_summary": dimensions_summary,
            "overall_comment": review.get("overall_comment", ""),
            "has_critical_issue": review.get("has_critical_issue", False),
        },
    )
    decision = interrupt({
        "script": state["narration_script"],
        "review": review,
        "available_actions": ["approve", "reject"],
    })

    # 4. Process the director's decision
    if decision.get("action") == "approve":
        edited_script = decision.get("edited_script", state["narration_script"])

        # Store director comment if provided
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
                logger.warning(
                    "script_review_node: failed to store comment for project %s",
                    project_id,
                    exc_info=True,
                )
            await _extract_preference(runtime, project_id, decision["comment"])

        return {
            "edited_script": edited_script,
            "review_feedback": review,
            "review_status": "approved",
            "current_stage": "split_segment",
            "error": None,
        }

    # Rejected path
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
            logger.warning(
                "script_review_node: failed to store reject feedback for project %s",
                project_id,
                exc_info=True,
            )
    if feedback:
        await _extract_preference(runtime, project_id, feedback)

    return {
        "review_feedback": feedback,
        "review_status": "rejected",
        "current_stage": "gen_script",
        "error": None,
    }


# ---------------------------------------------------------------------------
# Split segment node
# ---------------------------------------------------------------------------


async def split_segment_node(
    state: NarrationWorkflowState,
    runtime: Runtime,
) -> dict[str, object]:
    """SplitSegment node: split narration script into structured segments.

    Steps:
    1. Query director preferences from the LangGraph Store.
    2. Call the LLM with the system prompt to produce structured JSON.
    3. Parse and return the structured segments.
    """
    from app.services.llm_client import call_agent_llm_streaming, extract_json_array
    from app.services.workflow_progress import emit_progress

    project_id = state["project_id"]
    run_id = state["run_id"]

    await emit_progress(run_id, "split_segment", "stage_start", "开始段落拆分...")

    # 1. Query director preferences
    pref_context = ""
    if runtime.store is not None:
        try:
            preferences = await runtime.store.asearch(
                ("director_preference", "global"),
                query="段落长度 拆分 风格",
                limit=3,
            )
            if preferences:
                pref_lines = [
                    f"- {item.value.get('preference', '')}"
                    for item in preferences
                    if item.value.get("preference")
                ]
                if pref_lines:
                    pref_context = (
                        "\n\n## 导演偏好参考\n" + "\n".join(pref_lines)
                    )
        except Exception:
            logger.warning(
                "split_segment_node: failed to query preferences for project %s",
                project_id,
                exc_info=True,
            )

    # 2. Call the LLM
    script = state.get("edited_script") or state["narration_script"]
    user_prompt = (
        f"请将以下旁白脚本拆分为结构化段落：\n\n{script}{pref_context}"
    )
    messages = [
        {"role": "system", "content": SPLIT_SEGMENT_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    logger.info(
        "split_segment_node: calling LLM for project %s (script_len=%d)",
        project_id,
        len(script),
    )
    await emit_progress(
        run_id, "split_segment", "llm_call",
        f"正在调用 LLM 拆分段落 (脚本长度: {len(script)} 字)...",
    )

    # Stream LLM output and send chunks as progress events
    accumulated_text = ""
    chunk_count = 0

    async def on_split_chunk(chunk: str):
        nonlocal accumulated_text, chunk_count
        accumulated_text += chunk
        chunk_count += 1
        if chunk_count % 5 == 0:
            await emit_progress(
                run_id, "split_segment", "llm_streaming",
                f"正在生成拆分结果... ({len(accumulated_text)} 字)",
                {"streaming_text": accumulated_text[-100:], "total_length": len(accumulated_text)},
            )

    raw = await call_agent_llm_streaming(messages, on_split_chunk)

    # 3. Parse the structured output
    json_str = extract_json_array(raw)
    if json_str is None:
        logger.error(
            "split_segment_node: LLM returned non-JSON response for project %s",
            project_id,
        )
        await emit_progress(run_id, "split_segment", "error", "LLM 返回了非 JSON 格式的拆分结果")
        return {
            "structured_segments": [],
            "current_stage": "synthesis",
            "error": "LLM 返回了非 JSON 格式的拆分结果，请重试",
        }

    try:
        structured = json.loads(json_str)
    except json.JSONDecodeError:
        logger.error(
            "split_segment_node: JSON parse failed for project %s",
            project_id,
            exc_info=True,
        )
        await emit_progress(run_id, "split_segment", "error", "LLM 返回的 JSON 格式有误")
        return {
            "structured_segments": [],
            "current_stage": "synthesis",
            "error": "LLM 返回的 JSON 格式有误，请重试",
        }

    if not isinstance(structured, list):
        logger.error(
            "split_segment_node: expected list, got %s for project %s",
            type(structured).__name__,
            project_id,
        )
        return {
            "structured_segments": [],
            "current_stage": "synthesis",
            "error": "LLM 返回的结构不是列表格式，请重试",
        }

    logger.info(
        "split_segment_node: parsed %d chapters for project %s",
        len(structured),
        project_id,
    )

    total_segments = sum(len(ch.get("segments", [])) for ch in structured)

    # Build chapter/segment details
    chapters_detail = []
    for ch in structured:
        segments_preview = []
        for seg in ch.get("segments", [])[:3]:  # First 3 segments per chapter
            segments_preview.append({
                "text": seg.get("text", "")[:80],
                "emotion": seg.get("emotion", "neutral"),
            })
        chapters_detail.append({
            "title": ch.get("chapter_title", ""),
            "segment_count": len(ch.get("segments", [])),
            "segments_preview": segments_preview,
        })

    await emit_progress(
        run_id, "split_segment", "llm_response",
        f"段落拆分完成: {len(structured)} 章节, {total_segments} 段落",
        {
            "chapters_count": len(structured),
            "segments_count": total_segments,
            "chapters_detail": chapters_detail,
        },
    )
    await emit_progress(run_id, "split_segment", "stage_complete", "段落拆分阶段完成")

    return {
        "structured_segments": structured,
        "current_stage": "synthesis",
        "error": None,
    }


# ---------------------------------------------------------------------------
# Synthesis node
# ---------------------------------------------------------------------------


async def synthesis_node(
    state: NarrationWorkflowState,
    runtime: Runtime,
) -> dict[str, object]:
    """Synthesis node: persist chapters/segments and run TTS for each segment.

    Steps:
    1. Create Chapter and Segment records from structured_segments.
    2. Call synthesize_segment for each segment to generate audio.
    3. Collect and return synthesis results.
    """
    from app.core.database import SessionLocal
    from app.services.segmented_project_service import (
        create_chapter_for_project,
        create_segment_for_chapter,
        synthesize_segment,
    )
    from app.services.workflow_progress import emit_progress

    project_id = state["project_id"]
    run_id = state["run_id"]
    structured = state.get("structured_segments", [])

    if not structured:
        logger.warning("synthesis_node: no structured_segments for project %s", project_id)
        await emit_progress(run_id, "synthesis", "stage_complete", "无段落数据，跳过语音合成")
        return {
            "synthesis_results": [],
            "current_stage": "completed",
            "error": None,
        }

    total_segments = sum(len(ch.get("segments", [])) for ch in structured)
    await emit_progress(
        run_id, "synthesis", "stage_start",
        f"开始语音合成: {len(structured)} 章节, {total_segments} 段落...",
    )

    results: list[dict[str, object]] = []
    db = SessionLocal()
    try:
        # Get default voice from project's first chapter
        from app.models.segmented_project import SegmentedProject
        project = db.query(SegmentedProject).filter_by(id=project_id).first()
        default_voice = {"engine": "edge_tts", "voice": "zh-CN-YunxiNeural", "rate": "+0%", "volume": "+0%"}
        if project and project.chapters:
            default_voice = project.chapters[0].voice or default_voice

        synthesized_count = 0
        for chapter_index, chapter_data in enumerate(structured):
            chapter_title = chapter_data.get("chapter_title", f"Chapter {chapter_index + 1}")
            chapter = create_chapter_for_project(
                db, project_id, chapter_title, chapter_index,
                voice=default_voice,
            )

            segments_data = chapter_data.get("segments", [])
            for seg_index, seg_data in enumerate(segments_data):
                segment = create_segment_for_chapter(
                    db,
                    chapter.id,
                    seg_data["text"],
                    seg_index,
                    emotion=seg_data.get("emotion"),
                    role=seg_data.get("role"),
                    segment_kind=seg_data.get("segment_kind", "narration"),
                )

                # Run TTS synthesis via the existing service (in thread to avoid event loop conflict)
                synth_seg = await asyncio.to_thread(
                    synthesize_segment,
                    db,
                    project_id,
                    chapter.id,
                    segment.id,
                )

                audio = synth_seg.audio or {}
                current = audio.get("current", {}) if isinstance(audio, dict) else {}
                results.append({
                    "chapter_index": chapter_index,
                    "segment_index": seg_index,
                    "chapter_id": chapter.id,
                    "segment_id": segment.id,
                    "audio_path": current.get("path"),
                    "duration_sec": current.get("duration_sec"),
                })

                synthesized_count += 1
                if synthesized_count % 5 == 0 or synthesized_count == total_segments:
                    await emit_progress(
                        run_id, "synthesis", "progress",
                        f"语音合成进度: {synthesized_count}/{total_segments}",
                        {"completed": synthesized_count, "total": total_segments},
                    )

        db.commit()
    except Exception:
        db.rollback()
        logger.error(
            "synthesis_node: synthesis failed for project %s",
            project_id,
            exc_info=True,
        )
        raise
    finally:
        db.close()

    logger.info(
        "synthesis_node: completed %d segments for project %s",
        len(results),
        project_id,
    )

    total_duration = sum(r.get("duration_sec", 0) or 0 for r in results)
    await emit_progress(
        run_id, "synthesis", "stage_complete",
        f"语音合成完成: {len(results)} 段落, 总时长 {total_duration:.1f}秒",
        {"total_segments": len(results), "total_duration_sec": total_duration},
    )

    return {
        "synthesis_results": results,
        "current_stage": "completed",
        "error": None,
    }
