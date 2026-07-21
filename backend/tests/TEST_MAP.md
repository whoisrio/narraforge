# Backend Test Map

This document maps backend feature areas to the tests that protect them. Use it to decide which focused tests to run before running the full backend suite.

## How to Run

Default automated backend suite:

```bash
cd backend
uv run --extra test pytest -q
```

Real external Qwen/DashScope checks are opt-in:

```bash
cd backend
RUN_EXTERNAL_QWEN_TESTS=1 uv run --extra test pytest tests/integration/test_external_url_clone.py -s -v
```

## Test Database and Isolation

- Automated tests use the in-memory SQLite database configured in `tests/conftest.py`: `sqlite:///:memory:`.
- Automated tests do not use `backend/voice_clone.db`.
- API tests must use the pytest `client` fixture so FastAPI `get_db` is overridden to the test session.
- Do not create module-level `TestClient(app)` instances in tests; they can bypass test database isolation.
- Mock TTS services according to the current contracts: Qwen/CosyVoice synthesis returns an audio file path; Edge-TTS returns `(audio_bytes, "mp3")`.
- Default storage mode is `frontend`. Tests that assert backend history rows, backend audio URLs, or persisted SRT/audio files must explicitly call:

```python
set_storage_mode(db_session, "backend")
db_session.commit()
```

## Directory Structure

| Path | Purpose |
|---|---|
| `tests/unit/` | Unit tests for services and models. |
| `tests/integration/` | API/integration tests using FastAPI fixtures. |
| `tests/fixtures/` | Factory and pytest helper code only. |
| `tests/manual/` | Manual verification scripts only; files must be named `manual_*.py` and are ignored by pytest. |
| `tests/conftest.py` | Shared fixtures, in-memory database setup, API client override, and mocks. |

## Feature-to-Test Mapping

| Feature area | Main code | Tests | Notes |
|---|---|---|---|
| Voice upload, list, detail, delete | `app/api/clone.py`, `app/models/voice_profile.py` | `tests/integration/test_clone_api.py`, `tests/test_api_clone.py`, `tests/unit/test_voice_profile_model.py` | Uses test DB and temp audio files. |
| Qwen/CosyVoice clone registration | `app/api/clone.py`, `app/services/qwen_tts_service.py` | `tests/integration/test_clone_api.py`, `tests/unit/test_qwen_tts_service.py` | Automated tests mock Qwen. Real Qwen calls are external tests only. |
| External audio URL behavior | GitHub/Qwen URL checks | `tests/integration/test_external_url_clone.py` | Marked `external`; requires `RUN_EXTERNAL_QWEN_TESTS=1` for real Qwen calls. |
| Qwen/CosyVoice TTS API | `app/api/tts.py`, `app/services/qwen_tts_service.py` | `tests/integration/test_tts_api.py`, `tests/test_api_tts.py`, `tests/unit/test_qwen_tts_service.py` | Current contract: Qwen/CosyVoice synthesis returns an audio file path. |
| Edge-TTS | `app/api/tts.py`, `app/services/edge_tts_service.py` | `tests/test_api_tts.py`, `tests/unit/test_edge_tts_service.py`, `tests/test_synthesize_speech_internal.py` | Current mock contract: Edge-TTS returns `(audio_bytes, "mp3")`. |
| MiMo TTS | `app/api/mimo_tts.py`, MiMo service code | Covered indirectly through segmented/project integration where applicable | Add focused tests here when changing MiMo-specific behavior. |
| VoxCPM TTS | `app/api/voxcpm.py`, VoxCPM service code | Covered by API-level behavior where applicable | Local model/hardware paths should stay out of default pytest unless fully mocked. |
| Speech-to-text | `app/api/speech_to_text.py`, `app/services/voice_to_srt_service.py`, `app/services/funasr_service.py` | `tests/test_api_speech_to_text.py`, `tests/test_funasr_service.py` | Frontend storage returns content without history rows; backend storage persists history. |
| FunASR service | `app/services/funasr_service.py` | `tests/test_funasr_service.py` | Real/manual FunASR checks live under `tests/manual/`. |
| Text split and SSML annotation | `app/api/text_split.py`, `app/services/text_split_service.py` | `tests/test_text_split_api.py`, `tests/test_text_split_service.py` | LLM calls are mocked in automated tests. |
| LLM client | `app/services/llm_client.py` | `tests/test_llm_client.py` | Covers config fallback, JSON extraction, structured calls, and validation retries. |
| Markdown chapter split | Markdown split API/service code | `tests/test_markdown_split_api.py` | Covers heading detection, slicing, front matter, and chapter merge behavior. |
| Segmented project assets | `app/core/segmented_assets.py` | `tests/test_segmented_assets.py` | Filesystem layout, manifest, text/SSML files, and cleanup. |
| Segmented project CRUD/service | `app/api/segmented_projects.py`, `app/services/segmented_project_service.py` | `tests/test_segmented_projects_api.py`, `tests/test_segmented_projects_service.py` | Project/chapter/segment persistence, orphan cleanup, voice_ref save/load and auto-migration. |
| Segmented synthesis | `app/services/segmented_project_service.py`, `app/api/tts.py` bridge | `tests/test_segmented_synthesis.py`, `tests/test_synthesize_speech_internal.py` | Guards real synthesis bridge behavior and generated audio metadata. |
| Silent/missing segment marking | Segment maintenance scripts/services | `tests/test_mark_silent_segments.py` | Ensures missing/silent audio is marked without deleting files. |
| Source library | `app/api/sources.py`, source models/services | `tests/test_sources_api.py`, `tests/test_narration_models.py` | Source documents are project-level data. |
| Narration documents | `app/api/narrations.py`, `app/models/narration.py` | `tests/test_narrations_api.py`, `tests/test_narration_models.py` | Versioned project-level narration documents and chapter slice references. |
| Animation specs | Segmented project animation fields/API | `tests/test_animation_spec_api.py` | Animation spec persistence and batch apply behavior. |
| Audio encoding | `app/core/audio_encoder.py` | `tests/test_audio_encoder.py` | ffmpeg transcode, duration probe, and invalid input behavior. |
| Config crypto | Config encryption helpers | `tests/test_config_crypto.py` | Fernet/RSA encryption and encrypted value format. |

## Manual Tests

Manual scripts are kept under `tests/manual/` and intentionally do not run in the default pytest suite. They are for local diagnostics, real model checks, or one-off service verification.

Rules:

- Use the `manual_*.py` prefix.
- Do not use the `test_*.py` prefix.
- Do not rely on manual scripts for CI/default automated coverage.
- If a manual script becomes stable and important, convert it into a mocked automated test under `tests/`, `tests/unit/`, or `tests/integration/`.
