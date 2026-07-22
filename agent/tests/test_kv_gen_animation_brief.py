"""Tests for the kv gen_animation_brief node."""
import pytest

from app.nodes.knowledge_video.gen_animation_brief import (
    _build_timeline,
    gen_animation_brief_node,
)
from app.schemas import AnimationBrief


PROJECT = {
    "chapters": [
        {
            "id": "c1",
            "name": "第一章",
            "segments": [
                {"id": "s1", "text": "第一段", "audio": {"current": {"duration_sec": 2.0}}},
                {"id": "s2", "text": "第二段", "audio": {"current": {"duration_sec": 3.0}}},
            ],
        }
    ]
}

BRIEF = AnimationBrief(
    chapters=[
        {
            "chapter_position": 0,
            "title": "第一章",
            "segments": [
                {
                    "segment_position": 0,
                    "narration_text": "第一段",
                    "visual_content": {"type": "text", "description": "关键句", "source_ref": None},
                    "animation": {"effect": "fade_in", "notes": ""},
                },
                {
                    "segment_position": 1,
                    "narration_text": "第二段",
                    "visual_content": {"type": "code", "description": "展示代码", "source_ref": None},
                    "animation": {"effect": "typewriter", "notes": "逐行"},
                },
            ],
        }
    ]
)


def test_build_timeline_accumulates_durations():
    timeline = _build_timeline(PROJECT)
    segs = timeline[0]["segments"]
    assert segs[0]["start_sec"] == 0.0
    assert segs[0]["end_sec"] == 2.0
    assert segs[1]["start_sec"] == 2.0
    assert segs[1]["end_sec"] == 5.0
    assert timeline[0]["title"] == "第一章"


class _FakeBackend:
    def __init__(self, project):
        self._project = project
        self.spec_calls = []
        self.scaffold_calls = []

    async def get_project(self, pid):
        return self._project

    async def apply_animation_spec(self, pid, items, theme=None):
        self.spec_calls.append(items)
        return {"segments_updated": len(items)}

    async def scaffold_remotion(self, pid, target_dir=None, animation_brief=None):
        self.scaffold_calls.append({"target_dir": target_dir, "animation_brief": animation_brief})
        return {"project_dir": "/tmp/rv", "created": False, "chapters": 1}


class _FakeRuntime:
    def __init__(self, backend):
        self.store = None
        self.backend = backend


def _patch(monkeypatch, brief):
    monkeypatch.setattr(
        "app.nodes.knowledge_video.gen_animation_brief.get_stream_writer",
        lambda: (lambda p: None),
    )
    async def fake_structured(schema, messages, **kw):
        return brief, None

    monkeypatch.setattr(
        "app.nodes.knowledge_video.gen_animation_brief.structured_llm",
        fake_structured,
    )
    monkeypatch.setattr(
        "app.nodes.knowledge_video.gen_animation_brief.knowledge_video.get_prompt",
        lambda name, **kw: "PROMPT",
    )


@pytest.mark.asyncio
async def test_brief_persisted_to_segments_and_remotion(monkeypatch):
    _patch(monkeypatch, BRIEF)
    backend = _FakeBackend(PROJECT)
    state = {"project_id": "p1", "source_structure_map": []}
    result = await gen_animation_brief_node(state, _FakeRuntime(backend))

    items = backend.spec_calls[0]
    assert len(items) == 2
    assert items[0]["segment_id"] == "s1"
    assert items[0]["start_sec"] == 0.0
    assert items[0]["end_sec"] == 2.0
    assert items[1]["segment_id"] == "s2"
    assert items[1]["animation"]["effect"] == "typewriter"

    brief_sent = backend.scaffold_calls[0]["animation_brief"]
    assert brief_sent["chapters"][0]["segments"][0]["start_sec"] == 0.0

    assert result["current_stage"] == "completed"
    assert result["error"] is None
    assert result["animation_brief"]["chapters"][0]["title"] == "第一章"


@pytest.mark.asyncio
async def test_backend_failure_sets_error(monkeypatch):
    _patch(monkeypatch, BRIEF)

    class _BadBackend(_FakeBackend):
        async def apply_animation_spec(self, pid, items, theme=None):
            raise RuntimeError("db down")

    state = {"project_id": "p1", "source_structure_map": []}
    result = await gen_animation_brief_node(state, _FakeRuntime(_BadBackend(PROJECT)))
    assert result["error"] is not None
    assert result["current_stage"] == "gen_animation_brief"
