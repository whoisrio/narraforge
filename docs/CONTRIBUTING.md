# Contributing to NarraForge

## Development Environment Setup

### Prerequisites

- Python 3.12+
- Node.js 18+
- npm
- ffmpeg (required for segmented editor backend audio transcoding)

### Installation

```bash
# Backend
cd backend
uv sync

# Frontend
cd frontend
npm install
```

### Environment Variables

Create `backend/.env` file:

```env
APP_NAME="Voice Clone Studio"
DEBUG=true
DATABASE_URL=sqlite:///./voice_clone.db
QWEN_API_KEY=your-api-key-here
QWEN_MODEL=cosyvoice-v3.5-plus
MIMO_API_KEY=your-mimo-api-key  # Optional, for MiMo TTS
```

See `docs/ENV.md` for the full list of environment variables.

## Available Scripts

### Frontend

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Production build with type checking |
| `npm run lint` | Run ESLint |
| `npm run preview` | Preview production build |

### Backend

```bash
# Start backend on port 8002
cd backend
uv run uvicorn main:app --host 127.0.0.1 --port 8002 --reload
```

### Testing

```bash
# Backend tests
cd backend && uv run --extra test pytest -q

# Frontend tests
cd frontend && npm test

# API health check
curl http://127.0.0.1:8002/health
```

## Project Structure

```
narraforge/
├── backend/
│   ├── app/
│   │   ├── api/                   # API route handlers
│   │   │   ├── clone.py           # Voice cloning endpoints
│   │   │   ├── tts.py             # CosyVoice / Edge-TTS synthesis
│   │   │   ├── mimo_tts.py        # MiMo TTS endpoints
│   │   │   ├── voxcpm.py          # VoxCPM TTS endpoints
│   │   │   ├── config.py          # TTS config CRUD
│   │   │   ├── model_config.py    # Model provider config (API keys, etc.)
│   │   │   ├── text_split.py      # Rule-based and LLM text splitting
│   │   │   ├── speech_to_text.py  # Whisper / FunASR transcription
│   │   │   ├── subtitle_llm.py    # LLM-assisted subtitle generation
│   │   │   ├── segmented_projects.py  # Segmented project CRUD + synthesis
│   │   │   ├── sources.py         # Source document management
│   │   │   ├── narrations.py      # Narration record management
│   │   │   └── roles.py           # Voice role management
│   │   ├── core/                  # Configuration, database, shared utilities
│   │   ├── models/                # SQLAlchemy ORM models
│   │   │   ├── voice_profile.py
│   │   │   ├── tts_config.py
│   │   │   ├── tts_result.py
│   │   │   ├── transcription_record.py
│   │   │   ├── segmented_project.py
│   │   │   ├── system_config.py
│   │   │   ├── narration.py
│   │   │   └── role.py
│   │   ├── services/              # Business logic
│   │   │   ├── qwen_tts_service.py
│   │   │   ├── edge_tts_service.py
│   │   │   ├── mimo_tts_service.py
│   │   │   ├── voxcpm_service.py
│   │   │   ├── funasr_service.py
│   │   │   ├── llm_client.py
│   │   │   ├── llm_subtitle_service.py
│   │   │   ├── text_split_service.py
│   │   │   ├── segmented_project_service.py
│   │   │   ├── source_document_service.py
│   │   │   ├── role_service.py
│   │   │   ├── voice_to_srt_service.py
│   │   │   └── qiniu_service.py
│   │   └── schemas/               # Pydantic request/response schemas
│   ├── tests/                     # Backend tests (unit, integration, manual)
│   ├── uploads/                   # Uploaded files (backend storage mode)
│   └── main.py                    # FastAPI application entry point
├── frontend/
│   ├── src/
│   │   ├── pages/                 # Page-level components
│   │   │   ├── Landing.tsx
│   │   │   ├── TTSSynthesis.tsx
│   │   │   ├── VoiceClone.tsx
│   │   │   ├── SpeechToText.tsx
│   │   │   ├── ModelConfig.tsx
│   │   │   └── SourceLibrary.tsx
│   │   ├── components/
│   │   │   ├── TTSSynthesis/      # TTS synthesis panels and controls
│   │   │   ├── SegmentedTTS/      # Segmented editor UI
│   │   │   ├── TTS/               # Shared TTS controls
│   │   │   ├── VoiceClone/        # Voice cloning UI
│   │   │   ├── SpeechToText/      # Transcription UI
│   │   │   ├── VoiceStudio/       # Voice studio components
│   │   │   ├── AppShell/          # App shell layout
│   │   │   ├── ProjectHub/        # Project hub
│   │   │   ├── ProjectLibrary/    # Project library
│   │   │   ├── ProjectOverview/   # Project overview
│   │   │   ├── ProjectSettings/   # Project settings
│   │   │   ├── ProjectShell/      # Project shell layout
│   │   │   ├── ProjectVoices/     # Project voice management
│   │   │   ├── SourceLibrary/     # Source library components
│   │   │   └── ui/                # Shared UI primitives
│   │   ├── hooks/                 # Custom React hooks
│   │   │   ├── useSegmentedProject.ts
│   │   │   ├── useSegmentedDraftSync.ts
│   │   │   ├── useStorageMode.ts
│   │   │   ├── useTheme.tsx
│   │   │   ├── useTranscription.ts
│   │   │   ├── useVoiceRefresh.tsx
│   │   │   └── useCountUp.ts
│   │   ├── services/              # Frontend service utilities
│   │   │   ├── api.ts             # API client
│   │   │   ├── indexedDB.ts       # IndexedDB storage
│   │   │   ├── segmentedProjectDB.ts
│   │   │   ├── segmentedProjectStorage.ts
│   │   │   ├── audioConcat.ts     # Audio concatenation
│   │   │   ├── audioTrim.ts       # Audio trimming
│   │   │   └── segmentedDraftStore.ts
│   │   └── styles/                # Global styles and design tokens
│   └── package.json
├── docs/                          # Documentation
│   ├── feature-spec.md
│   ├── api-reference.md
│   ├── database-schema.md
│   ├── ENV.md
│   ├── RUNBOOK.md
│   ├── CONTRIBUTING.md
│   └── design/                    # UI design guidelines
└── tests/
    └── e2e/                       # Cross-stack E2E tests
```

## API Endpoints

### Clone API (`/api/clone`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/upload` | Upload audio file for voice cloning |
| POST | `/upload-from-url` | Upload audio from URL |
| POST | `/create-clone` | Create cloned voice via Qwen |
| POST | `/create-clone-mimo` | Create cloned voice via MiMo |
| POST | `/create-clone-voxcpm` | Create cloned voice via VoxCPM |
| POST | `/create-from-design` | Create voice from text design |
| PATCH | `/{voice_id}/preview-audio` | Update voice preview audio |
| GET | `/list` | List all voices |
| GET | `/list-from-qwen` | List voices from Qwen API |
| POST | `/sync-from-qwen` | Sync voices from Qwen |
| PATCH | `/{voice_id}/description` | Update voice description |
| GET | `/audio/{voice_id}` | Get audio file |
| GET | `/{voice_id}` | Get voice details |
| DELETE | `/{voice_id}` | Delete voice |

### TTS API (`/api/tts`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/synthesize` | Single TTS synthesis (CosyVoice or Edge-TTS) |
| POST | `/batch` | Batch TTS synthesis |
| GET | `/audio/{audio_id}` | Get TTS audio |
| GET | `/history` | List synthesis history |
| DELETE | `/history/{result_id}` | Delete history entry |
| GET | `/voices` | List available voices |
| GET | `/edge-voices` | List Edge-TTS voices |
| GET | `/edge-languages` | List Edge-TTS languages |

### MiMo TTS API (`/api/mimo-tts`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/preset` | Synthesize with preset voice |
| POST | `/voicedesign` | Synthesize with text-designed voice |
| POST | `/voiceclone` | Synthesize with cloned voice |
| POST | `/voiceclone-direct` | Synthesize with direct audio clone |
| GET | `/voices` | List MiMo preset voices |

### Speech-to-Text API (`/api/speech-to-text`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/transcribe` | Transcribe audio (Whisper or FunASR) |
| POST | `/multi-transcribe` | Multi-model transcription |
| GET | `/download/{file_id}` | Download SRT file |
| GET | `/history` | List transcription history |
| DELETE | `/history/{record_id}` | Delete history entry |
| GET | `/audio/{record_id}` | Get transcription audio |

### Segmented Projects API (`/api/segmented-projects`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List all projects |
| POST | `/` | Create project |
| GET | `/{project_id}` | Get project details |
| PUT | `/{project_id}` | Update project |
| DELETE | `/{project_id}` | Delete project |
| POST | `/{project_id}/split` | Split text into segments |
| POST | `/{project_id}/synthesize-segment` | Synthesize a single segment |
| GET | `/{project_id}/segment-audio/{segment_id}` | Get segment audio |
| GET | `/{project_id}/export` | Export project |
| POST | `/migrate` | Migrate audio to backend storage |
| POST | `/apply-animation-spec` | Apply animation specifications |

### Text Split API (`/api/text-split`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/rule` | Rule-based text splitting |
| POST | `/llm` | LLM-assisted text splitting |
| POST | `/ssml-annotate` | SSML annotation |
| POST | `/markdown-detect` | Detect markdown content |
| POST | `/markdown-split` | Split markdown into segments |

### Config API (`/api/config`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/models` | List TTS model configurations |
| POST | `/models` | Create TTS model configuration |
| PUT | `/models/{config_id}` | Update model configuration |
| DELETE | `/models/{config_id}` | Delete model configuration |
| POST | `/models/{config_id}/set-default` | Set default model |

### Model Config API (`/api/model-config`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Get all provider configurations (sensitive fields masked) |
| GET | `/public-key` | Get RSA public key for frontend encryption |
| GET | `/schema` | Get configuration schema |
| PUT | `/{provider}` | Update provider configuration |

## Tech Stack

- **Backend**: FastAPI, SQLAlchemy, SQLite, Python 3.12+
- **Frontend**: React 19, TypeScript, Vite
- **TTS Engines**: Qwen CosyVoice, MiMo-TTS, Edge-TTS, VoxCPM
- **Speech-to-Text**: Faster-Whisper, FunASR (ModelScope)
- **LLM**: Qwen (text splitting, subtitle generation, voice design)
- **Markdown**: react-markdown, @uiw/react-md-editor
- **Audio Processing**: ffmpeg (backend transcoding), Web Audio API (frontend)
- **Storage**: IndexedDB (frontend mode), SQLite + filesystem (backend mode)
