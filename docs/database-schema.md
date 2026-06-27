# Database Schema Documentation

**Project:** NarraForge
**ORM:** SQLAlchemy (declarative base)
**Generated:** 2026-06-26

---

## Overview

The database consists of **11 tables** and **2 enums**.

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
| `narration_documents` | LLM-generated narration documents (multi-version) |

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
| `audio_path` | String | No | — | Local audio file path |
| `external_audio_url` | String | Yes | `NULL` | Cloud storage URL (Qiniu/AWS S3) |
| `qwen_voice_id` | String | Yes | `NULL` | Qwen CosyVoice returned ID |
| `role` | String | Yes | `"custom"` | Role: male/female/custom |
| `is_cloned` | Boolean | Yes | `False` | Whether cloning is complete |
| `cloned_at` | DateTime | Yes | `NULL` | Timestamp when cloning completed |
| `clone_engine` | String | Yes | `NULL` | Clone engine: `qwen` or `mimo` |
| `mimo_voice_id` | String | Yes | `NULL` | MiMo voice cloning marker |
| `description` | String | Yes | `NULL` | User-defined voice description |
| `avatar` | String | Yes | `NULL` | Avatar data URL or external URL |
| `prompt_text` | String | Yes | `NULL` | Reference audio transcript (VoxCPM Ultimate Clone) |
| `original_audio_path` | String | Yes | `NULL` | Pre-cloning original audio |
| `cloned_preview_path` | String | Yes | `NULL` | Post-cloning preview audio |
| `project_id` | String | Yes | `NULL` | **FK** -> `segmented_projects.id` (SET NULL). NULL = global voice |
| `voice_engine_type` | String | Yes | `NULL` | Voice engine type: `model_default` / `clone` / `design` |
| `engine_type` | String | Yes | `NULL` | Engine: `CosyVoice` / `Mimo` / `VoxCpm` / `EdgeTTS` |
| `engine_sub_type` | String | Yes | `NULL` | Sub-type: `mimo-clone` / `mimo-design` / `voxcpm-clone` / `voxcpm-ultimate` / `voxcpm-design` |
| `engine_params` | JSON | Yes | `NULL` | Engine-specific parameters |
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

Global role/character definitions used across projects and segments.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | String | No | — | **Primary Key** |
| `name` | String | No | — | Role name |
| `avatar` | String | Yes | `NULL` | Avatar data URL or external URL |
| `description` | String | Yes | `NULL` | Role description |
| `role_kind` | String | No | `"cast"` | Role kind: `cast` / `narrator` / etc. |
| `default_engine` | String | No | `"edge_tts"` | Default TTS engine |
| `default_voice` | String | Yes | `NULL` | Default voice identifier |
| `default_engine_params` | JSON | No | `{}` | Default engine parameters |
| `favorite_styles` | JSON | No | `[]` | List of favorite style presets |
| `created_at` | DateTime | Yes | `utcnow` | Record creation timestamp |
| `updated_at` | DateTime | Yes | `utcnow` | Last update timestamp (auto-updates) |

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
| `active_narration_version` | String | Yes | `NULL` | Active narration document version (e.g. `v2.1`) |
| `animation_theme` | String | Yes | `NULL` | Global animation theme (e.g. `dark-botanical`) |
| `remotion_project_path` | String | Yes | `NULL` | Associated Remotion project path |
| `source_document` | Text | Yes | `NULL` | Source document markdown content |
| `default_narrator_role_id` | String | Yes | `NULL` | **FK** -> `roles.id` (SET NULL). Default narrator role |
| `default_narrator_snapshot` | JSON | Yes | `NULL` | Snapshot of narrator role for reproducibility |
| `created_at` | DateTime | Yes | `utcnow` | Record creation timestamp |
| `updated_at` | DateTime | Yes | `utcnow` | Last update timestamp (auto-updates) |

---

## Table: `segmented_project_chapters`

Chapters within a segmented project. Each chapter groups segments and can be linked to a narration document slice.

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
| `narration_document_id` | String | Yes | `NULL` | **FK** -> `narration_documents.id` (SET NULL) |
| `narration_version` | String | Yes | `NULL` | Linked narration version (e.g. `v2.1`) |
| `narration_slice_start` | Integer | Yes | `NULL` | Char offset start in body_markdown |
| `narration_slice_end` | Integer | Yes | `NULL` | Char offset end in body_markdown |
| `narration_synced_at` | DateTime | Yes | `NULL` | Timestamp of last narration sync |
| `created_at` | DateTime | Yes | `utcnow` | Record creation timestamp |
| `updated_at` | DateTime | Yes | `utcnow` | Last update timestamp (auto-updates) |

---

## Table: `segmented_project_segments`

Individual text segments within a chapter. Each segment holds its own text, emotion, role, TTS params, and generated audio state.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | String | No | — | **Primary Key** |
| `chapter_id` | String | No | — | **FK** -> `segmented_project_chapters.id` (CASCADE delete) |
| `project_id` | String | No | — | **FK** -> `segmented_projects.id` (CASCADE delete) |
| `position` | Integer | No | — | Ordering position within chapter |
| `text` | String | No | `""` | Segment text content |
| `ssml` | String | Yes | `NULL` | SSML markup |
| `emotion` | String | Yes | `NULL` | Emotion tag (see Emotion enum values) |
| `role_id` | String | Yes | `NULL` | **FK** -> `roles.id` (SET NULL). Segment-level role override |
| `role_snapshot` | JSON | Yes | `NULL` | Snapshot of role for reproducibility |
| `segment_kind` | String | No | `"narration"` | Segment kind: `narration` / `dialogue` / etc. |
| `prosody_marks` | JSON | No | `[]` | Prosody annotations list |
| `params` | JSON | No | `{}` | Segment-specific TTS parameters |
| `locked_params` | JSON | No | `[]` | Parameters locked against global voice changes |
| `generated_params` | JSON | Yes | `NULL` | Parameters used during last generation |
| `current_audio_path` | String | Yes | `NULL` | Current audio file path |
| `previous_audio_path` | String | Yes | `NULL` | Previous audio file path |
| `audio_format` | String | No | `"mp3"` | Audio file format |
| `duration_sec` | Float | Yes | `NULL` | Audio duration in seconds |
| `audio_missing` | Boolean | No | `False` | Whether audio file is missing from storage |
| `generated_at` | DateTime | Yes | `NULL` | Timestamp of last audio generation |
| `ssml_annotated_by_llm` | Boolean | No | `False` | Whether SSML was LLM-generated |
| `animation_spec_json` | Text | Yes | `NULL` | Full animation spec JSON (visual/layout/phases/animations/emphasis) |
| `created_at` | DateTime | Yes | `utcnow` | Record creation timestamp |
| `updated_at` | DateTime | Yes | `utcnow` | Last update timestamp (auto-updates) |

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

## Table: `narration_documents`

LLM-generated narration documents. Supports multiple versions per project (full re-generation bumps major version, per-chapter re-generation bumps minor version).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | String | No | — | **Primary Key** |
| `project_id` | String | No | — | **FK** -> `segmented_projects.id` (CASCADE delete) |
| `version` | String | No | — | Version string: `v1`, `v2`, `v2.1`, etc. Unique per project |
| `version_kind` | String | No | `"full"` | `full` (whole doc) or `partial` (single chapter) |
| `body_markdown` | Text | No | — | Full narration markdown, split by `## H2` headings |
| `word_count` | Integer | No | `0` | Word count |
| `source_ids_json` | Text | No | `"[]"` | JSON array of source document IDs |
| `prompt_hint` | Text | Yes | `NULL` | User prompt hint for generation |
| `settings_json` | Text | No | `"{}"` | Generation settings JSON (target_chapters, target_words, language, engine) |
| `chapter_slices_json` | Text | Yes | `NULL` | JSON: `[{"chapter_index", "title", "start_char", "end_char"}]` |
| `generated_at` | DateTime | No | `utcnow` | Generation timestamp. Indexed with project_id |

**Constraints:** `UNIQUE(project_id, version)`

---

## Relationships

```
Role  1 ──── ∞  SegmentedProject          (via default_narrator_role_id, SET NULL)
Role  1 ──── ∞  SegmentedProjectSegment   (via role_id, SET NULL)
Role  1 ──── ∞  VoiceProfile              (via project_id; voice_profiles can be project-scoped)

SegmentedProject  1 ──── ∞  SegmentedProjectChapter     (CASCADE delete)
SegmentedProject  1 ──── ∞  SegmentedProjectSegment     (CASCADE delete, denormalized project_id)
SegmentedProject  1 ──── ∞  SourceDocument               (CASCADE delete)
SegmentedProject  1 ──── ∞  NarrationDocument            (CASCADE delete)

SegmentedProjectChapter  1 ──── ∞  SegmentedProjectSegment  (CASCADE delete)

NarrationDocument  1 ──── ∞  SegmentedProjectChapter     (via narration_document_id, SET NULL)
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
| `narration_documents` | `id` | Primary Key |
| `narration_documents` | `project_id` | FK (auto-indexed) |
| `narration_documents` | `(project_id, version)` | Unique constraint |
| `narration_documents` | `(project_id, generated_at)` | Explicit index |

---

## Notes

- All primary keys are UUID strings (generated via `uuid.uuid4()`) except `system_configs` which uses a human-readable string key.
- Timestamps use `datetime.utcnow` (via `app.core.time_utils.utcnow`) and are not timezone-aware.
- `tts_results.instruction` has a Chinese-language default value describing an energetic advertising voiceover style.
- The segmented project models use a three-tier hierarchy: `project -> chapter -> segment`. Segments carry a denormalized `project_id` for direct querying.
- `voice_profiles.project_id` allows project-scoped voices (NULL = global). `segments.role_id` and `projects.default_narrator_role_id` reference the global `roles` table.
