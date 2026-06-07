# Database Schema Documentation

**Project:** VoiceClone  
**ORM:** SQLAlchemy (declarative base)  
**Generated:** 2026-06-07  

---

## Overview

The database consists of **7 tables** (5 active + 2 reserved for v2) and **2 enums**.

| Table | Purpose |
|---|---|
| `voice_profiles` | Stored voice profiles for cloning |
| `tts_configs` | TTS configuration presets |
| `tts_results` | Historical TTS synthesis results |
| `transcription_records` | Audio transcription history |
| `system_configs` | Global key-value system settings |
| `segmented_projects` | *(v2 reserved)* Segmented TTS projects |
| `segmented_project_segments` | *(v2 reserved)* Segments within a project |

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

| Value | Description |
|---|---|
| `happy` | Happy |
| `sad` | Sad |
| `neutral` | Neutral (default) |
| `excited` | Excited |

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

## Table: `segmented_projects` *(v2 Reserved)*

Segmented TTS project containers. Not active in v1 — editor frontend uses IndexedDB.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | String | No | — | **Primary Key** |
| `name` | String | No | — | Project name |
| `default_params` | JSON | No | `{}` | Default TTS parameters |
| `split_config` | JSON | No | `{}` | Text splitting configuration |
| `layout` | String | No | `"vertical"` | UI layout mode |
| `created_at` | DateTime | Yes | `utcnow` | Record creation timestamp |
| `updated_at` | DateTime | Yes | `utcnow` | Last update timestamp (auto-updates) |

---

## Table: `segmented_project_segments` *(v2 Reserved)*

Individual text segments within a segmented project.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | String | No | — | **Primary Key** |
| `project_id` | String | No | — | **FK** → `segmented_projects.id` (CASCADE delete) |
| `position` | Integer | No | — | Ordering position within project |
| `text` | String | No | `""` | Segment text content |
| `ssml` | String | Yes | `NULL` | SSML markup |
| `params` | JSON | No | `{}` | Segment-specific TTS parameters |
| `current_audio_id` | String | Yes | `NULL` | Current audio version reference |
| `previous_audio_id` | String | Yes | `NULL` | Previous audio version reference |
| `duration_sec` | Integer | Yes | `NULL` | Audio duration in seconds |
| `ssml_annotated_by_llm` | Boolean | Yes | `False` | Whether SSML was LLM-generated |
| `created_at` | DateTime | Yes | `utcnow` | Record creation timestamp |
| `updated_at` | DateTime | Yes | `utcnow` | Last update timestamp (auto-updates) |

---

## Relationships

```
SegmentedProject  1 ──── ∞  SegmentedProjectSegment
     (segmented_projects.id ← segmented_project_segments.project_id)
     Cascade: delete-orphan
     Order: by position ascending
```

No foreign key relationships exist between the active tables (`voice_profiles`, `tts_configs`, `tts_results`, `transcription_records`, `system_configs`). They are linked conceptually by `voice_id` references in application logic rather than database-level constraints.

---

## Indexes

No explicit indexes are defined beyond the primary keys. All primary key columns serve as their own index:

| Table | PK Column(s) |
|---|---|
| `voice_profiles` | `id` |
| `tts_configs` | `id` |
| `tts_results` | `id` |
| `transcription_records` | `id` |
| `system_configs` | `key` |
| `segmented_projects` | `id` |
| `segmented_project_segments` | `id` |

The `segmented_project_segments.project_id` foreign key column will be indexed automatically by SQLAlchemy/database engine.

---

## Notes

- All primary keys are UUID strings (generated via `uuid.uuid4()`) except `system_configs` which uses a human-readable string key.
- Timestamps use `datetime.utcnow` and are not timezone-aware.
- The `SegmentedProject` and `SegmentedProjectSegment` models are reserved for v2 backend mode and are not imported or created at runtime in v1.
- `tts_results.instruction` has a Chinese-language default value describing an energetic advertising voiceover style.
