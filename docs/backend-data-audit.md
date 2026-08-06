# NarraForge — Backend Data Structure Audit Report

**Version**: 1.0
**Date**: 2026-07-28
**Status**: Current

---

## 1. Overview

This document audits the backend data structures in two layers: the **persistence layer** (SQLAlchemy models, migrations, on-disk schema in `backend/voice_clone.db`) and the **API contract layer** (request/response shapes between frontend, agent service, and backend).
Every finding cites concrete file and line evidence.
Findings are grouped by severity: **High** (data loss / runtime bugs / broken contracts), **Medium** (drift and inconsistency), **Low** (polish).

**Audit scope**: `backend/app/models/`, `backend/app/core/database.py`, `backend/migrations/`, `backend/app/api/`, `backend/app/schemas/`, `frontend/src/services/api.ts`, `frontend/src/types/`, `agent/app/backend_client.py`, `docs/database-schema.md`, `docs/api-reference.md`.
**Method**: static review plus live inspection of the dev database (`PRAGMA table_info`, `sqlite_master`).

---

## 2. Persistence Layer

Quantified overview: 10 mapped tables; 14 JSON columns across 5 tables; ~30 JSON write sites, of which **5 use the mutate-then-reassign pattern that silently drops UPDATEs**; 7 declared foreign keys with **`PRAGMA foreign_keys` never enabled**; `migrations/versions/` is an empty directory (no Alembic); the live DB carries **1 zombie table and 5 zombie columns**.

### 2.1 High

| # | Finding | Evidence |
|---|---------|----------|
| D1 | **`PRAGMA foreign_keys` is never enabled — every `ondelete=` clause is dead code.** Deleting a `Role` (`role_service.py:80-86`) does not null out `segmented_project_segments.role_id` (SET NULL, `segmented_project.py:104`) or `segmented_projects.default_narrator_role_id` (`:36-40`); worse, `voice.role_id` nested in JSON has no FK at all and is guaranteed to dangle. `Role.project_id` / `VoiceProfile.project_id` SET NULL likewise never fires. Only ORM `cascade="all, delete-orphan"` (chapters/segments) actually works; `SourceDocument` cleanup is hand-rolled with a comment admitting the FK gap (`segmented_project_service.py:526-528`). | `core/database.py:6-11` (no event listener), verified live: `PRAGMA foreign_keys` = 0 |
| D2 | **`mimo_tts.py` writes to dropped columns — synthesized audio paths are silently lost.** `seg.current_audio_path = rel; seg.audio_format = "mp3"` were removed from the model by the P9000 recreate; the assignments are plain Python attributes, never persisted, and `seg.audio` is never updated. The editor cannot read the synthesized audio. Correct pattern exists at `update_segment_after_synth` (`segmented_project_service.py:603-614`). | `api/mimo_tts.py:136-137`, `core/database.py:357-362` |
| D3 | **5 JSON-column mutate-then-reassign sites drop UPDATEs silently** (the incident already recorded in AGENTS.md, still recurring). The `missing: True` audio flag never lands; the Qwen cloud `role` sync update is lost. `clone.py:744-750` is the nested variant: although it builds fresh top-level dicts, `model_vp.setdefault("params", {})` returns the *shared* original nested dict when `params` already exists, so the in-place mutation makes the reassigned copy compare deep-equal to the old value and the column stays clean — verified empirically (SQLAlchemy 2.x: `is_modified()` returns `False` on the params-exists path, `True` only when `params` is first created). Note `voice.description` being dirty in the same request does **not** rescue it, since SQLAlchemy emits only dirty columns in the UPDATE. | `api/tts.py:183-185`, `api/segmented_projects.py:237-239`, `services/segmented_project_service.py:862-863`, `api/clone.py:672-674`, `api/clone.py:744-750` (nested-variant). Safe counterparts: `segmented_project_service.py:354,1139` (`deepcopy`). Zero `flag_modified` in the codebase. |
| D4 | **No migration tool — 17 hand-written ALTER groups + 6 rebuild functions inside `init_db()`.** No version table; idempotency relies on per-statement `inspect`; ordering is coupled in code comments. `_drop_columns_via_recreate` (`database.py:804-819`) **rebuilds tables keeping only column name and type — NOT NULL/DEFAULT/PK/FK/indexes are all lost**. Live DB confirms: all three `segmented_*` tables show `notnull=0` and no PK index — **duplicate primary keys are no longer rejected by the DB**. | `migrations/versions/` (empty), `core/database.py:285-311,136-156,305-307`; contrast the correct manual rebuild at `database.py:211-246` |

### 2.2 Medium

| # | Finding | Evidence |
|---|---------|----------|
| D5 | **Model ↔ live DB drift**: zombie table `narration_documents` (0 code references, undocumented); `voice_profiles` still carries dropped columns `engine`, `engine_params`, `source_audio_path`, `cloned_preview_path`; `segmented_projects` still carries `default_narrator_snapshot`. | live DB vs `models/` |
| D6 | **Missing indexes + fabricated indexes in docs.** Only 1 explicit index in the whole DB (`ix_source_documents_project_id`); FK columns `chapters.project_id` / `segments.chapter_id` are unindexed (full scans). `docs/database-schema.md:299-302` claims "FK (auto-indexed)" — SQLite does no such thing — and still lists the long-deleted `segments.project_id` column. No unique constraints beyond PKs (e.g. `(chapter_id, position)`, single default `tts_config`). | `models/source_document.py:14-19`, live `sqlite_master` |
| D7 | **Doc ↔ model drift** (`database-schema.md`): roles table section misses `project_id` (`role.py:17`); doc:283 claims `voice_profiles` has no FK while `voice_profile.py:21` declares one; zombie table/columns undocumented. The `init_db`-embedded migration mechanism is not mentioned anywhere in the doc. | see left |
| D8 | **Path strategy mostly compliant, two exceptions.** Compliant: readers trust stored full relative paths with escape validation (`segmented_projects.py:231-235`), immutable ids for chapter/segment dirs (`core/segmented_assets.py:16-21`). Exceptions: project directory names use the mutable name slug (`segmented_assets.py:67-90`) with move-on-rename that only warns on failure (`segmented_project_service.py:330-366`) — stranded-directory risk; clone preview filenames embed voice name (`clone.py:592-594`, cosmetic only); `tts_results.audio_path` stores absolute paths while segment audio stores relative (`tts.py:253,297`). | see left |
| D9 | **Timestamp coverage inconsistent**: `updated_at` (with `onupdate`) on 5/10 tables; VoiceProfile, TTSConfig, TTSResultRecord, TranscriptionRecord, SourceDocument have only `created_at`. Service layer also hand-sets `updated_at` alongside `onupdate` (redundant but harmless). | `models/`, e.g. `segmented_project_service.py:617-619` |

### 2.3 Low

- `SegmentedProjectSegment.project_id` is a property with a no-op setter (`segmented_project.py:117-123`) — assignment silently does nothing; legacy footgun.
- `transcription_records.user_id` hardcoded `"default_user"` — dead column in a single-user product.
- `TTSResultRecord.instruction` has a Chinese marketing string as its DB default (`tts_result.py:24`).
- `segmented_projects.source_document` deprecated TEXT column kept with dual-write fallback scattered in `save_project` (`segmented_project_service.py:383-389`).
- JSON column payloads are free-form with no validation; the undocumented `missing` marker lives inside `audio`.
- `emotion` is `SQLEnum` (4 values) in `tts_configs` but free `String` in segments (`segmented_project.py:103`).
- WAL mode is on in the live DB but no code sets `journal_mode` — poor deployment reproducibility.
- Positive note: `system_config` keys are well centralized (`system_config_service.py` constants + `model_config_service.py:27-31` `PROVIDER_KEYS`), no scattered magic strings.

---

## 3. API Contract Layer

Quantified overview: 14 router files, ~95 endpoints; only 24 endpoints declare `response_model`; **57 endpoints hand-return dicts**; `backend/app/schemas/` has only 2 files (role, segmented_project); no response envelope convention; no pagination anywhere.

### 3.1 High

| # | Finding | Evidence |
|---|---------|----------|
| A1 | **`config.py` returns Flask-style tuples for 404 — FastAPI serializes them as `[{"error": ...}, 404]` with status 200.** Frontend `configApi.updateModel/deleteModel/setDefault` can never see a 404. | `api/config.py:98,135,151`, `frontend/src/services/api.ts:253-264` |
| A2 | **`/clone/list-from-qwen` references an undefined `db` — NameError on every call.** Undocumented, unused by frontend; fix or delete. | `api/clone.py:628-633` |
| A3 | **Dead contract: `workflowApi` calls 7 `/projects/{id}/workflow*` endpoints that no longer exist in the backend** (workflow moved to the LangGraph agent; verified no workflow routes under `backend/app/api/`). The full chain: `workflowApi` is referenced only by `components/Workflow/ReviewEditor.tsx` (`:31,46,62`), and `ReviewEditor` itself has no importers — so today it is transitively dead code on both ends; the `WorkflowRun` type family is equally dead. Caveat: if `ReviewEditor` is ever wired back in without restoring the backend routes, it becomes a live 404 bug rather than dead code. | `frontend/src/services/api.ts:785-813`, `frontend/src/types/index.ts:586-654`, `backend/main.py:116-130` |
| A4 | **TTS synthesis response shape differs across all three engines.** VoxCPM returns `id` (not `audio_id`) and no `params` in backend-storage mode, and neither field in frontend-storage mode — but the frontend `TTSResult` type requires both. `tts.py` and `mimo_tts.py` return `audio_id` + `params`. | `api/voxcpm.py:145-151,181-189`, `api/tts.py:138-154`, `api/mimo_tts.py:97-107`, `types/index.ts:193-215` |
| A5 | **Voice upload responses drift from the `VoiceProfile` type**: `/clone/upload` and `/clone/upload-from-url` return a trimmed 5-field dict but are typed `Promise<VoiceProfile>` — required fields are `undefined` at runtime. The same resource has a third shape via `voice_to_dict`. | `api/clone.py:210-216,305-311`, `api.ts:10-28`, `_voice_helpers.py:21-33`, `types/index.ts:14-27` |
| A6 | **`docs/api-reference.md` drift — 4 out of 4 spot checks wrong.** Transcription response fields almost entirely different (`docs/api-reference.md:742-755` vs `speech_to_text.py:171-181`, the documented `segments` timeline does not exist); delete-transcription path wrong (`:730` vs `speech_to_text.py:207`); subtitle-calibration field `original_script` vs actual `original_document` (`:774` vs `subtitle_llm.py:23`); model-config endpoints wrong shape (`:804-805` vs `model_config.py:66-71`); roles section still documents dropped fields `default_engine`/`default_voice` which Pydantic now silently discards (`:843-870` vs `schemas/role.py:8-16`). | see left |

### 3.2 Medium

| # | Finding | Evidence |
|---|---------|----------|
| A7 | **Frontend `TTSRequest.engine` over-promises**: 9 engines allowed in the type, but `/tts/synthesize` only supports `cosyvoice \| edge_tts` and silently routes anything else (e.g. `mimo_preset`) down the CosyVoice path. | `types/index.ts:150-151`, `api/tts.py:29,85-88` |
| A8 | **Error `detail` in three mixed styles**: machine codes (`"project_not_found"`), Chinese sentences (`clone.py:738`), and raw internal exceptions (`tts.py:244,322`, `model_config.py:103`) which leak internals and give the frontend no stable branch key. | see left |
| A9 | **`voice_id` is overloaded**: Qwen cloud id in `TTSRequest` (`tts.py:31`), local `VoiceProfile.id` in clone/mimo/voxcpm (`clone.py:98`, `mimo_tts.py:65`, `voxcpm.py:67`), edge voice name stored into `TTSResultRecord.voice_id` (`tts.py:294`); frontend `VoiceRef.voice_id` comment admits the ambiguity (`types/index.ts:405-406`). | see left |
| A10 | **Fields silently dropped between frontend types and backend schemas**: `SegmentedProject.logo`, `Chapter.selected_segment_id` (absent from `ProjectIn`/`ChapterIn`, lost on PUT); reverse case `ChapterIn.narration_script` survives only via runtime spread; `SegmentAudio.format` required by frontend but absent at audio top level; `TTSConfig.created_at` required by frontend but never returned by `/config/models`; `CorrectionSuggestion.confidence` narrowed on frontend, free `str` on backend. | `types/index.ts:478,492,120,135`, `schemas/segmented_project.py:31,39-54`, `api/config.py:48-61` |
| A11 | **List envelope inconsistency**: bare arrays (`/clone/list`, `/config/models`, `/segmented-projects`, `/roles`) vs wrapped objects (`{"voices": ...}`, `{"results": ...}`, `{"languages": ...}`); no `{items, total}` anywhere. | `clone.py:625`, `config.py:48`, `tts.py:333,441,464`, `speech_to_text.py:204` | ✅ 2026-08-05 — PR #57: all list endpoints return `{items: [...]}`; frontend `api.ts` updated; 545 backend + 366 frontend + 46 e2e tests pass |
| A12 | **Agent → backend contract is untyped**: `backend_client.py` returns raw `r.json()` dicts (`:42-47,110-129,131-141`) and hand-picks fields instead of `model_validate` (`:83-89`) — a backend rename silently becomes `None`. | `agent/app/backend_client.py` | ✅ 2026-08-05 — Added `ProjectResponse` + `ScaffoldRemotionResponse` Pydantic models; `get_project`/`scaffold_remotion` use `model_validate`; callers updated to attribute access. Agent 127✓, backend 548✓, frontend 375✓. |
<<<<<<< HEAD
| A13 | **Binary upload dual-track with no convention**: multipart for upload/transcribe/import; JSON base64 for voiceclone-direct, create-from-design, preview-audio, project migrate — and whole synthesized audio as base64 in JSON responses with no size guard. | `mimo_tts.py:70-76`, `clone.py:119-131,565-567`, `tts.py:131-132`, `voxcpm.py:144` | ✅ 2026-08-06 — Added `validate_base64_field` validator in `schemas/common.py` (1 MB decoded size limit). Applied to `MiMoVoiceCloneDirectRequest`, `DesignVoiceRequest`, `PreviewAudioRequest`, `MigrateAudioItem`. Validation errors return 422 with clean JSON. Validation error handler fixed to serialize `ctx` objects. Backend 548✓. |
=======
| A13 | **Binary upload dual-track with no convention**: multipart for upload/transcribe/import; JSON base64 for voiceclone-direct, create-from-design, preview-audio, project migrate — and whole synthesized audio as base64 in JSON responses with no size guard. | `mimo_tts.py:70-76`, `clone.py:119-131,565-567`, `tts.py:131-132`, `voxcpm.py:144` |
>>>>>>> master

### 3.3 Low

- Large lists unpaginated: `/tts/history` and `/clone/list` return everything; STT history is physically truncated to 10 rows (`speech_to_text.py:62-74`) — destructive truncation, not pagination.
- Validation mixes hand-written `if`s with Pydantic; unsupported extensions in multi-transcribe are silently coerced to mp3 instead of 400 (`speech_to_text.py:282-284`); `format` params have no enum constraint; `SegmentIn.voice`/`generated_params`/`audio` are free `dict[str, Any]`.
- Per-segment synthesis returns the entire `ProjectDetail` tree (`segmented_projects.py:97-125`) — bandwidth waste and coupling.
- Positive note: no DB models are returned directly; sensitive model-config fields are masked (`model_config.py:42-47`); `subtitle_llm` returns only `has_api_key`.
- snake_case is consistent on the wire; camelCase is mapped explicitly in `api.ts` (e.g. `api.ts:488-489`); minor inconsistency `filename` vs `original_filename` in STT responses.
- Frontend `TranscribeResult.download_url` is required but backend returns `None` in frontend-storage mode (`speech_to_text.py:180`).

---

## 4. Remediation Roadmap

Ordered by priority; each phase is independently shippable.

### P0 — Live data-loss bugs and broken endpoints

1. Fix D2: rewrite `mimo_tts.py:136-137` to update `seg.audio` via `update_segment_after_synth`.
2. Fix D3: convert the 5 JSON mutate-then-reassign sites to `deepcopy` or fresh-dict construction; consider `MutableDict.as_mutable(JSON)` globally plus a regression test.
3. Fix A1 (three tuple returns → `raise HTTPException(404)`) and A2 (delete or fix `/clone/list-from-qwen`).
4. Delete the dead `workflowApi` + `WorkflowRun` types (A3).

### P1 — Integrity and contract guardrails

5. Enable `PRAGMA foreign_keys=ON` via engine connect event; clean up dangling role references in `delete_role` (D1).
6. Fix `_drop_columns_via_recreate` to preserve PK/NOT NULL/DEFAULT/FK, and run a one-time constraint-repair migration for the three `segmented_*` tables that lost their PKs (D4).
7. Add `response_model` to the 57 untyped endpoints, prioritizing clone/tts/voxcpm/mimo_tts — this also resolves A4/A5; unify the TTS synthesis response shape (`audio_id`/`params`).
8. Align frontend types with backend schemas (A10); add `extra="forbid"` to `RoleIn`/`ChapterIn`/`ProjectIn` to prevent silent field drops; narrow frontend `TTSRequest.engine` (A7).

### P2 — Cleanup and consistency

9. Drop zombie table `narration_documents` and the 5 zombie columns (D5); add indexes on `chapters.project_id` / `segments.chapter_id` and a `(chapter_id, position)` unique constraint (D6).
10. Unify error contract to `{code, message}` (A8) ✅; disambiguate `voice_id` naming (A9) ✅ 2026-08-04; unify list envelopes and add pagination to history endpoints (A11).
11. Agent client: parse responses with `model_validate` (A12); unify binary upload convention — multipart for large files, size-checked base64 only for small previews (A13).

### P3 — Migrations and docs

12. Introduce Alembic (or at minimum a version table); freeze the P2–P17/P9000 ALTER chain as the baseline (D4).
13. Correct `docs/database-schema.md` (D6/D7: roles.project_id, voice_profiles FK, fabricated indexes, migration mechanism) and rewrite the four broken sections of `docs/api-reference.md` (A6); add the audit-driven rule that both docs are updated by every PR touching models or routes.
14. Standardize path bases (relative paths for `tts_results.audio_path`), timestamp coverage, and remove low-severity legacy columns (D8/D9, §2.3).

---

## 5. Caveats

D1/D4/D5 were verified against the live dev database; the rest is static review.
P0 items D2/D3/A1 are actively losing or corrupting data today and should land first.
After P0/P1, run `cd backend && uv run --extra test pytest -q` and the e2e suite to cover the changed paths.

---

## 6. Fix Progress

Legend: ⬜ pending · 🔄 in progress · ✅ done (date + verifying test)

| Item | Finding | Fix | Status |
|---|---|---|---|
| B-P0-1 | D2 mimo_tts writes dropped columns | Route through `update_segment_after_synth` | ✅ 2026-07-28 — `test_segmented_synthesis.py::test_mimo_save_and_respond_persists_segment_audio` |
| B-P0-2 | D3 5 JSON mutate-then-reassign sites | `deepcopy` / fresh-dict + regression tests | ✅ 2026-07-28 — `test_json_column_dirty.py` (6 tests; also fixed a latent seg-None 500→404 ordering bug in the audio endpoint) |
| B-P0-3 | A1 config.py tuple 404 returns | `raise HTTPException(404)` | ✅ 2026-07-28 — `test_config_models_api.py` (3 tests) |
| B-P0-4 | A2 `/clone/list-from-qwen` NameError | Inject `db` dependency | ✅ 2026-07-28 — `test_clone_list_from_qwen.py` |
| B-P1-1 | D1 FK pragma never enabled + dangling role refs | `PRAGMA foreign_keys=ON` on connect; explicit cleanup in `delete_role` (segment role_id, project default narrator, voice JSON role refs); `create_role` normalizes `__scratchpad__` project_id -> NULL (global) so scratchpad-context roles don't violate the now-enforced FK | ✅ 2026-07-28 - `test_role_delete_cleanup.py` (3 tests); dialogue-prosody e2e green |
| B-P1-2 | D4 `_drop_columns_via_recreate` loses PK/NOT NULL/DEFAULT + no version table | Recreate preserves constraints; P9006 `_repair_lost_constraints` rebuilds damaged tables from the model (also drops zombie columns) | ✅ 2026-07-28 - `test_table_recreate_constraints.py` |
| B-P1-3 | Legacy ALTER groups re-add zombie columns each startup (ping-pong with P9006) | `_ALL_ALTER_STMTS` aggregate; removed obsolete P6/P10 + P11 `source_audio_path` zombie-adding ALTERs; P9004 dynamic SELECT guards missing legacy cols; `_run_migrations` iterates the aggregate | ✅ 2026-07-28 - `test_migration_idempotency.py` (2 tests); real dev DB inits clean |
| B-P1-4 | A4 VoxCPM synth response shape drifts (`id` not `audio_id`, no `params`) | VoxCPM `_save_and_respond` now returns `audio_id` + `params` in both storage modes, matching tts.py/mimo_tts.py | ✅ 2026-07-28 - aligns with frontend `TTSResult` type |
| B-P1-5 | A10 `SegmentedProject.logo` lost on PUT (frontend-only) | New `logo` column + P18 migration; `ProjectIn.logo` + get/save round-trip | ✅ 2026-07-28 - `test_project_logo_persists_across_save_and_get` |
| B-P1-6 | A7 `TTSRequest.engine` over-promises (9 engines, only cosyvoice/edge_tts) | Narrowed frontend type to `'cosyvoice' \| 'edge_tts'` | ✅ 2026-07-28 - `tsc -b` clean |
| B-P1-7 | e2e DB accumulates orphan roles/voice_profiles (project_id referencing deleted/scratchpad projects) | `init_db` e2e-mode cleanup nulls dangling segment.role_id and deletes orphan roles/voice_profiles; guarded by `app_env=='e2e'` so prod is untouched | ✅ 2026-07-28 - e2e 43 green |
| B-P1-8a | A5 `/clone/upload` + `/clone/upload-from-url` returned trimmed 5-field dicts typed as `VoiceProfile` (runtime `undefined` fields) | New `schemas/voice_profile.py` (`VoiceProfileOut` matching `voice_to_dict`); both endpoints now return `voice_to_dict(voice)`; `response_model=VoiceProfileOut` added to upload/upload-from-url/create-clone/create-clone-mimo/create-clone-voxcpm/create-from-design/get/list; frontend `VoiceClone.tsx` uses `voiceSourceAudioUrl(id)` instead of the removed `audio_url` | ✅ 2026-08-03 - `test_api_clone.py` (4) + `test_clone_api.py::test_upload_voice_success` updated; e2e 45 green |
| B-P1-8b | A4 TTS synthesize response shape across tts/mimo/voxcpm now has a typed contract | New `schemas/tts.py` (`TTSResultOut`: audio_id+text+params required, optional audio_base64/audio_url/audio_format/voice_id/voice_name/engine; `TTSResultRecordOut`+`TTSHistoryOut` for history); `response_model=TTSResultOut` on /synthesize + /preset /voicedesign /voiceclone /voiceclone-direct + /tts /design /clone /ultimate-clone; `/history` -> `TTSHistoryOut`. Wire shape now always serializes schema fields (null when unset) | ✅ 2026-08-03 - `test_tts_api.py` contract tests (2); backend 508✓, e2e 45✓ |
| A8 | Error `detail` in three mixed styles (machine codes / English sentences / raw `str(e)` leaks) — no stable `code` for frontend branching | Custom `HTTPException` handler in `main.py`: wraps ALL HTTPException responses in `{code, message}`. Machine codes (snake_case, e.g. `project_not_found`) → `code == message`; non-machine details (sentences, exceptions) → `code = "http_{status}"`, `message = original string`. Already-structured dicts with `code` pass through. Frontend `getErrorDetail` helpers updated to read `.message` from object detail. | ✅ 2026-08-04 - `test_main_error_contract.py` (4: machine code / sentence / passthrough / health unaffected); updated 5 existing test files (`detail` → `code`/`message`); frontend tsc+lint✓, e2e 45✓ |
| D6 | Missing indexes + no unique constraint on (parent_id, position) | `UniqueConstraint(project_id, position)` on chapters + `UniqueConstraint(chapter_id, position)` on segments; FK indexes on `chapters.project_id` + `segments.chapter_id`; P9007 migration deduplicates existing duplicate positions before creating the unique indexes; `save_project` uses two-phase position update (sentinel values then final) to support swap reorders under the constraint | ✅ 2026-08-03 - `test_segmented_projects_service.py` (2 constraint tests) + `test_migration_idempotency.py` (2 P9007 tests); backend 516✓ |
| D5a | Zombie table `narration_documents` (0 code refs, 0 rows, FK to nonexistent `segmented_projects_old`) | P9008 `DROP TABLE narration_documents` | ✅ 2026-08-03 - `test_migration_idempotency.py` (2 P9008 tests); backend 517✓ |
| D5b | Zombie columns in `voice_profiles` (`engine`, `engine_params`, `source_audio_path`, `cloned_preview_path`) + `segmented_projects.default_narrator_snapshot` | Already removed by P9004 (`_migrate_voice_profile`) + P9006 (`_repair_lost_constraints`) migrations (covered by B-P1-2 + B-P1-3); verified against dev+e2e DBs 2026-08-04 | ✅ already done by B-P1-2/B-P1-3 (2026-07-28) |
| A9 | `voice_id` overloaded: Qwen cloud id in `TTSRequest`, local `VoiceProfile.id` in clone/mimo/voxcpm, edge voice name in `TTSResultRecord` | Renamed `voice_id` → `profile_id` in `RegisterRequest`, `MiMoVoiceCloneRequest`, `VoxCPMCloneRequest`, `VoxCPMUltimateCloneRequest` (4 schemas) + all `request.voice_id` → `request.profile_id` in backend clone/mimo/voxcpm endpoints; frontend `api.ts` clone calls send `profile_id`; `TTSRequest.voice_id` (CosyVoice cloud ID), `TTSResultRecord.voice_id` (context-dependent), `EngineParams.voice_id` (generic) left unchanged. URL path `/{voice_id}` unchanged (REST convention). | ✅ 2026-08-04 - integration `test_clone_api.py` (27); backend 536✓, frontend 364✓, e2e 46✓ |

**Deferred (large / risky, separate PRs):**
- B-P1-8 `response_model` on the remaining untyped endpoints (config/model_config/speech_to_text/text_split/sources/clone non-voice + list-envelope unification A11 + qwen/preview-audio/update-description) - large mechanical change; clone voice (B-P1-8a) + TTS engines (B-P1-8b) done. Remaining needs config/STT/etc. schemas created first.
- B-P1-9 `extra="forbid"` on `RoleIn`/`ChapterIn`/`ProjectIn` — **deferred due to risk/benefit mismatch**. No current bug (`extra="ignore"` silently drops extra fields, which is safe). Coordinating the whitelist is high-effort: `ProjectIn` must preserve `original_text`/`animation_theme` (runtime fields from GET, not in TS types, needed by `save_project`); `ChapterIn` must drop `selected_segment_id`; `SegmentIn` must drop `status`/`error`/`locked_params`; `RoleIn` must drop deprecated V3 fields. Migration wildcard: IndexedDB projects may carry stale V1/V2 segment fields. Touches the autosave hot path (data loss risk). Deferred until the remaining B-P1-8 work reduces the coordination scope.

After P0/P1 + D6, the backend suite is **516 passed** and the e2e suite is **45 passed** (2026-08-03).
