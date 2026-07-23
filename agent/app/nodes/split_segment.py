"""SplitSegment node: split script into chapters+segments, persist to backend.

Uses the LLM's structured output to get ``SegmentChapters``, then calls
the backend's ``chapters:batch`` endpoint to persist the full structure in one
transaction. The backend returns assigned ids which are attached to the chapter/
segment dicts for the synthesis node to reuse.
"""
from __future__ import annotations

import re

from langgraph.config import get_stream_writer

from app import backend_client
from app.llm import structured_llm
from app.nodes.gen_script import parse_markdown_chapters
from app.nodes.util import with_usage
from app.prompts import narration
from app.schemas import SegmentChapters

_INLINE_TAG_RE = re.compile(r"\[[^\]]*\]")
_MULTI_SPACE_RE = re.compile(r" {2,}")
_SPACE_BEFORE_PUNCT_RE = re.compile(r" +([，。！？；：、,.!?;:])")


def strip_inline_tags(text: str) -> str:
    """Remove ``[...]`` non-verbal tags (voxcpm-only) from narration text."""
    cleaned = _INLINE_TAG_RE.sub("", text)
    cleaned = _SPACE_BEFORE_PUNCT_RE.sub(r"\1", cleaned)
    return _MULTI_SPACE_RE.sub(" ", cleaned).strip()

# Tag policy injected into the split user message per selected TTS engine.
# The system prompt stays untouched (LangSmith hub prompts take precedence and
# carry no format variables), so the policy rides along in the user message.
VOXCPM_TAG_POLICY = (
    "## 非语言标签要求（voxcpm 引擎）\n"
    "除 emotion 标注外，请在语义合适的位置插入非语言标签，仅允许使用以下白名单：\n"
    "[laughing] [sigh] [Uhm] [Shh] [Question-ah] [Question-ei] [Question-en] [Question-oh] "
    "[Surprise-wa] [Surprise-yo] [Dissatisfaction-hnn]\n"
    "每段最多插入 1-2 个，不要滥用。"
)

NO_TAG_POLICY = (
    "## 标签约束\n"
    "只标注 emotion，不要插入任何 [...] 形式的标签。"
)


def engine_tag_policy(engine: str | None) -> str:
    """Return the tag policy text for the selected TTS engine."""
    return VOXCPM_TAG_POLICY if engine == "voxcpm" else NO_TAG_POLICY


def match_chapter_narrations(script: str, structure: SegmentChapters) -> list[str | None]:
    """Per-chapter narration text for persistence.

    Primary: match ``chapter_title`` against the markdown/【章节：】 chapters
    parsed from the full script (preserves the reviewed original wording).
    Fallback: when the LLM's script drifts from the expected marker format
    (parse yields no/fewer chapters), join the chapter's own split segments
    (inline tags stripped) -- the split structure is always chapter-shaped,
    so every chapter gets narration text regardless of script formatting.
    """
    by_title = {ch["title"].strip(): ch["content"] for ch in parse_markdown_chapters(script)}
    narrations: list[str | None] = []
    for ch in structure.chapters:
        matched = by_title.get(ch.chapter_title.strip())
        if matched:
            narrations.append(matched)
            continue
        joined = "\n\n".join(
            t for t in (strip_inline_tags(seg.text).strip() for seg in ch.segments) if t
        )
        narrations.append(joined or None)
    return narrations


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
    tts_engine = state.get("tts_engine") or "mimo_tts"
    await emit(
        {
            "type": "llm_call",
            "stage": "split_segment",
            "message": f"正在调用 LLM 拆分段落 (脚本长度: {len(script)} 字, 引擎: {tts_engine})...",
        }
    )

    structure, usage = await structured_llm(
        SegmentChapters,
        [
            {"role": "system", "content": narration.get_prompt("split_segment")},
            {
                "role": "user",
                "content": (
                    f"请将以下旁白脚本拆分为结构化段落：\n\n{script}{pref_context}"
                    f"\n\n{engine_tag_policy(tts_engine)}"
                ),
            },
        ],
    )

    # Persist to backend (each chapter carries its original narration text).
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
        {
            "type": "stage_complete",
            "stage": "split_segment",
            "message": "段落拆分阶段完成",
            "data": {"usage": usage},
        }
    )

    return with_usage(
        "split_segment",
        usage,
        {"structured_segments": structured, "current_stage": "synthesis", "error": None},
    )