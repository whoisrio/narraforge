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

## gstack

Use `/browse` for all web browsing tasks. Never use `mcp__claude-in-chrome__*` tools.

Available gstack skills:
- `/office-hours` - Async office hours for team sync
- `/plan-ceo-review` - Plan CEO-level product review
- `/plan-eng-review` - Plan engineering review
- `/plan-design-review` - Plan design review
- `/design-consultation` - Design consultation workflow
- `/design-shotgun` - Rapid design feedback
- `/review` - Code review workflow
- `/ship` - Ship code to production
- `/land-and-deploy` - Land and deploy changes
- `/canary` - Canary deployment workflow
- `/benchmark` - Performance benchmarking
- `/browse` - Headless browser for QA testing
- `/connect-chrome` - Connect to Chrome browser
- `/qa` - Full QA testing workflow
- `/qa-only` - QA-only testing mode
- `/design-review` - Design review workflow
- `/setup-browser-cookies` - Setup browser cookies
- `/setup-deploy` - Configure deployment
- `/retro` - Team retrospective
- `/investigate` - Investigation workflow
- `/document-release` - Document release notes
- `/codex` - Code navigation and search
- `/cso` - Customer support operations
- `/autoplan` - Automated planning
- `/careful` - Careful mode for risky changes
- `/freeze` - Freeze codebase changes
- `/guard` - Guard against bad commits
- `/unfreeze` - Unfreeze codebase
- `/gstack-upgrade` - Upgrade gstack

## Environment

Required in `backend/.env`:
- `QWEN_API_KEY` - Qwen API key for voice services
- `DATABASE_URL` - SQLite connection string

## Notes

- Backend runs on port 8002 (not default 8000)
- Frontend proxies API requests to backend
- Uploaded files stored in `backend/uploads/`

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review