# Voice Studio

基于 **Qwen CosyVoice · Edge-TTS · Faster-Whisper** 的 AI 音频工作站，将声音克隆、文字转语音、语音转字幕融为一体。

![Voice Studio 首页](frontend/src/assets/frontpage-2.png)

## 功能

| 模块 | 说明 |
|------|------|
| **声音复刻** | 上传音频样本，AI 复刻说话人音色与情感韵律，用于任意文本的语音合成 |
| **文字转语音** | 输入文字即可生成自然语音，支持多语种、语速与音调调节 |
| **语音转字幕** | 音频/视频智能转写为高精度字幕，支持多说话人识别与时间轴对齐 |

## 技术栈

### 前端

- React 19 + TypeScript
- Vite 构建
- Axios HTTP 客户端

### 后端

- Python 3.12+ / FastAPI
- SQLAlchemy ORM + SQLite
- 千问 CosyVoice API（声音克隆与 TTS）
- Edge-TTS（离线 TTS 备选）
- Faster-Whisper（语音转文字）
- 七牛云 OSS（可选的外部存储）

## 快速开始

### 环境要求

- Node.js ≥ 18
- Python ≥ 3.12
- 千问 API Key（[获取地址](https://dashscope.console.aliyun.com/)）

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
# 编辑 .env，填入你的 QWEN_API_KEY
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
| `QWEN_API_KEY` | 千问 API 密钥 | 必填 |
| `QWEN_MODEL` | 使用的模型 | `cosyvoice-v3.5-plus` |
| `DATABASE_URL` | 数据库连接 | `sqlite:///./voice_clone.db` |
| `LOG_LEVEL` | 日志级别 | `INFO` |

## License

MIT