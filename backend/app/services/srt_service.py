"""SRT subtitle generation from segment durations.

Timeline logic mirrors the frontend's ``buildSRTContent`` (audioConcat.ts):
timestamps are computed by accumulating each segment's ``duration_sec``.
"""
from __future__ import annotations


def _fmt_timestamp(seconds: float) -> str:
    ms_total = round(seconds * 1000)
    h, rem = divmod(ms_total, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def build_srt(segments: list[dict], *, offset_sec: float = 0.0) -> str:
    """Build SRT content from ordered ``[{text, duration_sec}]`` entries."""
    blocks: list[str] = []
    cursor = offset_sec
    for i, seg in enumerate(segments, start=1):
        duration = float(seg.get("duration_sec") or 0.0)
        start = cursor
        end = cursor + duration
        text = (seg.get("text") or "").strip()
        blocks.append(f"{i}\n{_fmt_timestamp(start)} --> {_fmt_timestamp(end)}\n{text}")
        cursor = end
    return "\n\n".join(blocks) + "\n"
