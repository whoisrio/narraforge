"""Shared fixtures: an in-memory fake backend + a Typer CLI runner.

typer>=0.29 vendors a click whose CliRunner separates stdout (result.output)
from stderr (result.stderr).
"""
from __future__ import annotations

import json as jsonlib

import httpx
import pytest
from typer.testing import CliRunner

import narraforge_cli.main as main_module
from narraforge_cli.client import Client
from narraforge_cli.config import Config


class FakeBackend:
    """Route-table-backed fake backend over httpx.MockTransport.

    Exact routes (`route`) win over dynamic routes (`route_fn`); a dynamic
    route's `match(path, payload)` receives the request path and the parsed
    JSON body (None for bodyless requests).
    """

    def __init__(self) -> None:
        self.calls: list[dict] = []
        self._routes: dict[tuple[str, str], tuple[int, object]] = {}
        self._fn_routes: list[tuple[str, object, int, object]] = []
        self.transport = httpx.MockTransport(self._handle)

    def route(self, method: str, path: str, status: int, body: object) -> None:
        self._routes[(method, path)] = (status, body)

    def route_fn(self, method: str, match, status: int, body: object) -> None:
        """Register a dynamic route: match(path, payload) -> bool."""
        self._fn_routes.append((method, match, status, body))

    def _handle(self, request: httpx.Request) -> httpx.Response:
        payload = None
        if request.content:
            try:
                payload = jsonlib.loads(request.content)
            except ValueError:
                payload = None
        self.calls.append(
            {
                "method": request.method,
                "path": request.url.path,
                "json": payload,
                "headers": dict(request.headers),
            }
        )
        key = (request.method, request.url.path)
        if key in self._routes:
            status, body = self._routes[key]
            return httpx.Response(status, json=body)
        for method, match, status, body in self._fn_routes:
            if method == request.method and match(request.url.path, payload):
                return httpx.Response(status, json=body)
        return httpx.Response(
            404,
            json={
                "detail": {
                    "code": "route_not_mocked",
                    "message": f"no fake route for {request.method} {request.url.path}",
                }
            },
        )

    def calls_for(self, method: str, path: str) -> list[dict]:
        return [c for c in self.calls if c["method"] == method and c["path"] == path]


def make_project_detail() -> dict:
    """A minimal but realistic ProjectDetail used by command tests."""
    return {
        "id": "proj-1",
        "name": "Demo",
        "schema_version": 2,
        "layout": "vertical",
        "active_chapter_id": "ch-1",
        "original_text": None,
        "animation_theme": None,
        "remotion_project_path": None,
        "source_document": None,
        "source_document_path": None,
        "narration_document_path": "narration.md",
        "narration_script": None,
        "default_narrator_role_id": None,
        "default_narrator_snapshot": None,
        "configs": {},
        "base_updated_at": None,
        "created_at": "2026-11-21T00:00:00",
        "updated_at": "2026-11-21T00:00:00",
        "chapters": [],
    }


@pytest.fixture
def backend() -> FakeBackend:
    b = FakeBackend()
    b.route("GET", "/health", 200, {"status": "healthy", "app_env": "local"})
    b.route(
        "GET",
        "/api/config/capabilities",
        200,
        {
            "deploy_target": "local",
            "engines": ["edge_tts", "mimo_tts", "qwen", "voxcpm", "indextts"],
            "clone_engines": ["qwen", "mimo", "voxcpm"],
            "features": {"backend_storage": True, "agent_workflow": True},
        },
    )
    return b


@pytest.fixture
def runner(backend: FakeBackend, monkeypatch) -> CliRunner:
    def factory(config: Config) -> Client:
        return Client(config, transport=backend.transport)

    monkeypatch.setattr(main_module, "Client", factory)
    return CliRunner()
