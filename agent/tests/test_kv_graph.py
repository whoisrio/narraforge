"""Topology tests for the knowledge_video graph."""
from app.graph_knowledge_video import (
    STAGE_ORDER,
    build_graph,
    route_after_preflight,
    route_after_review,
)


def test_stage_order():
    assert STAGE_ORDER == [
        "preflight_check",
        "gen_narration",
        "quality_review",
        "split_chapters",
        "synthesis",
        "scaffold_remotion",
        "gen_animation_brief",
    ]


def test_route_after_review():
    assert route_after_review({"review_status": "approved"}) == "split_chapters"
    assert route_after_review({"review_status": "rejected"}) == "gen_narration"
    assert route_after_review({}) == "gen_narration"


def test_route_after_preflight():
    assert route_after_preflight({"error": None}) == "gen_narration"
    assert route_after_preflight({}) == "gen_narration"
    assert route_after_preflight({"error": "用户取消"}) == "__end__"


def test_graph_compiles_with_all_nodes():
    graph = build_graph(checkpointer=None, store=None)
    node_names = set(graph.get_graph().nodes.keys())
    for name in STAGE_ORDER:
        assert name in node_names
