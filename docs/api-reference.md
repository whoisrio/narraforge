# API Reference

Voice Studio 后端 API 完整参考。所有端点前缀 `/api`。

---

## 声音复刻 (`/api/clone`)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/clone/upload` | 上传音频文件（multipart/form-data） |
| POST | `/api/clone/upload-from-url` | 从公网 URL 下载音频 |
| POST | `/api/clone/create-clone` | CosyVoice 注册克隆（需已上传的音频） |
| POST | `/api/clone/create-clone-mimo` | MiMo 标记为复刻音色 |
| GET | `/api/clone/list` | 获取所有已克隆声音列表 |
| DELETE | `/api/clone/{id}` | 删除声音（同时清理云端注册） |
| POST | `/api/clone/sync-from-qwen` | 从 Qwen 云端同步声音列表 |
| PATCH | `/api/clone/{id}/description` | 更新声音自定义描述 |

### POST `/api/clone/create-clone`

**Request Body:**
```json
{
  "audio_path": "uploads/xxx.wav",
  "name": "我的声音"
}
```

**Response:** `VoiceProfile` 对象

### GET `/api/clone/list`

**Response:**
```json
{
  "voices": [
    {
      "id": "uuid",
      "name": "我的声音",
      "description": "温柔女声",
      "qwen_voice_id": "xxx",
      "audio_url": "/api/clone/audio/xxx",
      "is_cloned": true,
      "clone_engine": "qwen",
      "created_at": "2024-01-01T00:00:00"
    }
  ]
}
```

---

## TTS 合成 (`/api/tts`)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/tts/synthesize` | 文字转语音（CosyVoice / Edge-TTS） |
| POST | `/api/tts/batch` | 批量合成（多段文本） |
| GET | `/api/tts/voices` | 获取 CosyVoice 声音列表 |
| GET | `/api/tts/history` | 获取合成历史 |
| DELETE | `/api/tts/history/{id}` | 删除合成记录 |
| GET | `/api/tts/audio/{id}` | 获取音频文件 |
| GET | `/api/tts/edge-voices` | 获取 Edge-TTS 音色列表 |
| GET | `/api/tts/edge-languages` | 获取 Edge-TTS 语言列表 |

### POST `/api/tts/synthesize`

**Request Body:**
```json
{
  "text": "要合成的文字",
  "engine": "cosyvoice",
  "voice_id": "xxx",
  "language": "Chinese",
  "speed": 1.0,
  "volume": 80,
  "pitch": 1.0,
  "instruction": "音调偏高，语速中等",
  "enable_ssml": false,
  "enable_markdown_filter": false,
  "format": "mp3",
  "edge_voice": "",
  "edge_rate": "+0%",
  "edge_volume": "+0%"
}
```

**字段说明:**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `text` | string | 必填 | 要合成的文本 |
| `engine` | string | `"cosyvoice"` | 引擎：`cosyvoice` 或 `edge_tts` |
| `voice_id` | string | `""` | CosyVoice 声音 ID |
| `language` | string | `"Chinese"` | 语言 |
| `speed` | float | `1.0` | 语速 0.5-2.0 |
| `volume` | float | `80` | 音量 0-100 |
| `pitch` | float | `1.0` | 语调 0.5-2.0 |
| `instruction` | string | (默认) | 复刻指令（50字以内） |
| `enable_ssml` | bool | `false` | 启用 SSML 标注 |
| `enable_markdown_filter` | bool | `false` | 过滤 Markdown 标记 |
| `format` | string | `"wav"` | 输出格式 `mp3` / `wav` |
| `edge_voice` | string | `""` | Edge-TTS 音色短名 |
| `edge_rate` | string | `"+0%"` | Edge-TTS 语速 |
| `edge_volume` | string | `"+0%"` | Edge-TTS 音量 |

**Response:**
```json
{
  "audio_id": "uuid",
  "audio_base64": "UklGR...",
  "audio_format": "mp3",
  "voice_id": "xxx",
  "voice_name": "我的声音",
  "text": "要合成的文字",
  "params": { "speed": 1.0, "volume": 80, "pitch": 1.0, "language": "Chinese", "instruction": "..." }
}
```

### GET `/api/tts/edge-voices`

**Query Parameters:**
- `language` (optional): 语言筛选，如 `Chinese`
- `gender` (optional): 性别筛选 `Male` / `Female`

**Response:**
```json
{
  "voices": [
    {
      "name": "Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoxiaoNeural)",
      "short_name": "zh-CN-XiaoxiaoNeural",
      "display_name": "Xiaoxiao",
      "gender": "Female",
      "locale": "zh-CN",
      "language": "Chinese"
    }
  ]
}
```

---

## MiMo TTS (`/api/mimo-tts`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/mimo-tts/voices` | 获取预置音色列表 |
| POST | `/api/mimo-tts/preset` | 预置音色合成 |
| POST | `/api/mimo-tts/voicedesign` | 文本描述设计音色合成 |
| POST | `/api/mimo-tts/voiceclone` | 已有声音复刻合成 |
| POST | `/api/mimo-tts/voiceclone-direct` | Base64 音频直接复刻 |

### POST `/api/mimo-tts/preset`

```json
{
  "text": "要合成的文字",
  "voice": "冰糖",
  "instruction": "温柔甜美",
  "format": "wav"
}
```

### POST `/api/mimo-tts/voiceclone`

```json
{
  "text": "要合成的文字",
  "voice_id": "已注册的声音ID",
  "instruction": "语速偏慢",
  "format": "wav"
}
```

---

## 文本拆分 (`/api/text-split`)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/text-split/rule` | 按标点规则拆分 |
| POST | `/api/text-split/llm` | LLM 语义智能拆分 |
| POST | `/api/text-split/ssml-annotate` | LLM SSML 标注 |

### POST `/api/text-split/rule`

```json
{
  "text": "长文本内容",
  "delimiters": ["，", "。", "！", "？"]
}
```

**Response:**
```json
{ "segments": ["第一句，", "第二句。", "第三句！"] }
```

### POST `/api/text-split/llm`

```json
{
  "text": "长文本内容",
  "delimiters": ["，", "。", "！", "？"]
}
```

**Response:**
```json
{
  "segments": [
    { "text": "第一句。", "reason": "语义完整", "emotion": "neutral" },
    { "text": "第二句！", "reason": "感叹语气", "emotion": "excited" }
  ],
  "model": "mimo-v2.5-pro"
}
```

**emotion 取值:** `happy` / `sad` / `angry` / `calm` / `neutral` / `excited`

### POST `/api/text-split/ssml-annotate`

```json
{
  "texts": ["第一段文字", "第二段文字"],
  "style_hint": "温柔治愈"
}
```

**Response:**
```json
{
  "annotations": [
    { "text": "第一段文字", "ssml": "<speak>...</speak>", "rationale": "..." }
  ],
  "model": "mimo-v2.5-pro"
}
```

---

## 语音转字幕 (`/api/speech-to-text`)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/speech-to-text/transcribe` | 单文件语音识别 |
| POST | `/api/speech-to-text/multi-transcribe` | 多音频合并识别 |
| GET | `/api/speech-to-text/history` | 识别历史 |
| GET | `/api/speech-to-text/download/{id}` | 下载 SRT 文件 |
| DELETE | `/api/speech-to-text/{id}` | 删除识别记录 |

### POST `/api/speech-to-text/transcribe`

**Request:** `multipart/form-data`
- `file`: 音频/视频文件
- `engine`: `"whisper"` 或 `"funasr"`
- `model_size`: 模型大小
- `beam_size`: Whisper beam size (仅 Whisper)
- `enable_vad`: 是否启用 VAD (仅 FunASR)

**Response:**
```json
{
  "id": "uuid",
  "original_filename": "audio.mp3",
  "srt_content": "1\n00:00:00,000 --> 00:00:02,500\n你好世界\n\n",
  "language": "zh",
  "language_probability": 0.98,
  "model_size": "large-v3",
  "segments": [
    { "start": 0.0, "end": 2.5, "text": "你好世界" }
  ],
  "created_at": "2024-01-01T00:00:00"
}
```

---

## 字幕 LLM 校准 (`/api/subtitle-llm`)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/subtitle-llm/correct` | LLM 字幕校准 |
| POST | `/api/subtitle-llm/translate` | 双语翻译 |
| GET | `/api/subtitle-llm/config` | 获取 LLM 配置 |

### POST `/api/subtitle-llm/correct`

```json
{
  "srt_content": "原始SRT内容",
  "original_script": "原始文稿（可选）",
  "mode": "smart"
}
```

- `mode: "smart"` — 先本地预筛，只送疑似错误行给 LLM
- `mode: "full"` — 全文逐行校准

### POST `/api/subtitle-llm/translate`

```json
{
  "srt_content": "中文SRT内容",
  "target_language": "English"
}
```

---

## 模型配置 (`/api/config`, `/api/model-config`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/config/storage-mode` | 获取存储模式 |
| POST | `/api/config/storage-mode` | 设置存储模式 |
| GET | `/api/model-config` | 获取所有提供商配置 |
| PUT | `/api/model-config/{provider}/{field}` | 更新配置值 |
| POST | `/api/model-config/{provider}/{field}/clear` | 清除配置值 |

### 存储模式

- `frontend` — 音频存储在浏览器 IndexedDB
- `backend` — 音频存储在后端 SQLite + 文件系统

---

## 通用错误响应

所有端点在出错时返回：

```json
{
  "detail": "错误描述信息"
}
```

常见 HTTP 状态码：
- `400` — 请求参数错误
- `404` — 资源不存在
- `422` — 请求体验证失败
- `500` — 服务器内部错误
- `502` — 外部服务调用失败（如 LLM API）

### 分段项目

- `GET    /api/segmented-projects` — 列出所有项目（轻量）
- `POST   /api/segmented-projects` — 创建项目（完整对象）
- `GET    /api/segmented-projects/{id}` — 获取完整项目（chapters + segments）
- `PUT    /api/segmented-projects/{id}` — 全量替换（reconcile）
- `DELETE /api/segmented-projects/{id}` — 删除项目 + 资产目录
- `POST   /api/segmented-projects/{id}/chapters/{cid}/segments/{sid}/synthesize` — 生成分片音频
- `GET    /api/segmented-projects/{id}/audio/{cid}/{sid}` — 读取分片 mp3
- `POST   /api/segmented-projects/{id}/chapters/{cid}/split` — 文本分段（preview_only 或 replace_chapter_segments）
- `POST   /api/segmented-projects/migrate` — 批量迁移 IndexedDB 项目
