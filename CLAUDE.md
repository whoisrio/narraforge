# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Voice Clone Studio - A web application for voice cloning and text-to-speech synthesis using Qwen CosyVoice API.

## Commands

### Frontend
```bash
cd frontend
npm run dev      # Start dev server (port 5173)
npm run build    # Production build
npm run lint     # Run ESLint
```

### Backend
```bash
cd backend
source .venv/Scripts/activate  # Windows: .venv\Scripts\activate
python -m uvicorn main:app --host 127.0.0.1 --port 8002
```

### API Testing
```bash
curl http://127.0.0.1:8002/health
```

## Architecture

### Backend (FastAPI)
- `app/api/` - Route handlers (clone, tts, timeline, config)
- `app/models/` - SQLAlchemy ORM models
- `app/services/` - Business logic
- `app/core/` - Utilities and config

### Frontend (React + TypeScript + Vite)
- `src/pages/` - Route pages
- `src/components/` - Reusable UI components
- `src/api/` - Axios API client

### Database
SQLite at `backend/voice_clone.db` with models:
- VoiceProfile (cloned voices)
- TTSConfig (model configurations)
- TimelineProject (projects)
- TimelineSegment (segments)

### Key APIs
- `/api/clone/*` - Voice cloning (upload, create, synthesize)
- `/api/tts/*` - Text-to-speech
- `/api/timeline/*` - Video timeline management
- `/api/config/*` - TTS model config

### Testing
All test must be in tests directory.

## Environment

Required in `backend/.env`:
- `QWEN_API_KEY` - Qwen API key for voice services
- `DATABASE_URL` - SQLite connection string

## Notes

- Backend runs on port 8002 (not default 8000)
- Frontend proxies API requests to backend
- Uploaded files stored in `backend/uploads/`