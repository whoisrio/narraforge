"""Pydantic models - single source of truth for graph state + instructor validation.

These models are referenced by both the graph state (``state.py``) and the
instructor ``response_model`` targets in the nodes. Keeping them in one place
means the schema is the only contract between the LLM structured output and
the rest of the system.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ReviewDimension(BaseModel):
    """One review dimension (e.g. 内容忠实度)."""

    name: str
    status: Literal["pass", "warn", "fail"]
    comment: str
    suggestion: str | None = None


class ReviewResult(BaseModel):
    """LLM auto-review output for the script_review node."""

    dimensions: list[ReviewDimension]
    overall_score: int = Field(ge=1, le=5)
    overall_comment: str
    has_critical_issue: bool


class Segment(BaseModel):
    """A narration segment produced by the split_segment node."""

    text: str
    emotion: Literal["neutral", "happy", "sad", "angry", "calm", "excited"] = "neutral"
    role: str = "narration"
    segment_kind: Literal["narration", "dialogue"] = "narration"


class ChapterStructure(BaseModel):
    """A chapter with its segments, as produced by split_segment."""

    chapter_title: str
    segments: list[Segment]


class SegmentChapters(BaseModel):
    """Object wrapper required for JSON-mode structured output (top-level must be an object)."""

    chapters: list[ChapterStructure]


class Preference(BaseModel):
    """A director preference extracted from feedback by _extract_preference."""

    preference: str
    category: Literal["pacing", "style", "length", "tone", "structure", "other"]


class SynthResult(BaseModel):
    """One segment's synthesis result from the synthesis node."""

    chapter_id: str
    segment_id: str
    audio_path: str | None = None
    duration_sec: float | None = None


class SegmentWithId(BaseModel):
    """A segment id returned by the backend's chapters:batch endpoint."""

    id: str


class ChapterWithSegmentIds(BaseModel):
    """A chapter with its segment ids, as returned by chapters:batch."""

    id: str
    segments: list[SegmentWithId]
