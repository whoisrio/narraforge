# NarraForge CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a thin `nf` CLI (in a new top-level `cli/` uv package) that drives the existing NarraForge backend over HTTP to execute the full narration workflow — create project → paste narration → split → set engine → synthesize → export audio into a Remotion project — plus an agent Skill that encodes the workflow knowledge.

**Architecture:** The CLI is a pure HTTP client of the backend FastAPI app (no direct DB access, no business-logic duplication). Commands are atomic and compose the workflow: `chapters:batch` does chapter+segment rebuild, per-segment `synthesize` loops sequentially, `export-all-chapters` / `scaffold-remotion` handle export. Output contract: `--json` prints machine-readable JSON to stdout, all progress/status goes to stderr. A Skill document at `.agents/skills/narraforge/SKILL.md` teaches coding agents the canonical command sequence and pitfalls.

**Tech Stack:** Python 3.12+, `uv` package management, `typer` (CLI framework, uses `click>=8.2` where stderr is captured separately from stdout), `httpx` (sync client), `pytest` + `httpx.MockTransport` (in-memory fake backend for tests).

**Verified API contracts used by this plan** (from `docs/api-reference.md` and backend source):

- `GET /health` → `{"status": "healthy", "app_env": "..."}`.
- `GET /api/config/capabilities` → `{"deploy_target": "local"|"workers", "engines": [...], "clone_engines": [...], "features": {"backend_storage": true, ...}}`.
- `GET /api/segmented-projects` → `{"items": [ProjectSummary]}`; `ProjectSummary` has `id`, `name`, `schema_version`, `layout`, `active_chapter_id`, `remotion_project_path`, `summary_stats`, `created_at`, `updated_at`.
- `POST /api/segmented-projects` (201) takes a full `ProjectIn` — the client generates the `id` (UUID) and must send `schema_version: 2`; duplicate id → 409 `project_already_exists`.
- `PUT /api/segmented-projects/{id}/narration-script` body `{"text": ...}` → `{"path": ..., "project_updated_at": ...}`; the project detail read-through field is `narration_script`.
- `PATCH /api/segmented-projects/{id}` (tri-state) accepts `name/layout/configs/default_narrator_role_id/logo/remotion_project_path/animation_theme`. Important: `configs` **replaces the whole bucket** — the CLI must merge client-side.
- `PATCH /api/segmented-projects/{id}/chapters/{cid}` (tri-state) accepts `name/voice/split_config/design_title/original_text`; `voice` is a free-form dict whose `engine` key selects the engine.
- `POST /api/segmented-projects/{id}/chapters:batch` rebuilds all chapters+segments in one transaction; supports per-chapter `chapter_title/narration_script/original_text/engine/split_config/segments`, top-level `narration_script` (project-level script), `preserve_audio`, `split_segments` (auto rule-split when payload chapters carry no `segments`), `dry_run`. Response: `{"chapters": [{"id", "segments": [{"id"}]}], "reuse": {...}}`; with `dry_run` the `chapters` array is empty and only `reuse` is meaningful.
- `POST /api/text-split/markdown-detect` body `{"text", "min_chars", "front_matter_mode"}` → `{"doc_title", "candidates": [{"index","title","level","start_char","end_char","char_count","preview"}], ...}`.
- `POST /api/text-split/markdown-split` body `{"text", "levels", "min_chars", "front_matter_mode"}` → `{"doc_title", "chapters": [{"title","start_char","end_char",...}], "used_levels"}`. The frontend slices the original text by `start_char/end_char` and applies via `chapters:batch` — the CLI does the same.
- `POST /api/text-split/llm` body `{"text"}` → `{"segments": [{"text", "reason", "emotion"}], "model"}`.
- `POST /api/segmented-projects/{id}/chapters/{cid}/segments/{sid}/synthesize` body `{"force": bool}` → full `ProjectDetail`. Segments with `audio.current.origin == "recorded"` are locked unless `force: true`.
- `POST /api/segmented-projects/{id}/export-all-chapters` (no body) → `{"exported": [{"chapter_id","title","audio_path","srt_path"}], "count"}`. Export dir resolution: absolute `configs.export_directory` used directly; relative → `{remotion_project_path}/{export_directory || "public/audio"}`; otherwise 409 `export_directory_not_configured`. Aborts 409 `chapters_incomplete` if any segment lacks audio.
- `POST /api/segmented-projects/{id}/scaffold-remotion` body `{"target_dir": str|null}` → `{"project_dir", "created", "chapters"}`; also writes per-chapter mp3 + srt into the scaffolded project's `public/audio`.
- Chapter voice JSON per engine (mirrors `backend/app/services/segmented_project_service.py::_flatten_voice_for_synthesis`): `edge_tts` → `voice/rate/volume`; `qwen` → `voice_id/speed/volume/pitch/language/instruction`; `mimo_tts` → `mode/voice_id/instruction/voice_description`; `voxcpm` → `mode/voice_id/style_control/cfg_value/inference_timesteps`; `indextts` → `voice_id/lang/emo_alpha/duration_factor`.
- Error envelope: `detail` is either a plain string (`"project_not_found"`) or `{"code": ..., "message": ...}` (A8 envelope).
- Segment length cap `MAX_SEGMENT_CHARS` (default 80) applies at split/synthesis time — the backend truncates/merges automatically and returns 422 `segment_too_long` for oversized overrides.

**Exit codes:** `0` success; `1` operation error (API error, partial synthesis failure, bad input); `2` backend unreachable.

**File structure (final):**

```text
cli/
  pyproject.toml                      # uv package, entry point `nf`, pytest/ruff config
  src/narraforge_cli/
    __init__.py                       # __version__
    config.py                         # Config + load_config (env vars)
    errors.py                         # NarraForgeCliError / BackendUnavailableError / ApiError
    output.py                         # emit_json (stdout) / info (stderr) / json mode flag
    client.py                         # httpx Client + one method per endpoint + error envelope
    voice.py                          # ENGINE_VOICE_KEYS / ENGINE_DEFAULT_VOICE / build_voice
    segments.py                       # segment_ready / _rows / list_rows / plan_segments / summarize
    splitting.py                      # DEFAULT_DELIMITERS / pick_markdown_level / slice_chapter_bodies / build_batch_payload
    main.py                           # typer app + all commands + execute() error guard
  tests/
    conftest.py                       # FakeBackend (httpx.MockTransport) + runner fixtures
    test_cli_smoke.py                 # `nf --help`
    test_config.py
    test_client.py
    test_health.py
    test_project_cmds.py              # project list/get/create
    test_voice.py
    test_segments.py
    test_splitting.py
    test_cli_split.py
    test_cli_synthesize.py
    test_cli_export.py
.agents/skills/narraforge/SKILL.md    # agent workflow skill (Task 10)
docs/cli.md                           # CLI reference (Task 10)
```

---

## Task 0: Feature branch + package scaffold

**Files:**
- Create: `cli/pyproject.toml`
- Create: `cli/src/narraforge_cli/__init__.py`
- Create: `cli/src/narraforge_cli/main.py` (minimal app skeleton)
- Test: `cli/tests/test_cli_smoke.py`

- [ ] **Step 1: Create the feature branch**

```bash
git checkout master && git pull && git checkout -b feat/narraforge-cli
```

- [ ] **Step 2: Write the smoke test**

Create `cli/tests/test_cli_smoke.py`:

```python
"""Smoke test: the typer app builds and `nf --help` exits 0."""
from typer.testing import CliRunner

from narraforge_cli.main import app


def test_help_succeeds() -> None:
    result = CliRunner().invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "NarraForge" in result.output
```

- [ ] **Step 3: Run the test to verify it fails (module does not exist)**

```bash
cd cli && uv run pytest tests/test_cli_smoke.py -q
```

Expected: FAIL (collection error, `narraforge_cli` not installed).

- [ ] **Step 4: Create the package files**

`cli/pyproject.toml`:

```toml
[project]
name = "narraforge-cli"
version = "0.1.0"
description = "CLI for driving the NarraForge backend over HTTP"
requires-python = ">=3.12"
dependencies = [
    "httpx>=0.28",
    "typer>=0.16",
]

[project.scripts]
nf = "narraforge_cli.main:app"

[dependency-groups]
dev = ["pytest>=8", "ruff>=0.6"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/narraforge_cli"]

[tool.pytest.ini_options]
testpaths = ["tests"]

[tool.ruff]
line-length = 100
target-version = "py312"
```

`cli/src/narraforge_cli/__init__.py`:

```python
"""NarraForge CLI package."""

__version__ = "0.1.0"
```

`cli/src/narraforge_cli/main.py`:

```python
"""NarraForge CLI entry point (typer app)."""
from __future__ import annotations

import typer

app = typer.Typer(
    add_completion=False,
    no_args_is_help=True,
    help="Drive the NarraForge backend from the command line.",
)


@app.callback()
def main_callback() -> None:
    """NarraForge CLI."""
```

`cli/tests/__init__.py` — create an empty file.

- [ ] **Step 5: Install and run the test to verify it passes**

```bash
cd cli && uv sync && uv run pytest -q
```

Expected: 1 passed. Also run `uv run nf --help` and confirm the help text renders.

- [ ] **Step 6: Commit**

```bash
git add cli && git commit -m "chore: scaffold narraforge cli package"
```

---

## Task 1: Config, errors, HTTP client + fake backend fixtures

**Files:**
- Create: `cli/src/narraforge_cli/config.py`
- Create: `cli/src/narraforge_cli/errors.py`
- Create: `cli/src/narraforge_cli/client.py`
- Test: `cli/tests/conftest.py`, `cli/tests/test_config.py`, `cli/tests/test_client.py`

- [ ] **Step 1: Write the config test**

`cli/tests/test_config.py`:

```python
"""Env-driven config resolution."""
from narraforge_cli.config import load_config


def test_defaults(monkeypatch) -> None:
    monkeypatch.delenv("NARRAFORGE_API_URL", raising=False)
    monkeypatch.delenv("NARRAFORGE_API_TOKEN", raising=False)
    cfg = load_config()
    assert cfg.api_url == "http://127.0.0.1:8002"
    assert cfg.token is None


def test_env_values_and_trailing_slash(monkeypatch) -> None:
    monkeypatch.setenv("NARRAFORGE_API_URL", "http://example.com:9000/")
    monkeypatch.setenv("NARRAFORGE_API_TOKEN", "tok")
    cfg = load_config()
    assert cfg.api_url == "http://example.com:9000"
    assert cfg.token == "tok"


def test_explicit_override_wins(monkeypatch) -> None:
    monkeypatch.setenv("NARRAFORGE_API_URL", "http://env.example.com")
    cfg = load_config("http://flag.example.com/")
    assert cfg.api_url == "http://flag.example.com"
```

- [ ] **Step 2: Run to verify failure**

```bash
cd cli && uv run pytest tests/test_config.py -q
```

Expected: FAIL (`No module named 'narraforge_cli.config'`).

- [ ] **Step 3: Implement config and errors**

`cli/src/narraforge_cli/config.py`:

```python
"""CLI configuration resolved from environment variables."""
from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_API_URL = "http://127.0.0.1:8002"


@dataclass(frozen=True)
class Config:
    """Backend connection settings."""

    api_url: str
    token: str | None


def load_config(api_url_override: str | None = None) -> Config:
    """Resolve the backend URL (`--api-url` > env > default) and optional bearer token."""
    url = api_url_override or os.environ.get("NARRAFORGE_API_URL") or DEFAULT_API_URL
    return Config(
        api_url=url.rstrip("/"),
        token=os.environ.get("NARRAFORGE_API_TOKEN") or None,
    )
```

`cli/src/narraforge_cli/errors.py`:

```python
"""CLI error types and their exit-code mapping."""
from __future__ import annotations


class NarraForgeCliError(Exception):
    """Base class for all CLI errors."""

    exit_code = 1


class BackendUnavailableError(NarraForgeCliError):
    """The backend HTTP endpoint could not be reached."""

    exit_code = 2


class ApiError(NarraForgeCliError):
    """The backend returned a non-2xx response."""

    exit_code = 1

    def __init__(self, status_code: int, code: str, message: str) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(f"[{status_code}] {code}: {message}")
```

- [ ] **Step 4: Run config tests, then write the client test**

```bash
cd cli && uv run pytest tests/test_config.py -q
```

Expected: 3 passed.

`cli/tests/conftest.py`:

```python
"""Shared fixtures: an in-memory fake backend + a Typer CLI runner.

Assumes click>=8.2: CliRunner separates stdout (result.output) from stderr
(result.stderr).
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
    """Route-table-backed fake backend over httpx.MockTransport."""

    def __init__(self) -> None:
        self.calls: list[dict] = []
        self._routes: dict[tuple[str, str], tuple[int, object]] = {}
        self.transport = httpx.MockTransport(self._handle)

    def route(self, method: str, path: str, status: int, body: object) -> None:
        self._routes[(method, path)] = (status, body)

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
        if key not in self._routes:
            return httpx.Response(
                404,
                json={
                    "detail": {
                        "code": "route_not_mocked",
                        "message": f"no fake route for {request.method} {request.url.path}",
                    }
                },
            )
        status, body = self._routes[key]
        return httpx.Response(status, json=body)

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
```

- [ ] **Step 5: Write the client tests**

`cli/tests/test_client.py`:

```python
"""HTTP client behavior: routing, error envelopes, auth header, transport failure."""
import httpx
import pytest

from narraforge_cli.client import Client
from narraforge_cli.config import Config
from narraforge_cli.errors import ApiError, BackendUnavailableError


def make_client(backend) -> Client:
    return Client(Config("http://test", None), transport=backend.transport)


class DownTransport(httpx.BaseTransport):
    def handle_request(self, request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")


def test_health_and_capabilities(backend) -> None:
    client = make_client(backend)
    assert client.health() == {"status": "healthy", "app_env": "local"}
    assert client.capabilities()["deploy_target"] == "local"


def test_list_projects(backend) -> None:
    backend.route("GET", "/api/segmented-projects", 200, {"items": [{"id": "a", "name": "A"}]})
    assert client_list(backend) == [{"id": "a", "name": "A"}]


def client_list(backend) -> list:
    return make_client(backend).list_projects()


def test_error_envelope_dict_detail(backend) -> None:
    backend.route(
        "GET",
        "/api/segmented-projects/nope",
        404,
        {"detail": {"code": "project_not_found", "message": "no such project"}},
    )
    with pytest.raises(ApiError) as ei:
        make_client(backend).get_project("nope")
    assert ei.value.status_code == 404
    assert ei.value.code == "project_not_found"
    assert ei.value.message == "no such project"


def test_error_envelope_string_detail(backend) -> None:
    backend.route("POST", "/api/segmented-projects", 409, {"detail": "project_already_exists"})
    with pytest.raises(ApiError) as ei:
        make_client(backend).create_project({"id": "x", "name": "n"})
    assert ei.value.code == "project_already_exists"
    assert ei.value.message == "project_already_exists"


def test_non_json_error_body(backend) -> None:
    backend.route("GET", "/api/segmented-projects/x", 500, {"detail": "boom"})
    # route returns json anyway; force a non-json response via a raw handler
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(500, content=b"internal error")

    backend.transport = httpx.MockTransport(handler)
    with pytest.raises(ApiError) as ei:
        make_client(backend).get_project("x")
    assert ei.value.code == "error"


def test_transport_down_raises_unavailable() -> None:
    with pytest.raises(BackendUnavailableError):
        Client(Config("http://test", None), transport=DownTransport()).health()


def test_bearer_token_sent(backend) -> None:
    client = Client(Config("http://test", "tok123"), transport=backend.transport)
    client.health()
    auth = backend.calls[-1]["headers"].get("authorization")
    assert auth == "Bearer tok123"
```

Note: replace the awkward `client_list` helper in the final file with a direct inline call (`make_client(backend).list_projects()`); the test above shows the intent — keep one assertion per test.

- [ ] **Step 6: Run to verify failure**

```bash
cd cli && uv run pytest tests/test_client.py -q
```

Expected: FAIL (`narraforge_cli.client` missing).

- [ ] **Step 7: Implement the client**

`cli/src/narraforge_cli/client.py`:

```python
"""HTTP client for the NarraForge backend (thin, JSON in / JSON out)."""
from __future__ import annotations

import httpx

from .config import Config
from .errors import ApiError, BackendUnavailableError

REQUEST_TIMEOUT = 300.0  # per-segment synthesis can be slow


def _parse_detail(detail: object) -> tuple[str, str]:
    """Backend error details are either a plain string or an A8 envelope {code, message}."""
    if isinstance(detail, dict):
        code = str(detail.get("code") or detail.get("message") or "error")
        message = str(detail.get("message") or code)
        return code, message
    text = str(detail) if detail is not None else "error"
    return text or "error", text or "error"


class Client:
    """Sync httpx client with one method per backend endpoint."""

    def __init__(self, config: Config, transport: httpx.BaseTransport | None = None) -> None:
        headers = {"Accept": "application/json"}
        if config.token:
            headers["Authorization"] = f"Bearer {config.token}"
        self._client = httpx.Client(
            base_url=config.api_url,
            headers=headers,
            timeout=REQUEST_TIMEOUT,
            transport=transport,
        )

    def close(self) -> None:
        self._client.close()

    # -- core ---------------------------------------------------------------

    def request(self, method: str, path: str, **kwargs: object) -> dict | list:
        try:
            resp = self._client.request(method, path, **kwargs)  # type: ignore[arg-type]
        except httpx.TransportError as exc:
            raise BackendUnavailableError(
                f"cannot reach NarraForge backend at {self._client.base_url}: {exc}\n"
                "start it with: cd backend && uv run uvicorn main:app --host 127.0.0.1 --port 8002 --reload"
            ) from exc
        if resp.status_code >= 400:
            detail = None
            try:
                payload = resp.json()
                if isinstance(payload, dict):
                    detail = payload.get("detail")
            except ValueError:
                detail = None
            code, message = _parse_detail(detail)
            raise ApiError(resp.status_code, code, message)
        return resp.json()  # type: ignore[no-any-return]

    # -- system -------------------------------------------------------------

    def health(self) -> dict:
        return self.request("GET", "/health")  # type: ignore[return-value]

    def capabilities(self) -> dict:
        return self.request("GET", "/api/config/capabilities")  # type: ignore[return-value]

    # -- projects -----------------------------------------------------------

    def list_projects(self) -> list[dict]:
        data = self.request("GET", "/api/segmented-projects")
        items = data.get("items", []) if isinstance(data, dict) else []
        return list(items)

    def get_project(self, project_id: str) -> dict:
        return self.request("GET", f"/api/segmented-projects/{project_id}")  # type: ignore[return-value]

    def create_project(self, project: dict) -> dict:
        return self.request("POST", "/api/segmented-projects", json=project)  # type: ignore[return-value]

    def patch_project(self, project_id: str, patch: dict) -> dict:
        return self.request("PATCH", f"/api/segmented-projects/{project_id}", json=patch)  # type: ignore[return-value]

    def put_narration_script(self, project_id: str, text: str) -> dict:
        return self.request(
            "PUT",
            f"/api/segmented-projects/{project_id}/narration-script",
            json={"text": text},
        )  # type: ignore[return-value]

    def patch_chapter(self, project_id: str, chapter_id: str, patch: dict) -> dict:
        return self.request(
            "PATCH",
            f"/api/segmented-projects/{project_id}/chapters/{chapter_id}",
            json=patch,
        )  # type: ignore[return-value]

    def chapters_batch(self, project_id: str, payload: dict) -> dict:
        return self.request(
            "POST",
            f"/api/segmented-projects/{project_id}/chapters:batch",
            json=payload,
        )  # type: ignore[return-value]

    # -- text split ---------------------------------------------------------

    def markdown_detect(self, text: str, min_chars: int) -> dict:
        return self.request(
            "POST",
            "/api/text-split/markdown-detect",
            json={"text": text, "min_chars": min_chars, "front_matter_mode": "skip"},
        )  # type: ignore[return-value]

    def markdown_split(self, text: str, levels: list[int], min_chars: int) -> dict:
        return self.request(
            "POST",
            "/api/text-split/markdown-split",
            json={
                "text": text,
                "levels": levels,
                "min_chars": min_chars,
                "front_matter_mode": "skip",
            },
        )  # type: ignore[return-value]

    def llm_split(self, text: str) -> dict:
        return self.request("POST", "/api/text-split/llm", json={"text": text})  # type: ignore[return-value]

    # -- synthesis / export -------------------------------------------------

    def synthesize_segment(
        self, project_id: str, chapter_id: str, segment_id: str, *, force: bool = False
    ) -> dict:
        return self.request(
            "POST",
            f"/api/segmented-projects/{project_id}/chapters/{chapter_id}/segments/{segment_id}/synthesize",
            json={"force": force},
        )  # type: ignore[return-value]

    def export_all_chapters(self, project_id: str) -> dict:
        return self.request(
            "POST", f"/api/segmented-projects/{project_id}/export-all-chapters"
        )  # type: ignore[return-value]

    def scaffold_remotion(self, project_id: str, target_dir: str | None = None) -> dict:
        return self.request(
            "POST",
            f"/api/segmented-projects/{project_id}/scaffold-remotion",
            json={"target_dir": target_dir},
        )  # type: ignore[return-value]
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
cd cli && uv run pytest -q
```

Expected: all pass (config 3, client ~7, smoke 1).

- [ ] **Step 9: Commit**

```bash
git add cli && git commit -m "feat(cli): config, error mapping and http client with fake backend fixtures"
```

---

## Task 2: Output helpers + `nf health` command

**Files:**
- Create: `cli/src/narraforge_cli/output.py`
- Modify: `cli/src/narraforge_cli/main.py`
- Test: `cli/tests/test_health.py`

- [ ] **Step 1: Write the health command tests**

`cli/tests/test_health.py`:

```python
"""`nf health` output contract."""
import json

from narraforge_cli.output import set_json_mode


def setup_function(_):  # noqa: ANN001
    set_json_mode(False)  # isolation: json mode is global state


def test_health_json(runner) -> None:
    result = runner.invoke(runner_app(), ["--json", "health"])
    assert result.exit_code == 0
    data = json.loads(result.output)
    assert data["health"]["status"] == "healthy"
    assert data["capabilities"]["deploy_target"] == "local"


def runner_app():
    from narraforge_cli.main import app

    return app


def test_health_human_and_storage_warning(backend) -> None:
    from typer.testing import CliRunner

    backend.route(
        "GET",
        "/api/config/capabilities",
        200,
        {"deploy_target": "local", "engines": ["edge_tts"], "features": {"backend_storage": False}},
    )
    # rebuild the runner against the new transport
    import narraforge_cli.main as main_module
    from narraforge_cli.client import Client
    from narraforge_cli.config import Config
    import json as _json
    import httpx as _httpx

    def handler(request: _httpx.Request) -> _httpx.Response:
        if request.url.path == "/health":
            return _httpx.Response(200, json={"status": "healthy", "app_env": "local"})
        return _httpx.Response(
            200,
            json={"deploy_target": "local", "engines": ["edge_tts"], "features": {"backend_storage": False}},
        )

    old_transport = backend.transport
    backend.transport = _httpx.MockTransport(handler)
    main_module_client = main_module

    def factory(config: Config) -> Client:
        return Client(config, transport=backend.transport)

    main_module_client.Client = factory  # type: ignore[assignment]
    try:
        result = CliRunner().invoke(runner_app(), ["health"])
    finally:
        backend.transport = old_transport
    assert result.exit_code == 0
    assert "warning: backend storage disabled" in result.stderr
```

Note: the `test_health_human_and_storage_warning` test above is intentionally verbose; in the final file simplify it by re-using the `backend`/`runner` fixtures — route the capabilities endpoint to the `backend_storage: False` payload **before** invoking, i.e. call `backend.route(...)` to overwrite the fixture route, and rely on `runner` (it captured the transport object, which is shared). Since `FakeBackend.route` mutates the same route table the transport handler reads, overwriting the route **before** invoking is enough — no transport swap needed:

```python
def test_health_human_warns_when_storage_disabled(backend, runner) -> None:
    backend.route(
        "GET",
        "/api/config/capabilities",
        200,
        {"deploy_target": "local", "engines": ["edge_tts"], "features": {"backend_storage": False}},
    )
    result = runner.invoke(from_main_app(), ["health"])
    assert result.exit_code == 0
    assert "warning: backend storage disabled" in result.stderr
```

Final `cli/tests/test_health.py` should contain: `test_health_json` and `test_health_human_warns_when_storage_disabled`, plus a small module-level helper `from_main_app()` returning the typer app (or import `app` at top of the module — prefer the direct import). Remove the `setup_function` global-state hack if json mode is reset per invocation (it is: the app callback sets it every run) — keep only the direct-import version.

- [ ] **Step 2: Run to verify failure**

```bash
cd cli && uv run pytest tests/test_health.py -q
```

Expected: FAIL (`narraforge_cli.output` missing / no `health` command).

- [ ] **Step 3: Implement output helpers**

`cli/src/narraforge_cli/output.py`:

```python
"""Output helpers: JSON payload to stdout in --json mode, progress to stderr."""
from __future__ import annotations

import json
import sys

_json_mode = False


def set_json_mode(enabled: bool) -> None:
    global _json_mode
    _json_mode = enabled


def json_mode() -> bool:
    return _json_mode


def emit_json(data: object) -> None:
    """Print the command's machine-readable payload to stdout."""
    json.dump(data, sys.stdout, ensure_ascii=False, indent=2, default=str)
    sys.stdout.write("\n")


def info(message: str) -> None:
    """Print a progress/status line to stderr (never pollutes stdout JSON)."""
    print(message, file=sys.stderr)
```

- [ ] **Step 4: Wire the global options + health command into main.py**

Replace `cli/src/narraforge_cli/main.py` with:

```python
"""NarraForge CLI entry point (typer app)."""
from __future__ import annotations

from typing import Optional

import typer

from . import output
from .client import Client
from .config import load_config
from .errors import NarraForgeCliError

app = typer.Typer(
    add_completion=False,
    no_args_is_help=True,
    help="Drive the NarraForge backend from the command line.",
)


class Context:
    """Per-invocation state shared by commands."""

    def __init__(self, client: Client, json_mode: bool) -> None:
        self.client = client
        self.json_mode = json_mode


@app.callback()
def main_callback(
    ctx: typer.Context,
    api_url: Optional[str] = typer.Option(
        None, "--api-url", help="Backend base URL (env: NARRAFORGE_API_URL)."
    ),
    json_out: bool = typer.Option(False, "--json", help="Print machine-readable JSON to stdout."),
) -> None:
    output.set_json_mode(json_out)
    ctx.obj = Context(Client(load_config(api_url)), json_out)


def execute(ctx: typer.Context, fn) -> None:
    """Run a command body; map CLI errors to exit codes; always close the client."""
    try:
        fn()
    except NarraForgeCliError as exc:
        output.info(f"error: {exc}")
        raise typer.Exit(exc.exit_code) from exc
    finally:
        ctx.obj.client.close()


@app.command("health")
def health(ctx: typer.Context) -> None:
    """Check backend reachability, deployment target and available engines."""

    def run() -> None:
        data = {
            "health": ctx.obj.client.health(),
            "capabilities": ctx.obj.client.capabilities(),
        }
        caps = data["capabilities"]
        if ctx.obj.json_mode:
            output.emit_json(data)
        else:
            typer.echo(
                f"backend: {data['health'].get('status')} (app_env={data['health'].get('app_env')})"
            )
            typer.echo(f"deploy_target: {caps.get('deploy_target')}")
            typer.echo(f"engines: {', '.join(caps.get('engines', []))}")
            if not (caps.get("features") or {}).get("backend_storage", False):
                typer.echo(
                    "warning: backend storage disabled - project audio persistence and export will not work",
                    err=True,
                )

    execute(ctx, run)
```

Note: `typer.echo(..., err=True)` writes to stderr — for consistency use `output.info(...)` for that warning instead (keep the `output` module as the only stderr writer):

```python
            if not (caps.get("features") or {}).get("backend_storage", False):
                output.info(
                    "warning: backend storage disabled - project audio persistence and export will not work"
                )
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd cli && uv run pytest -q
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add cli && git commit -m "feat(cli): output helpers and health command"
```

---

## Task 3: `project list/get/create` commands

**Files:**
- Modify: `cli/src/narraforge_cli/main.py`
- Test: `cli/tests/test_project_cmds.py`

- [ ] **Step 1: Write the tests**

`cli/tests/test_project_cmds.py`:

```python
"""project list/get/create commands."""
import json

from typer.testing import CliRunner

from narraforge_cli.main import app
from tests.conftest import make_project_detail


def test_project_list_json(runner, backend) -> None:
    backend.route(
        "GET",
        "/api/segmented-projects",
        200,
        {
            "items": [
                {"id": "p1", "name": "One", "updated_at": "2026-11-21T00:00:00"},
                {"id": "p2", "name": "Two", "updated_at": "2026-11-20T00:00:00"},
            ]
        },
    )
    result = runner.invoke(app, ["--json", "project", "list"])
    assert result.exit_code == 0
    data = json.loads(result.output)
    assert [p["id"] for p in data["items"]] == ["p1", "p2"]


def test_project_get_json(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_project_detail())
    result = runner.invoke(app, ["--json", "project", "get", "p1"])
    assert result.exit_code == 0
    assert json.loads(result.output)["id"] == "p1"


def test_project_create_with_script(tmp_path, runner, backend) -> None:
    script = tmp_path / "narration.md"
    script.write_text("# 标题\n\n第一段。第二段。", encoding="utf-8")
    detail = make_project_detail()
    backend.route("POST", "/api/segmented-projects", 201, detail)
    backend.route(
        "PUT",
        "/api/segmented-projects/proj-1/narration-script",
        200,
        {"path": "narration.md", "project_updated_at": "2026-11-21T00:00:01"},
    )
    backend.route(
        "PATCH",
        "/api/segmented-projects/proj-1",
        200,
        {**detail, "remotion_project_path": "/tmp/remotion-prj"},
    )
    result = runner.invoke(
        app,
        [
            "--json",
            "project",
            "create",
            "--name",
            "Demo",
            "--script",
            str(script),
            "--remotion-path",
            "/tmp/remotion-prj",
        ],
    )
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert data["id"] == "proj-1"
    assert data["narration_script_path"] == "narration.md"
    assert data["remotion_project_path"] == "/tmp/remotion-prj"

    created = backend.calls_for("POST", "/api/segmented-projects")[0]["json"]
    assert created["schema_version"] == 2
    assert created["name"] == "Demo"
    assert created["id"]  # a UUID string was generated client-side
    put = backend.calls_for("PUT", "/api/segmented-projects/proj-1/narration-script")[0]["json"]
    assert put["text"].startswith("# 标题")
    patch = backend.calls_for("PATCH", "/api/segmented-projects/proj-1")[0]["json"]
    assert patch == {"remotion_project_path": "/tmp/remotion-prj"}


def test_project_create_api_error_exit_1(runner, backend) -> None:
    backend.route("POST", "/api/segmented-projects", 409, {"detail": "project_already_exists"})
    result = runner.invoke(app, ["--json", "project", "create", "--name", "Dup"])
    assert result.exit_code == 1
```

Note: `from tests.conftest import make_project_detail` requires `cli/tests/__init__.py` (created in Task 0). If pytest rootdir resolution makes the `tests` package import fail, move `make_project_detail` into a small `cli/tests/factories.py` and import from there instead.

- [ ] **Step 2: Run to verify failure**

```bash
cd cli && uv run pytest tests/test_project_cmds.py -q
```

Expected: FAIL (`no such command 'project'`).

- [ ] **Step 3: Implement the commands**

Add to `cli/src/narraforge_cli/main.py` (imports: add `import json`, `import uuid`, `from pathlib import Path`; add a sub-typer):

```python
import json
import uuid
from pathlib import Path
from typing import Optional

import typer

project_app = typer.Typer(no_args_is_help=True, help="Manage segmented projects.")
app.add_typer(project_app, name="project")
```

Command bodies:

```python
@project_app.command("list")
def project_list(ctx: typer.Context) -> None:
    """List projects (lightweight summaries)."""

    def run() -> None:
        items = ctx.obj.client.list_projects()
        if ctx.obj.json_mode:
            output.emit_json({"items": items})
        else:
            for p in items:
                typer.echo(f"{p.get('id')}\t{p.get('name')}\t{p.get('updated_at', '')}")

    execute(ctx, run)


@project_app.command("get")
def project_get(ctx: typer.Context, project_id: str) -> None:
    """Print the full project detail (JSON)."""

    def run() -> None:
        detail = ctx.obj.client.get_project(project_id)
        if ctx.obj.json_mode:
            output.emit_json(detail)
        else:
            typer.echo(json.dumps(detail, ensure_ascii=False, indent=2))

    execute(ctx, run)


@project_app.command("create")
def project_create(
    ctx: typer.Context,
    name: str = typer.Option(..., "--name", help="Project name."),
    script: Optional[Path] = typer.Option(
        None, "--script", help="Path to the narration script markdown file."
    ),
    remotion_path: Optional[str] = typer.Option(
        None, "--remotion-path", help="Remotion project directory to store on the project."
    ),
) -> None:
    """Create a project and optionally attach the narration script."""

    def run() -> None:
        client = ctx.obj.client
        project_id = str(uuid.uuid4())
        payload = {
            "id": project_id,
            "name": name,
            "schema_version": 2,
            "layout": "vertical",
            "configs": {},
        }
        detail = client.create_project(payload)
        narration_path = None
        if script is not None:
            text = script.read_text(encoding="utf-8")
            put = client.put_narration_script(project_id, text)
            narration_path = put.get("path")
        if remotion_path is not None:
            detail = client.patch_project(project_id, {"remotion_project_path": remotion_path})
        result = {
            "id": project_id,
            "name": detail.get("name"),
            "narration_script_path": narration_path,
            "remotion_project_path": detail.get("remotion_project_path"),
        }
        if ctx.obj.json_mode:
            output.emit_json(result)
        else:
            typer.echo(f"created project {project_id} ({name})")

    execute(ctx, run)
```

Note: the mock route in the test registers `proj-1` because `make_project_detail()` returns that id — the client generates a random UUID, so the routed POST **response** is what the CLI echoes (`id` comes from `result["id"] = project_id`, generated client-side). The test asserts `data["id"] == "proj-1"` — this is wrong: the CLI echoes its own generated UUID. Fix the test to assert the echoed id equals the id in the POSTed payload:

```python
    data = json.loads(result.output)
    posted = backend.calls_for("POST", "/api/segmented-projects")[0]["json"]
    assert data["id"] == posted["id"]
```

And route the PUT/PATCH against a wildcard — `FakeBackend` routes by exact path, so instead assert only the POST/PATCH payloads and make the routed response id-agnostic: keep the routes registered under `proj-1` but have the CLI's `result` read `detail.get(...)` from the PATCH response (which is routed). Since the generated UUID won't match `proj-1`, the PUT/PATCH calls will 404 (`route_not_mocked`) and the command will fail. **Resolution used in the final code:** `FakeBackend` gains a `prefix_routes` fallback — when no exact route matches, any registered route whose path ends with the same tail segment matches (e.g. `/narration-script`), returning its canned response. Simpler and sufficient: register routes with a `{id}` placeholder convention. Final conftest addition:

```python
    def _handle(self, request: httpx.Request) -> httpx.Response:
        ...  # append before the key lookup:
        key = (request.method, request.url.path)
        if key not in self._routes:
            for (m, path), (status, body) in self._routes.items():
                if m == request.method and path.endswith(request.url.path.rsplit("/", 1)[-1]):
                    status, body = self._routes[(m, path)]
                    return httpx.Response(status, json=body)
```

Do **not** add fuzzy fallback (it creates false positives). Final approach: the test computes the project id from the recorded POST call and re-registers routes dynamically via a stateful handler. Replace `FakeBackend.route` usage in this test with a custom `handler`:

```python
def test_project_create_with_script(tmp_path, backend, monkeypatch) -> None:
    script = tmp_path / "narration.md"
    script.write_text("# 标题\n\n第一段。第二段。", encoding="utf-8")
    detail = make_project_detail()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path == "/api/segmented-projects":
            posted = json.loads(request.content)
            return httpx.Response(201, json={**detail, "id": posted["id"], "name": posted["name"]})
        if request.method == "PUT" and request.url.path.endswith("/narration-script"):
            return httpx.Response(
                200, json={"path": "narration.md", "project_updated_at": "2026-11-21T00:00:01"}
            )
        if request.method == "PATCH":
            return httpx.Response(
                200,
                json={
                    **detail,
                    "remotion_project_path": json.loads(request.content)["remotion_project_path"],
                },
            )
        return backend._handle(request)  # fall through to the route table

    backend.transport = httpx.MockTransport(handler)
    # runner fixture already built a Client over backend.transport? No - rebuild:
    ...
```

This is getting convoluted. **Final decision (applies to all later tasks):** upgrade `FakeBackend` to support dynamic path matching by registering routes whose path contains `{project_id}`-style capture is overkill — instead, `FakeBackend.route` accepts a `match` callable:

```python
    def route_fn(self, method: str, match, status: int, body) -> None:
        """Register a dynamic route: match(request_path, payload) -> bool."""
        self._fn_routes.append((method, match, status, body))
```

with `self._fn_routes: list[tuple[str, object, int, object]] = []` in `__init__` and checked before the 404 fallthrough in `_handle`:

```python
        for m, match, status, body in self._fn_routes:
            if m == request.method and match(request.url.path, payload):
                return httpx.Response(status, json=body)
```

`payload` is the parsed request JSON (None for GET/DELETE). This one mechanism serves every dynamic-id test (create, split, synthesize, export). The `runner` fixture reads `backend.transport`, which is the same object whose handler closes over `self._routes` and `self._fn_routes` — dynamic routes added after fixture setup are picked up automatically.

`test_project_create_with_script` (final version):

```python
def test_project_create_with_script(tmp_path, runner, backend) -> None:
    script = tmp_path / "narration.md"
    script.write_text("# 标题\n\n第一段。第二段。", encoding="utf-8")
    detail = make_project_detail()
    backend.route_fn(
        "POST",
        lambda path, payload: path == "/api/segmented-projects" and isinstance(payload, dict),
        201,
        {**detail, "remotion_project_path": None},
    )
    backend.route_fn(
        "PUT",
        lambda path, payload: path.endswith("/narration-script"),
        200,
        {"path": "narration.md", "project_updated_at": "2026-11-21T00:00:01"},
    )
    backend.route_fn(
        "PATCH",
        lambda path, payload: "/api/segmented-projects/" in path and path.count("/") == 3,
        200,
        detail,
    )
    result = runner.invoke(
        app,
        ["--json", "project", "create", "--name", "Demo", "--script", str(script),
         "--remotion-path", "/tmp/remotion-prj"],
    )
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    posted = backend.calls_for("POST", "/api/segmented-projects")[0]["json"]
    assert data["id"] == posted["id"]  # client generates the UUID and echoes it
    assert posted["schema_version"] == 2
    assert posted["name"] == "Demo"
    put = [c for c in backend.calls if c["method"] == "PUT" and c["path"].endswith("/narration-script")][0]
    assert put["json"]["text"].startswith("# 标题")
    patch = [c for c in backend.calls if c["method"] == "PATCH" and c["path"].count("/") == 3][0]
    assert patch["json"] == {"remotion_project_path": "/tmp/remotion-prj"}
    assert data["remotion_project_path"] == "/tmp/remotion-prj"
```

Note on `path.count("/") == 3`: `/api/segmented-projects/{id}` has exactly 3 slashes — it distinguishes the project PATCH from the chapter PATCH (5 slashes). Document this in conftest as a comment.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd cli && uv run pytest -q
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add cli && git commit -m "feat(cli): project list/get/create commands"
```

---

## Task 4: Engine voice params + `project set-engine`

**Files:**
- Create: `cli/src/narraforge_cli/voice.py`
- Modify: `cli/src/narraforge_cli/main.py`
- Test: `cli/tests/test_voice.py`, extend `cli/tests/test_project_cmds.py`

- [ ] **Step 1: Write the voice tests**

`cli/tests/test_voice.py`:

```python
"""Engine voice param building (mirrors backend _flatten_voice_for_synthesis)."""
import pytest

from narraforge_cli.voice import build_voice


def test_mimo_defaults_to_preset_mode() -> None:
    assert build_voice("mimo_tts", []) == {"mode": "preset"}


def test_voxcpm_defaults_to_clone_mode() -> None:
    assert build_voice("voxcpm", []) == {"mode": "clone"}


def test_edge_tts_params() -> None:
    voice = build_voice("edge_tts", ["voice=zh-CN-YunxiNeural", "rate=+10%"])
    assert voice == {"voice": "zh-CN-YunxiNeural", "rate": "+10%"}


def test_numeric_coercion() -> None:
    voice = build_voice("voxcpm", ["cfg_value=2.0", "inference_timesteps=10"])
    assert voice["cfg_value"] == 2.0 and isinstance(voice["cfg_value"], float)
    assert voice["inference_timesteps"] == 10 and isinstance(voice["inference_timesteps"], int)


def test_bool_coercion() -> None:
    assert build_voice("edge_tts", ["mute_tags=true"])["mute_tags"] is True


def test_unknown_engine_rejected() -> None:
    with pytest.raises(ValueError, match="unknown engine"):
        build_voice("cosyvoice", [])


def test_unknown_param_rejected() -> None:
    with pytest.raises(ValueError, match="not valid for engine"):
        build_voice("edge_tts", ["cfg_value=2"])


def test_param_without_equals_rejected() -> None:
    with pytest.raises(ValueError, match="key=value"):
        build_voice("edge_tts", ["voice"])
```

Note: `mute_tags` is not in the per-engine allowlist (backend treats it as a cross-engine key) — add it to every engine's allowed keys in `ENGINE_VOICE_KEYS` so the bool test passes, OR change the test to `qwen speed=1.0` bool-free. Final decision: the allowlist check applies per engine; `mute_tags` is appended as universally allowed inside `build_voice` (matching the backend, which applies `mute_tags` for any engine). The test stands as written.

- [ ] **Step 2: Run to verify failure**

```bash
cd cli && uv run pytest tests/test_voice.py -q
```

Expected: FAIL (module missing).

- [ ] **Step 3: Implement voice.py**

`cli/src/narraforge_cli/voice.py`:

```python
"""Chapter voice JSON construction (mirrors backend _flatten_voice_for_synthesis)."""
from __future__ import annotations

ENGINE_VOICE_KEYS: dict[str, tuple[str, ...]] = {
    "edge_tts": ("voice", "rate", "volume"),
    "qwen": ("voice_id", "speed", "volume", "pitch", "language", "instruction"),
    "mimo_tts": ("mode", "voice_id", "instruction", "voice_description"),
    "voxcpm": ("mode", "voice_id", "style_control", "cfg_value", "inference_timesteps"),
    "indextts": ("voice_id", "lang", "emo_alpha", "duration_factor"),
}

ENGINE_DEFAULT_VOICE: dict[str, dict[str, object]] = {
    "edge_tts": {},
    "qwen": {},
    "mimo_tts": {"mode": "preset"},
    "voxcpm": {"mode": "clone"},
    "indextts": {},
}

# Backend applies this key for any engine (cross-engine mute tag list).
UNIVERSAL_KEYS = ("mute_tags",)


def _coerce(value: str) -> object:
    """Coerce CLI strings into JSON scalars: int > float > bool > str."""
    for cast in (int, float):
        try:
            return cast(value)
        except ValueError:
            continue
    lowered = value.lower()
    if lowered in ("true", "false"):
        return lowered == "true"
    return value


def build_voice(engine: str, params: list[str]) -> dict[str, object]:
    """Build a chapter voice JSON from an engine name and key=value params."""
    if engine not in ENGINE_VOICE_KEYS:
        raise ValueError(
            f"unknown engine {engine!r}; supported: {', '.join(ENGINE_VOICE_KEYS)}"
        )
    voice: dict[str, object] = dict(ENGINE_DEFAULT_VOICE[engine])
    allowed = ENGINE_VOICE_KEYS[engine] + UNIVERSAL_KEYS
    for item in params:
        key, sep, value = item.partition("=")
        if not sep:
            raise ValueError(f"--param expects key=value, got {item!r}")
        if key not in allowed:
            raise ValueError(
                f"--param {key!r} is not valid for engine {engine!r}; allowed: {', '.join(allowed)}"
            )
        voice[key] = _coerce(value)
    return voice
```

- [ ] **Step 4: Write the set-engine command test (append to test_project_cmds.py)**

```python
def make_detail_with_chapters() -> dict:
    detail = make_project_detail()
    detail["chapters"] = [
        {"id": "ch-1", "name": "第一章", "voice": {"engine": "edge_tts"}, "segments": []},
        {"id": "ch-2", "name": "第二章", "voice": None, "segments": []},
    ]
    return detail


def test_set_engine_all_chapters(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail_with_chapters())
    backend.route_fn(
        "PATCH",
        lambda path, payload: "/chapters/" in path,
        200,
        {"chapter": {}, "project_updated_at": "t"},
    )
    result = runner.invoke(
        app, ["--json", "project", "set-engine", "p1", "mimo_tts", "--param", "voice_id=preset-7"]
    )
    assert result.exit_code == 0, result.output
    calls = [c for c in backend.calls if c["method"] == "PATCH" and "/chapters/" in c["path"]]
    assert len(calls) == 2
    assert calls[0]["json"] == {"voice": {"mode": "preset", "voice_id": "preset-7"}}


def test_set_engine_single_chapter(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail_with_chapters())
    backend.route_fn(
        "PATCH", lambda path, payload: path.endswith("/chapters/ch-2"), 200, {"chapter": {}}
    )
    result = runner.invoke(app, ["--json", "project", "set-engine", "p1", "edge_tts", "--chapter", "ch-2"])
    assert result.exit_code == 0, result.output
    calls = [c for c in backend.calls if c["method"] == "PATCH" and "/chapters/" in c["path"]]
    assert len(calls) == 1
    assert calls[0]["json"] == {"voice": {"engine": "edge_tts"}}


def test_set_engine_unknown_engine_fails(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail_with_chapters())
    result = runner.invoke(app, ["--json", "project", "set-engine", "p1", "cosyvoice"])
    assert result.exit_code == 1
```

- [ ] **Step 5: Run to verify failure, then implement**

Add to `main.py` imports: `from .errors import ApiError, BackendUnavailableError, NarraForgeCliError` (extend the existing import) and `from . import output, voice as voice_mod`. Command:

```python
@project_app.command("set-engine")
def project_set_engine(
    ctx: typer.Context,
    project_id: str,
    engine: str = typer.Argument(
        ..., help="TTS engine: edge_tts / qwen / mimo_tts / voxcpm / indextts."
    ),
    param: list[str] = typer.Option(
        [], "--param", help="Voice param as key=value (repeatable)."
    ),
    chapter_id: Optional[str] = typer.Option(
        None, "--chapter", help="Target one chapter instead of all."
    ),
) -> None:
    """Set the TTS engine (and voice params) on all chapters or one chapter."""

    def run() -> None:
        try:
            voice = voice_mod.build_voice(engine, list(param))
        except ValueError as exc:
            raise NarraForgeCliError(str(exc)) from exc
        detail = ctx.obj.client.get_project(project_id)
        targets = [
            ch
            for ch in detail.get("chapters", [])
            if chapter_id is None or ch.get("id") == chapter_id
        ]
        if not targets:
            raise NarraForgeCliError(
                "no matching chapters" + (f" for --chapter {chapter_id}" if chapter_id else "")
            )
        updated = []
        for ch in targets:
            ctx.obj.client.patch_chapter(project_id, ch["id"], {"voice": voice})
            updated.append({"chapter_id": ch["id"], "name": ch.get("name")})
        result = {"updated": updated, "voice": voice}
        if ctx.obj.json_mode:
            output.emit_json(result)
        else:
            for item in updated:
                typer.echo(f"{item['chapter_id']}\t{item['name']}\t{engine}")

    execute(ctx, run)
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd cli && uv run pytest -q
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add cli && git commit -m "feat(cli): engine voice params and project set-engine command"
```

---

## Task 5: Segment helpers + `segment list` + `project status`

**Files:**
- Create: `cli/src/narraforge_cli/segments.py`
- Modify: `cli/src/narraforge_cli/main.py`
- Test: `cli/tests/test_segments.py`, `cli/tests/test_segment_cmds.py`

- [ ] **Step 1: Write the helper tests**

`cli/tests/test_segments.py`:

```python
"""Pure segment status helpers."""
from narraforge_cli.segments import list_rows, plan_segments, segment_ready, summarize


def seg(sid: str, *, current=None, text="hello", position=0) -> dict:
    return {
        "id": sid,
        "position": position,
        "text": text,
        "audio": {"current": current} if current is not None else None,
    }


def detail(*chapters: dict) -> dict:
    return {"chapters": list(chapters)}


def chapter(cid: str, name: str, *segments: dict) -> dict:
    return {"id": cid, "name": name, "segments": list(segments)}


def test_segment_ready_variants() -> None:
    assert segment_ready(seg("a", current={"path": "x.mp3", "file_exists": True}))
    assert segment_ready(seg("a", current={"path": "x.mp3"}))  # file_exists absent = assume ok
    assert not segment_ready(seg("a", current={"path": "x.mp3", "file_exists": False}))
    assert not segment_ready(seg("a", current=None))
    assert not segment_ready({"id": "a", "text": "t", "audio": None})


def test_list_rows_filtering() -> None:
    d = detail(
        chapter("c1", "一", seg("s1", current={"path": "a.mp3"}, position=0),
                seg("s2", position=1)),
        chapter("c2", "二", seg("s3", position=0)),
    )
    rows = list_rows(d)
    assert [r["segment_id"] for r in rows] == ["s1", "s2", "s3"]
    assert rows[0]["origin"] is None and rows[0]["ready"] is True
    only_c2 = list_rows(d, chapter_id="c2")
    assert [r["segment_id"] for r in only_c2] == ["s3"]
    missing = list_rows(d, missing_only=True)
    assert [r["segment_id"] for r in missing] == ["s2", "s3"]


def test_plan_segments_keeps_recorded_flag() -> None:
    recorded = seg("r1", current={"path": "a.mp3", "origin": "recorded"})
    d = detail(chapter("c1", "一", seg("s1", position=0), recorded, seg("s2", position=2)))
    plan = plan_segments(d)
    assert [p["segment_id"] for p in plan] == ["s1", "r1", "s2"]
    assert [p["origin"] for p in plan] == [None, "recorded", None]
    assert plan_segments(d, segment_id="r1")[0]["segment_id"] == "r1"


def test_summarize_counts() -> None:
    results = [{"status": "ok"}, {"status": "ok"}, {"status": "failed"}, {"status": "skipped"}]
    assert summarize(results) == {"ok": 2, "failed": 1, "skipped": 1}
```

- [ ] **Step 2: Run to verify failure, then implement segments.py**

```bash
cd cli && uv run pytest tests/test_segments.py -q
```

Expected: FAIL (module missing).

`cli/src/narraforge_cli/segments.py`:

```python
"""Segment status helpers shared by list/status/synthesize (pure functions)."""
from __future__ import annotations


def segment_ready(seg: dict) -> bool:
    """True when the segment has current audio and its file exists on disk.

    Mirrors the backend's `audio.current.file_exists` semantics: an absent
    `file_exists` key (e.g. synthetic test payloads) counts as present.
    """
    audio = seg.get("audio")
    if not isinstance(audio, dict):
        return False
    current = audio.get("current")
    if not isinstance(current, dict) or not current.get("path"):
        return False
    return current.get("file_exists") is not False


def _rows(detail: dict) -> list[dict]:
    rows = []
    for ch in detail.get("chapters", []):
        for seg in ch.get("segments", []):
            audio = seg.get("audio")
            current = audio.get("current") if isinstance(audio, dict) else None
            rows.append(
                {
                    "chapter_id": ch.get("id"),
                    "chapter_name": ch.get("name"),
                    "segment_id": seg.get("id"),
                    "position": seg.get("position"),
                    "text": seg.get("text") or "",
                    "ready": segment_ready(seg),
                    "origin": current.get("origin") if isinstance(current, dict) else None,
                    "duration_sec": current.get("duration_sec") if isinstance(current, dict) else None,
                }
            )
    return rows


def list_rows(
    detail: dict, *, chapter_id: str | None = None, missing_only: bool = False
) -> list[dict]:
    """Flatten segments for display, with optional chapter / missing filters."""
    rows = _rows(detail)
    if chapter_id:
        rows = [r for r in rows if r["chapter_id"] == chapter_id]
    if missing_only:
        rows = [r for r in rows if not r["ready"]]
    return rows


def plan_segments(
    detail: dict, *, chapter_id: str | None = None, segment_id: str | None = None
) -> list[dict]:
    """Segments to synthesize, in execution order; `origin == "recorded"` items are
    flagged so the runner can skip (or force) them."""
    plan = []
    for r in _rows(detail):
        if chapter_id and r["chapter_id"] != chapter_id:
            continue
        if segment_id and r["segment_id"] != segment_id:
            continue
        plan.append(r)
    return plan


def summarize(results: list[dict]) -> dict:
    counts = {"ok": 0, "failed": 0, "skipped": 0}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    return counts
```

- [ ] **Step 3: Write the command tests**

`cli/tests/test_segment_cmds.py`:

```python
"""segment list + project status commands."""
import json

from typer.testing import CliRunner

from narraforge_cli.main import app


def make_detail() -> dict:
    return {
        "id": "p1",
        "name": "Demo",
        "remotion_project_path": "/tmp/remotion-prj",
        "configs": {"export_directory": "public/audio"},
        "chapters": [
            {
                "id": "c1",
                "name": "第一章",
                "voice": {"engine": "mimo_tts"},
                "segments": [
                    {
                        "id": "s1",
                        "position": 0,
                        "text": "第一句。",
                        "audio": {"current": {"path": "a.mp3", "file_exists": True, "origin": "tts"}},
                    },
                    {
                        "id": "s2",
                        "position": 1,
                        "text": "第二句。",
                        "audio": None,
                    },
                ],
            }
        ],
    }


def test_segment_list_json(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    result = runner.invoke(app, ["--json", "segment", "list", "p1"])
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert data["count"] == 2
    assert [r["segment_id"] for r in data["items"]] == ["s1", "s2"]
    assert data["items"][0]["ready"] is True and data["items"][1]["ready"] is False


def test_segment_list_missing_only(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    result = runner.invoke(app, ["--json", "segment", "list", "p1", "--missing-only"])
    assert result.exit_code == 0
    assert [r["segment_id"] for r in json.loads(result.output)["items"]] == ["s2"]


def test_project_status_json(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    result = runner.invoke(app, ["--json", "project", "status", "p1"])
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert data["all_ready"] is False
    assert data["chapters"][0]["ready"] == 1 and data["chapters"][0]["total"] == 2
    assert data["chapters"][0]["missing_segment_ids"] == ["s2"]
    assert data["remotion_project_path"] == "/tmp/remotion-prj"
    assert data["export_directory"] == "public/audio"
```

- [ ] **Step 4: Run to verify failure, then implement the commands**

Add to `main.py`: `from . import output, segments as segments_mod, voice as voice_mod` (extend existing import) and:

```python
segment_app = typer.Typer(no_args_is_help=True, help="Inspect segment status.")
app.add_typer(segment_app, name="segment")


@segment_app.command("list")
def segment_list(
    ctx: typer.Context,
    project_id: str,
    chapter_id: Optional[str] = typer.Option(None, "--chapter"),
    missing_only: bool = typer.Option(False, "--missing-only"),
) -> None:
    """List segments with audio status."""

    def run() -> None:
        detail = ctx.obj.client.get_project(project_id)
        rows = segments_mod.list_rows(detail, chapter_id=chapter_id, missing_only=missing_only)
        if ctx.obj.json_mode:
            output.emit_json({"items": rows, "count": len(rows)})
        else:
            for r in rows:
                status = "ready" if r["ready"] else "MISSING"
                origin = r["origin"] or ""
                typer.echo(
                    f"{r['chapter_name']}\t#{r['position']}\t{status}\t{origin}\t{r['text'][:30]}"
                )

    execute(ctx, run)


@project_app.command("status")
def project_status(ctx: typer.Context, project_id: str) -> None:
    """Show per-chapter audio readiness and export configuration."""

    def run() -> None:
        detail = ctx.obj.client.get_project(project_id)
        rows = []
        for ch in detail.get("chapters", []):
            segs = ch.get("segments", [])
            missing = [s.get("id") for s in segs if not segments_mod.segment_ready(s)]
            rows.append(
                {
                    "chapter_id": ch.get("id"),
                    "name": ch.get("name"),
                    "engine": ((ch.get("voice") or {}).get("engine")),
                    "total": len(segs),
                    "ready": len(segs) - len(missing),
                    "missing_segment_ids": missing,
                }
            )
        result = {
            "id": detail.get("id"),
            "name": detail.get("name"),
            "remotion_project_path": detail.get("remotion_project_path"),
            "export_directory": (detail.get("configs") or {}).get("export_directory"),
            "chapters": rows,
            "all_ready": bool(rows) and all(r["ready"] == r["total"] for r in rows),
        }
        if ctx.obj.json_mode:
            output.emit_json(result)
        else:
            typer.echo(f"project {result['name']}  remotion={result['remotion_project_path']}")
            for r in rows:
                typer.echo(f"{r['name']}\t{r['engine']}\t{r['ready']}/{r['total']} ready")

    execute(ctx, run)
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd cli && uv run pytest -q
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add cli && git commit -m "feat(cli): segment status helpers, segment list and project status"
```

---

## Task 6: Split planning helpers (pure)

**Files:**
- Create: `cli/src/narraforge_cli/splitting.py`
- Test: `cli/tests/test_splitting.py`

- [ ] **Step 1: Write the tests**

`cli/tests/test_splitting.py`:

```python
"""Pure split orchestration helpers."""
import pytest

from narraforge_cli.splitting import (
    DEFAULT_DELIMITERS,
    build_batch_payload,
    pick_markdown_level,
    slice_chapter_bodies,
)


def test_pick_markdown_level_most_frequent() -> None:
    detect = {"candidates": [{"level": 2}, {"level": 3}, {"level": 3}, {"level": 3}]}
    assert pick_markdown_level(detect) == [3]


def test_pick_markdown_level_tie_prefers_shallower() -> None:
    detect = {"candidates": [{"level": 2}, {"level": 3}, {"level": 2}, {"level": 3}]}
    assert pick_markdown_level(detect) == [2]


def test_pick_markdown_level_no_headings() -> None:
    assert pick_markdown_level({"candidates": []}) == []


def test_slice_chapter_bodies_strips_heading() -> None:
    text = "## 第一章\n第一节内容。\n\n## 第二章\n第二节内容。"
    c1_end = text.index("## 第二章")
    chapters = [
        {"title": "第一章", "start_char": 0, "end_char": c1_end},
        {"title": "第二章", "start_char": c1_end, "end_char": len(text)},
    ]
    bodies = slice_chapter_bodies(text, chapters)
    assert bodies[0] == {"title": "第一章", "body": "第一节内容。"}
    assert bodies[1] == {"title": "第二章", "body": "第二节内容。"}


def test_slice_chapter_bodies_no_heading_line() -> None:
    chapters = [{"title": "全文", "start_char": 0, "end_char": 6}]
    assert slice_chapter_bodies("直接开始", chapters) == [{"title": "全文", "body": "直接开始"}]


def test_build_batch_payload_rule_mode() -> None:
    bodies = [{"title": "第一章", "body": "正文。"}]
    payload = build_batch_payload(
        bodies, full_text="全文", engine="mimo_tts", mode="rule",
        preserve_audio=True, dry_run=False,
    )
    assert payload["split_segments"] is True
    assert payload["preserve_audio"] is True
    assert payload["dry_run"] is False
    assert payload["narration_script"] == "全文"
    ch = payload["chapters"][0]
    assert ch["chapter_title"] == "第一章"
    assert ch["narration_script"] == "正文。"
    assert ch["original_text"] == "正文。"
    assert ch["engine"] == "mimo_tts"
    assert ch["split_config"] == {"mode": "rule", "delimiters": DEFAULT_DELIMITERS}
    assert "segments" not in ch


def test_build_batch_payload_llm_mode_injects_segments() -> None:
    bodies = [{"title": "第一章", "body": "正文。"}]
    llm_segments = [[{"text": "正文。", "emotion": "neutral"}]]
    payload = build_batch_payload(
        bodies, full_text="全文", engine=None, mode="llm",
        preserve_audio=False, dry_run=True, llm_segments=llm_segments,
    )
    assert payload["split_segments"] is False
    assert payload["dry_run"] is True
    assert payload["chapters"][0]["segments"] == [{"text": "正文。", "emotion": "neutral"}]
    assert "engine" not in payload["chapters"][0]


def test_default_delimiters_cover_cjk_and_latin() -> None:
    assert "。" in DEFAULT_DELIMITERS and "." in DEFAULT_DELIMITERS


def test_llm_mode_requires_llm_segments() -> None:
    bodies = [{"title": "第一章", "body": "正文。"}]
    with pytest.raises(ValueError):
        build_batch_payload(
            bodies, full_text="全文", engine=None, mode="llm",
            preserve_audio=False, dry_run=False, llm_segments=None,
        )
```

- [ ] **Step 2: Run to verify failure, then implement**

```bash
cd cli && uv run pytest tests/test_splitting.py -q
```

Expected: FAIL (module missing).

`cli/src/narraforge_cli/splitting.py`:

```python
"""Pure helpers for the project split command (no I/O)."""
from __future__ import annotations

import re

DEFAULT_DELIMITERS = ["，", "。", "！", "？", "；", ".", ",", "!", "?", ";"]

_HEADING_LINE = re.compile(r"^#{1,6}\s+[^\n]*\n?")


def pick_markdown_level(detect_result: dict) -> list[int]:
    """Choose the heading level to split on from a markdown-detect response.

    Picks the level with the most candidates; ties break toward the shallower
    level. Returns [] when the document has no headings.
    """
    counts: dict[int, int] = {}
    for cand in detect_result.get("candidates", []):
        level = cand.get("level")
        if isinstance(level, int):
            counts[level] = counts.get(level, 0) + 1
    if not counts:
        return []
    best = max(sorted(counts), key=lambda lv: counts[lv])
    return [best]


def slice_chapter_bodies(text: str, chapters: list[dict]) -> list[dict]:
    """Slice the source text into {title, body} per markdown-split chapter.

    The chapter's leading markdown heading line (if any) is stripped so
    chapters carry clean narration text.
    """
    out = []
    for ch in chapters:
        chunk = text[ch["start_char"] : ch["end_char"]]
        stripped = chunk.lstrip("\n")
        m = _HEADING_LINE.match(stripped)
        body = stripped[m.end() :].strip() if m else stripped.strip()
        out.append({"title": ch.get("title") or "", "body": body})
    return out


def build_batch_payload(
    bodies: list[dict],
    *,
    full_text: str,
    engine: str | None,
    mode: str,
    preserve_audio: bool,
    dry_run: bool,
    llm_segments: list[list[dict]] | None = None,
) -> dict:
    """Build the chapters:batch request payload.

    - mode "rule": chapters carry no segments and `split_segments: true` lets
      the backend rule-split each chapter's narration text.
    - mode "llm": per-chapter LLM segments are injected and `split_segments`
      stays false. `llm_segments[i]` must align with `bodies[i]`.
    """
    if mode == "llm" and llm_segments is None:
        raise ValueError("mode='llm' requires llm_segments aligned with bodies")
    chapters = []
    for i, item in enumerate(bodies):
        ch: dict[str, object] = {
            "chapter_title": item["title"],
            "narration_script": item["body"],
            "original_text": item["body"],
            "split_config": {"mode": "rule", "delimiters": DEFAULT_DELIMITERS},
        }
        if engine:
            ch["engine"] = engine
        if mode == "llm":
            ch["segments"] = llm_segments[i]  # type: ignore[index]
        chapters.append(ch)
    return {
        "chapters": chapters,
        "narration_script": full_text,
        "preserve_audio": preserve_audio,
        "split_segments": mode == "rule",
        "dry_run": dry_run,
    }
```

- [ ] **Step 3: Run the tests to verify they pass**

```bash
cd cli && uv run pytest -q
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add cli && git commit -m "feat(cli): split planning helpers"
```

---

## Task 7: `project split` command

**Files:**
- Modify: `cli/src/narraforge_cli/main.py`
- Test: `cli/tests/test_cli_split.py`

- [ ] **Step 1: Write the tests**

`cli/tests/test_cli_split.py`:

```python
"""project split command: orchestration across markdown-split + chapters:batch."""
import json

from typer.testing import CliRunner

from narraforge_cli.main import app


NARRATION = "## 第一章\n第一段内容。\n\n## 第二章\n第二段内容。"


def make_detail() -> dict:
    return {"id": "p1", "name": "Demo", "narration_script": NARRATION, "configs": {}, "chapters": []}


def test_split_rule_mode_end_to_end(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    backend.route(
        "POST",
        "/api/text-split/markdown-detect",
        200,
        {"doc_title": "演示", "candidates": [{"level": 2}, {"level": 2}], "total_chars": 30},
    )
    backend.route(
        "POST",
        "/api/text-split/markdown-split",
        200,
        {
            "doc_title": "演示",
            "chapters": [
                {"title": "第一章", "level": 2, "start_char": 0, "end_char": NARRATION.index("## 第二章")},
                {"title": "第二章", "level": 2, "start_char": NARRATION.index("## 第二章"), "end_char": len(NARRATION)},
            ],
        },
    )
    backend.route_fn(
        "POST",
        lambda path, payload: path.endswith("/chapters:batch"),
        200,
        {"chapters": [{"id": "c1", "segments": [{"id": "s1"}, {"id": "s2"}]}], "reuse": None},
    )
    result = runner.invoke(app, ["--json", "project", "split", "p1"])
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert data["chapters"] == 1 and data["segments"] == 2

    detect = backend.calls_for("POST", "/api/text-split/markdown-detect")[0]["json"]
    assert detect["text"] == NARRATION and detect["front_matter_mode"] == "skip"
    split = backend.calls_for("POST", "/api/text-split/markdown-split")[0]["json"]
    assert split["levels"] == [2]  # auto-picked: 2 candidates at level 2
    batch = [c for c in backend.calls if c["path"].endswith("/chapters:batch")][0]["json"]
    assert batch["split_segments"] is True
    assert batch["narration_script"] == NARRATION
    assert [c["chapter_title"] for c in batch["chapters"]] == ["第一章", "第二章"]
    assert batch["chapters"][0]["narration_script"] == "第一段内容。"
    assert batch["chapters"][0]["original_text"] == "第一段内容。"
    assert "engine" not in batch["chapters"][0]


def test_split_explicit_levels_and_engine(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    backend.route(
        "POST",
        "/api/text-split/markdown-detect",
        200,
        {"doc_title": "演示", "candidates": [{"level": 2}, {"level": 3}]},
    )
    backend.route(
        "POST",
        "/api/text-split/markdown-split",
        200,
        {"doc_title": "演示", "chapters": [{"title": "第一章", "start_char": 0, "end_char": len(NARRATION)}]},
    )
    backend.route_fn(
        "POST", lambda path, payload: path.endswith("/chapters:batch"), 200,
        {"chapters": [{"id": "c1", "segments": []}], "reuse": None},
    )
    result = runner.invoke(app, ["--json", "project", "split", "p1", "--levels", "3", "--engine", "edge_tts"])
    assert result.exit_code == 0, result.output
    split = backend.calls_for("POST", "/api/text-split/markdown-split")[0]["json"]
    assert split["levels"] == [3]
    batch = [c for c in backend.calls if c["path"].endswith("/chapters:batch")][0]["json"]
    assert batch["chapters"][0]["engine"] == "edge_tts"


def test_split_llm_mode_calls_llm_per_chapter(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    backend.route(
        "POST", "/api/text-split/markdown-detect", 200,
        {"doc_title": "演示", "candidates": [{"level": 2}, {"level": 2}]},
    )
    backend.route(
        "POST", "/api/text-split/markdown-split", 200,
        {"doc_title": "演示", "chapters": [
            {"title": "第一章", "start_char": 0, "end_char": NARRATION.index("## 第二章")},
            {"title": "第二章", "start_char": NARRATION.index("## 第二章"), "end_char": len(NARRATION)},
        ]},
    )
    backend.route(
        "POST", "/api/text-split/llm", 200,
        {"segments": [{"text": "第一段内容。", "reason": "r", "emotion": "neutral"}]},
    )
    backend.route_fn(
        "POST", lambda path, payload: path.endswith("/chapters:batch"), 200,
        {"chapters": [{"id": "c1", "segments": []}], "reuse": None},
    )
    result = runner.invoke(app, ["--json", "project", "split", "p1", "--mode", "llm"])
    assert result.exit_code == 0, result.output
    llm_calls = backend.calls_for("POST", "/api/text-split/llm")
    assert len(llm_calls) == 2  # one per chapter body
    batch = [c for c in backend.calls if c["path"].endswith("/chapters:batch")][0]["json"]
    assert batch["split_segments"] is False
    assert batch["chapters"][0]["segments"] == [{"text": "第一段内容。", "emotion": "neutral"}]


def test_split_no_headings_single_chapter(runner, backend) -> None:
    plain = make_detail()
    plain["narration_script"] = "没有标题的普通文稿。"
    backend.route("GET", "/api/segmented-projects/p1", 200, plain)
    backend.route(
        "POST", "/api/text-split/markdown-detect", 200,
        {"doc_title": "普通文稿", "candidates": []},
    )
    backend.route_fn(
        "POST", lambda path, payload: path.endswith("/chapters:batch"), 200,
        {"chapters": [{"id": "c1", "segments": []}], "reuse": None},
    )
    result = runner.invoke(app, ["--json", "project", "split", "p1"])
    assert result.exit_code == 0, result.output
    batch = [c for c in backend.calls if c["path"].endswith("/chapters:batch")][0]["json"]
    assert len(batch["chapters"]) == 1
    assert batch["chapters"][0]["chapter_title"] == "普通文稿"
    assert batch["chapters"][0]["narration_script"] == "没有标题的普通文稿。"
    assert backend.calls_for("POST", "/api/text-split/markdown-split") == []


def test_split_dry_run_and_preserve_audio(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    backend.route(
        "POST", "/api/text-split/markdown-detect", 200,
        {"doc_title": "演示", "candidates": [{"level": 2}, {"level": 2}]},
    )
    backend.route(
        "POST", "/api/text-split/markdown-split", 200,
        {"doc_title": "演示", "chapters": [
            {"title": "第一章", "start_char": 0, "end_char": NARRATION.index("## 第二章")},
            {"title": "第二章", "start_char": NARRATION.index("## 第二章"), "end_char": len(NARRATION)},
        ]},
    )
    backend.route_fn(
        "POST", lambda path, payload: path.endswith("/chapters:batch"), 200,
        {"chapters": [], "reuse": {"chapters_matched": 2, "segments_reused": 4}},
    )
    result = runner.invoke(app, ["--json", "project", "split", "p1", "--dry-run", "--preserve-audio"])
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert data["dry_run"] is True
    assert data["reuse"]["segments_reused"] == 4
    batch = [c for c in backend.calls if c["path"].endswith("/chapters:batch")][0]["json"]
    assert batch["dry_run"] is True and batch["preserve_audio"] is True


def test_split_without_script_fails(runner, backend) -> None:
    backend.route(
        "GET", "/api/segmented-projects/p1", 200,
        {"id": "p1", "name": "Demo", "narration_script": None, "configs": {}, "chapters": []},
    )
    result = runner.invoke(app, ["--json", "project", "split", "p1"])
    assert result.exit_code == 1
    assert "no narration script" in result.stderr


def test_split_unknown_engine_fails(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    result = runner.invoke(app, ["--json", "project", "split", "p1", "--engine", "cosyvoice"])
    assert result.exit_code == 1
    assert "unknown engine" in result.stderr
```

- [ ] **Step 2: Run to verify failure**

```bash
cd cli && uv run pytest tests/test_cli_split.py -q
```

Expected: FAIL (`no such command 'split'` under `project`).

- [ ] **Step 3: Implement the command**

Add to `main.py` imports: `from enum import Enum` and `from . import output, segments as segments_mod, splitting, voice as voice_mod`. Add the mode enum near the top (after `Context`):

```python
class SplitMode(str, Enum):
    rule = "rule"
    llm = "llm"
```

Command:

```python
@project_app.command("split")
def project_split(
    ctx: typer.Context,
    project_id: str,
    levels: Optional[int] = typer.Option(
        None, "--levels", help="Markdown heading level to split on (default: auto-detect)."
    ),
    min_chars: int = typer.Option(80, "--min-chars", help="Minimum chapter length before merging."),
    mode: SplitMode = typer.Option(SplitMode.rule, "--mode", help="Segment split mode."),
    engine: Optional[str] = typer.Option(
        None, "--engine", help="TTS engine written onto every created chapter."
    ),
    preserve_audio: bool = typer.Option(
        False, "--preserve-audio", help="Reuse audio of segments whose text is unchanged."
    ),
    dry_run: bool = typer.Option(
        False, "--dry-run", help="Reuse report only; nothing is written."
    ),
) -> None:
    """Split the project narration script into chapters and segments.

    Reads the project-level narration script, detects markdown headings,
    rebuilds all chapters via chapters:batch and rule- (or LLM-) splits each
    chapter into segments.
    """

    def run() -> None:
        client = ctx.obj.client
        detail = client.get_project(project_id)
        text = detail.get("narration_script") or ""
        if not text.strip():
            raise NarraForgeCliError(
                "project has no narration script; create one with `nf project create --script <file>`"
            )
        if engine is not None and engine not in voice_mod.ENGINE_VOICE_KEYS:
            raise NarraForgeCliError(
                f"unknown engine {engine!r}; supported: {', '.join(voice_mod.ENGINE_VOICE_KEYS)}"
            )
        detect = client.markdown_detect(text, min_chars)
        if detect.get("candidates"):
            level_list = [levels] if levels else splitting.pick_markdown_level(detect)
            split = client.markdown_split(text, level_list, min_chars)
            bodies = splitting.slice_chapter_bodies(text, split.get("chapters", []))
        else:
            bodies = [{"title": detect.get("doc_title") or "全文", "body": text.strip()}]
        llm_segments = None
        if mode == SplitMode.llm:
            llm_segments = []
            for item in bodies:
                if not item["body"].strip():
                    llm_segments.append([])
                    continue
                res = client.llm_split(item["body"])
                llm_segments.append(
                    [{"text": s["text"], "emotion": s.get("emotion")} for s in res.get("segments", [])]
                )
        payload = splitting.build_batch_payload(
            bodies,
            full_text=text,
            engine=engine,
            mode=mode.value,
            preserve_audio=preserve_audio,
            dry_run=dry_run,
            llm_segments=llm_segments,
        )
        batch = client.chapters_batch(project_id, payload)
        if dry_run:
            result = {"dry_run": True, "reuse": batch.get("reuse")}
        else:
            created = batch.get("chapters", [])
            result = {
                "chapters": len(created),
                "segments": sum(len(c.get("segments", [])) for c in created),
                "reuse": batch.get("reuse"),
            }
        if ctx.obj.json_mode:
            output.emit_json(result)
        else:
            if dry_run:
                output.info(f"dry-run reuse report: {json.dumps(batch.get('reuse'), ensure_ascii=False)}")
            else:
                output.info(f"created {result['chapters']} chapters / {result['segments']} segments")

    execute(ctx, run)
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd cli && uv run pytest -q
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add cli && git commit -m "feat(cli): project split command (markdown chapters + rule/llm segments)"
```

---

## Task 8: `project synthesize` command

**Files:**
- Modify: `cli/src/narraforge_cli/main.py`
- Test: `cli/tests/test_cli_synthesize.py`

- [ ] **Step 1: Write the tests**

`cli/tests/test_cli_synthesize.py`:

```python
"""project synthesize command: sequential loop, skip semantics, failure exit code."""
import json

from typer.testing import CliRunner

from narraforge_cli.main import app


def make_detail() -> dict:
    return {
        "id": "p1",
        "name": "Demo",
        "configs": {},
        "chapters": [
            {
                "id": "c1",
                "name": "第一章",
                "voice": {"engine": "edge_tts"},
                "segments": [
                    {"id": "s1", "position": 0, "text": "第一句。", "audio": None},
                    {
                        "id": "s2",
                        "position": 1,
                        "text": "第二句。",
                        "audio": {"current": {"path": "a.mp3", "origin": "recorded", "file_exists": True}},
                    },
                    {"id": "s3", "position": 2, "text": "   ", "audio": None},
                    {"id": "s4", "position": 3, "text": "第四句。", "audio": None},
                ],
            }
        ],
    }


def test_synthesize_skips_recorded_and_empty(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    backend.route_fn(
        "POST",
        lambda path, payload: path.endswith("/synthesize"),
        200,
        {"chapters": []},
    )
    result = runner.invoke(app, ["--json", "project", "synthesize", "p1"])
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert data["summary"] == {"ok": 2, "failed": 0, "skipped": 2}
    statuses = {r["segment_id"]: r["status"] for r in data["results"]}
    assert statuses["s2"] == "skipped" and statuses["s3"] == "skipped"
    called = [c for c in backend.calls if c["path"].endswith("/synthesize")]
    assert len(called) == 2  # s1 + s4 only
    assert called[0]["json"] == {"force": False}


def test_synthesize_force_includes_recorded(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    backend.route_fn(
        "POST", lambda path, payload: path.endswith("/synthesize"), 200, {"chapters": []}
    )
    result = runner.invoke(app, ["--json", "project", "synthesize", "p1", "--force"])
    assert result.exit_code == 0, result.output
    called = [c for c in backend.calls if c["path"].endswith("/synthesize")]
    assert len(called) == 3  # s1, s2 (forced), s4
    assert all(c["json"] == {"force": True} for c in called)
    skipped = [r for r in json.loads(result.output)["results"] if r["status"] == "skipped"]
    assert [r["segment_id"] for r in skipped] == ["s3"]  # only empty text skipped


def test_synthesize_chapter_and_segment_filters(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    backend.route_fn(
        "POST", lambda path, payload: path.endswith("/synthesize"), 200, {"chapters": []}
    )
    result = runner.invoke(app, ["--json", "project", "synthesize", "p1", "--segment", "s4"])
    assert result.exit_code == 0, result.output
    called = [c for c in backend.calls if c["path"].endswith("/synthesize")]
    assert len(called) == 1
    assert "/chapters/c1/segments/s4/synthesize" in called[0]["path"]


def test_synthesize_failure_exit_1_and_stop_on_error(runner, backend) -> None:
    detail = make_detail()
    detail["chapters"][0]["segments"] = [
        {"id": "s1", "position": 0, "text": "会失败。", "audio": None},
        {"id": "s2", "position": 1, "text": "第二句。", "audio": None},
    ]
    backend.route("GET", "/api/segmented-projects/p1", 200, detail)
    backend.route(
        "POST",
        "/api/segmented-projects/p1/chapters/c1/segments/s1/synthesize",
        500,
        {"detail": {"code": "tts_failed", "message": "engine exploded"}},
    )
    backend.route_fn(
        "POST", lambda path, payload: path.endswith("/synthesize"), 200, {"chapters": []}
    )
    result = runner.invoke(app, ["--json", "project", "synthesize", "p1"])
    assert result.exit_code == 1
    data = json.loads(result.output)
    assert data["summary"]["failed"] == 1 and data["summary"]["ok"] == 1
    failed = [r for r in data["results"] if r["status"] == "failed"][0]
    assert failed["error"] == "engine exploded"

    result2 = runner.invoke(app, ["--json", "project", "synthesize", "p1", "--stop-on-error"])
    assert result2.exit_code == 1
    called = [c for c in backend.calls if c["path"].endswith("/synthesize")]
    assert len(called) == 1  # stopped after the first failure
```

Note: the 500 route for s1 must be registered **before** the generic `route_fn` (exact routes are checked first in `_handle`), and the exact-route path must include the full chapter/segment ids as written.

- [ ] **Step 2: Run to verify failure**

```bash
cd cli && uv run pytest tests/test_cli_synthesize.py -q
```

Expected: FAIL (`no such command 'synthesize'`).

- [ ] **Step 3: Implement the command**

```python
@project_app.command("synthesize")
def project_synthesize(
    ctx: typer.Context,
    project_id: str,
    chapter_id: Optional[str] = typer.Option(None, "--chapter", help="Only this chapter."),
    segment_id: Optional[str] = typer.Option(None, "--segment", help="Only this segment."),
    force: bool = typer.Option(
        False,
        "--force",
        help="Re-synthesize segments that already have audio and unlock user-recorded ones.",
    ),
    stop_on_error: bool = typer.Option(False, "--stop-on-error", help="Abort at the first failure."),
) -> None:
    """Synthesize audio for all (or selected) segments, sequentially.

    User-recorded segments are skipped unless --force; segments with empty
    text are skipped. Exit code 1 when any segment fails.
    """

    def run() -> None:
        client = ctx.obj.client
        detail = client.get_project(project_id)
        plan = segments_mod.plan_segments(detail, chapter_id=chapter_id, segment_id=segment_id)
        results = []
        total = len(plan)
        for done, item in enumerate(plan, start=1):
            label = f"{item['chapter_name']}#{item['position']}"
            if item["origin"] == "recorded" and not force:
                results.append({**item, "status": "skipped", "reason": "recorded"})
                output.info(f"[{done}/{total}] skip {label} (user-recorded audio)")
                continue
            if not item["text"].strip():
                results.append({**item, "status": "skipped", "reason": "empty_text"})
                output.info(f"[{done}/{total}] skip {label} (empty text)")
                continue
            try:
                client.synthesize_segment(
                    project_id, item["chapter_id"], item["segment_id"], force=force
                )
                results.append({**item, "status": "ok"})
                output.info(f"[{done}/{total}] ok {label}")
            except ApiError as exc:
                results.append({**item, "status": "failed", "error": exc.message})
                output.info(f"[{done}/{total}] FAILED {label}: [{exc.status_code}] {exc.code}")
                if stop_on_error:
                    break
        counts = segments_mod.summarize(results)
        output.info(
            f"synthesis done: ok={counts['ok']} failed={counts['failed']} "
            f"skipped={counts['skipped']} planned={total}"
        )
        output.emit_json({"summary": counts, "planned": total, "results": results})
        if counts["failed"]:
            raise typer.Exit(1)

    execute(ctx, run)
```

Note: `main.py` must import `ApiError` (extend `from .errors import ...`).

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd cli && uv run pytest -q
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add cli && git commit -m "feat(cli): project synthesize command with skip/force semantics"
```

---

## Task 9: `project export` command

**Files:**
- Modify: `cli/src/narraforge_cli/main.py`
- Test: `cli/tests/test_cli_export.py`

- [ ] **Step 1: Write the tests**

`cli/tests/test_cli_export.py`:

```python
"""project export command: path patching, configs merge, scaffold variant."""
import json

from typer.testing import CliRunner

from narraforge_cli.main import app


def make_detail() -> dict:
    return {
        "id": "p1",
        "name": "Demo",
        "remotion_project_path": None,
        "configs": {"description": "keep me", "split_voice_mode": "narration"},
        "chapters": [],
    }


def test_export_plain_with_path_and_dir(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    backend.route_fn(
        "PATCH",
        lambda path, payload: path == "/api/segmented-projects/p1",
        200,
        {**make_detail(), "remotion_project_path": "/tmp/prj"},
    )
    backend.route(
        "POST",
        "/api/segmented-projects/p1/export-all-chapters",
        200,
        {
            "exported": [
                {"chapter_id": "c1", "title": "第一章", "audio_path": "/tmp/prj/public/audio/第一章.mp3",
                 "srt_path": "/tmp/prj/public/audio/第一章.srt"}
            ],
            "count": 1,
        },
    )
    result = runner.invoke(
        app,
        ["--json", "project", "export", "p1", "--remotion-path", "/tmp/prj", "--export-dir", "public/audio"],
    )
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert data["count"] == 1 and data["exported"][0]["audio_path"].endswith("第一章.mp3")
    patch = backend.calls_for("PATCH", "/api/segmented-projects/p1")[0]["json"]
    # configs bucket is replaced wholesale by the backend: the CLI merged client-side
    assert patch["configs"] == {
        "description": "keep me",
        "split_voice_mode": "narration",
        "export_directory": "public/audio",
    }
    assert patch["remotion_project_path"] == "/tmp/prj"


def test_export_without_any_config_fails_409(runner, backend) -> None:
    detail = make_detail()
    detail["configs"] = {}
    backend.route("GET", "/api/segmented-projects/p1", 200, detail)
    backend.route(
        "POST",
        "/api/segmented-projects/p1/export-all-chapters",
        409,
        {"detail": {"code": "export_directory_not_configured", "message": "no export dir"}},
    )
    result = runner.invoke(app, ["--json", "project", "export", "p1"])
    assert result.exit_code == 1
    assert "export_directory_not_configured" in result.stderr


def test_export_scaffold_uses_remotion_path(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    backend.route_fn(
        "PATCH", lambda path, payload: path == "/api/segmented-projects/p1", 200, make_detail()
    )
    backend.route(
        "POST",
        "/api/segmented-projects/p1/scaffold-remotion",
        200,
        {"project_dir": "/tmp/prj", "created": True, "chapters": 2},
    )
    result = runner.invoke(app, ["--json", "project", "export", "p1", "--remotion-path", "/tmp/prj", "--scaffold"])
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert data == {"project_dir": "/tmp/prj", "created": True, "chapters": 2}
    scaffold = backend.calls_for("POST", "/api/segmented-projects/p1/scaffold-remotion")[0]["json"]
    assert scaffold == {"target_dir": "/tmp/prj"}
    # plain export endpoint must NOT have been called
    assert backend.calls_for("POST", "/api/segmented-projects/p1/export-all-chapters") == []


def test_export_scaffold_without_prior_patch(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    backend.route(
        "POST", "/api/segmented-projects/p1/scaffold-remotion", 200,
        {"project_dir": "/global/root/Demo", "created": False, "chapters": 1},
    )
    result = runner.invoke(app, ["--json", "project", "export", "p1", "--scaffold"])
    assert result.exit_code == 0, result.output
    scaffold = backend.calls_for("POST", "/api/segmented-projects/p1/scaffold-remotion")[0]["json"]
    assert scaffold == {"target_dir": None}  # backend falls back to project/global settings
```

- [ ] **Step 2: Run to verify failure**

```bash
cd cli && uv run pytest tests/test_cli_export.py -q
```

Expected: FAIL (`no such command 'export'`).

- [ ] **Step 3: Implement the command**

```python
@project_app.command("export")
def project_export(
    ctx: typer.Context,
    project_id: str,
    remotion_path: Optional[str] = typer.Option(
        None, "--remotion-path", help="Remotion project dir; stored on the project before exporting."
    ),
    export_dir: Optional[str] = typer.Option(
        None, "--export-dir", help="Export directory override (configs.export_directory)."
    ),
    scaffold: bool = typer.Option(
        False,
        "--scaffold",
        help="Create/refresh the full Remotion project (audio + subtitles + manifest) instead of a plain audio export.",
    ),
) -> None:
    """Export chapter audio (and srt) into the Remotion project.

    Without --scaffold, calls export-all-chapters (mp3+srt per chapter into the
    resolved export directory, default `{remotion_path}/public/audio`). With
    --scaffold, calls scaffold-remotion which also writes subtitles and a
    segment manifest.
    """

    def run() -> None:
        client = ctx.obj.client
        if remotion_path is not None or export_dir is not None:
            detail = client.get_project(project_id)
            patch: dict[str, object] = {}
            if remotion_path is not None:
                patch["remotion_project_path"] = remotion_path
            if export_dir is not None:
                # PATCH replaces the whole configs bucket: merge client-side.
                configs = dict(detail.get("configs") or {})
                configs["export_directory"] = export_dir
                patch["configs"] = configs
            client.patch_project(project_id, patch)
        if scaffold:
            raw = client.scaffold_remotion(project_id, remotion_path)
            payload = {
                "project_dir": raw.get("project_dir"),
                "created": raw.get("created"),
                "chapters": raw.get("chapters"),
            }
            if ctx.obj.json_mode:
                output.emit_json(payload)
            else:
                typer.echo(
                    f"remotion project: {payload['project_dir']} "
                    f"(created={payload['created']}, chapters={payload['chapters']})"
                )
            return
        raw = client.export_all_chapters(project_id)
        payload = {"exported": raw.get("exported", []), "count": raw.get("count")}
        if ctx.obj.json_mode:
            output.emit_json(payload)
        else:
            for item in payload["exported"]:
                typer.echo(f"{item.get('title')}\t{item.get('audio_path')}\t{item.get('srt_path')}")

    execute(ctx, run)
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd cli && uv run pytest -q
```

Expected: all pass.

- [ ] **Step 5: Manual smoke test against a real backend (if available)**

```bash
cd backend && uv run uvicorn main:app --host 127.0.0.1 --port 8002 &
sleep 3
cd ../cli && uv run nf health
```

Expected: `backend: healthy (app_env=...)`, `deploy_target: local`, engines listed. Stop the backend afterwards.

- [ ] **Step 6: Commit**

```bash
git add cli && git commit -m "feat(cli): project export command (audio export and remotion scaffold)"
```

---

## Task 10: Lint, docs, and agent Skill

**Files:**
- Create: `.agents/skills/narraforge/SKILL.md`
- Create: `docs/cli.md`
- Modify: `docs/RUNBOOK.md` (add a CLI section)
- Modify: `AGENTS.md` (add CLI commands block)

- [ ] **Step 1: Run ruff and fix any findings**

```bash
cd cli && uv run ruff check . && uv run ruff format --check . || uv run ruff format .
```

Expected: no lint errors.

- [ ] **Step 2: Write the Skill**

`.agents/skills/narraforge/SKILL.md`:

```markdown
---
name: narraforge
description: Drive the NarraForge backend via the `nf` CLI to turn a narration markdown script into per-chapter audio + subtitles for a Remotion project. Use when the user asks to create a NarraForge project, paste a narration script, split it into segments, synthesize TTS audio, or export audio into a Remotion project's public/audio directory.
---

# NarraForge narration pipeline via the nf CLI

## Prerequisites

- Backend running: verify with `nf health --json` (stdout JSON `health.status == "healthy"`).
  Start it with: `cd backend && uv run uvicorn main:app --host 127.0.0.1 --port 8002 --reload`.
- Audio persistence requires backend storage mode; `nf health` warns when `features.backend_storage` is false.
- Workers mode needs `NARRAFORGE_API_TOKEN`; local mode needs no auth.
- When driving programmatically, pass `--json` on every command and parse stdout JSON.
  Progress/status lines go to stderr; exit codes: 0 ok, 1 operation error, 2 backend unreachable.

## Canonical workflow

1. Create the project with the narration script attached:

   ```bash
   nf project create --name "<project name>" --script narration.md
   ```

2. Split into chapters and segments (preview first):

   ```bash
   nf project split <id> --dry-run     # reuse report, nothing written
   nf project split <id>               # markdown heading level auto-detected
   ```

   - Override the heading level with `--levels 2`; LLM semantic split with `--mode llm`.
   - Re-splitting after edits: add `--preserve-audio` to reuse audio of unchanged segments.
   - Segment text is capped at `MAX_SEGMENT_CHARS` (default 80) — the backend merges/truncates automatically.

3. Inspect the result:

   ```bash
   nf project status <id>            # per-chapter ready/total + export config
   nf segment list <id> --missing-only
   ```

4. Choose the engine (repeatable `--param key=value`):

   ```bash
   nf project set-engine <id> mimo_tts --param mode=preset --param voice_id=<preset-id>
   nf project set-engine <id> edge_tts --param voice=zh-CN-YunxiNeural
   nf project set-engine <id> voxcpm --param mode=clone --param voice_id=<role-id>
   ```

5. Synthesize (sequential, skip recorded/empty unless `--force`):

   ```bash
   nf project synthesize <id>
   ```

   Exit code 1 on failures; the JSON `results` array lists each failed segment with its error.

6. Export into the Remotion project (default export dir `{remotion_path}/public/audio`):

   ```bash
   nf project export <id> --remotion-path /abs/path/to/remotion-prj
   ```

   Full Remotion scaffold alternative (audio + subtitles + segment manifest + AGENTS.md):

   ```bash
   nf project export <id> --scaffold   # add --remotion-path to set the target dir
   ```

7. Verify: `nf project status <id>` reports `all_ready: true`.

## Pitfalls

- `nf project split` is replace-style (backend `chapters:batch` re-creates all chapters). Use `--dry-run` first and `--preserve-audio` when re-splitting.
- User-recorded segment audio is locked; synthesis skips it unless `--force`.
- Export aborts with 409 `chapters_incomplete` when any segment lacks audio — run `nf project status` first.
- PATCH project `configs` replaces the whole bucket; `nf project export` merges `export_directory` for you.
- Use absolute paths for `--remotion-path`; export dirs may be relative to it (default `public/audio`).
```

- [ ] **Step 3: Write docs/cli.md**

Create `docs/cli.md` with: install (`cd cli && uv sync`, command `uv run nf ...` or install via `uv tool install --editable cli`), env vars (`NARRAFORGE_API_URL`, `NARRAFORGE_API_TOKEN`), the output contract (stdout JSON / stderr progress / exit codes), and a command reference table covering every command from Tasks 2–9 with its options (copy option help strings verbatim from `main.py`), plus the same canonical workflow as the Skill.

- [ ] **Step 4: Update RUNBOOK.md and AGENTS.md**

- `docs/RUNBOOK.md`: add a "CLI" section pointing to `docs/cli.md` with the `nf health` backend check.
- `AGENTS.md`: under Commands add:

```markdown
### CLI (`cli/`)

```bash
cd cli && uv sync                  # install (entry point: nf)
uv run nf health                   # backend reachability + capabilities
uv run nf project create --name X --script narration.md
uv run pytest -q                   # CLI tests
uv run ruff check .
```

The CLI drives the backend over HTTP for the narration workflow (create → split → set-engine → synthesize → export). See `docs/cli.md`.
```

- [ ] **Step 5: Run the full CLI test suite once more**

```bash
cd cli && uv run ruff check . && uv run pytest -q
```

Expected: lint clean, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add .agents/skills/narraforge docs/cli.md docs/RUNBOOK.md AGENTS.md && git commit -m "docs: narraforge cli reference and agent skill"
```

---

## Task 11: Full verification + pull request

**Files:** none (verification only)

- [ ] **Step 1: Run the complete verification suite**

```bash
cd cli && uv run ruff check . && uv run pytest -q
cd ../backend && uv run ruff check .
cd .. && uvx pre-commit run --all-files
```

Expected: everything green. If pre-commit flags anything in `cli/`, fix and re-run.

- [ ] **Step 2: Manual E2E against the real backend (end user alignment)**

With the backend running, exercise the full loop with a small fixture narration file (2 H2 chapters, 3–4 sentences each) and verify, per the repo's E2E standard, that UI/data agree:

1. `nf project create --name cli-e2e --script /tmp/narration-e2e.md` → note the id.
2. `nf project split <id>` then `nf project status <id>` — chapter titles match the markdown headings; segment counts > 0.
3. Open the frontend project page (port 5173) and confirm the chapters/segments created by the CLI appear identically (dual-read verification: CLI JSON vs UI).
4. `nf project set-engine <id> edge_tts` and `nf project synthesize <id>` — verify audio files exist and `nf project status` shows all segments ready; also verify the same in the UI audio player.
5. `nf project export <id> --remotion-path /tmp/nf-cli-e2e-prj` — verify the mp3+srt files exist under `/tmp/nf-cli-e2e-prj/public/audio`.
6. `curl http://127.0.0.1:8002/api/segmented-projects/<id>` — spot-check `audio.current.path` values match the status output.

Record any UI/data mismatch as follow-up issues.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/narraforge-cli
gh pr create --title "feat: narraforge cli for driving the narration workflow" \
  --body "Thin nf CLI (httpx + typer) over the backend HTTP API: project create/split/set-engine/synthesize/export, segment inspection, agent skill + docs. Exit codes 0/1/2; --json stdout contract for agent use."
```

- [ ] **Step 4: Update the docs required by the repo convention**

Confirm the PR touches/keeps updated: `docs/cli.md` (new), `docs/RUNBOOK.md`, `AGENTS.md`. No `CHANGELOG.md` edits (auto-generated, never touched manually).

---

## Self-Review

**1. Spec coverage (user's 7-step workflow):**

| Workflow step | Command | Task |
|---|---|---|
| 新建工程 | `nf project create` | Task 3 |
| 粘贴旁白 | `--script` (PUT narration-script) | Task 3 |
| split | `nf project split` (markdown-detect/split + chapters:batch) | Tasks 6–7 |
| 选模型 | `nf project set-engine` (chapter voice JSON) | Task 4 |
| TTS | `nf project synthesize` (sequential per-segment loop) | Tasks 5, 8 |
| 填项目地址 | `--remotion-path` (PATCH project) | Task 9 |
| 导出音频到 public/audio | `nf project export` / `--scaffold` | Task 9 |
| Agent skill + docs | `.agents/skills/narraforge/SKILL.md`, `docs/cli.md` | Task 10 |

Gaps intentionally deferred (YAGNI, noted for follow-ups): per-segment text/emotion editing (backend PATCH segment exists; UI is better suited), SRT-only export (chapter export-audio endpoint), ZIP export/import, source-document (源文档) flows, MiMo preset listing (voice discovery) — these can be added as `nf` subcommands later without breaking the contract.

**2. Placeholder scan:** Tasks 3 and 10 contain inline "final decision" notes resolving early draft ambiguity (FakeBackend `route_fn`, health test simplification, docs/cli.md content checklist). No TBD/TODO remains; every code step contains complete code.

**3. Type consistency check:** `Client` methods used by `main.py` (`health`, `capabilities`, `list_projects`, `get_project`, `create_project`, `patch_project`, `put_narration_script`, `patch_chapter`, `chapters_batch`, `markdown_detect`, `markdown_split`, `llm_split`, `synthesize_segment`, `export_all_chapters`, `scaffold_remotion`) all defined in Task 1. `segments.py` exports (`segment_ready`, `list_rows`, `plan_segments`, `summarize`) match Task 5 usage; `splitting.py` exports (`DEFAULT_DELIMITERS`, `pick_markdown_level`, `slice_chapter_bodies`, `build_batch_payload`) match Tasks 6–7; `voice.py` exports (`ENGINE_VOICE_KEYS`, `ENGINE_DEFAULT_VOICE`, `UNIVERSAL_KEYS`, `build_voice`) match Task 4; `output.py` exports (`set_json_mode`, `emit_json`, `info`) match all tasks. `execute()` and `Context` defined in Task 2 and used everywhere; `FakeBackend.route_fn` defined in Task 3's conftest amendment and used in Tasks 3–9.
