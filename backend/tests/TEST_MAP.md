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
| Segmented project CRUD/service | `app/api/segmented_projects.py`, `app/services/segmented_project_service.py` | `tests/test_segmented_projects_api.py`, `tests/test_segmented_projects_service.py`, `tests/integration/test_chapters_batch.py` | Project/chapter/segment persistence, orphan cleanup (DB-path-first file deletion, including audio dropped from a kept segment's `audio` state), project-rename asset relocation (dir move + path rewrite), voice_ref save/load and auto-migration. `chapters:batch` replace-style rebuild including per-chapter `narration_script` and per-chapter `engine` (written into `chapter.voice`); top-level `narration_script` written to file with DB storing `narration_document_path` only (same path-based storage for `source_document`). |
| Segmented synthesis | `app/services/segmented_project_service.py`, `app/api/tts.py` bridge | `tests/test_segmented_synthesis.py`, `tests/test_synthesize_speech_internal.py` | Guards real synthesis bridge behavior and generated audio metadata. Also covers style-tag adaptation: text passed to the engine is cleaned/annotated via `prepare_text_for_engine` per engine/mode/`mute_tags`. |
| Style tag engine adaptation | `app/services/engine_capabilities.py`, `app/services/srt_service.py` | `tests/unit/test_engine_capabilities.py`, `tests/test_srt_service.py` | Engine capability matrix, inline/leading tag strip, leading tag apply (idempotent), voxcpm mode caps (ultimate strips all), SRT subtitle tag cleaning. Mirrors `frontend/src/services/styleTags.ts`. |
| Silent/missing segment marking | Segment maintenance scripts/services | `tests/test_mark_silent_segments.py` | Ensures missing/silent audio is marked without deleting files. |
| Source library | `app/api/sources.py`, source models/services | `tests/test_sources_api.py`, `tests/test_narration_models.py` | Source documents are project-level data. |
| Narration documents | `app/api/narrations.py`, `app/models/narration.py` | `tests/test_narrations_api.py`, `tests/test_narration_models.py` | Versioned project-level narration documents and chapter slice references. |
| Animation specs | Segmented project animation fields/API | `tests/test_animation_spec_api.py` | Animation spec persistence and batch apply behavior. |
| Audio encoding | `app/core/audio_encoder.py` | `tests/test_audio_encoder.py` | ffmpeg transcode, duration probe, and invalid input behavior. |
| Config crypto | Config encryption helpers | `tests/test_config_crypto.py` | Fernet/RSA encryption and encrypted value format. |
| System config (storage mode + animation root) | `app/core/system_config_service.py`, `app/api/config.py` | `tests/unit/test_system_config_service.py`, `tests/test_config_animation_root_api.py` | `animation_root_folder` get/set round-trip, path validation (creatable/writable), and GET/PUT/test endpoints. |
| Narration git versioning + push | `app/services/narration_versioning/` (job/git_ops/scheduler), `app/api/config.py` (narration-git-* endpoints) | `tests/services/narration_versioning/test_git_ops.py`, `tests/services/narration_versioning/test_job.py`, `tests/test_narration_git_api.py`, E2E `tests/e2e/specs/narration-git-push.spec.ts` | Daily cron snapshot (serialize+commit); `git_ops.push` (set-url/add + push, no force); `snapshot_all(remote_url=...)` push + `push_error` capture; `narration_git_remote` DB setting; manual snapshot endpoint. Frontend: `src/components/Settings/NarrationGitSetting.test.tsx`. |
| Remotion scaffold | `app/services/remotion_scaffold_service.py`, `app/api/segmented_projects.py` (scaffold-remotion) | `tests/test_remotion_scaffold.py` | Target resolution hierarchy (`target_dir` > `remotion_project_path` > global setting), `safe_project_dirname`, create/refresh idempotency, 422 `animation_root_not_configured`. Agent node: `agent/tests/test_kv_scaffold.py` (forwards override only, 422 guidance). Frontend: `src/components/Settings/AnimationRootSetting.test.tsx`. |
| Project export/import | `app/services/project_export_service.py`, `app/services/project_import_service.py`, `app/api/segmented_projects.py` (export/import) | `tests/test_project_export_service.py`, `tests/test_project_import_service.py`, `tests/test_project_export_import_api.py`, E2E `tests/e2e/specs/project-export-import.spec.ts` | Export bundles DB rows + assets (segment audio, voice audio, docs) into ZIP with manifest; import remaps IDs (FK rewrite), writes files, resets `remotion_project_path`. Guard: `project_assets_not_under_project_dir`. Frontend: `src/components/ProjectHub/ProjectHub.test.tsx` (export/import callbacks). |
| Narration layer-sync (Phase A + B) | `app/services/layer_sync_service.py`, `app/services/segmented_project_service.py` (`batch_create_structure` hook, `resplit_from_script`), `app/api/segmented_projects.py` (split hook + `GET /sync-status` + 2 sync-action endpoints) | `tests/test_layer_sync_service.py`, `tests/test_layer_sync_integration.py`, E2E `tests/e2e/specs/layer-sync.spec.ts` | Phase A: `chapter.sync_state` JSON (l1/l2/segments hashes); `mark_consistent` at batch_create, `mark_split` at split, generic save_project untouched; `sync_status` dirty detection. Phase B: `segment.split_anchor` JSON (offset_start/offset_end/baseline_text, migration P16); `mark_split` writes anchors; `POST /resplit-from-script` (rule_split from L2, old segment config discarded, re-baseline); `POST /rewrite-script-from-segments` (localisation merge L3->L2, 409 `l2_dirty_conflict`). Frontend: `src/components/SegmentedTTS/ChapterSyncBadges.test.tsx`, `src/components/SegmentedTTS/ChapterSyncModal.test.tsx`. |

## Manual Tests

Manual scripts are kept under `tests/manual/` and intentionally do not run in the default pytest suite. They are for local diagnostics, real model checks, or one-off service verification.

Rules:

- Use the `manual_*.py` prefix.
- Do not use the `test_*.py` prefix.
- Do not rely on manual scripts for CI/default automated coverage.
- If a manual script becomes stable and important, convert it into a mocked automated test under `tests/`, `tests/unit/`, or `tests/integration/`.
| Unified data root + asset naming (plan B) | `app/core/segmented_assets.py`, `app/core/config.py` (`data/projects`), `app/services/data_root_migration.py`, `scripts/migrate_to_data_root.py` | `tests/test_segmented_assets.py`, `tests/test_data_root_migration.py` | Project dir = name slug (+hash suffix on collision via manifest); chapter/segment paths = raw DB ids; readers always use DB-stored paths; migration plan/apply (dry-run default), idempotent, multi-chapter short-id collision coverage. |
| Unified storage (voices/tts-history/srt, PR-B) | `app/core/config.py` (data/voices|tts-history|srt|temp), `app/api/clone.py`, `app/api/tts.py`, `app/api/mimo_tts.py`, `app/api/voxcpm.py`, `app/services/qwen_tts_service.py`, `app/services/unified_storage_migration.py`, `scripts/migrate_to_unified_storage.py` | `tests/test_unified_storage_migration.py` | Clone samples -> data/voices/profiles, previews -> data/voices/previews, TTS history -> data/tts-history, srt -> data/srt; reads are DB-path driven with legacy-dir fallback; migration plan/apply, idempotent, rewrites voice_params/preview/audio_path. |
| Markdown chapter split (按标题拆分章节) | `app/api/text_split.py` (`markdown-detect`/`markdown-split`), `app/api/segmented_projects.py` (`chapters:batch`) | `tests/test_markdown_split_api.py`, frontend `src/components/ProjectLibrary/ChapterSplitModal.test.tsx`, E2E `tests/e2e/specs/chapter-split.spec.ts` | 旁白文档 tab 章节列表顶栏 + 全文视图顶栏「按标题拆分章节」：detect 层级 → 选 levels → split 预览 → chapters:batch 替换章节（含替换警告 + layer-sync 基线验证）。 |
| 手动导入旁白文档 + 全文视图 | `frontend/src/components/ProjectLibrary/NarrationDocView.tsx`, `frontend/src/hooks/useSegmentedProject.ts` (`SET_NARRATION_SCRIPT`), `backend/app/api/segmented_projects.py` (`PUT` `narration_script` -> `narration_document_path`) | frontend `src/components/ProjectLibrary/NarrationDocView.test.tsx`, `src/components/ProjectLibrary/ProjectLibrary.test.tsx` (fulltext form A/B + modal regression), `src/hooks/__tests__/useSegmentedProject.test.ts` (`SET_NARRATION_SCRIPT`), E2E `tests/e2e/specs/narration-manual-import-split.spec.ts` | 全文视图自适应：`narration_script` 空 = 章节合并只读预览 + 转换入口（粘贴旁白文档 / 从现有章节生成）；非空 = 编辑/预览切换 + 拆分按钮。手动粘贴经 draftSync 防抖 PUT 落盘 `narration.md`，dual-read（API + DB）验证。后端零改动（复用 `ProjectIn.narration_script`）。 |
| Post-synthesis audio adjust (tempo/volume) | `app/core/audio_encoder.py` (`adjust_audio_speed_volume`), `app/services/segmented_project_service.py` (`adjust_chapter_audio`), `app/api/segmented_projects.py` (`adjust-audio`) | `tests/test_audio_encoder.py`, `tests/test_adjust_audio.py`, frontend `src/components/TTSSynthesis/AdjustAudioDialog.test.tsx`, E2E `tests/e2e/specs/studio-adjust-audio.spec.ts` | ffmpeg atempo(0.5–2.0) + volume(-12~+12dB) 章节级批处理；绝对语义（始终从原始渲染，chapter.audio_adjust 记录已应用参数，恒等即还原）；时长重新 probe；P17 migration。 |
| Role delete confirmation | `frontend/src/components/SegmentedTTS/RoleLibraryPanel.tsx` (global delete), `frontend/src/pages/TTSSynthesis.tsx` (`handleDeleteRole` project-level removal) | `frontend/src/components/SegmentedTTS/RoleLibraryPanel.deleteConfirm.test.tsx`, E2E `tests/e2e/specs/role-delete-confirm.spec.ts` | 两个删除入口均有二次确认，文案说明已合成音频保留、仅清角色引用；项目内移除不全局删除。 |
