# Voice Studio — Feature Specification

**Version**: 1.0  
**Date**: 2026-06-07  
**Status**: Current

---

## 1. Overview

Voice Studio is an AI audio workstation that combines voice cloning, text-to-speech synthesis, and speech-to-text transcription into a unified workflow. It is built on Qwen CosyVoice, MiMo TTS, Edge-TTS, Faster-Whisper, and FunASR.

**Tech Stack**: React 19 + TypeScript + Vite (frontend), Python 3.12+ / FastAPI (backend), IndexedDB + SQLite for persistence.

---

## 2. Navigation Structure

The application has four top-level tabs plus a landing page:

| Tab             | Route Key          | Description                      |
|-----------------|--------------------|----------------------------------|
| Landing         | —                  | Hero page with feature cards     |
| Voice Clone     | `voice-clone`      | Voice cloning and design         |
| Text to Speech  | `tts-synthesis`    | Single and segmented TTS         |
| Speech to Text  | `speech-to-text`   | Audio/video transcription        |
| Model Config    | `model-config`     | Provider API key management      |

---

## 3. Voice Clone (`/voice-clone`)

### 3.1 Sections

The page has two top-level sections toggled by tabs:

| Section       | Description                                    |
|---------------|------------------------------------------------|
| Voice Clone   | Upload/record audio and register a voice       |
| Voice Design  | Text-described voice style design (MiMo / VoxCPM) |

### 3.2 Clone Engine Support

| Engine | Method | Registration | Lifecycle |
|--------|--------|--------------|-----------|
| **CosyVoice (Qwen)** | Upload/record/URL → cloud register → `voice_id` | Persistent; reuse `voice_id` indefinitely | Best for batch synthesis |
| **MiMo-TTS** | Upload/record → local base64, stateless | No registration; audio sent each time | Best for quick one-off tests |

### 3.3 Clone Flow (3 Steps)

1. **Choose Method** — Select input source:
   - Real-time recording (microphone)
   - File upload (MP3, WAV, WebM)
   - Public URL input (CosyVoice only — MiMo reads local audio as base64)
2. **Input Audio** — Capture or upload the audio sample
3. **Preview & Clone** — Review the sample, name the voice, and submit for cloning

### 3.4 Voice List

- Right-side panel shows all registered voices
- Filtered by current clone engine (`qwen` or `mimo`)
- Supports deleting voices and manual sync from Qwen cloud

### 3.5 Voice Design

Two-step flow: **design → confirm → save**.

| Sub-engine | Method | Output |
|------------|--------|--------|
| **MiMo** | Text description → `/api/mimo-tts/voicedesign` | MP3 audio preview |
| **VoxCPM** | Text description → VoxCPM design endpoint | WAV audio preview |

#### Design Flow

1. **Describe** — Enter a natural-language voice description (e.g. "年轻女性，温柔甜美，语速适中")
2. **Preview** — System synthesizes a sample audio using the selected engine
3. **Confirm** — "确认保存音色" persists the audio as a `VoiceProfile` via `/api/clone/create-from-design` without leaving the design UI
4. **Save Role** — "保存角色" links the `VoiceProfile` to the role as a `voiceclone` reference (`mimo_clone_voice_id` / `voice_id`)

#### Project Role Editor Integration

- Roles designed via voice design are saved with `mimo_mode: 'voiceclone'` (or `voxcpm_mode: 'clone'`) and the `VoiceProfile` ID
- Reopening a designed role shows the **clone** tab with the voice pre-selected
- CharacterCard "试听" button plays the saved preview audio directly (no re-synthesis)
- Designed voices appear in the clone voice dropdown alongside manually cloned voices

### 3.6 Voice Refresh

- A shared `useVoiceRefresh` hook triggers cross-component refresh after clone success
- Both the voice list and TTS voice selectors update automatically

---

## 4. Text to Speech (`/tts-synthesis`)

### 4.1 Mode Switch

Two primary modes:

| Mode | Description |
|------|-------------|
| **Single** | Input text, pick voice/params, generate one audio clip |
| **Segmented** | Professional timeline editor for long-form multi-segment synthesis |

### 4.2 Engine Switch

Three TTS engines available in both modes:

| Engine | Source | Features |
|--------|--------|----------|
| **Edge-TTS** | Microsoft, offline | Free, multi-language, no API key required |
| **CosyVoice (Qwen)** | Cloud API | Uses cloned voice IDs, SSML support |
| **MiMo-TTS** | Cloud API | Preset voices, voice design, voice clone modes |

### 4.3 Single Mode

#### Controls per Engine

| Engine | Parameters |
|--------|-----------|
| CosyVoice | Voice selector, speed (0.5–2.0), volume (0–100), pitch (0.5–2.0), language (Chinese/English/Japanese/Korean), instruction text, SSML toggle, markdown filter toggle |
| Edge-TTS | Voice selector (filtered by language/gender), rate adjustment (±%), volume adjustment (±%) |
| MiMo-TTS | Mode toggle (preset / voiceclone), preset voice selector, clone voice selector, instruction text |

#### Workflow

1. Select engine and configure voice/params
2. Enter text (with character count)
3. Optionally use SSML toolbar (CosyVoice with SSML enabled)
4. Click "Generate" → audio player appears
5. Result saved to IndexedDB (frontend storage mode) or backend DB

#### History

- Synthesis history list with play, delete actions
- Supports both frontend (IndexedDB with Blob storage) and backend storage modes

### 4.4 Segmented Editor

A professional timeline editor for long-form TTS projects.

#### 4.4.1 Project Management

- **Auto-save**: Projects persist to IndexedDB with 1-second debounce
- **Multi-project**: Dropdown selector lists all projects with segment counts
- **New project**: Create fresh project via dropdown option
- **Rename**: Inline project name editing
- **Restore on load**: Last-used project auto-loads on page mount

#### 4.4.2 Text Input & Split

Two split modes configured per project:

| Mode | Description |
|------|-------------|
| **Rule** | Split by punctuation delimiters (default: `，`, `。`, `！`, `？`), customizable |
| **LLM** | LLM-powered semantic splitting with emotion analysis per segment |

#### 4.4.3 Emotion System

- Emotions returned by LLM analysis during smart split
- Six emotion types: `happy`, `sad`, `angry`, `calm`, `neutral`, `excited`
- Chinese labels: 欣喜, 沉重, 愤怒, 沉稳, 中性, 激昂
- Each emotion maps to a distinct card color (CSS class `emoHappy`, `emoSad`, etc.)
- Manual override: users can change emotion per segment via `UPDATE_EMOTION` action
- Emotion tag displayed as a colored badge on each segment card

#### 4.4.4 Segment Lifecycle

Each segment has a status state machine:

```
idle → queued → pending → ready
                     ↘ failed → (retry) → pending
```

| Status | Description |
|--------|-------------|
| `idle` | Not yet generated |
| `queued` | Marked for batch generation |
| `pending` | Currently generating audio |
| `ready` | Audio generated successfully |
| `failed` | Generation failed (with error message) |

#### 4.4.5 Per-Segment Features

- **Text editing**: Edit segment text inline
- **SSML**: Optional SSML annotation per segment (CosyVoice only), LLM batch annotation supported
- **Engine override**: Each segment can override the global voice/params
- **Override tracking**: The `overrides` array records which params are explicitly overridden (`voice`, `speed`, `volume`, `pitch`, `instruction`, `language`)
- **Undo regenerate**: Swap current and previous audio (keeps the old audio)
- **Insert/delete**: Add segments after any position, delete individual segments
- **Reorder**: Drag segments to reorder (via `REORDER` action)

#### 4.4.6 Stale Detection

- When the global voice is changed, segments already generated with the old voice are flagged as **stale**
- Detection logic: `isReady && !hasOverride && generated_voice_id !== currentGlobalVoice`
- Stale segments display a warning: "音色已变更...建议重新生成"
- Visual indicator: CSS class `stale` applied to stale segment cards

#### 4.4.7 Play-by-Character Animation

- When a segment is playing, each character highlights in sequence
- Timing: `duration_sec / text.length` milliseconds per character
- Characters transition from dim (`charDim`) to lit (`charLit`)
- Auto-resets 600ms after the last character highlights

#### 4.4.8 Global Voice Management

- Global control bar at the top sets default voice/params for all segments
- Three engine-specific control bars:
  - CosyVoice: voice selector + speed/volume/pitch/language
  - Edge-TTS: voice selector + rate/volume
  - MiMo-TTS: mode + preset/clone voice + instruction
- Global params are inherited by new segments; per-segment overrides take precedence
- Override indicator: a colored dot (`●`) appears when a segment has a voice override

#### 4.4.9 Batch Operations

| Action | Description |
|--------|-------------|
| Generate All | Synthesize all idle/failed segments (3 concurrent workers) |
| Play All | Sequential playback of all ready segments |
| SSML Annotate | LLM batch SSML annotation for CosyVoice segments |
| Export | Opens export dialog |

#### 4.4.10 Export Options

| Format | Description |
|--------|-------------|
| **WAV** | Concatenated audio from all ready segments, resampled to highest sample rate |
| **JSON** | Script export with segments, timestamps, SSML, and params |
| **SRT** | Subtitle file with timecodes calculated from segment durations |
| **Bilingual SRT** | SRT translated to target language (English/Japanese/Korean) via LLM |

---

## 5. Speech to Text (`/speech-to-text`)

### 5.1 Engine Support

| Engine | Model Options | Strengths |
|--------|--------------|-----------|
| **Whisper (Faster-Whisper)** | tiny, base, small, medium, large-v3 | 100+ languages, CUDA GPU acceleration |
| **FunASR (Paraformer-ZH)** | paraformer-zh, paraformer-zh-streaming | Chinese-optimized, 3x faster CPU, built-in VAD + punctuation |

### 5.2 Transcription Parameters

| Parameter | Whisper | FunASR | Description |
|-----------|---------|--------|-------------|
| Model size | tiny–large-v3 | paraformer-zh | Accuracy vs speed tradeoff |
| Beam size | 1–10 (default 5) | — | Search beam width |
| VAD | — | Toggle (default on) | Voice Activity Detection via FSMN-VAD |

### 5.3 Input Methods

- **Single file**: Drag-and-drop or click to upload (.wav, .mp3)
- **Multi-audio merge**: Select multiple files, concatenated in order before transcription

### 5.4 GPU Detection

- Whisper: Auto-detects CUDA GPU, uses float16
- FunASR: Auto-detects CUDA > MPS > CPU fallback

### 5.5 Results

- Editable SRT preview in textarea
- Language detection with confidence score
- Device/compute type badge (GPU/CPU)
- Download SRT file with auto-generated filename

### 5.6 LLM Subtitle Correction

Two correction modes:

| Mode | Description |
|------|-------------|
| **Smart** | Local pre-filtering: only suspected errors sent to LLM (saves 90%+ tokens) |
| **Full** | All lines sent to LLM for correction |

Workflow:
1. Provide original script text
2. LLM compares ASR output against original
3. Returns correction suggestions with character-level diff
4. User accepts/rejects individual suggestions
5. Apply accepted corrections to SRT content

### 5.7 Bilingual Subtitle Translation

- Target languages: English, Japanese, Korean, French, German, Spanish
- Generates dual-language SRT with original + translation per line
- Downloadable as bilingual SRT file

### 5.8 History

- Transcription history with playback and download
- Supports both frontend (IndexedDB) and backend storage modes
- Stores original audio blob for history playback

---

## 6. Model Configuration (`/model-config`)

### 6.1 Purpose

Manage API keys and connection settings for model providers through a web UI, instead of editing `.env` files directly.

### 6.2 Provider Cards

Each provider displays as an expandable card:

| Field | Description |
|-------|-------------|
| Label | Human-readable provider name |
| Icon | Provider icon/emoji |
| Status | "已配置" / "使用默认值" / "未配置" |

### 6.3 Configuration Fields

Each field has metadata:

| Property | Description |
|----------|-------------|
| `label` | Display name |
| `type` | `text` or `password` |
| `sensitive` | Whether the field contains secrets (masked with `********`) |
| `description` | Help text |
| `has_env_default` | Whether `.env` provides a fallback value |

### 6.4 Behavior

- **Priority**: UI values override `.env` defaults
- **Fallback**: Empty UI fields fall back to `.env` values automatically
- **Password toggle**: Show/hide sensitive field values
- **Dirty tracking**: Only modified fields are submitted on save
- **Reset**: Revert all fields to server-reported values
- **Validation**: Save disabled until at least one field is modified

### 6.5 Providers

| Provider | Key Fields |
|----------|-----------|
| Qwen (CosyVoice) | `QWEN_API_KEY`, `QWEN_MODEL` |
| MiMo TTS | `MIMO_API_KEY`, `MIMO_BASE_URL` |
| LLM (Subtitle correction) | `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` |

---

## 7. Cross-Cutting Features

### 7.1 Storage Mode

A global toggle (`useStorageMode` hook) switches between:

| Mode | TTS History | STT History | Audio Storage |
|------|-------------|-------------|---------------|
| **Frontend** | IndexedDB | IndexedDB | Audio blobs in IndexedDB |
| **Backend** | API calls | API calls | Server-side files |

### 7.2 Audio Caching

- TTS results stored as `TTSLocalRecord` in IndexedDB with full `Blob`
- STT results stored as `STTLocalRecord` with original audio + SRT content
- Segmented editor audio stored via the same TTS IndexedDB store (tagged with `source: 'segmented_tts'`)

### 7.3 Voice Description Enrichment

- Voice descriptions from the voice list are mapped to voice IDs
- Displayed in synthesis history and segment cards instead of raw voice IDs

### 7.4 Responsive Layout

- Segmented editor supports vertical (card list) and horizontal (compact block) layouts
- Toggleable via `SET_LAYOUT` action

---

## 8. Data Types Reference

### Core Types

| Type | Key Fields |
|------|-----------|
| `VoiceProfile` | id, name, audio_url, qwen_voice_id, clone_engine (`qwen`/`mimo`), description |
| `TTSRequest` | text, engine, voice_id, speed, volume, pitch, language, edge_voice, mimo_voice, mimo_audio_base64 |
| `TTSResult` | audio_id, audio_url/audio_base64, text, params |
| `Segment` | id, text, ssml, params (SegmentEngineParams), status, emotion, overrides, generated_voice_id, duration_sec |
| `SegmentedProject` | id, name, segments[], default_params, split_config, layout |
| `EmotionType` | happy, sad, angry, calm, neutral, excited |
| `SegmentStatus` | idle, queued, pending, ready, failed |
| `ModelConfigs` | Record of provider → { label, icon, fields } |

### Segment Engine Params

```typescript
interface SegmentEngineParams {
  engine: 'cosyvoice' | 'edge_tts' | 'mimo_tts';
  // CosyVoice
  voice_id?, instruction?, speed?, volume?, pitch?, language?, enable_ssml?, enable_markdown_filter?;
  // Edge-TTS
  edge_voice?, edge_rate?, edge_volume?;
  // MiMo-TTS
  mimo_mode? ('preset'|'voiceclone'), mimo_preset_voice?, mimo_clone_voice_id?, mimo_instruction?;
}
```

---

## 9. Environment Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `QWEN_API_KEY` | Yes | — | Qwen CosyVoice API key |
| `QWEN_MODEL` | No | `cosyvoice-v3.5-plus` | CosyVoice model |
| `MIMO_API_KEY` | No | — | MiMo TTS API key |
| `MIMO_BASE_URL` | No | `https://api.xiaomimimo.com/v1` | MiMo API endpoint |
| `LLM_API_KEY` | No | Falls back to `MIMO_API_KEY` | LLM correction key |
| `LLM_BASE_URL` | No | Falls back to `MIMO_BASE_URL` | LLM endpoint |
| `LLM_MODEL` | No | `mimo-v2.5-pro` | LLM model for correction |
| `DATABASE_URL` | No | `sqlite:///./voice_clone.db` | Backend database |
| `FUNASR_MODEL` | No | `paraformer-zh` | FunASR model |
| `FUNASR_DEVICE` | No | Auto-detect | cuda > mps > cpu |

---

## 10. API Endpoints Summary

| Group | Endpoint | Method | Purpose |
|-------|----------|--------|---------|
| Clone | `/api/clone/upload` | POST | Upload audio file |
| Clone | `/api/clone/create-clone` | POST | CosyVoice register |
| Clone | `/api/clone/create-clone-mimo` | POST | MiMo mark for clone |
| Clone | `/api/clone/create-from-design` | POST | Create VoiceProfile from design preview audio |
| Clone | `/api/clone/list` | GET | List voices |
| TTS | `/api/tts/synthesize` | POST | CosyVoice/Edge synthesis |
| TTS | `/api/tts/voices` | GET | Cloned voices with scoping (see below) |
| TTS | `/api/tts/edge-voices` | GET | Edge-TTS voices |
| MiMo | `/api/mimo-tts/preset` | POST | Preset voice synthesis |
| MiMo | `/api/mimo-tts/voicedesign` | POST | Text-described voice |
| MiMo | `/api/mimo-tts/voiceclone` | POST | Clone synthesis |
| Split | `/api/text-split/rule` | POST | Rule-based split |
| Split | `/api/text-split/llm` | POST | LLM semantic split |
| Split | `/api/text-split/ssml-annotate` | POST | LLM SSML annotation |
| STT | `/api/speech-to-text/transcribe` | POST | Single transcription |
| STT | `/api/speech-to-text/multi-transcribe` | POST | Multi-audio merge |
| LLM | `/api/subtitle-llm/correct` | POST | Subtitle correction |
| LLM | `/api/subtitle-llm/translate` | POST | Bilingual translation |
| Config | `/api/model-config` | GET/PUT | Model configuration |

### `/api/tts/voices` Query Parameters

| Param | Type | Description |
|-------|------|-------------|
| `voice_id` | string? | Return a single voice by ID (any scope) |
| `project_id` | string? | Return global voices (`project_id IS NULL`) + project-specific voices |

- No params → global voices only (`project_id IS NULL`, `is_cloned = True`)
- `voice_id` → single voice lookup, 404 if not found
- `project_id` → global + project-specific voices

Response envelope: `{"voices": [VoiceProfileOut, ...]}`

Each voice object returns 15 fields: `id`, `name`, `description`, `audio_url`, `original_audio_url`, `cloned_preview_url`, `qwen_voice_id`, `role`, `clone_engine`, `is_cloned`, `cloned_at`, `created_at`, `prompt_text`, `avatar`, `voices_engine`.

`voices_engine` structure:
```json
{
  "type": "design",           // "model_default" | "clone" | "design"
  "engine": {
    "type": "Mimo",           // "CosyVoice" | "Mimo" | "VoxCpm" | "EdgeTTS"
    "sub_type": "mimo-design" // "mimo-clone" | "mimo-design" | "voxcpm-clone" | "voxcpm-ultimate" | "voxcpm-design" | null
  },
  "prompt_text": null,
  "parameters": {
    "voice_description": "年轻女性，温柔甜美，语速适中",
    "instruction": ""
  }
}
```

Voice scoping model:
- `VoiceProfile.project_id = NULL` → global voice (available in all projects)
- `VoiceProfile.project_id = <id>` → project-specific voice (only visible in that project)
- Project voices are created via `/api/clone/create-from-design` with `project_id` parameter

## 分段项目后端存储

当 `storageMode = backend` 时，分段项目、章节、段落、参数、生成快照与音频全部由后端管理：

- 数据库三张表：`segmented_projects` / `segmented_project_chapters` / `segmented_project_segments`
- 每个项目一个目录 `uploads/segmented/{project_id}/`，存放 `original.txt`、章节文本、分片 `mp3`、`manifest.json`
- 后端为权威来源；IndexedDB 只作为草稿缓存，记录 `base_updated_at` 做冲突检测
- 切换到后端模式时若本地 IndexedDB 仍有项目，提示一键迁移
- 音频由 ffmpeg 转码为 mp3
