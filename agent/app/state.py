"""Shared state TypedDict that flows through the narration pipeline.

Every node receives the full state dict and returns a partial dict of fields
it wants to update; LangGraph merges the update automatically. Structured
fields use plain ``dict`` / ``list[dict]`` (not Pydantic instances) so the
state is picklable by the LangGraph server's checkpoint system.
"""
from __future__ import annotations

import operator
from typing import Annotated, Any, TypedDict

from typing_extensions import Literal

# 各节点 LLM 调用的 token 用量，按键合并（operator.ior）累积进 state，
# 使前端在任意时刻（包括接管已完成线程）都能读到每阶段消耗。
StageUsage = Annotated[dict[str, Any], operator.ior]


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

    # -- select_tts_engine output ----------------------------------------------
    tts_engine: str                     # mimo_tts / voxcpm / cosyvoice / edge_tts

    # -- split_segment output -------------------------------------------------
    structured_segments: list[dict[str, Any]]   # carries _chapter_id / _segment_id

    # -- synthesis output -----------------------------------------------------
    synthesis_results: list[dict[str, Any]]

    # -- metadata -------------------------------------------------------------
    current_stage: str
    review_retry_count: int
    error: str | None
    stage_usage: StageUsage  # node id -> usage dict（含 reasoning_tokens）


class KnowledgeVideoState(TypedDict, total=False):
    """State for the knowledge_video workflow (see graph_knowledge_video.py)."""

    # -- inputs ---------------------------------------------------------------
    project_id: str
    target_dir: str | None          # optional override for the remotion project dir

    # -- preflight_check / gen_narration output --------------------------------
    source_document: str
    source_structure_map: list[dict[str, Any]]  # serialized SourceElement
    narration_script: str
    script_chapters: list[dict[str, Any]]

    # -- quality_review output --------------------------------------------------
    review_result: dict[str, Any]   # serialized QualityReviewResult
    edited_script: str
    review_status: Literal["approved", "rejected"]

    # -- select_tts_engine output -----------------------------------------------
    tts_engine: str                 # mimo_tts / voxcpm / cosyvoice / edge_tts

    # -- split_chapters output --------------------------------------------------
    structured_segments: list[dict[str, Any]]   # carries _chapter_id / _segment_id

    # -- synthesis output -------------------------------------------------------
    synthesis_results: list[dict[str, Any]]

    # -- scaffold_remotion output -----------------------------------------------
    remotion_project_dir: str

    # -- metadata ---------------------------------------------------------------
    current_stage: str
    review_retry_count: int
    error: str | None
    stage_usage: StageUsage  # node id -> usage dict（含 reasoning_tokens）
