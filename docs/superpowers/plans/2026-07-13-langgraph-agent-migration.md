# LangGraph Agent Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the narration workflow from the in-backend FastAPI implementation to a standalone LangGraph agent service, rebuild the frontend on `@langchain/langgraph-sdk` `useStream` with a source-document-triggered side drawer, and delete the old backend workflow code in one big-bang cutover.

**Architecture:** A new `agent/` service runs the LangGraph graph via `langgraph dev` (in-memory). Nodes call the backend over HTTP for project/chapter/segment/TTS persistence. The frontend talks to both `/api` (backend) and `/agent` (LangGraph server) directly. Run linkage is via LangGraph thread metadata. Persistence is explicitly deferred (session-scoped runs).

**Tech Stack:** Python 3.12 + LangGraph 1.2.x + instructor + httpx (agent); FastAPI + SQLAlchemy (backend, existing); React 19 + TypeScript + `@langchain/langgraph-sdk` (frontend); Playwright (E2E).

## Global Constraints

- Backend runs on `:8002`, frontend on `:5173`, agent on `:2024` (LangGraph default).
- Vite proxy adds `/agent` -> `http://127.0.0.1:2024`; existing `/api` -> `:8002` stays.
- Agent reads `BACKEND_API_URL=http://127.0.0.1:8002` + LLM keys (`AGENT_LLM_*` / `LLM_*` / `MIMO_*`) from `agent/.env`.
- Dependencies managed with `uv` (Python) and `npm` (frontend) — never pip.
- Primary color is warm amber `#c47a3a`; no purple as primary. CSS Modules use camelCase.
- Icons: Material Symbols Outlined (`material-symbols-outlined`), already used in the codebase.
- LangGraph `langgraph dev` is in-memory — runs lost on restart is accepted (persistence deferred).
- Agent never imports backend code; backend never calls the agent (one-way: agent->backend HTTP, frontend->both).
- Per CLAUDE.md: never auto-add agent co-author to commits; never modify CHANGELOG.md.
- Spec: `docs/superpowers/specs/2026-07-13-langgraph-agent-migration-design.md`.

## File Structure

**Agent (new, `agent/`):**
- `agent/pyproject.toml` — modify: add httpx, instructor, langchain-core, openai, langgraph-cli[inmem], test extras.
- `agent/langgraph.json` — narration assistant registration.
- `agent/.env` — `BACKEND_API_URL`, LLM keys.
- `agent/app/state.py` — `NarrationWorkflowState` TypedDict.
- `agent/app/schemas.py` — Pydantic models (`ReviewDimension`, `ReviewResult`, `Segment`, `ChapterStructure`, `SegmentChapters`, `Preference`, `SynthResult`, `ChapterWithSegmentIds`).
- `agent/app/prompts/narration.py` — prompts migrated from backend.
- `agent/app/llm.py` — instructor client + raw OpenAI streaming.
- `agent/app/backend_client.py` — `BackendClient` async HTTP.
- `agent/app/nodes/gen_script.py`, `script_review.py`, `split_segment.py`, `synthesis.py` — one node per file.
- `agent/app/nodes/__init__.py` — re-exports.
- `agent/app/graph.py` — `StateGraph` + compile + `route_after_review`.
- `agent/app/config.py` — `get_agent_llm_config()` + `BACKEND_API_URL` reader.
- `agent/tests/` — `conftest.py`, `test_schemas.py`, `test_llm.py`, `test_backend_client.py`, `test_gen_script.py`, `test_script_review.py`, `test_split_segment.py`, `test_synthesis.py`, `test_graph.py`.

**Backend (modify, `backend/`):**
- `backend/app/api/segmented_projects.py` — add `POST /segmented-projects/{pid}/chapters:batch`.
- `backend/app/services/segmented_project_service.py` — add `batch_create_structure()`.
- `backend/app/schemas/segmented_project.py` — add `ChaptersBatchRequest` / `ChaptersBatchResponse` (verify path).
- `backend/tests/integration/test_chapters_batch.py` — new.
- Phase C: delete `api/workflow.py`, `services/workflow_*.py` (5), `services/prompts/workflow_prompts.py`, `models/workflow_run.py`, `schemas/workflow.py`; modify `main.py`, `models/segmented_project.py`; DB migration.

**Frontend (Phase B, `frontend/`):**
- `frontend/package.json` — add `@langchain/langgraph-sdk`.
- `frontend/vite.config.ts` — add `/agent` proxy.
- `frontend/src/services/langgraph/client.ts`, `contracts.ts`, `types.ts` — new.
- `frontend/src/components/Workflow/WorkflowDrawer.tsx` (+css), `DrawerIndicator.tsx` (+css), `PipelineTimeline.tsx` (+css), `StageCard.tsx` (+css), `ReviewPanel.tsx` (+css), `StageDetailModal.tsx` (+css) — new.
- `frontend/src/components/ProjectShell/ProjectShell.tsx` + `frontend/src/i18n/{zh-CN,en-US}.ts` — remove `workflow` nav item.
- `frontend/src/pages/TTSSynthesis.tsx` — remove `workflow` section branch.
- `frontend/src/components/ProjectLibrary/ProjectLibrary.tsx` — add 生成旁白 trigger + drawer mount.
- Delete: `WorkflowPage.tsx`, `WorkflowHub.tsx`(+css), `LiveProgress.tsx`(+css), `WorkflowRunDetail.tsx`(+css), `ReviewEditor.tsx`(+css), `hooks/useWorkflowStream.ts`.

**E2E:**
- `playwright.config.ts` — add agent webServer (3-process array).
- `tests/e2e/specs/workflow.spec.ts` — rewrite (8 cases).
- `tests/e2e/helpers/langgraphAssertions.ts` — `readAgentThread`, `validateThreadState`, `verifyAgentStateWithScreenshot`.

---

## Phase A — Agent + backend batch endpoint

### Task A1: Agent project scaffolding + config

**Files:**
- Create: `agent/app/__init__.py`, `agent/app/config.py`, `agent/.env.example`
- Modify: `agent/pyproject.toml`
- Test: `agent/tests/__init__.py`, `agent/tests/test_config.py`, `agent/tests/conftest.py`

**Interfaces:**
- Produces: `get_agent_llm_config() -> tuple[str, str, str]` (api_key, base_url, model); `get_backend_url() -> str`.

- [ ] **Step 1: Write failing test for config**

`agent/tests/test_config.py`:
```python
import pytest
from app.config import get_agent_llm_config, get_backend_url


def test_get_backend_url_default(monkeypatch):
    monkeypatch.delenv("BACKEND_API_URL", raising=False)
    assert get_backend_url() == "http://127.0.0.1:8002"


def test_get_backend_url_from_env(monkeypatch):
    monkeypatch.setenv("BACKEND_API_URL", "http://example:9999")
    assert get_backend_url() == "http://example:9999"


def test_get_agent_llm_config_reads_env(monkeypatch):
    monkeypatch.setenv("AGENT_LLM_API_KEY", "k1")
    monkeypatch.setenv("AGENT_LLM_BASE_URL", "http://dashscope")
    monkeypatch.setenv("AGENT_LLM_MODEL", "qwen-plus")
    key, base, model = get_agent_llm_config()
    assert key == "k1" and base == "http://dashscope" and model == "qwen-plus"


def test_get_agent_llm_config_missing_raises(monkeypatch):
    monkeypatch.delenv("AGENT_LLM_API_KEY", raising=False)
    monkeypatch.delenv("AGENT_LLM_BASE_URL", raising=False)
    monkeypatch.delenv("AGENT_LLM_MODEL", raising=False)
    with pytest.raises(ValueError):
        get_agent_llm_config()
```

`agent/tests/conftest.py`:
```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent && uv run --extra test pytest tests/test_config.py -v`
Expected: FAIL — `ModuleNotFoundError: app.config`.

- [ ] **Step 3: Implement config**

`agent/app/config.py`:
```python
"""Agent configuration — reads env vars for backend URL + LLM credentials."""
from __future__ import annotations
import os


def get_backend_url() -> str:
    return os.getenv("BACKEND_API_URL", "http://127.0.0.1:8002").rstrip("/")


def get_agent_llm_config() -> tuple[str, str, str]:
    """Return (api_key, base_url, model). AGENT_LLM_* only; raises if any missing."""
    api_key = os.getenv("AGENT_LLM_API_KEY")
    base_url = (os.getenv("AGENT_LLM_BASE_URL") or "").rstrip("/")
    model = os.getenv("AGENT_LLM_MODEL")
    if not api_key or not base_url or not model:
        raise ValueError(
            "AGENT_LLM_API_KEY / AGENT_LLM_BASE_URL / AGENT_LLM_MODEL must all be set in agent/.env"
        )
    return api_key, base_url, model
```

`agent/app/__init__.py`: (empty)
`agent/tests/__init__.py`: (empty)

- [ ] **Step 4: Update pyproject.toml**

`agent/pyproject.toml` — replace the `[project]` dependencies block and add test extra:
```toml
[project]
name = "agent"
version = "0.1.0"
description = "NarraForge narration workflow LangGraph agent"
readme = "README.md"
requires-python = ">=3.12"
dependencies = [
    "langgraph>=1.2.9",
    "langgraph-cli[inmem]>=0.1.0",
    "pydantic>=2.13.4",
    "httpx>=0.27",
    "instructor>=1.4",
    "langchain-core>=0.3",
    "openai>=1.50",
    "langsmith>=0.3",
]

[project.optional-dependencies]
test = ["pytest>=8.0", "pytest-asyncio>=0.23"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
pythonpath = ["."]
```

Run: `cd agent && uv sync --extra test`

- [ ] **Step 5: Run test to verify pass**

Run: `cd agent && uv run --extra test pytest tests/test_config.py -v`
Expected: PASS (4 tests).

- [ ] **Step 6: Create .env.example**

`agent/.env.example`:
```
BACKEND_API_URL=http://127.0.0.1:8002
# LLM provider (OpenAI-compatible). AGENT_LLM_* only - all three required.
AGENT_LLM_API_KEY=
AGENT_LLM_BASE_URL=
AGENT_LLM_MODEL=
# Optional: LangSmith prompt hub. If absent, code-default prompts are used.
LANGSMITH_API_KEY=
```

- [ ] **Step 7: Commit**

```bash
git add agent/pyproject.toml agent/app/__init__.py agent/app/config.py agent/.env.example agent/tests/
git commit -m "feat(agent): project scaffold + config module"
```

---

### Task A2: Pydantic schemas

**Files:**
- Create: `agent/app/schemas.py`
- Test: `agent/tests/test_schemas.py`

**Interfaces:**
- Produces: `ReviewDimension`, `ReviewResult`, `Segment`, `ChapterStructure`, `SegmentChapters`, `Preference`, `SynthResult`, `ChapterWithSegmentIds` (+ `SegmentWithId`).

- [ ] **Step 1: Write failing test**

`agent/tests/test_schemas.py`:
```python
import pytest
from pydantic import ValidationError
from app.schemas import (
    ReviewDimension, ReviewResult, Segment, ChapterStructure,
    SegmentChapters, Preference, SynthResult, ChapterWithSegmentIds,
)


def test_review_result_valid():
    r = ReviewResult(
        dimensions=[ReviewDimension(name="x", status="pass", comment="ok")],
        overall_score=4, overall_comment="good", has_critical_issue=False,
    )
    assert r.overall_score == 4


def test_review_dimension_bad_status():
    with pytest.raises(ValidationError):
        ReviewDimension(name="x", status="bad", comment="ok")


def test_segment_defaults():
    s = Segment(text="hi")
    assert s.role == "narration" and s.segment_kind == "narration"


def test_segment_chapters_wraps_list():
    sc = SegmentChapters(chapters=[ChapterStructure(chapter_title="c", segments=[Segment(text="t")])])
    assert sc.chapters[0].segments[0].text == "t"


def test_preference_category_enum():
    p = Preference(preference="short", category="pacing")
    assert p.category == "pacing"
    with pytest.raises(ValidationError):
        Preference(preference="x", category="nope")


def test_chapter_with_segment_ids():
    c = ChapterWithSegmentIds(id="ch1", segments=[{"id": "s1"}])
    assert c.segments[0]["id"] == "s1"
```

- [ ] **Step 2: Run test — fails (ModuleNotFoundError)**

Run: `cd agent && uv run --extra test pytest tests/test_schemas.py -v`

- [ ] **Step 3: Implement schemas**

`agent/app/schemas.py`:
```python
"""Pydantic models — single source of truth for graph state + instructor validation."""
from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field


class ReviewDimension(BaseModel):
    name: str
    status: Literal["pass", "warn", "fail"]
    comment: str
    suggestion: str | None = None


class ReviewResult(BaseModel):
    dimensions: list[ReviewDimension]
    overall_score: int = Field(ge=1, le=5)
    overall_comment: str
    has_critical_issue: bool


class Segment(BaseModel):
    text: str
    emotion: Literal["neutral", "happy", "sad", "angry", "calm", "excited"] = "neutral"
    role: str = "narration"
    segment_kind: Literal["narration", "dialogue"] = "narration"


class ChapterStructure(BaseModel):
    chapter_title: str
    segments: list[Segment]


class SegmentChapters(BaseModel):
    """Object wrapper required for JSON-mode structured output."""
    chapters: list[ChapterStructure]


class Preference(BaseModel):
    preference: str
    category: Literal["pacing", "style", "length", "tone", "structure", "other"]


class SynthResult(BaseModel):
    chapter_id: str
    segment_id: str
    audio_path: str | None = None
    duration_sec: float | None = None


class SegmentWithId(BaseModel):
    id: str


class ChapterWithSegmentIds(BaseModel):
    id: str
    segments: list[SegmentWithId]
```

- [ ] **Step 4: Run test — pass**

Run: `cd agent && uv run --extra test pytest tests/test_schemas.py -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add agent/app/schemas.py agent/tests/test_schemas.py
git commit -m "feat(agent): pydantic schemas for workflow state"
```

---

### Task A3: Prompts module (defaults + LangSmith loader)

**Files:**
- Create: `agent/app/prompts/__init__.py`, `agent/app/prompts/narration.py`
- Test: `agent/tests/test_prompts.py`

**Interfaces:**
- Produces: `get_prompt(name: str, **vars) -> str` (LangSmith-first, code-default fallback); constants `GEN_SCRIPT_SYSTEM_PROMPT`, `SCRIPT_REVIEW_SYSTEM_PROMPT`, `SPLIT_SEGMENT_SYSTEM_PROMPT`, `PREFERENCE_EXTRACT_PROMPT`.

- [ ] **Step 1: Write failing test**

`agent/tests/test_prompts.py`:
```python
import pytest
from app.prompts.narration import get_prompt, GEN_SCRIPT_SYSTEM_PROMPT


def test_get_prompt_falls_back_to_default_when_langsmith_unconfigured(monkeypatch):
    monkeypatch.delenv("LANGSMITH_API_KEY", raising=False)
    assert get_prompt("gen_script") == GEN_SCRIPT_SYSTEM_PROMPT


def test_get_prompt_unknown_name_raises():
    with pytest.raises(KeyError):
        get_prompt("nope")


def test_get_prompt_formats_vars_on_default(monkeypatch):
    monkeypatch.delenv("LANGSMITH_API_KEY", raising=False)
    out = get_prompt("preference_extract", feedback="fix intro")
    assert "fix intro" in out
```

- [ ] **Step 2: Run test - fails**

Run: `cd agent && uv run --extra test pytest tests/test_prompts.py -v`

- [ ] **Step 3: Create prompts module**

`agent/app/prompts/__init__.py`: (empty)

`agent/app/prompts/narration.py` - first copy verbatim the four prompt constants from `backend/app/services/prompts/workflow_prompts.py` (`GEN_SCRIPT_SYSTEM_PROMPT`, `SCRIPT_REVIEW_SYSTEM_PROMPT`, `SPLIT_SEGMENT_SYSTEM_PROMPT`, `PREFERENCE_EXTRACT_PROMPT`). Keep `{{` / `}}` escaping in `PREFERENCE_EXTRACT_PROMPT` (it uses `.format(feedback=...)`). Then append the loader:

```python
from langsmith import Client
from langsmith.client import convert_prompt_to_openai_format

_DEFAULTS = {
    "gen_script": GEN_SCRIPT_SYSTEM_PROMPT,
    "script_review": SCRIPT_REVIEW_SYSTEM_PROMPT,
    "split_segment": SPLIT_SEGMENT_SYSTEM_PROMPT,
    "preference_extract": PREFERENCE_EXTRACT_PROMPT,
}
_LANGSMITH_NAMES = {
    "gen_script": "narraforge-gen-script",
    "script_review": "narraforge-script-review",
    "split_segment": "narraforge-split-segment",
    "preference_extract": "narraforge-preference-extract",
}
_client: Client | None = None


def get_prompt(name: str, **vars) -> str:
    """Return prompt text: LangSmith first, code default on any failure."""
    if name not in _DEFAULTS:
        raise KeyError(name)
    default = _DEFAULTS[name]
    ls_name = _LANGSMITH_NAMES.get(name)
    if ls_name:
        try:
            global _client
            if _client is None:
                _client = Client()  # reads LANGSMITH_API_KEY; raises if absent
            pt = _client.pull_prompt(ls_name)
            msgs = convert_prompt_to_openai_format(pt.invoke(vars))
            for m in msgs:
                if m.get("role") == "system" and m.get("content"):
                    return m["content"]
            if msgs and msgs[0].get("content"):
                return msgs[0]["content"]
        except Exception:
            pass  # fall through to default
    return default.format(**vars) if vars else default
```

- [ ] **Step 4: Run test - pass**

Run: `cd agent && uv run --extra test pytest tests/test_prompts.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add agent/app/prompts/ agent/tests/test_prompts.py
git commit -m "feat(agent): prompts with LangSmith-first loader + code fallback"
```

---

### Task A4: LLM client (instructor + raw streaming)

**Files:**
- Create: `agent/app/llm.py`
- Test: `agent/tests/test_llm.py`

**Interfaces:**
- Produces: `get_instructor_client() -> tuple[instructor.AsyncInstructor, str]`; `stream_llm(messages, on_chunk) -> str`.

- [ ] **Step 1: Write failing test**

`agent/tests/test_llm.py`:
```python
import instructor
from instructor import Mode
from app.llm import get_instructor_client, stream_llm


def test_instructor_client_dashscope_json(monkeypatch):
    monkeypatch.setenv("AGENT_LLM_API_KEY", "k")
    monkeypatch.setenv("AGENT_LLM_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    monkeypatch.setenv("AGENT_LLM_MODEL", "qwen-plus")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("MIMO_API_KEY", raising=False)
    client, model = get_instructor_client()
    assert isinstance(client, instructor.AsyncInstructor)
    assert model == "qwen-plus"


def test_instructor_client_mimo_md_json(monkeypatch):
    monkeypatch.setenv("AGENT_LLM_API_KEY", "k")
    monkeypatch.setenv("AGENT_LLM_BASE_URL", "https://api.xiaomimimo.com/v1")
    monkeypatch.setenv("AGENT_LLM_MODEL", "mimo-1")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("MIMO_API_KEY", raising=False)
    client, model = get_instructor_client()
    assert isinstance(client, instructor.AsyncInstructor)
    assert model == "mimo-1"
    # MiMo uses MD_JSON mode; the underlying openai client gets the api-key header
    raw = client.client
    assert raw.default_headers.get("api-key") == "k"
```

(We don't unit-test `stream_llm` against a real API; it's exercised in the graph integration test with a mock.)

- [ ] **Step 2: Run test — fails**

Run: `cd agent && uv run --extra test pytest tests/test_llm.py -v`

- [ ] **Step 3: Implement llm.py**

`agent/app/llm.py`:
```python
"""LLM layer: instructor for structured nodes, raw streaming for gen_script."""
from __future__ import annotations
from typing import Awaitable, Callable
import instructor
from openai import AsyncOpenAI
from instructor import Mode
from app.config import get_agent_llm_config


def get_instructor_client() -> tuple[instructor.AsyncInstructor, str]:
    api_key, base_url, model = get_agent_llm_config()
    if "xiaomimimo" in base_url:
        raw = AsyncOpenAI(base_url=base_url, api_key=api_key, default_headers={"api-key": api_key})
        mode = Mode.MD_JSON
    else:
        raw = AsyncOpenAI(base_url=base_url, api_key=api_key)
        mode = Mode.JSON
    return instructor.from_openai(raw, mode=mode), model


async def stream_llm(
    messages: list[dict],
    on_chunk: Callable[[str], Awaitable[None]] | None = None,
    *,
    model: str | None = None,
    temperature: float = 0.3,
    max_tokens: int = 8192,
    timeout: float = 300.0,
) -> str:
    """Stream a plain-text LLM response; call on_chunk per token. Returns full text."""
    api_key, base_url, default_model = get_agent_llm_config()
    model = model or default_model
    client = AsyncOpenAI(base_url=base_url, api_key=api_key)
    acc = ""
    stream = await client.chat.completions.create(
        model=model, messages=messages, temperature=temperature,
        max_tokens=max_tokens, stream=True, timeout=timeout,
    )
    async for event in stream:
        if not event.choices:
            continue
        delta = event.choices[0].delta
        content = getattr(delta, "content", None) or ""
        if content:
            acc += content
            if on_chunk is not None:
                await on_chunk(content)
    return acc
```

- [ ] **Step 4: Run test — pass**

Run: `cd agent && uv run --extra test pytest tests/test_llm.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add agent/app/llm.py agent/tests/test_llm.py
git commit -m "feat(agent): instructor + raw streaming LLM client"
```

---

### Task A5: BackendClient (async HTTP to backend)

**Files:**
- Create: `agent/app/backend_client.py`
- Test: `agent/tests/test_backend_client.py`

**Interfaces:**
- Produces: `BackendClient` with `get_project(pid)`, `batch_create_structure(pid, structure)`, `synthesize_segment(pid, cid, sid)`.
- Consumes: backend endpoints `GET /api/segmented-projects/{pid}`, `POST /api/segmented-projects/{pid}/chapters:batch` (Task A9), `POST /api/segmented-projects/{pid}/chapters/{cid}/segments/{sid}/synthesize` (exists).

- [ ] **Step 1: Write failing test**

`agent/tests/test_backend_client.py`:
```python
import httpx
import pytest
from app.backend_client import BackendClient
from app.schemas import SegmentChapters, ChapterStructure, Segment


@pytest.mark.asyncio
async def test_get_project_calls_correct_url(httpx_mock):
    httpx_mock.add_response(url="http://test:8002/api/segmented-projects/p1", json={"id": "p1", "name": "n"})
    c = BackendClient("http://test:8002")
    proj = await c.get_project("p1")
    assert proj["id"] == "p1"


@pytest.mark.asyncio
async def test_batch_create_structure_posts_and_returns_ids(httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url="http://test:8002/api/segmented-projects/p1/chapters:batch",
        json={"chapters": [{"id": "ch1", "segments": [{"id": "s1"}]}]},
    )
    c = BackendClient("http://test:8002")
    sc = SegmentChapters(chapters=[ChapterStructure(chapter_title="c", segments=[Segment(text="t")])])
    result = await c.batch_create_structure("p1", sc)
    assert result[0].id == "ch1"
    assert result[0].segments[0].id == "s1"


@pytest.mark.asyncio
async def test_synthesize_segment_posts(httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url="http://test:8002/api/segmented-projects/p1/chapters/ch1/segments/s1/synthesize",
        json={},
    )
    c = BackendClient("http://test:8002")
    await c.synthesize_segment("p1", "ch1", "s1")  # no raise


@pytest.mark.asyncio
async def test_get_project_retries_on_500(httpx_mock):
    httpx_mock.add_response(url="http://test:8002/api/segmented-projects/p1", status_code=500)
    httpx_mock.add_response(url="http://test:8002/api/segmented-projects/p1", json={"id": "p1"})
    c = BackendClient("http://test:8002")
    proj = await c.get_project("p1")
    assert proj["id"] == "p1"
```

(Uses `pytest-httpx` for mocking. Add to test extra.)

- [ ] **Step 2: Add pytest-httpx dep**

`agent/pyproject.toml` test extra:
```toml
test = ["pytest>=8.0", "pytest-asyncio>=0.23", "pytest-httpx>=0.30"]
```
Run: `cd agent && uv sync --extra test`

- [ ] **Step 3: Run test — fails**

Run: `cd agent && uv run --extra test pytest tests/test_backend_client.py -v`

- [ ] **Step 4: Implement backend_client.py**

`agent/app/backend_client.py`:
```python
"""Async HTTP client for the NarraForge backend. The agent's only backend contract."""
from __future__ import annotations
import httpx
from app.config import get_backend_url
from app.schemas import SegmentChapters, ChapterWithSegmentIds, SegmentWithId


class BackendClient:
    def __init__(self, base_url: str | None = None, *, transport: httpx.AsyncBaseTransport | None = None):
        self._base = (base_url or get_backend_url()).rstrip("/")
        # 2 retries with backoff for transient errors
        self._transport = transport or httpx.AsyncHTTPTransport(retries=2)
        self._client: httpx.AsyncClient | None = None

    async def _ensure(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(base_url=self._base, transport=self._transport, timeout=300.0)
        return self._client

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def get_project(self, project_id: str) -> dict:
        c = await self._ensure()
        r = await c.get(f"/api/segmented-projects/{project_id}")
        r.raise_for_status()
        return r.json()

    async def batch_create_structure(self, project_id: str, structure: SegmentChapters) -> list[ChapterWithSegmentIds]:
        c = await self._ensure()
        payload = structure.model_dump()
        r = await c.post(f"/api/segmented-projects/{project_id}/chapters:batch", json=payload)
        r.raise_for_status()
        data = r.json()
        return [
            ChapterWithSegmentIds(id=ch["id"], segments=[SegmentWithId(id=s["id"]) for s in ch["segments"]])
            for ch in data["chapters"]
        ]

    async def synthesize_segment(self, project_id: str, chapter_id: str, segment_id: str) -> None:
        c = await self._ensure()
        r = await c.post(
            f"/api/segmented-projects/{project_id}/chapters/{chapter_id}/segments/{segment_id}/synthesize",
            json={"params": None, "text": None, "ssml": None, "keep_previous": True},
        )
        r.raise_for_status()
```

- [ ] **Step 5: Run test — pass**

Run: `cd agent && uv run --extra test pytest tests/test_backend_client.py -v`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add agent/app/backend_client.py agent/tests/test_backend_client.py agent/pyproject.toml
git commit -m "feat(agent): backend HTTP client with retry"
```

---

### Task A6: Graph state

**Files:**
- Create: `agent/app/state.py`

- [ ] **Step 1: Implement state**

`agent/app/state.py`:
```python
"""Shared state TypedDict flowing through the narration pipeline."""
from __future__ import annotations
from typing import Any, TypedDict
from typing_extensions import Literal
from app.schemas import ChapterStructure, ReviewResult, SynthResult


class NarrationWorkflowState(TypedDict, total=False):
    # inputs
    project_id: str
    # gen_script
    source_document: str
    narration_script: str
    script_chapters: list[ChapterStructure]
    # script_review
    review_feedback: ReviewResult
    edited_script: str
    review_status: Literal["approved", "rejected"]
    # split_segment
    structured_segments: list[ChapterStructure]   # carries backend-assigned ids after split
    # synthesis
    synthesis_results: list[SynthResult]
    # metadata
    current_stage: str
    review_retry_count: int
    error: str | None
```

- [ ] **Step 2: Verify import**

Run: `cd agent && uv run python -c "from app.state import NarrationWorkflowState; print('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add agent/app/state.py
git commit -m "feat(agent): workflow state TypedDict"
```

---

### Task A7: gen_script node

**Files:**
- Create: `agent/app/nodes/__init__.py`, `agent/app/nodes/gen_script.py`
- Test: `agent/tests/test_gen_script.py`

**Interfaces:**
- Produces: `gen_script_node(state, runtime) -> dict`.
- Consumes: `BackendClient.get_project`, `runtime.store.asearch`, `stream_llm`, `get_stream_writer`, `GEN_SCRIPT_SYSTEM_PROMPT`.

- [ ] **Step 1: Write failing test**

`agent/tests/test_gen_script.py`:
```python
import pytest
from app.nodes.gen_script import gen_script_node, parse_markdown_chapters


def test_parse_markdown_chapters_splits_on_headings():
    md = "# Chapter One\ncontent one\n# Chapter Two\ncontent two"
    chapters = parse_markdown_chapters(md)
    assert len(chapters) == 2
    assert chapters[0]["title"] == "Chapter One"
    assert chapters[0]["content"] == "content one"


class FakeStore:
    def __init__(self, items=None):
        self._items = items or []
    async def asearch(self, namespace, *, query=None, limit=10):
        return self._items


class FakeRuntime:
    def __init__(self, store):
        self.store = store


@pytest.mark.asyncio
async def test_gen_script_node_calls_llm_and_emits_milestones(monkeypatch):
    emitted = []
    async def fake_stream(messages, on_chunk=None, **kw):
        if on_chunk:
            await on_chunk("hello ")
            await on_chunk("world")
        return "hello world"

    def fake_writer():
        async def w(payload):
            emitted.append(payload)
        return w

    monkeypatch.setattr("app.nodes.gen_script.stream_llm", fake_stream)
    monkeypatch.setattr("app.nodes.gen_script.get_stream_writer", fake_writer)

    state = {"project_id": "p1", "run_id": "r1", "source_document": "src text", "current_stage": "gen_script"}
    runtime = FakeRuntime(FakeStore())

    result = await gen_script_node(state, runtime)

    assert result["narration_script"] == "hello world"
    assert result["current_stage"] == "script_review"
    assert result["error"] is None
    # milestones: stage_start, llm_call, llm_response, stage_complete
    types = [e["type"] for e in emitted]
    assert "stage_start" in types and "llm_call" in types and "llm_response" in types and "stage_complete" in types


@pytest.mark.asyncio
async def test_gen_script_node_empty_script_is_soft_error(monkeypatch):
    async def fake_stream(messages, on_chunk=None, **kw):
        return "   "
    monkeypatch.setattr("app.nodes.gen_script.stream_llm", fake_stream)
    monkeypatch.setattr("app.nodes.gen_script.get_stream_writer", lambda: (lambda payload: None))

    state = {"project_id": "p1", "run_id": "r1", "source_document": "src", "current_stage": "gen_script"}
    result = await gen_script_node(state, FakeRuntime(FakeStore()))
    assert result["error"] is not None
    assert result["current_stage"] == "script_review"
```

- [ ] **Step 2: Run test — fails**

Run: `cd agent && uv run --extra test pytest tests/test_gen_script.py -v`

- [ ] **Step 3: Implement gen_script node**

`agent/app/nodes/__init__.py`: (empty)

`agent/app/nodes/gen_script.py`:
```python
"""GenScript node: source document -> narration script (streamed)."""
from __future__ import annotations
from langgraph.config import get_stream_writer
from app.llm import stream_llm
from app.prompts.narration import get_prompt


def parse_markdown_chapters(script: str) -> list[dict[str, str]]:
    chapters: list[dict[str, str]] = []
    current_title: str | None = None
    current_lines: list[str] = []
    for line in script.split("\n"):
        if line.startswith("# ") or line.startswith("## "):
            if current_title is not None:
                chapters.append({"title": current_title, "content": "\n".join(current_lines).strip()})
            current_title = line.lstrip("#").strip()
            current_lines = []
        else:
            current_lines.append(line)
    if current_title is not None:
        chapters.append({"title": current_title, "content": "\n".join(current_lines).strip()})
    return chapters


async def gen_script_node(state, runtime) -> dict:
    project_id = state["project_id"]
    run_id = state.get("run_id", "")
    writer = get_stream_writer()

    async def emit(payload):
        writer(payload)

    await emit({"type": "stage_start", "stage": "gen_script", "message": "开始生成旁白脚本..."})

    # past reject feedback
    feedback_context = ""
    if runtime.store is not None:
        try:
            past = await runtime.store.asearch(("director_feedback", project_id), query="reject feedback", limit=3)
            lines = [f"- {it.value.get('feedback', '')}" for it in past if it.value.get("feedback")]
            if lines:
                feedback_context = "\n\n## 导演历史反馈（请参考）\n" + "\n".join(lines)
        except Exception:
            pass

    await emit({"type": "llm_call", "stage": "gen_script", "message": f"正在调用 LLM 生成脚本 (文档长度: {len(state['source_document'])} 字)...", "data": {"doc_len": len(state["source_document"])}})

    chunk_count = 0
    acc = {"len": 0}

    async def on_chunk(chunk: str):
        nonlocal chunk_count
        chunk_count += 1
        acc["len"] += len(chunk)
        if chunk_count % 10 == 0:
            await emit({"type": "llm_streaming", "stage": "gen_script", "message": f"正在生成脚本... ({acc['len']} 字)", "data": {"total_length": acc["len"]}})

    script = await stream_llm(
        [
            {"role": "system", "content": get_prompt("gen_script")},
            {"role": "user", "content": f"请将以下源文档转化为视频旁白脚本：\n\n{state['source_document']}{feedback_context}"},
        ],
        on_chunk=on_chunk,
    )

    if not script or not script.strip():
        await emit({"type": "error", "stage": "gen_script", "message": "LLM 返回了空脚本"})
        return {"error": "LLM 返回了空脚本，请重试", "current_stage": "script_review"}

    chapters = parse_markdown_chapters(script)
    preview = script[:200] + ("..." if len(script) > 200 else "")
    await emit({
        "type": "llm_response", "stage": "gen_script",
        "message": f"脚本生成完成: {len(chapters)} 章节, {len(script)} 字",
        "data": {"chapters_count": len(chapters), "script_length": len(script), "script_preview": preview},
    })
    await emit({"type": "stage_complete", "stage": "gen_script", "message": "脚本生成阶段完成"})

    return {"narration_script": script, "script_chapters": chapters, "current_stage": "script_review", "error": None}
```

- [ ] **Step 4: Run test — pass**

Run: `cd agent && uv run --extra test pytest tests/test_gen_script.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add agent/app/nodes/__init__.py agent/app/nodes/gen_script.py agent/tests/test_gen_script.py
git commit -m "feat(agent): gen_script node with streaming + milestones"
```

---

### Task A8: script_review node (instructor + interrupt)

**Files:**
- Create: `agent/app/nodes/script_review.py`
- Test: `agent/tests/test_script_review.py`

**Interfaces:**
- Produces: `script_review_node(state, runtime) -> dict`.
- Consumes: `get_instructor_client`, `interrupt`, `runtime.store`, `SCRIPT_REVIEW_SYSTEM_PROMPT`, `PREFERENCE_EXTRACT_PROMPT`.

- [ ] **Step 1: Write failing test**

`agent/tests/test_script_review.py`:
```python
import pytest
from app.nodes.script_review import script_review_node
from app.schemas import ReviewResult, ReviewDimension


class FakeStore:
    def __init__(self):
        self.put_calls = []
    async def aput(self, namespace, key, value):
        self.put_calls.append((namespace, key, value))
    async def asearch(self, namespace, *, query=None, limit=10):
        return []


class FakeRuntime:
    def __init__(self, store):
        self.store = store


def _review(score=4, critical=False, fail=False):
    dims = [ReviewDimension(name="内容忠实度", status="fail" if fail else "pass", comment="ok")]
    return ReviewResult(dimensions=dims, overall_score=score, overall_comment="c", has_critical_issue=critical)


@pytest.mark.asyncio
async def test_review_auto_reject_on_low_score(monkeypatch):
    """Score < 3 with retry_count < MAX -> auto reject, no interrupt."""
    client = type("C", (), {"create": None})()
    async def fake_create(**kw):
        return _review(score=2)
    client.create = fake_create
    monkeypatch.setattr("app.nodes.script_review.get_instructor_client", lambda: (client, "m"))
    monkeypatch.setattr("app.nodes.script_review.get_stream_writer", lambda: (lambda p: None))

    state = {"project_id": "p1", "run_id": "r1", "narration_script": "s", "review_retry_count": 0, "current_stage": "script_review"}
    result = await script_review_node(state, FakeRuntime(FakeStore()))
    assert result["review_status"] == "rejected"
    assert result["current_stage"] == "gen_script"
    assert result["review_retry_count"] == 1


@pytest.mark.asyncio
async def test_review_interrupts_on_passing_score(monkeypatch):
    """Score >= 3 -> interrupt for human."""
    interrupted = {}
    def fake_interrupt(payload):
        interrupted["payload"] = payload
        return {"action": "approve", "edited_script": "edited", "comment": "good"}
    client = type("C", (), {})()
    async def fake_create(**kw):
        return _review(score=4)
    client.create = fake_create
    monkeypatch.setattr("app.nodes.script_review.get_instructor_client", lambda: (client, "m"))
    monkeypatch.setattr("app.nodes.script_review.interrupt", fake_interrupt)
    monkeypatch.setattr("app.nodes.script_review.get_stream_writer", lambda: (lambda p: None))

    state = {"project_id": "p1", "run_id": "r1", "narration_script": "s", "review_retry_count": 0, "current_stage": "script_review"}
    result = await script_review_node(state, FakeRuntime(FakeStore()))
    assert result["review_status"] == "approved"
    assert result["edited_script"] == "edited"
    assert result["current_stage"] == "split_segment"
    assert "payload" in interrupted
```

- [ ] **Step 2: Run test — fails**

Run: `cd agent && uv run --extra test pytest tests/test_script_review.py -v`

- [ ] **Step 3: Implement script_review node**

`agent/app/nodes/script_review.py`:
```python
"""ScriptReview node: LLM auto-review (instructor) + human-in-the-loop interrupt."""
from __future__ import annotations
import asyncio
from datetime import datetime, timezone
from uuid import uuid4
from langgraph.config import get_stream_writer
from langgraph.types import interrupt
from app.llm import get_instructor_client
from app.prompts.narration import get_prompt
from app.schemas import ReviewResult, Preference

MAX_AUTO_REJECT = 3


async def _extract_preference(runtime, project_id: str, feedback: str) -> None:
    """Best-effort preference extraction; never raises."""
    if runtime.store is None or not feedback:
        return
    try:
        client, model = get_instructor_client()
        pref = await client.create(
            response_model=Preference, model=model, max_retries=1,
            messages=[
                {"role": "system", "content": "你是一个偏好提取器，从用户的反馈中提取具体的创作偏好。"},
                {"role": "user", "content": get_prompt("preference_extract", feedback=feedback)},
            ],
        )
        await runtime.store.aput(("director_preference", "global"), key=str(uuid4()), value={
            "preference": pref.preference, "category": pref.category,
            "extracted_from": feedback[:100], "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        pass


async def script_review_node(state, runtime) -> dict:
    project_id = state["project_id"]
    run_id = state.get("run_id", "")
    writer = get_stream_writer()
    async def emit(p): writer(p)

    await emit({"type": "stage_start", "stage": "script_review", "message": "开始脚本审查..."})
    await emit({"type": "llm_call", "stage": "script_review", "message": "正在调用 LLM 进行脚本审查..."})

    client, model = get_instructor_client()
    review: ReviewResult = await client.create(
        response_model=ReviewResult, model=model, max_retries=2,
        messages=[
            {"role": "system", "content": get_prompt("script_review")},
            {"role": "user", "content": f"请审查以下旁白脚本：\n\n{state['narration_script']}"},
        ],
    )

    if runtime.store is not None:
        try:
            await runtime.store.aput(("director_feedback", project_id), key=f"review_{run_id}", value={
                "type": "llm_review", "review": review.model_dump(), "run_id": run_id,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            pass

    retry_count = state.get("review_retry_count", 0)
    should_auto_reject = (
        retry_count < MAX_AUTO_REJECT
        and (review.has_critical_issue or review.overall_score < 3
             or any(d.status == "fail" for d in review.dimensions))
    )
    if should_auto_reject:
        await emit({"type": "auto_reject", "stage": "script_review",
                    "message": f"LLM 审查未通过（评分 {review.overall_score}/5），自动重新生成...",
                    "data": {"review": review.model_dump(), "retry": retry_count + 1}})
        return {"review_feedback": review, "review_status": "rejected",
                "current_stage": "gen_script", "review_retry_count": retry_count + 1, "error": None}

    dims_summary = [{"name": d.name, "status": d.status, "comment": d.comment[:100]} for d in review.dimensions]
    await emit({"type": "interrupt", "stage": "script_review",
                "message": f"脚本审查完成，评分: {review.overall_score}/5，等待导演审批...",
                "data": {"review": review.model_dump(), "dimensions_summary": dims_summary,
                         "overall_comment": review.overall_comment, "has_critical_issue": review.has_critical_issue}})

    decision = interrupt({
        "script": state["narration_script"],
        "review": review.model_dump(),
        "available_actions": ["approve", "reject"],
    })

    if decision.get("action") == "approve":
        edited_script = decision.get("edited_script", state["narration_script"])
        if decision.get("comment") and runtime.store is not None:
            try:
                await runtime.store.aput(("director_feedback", project_id), key=f"comment_{run_id}", value={
                    "type": "director_comment", "comment": decision["comment"], "action": "approve",
                    "run_id": run_id, "created_at": datetime.now(timezone.utc).isoformat(),
                })
            except Exception:
                pass
            await _extract_preference(runtime, project_id, decision["comment"])
        return {"edited_script": edited_script, "review_feedback": review,
                "review_status": "approved", "current_stage": "split_segment", "error": None}

    # reject
    feedback = decision.get("feedback", "")
    if runtime.store is not None:
        try:
            await runtime.store.aput(("director_feedback", project_id), key=f"reject_{run_id}", value={
                "type": "reject_feedback", "feedback": feedback, "run_id": run_id,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            pass
    if feedback:
        await _extract_preference(runtime, project_id, feedback)
    return {"review_feedback": review, "review_status": "rejected",
            "current_stage": "gen_script", "error": None}
```

- [ ] **Step 4: Run test — pass**

Run: `cd agent && uv run --extra test pytest tests/test_script_review.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add agent/app/nodes/script_review.py agent/tests/test_script_review.py
git commit -m "feat(agent): script_review node with instructor + interrupt + auto-reject"
```

---

### Task A9: Backend chapters:batch endpoint

**Files:**
- Modify: `backend/app/services/segmented_project_service.py` (add `batch_create_structure`)
- Modify: `backend/app/api/segmented_projects.py` (add endpoint)
- Modify: `backend/app/schemas/segmented_project.py` (add request/response schemas — verify the schema file path first)
- Test: `backend/tests/integration/test_chapters_batch.py`

**Interfaces:**
- Produces: `POST /api/segmented-projects/{pid}/chapters:batch`; `batch_create_structure(db, project_id, chapters) -> list[dict]`.

- [ ] **Step 1: Locate the segmented-project schema file**

Run: `cd backend && grep -rn "class ProjectDetail\|class ProjectIn\|class ChapterIn" app/schemas/ | head`
Note the file path (likely `app/schemas/segmented_project.py` or within `app/api/segmented_projects.py`).

- [ ] **Step 2: Write failing test**

`backend/tests/integration/test_chapters_batch.py`:
```python
"""Integration test for the chapters:batch endpoint used by split_segment node."""
from fastapi.testclient import TestClient


def test_batch_create_chapters_and_segments(client, db_session):
    # Seed a project
    from app.services.segmented_project_service import create_project
    project = create_project(db_session, name="t", layout="vertical")
    db_session.commit()

    payload = {
        "chapters": [
            {"chapter_title": "Ch1", "segments": [
                {"text": "seg one", "emotion": "neutral", "role": "narration", "segment_kind": "narration"},
                {"text": "seg two", "emotion": "happy", "role": "narration", "segment_kind": "narration"},
            ]},
            {"chapter_title": "Ch2", "segments": [
                {"text": "seg three", "emotion": "calm", "role": "narration", "segment_kind": "narration"},
            ]},
        ]
    }
    r = client.post(f"/api/segmented-projects/{project.id}/chapters:batch", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["chapters"]) == 2
    assert data["chapters"][0]["id"]
    assert len(data["chapters"][0]["segments"]) == 2
    assert data["chapters"][1]["segments"][0]["id"]

    # DB rows created
    from app.models.segmented_project import SegmentedProject
    db_session.expire_all()
    proj = db_session.query(SegmentedProject).get(project.id)
    assert len(proj.chapters) == 2
    assert len(proj.chapters[0].segments) == 2


def test_batch_replaces_existing_chapters(client, db_session):
    from app.services.segmented_project_service import create_project, create_chapter_for_project
    project = create_project(db_session, name="t2", layout="vertical")
    create_chapter_for_project(db_session, project.id, "old", 0)
    db_session.commit()
    assert len(project.chapters) == 1

    payload = {"chapters": [{"chapter_title": "new", "segments": [{"text": "x", "emotion": "neutral"}]}]}
    r = client.post(f"/api/segmented-projects/{project.id}/chapters:batch", json=payload)
    assert r.status_code == 200
    from app.models.segmented_project import SegmentedProject
    db_session.expire_all()
    proj = db_session.query(SegmentedProject).get(project.id)
    assert len(proj.chapters) == 1  # replaced, not duplicated
    assert proj.chapters[0].name == "new"


def test_batch_404_unknown_project(client, db_session):
    r = client.post("/api/segmented-projects/nope/chapters:batch", json={"chapters": []})
    assert r.status_code == 404
```

- [ ] **Step 3: Run test — fails**

Run: `cd backend && uv run --extra test pytest tests/integration/test_chapters_batch.py -v`
Expected: FAIL — 404 (route not registered) or name error.

- [ ] **Step 4: Add service function**

In `backend/app/services/segmented_project_service.py`, add (near the existing `create_chapter_for_project`):
```python
def batch_create_structure(db: Session, project_id: str, chapters: list[dict]) -> list[dict]:
    """Replace all chapters+segments of a project in one transaction.

    Resolves default voice from the project's first existing chapter (or edge_tts
    default), deletes existing chapters, creates the new structure, returns assigned ids.
    """
    project = get_project_row(db, project_id)
    if project is None:
        raise LookupError("project_not_found")

    # default voice: from first existing chapter, or edge_tts default
    default_voice = {"engine": "edge_tts", "voice": "zh-CN-YunxiNeural", "rate": "+0%", "volume": "+0%"}
    if project.chapters:
        ch_voice = project.chapters[0].voice or {}
        if ch_voice.get("voice") and ch_voice.get("engine") == "edge_tts":
            default_voice = ch_voice
        elif ch_voice.get("voice_id") and ch_voice.get("engine") in ("cosyvoice", "mimo_tts", "voxcpm"):
            default_voice = ch_voice

    # delete existing chapters (cascade deletes segments)
    for ch in list(project.chapters):
        db.delete(ch)
    db.flush()

    result = []
    for index, ch_data in enumerate(chapters):
        title = ch_data.get("chapter_title", f"Chapter {index + 1}")
        chapter = create_chapter_for_project(db, project_id, title, index, voice=default_voice)
        seg_result = []
        for seg_data in ch_data.get("segments", []):
            seg = create_segment_for_chapter(
                db, chapter.id, seg_data["text"], len(seg_result),
                emotion=seg_data.get("emotion"), role=seg_data.get("role"),
                segment_kind=seg_data.get("segment_kind", "narration"),
            )
            seg_result.append({"id": seg.id})
        result.append({"id": chapter.id, "segments": seg_result})
    db.commit()
    return result
```

- [ ] **Step 5: Add request/response schemas**

In the segmented-project schema file (path found in Step 1), add:
```python
class BatchSegmentIn(BaseModel):
    text: str
    emotion: str | None = None
    role: str | None = "narration"
    segment_kind: str | None = "narration"

class BatchChapterIn(BaseModel):
    chapter_title: str
    segments: list[BatchSegmentIn]

class ChaptersBatchRequest(BaseModel):
    chapters: list[BatchChapterIn]

class ChaptersBatchSegmentOut(BaseModel):
    id: str

class ChaptersBatchChapterOut(BaseModel):
    id: str
    segments: list[ChaptersBatchSegmentOut]

class ChaptersBatchResponse(BaseModel):
    chapters: list[ChaptersBatchChapterOut]
```

- [ ] **Step 6: Add endpoint**

In `backend/app/api/segmented_projects.py`, add (importing the schemas + `svc`):
```python
@router.post(
    "/segmented-projects/{project_id}/chapters:batch",
    response_model=ChaptersBatchResponse,
)
def batch_create_chapters(project_id: str, body: ChaptersBatchRequest, db: Session = Depends(get_db)):
    try:
        result = svc.batch_create_structure(db, project_id, [c.model_dump() for c in body.chapters])
    except LookupError:
        raise HTTPException(status_code=404, detail="project_not_found")
    return ChaptersBatchResponse(chapters=[
        ChaptersBatchChapterOut(id=c["id"], segments=[ChaptersBatchSegmentOut(id=s["id"]) for s in c["segments"]])
        for c in result
    ])
```

- [ ] **Step 7: Run test — pass**

Run: `cd backend && uv run --extra test pytest tests/integration/test_chapters_batch.py -v`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/segmented_project_service.py backend/app/api/segmented_projects.py backend/app/schemas/ backend/tests/integration/test_chapters_batch.py
git commit -m "feat(backend): chapters:batch endpoint for workflow split_segment"
```

---

### Task A10: split_segment node

**Files:**
- Create: `agent/app/nodes/split_segment.py`
- Test: `agent/tests/test_split_segment.py`

**Interfaces:**
- Produces: `split_segment_node(state, runtime) -> dict`.
- Consumes: `BackendClient.batch_create_structure`, `runtime.store.asearch`, `get_instructor_client`, `SPLIT_SEGMENT_SYSTEM_PROMPT`.

- [ ] **Step 1: Write failing test**

`agent/tests/test_split_segment.py`:
```python
import pytest
from app.nodes.split_segment import split_segment_node
from app.schemas import SegmentChapters, ChapterStructure, Segment


class FakeStore:
    async def asearch(self, namespace, *, query=None, limit=10):
        return []
class FakeRuntime:
    def __init__(self, store, backend):
        self.store = store
        self.backend = backend
class FakeBackend:
    def __init__(self, ids):
        self._ids = ids
    async def batch_create_structure(self, pid, structure):
        return self._ids


@pytest.mark.asyncio
async def test_split_segment_persists_and_returns_structure(monkeypatch):
    structure = SegmentChapters(chapters=[ChapterStructure(chapter_title="c", segments=[Segment(text="t")])])
    client = type("C", (), {})()
    async def fake_create(**kw):
        return structure
    client.create = fake_create
    monkeypatch.setattr("app.nodes.split_segment.get_instructor_client", lambda: (client, "m"))
    monkeypatch.setattr("app.nodes.split_segment.get_stream_writer", lambda: (lambda p: None))

    backend = FakeBackend([type("Id", (), {"id": "ch1", "segments": [type("S", (), {"id": "s1"})()]})()])
    state = {"project_id": "p1", "run_id": "r1", "narration_script": "s", "current_stage": "split_segment"}
    result = await split_segment_node(state, FakeRuntime(FakeStore(), backend))

    assert result["current_stage"] == "synthesis"
    assert result["structured_segments"][0]["_chapter_id"] == "ch1"
    assert result["structured_segments"][0]["segments"][0]["_segment_id"] == "s1"
    assert result["error"] is None
```

- [ ] **Step 2: Run test — fails**

Run: `cd agent && uv run --extra test pytest tests/test_split_segment.py -v`

- [ ] **Step 3: Implement split_segment node**

`agent/app/nodes/split_segment.py`:
```python
"""SplitSegment node: split script into chapters+segments, persist to backend."""
from __future__ import annotations
from langgraph.config import get_stream_writer
from app.llm import get_instructor_client
from app.backend_client import BackendClient
from app.prompts.narration import get_prompt
from app.schemas import SegmentChapters


async def split_segment_node(state, runtime) -> dict:
    project_id = state["project_id"]
    writer = get_stream_writer()
    async def emit(p): writer(p)

    await emit({"type": "stage_start", "stage": "split_segment", "message": "开始段落拆分..."})

    pref_context = ""
    if runtime.store is not None:
        try:
            prefs = await runtime.store.asearch(("director_preference", "global"), query="段落长度 拆分 风格", limit=3)
            lines = [f"- {it.value.get('preference', '')}" for it in prefs if it.value.get("preference")]
            if lines:
                pref_context = "\n\n## 导演偏好参考\n" + "\n".join(lines)
        except Exception:
            pass

    script = state.get("edited_script") or state["narration_script"]
    await emit({"type": "llm_call", "stage": "split_segment", "message": f"正在调用 LLM 拆分段落 (脚本长度: {len(script)} 字)..."})

    client, model = get_instructor_client()
    structure: SegmentChapters = await client.create(
        response_model=SegmentChapters, model=model, max_retries=2,
        messages=[
            {"role": "system", "content": get_prompt("split_segment")},
            {"role": "user", "content": f"请将以下旁白脚本拆分为结构化段落：\n\n{script}{pref_context}"},
        ],
    )

    # persist to backend
    backend = getattr(runtime, "backend", None) or BackendClient()
    try:
        ids = await backend.batch_create_structure(project_id, structure)
    except Exception as exc:
        await emit({"type": "error", "stage": "split_segment", "message": f"持久化失败: {exc}"})
        return {"structured_segments": [], "current_stage": "synthesis", "error": f"持久化失败: {exc}"}

    # attach ids onto the structure dicts for synthesis_node to reuse
    structured = []
    for ch, ch_ids in zip(structure.chapters, ids):
        ch_dict = ch.model_dump()
        ch_dict["_chapter_id"] = ch_ids.id
        for seg, seg_id in zip(ch_dict["segments"], ch_ids.segments):
            seg["_segment_id"] = seg_id.id
        structured.append(ch_dict)

    total = sum(len(ch["segments"]) for ch in structured)
    await emit({"type": "llm_response", "stage": "split_segment",
                "message": f"段落拆分完成: {len(structured)} 章节, {total} 段落",
                "data": {"chapters_count": len(structured), "segments_count": total}})
    await emit({"type": "stage_complete", "stage": "split_segment", "message": "段落拆分阶段完成"})

    return {"structured_segments": structured, "current_stage": "synthesis", "error": None}
```

- [ ] **Step 4: Run test — pass**

Run: `cd agent && uv run --extra test pytest tests/test_split_segment.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/app/nodes/split_segment.py agent/tests/test_split_segment.py
git commit -m "feat(agent): split_segment node with backend persistence"
```

---

### Task A11: synthesis node

**Files:**
- Create: `agent/app/nodes/synthesis.py`
- Test: `agent/tests/test_synthesis.py`

- [ ] **Step 1: Write failing test**

`agent/tests/test_synthesis.py`:
```python
import pytest
from app.nodes.synthesis import synthesis_node


class FakeBackend:
    def __init__(self):
        self.calls = []
    async def synthesize_segment(self, pid, cid, sid):
        self.calls.append((cid, sid))


@pytest.mark.asyncio
async def test_synthesis_loops_segments_and_emits_progress(monkeypatch):
    emitted = []
    monkeypatch.setattr("app.nodes.synthesis.get_stream_writer", lambda: (lambda p: emitted.append(p)))
    backend = FakeBackend()
    runtime = type("R", (), {"backend": backend, "store": None})()

    state = {
        "project_id": "p1", "run_id": "r1",
        "structured_segments": [
            {"_chapter_id": "ch1", "segments": [{"_segment_id": "s1"}, {"_segment_id": "s2"}]},
            {"_chapter_id": "ch2", "segments": [{"_segment_id": "s3"}]},
        ],
        "current_stage": "synthesis",
    }
    result = await synthesis_node(state, runtime)

    assert len(backend.calls) == 3
    assert result["current_stage"] == "completed"
    assert len(result["synthesis_results"]) == 3
    progress = [e for e in emitted if e.get("type") == "progress"]
    assert progress[-1]["data"]["completed"] == 3 and progress[-1]["data"]["total"] == 3


@pytest.mark.asyncio
async def test_synthesis_empty_segments_skips(monkeypatch):
    monkeypatch.setattr("app.nodes.synthesis.get_stream_writer", lambda: (lambda p: None))
    runtime = type("R", (), {"backend": FakeBackend(), "store": None})()
    result = await synthesis_node({"project_id": "p1", "structured_segments": [], "current_stage": "synthesis"}, runtime)
    assert result["synthesis_results"] == []
    assert result["current_stage"] == "completed"
```

- [ ] **Step 2: Run test — fails**

Run: `cd agent && uv run --extra test pytest tests/test_synthesis.py -v`

- [ ] **Step 3: Implement synthesis node**

`agent/app/nodes/synthesis.py`:
```python
"""Synthesis node: call backend TTS for each segment, emit progress."""
from __future__ import annotations
from langgraph.config import get_stream_writer
from app.backend_client import BackendClient


async def synthesis_node(state, runtime) -> dict:
    project_id = state["project_id"]
    structured = state.get("structured_segments", [])
    writer = get_stream_writer()
    async def emit(p): writer(p)

    if not structured:
        await emit({"type": "stage_complete", "stage": "synthesis", "message": "无段落数据，跳过语音合成"})
        return {"synthesis_results": [], "current_stage": "completed", "error": None}

    total = sum(len(ch.get("segments", [])) for ch in structured)
    await emit({"type": "stage_start", "stage": "synthesis", "message": f"开始语音合成: {len(structured)} 章节, {total} 段落..."})

    backend = getattr(runtime, "backend", None) or BackendClient()
    results = []
    done = 0
    for ch in structured:
        cid = ch.get("_chapter_id")
        if not cid:
            continue
        for seg in ch.get("segments", []):
            sid = seg.get("_segment_id")
            if not sid:
                continue
            try:
                await backend.synthesize_segment(project_id, cid, sid)
                results.append({"chapter_id": cid, "segment_id": sid, "audio_path": None, "duration_sec": None})
            except Exception as exc:
                await emit({"type": "error", "stage": "synthesis", "message": f"段落 {sid} 合成失败: {exc}"})
            done += 1
            if done % 1 == 0 or done == total:
                await emit({"type": "progress", "stage": "synthesis",
                            "message": f"语音合成进度: {done}/{total}",
                            "data": {"completed": done, "total": total}})

    await emit({"type": "stage_complete", "stage": "synthesis",
                "message": f"语音合成完成: {len(results)} 段落",
                "data": {"total_segments": len(results)}})
    return {"synthesis_results": results, "current_stage": "completed", "error": None}
```

- [ ] **Step 4: Run test — pass**

Run: `cd agent && uv run --extra test pytest tests/test_synthesis.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add agent/app/nodes/synthesis.py agent/tests/test_synthesis.py
git commit -m "feat(agent): synthesis node with per-segment progress"
```

---

### Task A12: Graph definition + langgraph.json

**Files:**
- Create: `agent/app/graph.py`, `agent/langgraph.json`
- Test: `agent/tests/test_graph.py`

- [ ] **Step 1: Write failing test (graph integration)**

`agent/tests/test_graph.py`:
```python
"""End-to-end graph test with mocked LLM + backend."""
import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.memory import InMemoryStore
from langgraph.types import Command


@pytest.mark.asyncio
async def test_graph_runs_to_interrupt_then_approve_completes(monkeypatch):
    from app.schemas import SegmentChapters, ChapterStructure, Segment, ReviewResult, ReviewDimension
    from app import graph as graph_mod

    # mock instructor returns
    review = ReviewResult(dimensions=[ReviewDimension(name="x", status="pass", comment="ok")], overall_score=4, overall_comment="c", has_critical_issue=False)
    structure = SegmentChapters(chapters=[ChapterStructure(chapter_title="c", segments=[Segment(text="t")])])

    class FakeClient:
        async def create(self, *, response_model, **kw):
            if response_model.__name__ == "ReviewResult":
                return review
            if response_model.__name__ == "SegmentChapters":
                return structure
            return None
    monkeypatch.setattr("app.nodes.script_review.get_instructor_client", lambda: (FakeClient(), "m"))
    monkeypatch.setattr("app.nodes.split_segment.get_instructor_client", lambda: (FakeClient(), "m"))
    monkeypatch.setattr("app.nodes.gen_script.stream_llm", lambda messages, on_chunk=None, **kw: _async_return("# C\nhello"))
    monkeypatch.setattr("app.nodes.gen_script.get_stream_writer", lambda: (lambda p: None))
    monkeypatch.setattr("app.nodes.script_review.get_stream_writer", lambda: (lambda p: None))
    monkeypatch.setattr("app.nodes.split_segment.get_stream_writer", lambda: (lambda p: None))
    monkeypatch.setattr("app.nodes.synthesis.get_stream_writer", lambda: (lambda p: None))

    # mock backend
    class FakeBackend:
        async def batch_create_structure(self, pid, struct):
            from app.schemas import ChapterWithSegmentIds, SegmentWithId
            return [ChapterWithSegmentIds(id="ch1", segments=[SegmentWithId(id="s1")])]
        async def synthesize_segment(self, pid, cid, sid):
            return None
    class FakeRuntime:
        backend = FakeBackend()
        store = None

    g = graph_mod.build_graph(InMemorySaver(), InMemoryStore(), runtime_factory=lambda: FakeRuntime())

    config = {"configurable": {"thread_id": "t1"}}
    result = await g.ainvoke({"project_id": "p1", "source_document": "src", "current_stage": "gen_script"}, config)
    # interrupted at script_review
    assert "__interrupt__" in result

    # resume with approve
    result2 = await g.ainvoke(Command(resume={"action": "approve", "edited_script": "e", "comment": "good"}), config)
    assert result2["current_stage"] == "completed"
    assert len(result2["synthesis_results"]) == 1


async def _async_return(v):
    return v
```

- [ ] **Step 2: Run test — fails**

Run: `cd agent && uv run --extra test pytest tests/test_graph.py -v`

- [ ] **Step 3: Implement graph.py + langgraph.json**

`agent/app/graph.py`:
```python
"""Narration workflow StateGraph definition + compile."""
from __future__ import annotations
from typing import Any
from langgraph.graph import END, START, StateGraph
from app.state import NarrationWorkflowState
from app.nodes.gen_script import gen_script_node
from app.nodes.script_review import script_review_node
from app.nodes.split_segment import split_segment_node
from app.nodes.synthesis import synthesis_node

STAGE_ORDER = ["gen_script", "script_review", "split_segment", "synthesis"]


def route_after_review(state: NarrationWorkflowState) -> str:
    if state.get("review_status") == "approved":
        return "split_segment"
    return "gen_script"


def build_graph(checkpointer: Any, store: Any, *, runtime_factory=None) -> Any:
    """Compile the narration graph. runtime_factory injects a runtime with .backend/.store
    for tests; in production the LangGraph server provides runtime.store and we attach
    a BackendClient via a node-runtime wrapper."""
    builder = (
        StateGraph(NarrationWorkflowState)
        .add_node("gen_script", gen_script_node)
        .add_node("script_review", script_review_node)
        .add_node("split_segment", split_segment_node)
        .add_node("synthesis", synthesis_node)
        .add_edge(START, "gen_script")
        .add_edge("gen_script", "script_review")
        .add_conditional_edges("script_review", route_after_review)
        .add_edge("split_segment", "synthesis")
        .add_edge("synthesis", END)
    )
    return builder.compile(checkpointer=checkpointer, store=store)


# Module-level exported graph for langgraph.json. The server injects its own
# checkpointer + store, so we compile without them here; nodes access the store
# via runtime.store (injected by the server at runtime).
graph = build_graph(checkpointer=None, store=None)
```

`agent/langgraph.json`:
```json
{
  "dependencies": ["."],
  "graphs": { "narration": "./app/graph.py:graph" },
  "env": ".env"
}
```

Note: nodes use `runtime.store` (injected by the server) and instantiate `BackendClient()` per-call (reading `BACKEND_API_URL` from env). The `runtime_factory` parameter is only for tests; in production the server's runtime provides `store`. If `runtime.backend` is None, nodes fall back to `BackendClient()` (the production path).

- [ ] **Step 4: Run test — pass**

Run: `cd agent && uv run --extra test pytest tests/test_graph.py -v`
Expected: PASS.

- [ ] **Step 5: Verify langgraph dev boots**

Run (manual, in a separate terminal): `cd agent && cp .env.example .env && echo "AGENT_LLM_API_KEY=dummy" >> .env && uv run langgraph dev --port 2024 --no-browser`
Expected: server starts, `http://127.0.0.1:2024/docs` reachable, `/assistants/narration/graph` returns node list. Stop it after verifying.

- [ ] **Step 6: Commit**

```bash
git add agent/app/graph.py agent/langgraph.json agent/tests/test_graph.py
git commit -m "feat(agent): narration graph definition + langgraph.json"
```

---

### Task A13: Studio manual verification

- [ ] **Step 1: Start backend + agent**

```bash
# terminal 1
cd backend && uv run uvicorn main:app --host 127.0.0.1 --port 8002 --reload
# terminal 2
cd agent && uv run langgraph dev --port 2024 --no-browser
```

- [ ] **Step 2: Verify in Studio**

Open `https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024`.
- Start a run with input `{project_id: "<a real project id from voice_clone.db>"}`.
- Watch gen_script -> script_review (interrupt) -> resume (approve) -> split_segment -> synthesis.
- Confirm custom milestone events appear in the stream pane.
- Confirm the graph topology renders (4 nodes + reject loop).
- Reject once and re-run: confirm gen_script reads prior reject feedback from the store.

- [ ] **Step 3: Record outcome**

No commit. Note any issues found; fix in a follow-up commit before Phase B. If the agent runs end-to-end via Studio, Phase A is complete.

---

## Phase B — Frontend rebuild

### Task B1: Dependencies + Vite proxy

**Files:**
- Modify: `frontend/package.json`, `frontend/vite.config.ts`

- [ ] **Step 1: Add SDK dep**

Run: `cd frontend && npm install @langchain/langgraph-sdk`

- [ ] **Step 2: Add /agent proxy to vite.config.ts**

In `frontend/vite.config.ts`, find the existing `server.proxy` block (which has `/api`), add an `/agent` entry alongside it:
```typescript
proxy: {
  '/api': {
    target: 'http://127.0.0.1:8002',
    changeOrigin: true,
  },
  '/agent': {
    target: 'http://127.0.0.1:2024',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/agent/, ''),
  },
},
```

- [ ] **Step 3: Verify proxy**

Run: `cd frontend && npm run dev &` then `curl http://127.0.0.1:5173/agent/docs` (with agent running on :2024). Expected: the LangGraph API docs HTML. Kill the dev server.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts
git commit -m "feat(frontend): add langgraph-sdk + /agent vite proxy"
```

---

### Task B2: langgraph service layer (client, contracts, types)

**Files:**
- Create: `frontend/src/services/langgraph/client.ts`, `contracts.ts`, `types.ts`

- [ ] **Step 1: Implement client.ts**

`frontend/src/services/langgraph/client.ts`:
```typescript
import { Client } from '@langchain/langgraph-sdk';

export const agentClient = new Client({ apiUrl: '/agent' });
```

- [ ] **Step 2: Implement contracts.ts**

`frontend/src/services/langgraph/contracts.ts`:
```typescript
// Node name -> state keys populated when the node completes.
export const NODE_STATE_KEYS: Record<string, string[]> = {
  gen_script: ['narration_script'],
  script_review: ['review_feedback'],
  split_segment: ['structured_segments'],
  synthesis: ['synthesis_results'],
};

export const INPUT_FIELDS: Record<string, Record<string, string>> = {
  narration: { project_id: 'Project' },
};
```

- [ ] **Step 3: Implement types.ts**

`frontend/src/services/langgraph/types.ts` (TS mirror of `agent/app/schemas.py` + state):
```typescript
export type ReviewStatus = Literal<'pass' | 'warn' | 'fail'>;
export interface ReviewDimension { name: string; status: ReviewStatus; comment: string; suggestion: string | null; }
export interface ReviewResult { dimensions: ReviewDimension[]; overall_score: number; overall_comment: string; has_critical_issue: boolean; }
export interface Segment { text: string; emotion: string; role: string; segment_kind: string; _segment_id?: string; }
export interface ChapterStructure { chapter_title: string; segments: Segment[]; _chapter_id?: string; }
export interface SynthResult { chapter_id: string; segment_id: string; audio_path: string | null; duration_sec: number | null; }

export interface NarraWorkflowState {
  project_id?: string;
  source_document?: string;
  narration_script?: string;
  script_chapters?: ChapterStructure[];
  review_feedback?: ReviewResult;
  edited_script?: string;
  review_status?: 'approved' | 'rejected';
  structured_segments?: ChapterStructure[];
  synthesis_results?: SynthResult[];
  current_stage?: string;
  review_retry_count?: number;
  error?: string | null;
}

export type MilestoneEvent = {
  type: 'stage_start' | 'llm_call' | 'llm_streaming' | 'llm_response' | 'auto_reject' | 'interrupt' | 'progress' | 'stage_complete' | 'error';
  stage: string;
  message: string;
  data: Record<string, unknown>;
};

export type Literal<T extends string> = T;
```

- [ ] **Step 4: Verify typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors (or only pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/langgraph/
git commit -m "feat(frontend): langgraph service layer (client/contracts/types)"
```

---

### Task B3: PipelineTimeline component

**Files:**
- Create: `frontend/src/components/Workflow/PipelineTimeline.tsx`, `PipelineTimeline.module.css`
- Test: `frontend/src/components/Workflow/PipelineTimeline.test.tsx`

- [ ] **Step 1: Write failing test**

`frontend/src/components/Workflow/PipelineTimeline.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PipelineTimeline } from './PipelineTimeline';

const nodes = [
  { id: 'gen_script', name: 'gen_script' },
  { id: 'script_review', name: 'script_review' },
  { id: 'split_segment', name: 'split_segment' },
  { id: 'synthesis', name: 'synthesis' },
];

describe('PipelineTimeline', () => {
  it('marks gen_script completed and script_review running', () => {
    const values = { narration_script: 'x' }; // gen_script state key present
    render(<PipelineTimeline nodes={nodes} values={values} currentStage="script_review" />);
    expect(screen.getByText('gen_script').closest('[data-status]')?.getAttribute('data-status')).toBe('completed');
    expect(screen.getByText('script_review').closest('[data-status]')?.getAttribute('data-status')).toBe('running');
    expect(screen.getByText('synthesis').closest('[data-status]')?.getAttribute('data-status')).toBe('pending');
  });
});
```

- [ ] **Step 2: Run test — fails**

Run: `cd frontend && npx vitest run src/components/Workflow/PipelineTimeline.test.tsx`

- [ ] **Step 3: Implement PipelineTimeline**

`frontend/src/components/Workflow/PipelineTimeline.tsx`:
```tsx
import { NODE_STATE_KEYS } from '../../services/langgraph/contracts';
import type { NarraWorkflowState } from '../../services/langgraph/types';
import styles from './PipelineTimeline.module.css';

const STAGE_ICON: Record<string, string> = {
  gen_script: 'edit_note', script_review: 'rate_review',
  split_segment: 'content_cut', synthesis: 'mic',
};

interface Props {
  nodes: { id: string; name: string }[];
  values: Partial<NarraWorkflowState>;
  currentStage?: string;
}

function statusFor(nodeId: string, values: Partial<NarraWorkflowState>, currentStage?: string): 'completed' | 'running' | 'pending' {
  const keys = NODE_STATE_KEYS[nodeId] ?? [];
  const completed = keys.every(k => values[k as keyof NarraWorkflowState] != null);
  if (completed) return 'completed';
  if (nodeId === currentStage) return 'running';
  return 'pending';
}

export function PipelineTimeline({ nodes, values, currentStage }: Props) {
  return (
    <div className={styles.timeline}>
      {nodes.map((n, i) => {
        const status = statusFor(n.id, values, currentStage);
        return (
          <div key={n.id} className={styles.stage} data-status={status}>
            <span className={`material-symbols-outlined ${styles.icon}`}>{STAGE_ICON[n.id] ?? 'circle'}</span>
            <span className={styles.label}>{n.name}</span>
            {i < nodes.length - 1 && <span className={`material-symbols-outlined ${styles.chevron}`}>chevron_right</span>}
          </div>
        );
      })}
    </div>
  );
}
```

`frontend/src/components/Workflow/PipelineTimeline.module.css`: style `.timeline` as horizontal flex, `.stage` with amber border-left for running, green for completed, gray for pending (use `var(--color-primary)`, `var(--color-success)`, `var(--color-text-disabled)`). Match the mockup from the design session.

- [ ] **Step 4: Run test — pass**

Run: `cd frontend && npx vitest run src/components/Workflow/PipelineTimeline.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Workflow/PipelineTimeline.tsx frontend/src/components/Workflow/PipelineTimeline.module.css frontend/src/components/Workflow/PipelineTimeline.test.tsx
git commit -m "feat(frontend): PipelineTimeline graph-driven stage status"
```

---

### Task B4: StageCard component (L1/L2)

**Files:**
- Create: `frontend/src/components/Workflow/StageCard.tsx`, `StageCard.module.css`
- Test: `frontend/src/components/Workflow/StageCard.test.tsx`

- [ ] **Step 1: Write failing test**

`frontend/src/components/Workflow/StageCard.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StageCard } from './StageCard';

describe('StageCard', () => {
  it('starts collapsed (L1) and expands to L2 on click', () => {
    const onFullscreen = vi.fn();
    const { container } = render(
      <StageCard nodeId="gen_script" title="生成脚本" status="completed"
        summary="3 章 · 1200 字 · 45s" onFullscreen={onFullscreen}>
        <div data-testid="detail">detail content</div>
      </StageCard>
    );
    expect(screen.queryByTestId('detail')).toBeNull();
    fireEvent.click(screen.getByText('生成脚本'));
    expect(screen.getByTestId('detail')).toBeInTheDocument();
  });
});
```

(Add `import { vi } from 'vitest'` at top.)

- [ ] **Step 2: Run test — fails**

Run: `cd frontend && npx vitest run src/components/Workflow/StageCard.test.tsx`

- [ ] **Step 3: Implement StageCard**

`frontend/src/components/Workflow/StageCard.tsx`:
```tsx
import { useState } from 'react';
import styles from './StageCard.module.css';

const STATUS_ICON: Record<string, string> = {
  completed: 'check_circle', running: 'progress_activity', pending: 'circle',
};

interface Props {
  nodeId: string;
  title: string;
  status: 'completed' | 'running' | 'pending';
  summary?: string;
  defaultOpen?: boolean;
  onFullscreen?: () => void;
  children?: React.ReactNode;
}

export function StageCard({ nodeId, title, status, summary, defaultOpen = false, onFullscreen, children }: Props) {
  const [open, setOpen] = useState(defaultOpen || status === 'running');
  const iconClass = status === 'running' ? 'material-symbols-outlined spin' : 'material-symbols-outlined fill';
  return (
    <div className={styles.card} data-status={status}>
      <button className={styles.header} onClick={() => setOpen(o => !o)}>
        <span className={`${iconClass} ${styles.statusIcon}`}>{STATUS_ICON[status]}</span>
        <span className={styles.title}>{title}</span>
        {summary && <span className={styles.summary}>{summary}</span>}
        <span className={`material-symbols-outlined ${styles.caret}`}>{open ? 'expand_less' : 'expand_more'}</span>
      </button>
      {open && children && (
        <div className={styles.body}>
          {children}
          {onFullscreen && (
            <button className={styles.fullscreenBtn} onClick={onFullscreen}>
              <span className="material-symbols-outlined">fullscreen</span>全屏查看
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

`StageCard.module.css`: card surface `var(--color-surface)`, border, header button row, body padding, `.spin` animation, `.fullscreenBtn` full-width ghost button. Match the mockup.

- [ ] **Step 4: Run test — pass**

Run: `cd frontend && npx vitest run src/components/Workflow/StageCard.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Workflow/StageCard.tsx frontend/src/components/Workflow/StageCard.module.css frontend/src/components/Workflow/StageCard.test.tsx
git commit -m "feat(frontend): StageCard L1/L2 accordion with fullscreen entry"
```

---

### Task B5: ReviewPanel component (HITL)

**Files:**
- Create: `frontend/src/components/Workflow/ReviewPanel.tsx`, `ReviewPanel.module.css`
- Test: `frontend/src/components/Workflow/ReviewPanel.test.tsx`

- [ ] **Step 1: Write failing test**

`frontend/src/components/Workflow/ReviewPanel.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ReviewPanel } from './ReviewPanel';

const interrupt = {
  script: 'original script',
  review: { dimensions: [{ name: '内容忠实度', status: 'pass', comment: 'ok', suggestion: null }], overall_score: 4, overall_comment: 'good', has_critical_issue: false },
  available_actions: ['approve', 'reject'],
};

describe('ReviewPanel', () => {
  it('calls respond with approve payload', () => {
    const respond = vi.fn();
    render(<ReviewPanel interrupt={interrupt as any} onRespond={respond} />);
    fireEvent.click(screen.getByText('批准'));
    expect(respond).toHaveBeenCalledWith({ action: 'approve', edited_script: 'original script', comment: '' });
  });

  it('requires feedback to reject', () => {
    const respond = vi.fn();
    render(<ReviewPanel interrupt={interrupt as any} onRespond={respond} />);
    fireEvent.click(screen.getByText('拒绝'));
    // reject reveals a feedback input; submit calls respond with action reject
    fireEvent.change(screen.getByPlaceholderText(/描述需要改进/), { target: { value: 'fix intro' } });
    fireEvent.click(screen.getByText('确认拒绝'));
    expect(respond).toHaveBeenCalledWith({ action: 'reject', feedback: 'fix intro' });
  });
});
```

- [ ] **Step 2: Run test — fails**

Run: `cd frontend && npx vitest run src/components/Workflow/ReviewPanel.test.tsx`

- [ ] **Step 3: Implement ReviewPanel**

`frontend/src/components/Workflow/ReviewPanel.tsx` — adapt the existing `ReviewEditor.tsx` UI (dimension cards, star score, script textarea, director note, reject feedback) but rewire to `onRespond`:
```tsx
import { useState } from 'react';
import type { ReviewResult } from '../../services/langgraph/types';
import styles from './ReviewPanel.module.css';

interface InterruptPayload {
  script: string;
  review: ReviewResult;
  available_actions: string[];
}
interface Props {
  interrupt: InterruptPayload;
  onRespond: (payload: { action: 'approve' | 'reject'; [k: string]: unknown }) => void;
}

const STATUS_ICON: Record<string, string> = { pass: 'check_circle', warn: 'warning', fail: 'cancel' };
const STATUS_COLOR: Record<string, string> = { pass: 'var(--color-success)', warn: 'var(--color-warning)', fail: 'var(--color-error)' };

export function ReviewPanel({ interrupt, onRespond }: Props) {
  const { script, review } = interrupt;
  const [editedScript, setEditedScript] = useState(script);
  const [comment, setComment] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [feedback, setFeedback] = useState('');

  const approve = () => onRespond({ action: 'approve', edited_script: editedScript, comment });
  const doReject = () => { if (feedback.trim()) onRespond({ action: 'reject', feedback }); };

  return (
    <div className={styles.root}>
      <div className={styles.scoreRow}>
        <span className={styles.stars}>
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className={`material-symbols-outlined ${styles.star}`} style={{ color: i < review.overall_score ? 'var(--color-primary)' : 'var(--color-text-disabled)', fontVariationSettings: i < review.overall_score ? "'FILL' 1" : "'FILL' 0" }}>star</span>
          ))}
        </span>
        <strong>{review.overall_score}/5</strong>
        <span className={styles.comment}>{review.overall_comment}</span>
      </div>
      {review.has_critical_issue && (
        <div className={styles.critical}><span className="material-symbols-outlined">error</span>内容忠实度存在严重问题，务必修正后再通过</div>
      )}
      <div className={styles.dimensions}>
        {review.dimensions.map((d, i) => (
          <div key={i} className={styles.dimension} style={{ borderLeftColor: STATUS_COLOR[d.status] }}>
            <span className={`material-symbols-outlined fill ${styles.dimIcon}`} style={{ color: STATUS_COLOR[d.status] }}>{STATUS_ICON[d.status]}</span>
            <div>
              <div className={styles.dimName}>{d.name}</div>
              <div className={styles.dimComment}>{d.comment}</div>
              {d.suggestion && <div className={styles.dimSuggestion}><span className="material-symbols-outlined">arrow_forward</span>{d.suggestion}</div>}
            </div>
          </div>
        ))}
      </div>
      <div className={styles.section}>
        <div className={styles.sectionLabel}>旁白脚本（可编辑）<span className={styles.stats}>{editedScript.length} 字</span></div>
        <textarea className={styles.scriptEditor} value={editedScript} onChange={e => setEditedScript(e.target.value)} />
      </div>
      <div className={styles.section}>
        <div className={styles.sectionLabel}>导演备注（可选）</div>
        <textarea className={styles.noteEditor} value={comment} onChange={e => setComment(e.target.value)} placeholder="导演备注..." />
      </div>
      {rejecting && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>拒绝反馈（必填）</div>
          <textarea className={styles.noteEditor} value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="描述需要改进的地方..." />
        </div>
      )}
      <div className={styles.actions}>
        {rejecting ? (
          <>
            <button className={styles.rejectBtn} onClick={doReject} disabled={!feedback.trim()}><span className="material-symbols-outlined">close</span>确认拒绝</button>
            <button className={styles.ghostBtn} onClick={() => setRejecting(false)}>取消</button>
          </>
        ) : (
          <>
            <button className={styles.rejectBtn} onClick={() => setRejecting(true)}><span className="material-symbols-outlined">close</span>拒绝并反馈</button>
            <button className={styles.primaryBtn} onClick={approve}><span className="material-symbols-outlined">check</span>批准</button>
          </>
        )}
      </div>
    </div>
  );
}
```

`ReviewPanel.module.css`: adapt from existing `ReviewEditor.module.css` (reuse the polished styles; rename class refs to match). Warm-amber tokens.

- [ ] **Step 4: Run test — pass**

Run: `cd frontend && npx vitest run src/components/Workflow/ReviewPanel.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Workflow/ReviewPanel.tsx frontend/src/components/Workflow/ReviewPanel.module.css frontend/src/components/Workflow/ReviewPanel.test.tsx
git commit -m "feat(frontend): ReviewPanel HITL with stream.respond"
```

---

### Task B6: StageDetailModal (L3 fullscreen)

**Files:**
- Create: `frontend/src/components/Workflow/StageDetailModal.tsx`, `StageDetailModal.module.css`

- [ ] **Step 1: Implement StageDetailModal**

`frontend/src/components/Workflow/StageDetailModal.tsx`:
```tsx
import type { ReactNode } from 'react';
import styles from './StageDetailModal.module.css';

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function StageDetailModal({ title, subtitle, onClose, children, footer }: Props) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <strong>{title}</strong>
            {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
          </div>
          <button className={styles.closeBtn} onClick={onClose}><span className="material-symbols-outlined">close</span></button>
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  );
}
```

`StageDetailModal.module.css`: `.overlay` fixed full-screen `rgba(26,24,20,.35)` flex-center; `.modal` `var(--color-surface)` rounded 12px, max-width 720px, max-height 85vh, shadow-xl; `.body` scroll-auto. Match the mockup.

- [ ] **Step 2: Verify typecheck**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Workflow/StageDetailModal.tsx frontend/src/components/Workflow/StageDetailModal.module.css
git commit -m "feat(frontend): StageDetailModal L3 fullscreen container"
```

---

### Task B7: WorkflowDrawer + DrawerIndicator (useStream wiring)

**Files:**
- Create: `frontend/src/components/Workflow/WorkflowDrawer.tsx`, `WorkflowDrawer.module.css`, `DrawerIndicator.tsx`, `DrawerIndicator.module.css`
- Test: `frontend/src/components/Workflow/WorkflowDrawer.test.tsx`

- [ ] **Step 1: Write failing test**

`frontend/src/components/Workflow/WorkflowDrawer.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { WorkflowDrawer } from './WorkflowDrawer';

vi.mock('@langchain/langgraph-sdk/react', () => ({
  useStream: () => ({
    values: { current_stage: 'gen_script', narration_script: undefined },
    messages: [], interrupts: [], isLoading: true, submit: vi.fn(), respond: vi.fn(), stop: vi.fn(),
  }),
}));

describe('WorkflowDrawer', () => {
  it('renders the timeline and the active stage card', () => {
    render(<WorkflowDrawer threadId="t1" projectId="p1" onClose={vi.fn()} />);
    expect(screen.getByText('旁白工作流')).toBeInTheDocument();
    expect(screen.getByText('gen_script')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — fails**

Run: `cd frontend && npx vitest run src/components/Workflow/WorkflowDrawer.test.tsx`

- [ ] **Step 3: Implement WorkflowDrawer**

`frontend/src/components/Workflow/WorkflowDrawer.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useStream } from '@langchain/langgraph-sdk/react';
import { agentClient } from '../../services/langgraph/client';
import type { NarraWorkflowState, MilestoneEvent } from '../../services/langgraph/types';
import { PipelineTimeline } from './PipelineTimeline';
import { StageCard } from './StageCard';
import { ReviewPanel } from './ReviewPanel';
import { StageDetailModal } from './StageDetailModal';
import styles from './WorkflowDrawer.module.css';

interface Props {
  threadId: string;
  projectId: string;
  onClose: () => void;
  onCollapse: () => void;
}

interface GraphNode { id: string; name: string; }

export function WorkflowDrawer({ threadId, projectId, onClose, onCollapse }: Props) {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [milestones, setMilestones] = useState<Record<string, MilestoneEvent[]>>({});
  const [fullscreen, setFullscreen] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const stream = useStream<NarraWorkflowState>({
    apiUrl: '/agent',
    assistantId: 'narration',
    threadId,
    streamMode: ['values', 'messages', 'custom', 'updates'],
    onCustomEvent: (event: MilestoneEvent, { meta }) => {
      const stage = (meta?.langgraph_node as string) || event.stage;
      setMilestones(prev => ({ ...prev, [stage]: [...(prev[stage] ?? []), event] }));
    },
  });

  // fetch graph topology once
  useEffect(() => {
    agentClient.assistants.getGraph('narration').then((g: any) => {
      setNodes((g.nodes ?? []).map((n: any) => ({ id: n.id, name: n.id })));
    }).catch(() => setNodes([
      { id: 'gen_script', name: 'gen_script' }, { id: 'script_review', name: 'script_review' },
      { id: 'split_segment', name: 'split_segment' }, { id: 'synthesis', name: 'synthesis' },
    ]));
  }, []);

  // start the run once if thread idle
  useEffect(() => {
    if (!started && !stream.isLoading && stream.values && Object.keys(stream.values).length === 0) {
      stream.submit({ input: { project_id: projectId } });
      setStarted(true);
    }
  }, [started, stream.isLoading, stream.values, projectId]);

  const values = stream.values ?? {};
  const currentStage = values.current_stage;
  const interrupt = stream.interrupts?.[0]?.value as { script: string; review: any; available_actions: string[] } | undefined;

  return (
    <div className={styles.drawer}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={`material-symbols-outlined ${styles.icon}`}>account_tree</span>
          <strong>旁白工作流</strong>
          {stream.isLoading ? <span className={styles.badgeRun}>运行中</span> : <span className={styles.badgeIdle}>完成</span>}
        </div>
        <div className={styles.headerActions}>
          <button onClick={onCollapse} className={styles.iconBtn}><span className="material-symbols-outlined">unfold_less</span></button>
          <button onClick={onClose} className={styles.iconBtn}><span className="material-symbols-outlined">close</span></button>
        </div>
      </div>
      <div className={styles.body}>
        <PipelineTimeline nodes={nodes} values={values} currentStage={currentStage} />
        {interrupt && <ReviewPanel interrupt={interrupt} onRespond={(p) => stream.respond(p as any)} />}
        {nodes.map(n => {
          const keys = (await import('../../services/langgraph/contracts')).NODE_STATE_KEYS[n.id] ?? [];
          const completed = keys.every(k => (values as any)[k] != null);
          const status = completed ? 'completed' : n.id === currentStage ? 'running' : 'pending';
          if (interrupt && n.id === 'script_review') return null; // shown as ReviewPanel
          return (
            <StageCard key={n.id} nodeId={n.id} title={n.id} status={status}
              summary={summaryFor(n.id, values, milestones[n.id])}
              defaultOpen={status === 'running'}
              onFullscreen={() => setFullscreen(n.id)}>
              <StageDetail nodeId={n.id} values={values} milestones={milestones[n.id] ?? []} stream={stream} />
            </StageCard>
          );
        })}
      </div>
      {fullscreen && (
        <StageDetailModal title={`${fullscreen} · 完整内容`} onClose={() => setFullscreen(null)}>
          <StageDetail nodeId={fullscreen} values={values} milestones={milestones[fullscreen] ?? []} stream={stream} fullscreen />
        </StageDetailModal>
      )}
    </div>
  );
}
```

Note: the `await import` inside `.map` is incorrect for sync render — hoist `NODE_STATE_KEYS` import to the top instead:
```tsx
import { NODE_STATE_KEYS } from '../../services/langgraph/contracts';
```
and use `const keys = NODE_STATE_KEYS[n.id] ?? [];` directly. Fix this before committing.

`StageDetail` and `summaryFor` are small helpers (co-located in the same file or a `stageDetail.tsx`): `summaryFor` returns strings like "3 章 · 1200 字" from `values`; `StageDetail` renders the node-specific content (gen_script: script preview/full text; split_segment: chapter×segment tree; synthesis: progress bar). Keep them in `WorkflowDrawer.tsx` for now; split if it exceeds 400 lines.

`WorkflowDrawer.module.css`: `.drawer` fixed right, width 56%, `var(--color-surface)` bg, left border + shadow; `.header` sticky top; `.body` scroll-auto padding. Match the mockup.

- [ ] **Step 4: Fix the import issue + run test — pass**

Hoist the `NODE_STATE_KEYS` import; remove the dynamic `await import`. Run:
`cd frontend && npx vitest run src/components/Workflow/WorkflowDrawer.test.tsx`

- [ ] **Step 5: Implement DrawerIndicator**

`frontend/src/components/Workflow/DrawerIndicator.tsx`:
```tsx
import styles from './DrawerIndicator.module.css';

interface Props {
  status: 'running' | 'interrupted';
  stage?: string;
  onExpand: () => void;
}

export function DrawerIndicator({ status, stage, onExpand }: Props) {
  const icon = status === 'interrupted' ? 'notifications_active' : 'progress_activity';
  const label = status === 'interrupted' ? '等待审批' : '工作流运行中';
  return (
    <button className={styles.chip} data-status={status} onClick={onExpand}>
      <span className={`material-symbols-outlined ${status === 'running' ? styles.spin : styles.pulse}`}>{icon}</span>
      <strong>{label}</strong>
      {stage && <span>· {stage}</span>}
      <span className="material-symbols-outlined">expand_more</span>
    </button>
  );
}
```

`DrawerIndicator.module.css`: `.chip` pill, `var(--color-surface)` bg, amber border, shadow; `.spin` rotate animation; `.pulse` opacity animation. Position handled by parent.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Workflow/WorkflowDrawer.tsx frontend/src/components/Workflow/WorkflowDrawer.module.css frontend/src/components/Workflow/DrawerIndicator.tsx frontend/src/components/Workflow/DrawerIndicator.module.css frontend/src/components/Workflow/WorkflowDrawer.test.tsx
git commit -m "feat(frontend): WorkflowDrawer + DrawerIndicator with useStream"
```

---

### Task B8: Wire trigger into ProjectLibrary + remove workflow nav

**Files:**
- Modify: `frontend/src/components/ProjectLibrary/ProjectLibrary.tsx`, `frontend/src/components/ProjectShell/ProjectShell.tsx`, `frontend/src/pages/TTSSynthesis.tsx`, `frontend/src/i18n/zh-CN.ts`, `frontend/src/i18n/en-US.ts`
- Delete: `frontend/src/components/Workflow/WorkflowPage.tsx`, `WorkflowHub.tsx`(+css), `LiveProgress.tsx`(+css), `WorkflowRunDetail.tsx`(+css), `ReviewEditor.tsx`(+css), `frontend/src/hooks/useWorkflowStream.ts`

- [ ] **Step 1: Remove workflow nav item**

In `frontend/src/components/ProjectShell/ProjectShell.tsx`:
- Remove `workflow` from `ProjectSectionId` type (line 7): `'overview' | 'library' | 'studio' | 'voices' | 'settings'`.
- Remove `workflow: '🎬'` from `SECTION_ICONS` (line 35).

In `frontend/src/i18n/zh-CN.ts`: remove `workflow: '工作流'` from `projectNav` (line 13).
In `frontend/src/i18n/en-US.ts`: remove the matching `workflow` entry.

- [ ] **Step 2: Remove workflow section from TTSSynthesis**

In `frontend/src/pages/TTSSynthesis.tsx`:
- Remove the `projectSection === 'workflow' ? (<WorkflowPage .../>) :` branch (around line 1683-1686).
- Remove the `WorkflowPage` import.
- Remove `'workflow'` from the `ProjectSectionId` type if duplicated here.

- [ ] **Step 3: Add trigger + drawer to ProjectLibrary**

In `frontend/src/components/ProjectLibrary/ProjectLibrary.tsx`, add state + trigger UI below the source document (in the `activeTab === 'source'` branch, after `SourceDocumentView`):

```tsx
import { useState } from 'react';
import { agentClient } from '../../services/langgraph/client';
import { WorkflowDrawer } from '../Workflow/WorkflowDrawer';
import { DrawerIndicator } from '../Workflow/DrawerIndicator';
// ... inside ProjectLibrary component:
const [drawerThreadId, setDrawerThreadId] = useState<string | null>(null);
const [drawerCollapsed, setDrawerCollapsed] = useState(false);

const startWorkflow = async () => {
  const existing = await agentClient.threads.search({ metadata: { project_id: projectId, kind: 'narration_workflow' }, limit: 50 });
  const active = existing.filter((t: any) => t.status === 'busy' || t.status === 'interrupted');
  if (active.length) { alert('项目已有运行中的工作流'); return; }
  const thread = await agentClient.threads.create({ metadata: { project_id: projectId, project_name: projectName, kind: 'narration_workflow' } });
  setDrawerThreadId(thread.thread_id);
  setDrawerCollapsed(false);
};
```

Add the trigger button below `SourceDocumentView` (in the `activeTab === 'source' ?` branch):
```tsx
<div className={styles.workflowTrigger}>
  <div>
    <strong>从此源文档生成旁白</strong>
    <span>运行 4 阶段工作流：生成脚本 -> 脚本审查 -> 段落拆分 -> 语音合成</span>
  </div>
  <button className={styles.workflowBtn} onClick={startWorkflow}><span className="material-symbols-outlined">auto_awesome</span>生成旁白</button>
</div>
```

Add the drawer + indicator mount at the section root:
```tsx
{drawerThreadId && !drawerCollapsed && (
  <WorkflowDrawer threadId={drawerThreadId} projectId={projectId} onClose={() => setDrawerThreadId(null)} onCollapse={() => setDrawerCollapsed(true)} />
)}
{drawerThreadId && drawerCollapsed && (
  <DrawerIndicator status="running" onExpand={() => setDrawerCollapsed(false)} />
)}
```

(Pass `projectId`/`projectName` through `ProjectLibraryProps` — they are already available as `projectId` is needed; add to props if missing. Check existing props.)

- [ ] **Step 4: Delete old workflow components**

```bash
git rm frontend/src/components/Workflow/WorkflowPage.tsx \
  frontend/src/components/Workflow/WorkflowHub.tsx frontend/src/components/Workflow/WorkflowHub.module.css \
  frontend/src/components/Workflow/LiveProgress.tsx frontend/src/components/Workflow/LiveProgress.module.css \
  frontend/src/components/Workflow/WorkflowRunDetail.tsx frontend/src/components/Workflow/WorkflowRunDetail.module.css \
  frontend/src/components/Workflow/ReviewEditor.tsx frontend/src/components/Workflow/ReviewEditor.module.css \
  frontend/src/hooks/useWorkflowStream.ts
```

- [ ] **Step 5: Verify typecheck + lint**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: no errors (fix any dangling references to deleted files).

- [ ] **Step 6: Commit**

```bash
git add -A frontend/
git commit -m "feat(frontend): trigger workflow from source doc + remove workflow nav"
```

---

### Task B9: i18n + visual polish

**Files:**
- Modify: `frontend/src/i18n/zh-CN.ts`, `en-US.ts`; CSS modules as needed.

- [ ] **Step 1: Add/update workflow i18n keys**

Ensure `workflow.*` keys reflect the new UI: `workflow.trigger.generateNarration`, `workflow.trigger.hint`, `workflow.drawer.title`, `workflow.drawer.running`, `workflow.drawer.completed`, `workflow.indicator.running`, `workflow.indicator.waitingReview`, `workflow.stage.*`, `workflow.review.*` (reuse existing), `workflow.fullscreen.*`. Remove keys for the deleted Hub/RunDetail if any are now orphaned.

- [ ] **Step 2: Visual review**

Run: `cd frontend && npm run dev` (with backend + agent running). Walk through: trigger from 文本库 · 源文档 -> drawer opens -> gen_script streams -> script_review interrupt -> approve -> split_segment -> synthesis -> complete. Check warm-amber tokens, Material Symbols, no layout breakage. Fix CSS issues.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/i18n/ frontend/src/components/Workflow/*.module.css
git commit -m "feat(frontend): workflow i18n + visual polish"
```

---

## Phase C — Cutover (atomic deletion)

### Task C1: Delete backend workflow code

**Files:**
- Delete: `backend/app/api/workflow.py`, `backend/app/services/workflow_service.py`, `workflow_graph.py`, `workflow_nodes.py`, `workflow_progress.py`, `workflow_store.py`, `backend/app/services/prompts/workflow_prompts.py`, `backend/app/models/workflow_run.py`, `backend/app/schemas/workflow.py`
- Modify: `backend/main.py`, `backend/app/models/segmented_project.py`

- [ ] **Step 1: Remove workflow router + engine init from main.py**

In `backend/main.py`: remove the `from app.api import ... workflow` import (line 104), the `app.include_router(workflow.router, ...)` line (119), and the `init_workflow_engine(...)` block (lines 82-90). Remove the `workflow_checkpoints.db`/`workflow_store.db` path setup.

- [ ] **Step 2: Remove workflow_runs relationship from SegmentedProject**

In `backend/app/models/segmented_project.py`: delete the `workflow_runs = relationship("WorkflowRun", ...)` block (lines 51-55).

- [ ] **Step 3: Delete workflow files**

```bash
git rm backend/app/api/workflow.py \
  backend/app/services/workflow_service.py \
  backend/app/services/workflow_graph.py \
  backend/app/services/workflow_nodes.py \
  backend/app/services/workflow_progress.py \
  backend/app/services/workflow_store.py \
  backend/app/services/prompts/workflow_prompts.py \
  backend/app/models/workflow_run.py \
  backend/app/schemas/workflow.py
```

Also remove the now-empty `backend/app/services/prompts/` dir if it has no other files (check first: `ls backend/app/services/prompts/`).

- [ ] **Step 4: Delete old backend workflow tests**

```bash
git rm $(find backend/tests -name "test_workflow*" -type f)
```
Verify none remain: `find backend/tests -name "*workflow*"`.

- [ ] **Step 5: Verify backend boots + tests green**

Run: `cd backend && uv run uvicorn main:app --port 8002 &` then `curl http://127.0.0.1:8002/health` -> ok. Kill it.
Run: `cd backend && uv run --extra test pytest -q`
Expected: all green (no import errors from removed modules).

- [ ] **Step 6: Commit**

```bash
git add -A backend/
git commit -m "chore(backend): delete workflow code (migrated to agent)"
```

---

### Task C2: DB migration — drop workflow_runs table

**Files:**
- Create: `backend/migrations/versions/<rev>_drop_workflow_runs.py` (if alembic) OR a manual migration script.

- [ ] **Step 1: Check migration tooling**

Run: `ls backend/migrations/ 2>/dev/null || ls backend/alembic* 2>/dev/null || echo "no alembic"`
If alembic exists: generate a revision `uv run alembic revision --autogenerate -m "drop workflow_runs"`, then edit the generated file to `op.drop_table('workflow_runs')` and remove the `workflow_runs` relationship reflection. Run `uv run alembic upgrade head`.
If no alembic (SQLite dev): write a one-off script `backend/scripts/manual_drop_workflow_runs.py`:
```python
import sqlite3
conn = sqlite3.connect("backend/voice_clone.db")
conn.execute("DROP TABLE IF EXISTS workflow_runs")
conn.commit()
conn.close()
```
Run: `cd backend && uv run python scripts/manual_drop_workflow_runs.py`

- [ ] **Step 2: Verify table gone**

Run: `sqlite3 backend/voice_clone.db ".tables" | grep workflow_runs` -> no output.

- [ ] **Step 3: Commit**

```bash
git add backend/migrations/ backend/scripts/manual_drop_workflow_runs.py 2>/dev/null
git commit -m "chore(backend): drop workflow_runs table"
```

---

### Task C3: E2E rewrite + 3-process Playwright config

**Files:**
- Modify: `playwright.config.ts`
- Create: `tests/e2e/helpers/langgraphAssertions.ts`
- Rewrite: `tests/e2e/specs/workflow.spec.ts`

- [ ] **Step 1: Add agent to Playwright webServer**

In `playwright.config.ts`, change `webServer` to an array (if it's a single object, wrap it):
```typescript
webServer: [
  { command: 'cd backend && uv run uvicorn main:app --host 127.0.0.1 --port 8002', port: 8002, reuseExistingServer: !process.env.CI, timeout: 120_000 },
  { command: 'cd agent && uv run langgraph dev --port 2024 --no-browser', port: 2024, reuseExistingServer: !process.env.CI, timeout: 120_000 },
  { command: 'cd frontend && npm run dev', port: 5173, reuseExistingServer: !process.env.CI, timeout: 120_000 },
],
```
Verify the `--no-browser` flag exists: `cd agent && uv run langgraph dev --help | grep no-browser`. If not, set env `BROWSER=none` or equivalent.

- [ ] **Step 2: Create langgraphAssertions helper**

`tests/e2e/helpers/langgraphAssertions.ts`:
```typescript
import type { Page } from '@playwright/test';

export async function readAgentThread(page: Page, threadId: string): Promise<any> {
  return page.evaluate(async (tid) => {
    const r = await fetch(`/agent/threads/${tid}/state`);
    return r.json();
  }, threadId);
}

export function validateThreadState(thread: any, expected: { currentStage?: string; status?: string; hasKey?: string }) {
  if (expected.currentStage) expect(thread.values?.current_stage).toBe(expected.currentStage);
  if (expected.status) expect(thread.status).toBe(expected.status);
  if (expected.hasKey) expect(thread.values?.[expected.hasKey]).toBeTruthy();
}

export async function verifyAgentStateWithScreenshot(page: Page, threadId: string, label: string, expected: any) {
  const thread = await readAgentThread(page, threadId);
  validateThreadState(thread, expected);
  await page.screenshot({ path: `test-results/${label}.png`, fullPage: true });
}
```

(Export from `tests/e2e/helpers/index.ts` barrel too.)

- [ ] **Step 3: Rewrite workflow.spec.ts**

`tests/e2e/specs/workflow.spec.ts` — 8 cases per spec Section 10.2. Each case:
1. Navigate to a project's 文本库 · 源文档 tab.
2. Click 生成旁白 -> drawer opens.
3. Use `readAgentThread` + `verifyAgentStateWithScreenshot` for assertions.
4. Use `readDbProject` for the dual-read (chapters/segments/audio).
5. Cases: start+interrupt, approve+complete (dual-read), reject+regen, auto-reject, cancel, concurrent limit, three-level (L2/L3), fold+cross-section.

Refer to spec Section 10.2 for exact assertions. Use the existing `client`/`dbSession` fixtures + `global-setup.ts` seed project with a `source_document`.

- [ ] **Step 4: Run E2E**

Run: `npm run e2e`
Expected: all specs green (26 + the new workflow cases, or the workflow count replaces the old 7).

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts tests/e2e/helpers/langgraphAssertions.ts tests/e2e/helpers/index.ts tests/e2e/specs/workflow.spec.ts
git commit -m "test(e2e): rewrite workflow specs for agent + 3-process webserver"
```

---

### Task C4: Documentation update

**Files:**
- Modify: `AGENTs.md`, `docs/feature-spec.md`, `docs/api-reference.md`, `docs/database-schema.md`, `backend/tests/TEST_MAP.md`, `docs/e2e-test-guide.md`

- [ ] **Step 1: Update AGENTs.md**

Add `agent/` to the project overview (3-service architecture: frontend `:5173`, backend `:8002`, agent `:2024`). Add agent commands (`cd agent && uv sync --extra test`, `uv run langgraph dev --port 2024`). Document the `/agent` Vite proxy, the `chapters:batch` endpoint, and that the workflow is triggered from 文本库 · 源文档 (no separate workflow section). Note persistence is deferred (in-memory dev).

- [ ] **Step 2: Update api-reference.md**

Remove the 8 old workflow endpoints. Add `POST /api/segmented-projects/{pid}/chapters:batch` with request/response shapes.

- [ ] **Step 3: Update database-schema.md**

Remove the `workflow_runs` table. Note it's replaced by LangGraph thread metadata (in-memory, session-scoped).

- [ ] **Step 4: Update feature-spec.md**

Update the workflow section: trigger location (文本库 · 源文档), drawer UI, three-level presentation, reject loop. Remove references to the separate Workflow workspace.

- [ ] **Step 5: Update TEST_MAP.md + e2e-test-guide.md**

Update test map with agent tests (`agent/tests/`), `test_chapters_batch.py`, new E2E cases. Update e2e-test-guide with the 3-process webServer + dual-read (agent thread + backend DB).

- [ ] **Step 6: Commit**

```bash
git add AGENTs.md docs/ backend/tests/TEST_MAP.md
git commit -m "docs: update for langgraph agent migration"
```

---

### Task C5: Final verification

- [ ] **Step 1: Full E2E run**

Run: `npm run e2e`
Expected: all specs green.

- [ ] **Step 2: Full backend test suite**

Run: `cd backend && uv run --extra test pytest -q`
Expected: green.

- [ ] **Step 3: Full agent test suite**

Run: `cd agent && uv run --extra test pytest -q`
Expected: green.

- [ ] **Step 4: Visual review**

Start all 3 services; walk the full workflow end-to-end in the browser. Confirm warm-amber theme, Material Symbols, drawer behavior, three-level presentation, reject loop. Fix any visual regressions.

- [ ] **Step 5: Final commit (if any fixes)**

```bash
git add -A
git commit -m "chore: final verification fixes for langgraph agent migration"
```

---

## Self-Review

**1. Spec coverage:**
- Agent: langgraph.json (A12), state (A6), schemas (A2), prompts (A3), instructor llm (A4), backend_client (A5), 4 nodes (A7-A11), graph (A12) — ✓.
- Backend chapters:batch (A9), delete workflow code (C1), drop table (C2) — ✓.
- Frontend: deps+proxy (B1), service layer (B2), PipelineTimeline (B3), StageCard (B4), ReviewPanel (B5), StageDetailModal (B6), WorkflowDrawer+Indicator (B7), trigger+nav removal (B8), i18n+polish (B9) — ✓.
- E2E: config (C3), assertions (C3), 8 cases (C3) — ✓.
- Docs (C4), final verify (C5) — ✓.
- Studio manual verify (A13) — ✓.

**2. Placeholder scan:** The `StageDetail` helper in B7 is described but its full code is deferred to "co-located in WorkflowDrawer.tsx" — this is a known thin spot. The implementer should write `summaryFor` + `StageDetail` (gen_script script preview, split_segment tree, synthesis progress bar) inline in `WorkflowDrawer.tsx`, splitting to `stageDetail.tsx` if it exceeds 400 lines. All other steps have complete code or exact commands.

**3. Type consistency:** `NarraWorkflowState` (types.ts) mirrors `NarrationWorkflowState` (state.py). `MilestoneEvent.type` matches the `get_stream_writer` payloads in the nodes. `NODE_STATE_KEYS` keys match state field names (`narration_script`, `review_feedback`, `structured_segments`, `synthesis_results`). `BackendClient` method names match what nodes call. `stream.respond` payload shape matches `interrupt`/resume in script_review node (`{action, edited_script, comment}` / `{action, feedback}`).

**4. Known risks to monitor during execution:**
- `langgraph dev` `--no-browser` flag — verify in C3 Step 1; fallback to env.
- `agentClient.assistants.getGraph('narration')` exact SDK method name — verify against installed `@langchain/langgraph-sdk` version in B7; the fallback hardcodes the 4 nodes.
- `useStream` `onCustomEvent` signature — verify in B7; the spec confirmed custom events flow but the exact accessor may differ by SDK version.
- The `graph.py` module-level `graph = build_graph(checkpointer=None, store=None)` — LangGraph Server injects checkpointer/store; verify `langgraph dev` accepts a graph compiled without them (A12 Step 5). If it errors, export the uncompiled `builder` and let the server compile.
- Project delete thread cleanup (frontend-orchestrated) — not a separate task; it's in the project-delete flow. If the existing delete is in `TTSSynthesis.tsx`, add the `client.threads.search`+`delete` before `api.delete` there. Add as a follow-up if missed.
