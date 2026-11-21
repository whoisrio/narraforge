"""Segment status helpers shared by list/status/synthesize (pure functions)."""
from __future__ import annotations


def segment_ready(seg: dict) -> bool:
    """True when the segment has current audio and its file exists on disk.

    Mirrors the backend's `audio.current.file_exists` semantics: an absent
    `file_exists` key (e.g. synthetic test payloads) counts as present.
    """
    audio = seg.get("audio")
    if not isinstance(audio, dict):
        return False
    current = audio.get("current")
    if not isinstance(current, dict) or not current.get("path"):
        return False
    return current.get("file_exists") is not False


def _rows(detail: dict) -> list[dict]:
    rows = []
    for ch in detail.get("chapters", []):
        for seg in ch.get("segments", []):
            audio = seg.get("audio")
            current = audio.get("current") if isinstance(audio, dict) else None
            rows.append(
                {
                    "chapter_id": ch.get("id"),
                    "chapter_name": ch.get("name"),
                    "segment_id": seg.get("id"),
                    "position": seg.get("position"),
                    "text": seg.get("text") or "",
                    "ready": segment_ready(seg),
                    "origin": current.get("origin") if isinstance(current, dict) else None,
                    "duration_sec": (
                        current.get("duration_sec") if isinstance(current, dict) else None
                    ),
                }
            )
    return rows


def list_rows(
    detail: dict, *, chapter_id: str | None = None, missing_only: bool = False
) -> list[dict]:
    """Flatten segments for display, with optional chapter / missing filters."""
    rows = _rows(detail)
    if chapter_id:
        rows = [r for r in rows if r["chapter_id"] == chapter_id]
    if missing_only:
        rows = [r for r in rows if not r["ready"]]
    return rows


def plan_segments(
    detail: dict, *, chapter_id: str | None = None, segment_id: str | None = None
) -> list[dict]:
    """Segments to synthesize, in execution order.

    Items carry `origin`; `origin == "recorded"` marks locked user recordings
    the runner must skip (or force).
    """
    plan = []
    for r in _rows(detail):
        if chapter_id and r["chapter_id"] != chapter_id:
            continue
        if segment_id and r["segment_id"] != segment_id:
            continue
        plan.append(r)
    return plan


def summarize(results: list[dict]) -> dict:
    counts = {"ok": 0, "failed": 0, "skipped": 0}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    return counts
