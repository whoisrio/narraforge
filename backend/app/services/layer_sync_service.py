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
    """L3 was (re)split from L2: snapshot l2_hash + segments_hash. l1_hash untouched."""
    st = _state(chapter)
    st["l2_hash"] = hash_text(getattr(chapter, "narration_script", None))
    st["segments_hash"] = segments_hash(getattr(chapter, "segments", None))
    chapter.sync_state = st


def mark_consistent(chapter: Any) -> None:
    """Fresh from the workflow (L2 derived AND L3 split in one go): snapshot all 3."""
    mark_l2_derived(chapter)
    mark_split(chapter)
