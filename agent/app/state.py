"""Shared state TypedDict that flows through the narration pipeline.

Every node receives the full state dict and returns a partial dict of fields
it wants to update; LangGraph merges the update automatically. Structured
fields use plain ``dict`` / ``list[dict]`` (not Pydantic instances) so the
state is picklable by the LangGraph server's checkpoint system.
"""
from __future__ import annotations

from typing import Any, TypedDict

from typing_extensions import Literal


class NarrationWorkflowState(TypedDict, total=False):
    # -- inputs ---------------------------------------------------------------
    project_id: str

    # -- gen_script output ----------------------------------------------------
    source_document: str
    narration_script: str
    script_chapters: list[dict[str, Any]]

    # -- script_review output -------------------------------------------------
    review_feedback: dict[str, Any]     # serialized ReviewResult
    edited_script: str
    review_status: Literal["approved", "rejected"]

    # -- split_segment output -------------------------------------------------
    structured_segments: list[dict[str, Any]]   # carries _chapter_id / _segment_id

    # -- synthesis output -----------------------------------------------------
    synthesis_results: list[dict[str, Any]]

    # -- metadata -------------------------------------------------------------
    current_stage: str
    review_retry_count: int
    error: str | None
