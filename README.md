# NarraForge

基于 **Qwen CosyVoice · MiMo TTS · Edge-TTS · Faster-Whisper · FunASR** 的 AI 叙事工坊，将声音克隆、文字转语音、语音转字幕融为一体。

![NarraForge 首页](frontend/src/assets/frontpage-2.png)

## 截图

### 文字转语音 — 单段合成
<!-- 截图：全局控制台(音色+参数) + 文本输入 + 生成按钮 -->
![单段合成](docs/screenshots/tts-single.png)

### 文字转语音 — 分段编辑器
<!-- 截图：完整分段编辑界面，含感情色彩卡片、头像、工具栏 -->
![分段编辑器](docs/screenshots/tts-segmented.png)

### 分段编辑 — 编辑面板
<!-- 截图：展开的段落编辑面板，含参数覆盖、引擎切换、音色选择 -->
![编辑面板](docs/screenshots/tts-edit-panel.png)

> 截图待补充：运行 `npm run dev` 后手动截取放入 `docs/screenshots/` 目录

## 功能

| 模块 | 说明 |
|------|------|
| **声音复刻** | 上传音频样本，AI 复刻说话人音色与情感韵律，支持 CosyVoice 和 MiMo 两种引擎 |
| **文字转语音** | 单段合成与分段编辑两种模式，支持多引擎（CosyVoice / MiMo / Edge-TTS）、多语种、语速与音调调节 |
| **语音转字幕** | 音频/视频智能转写为高精度字幕，支持 GPU 加速、智能行拆分、LLM 校准与双语翻译 |

### 文字转语音

#### 单段合成

输入文本，选择音色与参数，一键生成语音。支持三种引擎切换：

| 引擎 | 特点 |
|------|------|
| **Edge-TTS** | 微软 TTS，免费离线，多语言多音色，无需 API Key |
| **CosyVoice (Qwen)** | 云端声音克隆，注册一次反复使用 |
| **MiMo TTS** | 预置音色 / 文本描述设计 / 音频复刻，三种模式 |

#### 分段编辑器

专业级时间轴编辑器，适合长文本语音合成：

| 功能 | 说明 |
|------|------|
| **智能拆分** | LLM 语义分句 + 自动感情色彩分析，或按标点规则拆分 |
| **感情色彩** | 每段自动识别感情（欣喜/激昂/沉稳/中性/沉重/愤怒），整卡片着色，支持手动调整 |
| **逐字高亮** | 播放时根据音频时长逐字从灰色变为高亮色，精确同步 |
| **全部播放** | 一键顺序播放所有已生成段落 |
| **音色覆盖** | 全局音色 + 每段独立覆盖，已生成段落不受全局切换影响 |
| **过期检测** | 全局音色变更后，自动标记使用旧音色的已生成段落 |
| **项目管理** | 自动保存到 IndexedDB，支持多项目切换，刷新不丢失 |
| **导出** | 支持导出音频和 SRT 字幕 |

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
- IndexedDB 本地存储（分段编辑项目持久化 + 音频缓存）

### 后端

- Python 3.12+ / FastAPI
- SQLAlchemy ORM + SQLite
- 千问 CosyVoice API（声音克隆与 TTS）
- MiMo-V2.5-TTS API（预置音色 / 音色设计 / 音色复刻）
- Edge-TTS（离线 TTS 备选）
- Faster-Whisper（语音转文字，支持 CUDA GPU 加速）
- FunASR Paraformer（中文语音转文字，CPU 推理比 Whisper 快 3x，自带 VAD + 标点恢复）
- MiMo-v2.5-pro（LLM 字幕校准、双语翻译、智能分句与感情分析）
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
| GET | `/api/tts/edge-voices` | 获取 Edge-TTS 音色列表（支持语言/性别筛选） |
| GET | `/api/tts/edge-languages` | 获取 Edge-TTS 支持的语言列表 |

### 文本拆分 (`/api/text-split`)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/text-split/rule` | 按标点规则拆分 |
| POST | `/api/text-split/llm` | LLM 语义智能拆分（含感情色彩分析） |
| POST | `/api/text-split/ssml-annotate` | LLM SSML 标注 |

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
