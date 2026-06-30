# Database Schema Documentation

**Project:** NarraForge
**ORM:** SQLAlchemy (declarative base)
**Updated:** 2026-06-30 (schema v3 — data model refactor)

---

## Overview

The database consists of **10 tables** and **2 enums**.

| Table | Purpose |
|---|---|
| `voice_profiles` | Stored voice profiles for cloning |
| `tts_configs` | TTS configuration presets |
| `tts_results` | Historical TTS synthesis results |
| `transcription_records` | Audio transcription history |
| `system_configs` | Global key-value system settings |
| `roles` | Global role/character definitions |
| `segmented_projects` | Segmented TTS project containers |
| `segmented_project_chapters` | Chapters within a segmented project |
| `segmented_project_segments` | Individual text segments within a chapter |
| `source_documents` | Project-level source files (text/audio/path) |

---

## Enums

### `ModelProvider`

| Value | Description |
|---|---|
| `qwen` | Qwen TTS (default) |
| `azure` | Azure TTS |
| `openai` | OpenAI TTS |
| `mimo` | MiMo TTS |

### `Emotion`

Used across the application for segment emotion tagging. The `tts_configs.emotion` column uses this as a SQLAlchemy enum; segment-level emotion is stored as a plain string.

| Value | Description |
|---|---|
| `happy` | Happy / positive |
| `sad` | Heavy / sorrowful |
| `angry` | Angry / intense |
| `calm` | Calm / serene |
| `neutral` | Neutral (default) |
| `excited` | Excited / passionate |

---

## Table: `voice_profiles`

Stores voice profiles used for voice cloning workflows.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | String | No | UUID4 | **Primary Key** |
| `name` | String | No | — | Voice profile name |
| `source_audio_path` | String | Yes | `NULL` | Source audio file for cloning |
| `cloned_preview_path` | String | Yes | `NULL` | Post-cloning preview audio |
| `description` | String | Yes | `NULL` | User-defined voice description |
| `avatar` | String | Yes | `NULL` | Avatar data URL or external URL |
| `project_id` | String | Yes | `NULL` | **FK** -> `segmented_projects.id` (SET NULL). NULL = global voice |
| `engine` | JSON | No | `{}` | Engine config: `{type, external_audio_url?, is_cloned?, ...}` |
| `engine_params` | JSON | Yes | `NULL` | Engine-specific legacy params (deprecated, use `engine`) |
| `created_at` | DateTime | Yes | `utcnow` | Record creation timestamp |

---

## Table: `tts_configs`

TTS configuration presets with provider and audio parameters.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | String | No | UUID4 | **Primary Key** |
| `name` | String | No | — | Configuration name |
| `provider` | Enum(ModelProvider) | Yes | `qwen` | TTS model provider |
| `model_name` | String | Yes | `"qwen-tts"` | Model identifier |
| `speed` | Float | Yes | `1.0` | Playback speed (0.5–2.0) |
| `volume` | Float | Yes | `80` | Volume level (0–100) |
| `pitch` | Float | Yes | `1.0` | Pitch ratio (0.5–2.0) |
| `emotion` | Enum(Emotion) | Yes | `neutral` | Emotion setting |
| `is_default` | Boolean | Yes | `False` | Whether this is the default config |
| `created_at` | DateTime | Yes | `utcnow` | Record creation timestamp |

---

## Table: `tts_results`

Historical record of all TTS synthesis operations.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | String | No | UUID4 | **Primary Key** |
| `text` | String | No | — | Input text for synthesis |
| `voice_id` | String | No | — | Voice identifier used |
| `voice_name` | String | Yes | `NULL` | Display name of voice |
| `audio_path` | String | No | — | Generated audio file path |
| `audio_format` | String | Yes | `"wav"` | Audio file format |
| `speed` | Float | Yes | `1.0` | Synthesis speed |
| `volume` | Float | Yes | `80` | Volume level |
| `pitch` | Float | Yes | `1.0` | Pitch ratio (0.5–2.0) |
| `instruction` | String | Yes | *(Chinese default)* | TTS instruction/prompt |
| `language` | String | Yes | `"Chinese"` | Language setting |
| `source` | String | Yes | `NULL` | Origin: `NULL`/`""` = TTS history, `"segmented_tts"` = editor |
| `created_at` | DateTime | Yes | `utcnow` | Record creation timestamp |

---

## Table: `transcription_records`

Audio transcription history and metadata.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | String | No | UUID4 | **Primary Key** |
| `user_id` | String | No | `"default_user"` | User identifier |
| `original_filename` | String | No | — | Original uploaded filename |
| `audio_path` | String | No | — | Stored audio file path |
| `srt_file_id` | String | No | — | Associated SRT subtitle file ID |
| `language` | String | Yes | `NULL` | Detected language |
| `language_probability` | Float | Yes | `0.0` | Language detection confidence |
| `model_size` | String | Yes | `"large-v3"` | Whisper model size used |
| `created_at` | DateTime | Yes | `utcnow` | Record creation timestamp |

---

## Table: `system_configs`

Global key-value store for persistent system-wide settings.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `key` | String | No | — | **Primary Key** (string key) |
| `value` | String | No | — | Configuration value |
| `updated_at` | DateTime | Yes | `utcnow` | Last update timestamp (auto-updates) |

---

## Table: `roles`

Global role/character definitions. Each role has a voice config used as default for assigned segments.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | String | No | — | **Primary Key** |
| `name` | String | No | — | Role name |
| `avatar` | String | Yes | `NULL` | Avatar URL |
| `description` | String | Yes | `NULL` | Role description |
| `role_kind` | String | No | `"cast"` | `narrator` / `cast` |
| `voice` | JSON | No | `{"engine":"edge_tts","params":{}}` | EngineParams JSON |
| `favorite_styles` | JSON | No | `[]` | Favorite style presets |
| `created_at` | DateTime | Yes | `utcnow` | Record creation |
| `updated_at` | DateTime | Yes | `utcnow` | Last update |

---

## Table: `segmented_projects`

Segmented TTS project containers (three-tier: project -> chapter -> segment).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | String | No | — | **Primary Key** |
| `name` | String | No | — | Project name |
| `schema_version` | Integer | No | `2` | Internal schema version |
| `layout` | String | No | `"vertical"` | UI layout mode |
| `active_chapter_id` | String | Yes | `NULL` | Currently active chapter |
| `original_text` | String | Yes | `NULL` | Original input text |
| `animation_theme` | String | Yes | `NULL` | Global animation theme (e.g. `dark-botanical`) |
| `remotion_project_path` | String | Yes | `NULL` | Associated Remotion project path |
| `source_document` | Text | Yes | `NULL` | Source document markdown content |
| `default_narrator_role_id` | String | Yes | `NULL` | **FK** -> `roles.id` (SET NULL). Default narrator role |
| `default_narrator_snapshot` | JSON | Yes | `NULL` | Snapshot of narrator role for reproducibility |
| `configs` | JSON | Yes | `NULL` | Project-level configuration (split_voice_mode, etc.) |
| `created_at` | DateTime | Yes | `utcnow` | Record creation timestamp |
| `updated_at` | DateTime | Yes | `utcnow` | Last update timestamp (auto-updates) |

---

## Table: `segmented_project_chapters`

Chapters within a segmented project. Each chapter groups segments with optional TTS defaults.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | String | No | — | **Primary Key** |
| `project_id` | String | No | — | **FK** -> `segmented_projects.id` (CASCADE delete) |
| `position` | Integer | No | — | Ordering position within project |
| `name` | String | No | — | Chapter name |
| `engine` | String | Yes | `NULL` | TTS engine override |
| `default_params` | JSON | No | `{}` | Default TTS parameters for this chapter |
| `split_config` | JSON | No | `{}` | Text splitting configuration |
| `original_text` | String | Yes | `NULL` | Chapter-level original text |
| `design_title` | String | Yes | `NULL` | Design/display title |
| `created_at` | DateTime | Yes | `utcnow` | Record creation timestamp |
| `updated_at` | DateTime | Yes | `utcnow` | Last update timestamp (auto-updates) |

---

## Table: `segmented_project_segments`

Individual text segments within a chapter. Each segment holds text, role, voice config, and generated audio state.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | String | No | — | **Primary Key** |
| `chapter_id` | String | No | — | **FK** -> `segmented_project_chapters.id` (CASCADE) |
| `position` | Integer | No | — | Order within chapter |
| `text` | String | No | `""` | Segment text |
| `emotion` | String | Yes | `NULL` | Emotion tag |
| `role_id` | String | Yes | `NULL` | **FK** -> `roles.id` (SET NULL) |
| `segment_kind` | String | No | `"narration"` | `narration` / `dialogue` |
| `voice` | JSON | No | `{"source":"chapter"}` | VoiceSource: `{source, role_id?, engine?, params?}` |
| `generated_params` | JSON | Yes | `NULL` | EngineParams snapshot at generation time (for stale detection) |
| `audio` | JSON | Yes | `NULL` | Audio state: `{current, previous, format, duration_sec}` |
| `generated_at` | DateTime | Yes | `NULL` | Last generation timestamp |
| `animation_spec_json` | Text | Yes | `NULL` | Animation spec |
| `created_at` | DateTime | Yes | `utcnow` | Record creation |
| `updated_at` | DateTime | Yes | `utcnow` | Last update (auto) |

### `voice` JSON structure

```json
{"source": "chapter"}
{"source": "role", "role_id": "role_xm"}
{"source": "custom", "engine": "mimo_tts", "params": {"instruction": "急促"}}
```

### `audio` JSON structure

```json
{
  "current": {"id": "idx_a", "path": "/project/ch1/seg.wav"},
  "previous": {"id": "idx_old"},
  "format": "wav",
  "duration_sec": 2.3
}
```

---

## Table: `source_documents`

Project-level source files. Each record represents one input source (pasted text, uploaded audio, or file path reference).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | String | No | — | **Primary Key** |
| `project_id` | String | No | — | **FK** -> `segmented_projects.id` (CASCADE delete). Indexed |
| `source_type` | String | No | — | Source type: `paste` / `audio` / `path` |
| `title` | String | No | — | Display title |
| `file_path` | String | Yes | `NULL` | File path reference |
| `pasted_text` | Text | Yes | `NULL` | Pasted text content |
| `audio_path` | String | Yes | `NULL` | Audio file path |
| `file_size` | Integer | Yes | `NULL` | File size in bytes |
| `duration_sec` | Float | Yes | `NULL` | Audio duration in seconds |
| `created_at` | DateTime | No | `utcnow` | Record creation timestamp |

---

## Relationships

```
Role  1 ──── ∞  SegmentedProject          (via default_narrator_role_id, SET NULL; roles.voice is EngineParams JSON)
Role  1 ──── ∞  SegmentedProjectSegment   (via role_id, SET NULL)

SegmentedProject  1 ──── ∞  SegmentedProjectChapter     (CASCADE delete)
SegmentedProject  1 ──── ∞  SourceDocument               (CASCADE delete)

SegmentedProjectChapter  1 ──── ∞  SegmentedProjectSegment  (CASCADE delete)
```

Tables `voice_profiles`, `tts_configs`, `tts_results`, `transcription_records`, and `system_configs` are not linked by foreign keys. They are connected conceptually by `voice_id` references in application logic.

---

## Indexes

| Table | Indexed Columns | Type |
|---|---|---|
| `voice_profiles` | `id` | Primary Key |
| `tts_configs` | `id` | Primary Key |
| `tts_results` | `id` | Primary Key |
| `transcription_records` | `id` | Primary Key |
| `system_configs` | `key` | Primary Key |
| `roles` | `id` | Primary Key |
| `segmented_projects` | `id` | Primary Key |
| `segmented_project_chapters` | `id` | Primary Key |
| `segmented_project_chapters` | `project_id` | FK (auto-indexed) |
| `segmented_project_segments` | `id` | Primary Key |
| `segmented_project_segments` | `chapter_id` | FK (auto-indexed) |
| `segmented_project_segments` | `project_id` | FK (auto-indexed) |
| `source_documents` | `id` | Primary Key |
| `source_documents` | `project_id` | Explicit index |

---

## Notes

- All primary keys are UUID strings (generated via `uuid.uuid4()`) except `system_configs` which uses a human-readable string key.
- Timestamps use `datetime.utcnow` (via `app.core.time_utils.utcnow`) and are not timezone-aware.
- `tts_results.instruction` has a Chinese-language default value describing an energetic advertising voiceover style.
- The segmented project models use a three-tier hierarchy: `project -> chapter -> segment`. Segments carry a denormalized `project_id` for direct querying.
- `voice_profiles.project_id` allows project-scoped voices (NULL = global). `segments.role_id` and `projects.default_narrator_role_id` reference the global `roles` table.
- `voice_profiles.engine_params` is a JSON column that stores engine-specific parameters. Common keys include `input_method` (`record`/`upload`/`url`) for clone voices, and engine-specific TTS parameters (speed, volume, pitch, etc.).
