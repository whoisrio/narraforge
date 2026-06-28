# NarraForge

> [English](README.md)

一站式 AI 叙事工坊，集成声音克隆、文字转语音、语音转字幕。专为旁白与对话制作设计，支持多角色音色项目管理。

![NarraForge 首页](frontend/src/assets/frontpage-2.png)

## 亮点

- **旁白 + 对话** — 分段编辑器，角色分配、感情标签、逐段音色覆盖
- **免费离线 TTS** — Edge-TTS 和 VoxCPM 开箱即用，无需 API Key
- **声音克隆** — 上传样本即可获得可复用的克隆音色（VoxCPM 免费本地 / CosyVoice 付费 / MiMo 付费）
- **语音转字幕** — Whisper（多语言）或 FunASR（中文优化，CPU 比实时快 30 倍）
- **LLM 驱动** — 智能分句、感情分析、字幕校准、双语翻译

## 截图

### 单段合成
![单段合成](docs/screenshots/tts-single.png)

### 分段编辑器
![分段编辑器](docs/screenshots/tts-segmented.png)

### 编辑面板
![编辑面板](docs/screenshots/tts-edit-panel.png)

## 支持的引擎

### 文字转语音

| 引擎 | 费用 | 亮点 |
|------|------|------|
| **Edge-TTS** | 免费 | 离线，400+ 音色，无需 API Key |
| **VoxCPM** | 免费 | 本地高保真声音克隆，无需 API Key |
| **CosyVoice (Qwen)** | 付费 | 云端声音克隆，注册一次反复使用 |
| **MiMo TTS** | 付费 | 预置音色 / 文本描述设计 / 音频复刻 |

### 声音克隆

| 引擎 | 费用 | 机制 | 适用场景 |
|------|------|------|----------|
| **VoxCPM** | 免费 | 上传 → 本地高保真复刻 | 默认选择，无需 API Key |
| **CosyVoice** | 付费 | 上传 → 云端注册 → 持久化 voice_id | 批量合成、反复使用 |
| **MiMo** | 付费 | 上传 → 即时复刻（无状态） | 快速试听、一次性使用 |

### 语音识别

| 引擎 | 语言 | 速度 | GPU |
|------|------|------|-----|
| **Whisper** | 100+ 语言 | RTF~0.1 | CUDA |
| **FunASR** | 中文优化 | RTF~0.03 | CUDA / MPS |

## 分段编辑器

专业级长文本旁白时间轴：

- **智能拆分** — LLM 语义分析或标点规则拆分
- **逐段感情** — 自动识别（欣喜 / 激昂 / 沉稳 / 中性 / 沉重 / 愤怒），支持手动调整
- **角色分配** — 旁白和台词角色，各自独立音色配置
- **音色覆盖** — 全局音色 + 逐段自定义，已生成段落不受全局切换影响
- **过期检测** — 全局音色变更后自动标记旧段落
- **全部播放** — 顺序播放，逐字高亮同步
- **导出** — 音频（WAV/MP3）和 SRT 字幕

## 技术栈

- **前端：** React 19 + TypeScript + Vite + IndexedDB
- **后端：** Python 3.12+ / FastAPI / SQLAlchemy / SQLite
- **TTS：** Edge-TTS、VoxCPM、CosyVoice、MiMo
- **STT：** Faster-Whisper、FunASR
- **LLM：** MiMo-v2.5-pro（分句、感情、校准、翻译）

## 快速开始

### 环境要求

- Node.js >= 18
- Python >= 3.12
- Qwen API Key（可选，用于 CosyVoice — [获取地址](https://dashscope.console.aliyun.com/)）
- MiMo API Key（可选 — [获取地址](https://xiaomimimo.com)）

### 1. 后端

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate

uv sync
cp .env.example .env   # 编辑填入 API Key

uv run uvicorn main:app --host 127.0.0.1 --port 8002 --reload
```

### 2. 前端

```bash
cd frontend
npm install
npm run dev
```

打开 `http://localhost:5173`。

### Docker

```bash
docker-compose up --build
```

## 配置

核心环境变量（`backend/.env`）：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `QWEN_API_KEY` | 千问 API 密钥 | 可选（CosyVoice） |
| `MIMO_API_KEY` | MiMo API 密钥 | 可选（MiMo + LLM） |
| `DATABASE_URL` | 数据库路径 | `sqlite:///./voice_clone.db` |
| `FUNASR_MODEL` | FunASR 模型 | `paraformer-zh` |

完整配置见 `docs/ENV.md`。

## License

MIT
