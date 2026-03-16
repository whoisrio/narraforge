# Contributing to Voice Clone Studio

## Development Environment Setup

### Prerequisites

- Python 3.10+
- Node.js 18+
- npm

### Installation

```bash
# Backend
cd backend
python -m venv .venv
source .venv/Scripts/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt

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
```

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
source .venv/Scripts/activate
python -m uvicorn main:app --host 127.0.0.1 --port 8002
```

## Project Structure

```
voice_clone/
├── backend/
│   ├── app/
│   │   ├── api/       # API routes
│   │   ├── core/      # Core utilities
│   │   ├── models/    # Database models
│   │   └── services/  # Business logic
│   ├── uploads/       # Uploaded files
│   ├── main.py        # FastAPI app
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/     # React pages
│   │   ├── components/# React components
│   │   └── api/       # API client
│   └── package.json
└── docs/
    └── plans/         # Design documents
```

## API Endpoints

### Clone API (`/api/clone`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/upload` | Upload audio file |
| POST | `/create-clone` | Register cloned voice |
| GET | `/list` | List all voices |
| GET | `/audio/{voice_id}` | Get audio file |
| GET | `/{voice_id}` | Get voice details |
| DELETE | `/{voice_id}` | Delete voice |
| POST | `/synthesize` | Synthesize with cloned voice |
| GET | `/cloned_audio/{audio_id}` | Get synthesized audio |

### TTS API (`/api/tts`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/synthesize` | Single TTS synthesis |
| POST | `/batch` | Batch TTS synthesis |
| GET | `/audio/{audio_id}` | Get TTS audio |
| GET | `/voices` | List available voices |

### Timeline API (`/api/timeline`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/project` | Create project |
| GET | `/project` | List projects |
| GET | `/project/{project_id}` | Get project details |
| POST | `/project/{project_id}/video` | Upload video |
| GET | `/video/{project_id}` | Get project video |
| POST | `/project/{project_id}/segment` | Add segment |
| DELETE | `/segment/{segment_id}` | Delete segment |
| POST | `/project/{project_id}/synthesize` | Synthesize all segments |

### Config API (`/api/config`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/models` | List TTS models |
| POST | `/models` | Add TTS model |
| PUT | `/models/{config_id}` | Update model |
| DELETE | `/models/{config_id}` | Delete model |
| POST | `/models/{config_id}/set-default` | Set default model |

## Testing

```bash
# Backend - Start and test manually
python -m uvicorn main:app --host 127.0.0.1 --port 8002

# Test API endpoints
curl http://127.0.0.1:8002/health
```

## Tech Stack

- **Backend**: FastAPI, SQLAlchemy, SQLite
- **Frontend**: React 19, TypeScript, Vite
- **TTS**: Qwen CosyVoice API