"""Semantic ID generators for the git versioning file tree.

Stability contract:
- Project slug: lowercase [a-z0-9-], 1..40 chars, pinyin-based for Chinese.
- Chapter id:   `ch{NN}-{slug}` from (position, design_title/name).
- Segment id:   `s{NNN}` — frozen at first split; deleted IDs never reused.
"""
from __future__ import annotations

import re
from typing import Iterable

from pypinyin import lazy_pinyin

_ALPHA_NUM = re.compile(r"[a-z0-9]+")
_SEGMENT_ID_RE = re.compile(r"^s\d{3}$")
_SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

MAX_SLUG_LEN = 40


def _to_slug(text: str) -> str:
    if not text:
        return ""
    tokens: list[str] = []
    for piece in lazy_pinyin(text):
        for m in _ALPHA_NUM.finditer(piece.lower()):
            tokens.append(m.group(0))
    slug = "-".join(tokens)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug[:MAX_SLUG_LEN].rstrip("-")


def project_slug(name: str | None) -> str:
    slug = _to_slug(name or "")
    return slug or "project"


def chapter_id(position: int, title: str | None) -> str:
    prefix = f"ch{int(position):02d}"
    slug = _to_slug(title or "")
    return f"{prefix}-{slug}" if slug else prefix


def next_segment_id(existing: Iterable[str]) -> str:
    used = {int(sid[1:]) for sid in existing if _SEGMENT_ID_RE.match(sid)}
    n = (max(used) + 1) if used else 1
    return f"s{n:03d}"


def is_valid_slug(s: str) -> bool:
    return bool(s) and len(s) <= MAX_SLUG_LEN and bool(_SLUG_RE.match(s))


def is_valid_segment_id(s: str) -> bool:
    return bool(_SEGMENT_ID_RE.match(s))
