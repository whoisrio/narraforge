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
    client = type("C", (), {})

    async def fake_create(**kw):
        return review

    client.create = fake_create
    monkeypatch.setattr("app.nodes.script_review.get_instructor_client", lambda: (client, "m"))


def _mock_llm_split(monkeypatch, structure):
    import app.nodes.split_segment  # noqa: F811
    client = type("C", (), {})

    async def fake_create(**kw):
        return structure

    client.create = fake_create
    monkeypatch.setattr("app.nodes.split_segment.get_instructor_client", lambda: (client, "m"))


def _mock_stream(monkeypatch):
    import app.nodes.gen_script  # noqa: F811
    async def fake_stream(messages, on_chunk=None, **kw):
        if on_chunk:
            await on_chunk("hello ")
            await on_chunk("world")
        return "# Chapter 1\nrough script content"

    monkeypatch.setattr("app.nodes.gen_script.stream_llm", fake_stream)


def _silence_writers(monkeypatch):
    # Import the node modules first so monkeypatch can see their attributes
    import app.nodes.gen_script  # noqa: F811
    import app.nodes.script_review  # noqa: F811
    import app.nodes.split_segment  # noqa: F811
    import app.nodes.synthesis  # noqa: F811

    empty = lambda p: None
    monkeypatch.setattr("app.nodes.gen_script.get_stream_writer", lambda: empty)
    monkeypatch.setattr("app.nodes.script_review.get_stream_writer", lambda: empty)
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

    async def batch_create_structure(self, pid, structure):
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


@pytest.mark.asyncio
async def test_graph_runs_to_interrupt_then_approve_completes(monkeypatch):
    """Full graph: start -> gen_script -> interrupt at script_review -> approve -> complete."""
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

    # Resume with approve
    result2 = await g.ainvoke(
        Command(resume={"action": "approve", "edited_script": "e", "comment": "good"}),
        config,
    )
    assert result2["current_stage"] == "completed"
    assert len(result2["synthesis_results"]) == 1


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
