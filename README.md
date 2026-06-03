# Voice Studio

基于 **Qwen CosyVoice · MiMo TTS · Edge-TTS · Faster-Whisper · FunASR** 的 AI 音频工作站，将声音克隆、文字转语音、语音转字幕融为一体。

![Voice Studio 首页](frontend/src/assets/frontpage-2.png)

## 功能

| 模块 | 说明 |
|------|------|
| **声音复刻** | 上传音频样本，AI 复刻说话人音色与情感韵律，支持 CosyVoice 和 MiMo 两种引擎 |
| **文字转语音** | 输入文字即可生成自然语音，支持多引擎（CosyVoice / MiMo / Edge-TTS）、多语种、语速与音调调节 |
| **语音转字幕** | 音频/视频智能转写为高精度字幕，支持 GPU 加速、智能行拆分、LLM 校准与双语翻译 |

### 语音转字幕详情

| 功能 | 说明 |
|------|------|
| **双引擎 ASR** | Whisper（多语言）和 FunASR（中文优化）可选，前端一键切换 |
| **FunASR Paraformer** | 阿里达摩院中文 ASR 模型，CPU 推理 RTF~0.03（比实时快 30x），自带标点恢复 |
| **GPU 自动检测** | Whisper 自动检测 CUDA GPU；FunASR 自动检测 CUDA/MPS/CPU |
| **VAD 可选** | FunASR 模式下可开关语音活动检测（FSMN-VAD），短音频可关闭提速 |
| **智能行拆分** | 超长字幕按标点贪心拆分，每条约 15 字，时间码按字数比例分配 |
| **LLM 校准** | 提供原始文稿，LLM 对比识别结果，只修正错别字，不改变内容意思 |
| **本地预筛** | 智能模式下先本地比对过滤，只送疑似错误行给 LLM，节省 90%+ token |
| **双语字幕** | 一键翻译为英/日/韩/法/德/西双语字幕，支持下载双语 SRT |
| **SSML 编辑器** | 分类标签栏、模板库、结构树、属性校验，专业级 SSML 编辑体验 |

### ASR 引擎对比

| | Whisper (Faster-Whisper) | FunASR (Paraformer-ZH) |
|--|-------------------------|----------------------|
| 语言支持 | 100+ 语言 | 中文专优 |
| 模型大小 | tiny ~ large-v3 | ~944MB |
| CPU 速度 | RTF~0.1 | RTF~0.03 |
| GPU 加速 | CUDA (float16) | CUDA / MPS |
| VAD | 无（模型内置分段） | FSMN-VAD（可选） |
| 标点恢复 | 模型内置 | CT-Transformer |
| 模型来源 | Hugging Face | ModelScope |

## 声音复刻引擎

项目支持两种声音复刻引擎，适用于不同场景：

| 引擎 | 原理 | 优势 | 适用场景 |
|------|------|------|----------|
| **CosyVoice (Qwen)** | 上传音频 → 注册到云端 → 获得持久化 voice_id | 注册一次，后续合成只需 voice_id，适合批量合成 | 需要大量重复合成同一声音 |
| **MiMo TTS** | 上传音频 → 即时复刻（无状态，每次带音频样本） | 无需注册、无需公网 URL，本地音频直接使用 | 快速试听、一次性合成 |

### CosyVoice 流程
1. 上传/录制音频 → 2. 注册到 Qwen 云端获得 voice_id → 3. 使用 voice_id 合成任意文本

### MiMo TTS 流程
1. 上传/录制音频 → 2. 标记为 MiMo 复刻 → 3. 合成时自动将音频转 base64 发送给 MiMo API

## 技术栈

### 前端

- React 19 + TypeScript
- Vite 构建
- Axios HTTP 客户端

### 后端

- Python 3.12+ / FastAPI
- SQLAlchemy ORM + SQLite
- 千问 CosyVoice API（声音克隆与 TTS）
- MiMo-V2.5-TTS API（预置音色 / 音色设计 / 音色复刻）
- Edge-TTS（离线 TTS 备选）
- Faster-Whisper（语音转文字，支持 CUDA GPU 加速）
- FunASR Paraformer（中文语音转文字，CPU 推理比 Whisper 快 3x，自带 VAD + 标点恢复）
- MiMo-v2.5-pro（LLM 字幕校准与双语翻译）
- 七牛云 OSS（可选的外部存储）

## 快速开始

### 环境要求

- Node.js ≥ 18
- Python ≥ 3.12
- 千问 API Key（[获取地址](https://dashscope.console.aliyun.com/)）
- MiMo API Key（可选，[获取地址](https://xiaomimimo.com)）

> **FunASR 本地模型**：首次使用会自动从 ModelScope 下载（~2GB），后续使用本地缓存。
> macOS 使用 CPU+MPS 加速，Linux GPU 服务器使用 CUDA。

### 1. 配置后端

```bash
cd backend

# 创建虚拟环境
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS / Linux:
source .venv/bin/activate

# 安装依赖
pip install -e .

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入你的 QWEN_API_KEY 和 MIMO_API_KEY（可选）
```

### 2. 启动后端

```bash
cd backend
.venv\Scripts\activate
python -m uvicorn main:app --host 127.0.0.1 --port 8002
```

后端运行在 `http://127.0.0.1:8002`，可通过 `/health` 验证：

```bash
curl http://127.0.0.1:8002/health
```

### 3. 启动前端

```bash
cd frontend
npm install
npm run dev
```

前端运行在 `http://localhost:5173`，开发服务器会自动代理 API 请求到后端。

### Docker 启动

```bash
docker-compose up --build
```

## 配置项

核心环境变量（`backend/.env`）：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `QWEN_API_KEY` | 千问 API 密钥 | 必填（CosyVoice 功能） |
| `QWEN_MODEL` | 使用的模型 | `cosyvoice-v3.5-plus` |
| `MIMO_API_KEY` | MiMo TTS API 密钥 | 可选（MiMo + LLM 校准） |
| `MIMO_BASE_URL` | MiMo TTS API 地址 | `https://api.xiaomimimo.com/v1` |
| `LLM_API_KEY` | LLM 校准专用密钥 | 留空则复用 `MIMO_API_KEY` |
| `LLM_BASE_URL` | LLM API 地址 | 留空则复用 `MIMO_BASE_URL` |
| `LLM_MODEL` | LLM 校准模型 | `mimo-v2.5-pro` |
| `DATABASE_URL` | 数据库连接 | `sqlite:///./voice_clone.db` |
| `LOG_LEVEL` | 日志级别 | `INFO` |
| `FUNASR_MODEL` | FunASR 模型 | `paraformer-zh` |
| `FUNASR_DEVICE` | FunASR 推理设备 | 留空自动检测 (cuda > mps > cpu) |

## API 端点

### 声音复刻 (`/api/clone`)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/clone/upload` | 上传音频文件 |
| POST | `/api/clone/upload-from-url` | 从公网 URL 上传 |
| POST | `/api/clone/create-clone` | CosyVoice 注册克隆 |
| POST | `/api/clone/create-clone-mimo` | MiMo 标记复刻 |
| GET | `/api/clone/list` | 获取声音列表 |
| DELETE | `/api/clone/{id}` | 删除声音 |
| POST | `/api/clone/sync-from-qwen` | 手动同步 Qwen 声音（仅 CosyVoice） |

### TTS 合成 (`/api/tts`)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/tts/synthesize` | CosyVoice / Edge-TTS 合成 |
| GET | `/api/tts/voices` | 获取 CosyVoice 声音列表 |

### MiMo TTS (`/api/mimo-tts`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/mimo-tts/voices` | 获取 MiMo 预置音色列表 |
| POST | `/api/mimo-tts/preset` | 预置音色合成 |
| POST | `/api/mimo-tts/voicedesign` | 文本描述设计音色合成 |
| POST | `/api/mimo-tts/voiceclone` | 已有声音复刻合成 |
| POST | `/api/mimo-tts/voiceclone-direct` | Base64 音频直接复刻合成 |

### 语音转字幕 (`/api/speech-to-text`)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/speech-to-text/transcribe` | 单文件语音识别（支持 `engine` 和 `enable_vad` 参数） |
| POST | `/api/speech-to-text/multi-transcribe` | 多音频合并识别（同上） |
| GET | `/api/speech-to-text/history` | 识别历史 |
| GET | `/api/speech-to-text/download/{id}` | 下载 SRT 文件 |

#### 转写参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `engine` | string | `whisper` | 识别引擎：`whisper` 或 `funasr` |
| `model_size` | string | `large-v3` / `paraformer-zh` | 模型大小（根据引擎自动切换选项） |
| `beam_size` | int | 5 | Whisper beam search 大小（仅 Whisper） |
| `enable_vad` | bool | `true` | 是否启用 VAD（仅 FunASR） |

### 字幕 LLM 校准 (`/api/subtitle-llm`)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/subtitle-llm/correct` | LLM 字幕校准（smart/full 两种模式） |
| POST | `/api/subtitle-llm/translate` | 双语字幕翻译 |
| GET | `/api/subtitle-llm/config` | 获取当前 LLM 配置 |

## License

MIT
