# CLAUDE.md

This file provides guidance to AI coding assistants when working in this repository.

## Project Overview

NarraForge is an AI narration workshop that integrates voice cloning, text-to-speech, and speech-to-subtitle workflows. It is designed to evolve into a segment-first narration and Remotion animation generation system.

The **narration workflow** (4-stage: gen_script → script_review → split_segment → synthesis) is now a standalone **LangGraph agent** service in `agent/`. The agent runs via `langgraph dev` (in-memory) and communicates with the backend over HTTP. The frontend triggers the workflow from the 文本库 · 源文档 tab via a side drawer (not a separate workspace). Persistence is deferred (session-scoped; runs lost on agent restart).

## key principles
**MUST KEEP docs in Documentation updated**
**THINK BEFORE CODE**

## Documentation

| Document | Path | Description |
|---|---|---|
| Feature specification | `docs/feature-spec.md` | Full feature specification, including the segmented editor, emotion system, project persistence, and related workflows. |
| API reference | `docs/api-reference.md` | Backend API endpoints, request/response formats, and parameter details. |
| Database schema | `docs/database-schema.md` | SQLAlchemy models, field definitions, and table relationships. |
| Environment variables | `docs/ENV.md` | Backend `.env` configuration. |
| Runbook | `docs/RUNBOOK.md` | Deployment and operations guide. |
| Contributing guide | `docs/CONTRIBUTING.md` | Development conventions and contribution guidelines. |
| design guide | `docs/design/stitch_narraforge_story_global_prj/DESIGN.md` | UI design guidelines. |
| Test MAP | `backend/tests/TEST_MAP.md` | Test case and function map doc |
| E2E Test Guide | `docs/e2e-test-guide.md` | Running instructions, conventions, dual-read verification, and gap analysis |

**KEEP these documents updated by every PR**!

## Commands

### Frontend

```bash
cd frontend
npm run dev      # Start dev server on port 5173
npm run build    # Production build
npm run lint     # Run ESLint
```

### Backend

```bash
cd backend
uv sync                              # Install dependencies with uv, not pip
uv run uvicorn main:app --host 127.0.0.1 --port 8002 --reload
```

### Agent

```bash
cd agent
uv sync --extra test                  # Install deps
uv run langgraph dev --port 2024      # Start agent server (in-memory)
uv run --extra test pytest -q        # Run agent tests
```

The agent needs `agent/.env` with `BACKEND_API_URL`, `AGENT_LLM_API_KEY`, `AGENT_LLM_BASE_URL`, `AGENT_LLM_MODEL`.
Optional: `LANGSMITH_API_KEY` for prompt hot-reload (falls back to code defaults).

### API Testing

```bash
curl http://127.0.0.1:8002/health
```

## Architecture

### Agent: LangGraph + Python 3.12+

- `agent/app/` — Graph definition, nodes, prompts, schemas, LLM client, backend HTTP client.
- Runs via `langgraph dev` (in-memory, no Docker/Postgres/Redis for dev). Persistence deferred.
- Nodes call the backend over HTTP for project/chapter/segment/TTS operations.
- Run linkage: LangGraph thread metadata (`{project_id, project_name, kind}`).
- `GET /assistants/narration/graph` returns the graph topology (nodes + edges).
- `POST /threads/{id}/runs/stream` streams execution (channels: values/messages/custom/interrupts).

### Backend: FastAPI + Python 3.12+

- `app/api/` — Route handlers: clone, tts, mimo_tts, text_split, speech_to_text, subtitle_llm, config, model_config, and related APIs.
- `app/models/` — SQLAlchemy ORM models: voice_profile, tts_config, tts_result, transcription_record, system_config, segmented_project, and related models.
- `app/services/` — Business logic: cosyvoice_service, edge_tts_service, llm_client, text_split_service, whisper_service, funasr_service, and related services.
- `app/core/` — Configuration, database setup, model_config_service, storage mode utilities, and shared core helpers.
- Dependencies are managed with `uv`, not pip. Use `uv sync` or `uv pip install --python .venv/bin/python`.

### Frontend: React 19 + TypeScript + Vite

- `src/pages/` — TTSSynthesis, VoiceClone, SpeechToText, ModelConfig, Landing, and other page-level components.
- `src/components/TTSSynthesis/` — GlobalControlBar, EdgeTTSPanel, MiMoTTSPanel, AudioPlayer, SynthesisHistory.
- `src/components/SegmentedTTS/` — SegmentList, SegmentRow, SegmentEditPanel, TextInputPanel, ExportDialog.
- `src/components/Workflow/` — WorkflowDrawer, PipelineTimeline, StageCard, ReviewPanel, StageDetailModal, DrawerIndicator.
- `src/hooks/` — useSegmentedProject, useStorageMode, useVoiceRefresh, useTheme, and related hooks.
- `src/services/` — api.ts, indexedDB.ts, segmentedProjectDB.ts, audioConcat.ts, and frontend service utilities.
- `src/services/langgraph/` — client.ts, contracts.ts, types.ts (LangGraph SDK integration).
- `src/styles/` — variables.css, global.css, and design tokens.
- CSS Modules use the `camelCase` convention. For example, `emo_happy` in CSS becomes `styles.emoHappy` in TypeScript.
- The narration workflow is triggered from the 文本库 · 源文档 tab via a side drawer (not a separate workspace). The `useStream` hook from `@langchain/langgraph-sdk` powers real-time progress.

### Database

The development SQLite database is stored at:

```text
backend/voice_clone.db
```

See `docs/database-schema.md` for the full schema.

Key tables include VoiceProfile, TTSConfig, TTSResult, TranscriptionRecord, SystemConfig, and segmented project tables.

### Storage Modes

- `frontend` — Audio is stored in browser IndexedDB. This is the default mode and does not require backend audio persistence.
- `backend` — Audio is stored through SQLite metadata plus filesystem assets under `backend/uploads/`.

## Testing

### Backend Tests

```bash
cd backend && uv run --extra test pytest -q
```

See [`backend/tests/TEST_MAP.md`](backend/tests/TEST_MAP.md) for test structure, isolation rules, mock contracts, and feature-to-test mapping.

### Frontend Tests

All frontend test files with `.test.ts`, `.test.tsx`, `.spec.ts`, or `.spec.tsx` extensions must be placed in the same directory as the source code they test.

### E2E Tests

Cross-stack browser E2E tests live under `tests/e2e/`. All 26 specs pass with `npm run e2e`.
See [`docs/e2e-test-guide.md`](docs/e2e-test-guide.md) for running instructions, directory layout, data assertions, dual-read verification, and gap analysis.
