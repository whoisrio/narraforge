# Environment Variables

All variables are read from `backend/.env` via Pydantic `BaseSettings`. Variable names are **case-insensitive** in the `.env` file (they are normalised to lowercase internally).

The `.env` file supports `${ENV_VAR}` and `${ENV_VAR:-default}` syntax for referencing other environment variables.

## Application

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `APP_NAME` | No | Application display name | `NarraForge` |
| `DEBUG` | No | Enable debug mode | `true` |

## Deployment (Cloudflare Workers)

These variables select the deploy target and control workers-only behavior.
In Workers deployments they are set via `backend/wrangler.toml` `[vars]` (non-sensitive) and `wrangler secret put` / `.dev.vars` (secrets), not via `.env`.
See `docs/RUNBOOK.md` → "Cloudflare Workers Deployment".

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `DEPLOY_TARGET` | No | `local` (full routes, SQLite, local models) or `workers` (online routes only: Cloudflare Workers paid tier, or Render free tier under CPython) | `local` |
| `ACCESS_ENFORCEMENT` | No | Workers mode only: require authentication — a Supabase Auth user JWT (`Authorization: Bearer <jwt>`, verified via JWKS), or one of the legacy credentials (the `Cf-Access-Authenticated-User-Email` header injected by Cloudflare Access — honored only when `TRUST_CF_ACCESS_HEADER=true`, the `X-Narraforge-Gateway-Secret` gateway header, or an `Authorization: Bearer <ACCESS_TOKEN>` shared token, all treated as legacy admin). Anonymous requests are only allowed for a stateless allowlist (`/health`, `/`, config capabilities/storage-mode GET, stateless TTS/split POSTs); everything else gets 401 `auth_required`. Never enabled in local mode. | `true` |
| `ACCESS_TOKEN` | Workers deploys: yes | Shared Bearer token for the no-custom-domain direct setup (Pages frontend talks to Vercel directly; the unlock page sends `Authorization: Bearer <token>`). Generate with `openssl rand -hex 32`. Empty string disables this credential path. Never used in local mode. | `""` |
| `TRUST_CF_ACCESS_HEADER` | No | Trust the `Cf-Access-Authenticated-User-Email` header as a legacy-admin credential. The header is only checked for presence, so it is forgeable by any client unless a real Cloudflare Access edge proxy sits in front (custom-domain topology). Default off — enable ONLY for CF-Access-fronted deployments. Workers mode only | `false` |
| `MAX_PROJECTS_PER_USER` | No | Per-user backend project quota (workers mode, regular logged-in users only): creating a project is rejected with `409 project_limit_reached` once the user owns `>=` this many projects. `0` disables the quota. Legacy admins (old credential channels) and `ADMIN_EMAILS` users are exempt. Local mode never enforces it (single-tenant, no user concept) | `1` |
| `MAX_DESIGNED_VOICES_PER_USER` | No | Per-user designed-voice quota (workers mode, regular logged-in users only): saving another designed voice (`POST /clone/create-from-design` with engine `mimo`/`voxcpm`) is rejected with `409 designed_voice_limit_reached` once the user owns `>=` this many designed voices (`voice.voice_type == "design"`, global + project-scoped combined). `0` disables the quota. Preset saves and clone uploads do not count. Legacy admins and `ADMIN_EMAILS` users are exempt. Local mode never enforces it | `1` |
| `CORS_ORIGINS` | No | Workers mode only: comma-separated allowed CORS origins (set to the Pages domain at deploy time). Local mode always uses `*`. | `*` |
| `ASSET_STORE_BACKEND` | No | Binary asset store backend: `auto` (local mode → local FS; workers mode → R2 if a binding is injected, else Supabase Storage), or explicit `local` / `r2` / `supabase` | `auto` |
| `UPSTREAM_TIMEOUT_SECONDS` | No | Outbound HTTP timeout for upstream APIs (e.g. MiMo TTS). Workers mode caps the effective value at 250s (Vercel Hobby fluid function limit 300s minus 50s headroom); local mode uses the value as-is | `120` |
| `LOG_TO_FILE` | No | Write logs to `logs/app.log`. Set `false` in Workers (no writable persistent FS) and Render (ephemeral FS, log to stdout). On read-only filesystems (Vercel) the file handler is skipped automatically | `true` |

## Database

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `DATABASE_URL` | No | SQLAlchemy database connection string | `sqlite:///./voice_clone.db` |

## Supabase (workers deploy target only)

Required only when `DEPLOY_TARGET=workers`: the workers runtime has no raw sockets, so persistence goes through Supabase PostgREST over HTTPS instead of SQLAlchemy/SQLite. The service key must stay server-side (Workers secrets). Table DDL lives in `backend/supabase/schema.sql`.

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `SUPABASE_URL` | Yes (workers) | Supabase project URL (`https://<project>.supabase.co`) | *(empty)* |
| `SUPABASE_SERVICE_KEY` | Yes (workers) | Supabase service_role key (server-side only) | *(empty)* |
| `SUPABASE_STORAGE_BUCKET` | Yes (workers, no R2) | Supabase Storage bucket for binary assets (clone samples / preview audio) when no R2 binding exists (e.g. Render). Created by the `storage.buckets` insert at the end of `backend/supabase/schema.sql` (private bucket). | `voice-assets` |
| `SUPABASE_JWT_AUD` | No | Expected `aud` claim when verifying Supabase Auth user JWTs (workers mode, via JWKS at `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`). Supabase issues user tokens with `aud=authenticated`; change only for custom JWT setups | `authenticated` |
| `ADMIN_EMAILS` | No | Comma-separated admin email list (case-insensitive). Authenticated users whose JWT email is listed can access the admin stats API (`/api/admin/*`); legacy credentials (Access header / gateway secret / shared token) always count as admin. Workers mode only | `""` |

## Qwen / CosyVoice API (Voice Cloning)

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `QWEN_API_KEY` | Yes (for clone) | Qwen / DashScope API key for CosyVoice voice cloning | *(empty)* |
| `QWEN_MODEL` | No | CosyVoice model identifier | `qwen-tts` |

## MiMo TTS API (Xiaomi MiMo-V2.5-TTS)

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `MIMO_API_KEY` | Yes (for MiMo TTS) | Xiaomi MiMo TTS API key | *(empty)* |
| `MIMO_BASE_URL` | No | MiMo API base URL | `https://api.xiaomimimo.com/v1` |

## LLM (Subtitle Calibration / Translation)

These control the LLM used for subtitle calibration and translation. When left empty, `LLM_API_KEY` and `LLM_BASE_URL` automatically fall back to the MiMo configuration (`MIMO_API_KEY` / `MIMO_BASE_URL`).

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `LLM_API_KEY` | No | LLM API key (falls back to `MIMO_API_KEY`) | *(empty)* |
| `LLM_BASE_URL` | No | LLM API base URL (falls back to `MIMO_BASE_URL`) | *(empty)* |
| `LLM_MODEL` | No | LLM model identifier | `mimo-v2.5-pro` |

## FunASR (Local Speech Recognition)

FunASR runs locally and does not require an API key. Models are downloaded from ModelScope.

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `FUNASR_MODEL` | No | FunASR model name. Options: `paraformer-zh`（流式模型不支持离线字幕转写，已移除） | `paraformer-zh` |
| `FUNASR_DEVICE` | No | Compute device. Leave empty for auto-detection (`cuda` > `mps` > `cpu`) | *(empty -- auto)* |

## VoxCPM (Local GPU Voice Cloning)

VoxCPM is an optional local GPU-based voice cloning model from OpenBMB.

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `VOXCPM_MODEL_PATH` | No | HuggingFace model ID or local weight directory | `openbmb/VoxCPM2` |
| `VOXCPM_DEVICE` | No | Inference device: `auto`, `cuda`, `cuda:0`, `cpu` | `auto` |
| `VOXCPM_DTYPE` | No | Model dtype: `auto`, `float16`, `bfloat16` | `auto` |
| `VOXCPM_LOAD_ON_START` | No | Automatically load model at startup | `false` |
| `VOXCPM_INFERENCE_TIMESTEPS` | No | Denoising steps (higher = better quality, slower) | `10` |
| `VOXCPM_CFG_VALUE` | No | Classifier-Free Guidance strength | `2.0` |

## Public URL / Object Storage

Used for CosyVoice voice registration, which requires a publicly accessible audio URL.

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `PUBLIC_BASE_URL` | No | Public base URL for audio hosting. Use an ngrok URL for local dev, or your production domain. | *(empty)* |
| `OSS_AK` | No | Qiniu Cloud object storage access key | *(empty)* |
| `OSS_SK` | No | Qiniu Cloud object storage secret key | *(empty)* |
| `BUCKET_NAME` | No | Qiniu Cloud bucket name | *(empty)* |
| `BUCKET_DOMAIN` | No | Qiniu Cloud bucket domain | *(empty)* |

## Storage Paths

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `SEGMENTED_DIR` | No | Root of per-project asset dirs (segment audio, text mirrors). DB `audio.path` values are relative to this root. | `backend/data/projects` |

应用数据统一放在 `backend/data/` 下：

- `narration-repo/` — 文本版本库（git）
- `projects/` — 项目资产（段音频、文本镜像）
- `voices/profiles/` — 克隆样本原音；`voices/previews/` — 克隆/引擎试听
- `tts-history/` — TTS 历史音频
- `srt/` — 字幕识别产物
- `temp/` — 临时文件

`uploads/`、`output/` 为遗留目录，由 `scripts/migrate_to_data_root.py` 与 `scripts/migrate_to_unified_storage.py` 收敛（dry-run 默认，`--apply` 执行，幂等）。

## Logging

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `LOG_LEVEL` | No | Log level: `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL` | `INFO` |
| `LOG_FORMAT` | No | Python log format string | `%(asctime)s \| %(levelname)-8s \| %(name)s \| %(funcName)s:%(lineno)d \| %(message)s` |
| `LOG_TO_FILE` | No | Write logs to file | `true` |
| `LOG_FILE_MAX_BYTES` | No | Maximum log file size in bytes | `10485760` (10 MB) |
| `LOG_BACKUP_COUNT` | No | Number of rotated log backup files to keep | `7` |

## Security

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `CONFIG_ENCRYPTION_KEY` | No | Fernet symmetric encryption key for config encryption. Auto-generated on first startup if not set. | *(empty)* |

## ffmpeg (Segmented Editor)

Not an environment variable, but a **system dependency**. The backend transcodes segmented project audio to mp3 via ffmpeg. When ffmpeg is missing, it falls back to wav and writes `audio_format` to the database.

- macOS: `brew install ffmpeg`
- Ubuntu: `apt-get install -y ffmpeg`

## Narration Git Versioning

| Variable | Default | Purpose |
|---|---|---|
| `NARRATION_REPO_PATH` | `backend/data/narration-repo/` | Meta repo location. |
| `NARRATION_SNAPSHOT_ENABLED` | `1` | Set `0` to disable the daily snapshot job. |
| `NARRATION_SNAPSHOT_CRON` | `0 3 * * *` | APScheduler cron expression. |
| `NARRATION_GIT_AUTHOR_NAME` | `NarraForge Bot` | Commit author. |
| `NARRATION_GIT_AUTHOR_EMAIL` | `bot@narraforge.local` | Commit email. |

See `docs/narration-git-versioning.md` for the full feature description.

## Agent (LangGraph)

Agent variables live in `agent/.env` (a separate file from `backend/.env`).

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `BACKEND_API_URL` | No | NarraForge backend base URL. | `http://127.0.0.1:8002` |
| `AGENT_LLM_API_KEY` | Yes | LLM API key for narration + kv workflows. | *(empty)* |
| `AGENT_LLM_BASE_URL` | Yes | LLM API base URL. | *(empty)* |
| `AGENT_LLM_MODEL` | Yes | LLM model identifier. | *(empty)* |
| `LANGSMITH_API_KEY` | No | Enables hot-reload of prompts from LangSmith Hub. Falls back to code defaults when unset. | *(empty)* |
| `VOXCPM_DEFAULT_ROLE_ID` | Yes when `voxcpm` selected | Default clone role id used by the kv synthesis node when the user picks `voxcpm`. Synthesis halts when unset. | *(empty)* |

> **Deprecated:** `ANIMATION_ROOT_FOLDER` has been removed. The Remotion scaffold root is now a **global setting** managed in the backend DB and editable from the UI (`/settings` → “Remotion 脚手架根目录”). See `GET/PUT /api/config/animation-root`. Any leftover `ANIMATION_ROOT_FOLDER` entry in `agent/.env` is ignored.

## Minimal `.env` for Local Development

```bash
# Minimum viable config -- FunASR and Edge-TTS work out of the box with no keys
DATABASE_URL=sqlite:///./voice_clone.db
DEBUG=true

# Add these when you need CosyVoice voice cloning
# QWEN_API_KEY=sk-...

# Add these when you need MiMo TTS
# MIMO_API_KEY=your_mimo_key
```
