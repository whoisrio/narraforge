"""Async HTTP client for the NarraForge backend.

This is the agent's *only* contract with the backend. All persistence
(project source document, chapter/segment creation, TTS synthesis) flows
through here over HTTP, keeping the agent a pure LangGraph service with no
direct DB access.
"""
from __future__ import annotations

import httpx

from app.config import get_backend_url
from app.schemas import ChapterWithSegmentIds, SegmentChapters, SegmentWithId


class BackendClient:
    """Thin async wrapper over the backend REST API.

    Uses an httpx transport with 2 retries for transient network errors;
    non-retryable HTTP errors (4xx/5xx) propagate via ``raise_for_status``.
    """

    def __init__(
        self, base_url: str | None = None, *, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self._base = (base_url or get_backend_url()).rstrip("/")
        self._transport = transport or httpx.AsyncHTTPTransport(retries=2)
        self._client: httpx.AsyncClient | None = None

    async def _ensure(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self._base, transport=self._transport, timeout=300.0
            )
        return self._client

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def get_project(self, project_id: str) -> dict:
        """GET /api/segmented-projects/{project_id} -> project detail dict."""
        c = await self._ensure()
        r = await c.get(f"/api/segmented-projects/{project_id}")
        r.raise_for_status()
        return r.json()

    async def batch_create_structure(
        self, project_id: str, structure: SegmentChapters
    ) -> list[ChapterWithSegmentIds]:
        """POST /api/segmented-projects/{pid}/chapters:batch.

        Replaces the project's chapters with the given structure (single
        transaction) and returns the assigned chapter/segment ids.
        """
        c = await self._ensure()
        r = await c.post(
            f"/api/segmented-projects/{project_id}/chapters:batch",
            json=structure.model_dump(),
        )
        r.raise_for_status()
        data = r.json()
        return [
            ChapterWithSegmentIds(
                id=ch["id"],
                segments=[SegmentWithId(id=s["id"]) for s in ch["segments"]],
            )
            for ch in data["chapters"]
        ]

    async def synthesize_segment(
        self,
        project_id: str,
        chapter_id: str,
        segment_id: str,
        params: dict | None = None,
    ) -> None:
        """POST .../segments/{sid}/synthesize - run TTS for one segment.

        *params* overrides the chapter/role voice params (e.g. force a
        specific edge-tts voice for the kv workflow).
        """
        c = await self._ensure()
        r = await c.post(
            f"/api/segmented-projects/{project_id}/chapters/{chapter_id}/segments/{segment_id}/synthesize",
            json={"params": params, "text": None, "ssml": None, "keep_previous": True},
        )
        r.raise_for_status()

    async def scaffold_remotion(
        self,
        project_id: str,
        target_dir: str | None = None,
        animation_brief: dict | None = None,
    ) -> dict:
        """POST /api/segmented-projects/{pid}/scaffold-remotion.

        Creates (or refreshes) the Remotion project; when *animation_brief*
        is given, also writes ``animation_brief.json`` into the project root.
        """
        body: dict = {}
        if target_dir:
            body["target_dir"] = target_dir
        if animation_brief is not None:
            body["animation_brief"] = animation_brief
        c = await self._ensure()
        r = await c.post(
            f"/api/segmented-projects/{project_id}/scaffold-remotion",
            json=body,
        )
        r.raise_for_status()
        return r.json()

    async def apply_animation_spec(
        self, project_id: str, items: list[dict], theme: str | None = None
    ) -> dict:
        """POST /api/segmented-projects/{pid}/apply-animation-spec."""
        c = await self._ensure()
        r = await c.post(
            f"/api/segmented-projects/{project_id}/apply-animation-spec",
            json={"theme": theme, "segments": items},
        )
        r.raise_for_status()
        return r.json()
