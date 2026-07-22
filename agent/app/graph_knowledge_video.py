"""Knowledge-video workflow StateGraph definition and compile.

Pipeline: preflight_check -> gen_narration -> quality_review (interrupt)
-> select_tts_engine (interrupt) -> split_chapters -> synthesis
-> scaffold_remotion -> gen_animation_brief.

Exports ``build_graph`` (tests + runtime injection) and a module-level
``graph`` for langgraph.json (the server injects checkpointer/store).
"""
from __future__ import annotations

from typing import Any

from langgraph.graph import END, START, StateGraph

from app.nodes.knowledge_video.gen_animation_brief import gen_animation_brief_node
from app.nodes.knowledge_video.gen_narration import gen_narration_node
from app.nodes.knowledge_video.preflight import preflight_check_node
from app.nodes.knowledge_video.quality_review import quality_review_node
from app.nodes.knowledge_video.scaffold_remotion import scaffold_remotion_node
from app.nodes.knowledge_video.split_chapters import split_chapters_node
from app.nodes.knowledge_video.synthesis import kv_synthesis_node
from app.nodes.select_tts_engine import make_select_tts_engine_node
from app.state import KnowledgeVideoState

STAGE_ORDER = [
    "preflight_check",
    "gen_narration",
    "quality_review",
    "select_tts_engine",
    "split_chapters",
    "synthesis",
    "scaffold_remotion",
    "gen_animation_brief",
]


def route_after_review(state: KnowledgeVideoState) -> str:
    if state.get("review_status") == "approved":
        return "select_tts_engine"
    return "gen_narration"


def route_after_preflight(state: KnowledgeVideoState) -> str:
    if state.get("error"):
        return END
    return "gen_narration"


def build_graph(
    checkpointer: Any,
    store: Any,
    *,
    backend: Any = None,
) -> Any:
    """Compile the knowledge_video graph. See graph.py for the conventions."""
    builder = (
        StateGraph(KnowledgeVideoState)
        .add_node("preflight_check", preflight_check_node)
        .add_node("gen_narration", gen_narration_node)
        .add_node("quality_review", quality_review_node)
        .add_node("select_tts_engine", make_select_tts_engine_node("split_chapters"))
        .add_node("split_chapters", split_chapters_node)
        .add_node("synthesis", kv_synthesis_node)
        .add_node("scaffold_remotion", scaffold_remotion_node)
        .add_node("gen_animation_brief", gen_animation_brief_node)
        .add_edge(START, "preflight_check")
        .add_conditional_edges("preflight_check", route_after_preflight)
        .add_edge("gen_narration", "quality_review")
        .add_conditional_edges("quality_review", route_after_review)
        .add_edge("select_tts_engine", "split_chapters")
        .add_edge("split_chapters", "synthesis")
        .add_edge("synthesis", "scaffold_remotion")
        .add_edge("scaffold_remotion", "gen_animation_brief")
        .add_edge("gen_animation_brief", END)
    )
    return builder.compile(checkpointer=checkpointer, store=store)


# Module-level graph for langgraph.json (same convention as graph.py).
graph = build_graph(checkpointer=None, store=None)
