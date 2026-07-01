# Data Model Unification Plan

**Status:** In Progress
**Date:** 2026-07-01

## Problem

The database and API carry multiple parallel representations of TTS voice parameters:

| Location | Format | Example |
|----------|--------|---------|
| `roles.voice` | EngineParams (discriminated union) | `{ engine: "mimo_tts", mode: "preset", voice_id: "冰糖" }` |
| `chapters.default_params` | SegmentEngineParams (flat kitchen sink) | `{ engine: "edge_tts", edge_voice: "...", mimo_mode: "preset", ... }` |
| Chapter top-level (`ch.engine`, `ch.edge_voice`, ...) | extracted from `default_params` by service layer | flat scalars |
| `segments.voice.params` (custom) | SegmentEngineParams (flat) | same kitchen sink as chapters |
| `segments.generated_params` | SegmentEngineParams (flat) | same |
| `voice_to_dict` API | `voices_engine` wrapper + deprecated `clone_engine` | two redundant representations |

Additionally, `default_narrator_snapshot` is a dead field (roundtripped but never read for decision-making).

## Goal

One canonical voice parameter format across all tables and API responses: **EngineParams discriminated union**.

```
EngineParams =
  | { engine: "edge_tts"; voice: string; rate: string; volume: string }
  | { engine: "cosyvoice"; voice_id: string; speed?: number; volume?: number; pitch?: number; language?: string; instruction?: string }
  | { engine: "mimo_tts"; mode: "preset" | "voiceclone" | "voicedesign"; voice_id: string; instruction?: string; voice_description?: string }
  | { engine: "voxcpm"; mode: "tts" | "design" | "clone" | "ultimate"; voice_id?: string; ... }
```

## Migration Strategy

**No backward compatibility.** This is a new product with no legacy users. All migrations are direct, breaking changes. No dual-format API, no Pydantic transition validators. Old format is replaced in-place.

All migrations use SQLite-safe approaches (table recreate for column drops, `json_extract` for data migration).

## Phases

### Phase 1 — Remove dead field

**`default_narrator_snapshot`** on `segmented_projects`

- Remove from SQLAlchemy model
- Remove from Pydantic schema
- Drop column via migration (SQLite: table recreate)
- Remove from frontend types, reducer, tests

**Impact:** None. Field is stored and roundtripped but never read for any decision.

---

### Phase 2 — Unify chapter voice params

**Current:** Two separate sources:
1. `chapters.default_params` (SegmentEngineParams JSON — kitchen sink of all engines' fields)
2. Chapter top-level meta (`ch.engine`, `ch.voice_id`, `ch.edge_voice`, `ch.edge_rate`, ...) — extracted from `default_params` by `_extract_chapter_meta()`

**Target:** Single `chapters.voice` column of type `EngineParams`.

**Backend:**
- Add `voice = Column(JSON)` to chapter model
- Migration: build EngineParams from existing `default_params` (read `engine` → pick the right sub-object)
- Remove `default_params` column and top-level meta columns (`engine`, `voice_id`, `edge_voice`, `edge_rate`, `edge_volume`, `mimo_mode`, ...)
- Update `_extract_chapter_meta()` → `_chapter_voice_to_api()` returning `EngineParams` directly
- Update `_merge_params(chapter.voice, role_params, request_params)`

**Frontend:**
- `Chapter` type: remove top-level meta fields, add `voice: EngineParams`
- `buildCurrentParams()` → read from `activeChapter.voice` instead of building from scattered state
- `makeSegment()` → accept `EngineParams` instead of `SegmentEngineParams`
- Update all test fixtures

**Impact:** Removes `roleVoiceToFlatParams` conversion altogether. Single source of truth.

---

### Phase 3 — Unify segment custom voice params

**Current:** `segments.voice.params` stores SegmentEngineParams (flat kitchen sink)

**Target:** Store `EngineParams` directly.

**Backend:**
- Migration: convert existing `voice.params` JSON to EngineParams format
- Update `GENERATE_SUCCESS` handler

**Frontend:**
- `segEffectiveParams()` → return EngineParams instead of flat Record
- `handleRegenerate()` → no longer need `roleVoiceToFlatParams`
- `handleConfirmCustom()` → simpler merge

---

### Phase 4 — Simplify API voice_to_dict + remove all compat types

> Merged from original Phase 4 + Phase 5. No backward compat needed.

**Backend `voice_to_dict`:**
- Remove `_build_voices_engine()` helper entirely
- Return `engine` JSON directly as `engine` field
- Drop all exploded fields: `voices_engine`, `clone_engine`, `qwen_voice_id`, `is_cloned`, `cloned_at`, `prompt_text`, `role`

```diff
- "voices_engine": { "type": "qwen", "engine": {...} },
- "clone_engine": null,
- "qwen_voice_id": "...",
- "is_cloned": false,
- "cloned_at": null,
- "prompt_text": null,
- "role": "custom",
+ "engine": { "type": "qwen", "qwen_voice_id": "...", "is_cloned": true, "cloned_at": "..." }
```

**Frontend — delete all compat types and fields:**
- Delete `SegmentEngineParams` type
- Delete `VoicesEngine` type
- Delete deprecated fields on `VoiceProfile` (`voices_engine`, `clone_engine`, `qwen_voice_id`, `is_cloned`, `cloned_at`, `prompt_text`, `role`)
- Delete deprecated fields on `Chapter` (all top-level engine meta — replaced by `voice: EngineParams`)
- Delete deprecated fields on `Segment` (`generated_params`, `overrides`, `params`, `voice_ref`, `current_audio_id`, etc.)
- Delete `segmentShims.ts` compat accessors (`segParams`, `segEngine`, etc. — replaced by direct `EngineParams` access)
- Update all frontend code that referenced deleted fields/types

---

## Affected Code

| Phase | Backend | Frontend | Tests |
|-------|---------|----------|-------|
| 1 | `database.py`, `segmented_project.py`, schema, service | types, useSegmentedProject | ~10 test files |
| 2 | model, schema, service, `_voice_helpers.py` | types, TTSSynthesis, useSegmentedProject, segmentShims | ~15 test files |
| 3 | model, TTS synthesis | types, segmentShims, TTSSynthesis | ~5 test files |
| 4 | `_voice_helpers.py` | types, SegmentEditPanel, ProjectVoices, segmentShims | ~15 test files |

## Estimated Scope

- **Total LOC changed:** ~1500–2000
- **Phases:** 4 PRs (Phase 4+5 merged)
- **Risk:** Medium (format migration affects all TTS synthesis paths)
- **Verification:** TDD per phase + Playwright e2e at completion
# Data Model Unification Plan

**Status:** Proposed
**Date:** 2026-07-01

## Problem

The database and API carry multiple parallel representations of TTS voice parameters:

| Location | Format | Example |
|----------|--------|---------|
| `roles.voice` | EngineParams (discriminated union) | `{ engine: "mimo_tts", mode: "preset", voice_id: "冰糖" }` |
| `chapters.default_params` | SegmentEngineParams (flat kitchen sink) | `{ engine: "edge_tts", edge_voice: "...", mimo_mode: "preset", ... }` |
| Chapter top-level (`ch.engine`, `ch.edge_voice`, ...) | extracted from `default_params` by service layer | flat scalars |
| `segments.voice.params` (custom) | SegmentEngineParams (flat) | same kitchen sink as chapters |
| `segments.generated_params` | SegmentEngineParams (flat) | same |
| `voice_to_dict` API | `voices_engine` wrapper + deprecated `clone_engine` | two redundant representations |

Additionally, `default_narrator_snapshot` is a dead field (roundtripped but never read for decision-making).

## Goal

One canonical voice parameter format across all tables and API responses: **EngineParams discriminated union**.

```
EngineParams =
  | { engine: "edge_tts"; voice: string; rate: string; volume: string }
  | { engine: "cosyvoice"; voice_id: string; speed?: number; volume?: number; pitch?: number; language?: string; instruction?: string }
  | { engine: "mimo_tts"; mode: "preset" | "voiceclone" | "voicedesign"; voice_id: string; instruction?: string; voice_description?: string }
  | { engine: "voxcpm"; mode: "tts" | "design" | "clone" | "ultimate"; voice_id?: string; ... }
```

## Phases

### Phase 1 — Remove dead field

**`default_narrator_snapshot`** on `segmented_projects`

- Remove from SQLAlchemy model
- Remove from Pydantic schema
- Drop column via migration (SQLite: table recreate)
- Remove from frontend types, reducer, tests

**Impact:** None. Field is stored and roundtripped but never read for any decision.

---

### Phase 2 — Unify chapter voice params

**Current:** Two separate sources:
1. `chapters.default_params` (SegmentEngineParams JSON — kitchen sink of all engines' fields)
2. Chapter top-level meta (`ch.engine`, `ch.voice_id`, `ch.edge_voice`, `ch.edge_rate`, ...) — extracted from `default_params` by `_extract_chapter_meta()`

**Target:** Single `chapters.voice` column of type `EngineParams`.

**Backend:**
- Add `voice = Column(JSON)` to chapter model
- Migration: build EngineParams from existing `default_params` (read `engine` → pick the right sub-object)
- Remove `default_params` column and top-level meta columns (`engine`, `voice_id`, `edge_voice`, `edge_rate`, `edge_volume`, `mimo_mode`, ...)
- Update `_extract_chapter_meta()` → `_chapter_voice_to_api()` returning `EngineParams` directly
- Update `_merge_params(chapter.voice, role_params, request_params)`

**Frontend:**
- `Chapter` type: remove top-level meta fields, add `voice: EngineParams`
- `buildCurrentParams()` → read from `activeChapter.voice` instead of building from scattered state
- `makeSegment()` → accept `EngineParams` instead of `SegmentEngineParams`
- Update all test fixtures

**Impact:** Removes `roleVoiceToFlatParams` conversion altogether. Single source of truth.

---

### Phase 3 — Unify segment custom voice params

**Current:** `segments.voice.params` stores SegmentEngineParams (flat kitchen sink)

**Target:** Store `EngineParams` directly.

**Backend:**
- Migration: convert existing `voice.params` JSON to EngineParams format
- Update `GENERATE_SUCCESS` handler

**Frontend:**
- `segEffectiveParams()` → return EngineParams instead of flat Record
- `handleRegenerate()` → no longer need `roleVoiceToFlatParams`
- `handleConfirmCustom()` → simpler merge

---

### Phase 4 — Simplify API voice_to_dict

**Current:** Returns `voices_engine` wrapper + deprecated `clone_engine` + `qwen_voice_id` top-level

**Target:** Return `engine: VoiceProfileEngine` directly.

```diff
- "voices_engine": { "type": "qwen", "engine": {...} },
- "clone_engine": null,
- "qwen_voice_id": "...",
+ "engine": { "type": "qwen", "qwen_voice_id": "...", "is_cloned": true, "cloned_at": "..." }
```

**Frontend:** Replace all `v.voices_engine?.type` with `v.engine?.type`.

---

### Phase 5 — Remove dead compat types

After all phases complete, remove from `frontend/src/types/index.ts`:
- `SegmentEngineParams`
- `VoicesEngine`
- Deprecated fields on `VoiceProfile` (`voices_engine`, `clone_engine`, `qwen_voice_id`, `is_cloned`, `cloned_at`, `prompt_text`, `role`)
- Deprecated fields on `Chapter` (all top-level engine meta — replaced by `voice: EngineParams`)
- Deprecated fields on `Segment` (`generated_params`, `overrides`)

---

## Migration Strategy

All migrations use SQLite-safe approaches (table recreate for column drops, `json_extract` for data migration).

**Backward compatibility:** Each phase is independently deployable. Old frontend reads old format, new frontend reads new format. API can support both formats during transition via Pydantic validators.

## Affected Code

| Phase | Backend | Frontend | Tests |
|-------|---------|----------|-------|
| 1 | `database.py`, `segmented_project.py`, schema, service | types, useSegmentedProject | ~10 test files |
| 2 | model, schema, service, `_voice_helpers.py` | types, TTSSynthesis, useSegmentedProject, segmentShims | ~15 test files |
| 3 | model, TTS synthesis | types, segmentShims, TTSSynthesis | ~5 test files |
| 4 | `_voice_helpers.py` | types, SegmentEditPanel, ProjectVoices | ~5 test files |
| 5 | — | types | ~10 test files |

## Estimated Scope

- **Total LOC changed:** ~800–1200
- **Phases:** 5 independent PRs
- **Risk:** Medium (format migration affects all TTS synthesis paths)
