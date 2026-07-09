# CLAUDE.md

This file provides guidance to AI coding assistants when working in this repository.

## Project Overview

NarraForge is an AI narration workshop that integrates voice cloning, text-to-speech, and speech-to-subtitle workflows. It is designed to evolve into a segment-first narration and Remotion animation generation system.

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

### API Testing

```bash
curl http://127.0.0.1:8002/health
```

## Architecture

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
- `src/hooks/` — useSegmentedProject, useStorageMode, useVoiceRefresh, useTheme, and related hooks.
- `src/services/` — api.ts, indexedDB.ts, segmentedProjectDB.ts, audioConcat.ts, and frontend service utilities.
- `src/styles/` — variables.css, global.css, and design tokens.
- CSS Modules use the `camelCase` convention. For example, `emo_happy` in CSS becomes `styles.emoHappy` in TypeScript.

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

## Key Design Decisions

- Edge-TTS is the default practical TTS engine because it requires no API key and is easy to run locally.
- The primary color scheme is warm amber, with `#c47a3a` as the primary color. Do not introduce purple as a primary UI color.
- CSS Modules use camelCase mappings.
- Segmented projects are autosaved to IndexedDB with a 1-second debounce.
- Smart splitting returns one emotion per segment. Supported emotions are happy, sad, angry, calm, neutral, and excited.
- Global voice changes must not overwrite already generated segments.
- Segments track generated voice information so stale audio can be detected when voice settings change.

## Environment

Required or commonly used variables in `backend/.env`:

- `QWEN_API_KEY` — Qwen API key for CosyVoice.
- `MIMO_API_KEY` — MiMo API key. Optional, used for MiMo TTS and LLM features.
- `DATABASE_URL` — SQLite connection string. Default: `sqlite:///./voice_clone.db`.

## Testing

### Backend Tests

All automated backend tests live under `backend/tests/`. Run them with the test extra enabled:

```bash
cd backend && uv run --extra test pytest -q
```

Backend pytest structure and conventions:

- See `backend/tests/TEST_MAP.md` for the feature-to-test mapping and focused test selection guide.
- `backend/tests/unit/` — Unit tests for services and models.
- `backend/tests/integration/` — API and integration tests using the FastAPI `client` fixture.
- `backend/tests/fixtures/` — pytest and factory helpers only. Do not place collected tests here.
- `backend/tests/manual/` — Manual verification scripts only. Files must be named with the `manual_*.py` prefix and are ignored by pytest via `backend/pytest.ini`. Do not put auto-collected `test_*.py` files in this directory.
- Real external service tests must be marked with `external` and require explicit opt-in. Qwen/DashScope external clone checks only run when `RUN_EXTERNAL_QWEN_TESTS=1` is set.

Backend test isolation:

- Tests use an in-memory SQLite database: `sqlite:///:memory:` from `backend/tests/conftest.py`. They do not use `backend/voice_clone.db`.
- API tests must use the pytest `client` fixture so `get_db` is overridden to the test session.
- Avoid module-level `TestClient(app)` because it can bypass test database isolation.
- Tests that need backend persistence mode must explicitly call `set_storage_mode(db_session, "backend")`.
- The default storage mode is `frontend`, so audio and SRT responses may return base64/content without backend history rows.
- Mock TTS services according to the current contracts: Qwen/CosyVoice synthesis returns an audio file path; Edge-TTS returns `(audio_bytes, "mp3")`.

### Frontend Tests

All frontend test files with `.test.ts`, `.test.tsx`, `.spec.ts`, or `.spec.tsx` extensions must be placed in the same directory as the source code they test.

### E2E Tests

Cross-stack browser E2E tests live under `tests/e2e/`. All 26 specs pass with `npm run e2e`.

**Directory layout:**

```text
tests/e2e/
├── specs/                  ← Automated Playwright browser specs (26 tests)
├── fixtures/               ← Stable E2E input fixtures (audio, images)
├── helpers/                ← Shared utilities
│   ├── dataAssertions.ts   ← API-layer validators (validateChapter, validateSegment, …)
│   ├── dbReader.ts         ← DB-layer reader — direct SQLite access via node:sqlite
│   ├── dualReadSnapshot.ts ← Dual-read + screenshot helper
│   └── index.ts            ← Barrel exports
├── global-setup.ts         ← Seed data before all tests
└── README.md               ← Layout and artifact policy
```

**How to run:**

```bash
npm run e2e          # 26 tests, serial (--workers=1), HTML report
npm run e2e:ui       # Playwright visual test explorer
npm run e2e:report   # Open latest HTML report
npm run e2e:clean    # Remove all test-results and playwright-report dirs
```

Tests run serially (`--workers=1`) because they share a single SQLite DB.
Playwright's `webServer` config auto-starts backend on `:8002` and frontend on `:5173`.
Do NOT manually start servers — the webServer handles it and bypasses WorkBuddy's sandbox (which would block `shutil.rmtree` during project deletion).

**Dual-read verification:**

Every test that writes to the backend also verifies from TWO independent layers:

| Layer | Reader | Validator |
|-------|--------|-----------|
| API | `readBackendProject(page, id)` | `validateChapter()`, `validateSegment()` |
| DB | `readDbProject(id)` | `validateDbProjectRow()` |

The `verifyDbWithScreenshot()` helper wraps DB-read + validation + a labeled screenshot that appears in the HTML report.

**Artifacts:**

Generated screenshots, videos, traces, and reports go to ignored directories:
- `test-results/` — per-run failure artifacts and `testInfo.attach()` screenshots
- `playwright-report/` — HTML report (one directory per run with local-timezone timestamp)
- Do NOT commit anything under these directories.

**Config highlights:**

- `screenshot: 'on'` — every test captures a viewport screenshot at completion
- `PW_RUN` env var — set by `npm run e2e` to `$(date +%Y-%m-%dT%H-%M-%S)` for consistent per-run directory naming
- `reuseExistingServer: !process.env.CI` — local runs reuse existing servers; CI always starts fresh

## Notes

- The backend runs on port 8002, not the default 8000.
- The frontend Vite proxy maps `/api` to `http://127.0.0.1:8002`.
- FunASR models are downloaded from ModelScope, not HuggingFace. The cache directory is `~/.cache/modelscope/hub/`.
- `torchaudio` is an implicit dependency of FunASR and must be declared explicitly.
- PyPI network access may be unstable in China. If needed, use `--index-url https://pypi.tuna.tsinghua.edu.cn/simple`.
