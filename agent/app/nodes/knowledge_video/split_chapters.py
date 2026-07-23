"""SplitChapters node (knowledge_video): rule split → LLM review.

Pipeline:
1. Rule-split the confirmed script locally on Chinese punctuation
   (``，。！？；``), respecting the script's chapter markers
   (``# / ## / 【章节：xxx】``). This gives a deterministic baseline that
   never mangles the source text.
2. Ask the LLM to *review* the baseline: merge < 5 char fragments, split
   > 30 char runs on existing punctuation, and tag ``emotion`` / ``role`` /
   ``segment_kind`` per segment. The LLM must NOT change any character —
   we verify by comparing the concatenated review text against the
   concatenated rule-split text and fall back on mismatch.

Persistence goes through ``batch_create_structure`` (same contract as the
narration workflow's ``split_segment``).
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from langgraph.config import get_stream_writer

from app import backend_client
from app.llm import structured_llm
from app.nodes.gen_script import parse_markdown_chapters
from app.nodes.split_segment import engine_tag_policy, match_chapter_narrations
from app.nodes.util import with_usage
from app.prompts import knowledge_video
from app.schemas import ChapterStructure, Segment, SegmentChapters

# 用户指定的规则切分标点集。
_SPLIT_DELIMS = "，。！？；"
_SPLIT_RE = re.compile(f"(?<=[{re.escape(_SPLIT_DELIMS)}])")


def _rule_split_chapter_body(body: str) -> list[Segment]:
    """Split a chapter body on ``，。！？；``. Punctuation stays on the segment.

    Empty segments (whitespace-only or purely punctuation) are dropped.
    """
    if not body or not body.strip():
        return []
    segments: list[Segment] = []
    for part in _SPLIT_RE.split(body):
        s = part.strip()
        if not s:
            continue
        # 纯标点段（罕见但可能因输入格式产生）跳过
        if all(c in _SPLIT_DELIMS for c in s):
            continue
        segments.append(Segment(text=s))
    return segments


def rule_split_narration_script(script: str) -> SegmentChapters:
    """Rule-split a full narration script into chapters + punctuation-cut segments.

    Chapter boundaries reuse ``parse_markdown_chapters`` (which understands
    both ``#/##`` markdown headings and the plain-text ``【章节：xxx】``
    marker the gen_narration prompt sometimes produces).
    """
    parsed = parse_markdown_chapters(script)
    chapters: list[ChapterStructure] = []
    for ch in parsed:
        chapters.append(
            ChapterStructure(
                chapter_title=ch["title"].strip(),
                segments=_rule_split_chapter_body(ch["content"]),
            )
        )
    return SegmentChapters(chapters=chapters)


def _concat_text(structure: SegmentChapters) -> str:
    """Concatenate all segment texts, chapter titles included, for fidelity check."""
    parts: list[str] = []
    for ch in structure.chapters:
        parts.append(ch.chapter_title.strip())
        for seg in ch.segments:
            parts.append(seg.text.strip())
    return "".join(parts)


def _serialize_baseline(baseline: SegmentChapters) -> str:
    """Render the rule-split baseline into a compact YAML-ish blob for the LLM."""
    lines: list[str] = []
    for ci, ch in enumerate(baseline.chapters):
        lines.append(f"## 章节 {ci + 1}: {ch.chapter_title}")
        for si, seg in enumerate(ch.segments):
            lines.append(f"  - [{si + 1}] {seg.text}  (len={len(seg.text)})")
    return "\n".join(lines)


async def split_chapters_node(state, runtime) -> dict:
    project_id = state["project_id"]
    writer = get_stream_writer()

    async def emit(p):
        writer(p)

    await emit(
        {"type": "stage_start", "stage": "split_chapters", "message": "开始章节拆分（规则切分 + LLM 审校）..."}
    )

    script = state.get("edited_script") or state["narration_script"]
    tts_engine = state.get("tts_engine") or "mimo_tts"

    # -- Stage A: rule split (deterministic, no LLM) --------------------------
    baseline = rule_split_narration_script(script)
    total_baseline = sum(len(ch.segments) for ch in baseline.chapters)
    await emit(
        {
            "type": "progress",
            "stage": "split_chapters",
            "message": f"规则切分完成: {len(baseline.chapters)} 章节, {total_baseline} 段落，准备交给 LLM 审校...",
            "data": {
                "baseline_chapters": len(baseline.chapters),
                "baseline_segments": total_baseline,
            },
        }
    )

    # -- Stage B: LLM review (merge/split/tag, no character edits) ------------
    await emit(
        {
            "type": "llm_call",
            "stage": "split_chapters",
            "message": f"正在调用 LLM 审校分段 (脚本长度: {len(script)} 字, 引擎: {tts_engine})...",
        }
    )
    baseline_dump = _serialize_baseline(baseline)
    reviewed, usage = await structured_llm(
        SegmentChapters,
        [
            {"role": "system", "content": knowledge_video.get_prompt("kv_split_review")},
            {
                "role": "user",
                "content": (
                    "以下是按 ，。！？； 标点规则切分好的旁白稿章节/段落结构。\n"
                    "请按硬性规则做合并（<5字）、拆分（>30字，在已有标点处）与情感/role 标注。\n\n"
                    f"{baseline_dump}\n\n{engine_tag_policy(tts_engine)}"
                ),
            },
        ],
    )

    # -- Fidelity guard: LLM must NOT change any character --------------------
    baseline_text = _concat_text(baseline)
    reviewed_text = _concat_text(reviewed) if reviewed and reviewed.chapters else ""
    final: SegmentChapters
    if not reviewed or not reviewed.chapters or reviewed_text != baseline_text:
        await emit(
            {
                "type": "progress",
                "stage": "split_chapters",
                "message": "LLM 审校输出不合规（改字或为空），退化为规则切分结果。",
            }
        )
        final = baseline
    else:
        final = reviewed

    # -- Persist to backend ---------------------------------------------------
    backend = getattr(runtime, "backend", None) or backend_client.BackendClient()
    try:
        ids = await backend.batch_create_structure(
            project_id,
            final,
            narration_scripts=match_chapter_narrations(script, final),
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

    structured: list[dict] = []
    for ch, ch_ids in zip(final.chapters, ids):
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
            "message": f"审校完成: {len(structured)} 章节, {total} 段落",
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
