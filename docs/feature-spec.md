# NarraForge — Feature Specification

**Version**: 2.0
**Date**: 2026-06-26
**Status**: Current

---

## 1. Overview

NarraForge is an AI narration workshop that integrates voice cloning, text-to-speech synthesis, speech-to-text transcription, and a segmented project editor for producing multi-chapter audio narrations. It supports four TTS engines (Edge-TTS, CosyVoice, MiMo-TTS, VoxCPM) and two STT engines (Whisper, FunASR).

**Tech Stack**: React 19 + TypeScript + Vite (frontend), Python 3.12+ / FastAPI / SQLAlchemy (backend), IndexedDB + SQLite for persistence.

---

## 2. Navigation Structure

The application uses a two-tier navigation architecture:

### Global Sidebar

A fixed left sidebar (`AppShell`) provides top-level navigation:

| Item | Internal View | Description |
|------|---------------|-------------|
| Projects | `tts-synthesis` | ProjectHub project list → project workspace |
| Subtitles | `speech-to-text` | Transcription Hub |
| Voice Design | `voice-clone` | Voice cloning and design |
| Settings | `model-config` | Provider API key management |

The sidebar **hides** when a project workspace is active, giving full width to the editor.

### ProjectHub (Default View)

When no project is open, the Projects tab shows **ProjectHub** — a card grid of all saved projects with:
- Project name, chapter/segment counts, generated progress
- Quick actions: open, delete, create new
- Scratchpad project for quick drafts

### Project Workspace

Opening a project enters the workspace with a left rail (`ProjectShell`) containing:
- Project identity (name + subtitle)
- "Back to projects" button
- Section navigation (5 sections, see below)
- Chapter list (visible in Library/Studio sections)

---

## 3. Voice Design (`/voice-clone`)

### 3.1 Page Structure

The page title is "音色设计". It has two inline panels triggered by action buttons, plus a voice profile grid:

| Element | Description |
|---------|-------------|
| "设计新音色" button | Opens the voice design panel |
| "克隆声音" button | Opens the voice clone panel |
| Voice Profile Grid | Card grid of all saved voices with preview buttons |

Panels expand inline below the header — there are no tabs.

### 3.2 Clone Engines

Three clone engines are supported:

| Engine | Method | Registration | Lifecycle |
|--------|--------|--------------|-----------|
| **CosyVoice (Qwen)** | Upload/record/URL → cloud register → `voice_id` | Persistent; reuse `voice_id` indefinitely | Best for batch synthesis |
| **MiMo-TTS** | Upload/record → local base64, stateless | No registration; audio sent each time | Best for quick tests |
| **VoxCPM** | Upload/record → local GPU inference | No registration; uses local audio path | Best for local high-fidelity clone |

### 3.3 Clone Flow

1. **Choose Engine** — CosyVoice / MiMo / VoxCPM
2. **Input Audio** — Record (microphone), upload (MP3/WAV/WebM), or URL (CosyVoice only)
3. **Preview & Clone** — Review sample, name the voice, submit for cloning
4. **Voice Profile Created** — Saved with `original_audio_path` (source audio) and engine metadata

CosyVoice clones register with Qwen cloud and store `qwen_voice_id`. MiMo/VoxCPM clones are stateless — the audio file is read and sent at synthesis time.

### 3.4 Voice Design Flow

Two sub-engines for voice design from text descriptions:

| Sub-engine | Method | Output |
|------------|--------|--------|
| **MiMo** | Text description → `/api/mimo-tts/voicedesign` | MP3 audio preview |
| **VoxCPM** | Text description → VoxCPM design endpoint | WAV audio preview |

Flow:
1. **Describe** — Enter a natural-language voice description
2. **Preview** — System synthesizes a sample. MiMo voicedesign uses `optimize_text_preview=false` for verbatim text
3. **Save** — Persists audio as a `VoiceProfile` via `/api/clone/create-from-design`

### 3.5 Voice Profile Cards

Each card shows:
- VoiceAvatar (40px), name, engine label chip, description chip
- "试听" button — plays the saved audio directly via `audio_url`
- Click to expand for editing/deleting

### 3.6 Voice Refresh

A shared `useVoiceRefresh` hook triggers cross-component refresh after clone/design success. Both the voice list and TTS voice selectors update automatically.

---

## 4. Projects (`/tts-synthesis`)

### 4.1 Project Structure

A project is the primary organizational unit. It contains chapters, which contain segments. There is **no single mode** — all TTS work happens within a project.

```
Project
├── Chapters[]
│   ├── original_text (narration manuscript)
│   ├── segments[] (TTS units)
│   └── default_params (engine/voice settings)
├── source_document (raw source markdown)
├── default_narrator_role_id
└── roles (narrator + cast)
```

### 4.2 ProjectShell Sections

The project workspace has 5 sections accessible via the left rail:

| Section | Component | Description |
|---------|-----------|-------------|
| **Overview** | `ProjectOverview` | Project summary, chapter list, narrator info, quick navigation |
| **Library** | `ProjectLibrary` | Source document + narration chapters with fulltext view |
| **Studio** | `VoiceStudioLayout` | Main segmented TTS editor with chapter sidebar |
| **Voices** | `ProjectVoices` | Role management: narrator + cast roles with voice configuration |
| **Settings** | `ProjectSettings` | Project metadata, export config, Remotion path |

### 4.3 TTS Engines

Four TTS engines are available:

| Engine | Source | Features |
|--------|--------|----------|
| **Edge-TTS** | Microsoft, online | Free, multi-language, no API key required |
| **CosyVoice (Qwen)** | Cloud API | Uses cloned voice IDs, SSML support |
| **MiMo-TTS** | Cloud API | Preset voices, voice design, voice clone modes |
| **VoxCPM** | Local GPU | Clone, ultimate clone, design modes; CFG/timestep params |

### 4.4 Studio — Segmented Editor

The Studio section is a professional timeline editor for multi-segment synthesis.

#### Text Input & Split

| Mode | Description |
|------|-------------|
| **Rule** | Split by punctuation delimiters (default: `，`, `。`, `！`, `？`), customizable |
| **LLM** | LLM-powered semantic splitting with emotion analysis per segment |

#### Emotion System

- Six emotion types: `happy`, `sad`, `angry`, `calm`, `neutral`, `excited`
- Chinese labels: 欣喜, 沉重, 愤怒, 沉稳, 中性, 激昂
- Each emotion maps to a distinct card color
- Manual override per segment

#### Segment Lifecycle

```
idle → queued → pending → ready
                     ↘ failed → (retry) → pending
```

#### Per-Segment Features

- Text editing, SSML annotation (CosyVoice), engine/voice override
- Override tracking via `overrides` array
- Undo regenerate (swap current/previous audio)
- Insert/delete/reorder segments
- Role assignment (narrator or cast)

#### Stale Detection

When the global voice changes, segments generated with the old voice are flagged as stale with a warning.

#### Batch Operations

| Action | Description |
|--------|-------------|
| Generate All | Synthesize all idle/failed segments (3 concurrent workers) |
| Play All | Sequential playback of all ready segments |
| Export | WAV/JSON/SRT/bilingual SRT export |

### 4.5 Library — Source & Narration Documents

The Library organizes project content into two tabs:

| Tab | Description |
|-----|-------------|
| **Source Document** | Raw source text. Textarea editing + react-markdown view mode. 500ms debounced auto-save. |
| **Narration Document** | Chapter grid with progress stats, segment counts, estimated duration. |

**Compare View**: Side-by-side two-column layout comparing source (left) vs narration (right). Both render via react-markdown.

**Additional modes**:
- **Full-text view**: All chapters concatenated, react-markdown rendered
- **Chapter editor**: Single-chapter immersive editor with edit/preview toggle

### 4.6 Voices — Role Management

The Voices section manages narrator and cast roles:

| Feature | Description |
|---------|-------------|
| Default Narrator | Project-wide default narration voice |
| Cast Roles | Dialogue characters with individual voice configs |
| Voice Source Categories | Model Presets (Edge/MiMo), Clone Voices (CosyVoice/MiMo/VoxCPM), Design New (MiMo/VoxCPM) |
| Preview | Each role has a "试听" button for auditioning |
| Persistence | Roles created in project saved to project role library |

global voices(role) can be used in project , but can not be edit.

### 4.7 Narrator Mode Voice Selection

When in the Studio sidebar, each engine has specific voice source restrictions:

| Engine | Available Voice Sources |
|--------|------------------------|
| **CosyVoice** | Only CosyVoice-cloned voices (`clone_engine='qwen'`) |
| **Edge-TTS** | System default voices |
| **MiMo** | System preset voices OR MiMo/VoxCPM cloned voices (excludes CosyVoice) |
| **VoxCPM** | Only VoxCPM-cloned voices (`clone_engine='voxcpm'`) |

### 4.8 Project Auto-Save & Conflict Detection

- Backend mode: debounce PUT via `useSegmentedDraftSync`
- IndexedDB as draft cache with `base_updated_at` for conflict detection
- 2000ms tolerance: only triggers conflict when backend `updated_at` exceeds local by >2 seconds
- Initial load does not trigger `markDirty` to prevent false conflicts

---

## 5. Transcription Hub (`/speech-to-text`)

### 5.1 Layout

Two-column layout:
- **Main column**: AudioDropzone (multi-file), TranscriptEditor, CorrectionPanel, TranscriptionHistory
- **Sidebar**: SidebarConfig (engine/model/VAD), QualityReport, ExportPanel, BilingualCard

### 5.2 Engine Support

| Engine | Model Options | Strengths |
|--------|--------------|-----------|
| **Whisper (Faster-Whisper)** | tiny, base, small, medium, large-v3 | 100+ languages, CUDA GPU acceleration |
| **FunASR (Paraformer-ZH)** | paraformer-zh, paraformer-zh-streaming | Chinese-optimized, 3x faster CPU, built-in VAD + punctuation |

### 5.3 Transcription Parameters

| Parameter | Whisper | FunASR | Description |
|-----------|---------|--------|-------------|
| Model size | tiny–large-v3 | paraformer-zh | Accuracy vs speed tradeoff |
| Beam size | 1–10 (default 5) | — | Search beam width |
| VAD | — | Toggle (default on) | Voice Activity Detection via FSMN-VAD |

### 5.4 Input Methods

- Single file: drag-and-drop or click (.wav, .mp3)
- Multi-audio merge: select multiple files, concatenated before transcription

### 5.5 Results

- Editable SRT preview in textarea
- Language detection with confidence score
- Device/compute type badge (GPU/CPU)
- Download SRT file

### 5.6 LLM Subtitle Correction

Two modes: **Smart** (local pre-filtering, only suspected errors sent to LLM) and **Full** (all lines sent). Workflow: provide original script → LLM compares → character-level diff → accept/reject → apply.

### 5.7 Bilingual Subtitle Translation

Target languages: English, Japanese, Korean, French, German, Spanish. Generates dual-language SRT.

---

## 6. Model Configuration (`/model-config`)

Manage API keys and connection settings through a web UI instead of editing `.env`.

### Provider Cards

Each provider is an expandable card with label, icon, status ("已配置" / "使用默认值" / "未配置").

### Behavior

- UI values override `.env` defaults
- Empty UI fields fall back to `.env` automatically
- Password toggle for sensitive fields
- Dirty tracking — only modified fields submitted on save

### Providers

| Provider | Key Fields |
|----------|-----------|
| Qwen (CosyVoice) | `QWEN_API_KEY`, `QWEN_MODEL` |
| MiMo TTS | `MIMO_API_KEY`, `MIMO_BASE_URL` |
| LLM (Subtitle correction) | `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` |
| FunASR | `FUNASR_MODEL`, `FUNASR_DEVICE` |

---

## 7. Cross-Cutting Features

### 7.1 Storage Mode

A global toggle switches between:

| Mode | TTS History | STT History | Audio Storage |
|------|-------------|-------------|---------------|
| **Frontend** | IndexedDB | IndexedDB | Audio blobs in IndexedDB |
| **Backend** | API calls | API calls | Server-side files |

### 7.2 Audio Caching

- TTS results stored as `TTSLocalRecord` in IndexedDB with full Blob
- STT results stored as `STTLocalRecord` with original audio + SRT
- Segmented editor audio tagged with `source: 'segmented_tts'`

### 7.3 Responsive Layout

- Segmented editor supports vertical (card list) and horizontal (compact block) layouts
- Toggleable via `SET_LAYOUT` action

---

## 8. Data Types Reference

### Core Types

| Type | Key Fields |
|------|-----------|
| `VoiceProfile` | id, name, audio_url, original_audio_url, cloned_preview_url, qwen_voice_id, mimo_voice_id, clone_engine (`qwen`/`mimo`/`voxcpm`), description, prompt_text, avatar |
| `Segment` | id, text, ssml, params (SegmentEngineParams), status, emotion, role_id, role_snapshot, segment_kind, prosody_marks, overrides, generated_voice_id, duration_sec |
| `Chapter` | id, name, engine, voice params, segments[], default_params, split_config, original_text, design_title |
| `SegmentedProject` | id, name, chapters[], source_document, default_narrator_role_id, default_narrator_snapshot, active_narration_version, remotion_project_path |
| `Role` | id, name, avatar, description, role_kind (`narrator`/`cast`), default_engine, default_voice, default_engine_params, favorite_styles |
| `EmotionType` | happy, sad, angry, calm, neutral, excited |
| `SegmentStatus` | idle, queued, pending, ready, failed |

### Segment Engine Params

```typescript
interface SegmentEngineParams {
  engine: 'cosyvoice' | 'edge_tts' | 'mimo_tts' | 'voxcpm';
  // CosyVoice
  voice_id?, instruction?, speed?, volume?, pitch?, language?, enable_ssml?, enable_markdown_filter?;
  // Edge-TTS
  edge_voice?, edge_rate?, edge_volume?;
  // MiMo-TTS
  mimo_mode? ('preset'|'voiceclone'|'voicedesign'), mimo_preset_voice?, mimo_clone_voice_id?, mimo_instruction?, mimo_voice_description?;
  // VoxCPM
  voxcpm_mode? ('tts'|'design'|'clone'|'ultimate'), voice_id?, voxcpm_voice_description?, voxcpm_style_control?, voxcpm_prompt_text?, voxcpm_cfg_value?, voxcpm_inference_timesteps?;
}
```

---

## 9. Environment Configuration

See `docs/ENV.md` for the full list of 27 environment variables. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `sqlite:///./voice_clone.db` | Backend database |
| `QWEN_API_KEY` | — | Qwen CosyVoice API key |
| `MIMO_API_KEY` | — | MiMo TTS API key |
| `MIMO_BASE_URL` | `https://api.xiaomimimo.com/v1` | MiMo API endpoint |
| `LLM_API_KEY` | Falls back to `MIMO_API_KEY` | LLM correction key |
| `LLM_MODEL` | `mimo-v2.5-pro` | LLM model |
| `FUNASR_MODEL` | `paraformer-zh` | FunASR model |
| `FUNASR_DEVICE` | Auto-detect | cuda > mps > cpu |
| `VOXCPM_MODEL_PATH` | `openbmb/VoxCPM2` | VoxCPM HuggingFace model |
| `VOXCPM_DEVICE` | `auto` | VoxCPM compute device |

---

## 10. API Endpoints Summary

See `docs/api-reference.md` for full request/response documentation.

| Group | Endpoint | Method | Purpose |
|-------|----------|--------|---------|
| Clone | `/api/clone/upload` | POST | Upload audio file |
| Clone | `/api/clone/upload-from-url` | POST | Download audio from URL |
| Clone | `/api/clone/create-clone` | POST | CosyVoice register |
| Clone | `/api/clone/create-clone-mimo` | POST | MiMo mark for clone |
| Clone | `/api/clone/create-clone-voxcpm` | POST | VoxCPM mark for clone |
| Clone | `/api/clone/create-from-design` | POST | Create VoiceProfile from design |
| Clone | `/api/clone/{id}/preview-audio` | PATCH | Save clone preview audio |
| Clone | `/api/clone/list` | GET | List voices |
| TTS | `/api/tts/synthesize` | POST | CosyVoice/Edge synthesis |
| TTS | `/api/tts/voices` | GET | Cloned voices |
| TTS | `/api/tts/edge-voices` | GET | Edge-TTS voices |
| MiMo | `/api/mimo-tts/preset` | POST | Preset voice synthesis |
| MiMo | `/api/mimo-tts/voicedesign` | POST | Text-described voice (`optimize_text_preview=false`) |
| MiMo | `/api/mimo-tts/voiceclone` | POST | Clone synthesis |
| VoxCPM | `/api/voxcpm/tts` | POST | Basic TTS |
| VoxCPM | `/api/voxcpm/design` | POST | Voice design |
| VoxCPM | `/api/voxcpm/clone` | POST | Controllable clone |
| VoxCPM | `/api/voxcpm/ultimate-clone` | POST | Ultimate clone |
| Split | `/api/text-split/rule` | POST | Rule-based split |
| Split | `/api/text-split/llm` | POST | LLM semantic split |
| STT | `/api/speech-to-text/transcribe` | POST | Single transcription |
| LLM | `/api/subtitle-llm/correct` | POST | Subtitle correction |
| LLM | `/api/subtitle-llm/translate` | POST | Bilingual translation |
| Roles | `/api/roles` | CRUD | Role management |
| Projects | `/api/segmented-projects` | CRUD | Project management |

---

## 11. Backend Storage

When `storageMode = backend`:

- Three tables: `segmented_projects` / `segmented_project_chapters` / `segmented_project_segments`
- Audio stored in `uploads/segmented/{project_id}/`
- Backend is authoritative; IndexedDB is draft cache with `base_updated_at` conflict detection (2000ms tolerance)
- Migration from IndexedDB prompted when switching to backend mode
- Audio transcoded via ffmpeg to mp3
