# Database Schema Documentation

**Project:** NarraForge
**ORM:** SQLAlchemy (declarative base)
**Updated:** 2026-07-01 (schema v3.2 — Phase 1-4: structured TTS params, removed voices_engine)

---

## Overview

The database consists of **10 tables** and **2 enums**.

> **workers deploy target (2026-08):** the Cloudflare Workers runtime cannot use SQLAlchemy/SQLite.
> Persistence for `voice_profiles` / `system_configs` / `roles` / `source_documents` and the three
> `segmented_project*` tables (step 3B) goes through Supabase PostgREST; the Postgres DDL exported
> from these models lives in `backend/supabase/schema.sql`
> and is kept in sync by `backend/tests/unit/test_supabase_schema_sync.py`.
>
> **Supabase 多用户扩展（2026-08, workers only）：** `schema.sql` additionally defines per-user
> ownership (`user_id`) columns, the stats/auth-adjacent tables (`profiles` / `daily_stats` /
> `operation_logs` / `daily_active_users`) and the `increment_metric` RPC — see
> [Supabase Multi-User Schema](#supabase-multi-user-schema-workers-only).
> These exist only on the Supabase side; the local SQLite schema is unchanged (single-tenant).

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
| `source_document` | Text | Yes | `NULL` | **Deprecated** — legacy fallback only; new writes go to file, see `source_document_path` |
| `source_document_path` | String | Yes | `NULL` | Path of the source document file (content lives on disk under the project's assets dir) |
| `narration_document_path` | String | Yes | `NULL` | Path of the full narration script file (workflow 产出的完整旁白稿) |
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
| `sync_state` | JSON | Yes | `NULL` | Layer-sync staleness baseline: `{l1_hash, l2_hash, segments_hash}` (blake2s-8), written by `mark_l2_derived` / `mark_split` |
| `audio_adjust` | JSON | Yes | `NULL` | Post-synthesis adjust record: `{tempo, volume_db, applied_at, segments}`；`NULL` = 未调整（首次调整原始音频存入 `audio.previous`） |
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
| `split_anchor` | JSON | Yes | `NULL` | Layer-sync Phase B anchor in chapter `narration_script`: `{offset_start, offset_end, baseline_text}`; written at split, used for L3->L2 localisation merge |
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
  "current": {"id": "idx_a", "path": "{project-slug}/chapters/{chapter-id}/segments/{segment-id}.mp3", "origin": "tts"},
  "previous": {"id": "idx_old"},
  "format": "mp3",
  "duration_sec": 2.3
}
```

`current` / `previous` 条目可带可选字段 `origin`：`"tts"`（引擎合成）或 `"recorded"`（用户自行录入/上传）。
`origin === 'recorded'` 表示该分片音频处于锁定状态：批量/agent 合成自动跳过，手动重新生成需先解锁（前端清除标记）并以 `force: true` 调用合成端点。
录入音频的文件名为 `{segment-id}.rec-{8位随机}.{ext}`，保证 `previous` 撤销指向真实旧文件。

`path` 是相对于资产根（默认 `backend/data/projects/`，环境变量 `SEGMENTED_DIR` 可覆盖）的相对路径，也可能是绝对路径（历史数据）。读取端一律以 DB 存储路径为准；新写入的文件遵循统一布局（设计见 `docs/superpowers/specs/2026-07-25-unified-data-root-asset-naming-design.md`）。

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
| `segmented_project_chapters` | `project_id` | `ix_chapters_project_id` (D6) |
| `segmented_project_chapters` | `(project_id, position)` | Unique: `uq_chapter_project_position` (D6) |
| `segmented_project_segments` | `id` | Primary Key |
| `segmented_project_segments` | `chapter_id` | `ix_segments_chapter_id` (D6) |
| `segmented_project_segments` | `(chapter_id, position)` | Unique: `uq_segment_chapter_position` (D6) |
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
- `origin` (optional, on `current`/`previous`): `"tts"` | `"recorded"` — `"recorded"` 为用户自行录入的音频，处于锁定状态（批量/agent 合成跳过，重新生成需解锁 + `force`）

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

---

## Supabase Multi-User Schema (workers only)

以下改动只存在于 Supabase（`backend/supabase/schema.sql`）一侧；本地 SQLite 模型不加这些列/表，保持单租户无认证。
事实源为 `schema.sql`，由 `backend/tests/unit/test_supabase_schema_sync.py` 保持同步。

### `user_id` ownership columns

五张顶层归属表新增 `user_id uuid`（nullable，带索引 `idx_<table>_user_id`）：
`segmented_projects` / `voice_profiles` / `roles` / `source_documents` / `tts_results`。

- NULL = 存量未归属行（升级后由 `backend/scripts/backfill_user_ownership.py` 回填给初始用户）。
- chapters/segments 不加列：归属经所属 project 传递，仓储层操作前先校验 project 归属。
- `system_configs` 全局共享，不加列。
- 隔离在仓储层实现（service key 走 PostgREST 绕过 RLS）：登录用户 select/update/delete 追加
  `user_id` 过滤、insert 写入归属；legacy admin 看全部行；匿名兜底 `user_id IS NULL` 作用域。
  详见 `backend/app/core/repositories/user_scope.py`。

### Table: `profiles`

Supabase Auth 用户档案。`id` = `auth.users.id`（不建 FK，避免耦合 auth schema）；由 stats 中间件首见 upsert。

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Supabase Auth user id |
| `email` | text | |
| `created_at` | timestamptz | default `now()` |
| `last_seen_at` | timestamptz | 每次已认证请求刷新 |
| `is_admin` | boolean | default false |

### Table: `daily_stats`

按日计数指标（`visit_authed` / `visit_anon` / `synthesize` 等）。

| Column | Type | Notes |
|---|---|---|
| `date` | date | PK 一部分 |
| `metric` | text | PK 一部分 |
| `count` | bigint | default 0 |

### Table: `operation_logs`

变更类操作审计（POST/PUT/DELETE，剔除 `/health` 与 `/api/admin/` 等路径）。

| Column | Type | Notes |
|---|---|---|
| `id` | bigint identity PK | |
| `user_id` | uuid | nullable（匿名操作为 NULL） |
| `action` | text | `<router>.<verb>` 语义映射 |
| `method` / `path` / `status` / `duration_ms` | text / text / int / int | 请求快照 |
| `created_at` | timestamptz | default `now()`；索引 `idx_operation_logs_created_at`、`idx_operation_logs_user_id` |

### Table: `daily_active_users`

| Column | Type | Notes |
|---|---|---|
| `date` | date | PK 一部分 |
| `user_id` | uuid | PK 一部分 |

### RPC: `increment_metric(p_date date, p_metric text)`

对 `daily_stats` 原子 +1（`INSERT ... ON CONFLICT DO UPDATE`，避免读-改-写竞态）。
经 PostgREST 调用：`POST /rest/v1/rpc/increment_metric`。
