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
from app.services.prompts.workflow_prompts import GEN_SCRIPT_SYSTEM_PROMPT,SCRIPT_REVIEW_SYSTEM_PROMPT,SPLIT_SEGMENT_SYSTEM_PROMPT,PREFERENCE_EXTRACT_PROMPT

logger = logging.getLogger(__name__)

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

    # 3. Auto-reject if LLM review fails (skip human review)
    # But force human review after MAX_AUTO_REJECT retries to prevent infinite loops
    MAX_AUTO_REJECT = 3
    retry_count = state.get("review_retry_count", 0)

    should_auto_reject = (
        retry_count < MAX_AUTO_REJECT
        and (
            review.get("has_critical_issue", False)
            or review.get("overall_score", 5) < 3
            or any(d.get("status") == "fail" for d in review.get("dimensions", []))
        )
    )

    if should_auto_reject:
        logger.info(
            "script_review_node: LLM review failed (score=%s, critical=%s), auto-rejecting",
            review.get("overall_score"), review.get("has_critical_issue"),
        )
        await emit_progress(
            run_id, "script_review", "auto_reject",
            f"LLM 审查未通过（评分 {review.get('overall_score', '?')}/5），自动重新生成...",
            {"review": review, "dimensions_summary": [
                {"name": d.get("name", ""), "status": d.get("status", "unknown"), "comment": d.get("comment", "")[:100]}
                for d in review.get("dimensions", [])
            ]},
        )
        return {
            "review_feedback": review,
            "review_status": "rejected",
            "current_stage": "gen_script",
            "review_retry_count": retry_count + 1,
            "error": None,
        }

    # 4. LLM review passed — interrupt for human decision
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
    # 4. Persist chapters and segments to DB (without TTS synthesis)
    from app.core.database import SessionLocal
    from app.services.segmented_project_service import (
        create_chapter_for_project,
        create_segment_for_chapter,
    )
    from app.models.segmented_project import SegmentedProject

    db = SessionLocal()
    try:
        project = db.query(SegmentedProject).filter_by(id=project_id).first()
        default_voice = {"engine": "edge_tts", "voice": "zh-CN-YunxiNeural", "rate": "+0%", "volume": "+0%"}
        if project and project.chapters:
            ch_voice = project.chapters[0].voice
            # Only use chapter voice if it has a non-empty voice identifier
            if ch_voice and ch_voice.get("voice") and ch_voice.get("engine") == "edge_tts":
                default_voice = ch_voice
            elif ch_voice and ch_voice.get("voice_id") and ch_voice.get("engine") in ("cosyvoice", "mimo_tts", "voxcpm"):
                default_voice = ch_voice

        for chapter_index, chapter_data in enumerate(structured):
            chapter_title = chapter_data.get("chapter_title", f"Chapter {chapter_index + 1}")
            chapter = create_chapter_for_project(
                db, project_id, chapter_title, chapter_index,
                voice=default_voice,
            )
            # Attach chapter_id for synthesis_node to reuse
            chapter_data["_chapter_id"] = chapter.id

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
                # Attach segment_id for synthesis_node to reuse
                seg_data["_segment_id"] = segment.id

        db.commit()
        logger.info(
            "split_segment_node: persisted %d chapters, %d segments for project %s",
            len(structured), total_segments, project_id,
        )
    except Exception:
        db.rollback()
        logger.error("split_segment_node: failed to persist segments for project %s", project_id, exc_info=True)
        raise
    finally:
        db.close()

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
    from app.services.segmented_project_service import synthesize_segment
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
        # Log the voice/engine being used for TTS
        from app.models.segmented_project import SegmentedProject
        project = db.query(SegmentedProject).filter_by(id=project_id).first()
        if project and project.chapters:
            ch_voice = project.chapters[0].voice or {}
            logger.info("synthesis_node: using project's first chapter voice: %s", ch_voice)
        else:
            logger.info("synthesis_node: using default edge_tts voice (zh-CN-YunxiNeural)")

        # Segments already created by split_segment_node — use IDs from structured data
        synthesized_count = 0
        for chapter_index, chapter_data in enumerate(structured):
            chapter_id = chapter_data.get("_chapter_id")
            if not chapter_id:
                logger.warning("synthesis_node: chapter %d missing _chapter_id, skipping", chapter_index)
                continue

            segments_data = chapter_data.get("segments", [])
            for seg_index, seg_data in enumerate(segments_data):
                segment_id = seg_data.get("_segment_id")
                if not segment_id:
                    logger.warning("synthesis_node: segment %d/%d missing _segment_id, skipping", chapter_index, seg_index)
                    continue

                # Run TTS synthesis via the existing service (in thread to avoid event loop conflict)
                synth_seg = await asyncio.to_thread(
                    synthesize_segment,
                    db,
                    project_id,
                    chapter_id,
                    segment_id,
                )

                audio = synth_seg.audio or {}
                current = audio.get("current", {}) if isinstance(audio, dict) else {}
                results.append({
                    "chapter_index": chapter_index,
                    "segment_index": seg_index,
                    "chapter_id": chapter_id,
                    "segment_id": segment_id,
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
