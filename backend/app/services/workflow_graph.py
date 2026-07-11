"""LangGraph state definition and graph factory for the narration workflow.

Defines ``NarrationWorkflowState``, the shared state TypedDict that flows
through the narration pipeline, and ``create_narration_graph``, a factory
function that wires the four pipeline stages into a compiled
``StateGraph`` with conditional routing after the script-review step.

Node status:
- All four nodes (gen_script, script_review, split_segment, synthesis) are real
  implementations in ``workflow_nodes``.
"""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from typing_extensions import TypedDict

# Lazy import of gen_script_node to avoid circular dependency at module level;
# it is imported inside create_narration_graph().


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

STAGE_ORDER: list[str] = [
    "gen_script",
    "script_review",
    "split_segment",
    "synthesis",
]

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------


class NarrationWorkflowState(TypedDict, total=False):
    """Shared state that flows through the narration pipeline.

    Every node receives the full state dict and returns a partial dict of
    fields it wants to update.  LangGraph merges the update automatically.
    """

    # -- inputs ---------------------------------------------------------------
    project_id: str
    run_id: str
    source_document: str

    # -- GenScript output -----------------------------------------------------
    narration_script: str
    script_chapters: list[dict[str, Any]]

    # -- ScriptReview output --------------------------------------------------
    review_feedback: Any  # JSON dict or str
    edited_script: str
    review_status: str  # "approved" | "rejected"

    # -- SplitSegment output --------------------------------------------------
    structured_segments: list[dict[str, Any]]

    # -- Synthesis output -----------------------------------------------------
    synthesis_results: list[dict[str, Any]]

    # -- metadata -------------------------------------------------------------
    current_stage: str
    error: str | None


# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------


def route_after_review(state: NarrationWorkflowState) -> str:
    """Decide the next node after the script-review step.

    Returns ``"split_segment"`` when the script is approved, otherwise
    loops back to ``"gen_script"`` for revision.
    """
    if state.get("review_status") == "approved":
        return "split_segment"
    return "gen_script"


# ---------------------------------------------------------------------------
# Placeholder nodes (to be replaced with real implementations later)
# ---------------------------------------------------------------------------


async def gen_script_placeholder(state: NarrationWorkflowState) -> dict[str, Any]:
    """Placeholder for the script-generation node."""
    return {
        "narration_script": "",
        "script_chapters": [],
        "current_stage": "script_review",
    }


async def split_segment_placeholder(state: NarrationWorkflowState) -> dict[str, Any]:
    """Placeholder for the segment-splitting node."""
    return {
        "structured_segments": [],
        "current_stage": "synthesis",
    }


async def synthesis_placeholder(state: NarrationWorkflowState) -> dict[str, Any]:
    """Placeholder for the TTS synthesis node."""
    return {
        "synthesis_results": [],
        "current_stage": "completed",
    }


# ---------------------------------------------------------------------------
# Graph factory
# ---------------------------------------------------------------------------


def create_narration_graph(
    checkpointer: Any,
    store: Any,
) -> CompiledStateGraph:
    """Build and compile the narration workflow graph.

    Args:
        checkpointer: A LangGraph ``Checkpointer`` instance used for
            persisting graph state between invocations.
        store: A LangGraph ``BaseStore`` instance (e.g.
            :class:`~app.services.workflow_store.AsyncSqliteStore`) used
            for durable key-value storage.

    Returns:
        A compiled ``StateGraph`` ready to be invoked.
    """
    # Lazy import to avoid circular dependency (workflow_nodes imports this module)
    from app.services.workflow_nodes import (
        gen_script_node,
        script_review_node,
        split_segment_node,
        synthesis_node,
    )

    graph = (
        StateGraph(NarrationWorkflowState)
        .add_node("gen_script", gen_script_node)
        .add_node("script_review", script_review_node)
        .add_node("split_segment", split_segment_node)
        .add_node("synthesis", synthesis_node)
        .add_edge(START, "gen_script")
        .add_edge("gen_script", "script_review")
        .add_conditional_edges("script_review", route_after_review)
        .add_edge("split_segment", "synthesis")
        .add_edge("synthesis", END)
        .compile(checkpointer=checkpointer, store=store)
    )
    return graph
