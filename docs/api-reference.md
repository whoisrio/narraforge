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
| POST | `/api/clone/create-clone-voxcpm` | VoxCPM 标记为复刻音色 |
| POST | `/api/clone/create-from-design` | 从音色设计预览音频创建 VoiceProfile |
| GET | `/api/clone/list` | 获取全局声音列表（project_id IS NULL） |
| GET | `/api/clone/{voice_id}` | 获取单个声音详情 |
| DELETE | `/api/clone/{voice_id}` | 删除声音（同时清理云端注册和本地文件） |
| POST | `/api/clone/sync-from-qwen` | 从 Qwen 云端同步声音列表 |
| PATCH | `/api/clone/{voice_id}/description` | 更新声音描述和/或 prompt_text |
| PATCH | `/api/clone/{voice_id}/preview-audio` | 保存克隆音色的试听音频 |
| GET | `/api/clone/audio/{voice_id}` | 获取声音音频文件（支持 `field` 查询参数） |

### POST `/api/clone/upload`

**Request:** `multipart/form-data`
- `file`: 音频文件（支持 MP3、WAV、OGG、WebM；WebM 自动转换为 MP3）
- `prompt_text` (optional): 参考音频的转录文本

**Response:**
```json
{
  "id": "uuid",
  "name": "文件名.mp3",
  "audio_url": "/api/clone/audio/{id}",
  "is_cloned": false,
  "prompt_text": null
}
```

### POST `/api/clone/upload-from-url`

**Request Body:**
```json
{
  "audio_url": "https://cdn.example.com/voice.mp3",
  "name": "我的声音",
  "role": "custom",
  "prompt_text": "参考音频的转录文本"
}
```

**字段说明:**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `audio_url` | string | 必填 | 公网可访问的音频 URL |
| `name` | string | `null` | 声音名称，不填自动生成 |
| `role` | string | `"custom"` | 角色标签 |
| `prompt_text` | string | `null` | 参考音频转录文本（可选） |

**Response:**
```json
{
  "id": "uuid",
  "name": "我的声音",
  "audio_url": "/api/clone/audio/{id}",
  "external_audio_url": "https://cdn.example.com/voice.mp3",
  "is_cloned": false
}
```

### POST `/api/clone/create-clone`

**Request Body:**
```json
{
  "voice_id": "已上传音频的ID",
  "name": "我的声音",
  "role": "custom",
  "avatar": "data:image/png;base64,...",
  "engine_params": { "input_method": "upload" }
}
```

**字段说明:**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `voice_id` | string | 必填 | 已通过 upload 上传的音频 ID |
| `name` | string | `null` | 声音名称 |
| `role` | string | `"custom"` | 角色标签 |
| `avatar` | string | `null` | 头像（data URL 或外部 URL） |
| `engine_params` | object | `{}` | 引擎特有参数，前端透传存储。常用字段：`input_method`（`record`/`upload`/`url`） |

**Response:** `VoiceProfile` 对象（见下方通用 VoiceProfile 响应格式）

### POST `/api/clone/create-from-design`

从音色设计的预览音频创建 VoiceProfile。用于 MiMo voicedesign 和 VoxCPM design 流程：用户描述音色 -> 试听 -> 满意后调用此接口持久化。

**Request Body:**
```json
{
  "audio_base64": "UklGR...",
  "engine": "mimo",
  "name": "设计音色",
  "description": "温柔女声",
  "avatar": null,
  "project_id": null,
  "voice_description": "年轻的女性声音，温柔甜美",
  "instruction": "语速稍慢"
}
```

**字段说明:**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `audio_base64` | string | 必填 | 预览音频的 Base64 编码 |
| `engine` | string | 必填 | 引擎：`mimo` 或 `voxcpm` |
| `name` | string | 必填 | 声音名称 |
| `description` | string | `""` | 声音描述 |
| `avatar` | string | `null` | 头像 |
| `project_id` | string | `null` | 项目专属声音（NULL = 全局） |
| `voice_description` | string | `null` | 音色设计描述 |
| `instruction` | string | `null` | 合成指令 |

**Response:** `VoiceProfile` 对象

### PATCH `/api/clone/{voice_id}/preview-audio`

保存克隆音色的试听音频。用于克隆流程：用户录制/上传原始音频 -> 克隆 -> 试听合成 -> 保存试听音频。

**Request Body:**
```json
{
  "audio_base64": "UklGR...",
  "audio_format": "wav"
}
```

**字段说明:**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `audio_base64` | string | 必填 | 试听音频的 Base64 编码 |
| `audio_format` | string | `"wav"` | 音频格式 |

**Response:**
```json
{
  "id": "voice-uuid",
  "cloned_preview_path": "/path/to/preview_audio.wav"
}
```

### GET `/api/clone/audio/{voice_id}`

获取声音音频文件。

**Query Parameters:**
- `field` (optional): `"original"` 返回原始上传音频，`"preview"` 返回克隆试听音频，不传返回主音频文件

**Response:** 音频文件流（`audio/wav`）

### GET `/api/clone/list`

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "我的声音",
    "description": "温柔女声",
    "avatar": null,
    "project_id": null,
    "voice": {
      "model": "cosyvoice",
      "voice_type": "clone"
    },
    "voice_params": {
      "cosyvoice": {
        "source_audio_path": "output/clone_voices/audio.mp3",
        "params": {
          "voice_id": "xxx",
          "voice_description": "..."
        }
      }
    },
    "preview": {
      "audition_text": "...",
      "preview_audio_path": "output/clone_voices/preview.mp3"
    },
    "has_preview": true,
    "has_source": true,
    "created_at": "2024-01-01T00:00:00"
  }
]
```

### GET `/api/clone/{voice_id}`

**Response:**
```json
{
  "id": "uuid",
  "name": "我的声音",
  "audio_url": "/api/clone/audio/{id}",
  "original_audio_url": "/api/clone/audio/{id}?field=original",
  "cloned_preview_url": "/api/clone/audio/{id}?field=preview",
  "qwen_voice_id": "xxx",
  "role": "custom",
  "clone_engine": "qwen",
  "is_cloned": true,
  "cloned_at": "2024-01-01T00:00:00",
  "created_at": "2024-01-01T00:00:00"
}
```

---

## TTS 合成 (`/api/tts`)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/tts/synthesize` | 文字转语音（CosyVoice / Edge-TTS） |
| POST | `/api/tts/batch` | 批量合成（多段文本） |
| GET | `/api/tts/voices` | 获取已克隆声音列表（支持筛选） |
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
  "format": "wav",
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
| `voice_id` | string | `""` | CosyVoice 声音 ID（engine=cosyvoice 时必填） |
| `language` | string | `"Chinese"` | 语言 |
| `speed` | float | `1.0` | 语速 0.5-2.0 |
| `volume` | float | `80` | 音量 0-100 |
| `pitch` | float | `1.0` | 语调 0.5-2.0 |
| `instruction` | string | (默认) | 复刻指令 |
| `enable_ssml` | bool | `false` | 启用 SSML 标注 |
| `enable_markdown_filter` | bool | `false` | 过滤 Markdown 标记 |
| `format` | string | `"wav"` | 输出格式 `mp3` / `wav` |
| `edge_voice` | string | `""` | Edge-TTS 音色短名（engine=edge_tts 时必填） |
| `edge_rate` | string | `"+0%"` | Edge-TTS 语速 |
| `edge_volume` | string | `"+0%"` | Edge-TTS 音量 |

**Response (frontend 存储模式):**
```json
{
  "audio_id": "uuid",
  "audio_base64": "UklGR...",
  "audio_format": "mp3",
  "text": "要合成的文字",
  "voice_id": "xxx",
  "voice_name": "我的声音",
  "params": { "speed": 1.0, "volume": 80, "pitch": 1.0, "instruction": "..." }
}
```

**Response (backend 存储模式):**
```json
{
  "audio_id": "uuid",
  "audio_url": "/api/tts/audio/{audio_id}",
  "text": "要合成的文字",
  "params": { "speed": 1.0, "volume": 80, "pitch": 1.0, "instruction": "..." }
}
```

### GET `/api/tts/voices`

查询已克隆声音。

**Query Parameters:**
- `voice_id` (optional): 返回指定单个声音
- `project_id` (optional): 返回全局声音 + 该项目专属声音

**Response:**
```json
{
  "voices": [
    {
      "id": "uuid",
      "name": "我的声音",
      "description": "温柔女声",
      "avatar": null,
      "project_id": null,
      "voice": { "model": "cosyvoice", "voice_type": "clone" },
      "voice_params": {
        "cosyvoice": {
          "source_audio_path": "output/clone_voices/audio.mp3",
          "params": { "voice_id": "xxx" }
        }
      },
      "preview": { "audition_text": "...", "preview_audio_path": "output/clone_voices/preview.mp3" },
      "has_preview": true,
      "has_source": true,
      "created_at": "2024-01-01T00:00:00"
    }
  ]
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

**字段说明:**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `text` | string | 必填 | 待合成的文本 |
| `voice` | string | `"冰糖"` | 预置音色 ID（如 冰糖、Mia、Chloe 等） |
| `instruction` | string | `""` | 风格指令（自然语言或音频标签） |
| `format` | string | `"wav"` | 输出格式：`wav` / `mp3` |

### POST `/api/mimo-tts/voicedesign`

使用文本描述设计音色进行语音合成。

**Request Body:**
```json
{
  "voice_description": "年轻的男性声音，低沉有磁性",
  "text": "要合成的文字",
  "optimize_text_preview": false,
  "format": "wav"
}
```

**字段说明:**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `voice_description` | string | 必填 | 音色描述文本 |
| `text` | string | `""` | 待合成的文本，为空时自动生成适配文本 |
| `optimize_text_preview` | bool | `false` | 是否智能润色目标播报文本（默认 false，严格使用传入文本） |
| `format` | string | `"wav"` | 输出格式：`wav` / `mp3` |

**Response (frontend 存储模式):**
```json
{
  "audio_id": "uuid",
  "audio_base64": "UklGR...",
  "audio_format": "wav",
  "text": "要合成的文字",
  "voice_name": "年轻的男性声音，低沉有磁性",
  "params": { "engine": "mimo_tts", "instruction": "年轻的男性声音，低沉有磁性" }
}
```

**Response (backend 存储模式):**
```json
{
  "audio_id": "uuid",
  "audio_url": "/api/tts/audio/{audio_id}",
  "text": "要合成的文字",
  "voice_name": "年轻的男性声音，低沉有磁性",
  "params": { "engine": "mimo_tts", "instruction": "年轻的男性声音，低沉有磁性" }
}
```

### POST `/api/mimo-tts/voiceclone`

使用已上传的音频文件进行音色复刻合成。

**Request Body:**
```json
{
  "text": "要合成的文字",
  "voice_id": "已注册的声音ID",
  "instruction": "语速偏慢",
  "format": "wav"
}
```

**字段说明:**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `text` | string | 必填 | 待合成的文本 |
| `voice_id` | string | 必填 | 本地数据库中已上传的声音 ID |
| `instruction` | string | `""` | 风格指令 |
| `format` | string | `"wav"` | 输出格式：`wav` / `mp3` |

**Response:** 与 voicedesign 相同格式。

### POST `/api/mimo-tts/voiceclone-direct`

直接使用 Base64 音频数据进行音色复刻合成（无需先上传音频）。

**Request Body:**
```json
{
  "text": "要合成的文字",
  "audio_base64": "UklGR...",
  "mime_type": "audio/mpeg",
  "instruction": "语速偏慢",
  "format": "wav"
}
```

**字段说明:**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `text` | string | 必填 | 待合成的文本 |
| `audio_base64` | string | 必填 | 音频文件的 Base64 编码（不含前缀） |
| `mime_type` | string | `"audio/mpeg"` | 音频 MIME 类型：`audio/mpeg` 或 `audio/wav` |
| `instruction` | string | `""` | 风格指令 |
| `format` | string | `"wav"` | 输出格式：`wav` / `mp3` |

**Response:** 与 voicedesign 相同格式。

---

## VoxCPM TTS (`/api/voxcpm`)

本地 GPU 推理的语音合成接口。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/voxcpm/status` | 模型加载状态和 GPU 信息 |
| POST | `/api/voxcpm/load` | 加载模型到 GPU |
| POST | `/api/voxcpm/unload` | 释放 GPU 显存 |
| POST | `/api/voxcpm/tts` | 纯文本 TTS 合成（无参考音频） |
| POST | `/api/voxcpm/design` | Voice Design（文本描述生成音色） |
| POST | `/api/voxcpm/clone` | Controllable Clone（参考音频克隆） |
| POST | `/api/voxcpm/ultimate-clone` | Ultimate Clone（最高保真克隆） |

### POST `/api/voxcpm/tts`

纯文本 TTS 合成（无参考音频）。

```json
{
  "text": "要合成的文字",
  "cfg_value": 2.0,
  "inference_timesteps": 10,
  "format": "wav"
}
```

**字段说明:**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `text` | string | 必填 | 待合成的文本 |
| `cfg_value` | float | `2.0` | CFG 强度（1.0-5.0） |
| `inference_timesteps` | int | `10` | 去噪步数（1-50） |
| `format` | string | `"wav"` | 输出格式 |

### POST `/api/voxcpm/design`

Voice Design -- 纯文本描述生成全新音色。

```json
{
  "voice_description": "年轻的女性声音，温柔甜美",
  "text": "要合成的文字",
  "cfg_value": 2.0,
  "inference_timesteps": 10,
  "format": "wav"
}
```

**字段说明:**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `voice_description` | string | 必填 | 音色描述文本 |
| `text` | string | `""` | 合成文本（为空时自动生成） |
| `cfg_value` | float | `2.0` | CFG 强度（1.0-5.0） |
| `inference_timesteps` | int | `10` | 去噪步数（1-50） |
| `format` | string | `"wav"` | 输出格式 |

### POST `/api/voxcpm/clone`

Controllable Clone -- 参考音频克隆 + 可选风格控制。

```json
{
  "text": "要合成的文字",
  "voice_id": "已上传声音ID",
  "style_control": "语速稍快，欢快语气",
  "cfg_value": 2.0,
  "inference_timesteps": 10,
  "format": "wav"
}
```

**字段说明:**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `text` | string | 必填 | 待合成的文本 |
| `voice_id` | string | 必填 | 本地数据库中已上传的声音 ID |
| `style_control` | string | `""` | 风格控制描述 |
| `cfg_value` | float | `2.0` | CFG 强度（1.0-5.0） |
| `inference_timesteps` | int | `10` | 去噪步数（1-50） |
| `format` | string | `"wav"` | 输出格式 |

### POST `/api/voxcpm/ultimate-clone`

Ultimate Clone -- 参考音频 + 转录文本，最高保真克隆。

```json
{
  "text": "要合成的文字",
  "voice_id": "已上传声音ID",
  "prompt_text": "参考音频的完整转录文本",
  "style_control": "语速稍快",
  "cfg_value": 2.0,
  "inference_timesteps": 10,
  "format": "wav"
}
```

**字段说明:**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `text` | string | 必填 | 待合成的文本 |
| `voice_id` | string | 必填 | 本地数据库中已上传的声音 ID |
| `prompt_text` | string | `null` | 参考音频的完整转录文本（未提供时自动从 VoiceProfile 读取） |
| `style_control` | string | `""` | 风格控制描述 |
| `cfg_value` | float | `2.0` | CFG 强度（1.0-5.0） |
| `inference_timesteps` | int | `10` | 去噪步数（1-50） |
| `format` | string | `"wav"` | 输出格式 |

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
  "delimiters": ["，", "。", "！", "？"],
  "min_len_to_merge": 5,
  "next_max_len_to_merge": 15
}
```

**字段说明：**
- `delimiters`: 切分标点。默认 `["，", "。", "！", "？"]`。
- `min_len_to_merge` *(可选，默认 `5`)*：短段合并下限。若某一段字符长度 **小于** 此值，
  且紧接的下一段长度小于 `next_max_len_to_merge`，则将两段并入同一行。传 `0` 可关闭合并。
- `next_max_len_to_merge` *(可选，默认 `15`)*：合并时下一段长度上限（严格小于）。防止
  跟长段合并后溢出合理长度。

合并采用从左到右的贪心扫描：当前段合并后若仍短，会继续尝试吸并后续段，直到长度达阈
或下一段过长。长度以段内字符数（含末尾标点）计。

**Response:**
```json
{ "segments": ["你好，世界。", "今天好。"] }
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

## 角色管理 (`/api/roles`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/roles` | 获取所有角色列表 |
| POST | `/api/roles` | 创建角色 |
| PUT | `/api/roles/{role_id}` | 更新角色 |
| DELETE | `/api/roles/{role_id}` | 删除角色 |

### POST `/api/roles`

**Request Body:**
```json
{
  "id": "narrator",
  "name": "旁白",
  "avatar": null,
  "description": "故事旁白角色",
  "role_kind": "cast",
  "default_engine": "edge_tts",
  "default_voice": "zh-CN-XiaoxiaoNeural",
  "default_engine_params": {},
  "favorite_styles": []
}
```

**字段说明:**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | string | 必填 | 角色唯一标识 |
| `name` | string | 必填 | 角色名称 |
| `avatar` | string | `null` | 头像 |
| `description` | string | `null` | 角色描述 |
| `role_kind` | string | `"cast"` | 角色类型 |
| `default_engine` | string | `"edge_tts"` | 默认 TTS 引擎 |
| `default_voice` | string | `null` | 默认音色 |
| `default_engine_params` | object | `{}` | 默认引擎参数 |
| `favorite_styles` | array | `[]` | 收藏的风格列表 |

**Response:** `RoleOut` 对象（含 `created_at`、`updated_at`）

### PUT `/api/roles/{role_id}`

所有字段可选，仅传需要更新的字段。

**Response:** `RoleOut` 对象

---

## 分段项目 (`/api/segmented-projects`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/segmented-projects` | 列出所有项目（轻量摘要） |
| POST | `/api/segmented-projects` | 创建项目（完整对象） |
| GET | `/api/segmented-projects/{id}` | 获取完整项目（chapters + segments） |
| PUT | `/api/segmented-projects/{id}` | 全量替换（reconcile） |
| DELETE | `/api/segmented-projects/{id}` | 删除项目 + 资产目录 |
| POST | `/api/segmented-projects/{id}/chapters:batch` | 批量重建章节+分片（agent split_segment） |
| POST | `/api/segmented-projects/{id}/chapters/{cid}/segments/{sid}/synthesize` | 生成分片音频 |
| GET | `/api/segmented-projects/{id}/audio/{cid}/{sid}` | 读取分片 mp3 |
| GET | `/api/segmented-projects/{id}/chapters/{cid}/export-audio` | 导出整章合并音频 |
| POST | `/api/segmented-projects/{id}/chapters/{cid}/split` | 文本分段 |
| POST | `/api/segmented-projects/{id}/apply-animation-spec` | 批量应用动画规格 |
| POST | `/api/segmented-projects/{id}/export-text-file-to-remotion` | 导出文本文件到 Remotion |
| POST | `/api/segmented-projects/{id}/scaffold-remotion` | 创建/刷新 Remotion 工程（knowledge_video 工作流） |
| POST | `/api/segmented-projects/migrate` | 批量迁移 IndexedDB 项目 |

### ProjectIn Schema

```json
{
  "id": "project-uuid",
  "name": "项目名称",
  "schema_version": 2,
  "layout": "vertical",
  "active_chapter_id": "chapter-id",
  "original_text": null,
  "animation_theme": null,
  "remotion_project_path": null,
  "source_document": null,
  "default_narrator_role_id": null,
  "default_narrator_snapshot": null,
  "configs": {
    "description": null,
    "export_directory": null,
    "split_voice_mode": "narration"
  },
  "chapters": [...]
}
```

**字段说明:**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | string | 必填 | 项目唯一标识 |
| `name` | string | 必填 | 项目名称 |
| `schema_version` | int | `2` | Schema 版本（仅支持 2） |
| `layout` | string | `"vertical"` | 布局方向 |
| `active_chapter_id` | string | `null` | 当前活跃章节 ID |
| `original_text` | string | `null` | 原始文本 |
| `animation_theme` | string | `null` | 整体动画主题 |
| `remotion_project_path` | string | `null` | Remotion 项目路径 |
| `source_document` | string | `null` | 源文档 markdown 内容 |
| `default_narrator_role_id` | string | `null` | 默认旁白角色 ID |
| `default_narrator_snapshot` | object | `null` | 旁白角色音色配置快照 |
| `configs` | object \| null | `null` | 项目级自由配置 JSON 桶（可变 keys，无需数据库迁移） |
| `configs.description` | string | — | 项目描述（UI 展示） |
| `configs.export_directory` | string | — | 导出目录（相对于 `remotion_project_path`），默认 `public/audio` |
| `configs.split_voice_mode` | string | — | 拆分默认模式：`narration` \| `dialogue` |
| `chapters` | array | `[]` | 章节列表 |

### ChapterIn Schema

```json
{
  "id": "chapter-id",
  "position": 0,
  "name": "第一章",
  "engine": "edge_tts",
  "default_params": {},
  "split_config": {},
  "original_text": null,
  "narration_script": null,
  "segments": [...]
}
```

### SegmentIn Schema

```json
{
  "id": "segment-id",
  "position": 0,
  "text": "段落文本",
  "ssml": null,
  "emotion": "neutral",
  "role_id": null,
  "role_snapshot": null,
  "segment_kind": "narration",
  "prosody_marks": [],
  "params": {},
  "locked_params": [],
  "voice_ref": null,
  "generated_params": null,
  "current_audio_path": null,
  "previous_audio_path": null,
  "audio_format": "mp3",
  "duration_sec": null,
  "audio_missing": false,
  "generated_at": null
}
```

#### 角色 / 局部语气字段（P3）

项目与分片对象新增以下可选字段，用于多角色对话与子句级语气控制：

- `default_narrator_role_id`：旁白段落默认使用的全局角色 ID。
- `default_narrator_snapshot`：保存的旁白角色音色配置快照。
- `segment.role_id`：对话或旁白分片关联的全局角色 ID。
- `segment.role_snapshot`：分片生成时使用的角色音色配置快照（保证可复现）。
- `segment.segment_kind`：分片类型，`dialogue`（台词）或 `narration`（旁白）。
- `segment.prosody_marks`：子句级局部语气标注，每项含 `start`、`end`、`emotion`、`style_tags`、`instruction`、`intensity`。
- `segment.voice_ref`：当前分片激活的音色来源信息。含 `name`（显示名称）、`source`（`role`/`global`/`custom`）、`voice_id`、`engine`、`role_id`（可选）。`source=role` 表示来自角色分配，`source=global` 表示跟随全局参数，`source=custom` 表示分片自定义覆盖。

### POST `/api/segmented-projects/{id}/chapters:batch`

批量重建项目全部章节与分片（替换式，单事务）：删除现有章节后按请求顺序重建，继承项目第一章节的 voice 作为默认。供 agent `split_segment` 节点使用。

**Request Body:**
```json
{
  "chapters": [
    {
      "chapter_title": "第一章",
      "narration_script": "本章旁白稿全文（可选）",
      "engine": "voxcpm",
      "segments": [
        { "text": "段落文本", "emotion": "neutral", "role": "narration", "segment_kind": "narration" }
      ]
    }
  ],
  "narration_script": "项目级完整旁白稿（可选）"
}
```

**字段说明:**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `chapters[].chapter_title` | string | 必填 | 章节标题 |
| `chapters[].narration_script` | string | `null` | 本章旁白稿，持久化到章节的 `narration_script` 字段；未传则为 `null` |
| `chapters[].engine` | string | `null` | 本章 TTS 引擎（`edge_tts`/`cosyvoice`/`mimo_tts`/`voxcpm`），写入 `chapter.voice` JSON 的 `engine` 键并保留其他键；未传则沿用默认 voice |
| `chapters[].segments[].text` | string | 必填 | 分片文本 |
| `chapters[].segments[].emotion` | string | `null` | 分片情绪 |
| `chapters[].segments[].role` | string | `"narration"` | 分片角色 |
| `chapters[].segments[].segment_kind` | string | `"narration"` | 分片类型 |
| `narration_script` | string | `null` | 项目级完整旁白稿。内容写入项目资产目录的 `narration.md`，DB 只存 `narration_document_path`；未传不更新。detail 响应的 `narration_script` 字段读穿返回文件内容 |

**Response:**
```json
{
  "chapters": [
    { "id": "chapter-id", "segments": [{ "id": "segment-id" }] }
  ]
}
```

> 项目级长文档（源文档 `source.md`、旁白稿 `narration.md`）的内容一律存文件，DB 仅存 `source_document_path` / `narration_document_path`；`GET /segmented-projects/{id}` 的 `source_document` / `narration_script` 字段读穿返回内容。旧 `source_document` TEXT 列仅作遗留回退。

### POST `/api/segmented-projects/{id}/chapters/{cid}/segments/{sid}/synthesize`

**Request Body:**
```json
{
  "params": { "speed": 1.0, "volume": 80 },
  "text": null,
  "ssml": null,
  "keep_previous": true
}
```

**Response:** 完整 `ProjectDetail` 对象。

### POST `/api/segmented-projects/{id}/chapters/{cid}/split`

**Request Body:**
```json
{
  "text": "要拆分的文本",
  "mode": "rule",
  "delimiters": ["，", "。"],
  "replace_strategy": "preview_only",
  "after_segment_id": null
}
```

**字段说明:**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `text` | string | 必填 | 要拆分的文本 |
| `mode` | string | `"rule"` | 拆分模式：`rule` 或 `llm` |
| `delimiters` | array | `null` | 分隔符列表（rule 模式） |
| `replace_strategy` | string | `"preview_only"` | `preview_only` 或 `replace_chapter_segments` |
| `after_segment_id` | string | `null` | 在指定分片之后插入 |

**Response:**
```json
{
  "items": [{ "text": "第一句。" }, { "text": "第二句！" }],
  "project": { ... }
}
```

### POST `/api/segmented-projects/{id}/apply-animation-spec`

批量应用动画规格：一次性 POST 全部 segment spec，后端原子更新。字段合并：传什么覆盖什么，未传保留旧值；缺失的 segment_id 报告在 `missing_segment_ids`。

**Request Body:**
```json
{
  "theme": "整体动画主题",
  "segments": [
    {
      "segment_id": "segment-id",
      "visual_concept": "视觉概念",
      "layout": "vertical",
      "mood": "calm",
      "phases": {},
      "animations": {},
      "elements": [],
      "emphasis": [],
      "asset_refs": [],
      "notes": null
    }
  ]
}
```

**字段合并规则:** `segments` 数组元素除上述既有白名单字段（`visual_concept` / `layout` / `mood` / `phases` / `animations` / `elements` / `emphasis` / `asset_refs` / `notes`）外，**任意非 None 字段都会合并进 `animation_spec_json`**（kv 分镜 brief 的 `narration_text` / `visual_content` / `animation` / `start_sec` / `end_sec` 等）。合并后自动写入 `generated_at` 时间戳。

**Response:**
```json
{
  "theme_updated": true,
  "segments_updated": 3,
  "segments_skipped": 0,
  "missing_segment_ids": []
}
```

### POST `/api/segmented-projects/{id}/scaffold-remotion`

为 knowledge_video 工作流创建（或刷新）Remotion 工程。幂等：目标目录已存在 Remotion 工程（package.json 含 remotion 依赖）时跳过创建，仅刷新资产。

**Request Body:**
```json
{
  "target_dir": "/path/to/remotion-project"
}
```

**字段说明:**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `target_dir` | string | `null` | 可选；缺省用项目的 `remotion_project_path` |

**行为:**
1. 工程不存在时执行 `npx create-video@latest --yes --blank .`（需服务端装有 Node.js，超时 600s）；
2. 每章节导出拼接 MP3 到 `public/audio/`（按章节标题命名）；
3. 每章节生成 `public/subtitles/chapter_<position>.srt`（按 segment 时长累加时间戳）；
4. 写 `segment_manifest.json`（章节/资产/时长清单）与 `AGENTS.md`；
5. 持久化 `remotion_project_path`。

**Response:**
```json
{ "project_dir": "...", "created": true, "chapters": 2 }
```

**Errors:** 404 `project_not_found`；422 `remotion_target_not_set`；500 `npx_not_found` / `create_video_failed`。

### POST `/api/segmented-projects/migrate`

**Request Body:**
```json
{
  "projects": [ProjectIn, ...],
  "audios": [
    {
      "project_id": "pid",
      "chapter_id": "cid",
      "segment_id": "sid",
      "data_base64": "base64音频数据"
    }
  ]
}
```

**Response:**
```json
{
  "results": [
    { "project_id": "pid", "status": "ok", "audio_uploaded": 3, "audio_failed": 0 }
  ]
}
```

---

## 通用响应格式

### VoiceProfile 响应对象

```json
{
  "id": "uuid",
  "name": "我的声音",
  "description": "温柔女声",
  "avatar": null,
  "project_id": null,
  "voice": { "model": "cosyvoice", "voice_type": "clone" },
  "voice_params": {
    "cosyvoice": {
      "source_audio_path": "output/clone_voices/audio.mp3",
      "params": { "voice_id": "xxx", "voice_description": "..." }
    }
  },
  "preview": {
    "audition_text": "...",
    "preview_audio_path": "output/clone_voices/preview.mp3"
  },
  "has_preview": true,
  "has_source": true,
  "created_at": "2024-01-01T00:00:00"
}
```

Audio playback: construct URL `/api/clone/audio/{id}?field=preview` when `has_preview` is true,
or `/api/clone/audio/{id}?field=source` when `has_source` is true.

### 通用错误响应

所有端点在出错时返回：

```json
{
  "detail": "错误描述信息"
}
```

常见 HTTP 状态码：
- `400` — 请求参数错误
- `404` — 资源不存在
- `409` — 资源冲突（如重复描述、项目已存在）
- `422` — 请求体验证失败
- `500` — 服务器内部错误
- `502` — 外部服务调用失败（如 LLM API）
