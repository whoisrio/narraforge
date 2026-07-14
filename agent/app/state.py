"""Shared state TypedDict that flows through the narration pipeline.

Every node receives the full state dict and returns a partial dict of fields
it wants to update; LangGraph merges the update automatically. Structured
fields use the Pydantic models from ``app.schemas`` so the graph state and
instructor validation targets share one source of truth.
"""
from __future__ import annotations

from typing import TypedDict

from typing_extensions import Literal

from app.schemas import ChapterStructure, ReviewResult, SynthResult


class NarrationWorkflowState(TypedDict, total=False):
    # -- inputs ---------------------------------------------------------------
    project_id: str

    # -- gen_script output ----------------------------------------------------
    source_document: str
    narration_script: str
    script_chapters: list[ChapterStructure]

    # -- script_review output -------------------------------------------------
    review_feedback: ReviewResult
    edited_script: str
    review_status: Literal["approved", "rejected"]

    # -- split_segment output -------------------------------------------------
    # Carries backend-assigned ids (_chapter_id / _segment_id) after persistence.
    structured_segments: list[ChapterStructure]

    # -- synthesis output -----------------------------------------------------
    synthesis_results: list[SynthResult]

    # -- metadata -------------------------------------------------------------
    current_stage: str
    review_retry_count: int
    error: str | None
