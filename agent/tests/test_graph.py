"""End-to-end graph integration test with mocked LLM + backend."""
import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.memory import InMemoryStore
from langgraph.types import Command

from app.schemas import (
    ChapterStructure,
    ChapterWithSegmentIds,
    ReviewDimension,
    ReviewResult,
    Segment,
    SegmentChapters,
    SegmentWithId,
)


def _mock_llm_review(monkeypatch, review):
    import app.nodes.script_review  # noqa: F811

    async def fake_structured(schema, messages, **kw):
        return review, None

    monkeypatch.setattr("app.nodes.script_review.structured_llm", fake_structured)


def _mock_llm_split(monkeypatch, structure):
    import app.nodes.split_segment  # noqa: F811

    async def fake_structured(schema, messages, **kw):
        return structure, None

    monkeypatch.setattr("app.nodes.split_segment.structured_llm", fake_structured)


def _mock_stream(monkeypatch):
    import app.nodes.gen_script  # noqa: F811
    async def fake_stream(messages, **kw):
        return "# Chapter 1\nrough script content", None

    monkeypatch.setattr("app.nodes.gen_script.stream_llm", fake_stream)


def _silence_writers(monkeypatch):
    # Import the node modules first so monkeypatch can see their attributes
    import app.nodes.gen_script  # noqa: F811
    import app.nodes.script_review  # noqa: F811
    import app.nodes.select_tts_engine  # noqa: F811
    import app.nodes.split_segment  # noqa: F811
    import app.nodes.synthesis  # noqa: F811

    empty = lambda p: None
    monkeypatch.setattr("app.nodes.gen_script.get_stream_writer", lambda: empty)
    monkeypatch.setattr("app.nodes.script_review.get_stream_writer", lambda: empty)
    monkeypatch.setattr("app.nodes.select_tts_engine.get_stream_writer", lambda: empty)
    monkeypatch.setattr("app.nodes.split_segment.get_stream_writer", lambda: empty)
    monkeypatch.setattr("app.nodes.synthesis.get_stream_writer", lambda: empty)


def _bypass_langsmith_prompts(monkeypatch):
    """Make get_prompt return the code default instantly (bypass Client)."""
    from app.prompts import narration as prom_mod

    monkeypatch.setattr(
        prom_mod, "get_prompt", lambda name, **vars: prom_mod._DEFAULTS[name].format(**vars) if vars else prom_mod._DEFAULTS[name]
    )


class _FakeBackend:
    async def get_project(self, pid):
        return {"id": pid, "source_document": "source doc text"}

    async def batch_create_structure(self, pid, structure, narration_scripts=None, engine=None, full_script=None):
        return [ChapterWithSegmentIds(id="ch1", segments=[SegmentWithId(id="s1")])]

    async def synthesize_segment(self, pid, cid, sid):
        pass

    async def close(self):
        pass


def _mock_backend_client(monkeypatch):
    """Replace BackendClient() with a fake backend instance."""
    import app.backend_client as bc
    fake = _FakeBackend()
    monkeypatch.setattr(bc, "BackendClient", lambda *a, **kw: fake)


def test_route_after_review_points_to_select_tts_engine():
    from app import graph as graph_mod

    assert graph_mod.route_after_review({"review_status": "approved"}) == "select_tts_engine"
    assert graph_mod.route_after_review({"review_status": "rejected"}) == "gen_script"


def test_graph_compiles_with_select_tts_engine():
    from app import graph as graph_mod

    g = graph_mod.build_graph(checkpointer=None, store=None)
    node_names = set(g.get_graph().nodes.keys())
    for name in graph_mod.STAGE_ORDER:
        assert name in node_names


@pytest.mark.asyncio
async def test_graph_runs_to_interrupt_then_approve_completes(monkeypatch):
    """Full graph: start -> gen_script -> interrupt at script_review -> approve
    -> interrupt at select_tts_engine -> choose engine -> complete."""
    review = ReviewResult(
        dimensions=[ReviewDimension(name="内容忠实度", status="pass", comment="ok")],
        overall_score=4,
        overall_comment="good",
        has_critical_issue=False,
    )
    structure = SegmentChapters(
        chapters=[ChapterStructure(chapter_title="c", segments=[Segment(text="t")])]
    )
    _mock_stream(monkeypatch)
    _mock_llm_review(monkeypatch, review)
    _mock_llm_split(monkeypatch, structure)
    _silence_writers(monkeypatch)
    _bypass_langsmith_prompts(monkeypatch)
    _mock_backend_client(monkeypatch)

    from app import graph as graph_mod

    backend = _FakeBackend()
    g = graph_mod.build_graph(InMemorySaver(), InMemoryStore(), backend=backend)

    config = {"configurable": {"thread_id": "t1"}}
    result = await g.ainvoke(
        {
            "project_id": "p1",
            "current_stage": "gen_script",
        },
        config,
    )
    # Interrupted at script_review
    assert "__interrupt__" in result

    # Resume with approve -> runs into the select_tts_engine interrupt
    result2 = await g.ainvoke(
        Command(resume={"action": "approve", "edited_script": "e", "comment": "good"}),
        config,
    )
    assert "__interrupt__" in result2
    interrupt_payload = result2["__interrupt__"][0].value
    assert interrupt_payload["kind"] == "select_tts_engine"

    # Resume with an engine choice -> split_segment -> synthesis -> end
    result3 = await g.ainvoke(Command(resume={"engine": "edge_tts"}), config)
    assert result3["current_stage"] == "completed"
    assert result3["tts_engine"] == "edge_tts"
    assert len(result3["synthesis_results"]) == 1


@pytest.mark.asyncio
async def test_graph_reject_loops_back_to_gen_script(monkeypatch):
    """Reject -> gen_script re-runs -> interrupt again."""
    review = ReviewResult(
        dimensions=[ReviewDimension(name="内容忠实度", status="pass", comment="ok")],
        overall_score=4,
        overall_comment="good",
        has_critical_issue=False,
    )
    structure = SegmentChapters(
        chapters=[ChapterStructure(chapter_title="c", segments=[Segment(text="t")])]
    )
    _mock_stream(monkeypatch)
    _mock_llm_review(monkeypatch, review)
    _mock_llm_split(monkeypatch, structure)
    _silence_writers(monkeypatch)
    _bypass_langsmith_prompts(monkeypatch)
    _mock_backend_client(monkeypatch)

    from app import graph as graph_mod

    g = graph_mod.build_graph(InMemorySaver(), InMemoryStore(), backend=_FakeBackend())

    config = {"configurable": {"thread_id": "t2"}}
    result = await g.ainvoke(
        {"project_id": "p1", "current_stage": "gen_script"}, config
    )
    assert "__interrupt__" in result

    # Reject
    result2 = await g.ainvoke(
        Command(resume={"action": "reject", "feedback": "fix it"}),
        config,
    )
    assert "__interrupt__" in result2  # loops back -> gen_script -> review -> interrupt again
