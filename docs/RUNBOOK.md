# NarraForge - Runbook

## Quick Start

### Prerequisites

- Python 3.12+
- Node.js 18+
- ffmpeg (required for backend-mode audio transcoding)

### Development Environment

```bash
# Terminal 1 - Backend (port 8002)
cd backend
uv sync --extra local-ml --extra local-services
uv run uvicorn main:app --host 127.0.0.1 --port 8002 --reload

# Terminal 2 - Frontend
cd frontend
npm run dev
```

### Access Points

- Frontend: http://localhost:5173
- Backend API: http://127.0.0.1:8002
- API Docs: http://127.0.0.1:8002/docs

## Health Checks

| Endpoint | Purpose | Expected Response |
|----------|---------|-------------------|
| `GET /health` | Service health | `{"status": "ok"}` |
| `GET /` | Root endpoint | HTML page |

## Common Issues

### Backend Won't Start

1. **Port in use**: Change port to 8002
   ```bash
   uv run uvicorn main:app --host 127.0.0.1 --port 8002 --reload
   ```

2. **Missing dependencies**: Reinstall with uv
   ```bash
   cd backend && uv sync --extra local-ml --extra local-services
   ```
   If PyPI is unstable (common in China), use the Tsinghua mirror:
   ```bash
   uv sync --extra local-ml --extra local-services --index-url https://pypi.tuna.tsinghua.edu.cn/simple
   ```

3. **Database locked**: Delete and recreate
   ```bash
   rm backend/voice_clone.db
   # Restart backend - database recreates automatically
   ```

### Frontend Can't Connect to Backend

Check `frontend/vite.config.ts` proxy configuration points to correct port (8002).

### API Errors

1. Check backend console for error messages
2. Verify `.env` has the required API keys for your chosen engine
3. Ensure database file exists (`voice_clone.db`)

---

## TTS Engine Troubleshooting

### Edge-TTS (Default)

Edge-TTS requires no API key. It connects to Microsoft's online TTS service.

**Symptom**: "No audio received from edge-tts" or connection timeout.

- **Cause**: Network connectivity issue. Edge-TTS needs internet access to reach Microsoft servers.
- **Fix**:
  1. Check internet connection.
  2. If behind a corporate proxy, configure `HTTP_PROXY` / `HTTPS_PROXY` environment variables.
  3. Verify with: `curl -I https://speech.platform.bing.com`
  4. Increase timeout if on a slow connection (default: connect 10s, receive 30s in `edge_tts_service.py`).

**Symptom**: "edge_voice is required for edge_tts engine" (HTTP 400).

- **Cause**: No voice selected when using the edge_tts engine.
- **Fix**: Pass `edge_voice` parameter (e.g., `zh-CN-XiaoxiaoNeural`). List available voices via `GET /api/tts/edge-voices`.

### MiMo TTS (Xiaomi)

Requires `MIMO_API_KEY` in `.env` or configured via the Model Config UI.

**Symptom**: "MIMO_API_KEY is not configured (neither in UI nor .env)" (HTTP 500).

- **Cause**: Missing API key.
- **Fix**: Set `MIMO_API_KEY` in `backend/.env`, or configure via the Model Config page in the frontend UI.

**Symptom**: "MiMo TTS API error 401" or "MiMo TTS API error 403".

- **Cause**: Invalid or expired API key.
- **Fix**: Regenerate the key from the MiMo developer console. MiMo uses the `api-key` header (not Bearer auth).

**Symptom**: "MiMo TTS API error 429".

- **Cause**: Rate limit exceeded.
- **Fix**: Wait and retry. Reduce request frequency. Check your MiMo plan's rate limits.

**Symptom**: "MiMo TTS API connection error" or timeout.

- **Cause**: Cannot reach `https://api.xiaomimimo.com/v1`.
- **Fix**: Check internet connectivity. If needed, override `MIMO_BASE_URL` in `.env` for a different endpoint.

**Symptom**: "音频文件太大，Base64 编码后不能超过 10MB" (voice clone mode).

- **Cause**: Reference audio file exceeds ~7.5 MB raw (10 MB after base64 encoding).
- **Fix**: Use a shorter audio sample (30-60 seconds is sufficient for voice cloning).

### CosyVoice / Qwen TTS

Requires `QWEN_API_KEY` in `.env`.

**Symptom**: TTS synthesis fails with API authentication error.

- **Cause**: Missing or invalid Qwen API key.
- **Fix**: Set `QWEN_API_KEY` in `backend/.env`. Verify the key at the Qwen/DashScope console.

---

## Speech-to-Text Engine Troubleshooting

### FunASR (Local, Recommended for Chinese)

Uses ModelScope's Paraformer model. Models are downloaded from ModelScope (not HuggingFace).

**Symptom**: Model download hangs or fails.

- **Cause**: ModelScope download is slow or blocked in some network environments.
- **Fix**:
  1. Check internet connectivity to `modelscope.cn`.
  2. Models are cached at `~/.cache/modelscope/hub/`. If a partial download exists, delete the cached model directory and retry.
  3. Pre-download models manually if needed.

**Symptom**: "torch not found" or import errors on first run.

- **Cause**: `torchaudio` is an implicit dependency of FunASR and must be installed.
- **Fix**: `uv sync` should handle this. If not: `uv pip install torchaudio --python .venv/bin/python`

**Symptom**: Slow inference on CPU.

- **Cause**: FunASR Paraformer benefits significantly from GPU acceleration.
- **Fix**: If a CUDA or MPS GPU is available, FunASR auto-detects it. Set `FUNASR_DEVICE=cuda` or `FUNASR_DEVICE=mps` in `.env` to force a specific device. FunASR uses a thread lock for inference (PyTorch models are not thread-safe).

### Whisper (OpenAI)

Used as an alternative speech-to-text engine via the `speech_to_text` API.

**Symptom**: Slow transcription on CPU.

- **Fix**: Use a smaller model (`base` or `small` instead of `large`). If a GPU is available, Whisper will use it automatically.

---

## API Testing Workflow

### Voice Clone Workflow

1. **Upload audio** -> `POST /api/clone/upload`
2. **Create clone** -> `POST /api/clone/create-clone`
3. **List voices** -> `GET /api/clone/list`

### TTS Synthesis

4. **Synthesize** -> `POST /api/tts/synthesize`
   ```bash
   # Edge-TTS (no API key needed)
   curl -X POST http://127.0.0.1:8002/api/tts/synthesize \
     -H "Content-Type: application/json" \
     -d '{"text": "你好世界", "engine": "edge_tts", "edge_voice": "zh-CN-XiaoxiaoNeural"}'

   # CosyVoice (requires QWEN_API_KEY + cloned voice)
   curl -X POST http://127.0.0.1:8002/api/tts/synthesize \
     -H "Content-Type: application/json" \
     -d '{"text": "你好世界", "engine": "cosyvoice", "voice_id": "<voice_id>"}'
   ```

### MiMo TTS

5. **MiMo synthesis** -> `POST /api/mimo-tts/synthesize`
   ```bash
   curl -X POST http://127.0.0.1:8002/api/mimo-tts/synthesize \
     -H "Content-Type: application/json" \
     -d '{"text": "你好世界", "voice": "冰糖"}'
   ```

### Speech to Text

6. **Transcribe audio** -> `POST /api/speech-to-text/transcribe`

---

## Database

### Reset

```bash
cd backend
rm voice_clone.db
# Restart backend - database recreates automatically
```

### Migration Pattern

NarraForge uses lightweight schema migrations via `ALTER TABLE` statements in `backend/app/core/database.py`. These run automatically on startup and are idempotent (skip columns that already exist).

Migration phases currently include:

| Phase | Scope | Columns Added |
|-------|-------|---------------|
| P2 v2 | Segmented projects | narration document fields (version, slice, sync) |
| P2 v3 | Segmented projects | animation theme, Remotion path, animation_spec_json |
| P3 | Segments & projects | dialogue roles, prosody marks |
| P4 | Roles table | role_kind |
| P5 | Voice profiles | avatar |
| P6 | Voice profiles | original_audio_path, cloned_preview_path |
| P7 | Segmented projects | source_document |
| P8 | Voice profiles | prompt_text (VoxCPM reference transcript) |
| P9 | Voice profiles | project_id (project-scoped voices) |
| P10 | Voice profiles | voice_engine_type, engine_type, engine_sub_type, engine_params |

**Troubleshooting**: If a migration fails, check the backend startup log for `[migration] applied:` lines. The `_run_alter_or_skip` function catches "duplicate column" / "already exists" errors gracefully, so re-running is always safe. If a table does not exist yet, the `CREATE TABLE` from `Base.metadata.create_all` runs first.

---

## File Storage

### Paths (relative to `backend/`)

| Content | Path | Notes |
|---------|------|-------|
| Uploaded audio | `uploads/voices/` | Voice clone reference audio |
| Synthesized audio (clone voices) | `output/clone_voices/` | CosyVoice output |
| SRT subtitles | `uploads/srt/` | Speech-to-text output |
| Segmented project assets | `uploads/segmented/{project_id}/` | Per-project chapter/segment audio |
| Videos | `uploads/videos/` | Video uploads |
| Logs | `logs/` | Application logs |
| Database | `voice_clone.db` | SQLite (development) |

### Storage Modes

- **frontend** (default): Audio is stored in browser IndexedDB. No backend audio persistence. Synthesis returns base64 audio directly.
- **backend**: Audio is stored on the filesystem under the paths above, with metadata in SQLite.

To switch: configure via the System Config API or UI.

---

## ffmpeg

The segmented editor's backend mode uses ffmpeg to transcode and concatenate audio segments.

### Installation

- macOS: `brew install ffmpeg`
- Ubuntu/Debian: `apt-get install -y ffmpeg`
- Windows: Download from https://ffmpeg.org and add to PATH

### Troubleshooting

**Symptom**: "ffmpeg not found" or concatenation fails.

- **Cause**: ffmpeg is not installed or not on PATH.
- **Fix**: Install ffmpeg and ensure it is available on the system PATH. Verify with `ffmpeg -version`.

**Symptom**: Concatenated audio has gaps or artifacts.

- **Cause**: Segments have different sample rates or formats.
- **Fix**: The backend transcodes segments to a common format (mp3, 44100 Hz) before concatenation. If issues persist, check the source audio quality.

---

## LangGraph Dev Server Troubleshooting

**Symptom**: A run is created (backend/agent receives the request) but never executes — the SSE stream shows only `: heartbeat`, and the run stays `pending` forever (all assistants affected, not just one graph).

- **Cause**: The in-memory dev server persists its run queue in `agent/.langgraph_api/`. Runs that were mid-flight when a server was killed or hot-reloaded remain in `running` state forever (zombies). Once enough zombies accumulate, the single background worker stops dequeuing new runs, and restarting the server does NOT help — the poisoned queue is reloaded from disk.
- **Fix**: Stop `langgraph dev`, remove (or move aside) `agent/.langgraph_api/`, then restart. Threads/checkpoints are session-scoped, so this is safe:
  ```bash
  # from agent/
  mv .langgraph_api .langgraph_api.bak
  uv run langgraph dev --port 2024
  ```
- **Prevention**: Prefer stopping the dev server cleanly (Ctrl-C once, let it shut down) and avoid restarting it while a run is mid-execution.

---

## One-shot Maintenance Scripts

### Segmented-asset layout migration (v3.3, 2026-07)

Projects created before the human-readable rename use id-only filenames
(`source.md`, `{chapter_id}/`, `{segment_id}.mp3`). New projects use
name-embedded paths (`source-{project-name}-{id-short}.md`,
`chapter-{title}-{project-name}-{id-short}/`, `segment-{position:03d}-{id-short}.mp3`).

## Storage Migrations (unified data root)

应用数据统一收敛到 `backend/data/`（设计：`docs/superpowers/specs/2026-07-25-unified-data-root-asset-naming-design.md`）。
拉取包含该变更的代码后，**每个环境各执行一次**（脚本幂等，可重跑）：

```bash
# 1. 停后端；备份
cp backend/voice_clone.db backend/voice_clone.db.bak-pre-migration
tar -czf assets-backup-$(date +%Y%m%d).tgz backend/uploads backend/output

# 2. dry-run 审阅（不写盘）
cd backend
uv run python -m scripts.migrate_to_data_root            # 项目资产 → data/projects
uv run python -m scripts.migrate_to_unified_storage      # voices/tts-history/srt 归位

# 3. 执行
uv run python -m scripts.migrate_to_data_root --apply
uv run python -m scripts.migrate_to_unified_storage --apply

# 4. 起后端并抽查音频端点
```

说明：

- 无 flag day：读取端以 DB 存储路径为准，先升级代码、后择机迁移完全可行。
- 新部署环境无需任何迁移。
- `SEGMENTED_DIR` 等环境变量覆盖优先于默认值（自定义存储根的环境同样适用）。

---

## Cloudflare Workers Deployment

Workers 模式把瘦身后的 FastAPI 后端跑在 Cloudflare Workers Python（Pyodide）上。
设计文档：`docs/superpowers/specs/2026-08-10-cloudflare-workers-deploy-design.md`。
入口为 `backend/workers_entry.py`，配置为 `backend/wrangler.toml`（`main = "workers_entry.py"`，`compatibility_date = "2025-11-02"`，更早日期会报 `Method on_fetch does not exist`）。

### Prerequisites

```bash
cd backend
uv sync --extra workers   # 安装 workers-py（提供 pywrangler CLI）
```

### Local smoke (pywrangler dev)

```bash
cd backend
cp .dev.vars.example .dev.vars   # 填入 SUPABASE_SERVICE_KEY / MIMO_API_KEY
uv run --extra workers pywrangler dev --port 8787
```

`pywrangler dev` 会把 `[project.dependencies]` vendor 成 `python_modules`（Pyodide 平台解析）。
因此 core dependencies 必须可在 Pyodide 解析：local-only 依赖（langgraph 链、apscheduler、本地 ML、在线 SDK）都放在 extras（`local-ml` / `local-services`），不进 `[project.dependencies]`。
首次启动需下载 Pyodide 并 vendor，首个请求要初始化 Pyodide（冷启动 10s+）。

**坑 1：本地 fat .venv 会被整体打包。**
wrangler 的 Python 模块收集递归遍历项目根下的所有文件（不看 .gitignore），`backend/.venv`（含 torch/modelscope，1.5GB+）会被整体 attach 导致 wrangler 崩溃。
CI（Workers Builds）上 `uv sync` 不带 extras，venv 是瘦的，无此问题。
本地冒烟需在瘦身 staging 目录跑（拷出 `app/` + `main.py` + `workers_entry.py` + `wrangler.toml` + `pyproject.toml` + `uv.lock`，`uv sync --extra workers` 后启动）。

**坑 2：Pyodide 不支持线程。**
sync def 端点、sync 依赖函数、sync generator 依赖都会被 FastAPI 包进 `anyio.to_thread`，直接 `RuntimeError: can't start new thread`。
workers 可达链路上的端点/依赖必须 async（`main.py` 的 `/` 与 `/health`、`get_db`、仓储依赖 `app/core/repositories/deps.py`、`get_asset_store` 已 async 化）。
其余 workers 保留路由里的 sync 端点（约 50 个，grep `def ` handler）真实部署前需统一 async 化。

**坑 3：workers 运行时 FS 只读。**
`Settings` 在 `deploy_target=workers` 时跳过本地数据目录创建；`LOG_TO_FILE=false` 关闭文件日志。

### Deploy

```bash
cd backend
# 1. R2 资产桶（克隆样本/试听音频；wrangler.toml 的 bucket_name 占位符先改为实际桶名）
uv run --extra workers pywrangler r2 bucket create narraforge-assets

# 2. secrets（不进 wrangler.toml）
uv run --extra workers pywrangler secret put SUPABASE_SERVICE_KEY
uv run --extra workers pywrangler secret put MIMO_API_KEY

# 3. [vars] 占位符：SUPABASE_URL、CORS_ORIGINS（Pages 域名，逗号分隔多个）

# 4. 部署
uv run --extra workers pywrangler deploy
```

### Post-deploy checklist

- 关闭 workers.dev 子域路由（Dashboard → Workers → Settings → Domains & Routes），API 仅走受 Access 保护的自定义域名（防绕过，spec 3.6/5.2）。
- Zero Trust 控制台建 Access 应用（self-hosted），覆盖 Pages 域名与 API 域名两个 hostname；登录方式邮箱 OTP。
- Access 应用 CORS 设置放行 Pages 域名并允许 credentials；后端 `CORS_ORIGINS` 同步填 Pages 域名。
- 后端中间件校验 `Cf-Access-Authenticated-User-Email` 头作为纵深防御（`ACCESS_ENFORCEMENT=true`，默认开）；缺头返回 401 `access_required`。
- Supabase：执行 `backend/supabase/schema.sql` 迁移；`SUPABASE_SERVICE_KEY` 只放 Workers secrets。

---

## Production Deployment

1. Set `DEBUG=false` in `.env`
2. Use production database (PostgreSQL recommended)
3. Configure reverse proxy (nginx)
4. Set up proper CORS origins
