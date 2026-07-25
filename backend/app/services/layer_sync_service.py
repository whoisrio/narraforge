"""Narration layer sync - Phase A: staleness detection + baseline snapshots.

Three layers:
    L1 chapter.original_text  --[agent rewrite]-->  L2 chapter.narration_script  --[split]-->  L3 segments[].text

Each layer boundary stores a hash snapshot in ``chapter.sync_state`` (JSON):
    l1_hash        - hash(original_text) at the time L2 was derived
    l2_hash        - hash(narration_script) at the time L3 was split
    segments_hash  - hash(segments) at the time L3 was split

Dirty detection compares the stored snapshot to the current text's hash. Hashes
are only re-baselined at genuine derive/split points (NOT on generic edits), so
editing a layer makes it dirty.

Phase A only: badges. Phase B adds the localisation-merge sync actions.
"""
from __future__ import annotations

import hashlib
from typing import Any

_DIGEST = 8  # blake2s digest size -> 16 hex chars


def hash_text(text: str | None) -> str:
    """Stable short hash of text (blake2s, 16 hex chars). None -> hash of empty."""
    return hashlib.blake2s((text or "").encode("utf-8"), digest_size=_DIGEST).hexdigest()


def segments_hash(segments: list[Any] | None) -> str:
    """Hash of the segments' texts (joined per-segment hash). Stable across ordering."""
    parts = "\n".join(hash_text(getattr(s, "text", None)) for s in (segments or []))
    return hashlib.blake2s(parts.encode("utf-8"), digest_size=_DIGEST).hexdigest()


def sync_status(chapter: Any) -> dict[str, bool]:
    """Compute L1/L2/L3 dirty flags for a chapter."""
    st = getattr(chapter, "sync_state", None) or {}
    l1 = hash_text(getattr(chapter, "original_text", None))
    l2 = hash_text(getattr(chapter, "narration_script", None))
    l3 = segments_hash(getattr(chapter, "segments", None))
    return {
        "l1_dirty": bool(st.get("l1_hash")) and l1 != st["l1_hash"],
        "l2_dirty": bool(st.get("l2_hash")) and l2 != st["l2_hash"],
        "l3_dirty": bool(st.get("segments_hash")) and l3 != st["segments_hash"],
    }


def _state(chapter: Any) -> dict[str, str]:
    return dict(getattr(chapter, "sync_state", None) or {})


def mark_l2_derived(chapter: Any) -> None:
    """L2 was (re)derived from L1: snapshot l1_hash so later L1 edits are detectable."""
    st = _state(chapter)
    st["l1_hash"] = hash_text(getattr(chapter, "original_text", None))
    chapter.sync_state = st


def mark_split(chapter: Any) -> None:
    """L3 was (re)split from L2: snapshot l2_hash + segments_hash. l1_hash untouched.

    Phase B also writes per-segment ``split_anchor`` (offset + baseline) so the
    L3->L2 localisation merge can locate each segment later.
    """
    st = _state(chapter)
    st["l2_hash"] = hash_text(getattr(chapter, "narration_script", None))
    st["segments_hash"] = segments_hash(getattr(chapter, "segments", None))
    chapter.sync_state = st
    _write_split_anchors(chapter)


def _write_split_anchors(chapter: Any) -> None:
    """Record each segment's char span in narration_script + its baseline text."""
    script = getattr(chapter, "narration_script", None) or ""
    segs = sorted(getattr(chapter, "segments", None) or [],
                  key=lambda s: getattr(s, "position", 0) or 0)
    offset = 0
    for seg in segs:
        text = getattr(seg, "text", None) or ""
        idx = script.find(text, offset) if text else offset
        if idx < 0:
            idx = offset  # degenerate fallback (text not a contiguous substring)
        seg.split_anchor = {
            "offset_start": idx,
            "offset_end": idx + len(text),
            "baseline_text": text,
        }
        offset = idx + len(text)


def rewrite_script_from_segments(chapter: Any) -> str:
    """L3->L2 localisation merge: write edited segment texts back into L2.

    Replaces each edited segment's span (per ``split_anchor``) with its current
    text, preserving L2 content not covered by any segment (headers, blank
    lines). Requires L2 unchanged since split (``l2_dirty == false``); raises
    ``ValueError("l2_dirty_conflict")`` otherwise. Re-baselines after.
    """
    if sync_status(chapter)["l2_dirty"]:
        raise ValueError("l2_dirty_conflict")
    script = getattr(chapter, "narration_script", None) or ""
    segs = sorted(
        getattr(chapter, "segments", None) or [],
        key=lambda s: (getattr(s, "split_anchor", None) or {}).get("offset_start", 0),
        reverse=True,
    )
    for seg in segs:
        anchor = getattr(seg, "split_anchor", None)
        if not anchor:
            continue
        if (getattr(seg, "text", None) or "") != anchor.get("baseline_text", ""):
            script = script[:anchor["offset_start"]] + (getattr(seg, "text", None) or "") + script[anchor["offset_end"]:]
    chapter.narration_script = script
    mark_split(chapter)  # re-derive offsets/baseline + re-baseline hashes
    return script


def mark_consistent(chapter: Any) -> None:
    """Fresh from the workflow (L2 derived AND L3 split in one go): snapshot all 3."""
    mark_l2_derived(chapter)
    mark_split(chapter)
