"""SelectTTSEngine node: ask the director which TTS engine to use.

Shared by both graphs (narration + knowledge_video) via
``make_select_tts_engine_node(next_stage)``: the only difference is the split
stage that follows (``split_segment`` vs ``split_chapters``). The default
engine is read best-effort from the project's first chapter voice config;
the interrupt payload lets the frontend render an engine picker.
"""
from __future__ import annotations

from typing import Any, Callable

from langgraph.config import get_stream_writer
from langgraph.types import interrupt

from app import backend_client

AVAILABLE_ENGINES = ["mimo_tts", "voxcpm", "cosyvoice", "edge_tts"]
DEFAULT_ENGINE = "mimo_tts"
TIMEOUT_S = 120


async def _default_engine(runtime: Any, project_id: str) -> str:
    """Best-effort default: first chapter's ``voice.engine`` (else mimo_tts).

    Never raises -- any backend failure falls back to ``DEFAULT_ENGINE``.
    """
    try:
        backend = getattr(runtime, "backend", None) or backend_client.BackendClient()
        project = await backend.get_project(project_id)
        chapters = project.get("chapters") or []
        if chapters:
            engine = (chapters[0].get("voice") or {}).get("engine")
            if engine in AVAILABLE_ENGINES:
                return engine
    except Exception:
        pass
    return DEFAULT_ENGINE


def make_select_tts_engine_node(next_stage: str) -> Callable:
    """Build the select_tts_engine node for a graph.

    *next_stage* is the split stage that runs after the engine is chosen
    (``split_segment`` for narration, ``split_chapters`` for knowledge_video).
    """

    async def select_tts_engine_node(state, runtime) -> dict:
        writer = get_stream_writer()

        async def emit(p):
            writer(p)

        await emit(
            {
                "type": "stage_start",
                "stage": "select_tts_engine",
                "message": "等待选择 TTS 引擎...",
            }
        )

        default = await _default_engine(runtime, state["project_id"])
        decision = interrupt(
            {
                "kind": "select_tts_engine",
                "available_engines": AVAILABLE_ENGINES,
                "default_engine": default,
                "timeout_s": TIMEOUT_S,
            }
        )

        engine = decision.get("engine") if isinstance(decision, dict) else None
        if engine not in AVAILABLE_ENGINES:
            engine = default

        await emit(
            {
                "type": "stage_complete",
                "stage": "select_tts_engine",
                "message": f"TTS 引擎已确认: {engine}",
                "data": {"engine": engine},
            }
        )
        return {"tts_engine": engine, "current_stage": next_stage, "error": None}

    return select_tts_engine_node
