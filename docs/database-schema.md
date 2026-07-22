# Database Schema Documentation

**Project:** NarraForge
**ORM:** SQLAlchemy (declarative base)
**Updated:** 2026-07-01 (schema v3.2 — Phase 1-4: structured TTS params, removed voices_engine)

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

Stores voice profiles used for voice cloning and design workflows.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | String | No | UUID4 | **Primary Key** |
| `name` | String | No | — | Voice profile name |
| `description` | String | Yes | `NULL` | User-defined voice description |
| `avatar` | String | Yes | `NULL` | Avatar data URL or external URL |
| `project_id` | String | Yes | `NULL` | **FK** -> `segmented_projects.id` (SET NULL). NULL = global voice |
| `voice` | JSON | No | `{}` | Identity + routing: `{model, voice_type}` |
| `voice_params` | JSON | No | `{}` | Per-model params: `{<model>: {mode?, source_audio_path?, params: {...}}}` |
| `preview` | JSON | Yes | `NULL` | Audition data: `{audition_text, preview_audio_path}` |
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
| `voice` | JSON | No | `{}` | TTS voice configuration (EngineParams discriminated union) |
| `split_config` | JSON | No | `{}` | Text splitting configuration |
| `original_text` | String | Yes | `NULL` | Chapter-level original text |
| `narration_script` | Text | Yes | `NULL` | L3 narration script (edited); source for segment splitting |
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

## JSON Field Examples

All JSON columns store data as SQLite `TEXT` (deserialized by SQLAlchemy `JSON` type). Below are real-world examples from the production database.

---

### `roles.voice` — EngineParams (discriminated union)

The voice configuration for a role. Format depends on `engine`.

**Edge-TTS (default):**
```json
{
  "engine": "edge_tts",
  "voice": "zh-CN-XiaoxiaoNeural",
  "rate": "+10%",
  "volume": "+0%"
}
```

**MiMo (voice design):**
```json
{
  "engine": "mimo_tts",
  "mode": "voicedesign",
  "voice_id": "a645dec1-73b9-42d4-8f21-ed164eb668e8",
  "voice_description": "成年男性，语速较快",
  "instruction": ""
}
```

**MiMo (preset):**
```json
{
  "engine": "mimo_tts",
  "mode": "preset",
  "voice_id": "冰糖",
  "instruction": "活泼"
}
```

**CosyVoice (clone):**
```json
{
  "engine": "cosyvoice",
  "voice_id": "cosyvoice-v3.5-plus-bailian-xxxxxx",
  "speed": 1.0,
  "volume": 80,
  "pitch": 1.0,
  "language": "Chinese",
  "instruction": ""
}
```

**VoxCPM (clone):**
```json
{
  "engine": "voxcpm",
  "mode": "clone",
  "voice_id": "voxcpm-xxxx",
  "style_control": "",
  "cfg_value": 2.0,
  "inference_timesteps": 10
}
```

---

### `roles.favorite_styles` — string array

```json
["活泼", "沉稳"]
```

Default: `[]`

---

### `segmented_projects.configs` — Project-level settings

```json
{
  "split_voice_mode": "dialogue"
}
```

`split_voice_mode`: `"narration"` | `"dialogue"`

---

### `segmented_project_chapters.voice` — Chapter-level voice defaults (EngineParams)

Stores the chapter-level TTS configuration in the same EngineParams discriminated union format as `roles.voice`. Narration segments without custom voice inherit this config.

**Edge-TTS:**
```json
{
  "engine": "edge_tts",
  "voice": "zh-CN-YunxiNeural",
  "rate": "+10%",
  "volume": "+0%"
}
```

**CosyVoice:**
```json
{
  "engine": "cosyvoice",
  "voice_id": "cosyvoice-v3.5-plus-bailian-xxxxxx",
  "speed": 1.0,
  "volume": 80,
  "pitch": 1.0,
  "language": "Chinese",
  "instruction": ""
}
```

**MiMo (preset):**
```json
{
  "engine": "mimo_tts",
  "mode": "preset",
  "voice_id": "冰糖",
  "instruction": ""
}
```

**MiMo (voiceclone):**
```json
{
  "engine": "mimo_tts",
  "mode": "voiceclone",
  "voice_id": "a645dec1-73b9-42d4-8f21-ed164eb668e8",
  "instruction": ""
}
```

**VoxCPM (clone):**
```json
{
  "engine": "voxcpm",
  "mode": "clone",
  "voice_id": "voxcpm-xxxx",
  "style_control": "",
  "cfg_value": 2.0,
  "inference_timesteps": 10
}
```

> **Note:** Replaces the old `engine` + `default_params` (SegmentEngineParams kitchen sink) columns. This is the same format as `roles.voice`.

---

### `segmented_project_chapters.split_config` — Text split rules

```json
{
  "delimiters": ["。", "！", "？"],
  "mode": "rule"
}
```

`mode`: `"rule"` | `"llm"`

---

### `segmented_project_segments.voice` — VoiceSource (discriminated union)

Determines how a segment's TTS voice parameters are resolved.

**Follows role:**
```json
{
  "source": "role",
  "role_id": "role-1782179262767"
}
```

**Follows chapter/global defaults:**
```json
{
  "source": "chapter"
}
```

**Custom (locked independent voice):**
```json
{
  "source": "custom",
  "engine": "edge_tts",
  "params": {
    "engine": "edge_tts",
    "edge_voice": "zh-CN-YunjianNeural",
    "edge_rate": "+0%",
    "edge_volume": "+0%",
    "mimo_mode": "preset",
    "mimo_preset_voice": "冰糖",
    "voice_id": ""
  },
  "role_id": "role-xxx"
}
```

- `source`: `"chapter"` | `"role"` | `"custom"`
- `engine` (custom only): `"edge_tts"` | `"cosyvoice"` | `"mimo_tts"` | `"voxcpm"`
- `params` (custom only): full set of engine parameters (flat SegmentEngineParams format)
- `role_id` (optional): retains the role association even after becoming custom

---

### `segmented_project_segments.generated_params` — Last synthesis params snapshot

Records what params were actually used for the last synthesis. Used for staleness detection.

```json
{
  "engine": "edge_tts",
  "edge_voice": "zh-CN-YunxiNeural",
  "edge_rate": "+10%",
  "edge_volume": "+0%",
  "voice_id": "",
  "mimo_mode": "preset",
  "mimo_preset_voice": "冰糖",
  "speed": 1,
  "volume": 80,
  "pitch": 1,
  "language": "Chinese"
}
```

---

### `segmented_project_segments.audio` — Audio metadata

**Frontend mode (IndexedDB):**
```json
{
  "format": "mp3",
  "current": { "id": "1719950123456-abc123" },
  "previous": null,
  "duration_sec": 6.528
}
```

**Backend mode (filesystem):**
```json
{
  "format": "mp3",
  "current": {
    "id": null,
    "path": "1781590441912-6-21esct/chapters/1781590441912-5-eycy3s/segments/1781590472414-15-x36xni.mp3"
  },
  "previous": {
    "id": null,
    "path": "1781590441912-6-21esct/chapters/1781590441912-5-eycy3s/segments/1781590472414-15-x36xni.mp3"
  },
  "duration_sec": 6.528
}
```

- `format`: `"mp3"` | `"wav"`
- `current.id` / `current.path`: mutually exclusive based on storage mode
- `previous`: saved for undo (swaps with current)

---

### `voice_profiles.voice` — Identity + routing

| Field | Values | Purpose |
|---|---|---|
| `model` | `edge_tts` / `cosyvoice` / `mimo_tts` / `voxcpm` | Which TTS model |
| `voice_type` | `preset` / `clone` / `design` | How the voice was created |

`voice_id` is NOT stored here — it lives in `voice_params.{model}.params.voice_id` when applicable (preset voices, CosyVoice cloned voices, MiMo design voices). For other clone/design voices, the VoiceProfile's own `id` is the identifier.

```json
{ "model": "mimo_tts", "voice_type": "design" }
```

---

### `voice_profiles.voice_params` — Per-model parameters

Structure: `{ "<model>": { "mode"? , "source_audio_path"? , "params": {...} } }`

- `source_audio_path` — only for `voice_type=clone`
- `mode` — only for `mimo_tts` (`voiceclone` / `voicedesign`) and `voxcpm` (`clone` / `ultimate` / `design`)

**params by model:**

| Field | edge_tts | cosyvoice | mimo_tts | voxcpm | Notes |
|-------|----------|-----------|----------|--------|-------|
| `voice_id` | ✅ | ✅ | ✅ (preset) | — | Preset name / cloud ID |
| `rate` | ✅ | — | — | — | `"+10%"` format |
| `volume` | ✅ | ✅ | — | — | edge: `"+0%"`, cosy: `80` |
| `speed` | — | ✅ | — | — |  |
| `pitch` | — | ✅ | — | — |  |
| `language` | — | ✅ | — | — |  |
| `style_control` | — | — | — | ✅ | Style/tone instruction |
| `instruction` | — | — | ✅ | — | MiMo 各模式共用 |
| `voice_description` | — | — | ✅ (design) | ✅ (design) | 音色设计描述 |
| `prompt_text` | — | — | — | ✅ (ultimate) | 完整音频转录 |
| `cfg_value` | — | — | — | ✅ |  |
| `inference_timesteps` | — | — | — | ✅ |  |

**Examples:**

```json
// edge_tts (preset)
{ "edge_tts": { "params": { "voice_id": "zh-CN-YunxiNeural", "rate": "+10%", "volume": "+0%" } } }

// cosyvoice (clone)
{ "cosyvoice": { "source_audio_path": "/voices/clone_xxx.wav", "params": { "voice_id": "cosyvoice-v3-xxx", "speed": 1.0, "volume": 80, "pitch": 1.0, "language": "Chinese" } } }

// mimo_tts (clone)
{ "mimo_tts": { "source_audio_path": "/voices/clone_xxx.mp3", "mode": "voiceclone", "params": { "instruction": "" } } }

// mimo_tts (design)
{ "mimo_tts": { "mode": "voicedesign", "params": { "voice_description": "年轻女性，声音清亮", "instruction": "" } } }

// voxcpm (clone)
{ "voxcpm": { "source_audio_path": "/voices/clone_xxx.wav", "mode": "clone", "params": { "style_control": "", "prompt_text": "", "cfg_value": 2.0, "inference_timesteps": 10 } } }

// voxcpm (design)
{ "voxcpm": { "mode": "design", "params": { "voice_description": "中年男性，嗓音沉稳", "cfg_value": 2.0, "inference_timesteps": 10 } } }
```

---

### `voice_profiles.preview` — Audition data

```json
{
  "audition_text": "这是一段角色试听文本...",
  "preview_audio_path": "/voices/preview_xxx.mp3"
}
```

Temporary data, overwritten on each preview. Nothing stored here is used for synthesis.

---

## Notes

- All primary keys are UUID strings (generated via `uuid.uuid4()`) except `system_configs` which uses a human-readable string key.
- Timestamps use `datetime.utcnow` (via `app.core.time_utils.utcnow`) and are not timezone-aware.
- The segmented project models use a three-tier hierarchy: `project -> chapter -> segment`. Segments carry a denormalized `project_id` for direct querying.
- `voice_profiles.project_id` allows project-scoped voices (NULL = global). `segments.role_id` and `projects.default_narrator_role_id` reference the global `roles` table.
- `voice_profiles.voice` routes the frontend to the correct TTS panel. `voice_params` stores the actual parameters nested under the model key.
