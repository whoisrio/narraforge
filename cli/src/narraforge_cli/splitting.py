"""Pure helpers for the project split command (no I/O)."""
from __future__ import annotations

import re

DEFAULT_DELIMITERS = ["，", "。", "！", "？", "；", ".", ",", "!", "?", ";"]

_HEADING_LINE = re.compile(r"^#{1,6}\s+[^\n]*\n?")


def pick_markdown_level(detect_result: dict) -> list[int]:
    """Choose the heading level to split on from a markdown-detect response.

    Picks the level with the most candidates; ties break toward the shallower
    level. Returns [] when the document has no headings.
    """
    counts: dict[int, int] = {}
    for cand in detect_result.get("candidates", []):
        level = cand.get("level")
        if isinstance(level, int):
            counts[level] = counts.get(level, 0) + 1
    if not counts:
        return []
    best = max(sorted(counts), key=lambda lv: counts[lv])
    return [best]


def slice_chapter_bodies(text: str, chapters: list[dict]) -> list[dict]:
    """Slice the source text into {title, body} per markdown-split chapter.

    The chapter's leading markdown heading line (if any) is stripped so
    chapters carry clean narration text.
    """
    out = []
    for ch in chapters:
        chunk = text[ch["start_char"] : ch["end_char"]]
        stripped = chunk.lstrip("\n")
        m = _HEADING_LINE.match(stripped)
        body = stripped[m.end() :].strip() if m else stripped.strip()
        out.append({"title": ch.get("title") or "", "body": body})
    return out


def build_batch_payload(
    bodies: list[dict],
    *,
    full_text: str,
    engine: str | None,
    mode: str,
    preserve_audio: bool,
    dry_run: bool,
    llm_segments: list[list[dict]] | None = None,
) -> dict:
    """Build the chapters:batch request payload.

    - mode "rule": chapters carry no segments and `split_segments: true` lets
      the backend rule-split each chapter's narration text.
    - mode "llm": per-chapter LLM segments are injected and `split_segments`
      stays false. `llm_segments[i]` must align with `bodies[i]`.
    """
    if mode == "llm" and llm_segments is None:
        raise ValueError("mode='llm' requires llm_segments aligned with bodies")
    chapters = []
    for i, item in enumerate(bodies):
        ch: dict[str, object] = {
            "chapter_title": item["title"],
            "narration_script": item["body"],
            "original_text": item["body"],
            "split_config": {"mode": "rule", "delimiters": DEFAULT_DELIMITERS},
        }
        if engine:
            ch["engine"] = engine
        if mode == "llm":
            ch["segments"] = llm_segments[i]  # type: ignore[index]
        chapters.append(ch)
    return {
        "chapters": chapters,
        "narration_script": full_text,
        "preserve_audio": preserve_audio,
        "split_segments": mode == "rule",
        "dry_run": dry_run,
    }
