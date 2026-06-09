# CLAUDE.md

This file provides guidance to AI coding assistants when working with code in this repository.

## Project Overview

NarraForge — AI 叙事工坊，集成声音克隆、文字转语音、语音转字幕三大模块，未来扩展至基于分段叙事单元驱动的 Remotion 动画生成。

## Documentation

| 文档 | 路径 | 内容 |
|------|------|------|
| 功能规格 | [`docs/feature-spec.md`](docs/feature-spec.md) | 全部功能详细说明，含分段编辑器、感情色彩系统、项目持久化等 |
| API 参考 | [`docs/api-reference.md`](docs/api-reference.md) | 所有后端 API 端点、请求/响应格式、参数说明 |
| 数据库模型 | [`docs/database-schema.md`](docs/database-schema.md) | SQLAlchemy 模型、字段定义、表关系 |
| 环境变量 | [`docs/ENV.md`](docs/ENV.md) | 后端 .env 配置项 |
| 运维手册 | [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | 部署与运维指南 |
| 贡献指南 | [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) | 开发规范 |

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
uv sync                              # Install deps (uv managed, no pip)
uv run uvicorn main:app --host 127.0.0.1 --port 8002 --reload
```

### API Testing
```bash
curl http://127.0.0.1:8002/health
```

## Architecture

### Backend (FastAPI + Python 3.12+)
- `app/api/` — Route handlers (clone, tts, mimo_tts, text_split, speech_to_text, subtitle_llm, config, model_config)
- `app/models/` — SQLAlchemy ORM models (voice_profile, tts_config, tts_result, transcription_record, system_config, segmented_project)
- `app/services/` — Business logic (cosyvoice_service, edge_tts_service, llm_client, text_split_service, whisper_service, funasr_service)
- `app/core/` — Config, database, model_config_service
- Dependencies managed by **uv** (not pip). Install: `uv sync` or `uv pip install --python .venv/bin/python`

### Frontend (React 19 + TypeScript + Vite)
- `src/pages/` — TTSSynthesis, VoiceClone, SpeechToText, ModelConfig, Landing
- `src/components/TTSSynthesis/` — GlobalControlBar, EdgeTTSPanel, MiMoTTSPanel, AudioPlayer, SynthesisHistory
- `src/components/SegmentedTTS/` — SegmentList, SegmentRow, SegmentEditPanel, TextInputPanel, ExportDialog
- `src/hooks/` — useSegmentedProject (reducer + actions), useStorageMode, useVoiceRefresh, useTheme
- `src/services/` — api.ts (Axios), indexedDB.ts, segmentedProjectDB.ts, audioConcat.ts
- `src/styles/` — variables.css (design tokens), global.css
- CSS Modules with `camelCase` convention (`localsConvention: 'camelCase'`)

### Database
SQLite at `backend/voice_clone.db`. See [`docs/database-schema.md`](docs/database-schema.md) for full schema.

Key tables: VoiceProfile, TTSConfig, TTSResult, TranscriptionRecord, SystemConfig

### Storage Modes
- **frontend** — Audio stored in browser IndexedDB (default, no backend storage needed)
- **backend** — Audio stored in SQLite + filesystem (`backend/uploads/`)

## Key Design Decisions

- **Edge-TTS as default engine** — No API key needed, works offline
- **Warm amber color scheme** — `#c47a3a` primary (not purple)
- **CSS Modules camelCase** — `emo_happy` in CSS → `styles.emoHappy` in JS
- **Segmented project persistence** — Auto-saved to IndexedDB, debounced 1s
- **Emotion system** — LLM returns emotion per segment on smart split, 6 types (happy/sad/angry/calm/neutral/excited)
- **Global voice isolation** — Changing global voice only affects new/idle segments, not generated ones
- **Stale detection** — Segments track `generated_voice_id`, warn when global voice changes

## Environment

Required in `backend/.env`:
- `QWEN_API_KEY` — Qwen API key for CosyVoice
- `MIMO_API_KEY` — MiMo API key (optional, for MiMo TTS + LLM)
- `DATABASE_URL` — SQLite connection string (default: `sqlite:///./voice_clone.db`)

## Testing

All tests in `backend/tests/` directory. Run:
```bash
cd backend && uv run pytest
```

## Notes

- Backend runs on port **8002** (not default 8000)
- Frontend Vite proxy: `/api` → `http://127.0.0.1:8002`
- FunASR models download from ModelScope (not HuggingFace), cache at `~/.cache/modelscope/hub/`
- `torchaudio` is an implicit dependency of funasr, must be explicitly declared
- PyPI network may be unstable in China, use `--index-url https://pypi.tuna.tsinghua.edu.cn/simple`
