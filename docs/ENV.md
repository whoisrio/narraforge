# Environment Variables

All variables are read from `backend/.env` via Pydantic `BaseSettings`. Variable names are **case-insensitive** in the `.env` file (they are normalised to lowercase internally).

The `.env` file supports `${ENV_VAR}` and `${ENV_VAR:-default}` syntax for referencing other environment variables.

## Application

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `APP_NAME` | No | Application display name | `NarraForge` |
| `DEBUG` | No | Enable debug mode | `true` |

## Database

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `DATABASE_URL` | No | SQLAlchemy database connection string | `sqlite:///./voice_clone.db` |

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
| `FUNASR_MODEL` | No | FunASR model name. Options: `paraformer-zh`, `paraformer-zh-streaming` | `paraformer-zh` |
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
