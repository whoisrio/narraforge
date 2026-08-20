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
因此 core dependencies 必须可在 Pyodide 解析且是 workers 运行时真正需要的：local-only 依赖（langgraph 链、apscheduler、本地 ML、在线 SDK，以及步骤 5 移出的 uvicorn / sqlalchemy / pypinyin / pyyaml）都放在 extras（`local-ml` / `local-services`），不进 `[project.dependencies]`。
首次启动需下载 Pyodide 并 vendor，首个请求要初始化 Pyodide（冷启动 10s+）。

**坑 1：本地 fat .venv 会被整体打包。**
wrangler 的 Python 模块收集递归遍历项目根下的所有文件（不看 .gitignore），`backend/.venv`（含 torch/modelscope，1.5GB+）会被整体 attach 导致 wrangler 崩溃。
CI（Workers Builds）上 `uv sync` 不带 extras，venv 是瘦的，无此问题。
本地冒烟需在瘦身 staging 目录跑（拷出 `app/` + `main.py` + `workers_entry.py` + `wrangler.toml` + `pyproject.toml` + `uv.lock`，`uv sync --extra workers` 后启动）。

**坑 2：Pyodide 不支持线程。**
sync def 端点、sync 依赖函数、sync generator 依赖都会被 FastAPI 包进 `anyio.to_thread`，直接 `RuntimeError: can't start new thread`。
workers 可达链路上的端点/依赖必须 async——步骤 5 已全部 async 化，
`tests/unit/test_workers_async_deps.py` 的静态扫描（遍历 `create_app("workers")` 路由表）锁死回归，新增 sync 端点会立刻红。

**坑 4：core dependencies 决定 bundle 体积。**
`[project.dependencies]` 会整体 vendor 进 bundle（官方限制：gzip 后 Free 3MB / Paid 10MB，未压缩 64MB）。
workers 用不到的包必须放 extras：uvicorn / sqlalchemy / pypinyin / pyyaml 在 `local-services`；
workers 模式下 sqlalchemy/app.models 的 import 全部有守卫或延迟（`tests/unit/test_workers_no_sqlalchemy_import.py` 锁死）。
步骤 5 实测：`pywrangler deploy --dry-run` Total Upload 30.4MB / gzip 6.85MB（Paid 档内，Free 档 3MB 对 FastAPI 栈不可达——pydantic-core 一项就 4.4MB）。

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
- 后端认证中间件（`SupabaseAuthMiddleware`，`ACCESS_ENFORCEMENT=true` 默认开）把 `Cf-Access-Authenticated-User-Email` 头视为 legacy admin 通道放行——**该头只验存在性，必须同时设 `TRUST_CF_ACCESS_HEADER=true`**（默认关，防 Vercel 直连拓扑下客户端伪造）；Supabase 用户 JWT 经 JWKS 验签；匿名仅放行无状态 allowlist，其余 401 `auth_required`（详见下方 Vercel 章节与 `docs/api-reference.md`）。
- Supabase：执行 `backend/supabase/schema.sql` 迁移（含多用户 `user_id` 归属列与统计表）；`SUPABASE_SERVICE_KEY` 只放 Workers secrets。

---

## Vercel + Cloudflare Workers 静态资产 Deployment (free tier, 当前方案)

> 2026-08 变更：HF Spaces 已全面收费（免费 CPU 档取消），HF 方案弃用（见下一节，代码保留作参考）。
> 2026-08 再次变更：用户无自有域名，Cloudflare Access 无法保护 workers.dev 免费子域，
> Access + CF Worker 网关方案降级为「有自有域名时的可选加固」（见本节末）。
> 2026-08 三次变更：Pages 进入维护模式、新控制台默认建 Worker，前端改用
> **Workers Static Assets**（Pages 官方继任方案，静态请求免费，配置见 `frontend/wrangler.toml`）。
> 当前主线：**Vercel Hobby（免卡）跑后端 serverless 函数 + Cloudflare Workers 静态资产托管前端，
> Supabase Auth 邮箱登录 + 每用户数据隔离**——前端登录后逐请求带 `Authorization: Bearer <Supabase JWT>`。
> 2026-08 四次变更：共享口令解锁页替换为 Supabase Auth（`@supabase/supabase-js` 邮箱+密码）；
> 旧凭证（`ACCESS_TOKEN` / `GATEWAY_SECRET` / CF Access 邮箱头）保留为 legacy admin 通道；
> 无状态端点对匿名放行（见下「匿名 allowlist」），其余 401 `auth_required`。

```
浏览器 → CF Workers 静态资产（narraforge-web.<子域>.workers.dev，Supabase 邮箱登录）
              │ Authorization: Bearer <Supabase access_token>
              ▼
       Vercel Functions（<project>.vercel.app，Python runtime）
```

平台约束（2026-08 官方文档核实）：

- 请求体/响应体上限均为 **4.5MB**（413 `FUNCTION_PAYLOAD_TOO_LARGE`）。
  克隆音频上传已改道 Supabase Storage 直传（`capabilities.direct_storage_upload`），不经过函数体。
- 函数时长：Hobby（fluid compute，新项目默认开）默认/上限 **300s**；
  `backend/vercel.json` 已把 `maxDuration` 设为 300。
  出站调用超时由 `get_upstream_timeout()` 在 workers 模式 Cap 到 250s（留 50s 平台余量）。
- Python bundle 上限 **500MB**（未压缩）；`backend/.vercelignore` 已排除 tests/data/venv 等。
- 文件系统只读：workers 模式不建本地目录；日志文件打不开时自动降级为仅控制台（建议仍显式 `LOG_TO_FILE=false`）。

### 1. 建 Vercel 项目

1. Vercel Dashboard → Add New → Project → 导入 GitHub 仓库。
2. **Root Directory 设为 `backend`**。
3. 无需手填 build/install 命令：Vercel 自动发现 `backend/main.py` 顶层的 `app`
   （FastAPI 入口约定），用 uv 按 `backend/uv.lock` 安装依赖
   （`uv sync --no-dev`；edge-tts 经 `pyproject.toml` 的 `vercel-deploy` 默认依赖组进入安装集）。
   Python 版本由 `backend/.python-version`（3.12）指定。
4. Deploy。`DEPLOY_TARGET=workers` 由下方环境变量注入，`main.py` 底部的
   `app = create_app()` 读 settings 组装 workers 瘦版路由。

### 2. Vercel 环境变量清单

Project → Settings → Environment Variables（Production），完整示例见 `backend/env.vercel.example`：

| 变量 | 值 | 说明 |
|---|---|---|
| `DEPLOY_TARGET` | `workers` | 纯在线路由，不注册本地模型路由 |
| `ACCESS_TOKEN` | `openssl rand -hex 32` | 共享 Bearer 口令；Supabase Auth 上线后降级为 **legacy admin 通道**（命中即视为管理员，看全部用户数据），保留作运维兜底 |
| `ACCESS_ENFORCEMENT` | `true` | 默认开；workers 模式校验顺序：legacy 凭证（Access 邮箱头——需 `TRUST_CF_ACCESS_HEADER=true` / 网关密钥头 / Bearer 口令，任一满足即 legacy admin 放行）→ Supabase 用户 JWT → 匿名 allowlist 之外 401 `auth_required` |
| `TRUST_CF_ACCESS_HEADER` | **勿开**（默认 `false`） | 信任 CF Access 邮箱头作为 legacy admin 凭证；该头可伪造，仅 CF Access 前置的自有域名拓扑开启，Vercel 直连必须保持关闭 |
| `CORS_ORIGINS` | 前端域名（逗号分隔） | 如 `https://narraforge-web.<子域>.workers.dev` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | Supabase 项目值 | service key 只在后端 |
| `SUPABASE_JWT_AUD` | 一般不设 | 校验 Supabase 用户 JWT 的 `aud`，默认 `authenticated`；仅自定义 JWT 场景需改 |
| `ADMIN_EMAILS` | 管理员邮箱（逗号分隔） | JWT 邮箱在列表内才可访问 `/api/admin/*`（否则 403 `admin_required`）；legacy admin 恒通过 |
| `SUPABASE_STORAGE_BUCKET` | `voice-assets` | 须与 schema.sql 创建的 bucket 同名 |
| `ASSET_STORE_BACKEND` | `auto` | 无 R2 binding → Supabase Storage（函数 FS 临时，落盘会丢） |
| `MIMO_API_KEY` / `MIMO_BASE_URL` | 小米 MiMo key | 在线合成/克隆 |
| `APP_ENV` / `DEBUG` | `production` / `false` | |
| `LOG_TO_FILE` | `false` | 日志走 stdout（代码已容错只读 FS，显式关闭更干净） |
| `UPSTREAM_TIMEOUT_SECONDS` | 可选，默认 `120` | 出站 API 超时；workers 模式自动 Cap 到 250s，无需调 |
| `GATEWAY_SECRET` | 可选，留空 | 仅「自有域名 + CF Worker 网关」加固方案使用（见本节末），与网关 secret 一致 |

### 3. Cloudflare 前端配置（Workers 静态资产）

Pages 已进维护模式，前端用 **Workers Static Assets** 托管（`frontend/wrangler.toml`：
无脚本 Worker，`[assets] directory = "./dist"` + SPA 回退）。

1. Workers & Pages → Create → **Import a repository** → 选 narraforge 仓库。
2. 构建设置：Root Directory = `frontend`，Build command = `npm run build`，
   Deploy command 留默认（`npx wrangler deploy`）。
3. 环境变量（Settings → Variables and Secrets，**明文 Variables**，构建期可见）：

| 变量 | 值 | 说明 |
|---|---|---|
| `NODE_VERSION` | `22` | Vite 8 要求 |
| `VITE_API_BASE_URL` | `https://<project>.vercel.app/api` | 前端直连 Vercel 后端（含 `/api` 前缀） |
| `VITE_AUTH_REQUIRED` | `true` | 构建期开关：启用 Supabase 登录页 + axios 注入 access token（401 自动刷新重试）；本地开发不设，行为完全不变 |
| `VITE_SUPABASE_URL` | Supabase Project URL | 与后端 `SUPABASE_URL` 相同 |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon public key | 前端登录用（非 service key） |
| `VITE_SITE_URL` | `https://narraforge-web.<你的子域>.workers.dev` | 可选；构建期生成 `robots.txt` / `sitemap.xml`（Try 页 SEO，见下） |
| `VITE_ADMIN_EMAIL` | `admin@example.com` | 可选；配置后创作工作区侧栏底部展示「联系管理员」mailto 入口，留空不展示 |

`VITE_*` 是构建期打进去的，改完必须重新构建。

**Try 页（`/try`）**：Vite 多页入口（`frontend/try.html`），Workers Static Assets 默认
`html_handling = "auto-trailing-slash"`，`try.html` 自动以 `/try` 裸路径可达，无需额外 rewrite。
该页是匿名可用的 SEO 获客页（edge_tts 粘贴即转语音），匿名合成按 IP 限流
（`TRY_ANON_DAILY_LIMIT`，默认每日 50 次）；Supabase 侧需要 `rate_limit_counters` 表与
`hit_rate_limit` RPC——首次部署或升级时对库执行最新 `backend/supabase/schema.sql` 即可。
Workers 项目的 Deployments 菜单没有 Retry 按钮（那是 Pages 的），推一个空 commit 触发重建：
`git commit --allow-empty -m "chore: rebuild" && git push`。
部署后前端地址为 `https://narraforge-web.<你的子域>.workers.dev`，把它回填到
Vercel 的 `CORS_ORIGINS` 并 Redeploy。

登录/匿名流程：用户打开站点 → 登录页（`frontend/src/pages/Auth.tsx`，邮箱+密码登录/注册，
会话由 `@supabase/supabase-js` 管理）→ axios 拦截器逐请求带 `Authorization: Bearer <access_token>`，
401 时刷新 token 重试一次，仍 401 则回登录页。
未登录（匿名）也可使用无状态功能：存储固定为前端 IndexedDB（backend 存储选项隐藏），
非 allowlist 页面显示登录引导 CTA。

### 4. 验证部署

```bash
curl https://<project>.vercel.app/health
# → {"status": "healthy", ...}（探活在匿名 allowlist 内）
curl https://<project>.vercel.app/api/config/capabilities
# → 200（allowlist 内，匿名可读）
curl https://<project>.vercel.app/api/segmented-projects
# → 401 {"detail":{"code":"auth_required"}}（非 allowlist，无凭证被拒）
curl -H "Authorization: Bearer $ACCESS_TOKEN" https://<project>.vercel.app/api/segmented-projects
# → 200（legacy admin 通道，看全部行）
```

匿名 allowlist（精确/前缀匹配，全部无状态、不落用户数据）：
`GET /health`、`GET /`、`GET /api/config/capabilities`、`GET /api/config/storage-mode`、
`POST /api/tts/synthesize`（workers 模式仅 edge_tts 引擎；匿名不持久化，只回 base64）、`POST /api/mimo-tts/*`、
`POST /api/text-split/*`、`POST /api/subtitle-llm/*`、`POST /api/text-analysis/*`。
其余端点匿名一律 401 `auth_required`。

### Supabase 准备

1. Supabase Dashboard → Authentication → Providers，启用 **Email** 登录。
2. SQL Editor 执行 `backend/supabase/schema.sql`——除业务表与 `voice-assets` 私有桶外，
   现含多用户归属（`segmented_projects` / `voice_profiles` / `roles` / `source_documents` /
   `tts_results` 的 `user_id uuid` 列 + 索引）与统计表（`profiles` / `daily_stats` /
   `operation_logs` / `daily_active_users` + `increment_metric` RPC）。
3. 取 Project URL、service_role key（后端）与 anon key（前端）分别填 Vercel 与 CF Workers 环境变量。
4. **存量数据回填**（仅升级环境需要）：五张归属表中原有行 `user_id IS NULL`，登录用户看不到。
   先用 Supabase Auth 注册首个管理员账号（或在 Dashboard 手工建用户），再回填：
   ```bash
   cd backend
   uv run python -m scripts.backfill_user_ownership --user-id <uuid>           # dry-run（默认）
   uv run python -m scripts.backfill_user_ownership --user-id <uuid> --apply   # 执行（幂等）
   ```
5. Vercel 环境变量补 `ADMIN_EMAILS`（管理员邮箱，逗号分隔）；`SUPABASE_JWT_AUD` 一般用默认值。
6. **统计表保留期**：`operation_logs` 无自动清理，按需手动截断（Supabase SQL Editor）：
   ```sql
   delete from operation_logs where created_at < now() - interval '90 days';
   ```

### 可选加固：自有域名 + Access + CF Worker 网关

有自有域名时可在直连方案上加固：Pages 的 `VITE_API_BASE_URL` 改指 `https://api.<域名>/api`，
浏览器请求经 CF Worker 网关（`gateway/`，代码保留不动）注入 `X-Narraforge-Gateway-Secret`
共享密钥头转发到 Vercel，Vercel 侧配置 `GATEWAY_SECRET` 与之一致（此时 Bearer 口令可留用也可停用）。

```
浏览器 → Pages（前端）→ api.<域名>（CF Worker 网关，Access 保护）
                          │ 注入 X-Narraforge-Gateway-Secret（共享密钥）
                          ▼
                   Vercel Functions（<project>.vercel.app，Python runtime）
```

1. 改 `gateway/wrangler.toml` 的 `UPSTREAM_ORIGIN` 为 Vercel 部署域名（`https://<project>.vercel.app`）。
2. `cd gateway && npx wrangler secret put GATEWAY_SECRET`（与 Vercel 环境变量一致）；
   `npx wrangler secret put HF_TOKEN` 填任意占位串；`npx wrangler deploy` 绑路由 `api.<域名>/*`。
3. Zero Trust 建 Access 应用（self-hosted）覆盖 `api.<域名>`，邮箱 OTP、允许列表只填本人邮箱；
   Access CORS 放行 Pages 域名并允许 credentials；SSL/TLS 模式 **Full**。
4. `<project>.vercel.app` 直连子域无法关闭——靠后端 `GATEWAY_SECRET`/Access 头校验挡住
   （匿名仅放行 allowlist 无状态端点，其余 401 `auth_required`）。

---

## HF Spaces + Cloudflare Worker 网关 Deployment (已弃用 — HF 全面收费，保留作参考)

> 2026-08 再次变更：HF Spaces 已全面收费（免费 CPU 档取消），本方案弃用，
> 改用 Vercel（见上一节）。`hf-space/`、`backend/Dockerfile.cloud`、
> `scripts/sync-hf-space.sh` 保留作 Gradio/Docker 兜底代码参考。
>
> 原记录：Koyeb 被 Mistral 收购后控制台 404、免费路径冻结（原章节删除）；
> Render 要信用卡。本方案：**HF Spaces 免费 Docker 档（免卡）跑后端 + Cloudflare
> Worker 纯 JS 网关做域名入口**，Space 设私有、靠共享密钥防直连绕过。

```
浏览器 → Pages（前端）→ api.<域名>（CF Worker 网关，Access 保护）
                          │ 注入 X-Narraforge-Gateway-Secret（共享密钥）
                          │      Authorization: Bearer <HF_TOKEN>（私有 Space）
                          ▼
                   HF Space（Docker SDK，<user>-<space>.hf.space）
```

### 1. 建 Space

1. huggingface.co → New Space → SDK 选 **Docker**，硬件选 **CPU basic（免费）**，
   可见性选 **Private**（私有后所有请求需 `Authorization: Bearer <HF_TOKEN>`，
   由网关注入；`HF_TOKEN` 在 HF Settings → Access Tokens 建一个 read 权限的即可）。
2. Space 仓库内容不由手工维护，用同步脚本从主仓库生成（见第 3 步）。

> **如果 Docker SDK 在你的账户上要求付费**（2026-08 有用户反馈新建 Docker Space
> 时只显示付费硬件；多份公开资料仍标注免费 CPU 支持 Docker，可能是账户/区域差异），
> 改用 **Gradio SDK 兜底路径**：SDK 选 **Gradio**（确定免费），其余步骤相同，
> 仅同步命令加 `--sdk gradio`：
>
> ```bash
> scripts/sync-hf-space.sh --sdk gradio https://huggingface.co/spaces/<user>/<space>
> ```
>
> Gradio 路径不建 Docker 镜像：HF 直接 `pip install -r requirements.txt`（脚本用
> `uv export` 从锁文件生成，core + local-services，不含 torch）后跑 `app.py`
> （`hf-space/app.py`：起 uvicorn 服务 `backend/main:app`，不启用任何 Gradio 界面）。
> 注意：Gradio SDK 的 Python 版本由 README frontmatter 的 `python_version: "3.12"`
> 指定；若构建日志报 Python 版本不符，检查该字段是否被支持/生效。

### 2. Space Secrets 配置清单

Space → Settings → Variables and secrets（都建为 **Secrets**）：

| 变量 | 值 | 说明 |
|---|---|---|
| `GATEWAY_SECRET` | 随机长串 | 与 CF Worker 的 `GATEWAY_SECRET` secret 一致；后端据此放行网关注入的密钥头 |
| `ACCESS_ENFORCEMENT` | `true` | 默认开；workers 模式校验 Access 邮箱头**或**网关密钥头 |
| `CORS_ORIGINS` | Pages 域名（逗号分隔） | 如 `https://narraforge.pages.dev` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | Supabase 项目值 | service key 只在后端 |
| `SUPABASE_STORAGE_BUCKET` | `voice-assets` | 须与 schema.sql 创建的 bucket 同名 |
| `ASSET_STORE_BACKEND` | `auto` | 无 R2 binding → Supabase Storage（Space FS 临时，落盘会丢） |
| `MIMO_API_KEY` / `MIMO_BASE_URL` | 小米 MiMo key | 在线合成/克隆 |
| `APP_ENV` / `DEBUG` | `production` / `false` | |

`DEPLOY_TARGET=workers`、`LOG_TO_FILE=false`、`PORT=7860` 已由 `Dockerfile.cloud`
的 `ENV` 内置（7860 与 Space Docker SDK 的 `app_port` 一致），无需配置。

### 3. 同步代码到 Space

```bash
git clone https://huggingface.co/spaces/<user>/<space>   # 首次让脚本自己克隆亦可
scripts/sync-hf-space.sh https://huggingface.co/spaces/<user>/<space>
```

脚本把 `hf-space/README.md`（HF frontmatter）、`backend/Dockerfile.cloud`
（改名 `Dockerfile`）、`backend/` 全量（排除 .venv/.env/data 等）同步进 Space
克隆目录，确认后 commit + push 触发构建。细节见脚本头部注释；CI 自动同步见
`.github/workflows/deploy-hf-space.yml`（默认手动触发）。

注意：`Dockerfile.cloud` 本机未构建验证过（开发机无 Docker daemon），
首次 Space 构建即真实验证；构建失败先看 Space 构建日志里 `uv sync` 步骤。

### 4. 验证 Space

```bash
curl -H "Authorization: Bearer $HF_TOKEN" https://<user>-<space>.hf.space/health
# → {"status": "healthy"}
curl https://<user>-<space>.hf.space/health    # 不带 token → 401/403（私有 Space）
```

### 5. Cloudflare Worker 网关

见 `gateway/README.md`：`wrangler secret put GATEWAY_SECRET HF_TOKEN` →
`wrangler deploy` → 绑路由 `api.<域名>/*`。网关把请求原样转发到 Space 并注入
密钥头与 HF token。

### 6. Cloudflare 侧（Access + SSL）

1. Zero Trust 建 Access 应用（self-hosted）覆盖 `api.<域名>`，邮箱 OTP，
   允许列表只填本人邮箱；Access CORS 设置放行 Pages 域名并允许 credentials。
   与 Pages 前端同一个团队域。
2. `api.<域名>` 的 DNS 记录只是 Worker 路由占位（proxied，指向任意外部地址即可，
   路由命中后由 Worker 接管）；SSL/TLS 模式保持 **Full**（Worker 在边缘终止 TLS，
   回源 hf.space 走 HTTPS，天然有效证书，无 Flexible 回源 HTTP 问题）。
3. hf.space 直连子域无法关闭——靠两道防线：Space 私有（无 HF token 401）+
   后端 `GATEWAY_SECRET` 校验（无密钥头 401 `access_required`）。

### Supabase 准备

与 Render 章节相同：执行 `backend/supabase/schema.sql`（含 `voice-assets`
私有桶），取 Project URL 与 service_role key 填 Space Secrets。

---

## Render Deployment (free tier, 备选 — 实测要信用卡)

> 2026-08 实测：该账户在 Blueprint 和 New Web Service 流程均被强制要求填信用卡，
> 免费路径不可用，已改用 HF Spaces + CF 网关（见上一节）。本节保留作参考；render.yaml 仍在仓库根，
> 账户若能过反滥用校验可一键 Blueprint。

Workers 模式代码（`DEPLOY_TARGET=workers` 的瘦身路由 + Supabase 持久化）原样跑在
Render 免费档（CPython 正常运行时，非 Pyodide）。背景：Workers bundle 实测 gzip
6.7MB 超免费档 3MB 限制，全免费目标下后端改部署 Render；Workers 路径保留作付费
档备选（见上一节）。

运行差异（代码已自动适配，无需额外配置）：

- edge-tts 合成：无 `workers` 运行时自动回退 edge-tts 包（`local-services` extra）。
- 二进制资产（克隆样本/试听音频）：`ASSET_STORE_BACKEND=auto` + 无 R2 binding
  → Supabase Storage（Render 免费档文件系统临时，落盘会丢，不能写本地）。
- 持久化：Supabase PostgREST，与 Workers 模式同一代码路径。

### Blueprint 一键部署

仓库根有 `render.yaml`：Render Dashboard → New → Blueprint → 选仓库。
build：`pip install uv && cd backend && uv sync --extra local-services`；
start：`cd backend && uv run uvicorn main:app --host 0.0.0.0 --port $PORT`；
health check：`/health`。
**不要用 `backend/Dockerfile`**（local 全量构建含 torch，免费档装不下也不需要）。

手动建 Web Service 亦可：Runtime 选 Python 3，填同样的 build/start 命令。

### 环境变量清单

| 变量 | 值 | 说明 |
|---|---|---|
| `DEPLOY_TARGET` | `workers` | 纯在线路由，不注册本地模型路由 |
| `APP_ENV` / `DEBUG` | `production` / `false` | |
| `LOG_TO_FILE` | `false` | 日志走 stdout（Render FS 临时） |
| `ACCESS_ENFORCEMENT` | `true` | Cloudflare Access 头校验（默认开） |
| `CORS_ORIGINS` | Pages 域名（逗号分隔） | 如 `https://narraforge.pages.dev` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | Supabase 项目值 | service key 只在后端 |
| `SUPABASE_STORAGE_BUCKET` | `voice-assets` | 须与 schema.sql 创建的 bucket 同名 |
| `ASSET_STORE_BACKEND` | `auto` | 无 R2 binding → Supabase Storage |
| `MIMO_API_KEY` / `MIMO_BASE_URL` | 小米 MiMo key | 在线合成/克隆 |

`sync:false` 的项（CORS_ORIGINS、SUPABASE_*、MIMO_API_KEY）需在控制台手填。

### Supabase 准备

1. 免费档建项目，SQL Editor 执行 `backend/supabase/schema.sql`（末尾含
   `storage.buckets` 插入，自动建 `voice-assets` 私有桶；若该环境无 storage
   schema 报错，改在控制台 Storage → New bucket 手动建同名 Private 桶）。
2. 取 Project URL 与 service_role key 填到 Render 环境变量。

### 免费档休眠与冷启动

- 免费档 15 分钟无请求自动休眠，下一次请求冷启动数十秒（uv sync 产物在
  构建期已固定，冷启动只是进程拉起 + import，远快于 Pyodide 初始化）。
- 前端请求超时要容忍冷启动；`healthCheckPath=/health` 供 Render 探活。

### Cloudflare 侧（DNS + Access）

1. DNS：`api.<域名>` CNAME → `<service>.onrender.com`，开橙云代理。
2. Render 控制台给服务加同名自定义域名；证书自动签发。若签发卡住，
   先把 DNS 记录改灰云（DNS only）等签发完成再开回橙云。
3. Cloudflare SSL/TLS 模式须为 **Full**（Render 端有有效证书；不要用
   Flexible，会回源 HTTP 被重定向循环）。
4. Zero Trust 建 Access 应用覆盖 `api.<域名>`（同 Pages 前端一个团队域），
   邮箱 OTP，允许列表只填本人邮箱；Access CORS 设置放行 Pages 域名并允许
   credentials。后端 `ACCESS_ENFORCEMENT=true` 校验注入的邮箱头作纵深防御。
5. Render 自带 `onrender.com` 子域无法关闭直连——务必保证 Access 中间件开启
   （默认开），`onrender.com` 直连会被 401 挡住。

---

## Production Deployment

1. Set `DEBUG=false` in `.env`
2. Use production database (PostgreSQL recommended)
3. Configure reverse proxy (nginx)
4. Set up proper CORS origins
