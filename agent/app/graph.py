"""Narration workflow StateGraph definition and compile.

Exports ``build_graph`` (for tests + custom runtime injection) and a
module-level ``graph`` (compiled without checkpointer/store) for
``langgraph.json``. The LangGraph server injects the platform's checkpointer
and store at runtime; nodes access ``runtime.store`` through the standard
LangGraph runtime.
"""
from __future__ import annotations

from typing import Any

from langgraph.graph import END, START, StateGraph

from app.nodes.gen_script import gen_script_node
from app.nodes.script_review import script_review_node
from app.nodes.select_tts_engine import make_select_tts_engine_node
from app.nodes.split_segment import split_segment_node
from app.nodes.synthesis import synthesis_node
from app.state import NarrationWorkflowState

STAGE_ORDER = ["gen_script", "script_review", "select_tts_engine", "split_segment", "synthesis"]


def route_after_review(state: NarrationWorkflowState) -> str:
    if state.get("review_status") == "approved":
        return "select_tts_engine"
    return "gen_script"


def build_graph(
    checkpointer: Any,
    store: Any,
    *,
    backend: Any = None,
) -> Any:
    """Compile the narration graph.

    *backend*, if given, is attached to the runtime so nodes can reach the
    NarraForge backend via ``runtime.backend`` instead of creating a fresh
    ``BackendClient`` each time. This is used in tests and, optionally, in
    production (the server's runtime is managed by the platform).
    """
    builder = (
        StateGraph(NarrationWorkflowState)
        .add_node("gen_script", gen_script_node)
        .add_node("script_review", script_review_node)
        .add_node("select_tts_engine", make_select_tts_engine_node("split_segment"))
        .add_node("split_segment", split_segment_node)
        .add_node("synthesis", synthesis_node)
        .add_edge(START, "gen_script")
        .add_edge("gen_script", "script_review")
        .add_conditional_edges("script_review", route_after_review)
        .add_edge("select_tts_engine", "split_segment")
        .add_edge("split_segment", "synthesis")
        .add_edge("synthesis", END)
    )
    return builder.compile(checkpointer=checkpointer, store=store)


# Module-level graph for langgraph.json. The LangGraph server injects its own
# checkpointer + store, so we compile with None here; the platform replaces
# them at runtime. Nodes access the store via runtime.store (injected by the
# server). When no BackendClient is injected via runtime.backend, nodes fall
# back to creating a fresh BackendClient() per call.
graph = build_graph(checkpointer=None, store=None)