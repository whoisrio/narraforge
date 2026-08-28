# API Reference

Voice Studio 后端 API 完整参考。所有端点前缀 `/api`。

---

## 认证与数据隔离（workers 模式）

以下规则只在 `DEPLOY_TARGET=workers`（Vercel serverless / Cloudflare Workers + Supabase）生效。
本地（local）模式不注册认证中间件，全部端点免认证，SQLite 单租户。

**身份判定顺序**（`backend/app/core/auth_middleware.py`）：

1. **legacy admin**：满足任一旧凭证即视为管理员，放行一切请求并在仓储层看到全部用户的数据。
   - `Cf-Access-Authenticated-User-Email` 头存在（CF Access 边缘注入；只验存在性、可伪造，仅在 `TRUST_CF_ACCESS_HEADER=true` 时生效——仅 CF Access 前置拓扑开启）；
   - `X-Narraforge-Gateway-Secret` 与 `GATEWAY_SECRET` 一致；
   - `Authorization: Bearer <ACCESS_TOKEN>` 共享口令。
2. **Supabase 用户**：`Authorization: Bearer <Supabase access_token>`，经 JWKS
   （`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`，ES256）验签，
   校验 `aud`（`SUPABASE_JWT_AUD`，默认 `authenticated`）与 `iss`（`{SUPABASE_URL}/auth/v1`）。
3. **匿名**：只允许无状态 allowlist（见下）；其余返回 `401`。

**匿名 allowlist**（精确/前缀匹配，不读写用户数据）：

| 端点 | 说明 |
|---|---|
| `GET /health`、`GET /` | 探活/根页 |
| `GET /api/config/capabilities`、`GET /api/config/storage-mode` | 能力/存储模式 |
| `POST /api/tts/synthesize` | workers 模式仅 edge_tts 引擎；匿名请求不持久化（只回 base64），且按 IP 限流（每日 `TRY_ANON_DAILY_LIMIT` 次，超限返回 `429 rate_limit_exceeded`） |
| `POST /api/mimo-tts/*` | MiMo 在线合成/克隆 |
| `POST /api/text-split/*`、`/api/subtitle-llm/*`、`/api/text-analysis/*` | 纯文本处理 |

**每用户数据隔离**（workers/Supabase 模式，本地 SQLite 不变）：
`segmented_projects` / `voice_profiles` / `roles` / `source_documents` / `tts_results`
带 `user_id` 归属列，在仓储层强制过滤（`backend/app/core/repositories/user_scope.py`）。
登录用户只见自己的行；chapters/segments 经所属 project 继承归属；跨用户访问返回 404；
legacy admin 看全部行；匿名兜底为 `user_id IS NULL` 作用域（只触达 allowlist 端点，纵深防御）。

**错误码**（detail 为 `{code, message}` 信封）：

- `401 auth_required` — 匿名访问非 allowlist 端点。
- `429 rate_limit_exceeded` — 匿名 edge_tts 合成超出单 IP 每日限额（Try 页获客限流，见 `docs/superpowers/specs/2026-08-20-try-page-seo-acquisition-design.md`）。
- `403 admin_required` — 非管理员访问 `/api/admin/*`（JWT 邮箱需在 `ADMIN_EMAILS` 内；legacy admin 恒通过）。

---

## 声音复刻 (`/api/clone`)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/clone/upload` | 上传音频文件（multipart/form-data） |
| POST | `/api/clone/upload-from-url` | 从公网 URL 下载音频 |
| POST | `/api/clone/upload-url` | 签发 Supabase 签名上传 URL（workers 直传，绕 serverless 请求体上限） |
| POST | `/api/clone/upload-from-storage` | 直传完成后按 storage_path 建 VoiceProfile |
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

### POST `/api/clone/upload-url`

workers（serverless）部署的克隆音频直传第一步：绕开平台请求体上限（Vercel 4.5MB），
由后端用 Supabase service key 签发签名上传 URL，前端随后直传 Supabase Storage。
仅当 `capabilities.features.direct_storage_upload = true` 时前端使用本流程；
local 模式继续走 multipart `/upload`。

**Request Body:**
```json
{
  "filename": "voice.mp3",
  "content_type": "audio/mpeg"
}
```

**Response:**
```json
{
  "upload_url": "https://<ref>.supabase.co/storage/v1/object/upload/sign/voice-assets/data/voices/profiles/voice_20260813_123000.mp3?token=...",
  "storage_path": "data/voices/profiles/voice_20260813_123000.mp3",
  "token": "..."
}
```

前端直传：`fetch(upload_url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })`。

**错误:** 400（不支持的扩展名；serverless 无 ffmpeg，webm 不收）/ 502（Supabase 上游失败）/ 503（未配置 Supabase）。

### POST `/api/clone/upload-from-storage`

直传第二步：按 `storage_path` 建 VoiceProfile（与 `/upload` 同一数据形状，
后续 `create-clone-mimo` 流程不变）。

**Request Body:**
```json
{
  "storage_path": "data/voices/profiles/voice_20260813_123000.mp3",
  "name": "我的声音",
  "prompt_text": "参考音频的转录文本",
  "project_id": null
}
```

**错误:** 400（路径穿越 / 前缀不符 / 扩展名不支持）/ 404（存储中无此对象）。

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
{
  "items": [
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
}
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

**限流（workers 模式匿名请求）**：单 IP 每日 edge_tts 合成上限 `TRY_ANON_DAILY_LIMIT`（默认 50），超限返回 `429`：
```json
{ "detail": { "code": "rate_limit_exceeded", "message": "...", "limit": 50 } }
```
已认证用户与 local 模式不受限。

### GET `/api/tts/voices`

查询已克隆声音。

**Query Parameters:**
- `voice_id` (optional): 返回指定单个声音
- `project_id` (optional): 返回全局声音 + 该项目专属声音

**Response:**
```json
{
  "items": [
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
  "items": [
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

## IndexTTS-2.5 TTS (`/api/indextts`)

IndexTTS-2.5 本地语音合成（bilibili，0.8B 参数，中/英/日/西/阿多语言，zero-shot 克隆 + 情绪向量 + 语速控制）。
模型运行在独立 sidecar 进程中（`third_party/index-tts` 的独立 uv 环境，Python 3.11 + torch 2.8 cu128），
backend 通过 HTTP 调用，规避与 backend（Python>=3.12）的依赖冲突。仅 local 模式挂载。

sidecar 启动方式：

```bash
cd third_party/index-tts
uv run ../../backend/scripts/indextts_sidecar_server.py   # 默认端口 8310
# 或一键拉起（随 npm run dev 同启）：INDEXTTS_SIDECAR=1 npm run dev
```

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/indextts/status` | sidecar 与模型加载状态 |
| POST | `/api/indextts/load` | 加载模型到 GPU（懒加载，幂等） |
| POST | `/api/indextts/unload` | 释放 GPU 显存 |
| POST | `/api/indextts/tts` | 参考音频克隆合成 |

### POST `/api/indextts/tts`

```json
{
  "text": "要合成的文字",
  "voice_id": "已上传声音ID",
  "lang": "ZH",
  "emo_alpha": 1.0,
  "duration_factor": 1.0
}
```

**字段说明:**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `text` | string | 必填 | 待合成的文本 |
| `voice_id` | string | 必填 | 本地数据库中已上传的声音 ID（zero-shot，直接取参考音频） |
| `lang` | string | `"ZH"` | 语言：`ZH`/`EN`/`JA`/`ES`/`AR` |
| `emo_alpha` | float | `1.0` | 情绪强度（0.0-1.0，配合段落 emotion 映射的 emo_vector） |
| `duration_factor` | float | `1.0` | 语速控制（0.5-2.0，>1 变慢，<1 变快） |

分段项目使用该引擎时，`voice.engine = "indextts"`，voice 参数结构为
`{engine, voice_id, lang, emo_alpha, duration_factor}`；段落 `emotion` 由后端映射为
IndexTTS 8 维情绪向量（happy/angry/sad/afraid/disgusted/melancholic/surprised/calm），
映射表见 `backend/app/services/engine_capabilities.py` 的 `EMOTION_TO_EMO_VECTOR`。

---

## 文本拆分 (`/api/text-split`)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/text-split/rule` | 按标点规则拆分 |
| POST | `/api/text-split/llm` | LLM 语义智能拆分 |
| POST | `/api/text-split/ssml-annotate` | LLM SSML 标注 |
| POST | `/api/text-split/markdown-detect` | 探测 markdown 标题层级（H1-H6 候选 + 推荐章节） |
| POST | `/api/text-split/markdown-split` | 按指定标题层级拆分 markdown 全文为章节 |

### POST `/api/text-split/markdown-detect`

**Request Body:**
```json
{ "text": "markdown 全文", "min_chars": 80, "front_matter_mode": "prepend_to_first" }
```

`front_matter_mode`：`prepend_to_first`（首个标题前内容并入第一章）/ `own_chapter` / `skip`。

**Response:**
```json
{
  "doc_title": "文档标题",
  "candidates": [{ "index": 0, "title": "第一章", "level": 2, "start_char": 8, "end_char": 100, "char_count": 92, "preview": "..." }],
  "chapters": [],
  "total_chars": 1234
}
```

### POST `/api/text-split/markdown-split`

按用户指定的 `levels` 切分，层级包含语义：勾选的最深层级为 L 时，所有 level ≤ L 的标题都作为章节边界（按文档顺序拍平，如勾 `[3]` 则 H2、H3 都成章节；H1 始终只作 `doc_title`）。
短于 `min_chars` 的相邻章节自动合并。
返回 flat 章节列表（`index/title/level/start_char/end_char/char_count/preview`）。
前端按 `start_char/end_char` 从原文切片后调 `chapters:batch` 应用。

**Request Body:**
```json
{ "text": "markdown 全文", "levels": [2], "min_chars": 80, "front_matter_mode": "prepend_to_first" }
```

**Response:**
```json
{
  "doc_title": "文档标题",
  "chapters": [{ "index": 0, "title": "夜路 (含引言)", "level": 2, "start_char": 8, "end_char": 100, "char_count": 92, "preview": "..." }],
  "total_chars": 1234,
  "used_levels": [2]
}
```

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
| GET | `/api/config/capabilities` | 部署目标能力清单（workers 模式隐藏本地专属能力用） |
| GET | `/api/config/storage-mode` | 获取存储模式 |
| PUT | `/api/config/storage-mode` | 设置存储模式 |
| GET | `/api/config/animation-root` | 获取全局 Remotion 脚手架根目录 |
| PUT | `/api/config/animation-root` | 设置全局 Remotion 脚手架根目录（校验可创建且可写） |
| POST | `/api/config/animation-root/test` | 探测路径可用性，不保存 |
| GET | `/api/config/narration-git-remote` | 获取 narration git 远端地址 |
| PUT | `/api/config/narration-git-remote` | 设置 narration git 远端地址（空=清除，只本地 commit） |
| POST | `/api/config/narration-git/snapshot` | 手动触发 narration 快照（commit，remote 已配则 push） |
| GET | `/api/config/pronunciation-map-global` | 获取全局发音映射字典 |
| PUT | `/api/config/pronunciation-map-global` | 全量替换全局发音映射字典（对所有项目生效） |
| GET | `/api/model-config` | 获取所有提供商配置 |
| PUT | `/api/model-config/{provider}/{field}` | 更新配置值 |
| POST | `/api/model-config/{provider}/{field}/clear` | 清除配置值 |

### 部署能力 (`/api/config/capabilities`)

`GET /api/config/capabilities` 返回 `{ deploy_target, engines, clone_engines, features: { speech_to_text, agent_workflow, backend_storage, direct_storage_upload } }`。
workers 模式 `engines` 只含 `edge_tts`/`mimo_tts`、`clone_engines` 只含 `mimo`、features 全 `false`；local 全量。
事实源为 `backend/app/core/deploy_capabilities.py`，前端镜像在 `frontend/src/services/capabilities.ts`。

### 存储模式

- `frontend` — 音频存储在浏览器 IndexedDB
- `backend` - 音频存储在后端 SQLite + 文件系统

### Remotion 脚手架根目录 (`/api/config/animation-root`)

全局设置：`knowledge_video` 工作流在未指定 `target_dir` 且项目无 `remotion_project_path` 时，于 `{animation_root_folder}/{safe_project_name}` 创建 Remotion 工程。路径为 backend 服务器本机路径。

- `GET /api/config/animation-root` -> `{ "value": str | null }`
- `PUT /api/config/animation-root` body `{ "value": str }` -> 校验非空、可 `mkdir -p`、可写；失败 422（`path_empty` / `cannot_create_directory: ...` / `directory_not_writable: ...`）；成功返回 `{ "value": str }`。
- `POST /api/config/animation-root/test` body `{ "value": str }` -> 同样探测但不保存，返回 `{ "ok": bool, "error": str | null }`。

### Narration Git 版本管理 (`/api/config/narration-git-*`)

全局设置：narration 文本每日 03:00 自动快照到本地 git 仓库（`NARRATION_REPO_PATH`，默认 `backend/data/narration-repo/`）。配置远端后，快照 commit 后会 `git push origin main`；未配远端只本地 commit。

- `GET /api/config/narration-git-remote` -> `{ "value": str | null }`
- `PUT /api/config/narration-git-remote` body `{ "value": str }` -> 空字符串清除；成功返回 `{ "value": str | null }`。
- `POST /api/config/narration-git/snapshot` -> 手动触发一次 `snapshot_all`：`{ "commit_sha": str|null, "projects": int, "pushed": bool, "push_error": str|null, "remote_configured": bool }`。push 失败不抛（本地 commit 仍生效），错误进 `push_error`。

远端鉴权：remote URL 内嵌凭证（`https://user:token@host/repo.git`）或 SSH key。多环境 push 同一远端会非快进冲突（普通 push，不 force）。

### 全局发音映射 (`/api/config/pronunciation-map-global`)

合成时文本替换的全局字典（所有项目共享；项目级字典存 `project.configs.pronunciation_map`，同 source 项目条目覆盖全局条目）。存于 `system_configs`（key=`pronunciation_map_global`，JSON 数组字符串）。全局条目 id 统一 `gpm_` 前缀，项目条目 `pm_` 前缀，两层 id 不冲突。

- `GET /api/config/pronunciation-map-global` -> `{ "entries": [{ "id": str, "source": str, "target": str, "note": str | null }] }`，未配置时 `{ "entries": [] }`
- `PUT /api/config/pronunciation-map-global` body 同上 -> 全量替换。校验：source 去空白后非空（400 `pronunciation_source_empty`）、同一字典内 source 唯一（400 `pronunciation_source_duplicate`）；成功返回替换后的 `{ "entries": [...] }`

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
| PUT | `/api/segmented-projects/{id}` | 全量替换（reconcile）。只更新 DB 状态，**不删除任何音频文件**——payload 中消失的路径/分片只删 DB 行，文件留盘变孤儿，由显式清理回收（陈旧快照与合成并发时不得误删资产）。乐观锁见 `base_updated_at`。**服务端自产字段保护**：已存在分片的 `audio`/`generated_params`/`generated_at` 忽略 payload 值、保留 DB 现值（仅合成/录音/adjust-audio 端点可写）；新建分片照常接收 |
| DELETE | `/api/segmented-projects/{id}` | 删除项目 + 资产目录 |
| PATCH | `/api/segmented-projects/{id}` | 项目元信息部分更新（name/layout/configs/default_narrator_role_id/logo/remotion_project_path/animation_theme，tri-state；改名同事务搬迁资产目录；响应为完整 ProjectDetail，其 `updated_at` 即新乐观锁 base） |
| PUT | `/api/segmented-projects/{id}/source-document` | 写源文档（local：落 source.md 文件+路径列；workers：文本列；响应 `{path, project_updated_at}`） |
| PUT | `/api/segmented-projects/{id}/narration-script` | 写项目级完整旁白稿（local：落 narration.md 文件+路径列；workers：不持久化，no-op 警告；不动章节级 sync_state） |
| POST | `/api/segmented-projects/{id}/chapters:batch` | 批量重建章节+分片（agent split_segment） |
| POST | `/api/segmented-projects/{id}/chapters` | 新建章节（position 追加到末尾；workers 模式受章节配额约束；201 响应 `{chapter, project_updated_at}`） |
| PATCH | `/api/segmented-projects/{id}/chapters/{cid}` | 章节部分更新（name/voice/split_config/design_title，tri-state：只更新出现的字段，显式 null = 清空；纯字段更新不碰分片音频；响应 `{chapter, project_updated_at}`） |
| DELETE | `/api/segmented-projects/{id}/chapters/{cid}` | 删除章节（该章分片行级联删除，**音频文件保留在盘上**待 sweep；200 响应 `{project_updated_at}` 供前端推进乐观锁 base） |
| POST | `/api/segmented-projects/{id}/chapters:reorder` | 章节重排（`chapter_ids` 须恰好覆盖项目全部章节 id，缺/多/未知 → 422 `chapter_ids_mismatch`；按数组顺序赋 position 0..n-1；响应 `{chapters: [{id, name, position}], project_updated_at}`） |
| POST | `/api/segmented-projects/{id}/chapters/{cid}/segments/{sid}/synthesize` | 生成分片音频（`force` 可强制覆盖已录入音频） |
| PATCH | `/api/segmented-projects/{id}/chapters/{cid}/segments/{sid}` | 段级部分更新（text/emotion/role_id/segment_kind/voice/unlock_audio，tri-state：只更新出现的字段，显式 null = 清空；voice 变更会把旧音频降级为 previous、清空 current 但保留文件；`unlock_audio=true` 清除录音 origin 锁；audio/generated_params/generated_at 为服务端自产字段不接受写入；响应为 `{segment, project_updated_at}`，后者供前端推进乐观锁 base） |
| POST | `/api/segmented-projects/{id}/chapters/{cid}/segments` | 新建分片（`after_id` 锚点插入 / 缺省追加章末；响应含章内全量 position 列表 + `project_updated_at`） |
| PATCH | `/api/segmented-projects/{id}/chapters/{cid}/structure` | 章内结构 reconcile（删除/合并/拆段/排序的唯一入口；已存在段文本变化时旧音频降级为 previous 并保留文件，被删分片只删 DB 行、音频文件留盘） |
| POST | `/api/segmented-projects/{id}/chapters/{cid}/segments/{sid}/audio` | 上传用户自行录入的分片音频（multipart） |
| GET | `/api/segmented-projects/{id}/audio/{cid}/{sid}` | 读取分片 mp3 |
| GET | `/api/segmented-projects/{id}/chapters/{cid}/export-audio` | 导出整章合并音频 |
| POST | `/api/segmented-projects/{id}/export-all-chapters` | 一键导出全部章节 mp3+srt 到项目导出目录 |
| POST | `/api/segmented-projects/{id}/chapters/{cid}/split` | 文本分段 |
| GET | `/api/segmented-projects/{id}/chapters/{cid}/sync-status` | 章节分层文本陈旧检测（L1/L2/L3 脏标记） |
| GET | `/api/segmented-projects/{id}/usage` | 项目级用量合计（TTS 次数/字符/LLM token） |
| POST | `/api/segmented-projects/{id}/chapters/{cid}/adjust-audio` | 合成后音频调整（速度/音量，ffmpeg 批处理） |
| POST | `/api/segmented-projects/{id}/chapters/{cid}/resplit-from-script` | 以 L2 改写稿重新拆分 segments（丢弃旧段配置） |
| POST | `/api/segmented-projects/{id}/chapters/{cid}/rewrite-script-from-segments` | 以 L3 分段定位合并回写 L2 改写稿 |
| POST | `/api/segmented-projects/{id}/apply-animation-spec` | 批量应用动画规格 |
| POST | `/api/segmented-projects/{id}/export-text-file-to-remotion` | 导出文本文件到 Remotion |
| POST | `/api/segmented-projects/{id}/scaffold-remotion` | 创建/刷新 Remotion 工程（knowledge_video 工作流） |
| GET | `/api/segmented-projects/{id}/export` | 导出项目为自包含 ZIP 包（文本+角色+音色+音频） |
| POST | `/api/segmented-projects/import` | 从 ZIP 包导入为新项目（ID 重映射，不覆盖） |
| POST | `/api/segmented-projects/migrate` | 批量迁移 IndexedDB 项目 |
| POST | `/api/segmented-projects/sweep-orphan-audio` | 孤儿音频文件 sweep（local-only；**dry-run 默认**只报告 `*/chapters/*/segments/*.mp3\|wav` 中未被任何段 audio.current/previous 引用的文件，`execute=true` 才真正删除；响应 `{dry_run, orphans: [{path, size_bytes}], total_count, total_size_bytes, deleted_count}`） |

> **多用户配额（workers 模式）**：普通登录用户名下项目数达到 `MAX_PROJECTS_PER_USER`（默认 `1`）后，POST 创建 / PUT 新建（upsert 到不存在的 id）返回 `409 project_limit_reached`；更新已有项目不受限。legacy admin（旧凭证通道）与 `ADMIN_EMAILS` 管理员豁免。local 模式不启用。
>
> **设计音色配额（workers 模式）**：普通登录用户名下设计音色数（`voice.voice_type == "design"`，全局 + 项目内合并）达到 `MAX_DESIGNED_VOICES_PER_USER`（默认 `1`）后，`POST /clone/create-from-design`（engine 为 `mimo`/`voxcpm`）返回 `409 designed_voice_limit_reached`；预置音色保存（engine=`preset`）与克隆上传不受限。legacy admin 与 `ADMIN_EMAILS` 管理员豁免。
>
> **章节配额（workers 模式）**：普通登录用户的项目章节数超过 `MAX_CHAPTERS_PER_PROJECT`（默认 `3`）且超过项目现有章节数（增长）时，POST 创建 / PUT 全量保存 / `chapters:batch` 返回 `409 chapter_limit_reached`（detail 为 `{code, limit}`）。
> 已超上限的存量项目仍可保存，但不能继续加章。
> `0` = 不限制；legacy admin 与 `ADMIN_EMAILS` 管理员豁免；local 模式不启用。
>
> **segment 文本长度上限（两种部署模式都生效）**：`MAX_SEGMENT_CHARS`（默认 `80`）是内容质量约束而非计费配额。
> 拆分结果超长时自动在限制内最近标点处截断（无标点则硬切）；POST/PUT 全量保存、`chapters:batch` 与分片合成的 text 覆盖携带超长文本时返回 `422 segment_too_long`（detail 为 `{code, max, chapter_id, segment_id}`）。
> `0` 或负数 = 不限制。

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
| `base_updated_at` | string \| null | `null` | 乐观锁：payload 基于的服务端 `updated_at`。已存在的项目携带且不符时返回 `409 {"code": "stale_payload", "server_updated_at"}`；`null`/缺省 = 不校验（兼容老客户端与 agent） |
| `configs.description` | string | — | 项目描述（UI 展示） |
| `configs.export_directory` | string | — | 导出目录。绝对路径（含 `~`）时独立于 Remotion 直接使用；相对路径则相对于 `remotion_project_path`，默认 `public/audio` |
| `configs.split_voice_mode` | string | — | 拆分默认模式：`narration` \| `dialogue` |
| `configs.underscore_to_space` | boolean | — | 项目级全局开关：TTS 合成时把下划线 `_` 替换为空格（只影响合成文本，显示/字幕保持原文）；与章节级 `params.underscore_to_space` 任一开启即生效 |
| `configs.skip_parenthesized` | boolean | — | 项目级全局开关：TTS 合成时移除成对括号及其内容（半角 `()` 与全角 `（）`，不含嵌套，未配对括号保留）；只影响合成文本；与章节级 `params.skip_parenthesized` 任一开启即生效 |
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
  "text_transforms": null,
  "generated_params": null,
  "current_audio_path": null,
  "previous_audio_path": null,
  "audio_format": "mp3",
  "duration_sec": null,
  "audio_missing": false,
  "generated_at": null
}
```

> 注：分片音频为嵌套对象 `audio: {format, current: {path, duration_sec, origin, file_exists}, previous: {…}, duration_sec}`。
> `audio.current.file_exists`（bool）由后端在 `get_project_detail` 序列化时按 `segmented_dir/rel` 实时 stat 计算，
> 用于前端识别「DB 有 path 但 mp3 已丢失」的脱节段（避免 UI 假「ready」）。

#### 角色 / 局部语气字段（P3）

项目与分片对象新增以下可选字段，用于多角色对话与子句级语气控制：

- `default_narrator_role_id`：旁白段落默认使用的全局角色 ID。
- `default_narrator_snapshot`：保存的旁白角色音色配置快照。
- `segment.role_id`：对话或旁白分片关联的全局角色 ID。
- `segment.role_snapshot`：分片生成时使用的角色音色配置快照（保证可复现）。
- `segment.segment_kind`：分片类型，`dialogue`（台词）或 `narration`（旁白）。
- `segment.prosody_marks`：子句级局部语气标注，每项含 `start`、`end`、`emotion`、`style_tags`、`instruction`、`intensity`。
- `segment.voice_ref`：当前分片激活的音色来源信息。含 `name`（显示名称）、`source`（`role`/`global`/`custom`）、`voice_id`、`engine`、`role_id`（可选）。`source=role` 表示来自角色分配，`source=global` 表示跟随全局参数，`source=custom` 表示分片自定义覆盖。

#### 合成时文本变换字段（发音映射 + 大写词转小写）

- `segment.text_transforms`：段级合成文本变换，`null` 或 `{ "applied_map_ids"?: string[], "lowercase_latin"?: boolean | null }`。
  `applied_map_ids` 引用生效字典（全局 `gpm_` + 项目 `pm_` 两层）中对该段生效的条目 id，只存引用不存副本；悬空 id（被覆盖/已删除）在合成时自然忽略。
  `lowercase_latin` 为三态覆盖：`true`/`false` 覆盖项目默认 `configs.lowercase_latin`，`null`/缺省跟随项目。
  这些变换只影响送引擎文本；`segment.text` 原文、字幕、SRT 导出不受影响。
- `segment.generated_params.effective_text`：合成后记录实际送引擎的最终文本（含发音映射替换与大写转小写），供追溯与双读断言。

### POST `/api/segmented-projects/{id}/chapters:batch`

批量重建项目全部章节与分片（替换式，单事务）：删除现有章节（含其分片音频文件清理）后按请求顺序重建，继承项目第一章节的 voice 作为默认。供 agent `split_segment` 节点使用。

**Request Body:**
```json
{
  "chapters": [
    {
      "chapter_title": "第一章",
      "narration_script": "本章旁白稿正文（可选）",
      "original_text": "本章旁白稿正文（可选，章节卡片/工作室拆分以此为源）",
      "engine": "voxcpm",
      "split_config": { "delimiters": ["，", "。"], "mode": "rule" },
      "segments": [
        { "text": "段落文本", "emotion": "neutral", "role": "narration", "segment_kind": "narration" }
      ]
    }
  ],
  "narration_script": "项目级完整旁白稿（可选）",
  "preserve_audio": false,
  "split_segments": false,
  "dry_run": false
}
```

**字段说明:**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `chapters[].chapter_title` | string | 必填 | 章节标题 |
| `chapters[].narration_script` | string | `null` | 本章旁白稿正文（L2，不含标题行），持久化到章节的 `narration_script` 字段；未传则为 `null` |
| `chapters[].original_text` | string | `null` | 本章旁白稿正文，持久化到章节的 `original_text` 字段（章节卡片显示与工作室拆分源文本）；未传则为 `null` |
| `chapters[].engine` | string | `null` | 本章 TTS 引擎（`edge_tts`/`cosyvoice`/`mimo_tts`/`voxcpm`/`indextts`），写入 `chapter.voice` JSON 的 `engine` 键并保留其他键；未传则沿用默认 voice |
| `chapters[].split_config` | object | `null` | 本章分段规则（`delimiters` + `mode`）。优先级：payload 显式值 > 匹配旧章节的沿承值 > 默认 |
| `chapters[].segments[].text` | string | 必填 | 分片文本 |
| `chapters[].segments[].emotion` | string | `null` | 分片情绪 |
| `chapters[].segments[].role` | string | `"narration"` | 分片角色 |
| `chapters[].segments[].segment_kind` | string | `"narration"` | 分片类型 |
| `narration_script` | string | `null` | 项目级完整旁白稿。内容写入项目资产目录的 `narration.md`，DB 只存 `narration_document_path`；未传不更新。detail 响应的 `narration_script` 字段读穿返回文件内容 |
| `preserve_audio` | bool | `false` | 重拆保留模式。删除前按规范化标题（忽略 `01.` 等前导序号）匹配旧章节，新 segment 文本与旧 segment 一致时沿承其 `audio`/`generated_params`/`emotion`/`role_id`/`voice`；local 模式下音频文件 move 到新规范路径（`audio.previous` 随迁，`.prev` 命名），未被复用的旧音频文件在 commit 成功后 GC，commit 失败时对已搬运文件做反向补偿。匹配分两阶段：章节内精确匹配（strip 后全等，每条旧 segment 只被消费一次），然后剩余新段进全局兜底池（所有旧章未消费段，按章序+段序）——章节重组（新标题）但文本未动时仍可复用。`origin=="recorded"` 的录音同样保留 |
| `split_segments` | bool | `false` | payload 章节未自带 `segments` 时，按该章最终 `split_config` 的 `delimiters` 用规则拆分直接生成 segment（正文取 `narration_script` 或 `original_text`）；`mode=="llm"` 的章节在批量场景同样走规则拆分。另：`preserve_audio=true` 且某章 payload 无 `segments` 且命中了含旧 segment 的旧章快照时，该章同样自动规则拆分（保留即重建）；未匹配章节不受影响 |
| `dry_run` | bool | `false` | 只跑匹配规划并返回 `reuse` 报告（含 discard 明细），不写库、不动文件、不更新 `narration_document_path`；响应 `chapters` 为空数组。磁盘不做探测，`segments_reused` 为计划口径（应用时文件缺失会降级为不复用） |

**Response:**
```json
{
  "chapters": [
    { "id": "chapter-id", "segments": [{ "id": "segment-id" }] }
  ],
  "reuse": {
    "chapters_matched": 1,
    "segments_matched": 3,
    "segments_reused": 3,
    "segments_new": 2,
    "per_chapter": [
      { "chapter_id": "chapter-id", "title": "01. 第一章", "matched": 3, "reused": 3, "new": 2 }
    ],
    "discard": { "text_changed": 1, "boundary_changed": 1, "no_audio": 0 },
    "recorded_discard": 0
  }
}
```

`reuse` 仅在 `preserve_audio` 或 `split_segments` 开启时返回，否则为 `null`。
`segments_reused` 是实际保留了音频的段数（旧音频文件缺失时不复用、计入 `segments_new`；`dry_run` 不做磁盘探测，为预计口径）。
`discard` 明细（仅 `preserve_audio=true` 时分类）：`text_changed` = 全局找不到同文本旧段；`boundary_changed` = 新文本等于同一旧章内连续 ≥2 段旧文本的连接（忽略空白，跨章连接不识别）；`no_audio` = 文本命中但旧段无音频记录。
`recorded_discard` = 将被丢弃的用户录音（`origin=="recorded"`）段数。
`dry_run=true` 时 `chapters` 为 `[]`，`per_chapter[].chapter_id` 缺省。

**错误:** 409 `chapter_limit_reached`（workers 模式章节配额，仅增长时拦截，detail 为 `{code, limit}`）；422 `segment_too_long`（segment 文本超过 `MAX_SEGMENT_CHARS`，detail 为 `{code, max, chapter_id, segment_id}`，`chapter_id` 处为 `chapter_title`）。

> 项目级长文档（源文档 `source.md`、旁白稿 `narration.md`）的内容一律存文件，DB 仅存 `source_document_path` / `narration_document_path`；`GET /segmented-projects/{id}` 的 `source_document` / `narration_script` 字段读穿返回内容。旧 `source_document` TEXT 列仅作遗留回退。

### PATCH `/api/segmented-projects/{id}/chapters/{cid}/segments/{sid}`

段级部分更新（2026-08-27 粒度重构 Phase 2，A 类段内容编辑入口）。

**Request Body（全部可选，tri-state：只更新出现的字段，显式 `null` = 清空，缺省 = 不动）：**
```json
{
  "text": "...", "emotion": "happy", "role_id": "role-xxx 或 null",
  "segment_kind": "narration", "voice": { "source": "custom", "engine": "...", "params": {} },
  "unlock_audio": true
}
```

- `voice` 变更 → 旧音频降级：`audio.current` 降为 `previous`、`current` 与 `duration_sec` 清空、`generated_params`/`generated_at` 置空；**音频文件保留在盘上**（可撤销）。
  `voice` 未变则不动音频。
- `unlock_audio: true` → 清除 `audio.current.origin` 录音锁（之后批量/重新合成可覆盖）；音频引用本身保留。
  这是唯一允许触碰 audio 元数据的字段，且只清 origin。
- `text` 变更不影响音频（音画一致性由层同步/重新合成流程负责）。
- `audio`/`generated_params`/`generated_at` 为服务端自产字段，本端点不接受写入。

**Response (200):** `{ "segment": { "...": "SegmentIn" }, "project_updated_at": "服务端项目最新 updated_at" }`

**错误:** 404 `segment_not_found`；422 `segment_too_long`（`text` 超过 `MAX_SEGMENT_CHARS`）。

### POST `/api/segmented-projects/{id}/chapters/{cid}/segments`

新建分片（2026-08-27 粒度重构 Phase 3，B 类段结构端点之一）。

**Request Body:**
```json
{
  "text": "新分片文本",
  "after_id": "seg-anchor 或 null"
}
```

- `text`：默认 `""`。
  空文本合法（先建空段再编辑）；非空时受 `MAX_SEGMENT_CHARS` 上限约束。
- `after_id`：默认 `null`。
  为章内某分片 id 时插到它后面（后续分片 position 平移）；为 `null`/缺省时追加到章末。

**Response (201):**
```json
{
  "segment": { "id": "新分片 uuid", "position": 3, "text": "新分片文本", "...": "SegmentIn 其余字段" },
  "positions": [{ "id": "s1", "position": 0 }, { "id": "s2", "position": 1 }],
  "project_updated_at": "2026-08-27T06:00:00"
}
```

`positions` 是插入后章内全部分片的 `{id, position}` 终态列表，前端按它收敛本地排序；`project_updated_at` 供前端推进整量 PUT 的乐观锁 base。

**错误:** 404 `chapter_not_found`（章节或项目不存在，workers 模式跨用户同此）；404 `segment_not_found`（`after_id` 在章内无对应分片）；422 `segment_too_long`。

### PATCH `/api/segmented-projects/{id}/chapters/{cid}/structure`

章内结构 reconcile：删除/合并/拆段/排序的唯一入口（B 类段结构端点之一）。
与整量 PUT 的分片 reconcile 同语义，但范围收敛到一章。

**Request Body:**
```json
{
  "segments": [
    { "id": "s1", "text": "改后的文本", "position": 0 },
    { "id": null, "text": "新分片", "position": 1 }
  ]
}
```

**语义：**

- payload 带 `id` 且该章存在此行 → 只更新 `text`/`position`；**`text` 发生变化时**（合并等结构操作）旧音频失效：`audio.current` 降级为 `previous`、`duration_sec` 清空、`generated_params`/`generated_at` 置空，**音频文件保留在盘上**（可撤销/回放）。
  `text` 未变（纯重排）时 `audio`/`generated_params`/`generated_at` 等服务端自产字段保留 DB 现值。
- `id` 为 `null` → 新建分片（服务端 uuid4 生成 id）。
- `id` 存在但该章无此行 → 按新建处理（用给定 id 播种，与整量 PUT 一致）。
- 该章现存但 payload 未引用的分片 → 删 DB 行，**音频文件保留在盘上**（绝不按状态 diff 删文件，孤儿文件由显式 sweep 回收）。
- position 重排用「负哨兵两阶段」手法防 `(chapter_id, position)` 唯一约束冲突；local 模式事务内单次 commit。

**Response (200):**
```json
{
  "segments": ["reconcile 后该章全部分片的 SegmentIn（按 position 升序）"],
  "project_updated_at": "2026-08-27T06:00:00"
}
```

**错误:** 404 `chapter_not_found`（章节或项目不存在，workers 模式跨用户同此）；422 `segment_too_long`（任一分片 text 超过 `MAX_SEGMENT_CHARS`）。

### POST `/api/segmented-projects/{id}/chapters`

新建章节（2026-08-27 粒度重构 Phase 4，C 类章节操作端点之一）。

**Request Body:**
```json
{ "name": "第三章" }
```

`position` 由服务端追加到项目末尾（现有最大 position + 1）。
新章节的默认字段对齐建章惯例：`voice={}`、`split_config={"delimiters": ["，", "。", "！", "？", "；"], "mode": "rule"}`。

**Response (201):**
```json
{
  "chapter": { "id": "新章节 uuid", "name": "第三章", "position": 2, "...": "ChapterIn 其余字段" },
  "project_updated_at": "2026-08-27T06:00:00"
}
```

`project_updated_at` 供前端推进整量 PUT 的乐观锁 base。

**错误:** 404 `project_not_found`（项目不存在，workers 模式跨用户同此）；409 `chapter_limit_reached`（workers 模式章节配额，见上文配额说明；单章新增按「现有数+1」做增长式拦截）。

### PATCH `/api/segmented-projects/{id}/chapters/{cid}`

章节部分更新（2026-08-27 粒度重构 Phase 4，C 类章节操作端点之一）。

**Request Body（全部可选，tri-state：只更新出现的字段，显式 `null` = 清空，缺省 = 不动）：**
```json
{
  "name": "...", "voice": { "engine": "...", "...": "..." },
  "split_config": { "delimiters": ["。"], "mode": "rule" }, "design_title": "..."
}
```

纯字段更新，不触碰分片的音频等自产字段。

**Response (200):** `{ "chapter": { "...": "ChapterIn" }, "project_updated_at": "服务端项目最新 updated_at" }`

**错误:** 404 `chapter_not_found`（章节或项目不存在，workers 模式跨用户同此）。

### DELETE `/api/segmented-projects/{id}/chapters/{cid}`

删除章节（2026-08-27 粒度重构 Phase 4，C 类章节操作端点之一）。

该章的分片 DB 行级联删除；**音频文件保留在盘上**（绝不在这里删文件，孤儿文件由 Phase 6 显式 sweep 统一回收）。

**Response (200):** `{ "project_updated_at": "服务端项目最新 updated_at" }`（200 带体而非 204——前端需要新 base 推进乐观锁）。

**错误:** 404 `chapter_not_found`（章节或项目不存在，workers 模式跨用户同此）。

### POST `/api/segmented-projects/{id}/chapters:reorder`

章节重排（2026-08-27 粒度重构 Phase 4，C 类章节操作端点之一）。

**Request Body:**
```json
{ "chapter_ids": ["c-b", "c-a", "c-c"] }
```

`chapter_ids` 必须恰好覆盖项目全部章节 id（缺/多/未知/重复均拒绝），服务端按数组顺序赋 position 0..n-1。
position 重排用「负哨兵两阶段」手法防 `(project_id, position)` 唯一约束冲突；local 模式事务内单次 commit，workers（PostgREST）先全部置负再逐行赋终值。

**Response (200):**
```json
{
  "chapters": [
    { "id": "c-b", "name": "第二章", "position": 0 },
    { "id": "c-a", "name": "第一章", "position": 1 }
  ],
  "project_updated_at": "2026-08-27T06:00:00"
}
```

`chapters` 为全章按新序的 `{id, name, position}` 终态列表。

**错误:** 404 `project_not_found`（项目不存在，workers 模式跨用户同此）；422 `chapter_ids_mismatch`（集合未恰好覆盖）。

### PATCH `/api/segmented-projects/{id}`

项目元信息部分更新（2026-08-27 粒度重构 Phase 5，D 类项目元信息端点）。

**Request Body（全部可选，tri-state：只更新出现的字段，显式 `null` = 清空，缺省 = 不动）：**
```json
{
  "name": "新项目名",
  "layout": "horizontal",
  "configs": { "description": "..." },
  "default_narrator_role_id": "role-xxx",
  "logo": "logo.png",
  "remotion_project_path": "/path/to/remotion",
  "animation_theme": "dark-gold"
}
```

改名时在同一事务内搬迁资产目录并重写 audio/文档存储路径（复用 `_relocate_project_assets`，与整量 PUT 改名同语义；搬迁失败时目录与 DB 路径双双保持旧值，降级不半迁移）；manifest 镜像随后重写保持新鲜。workers 模式无 slug 目录耦合，改名纯字段更新。

**Response (200):** 完整 `ProjectDetail`（与 GET 同形），其 `updated_at` 即新乐观锁 base。

**错误:** 404 `project_not_found`（项目不存在，workers 模式跨用户同此）；403 `forbidden_internal_project_id`（scratchpad）。

### PUT `/api/segmented-projects/{id}/source-document`

写源文档（2026-08-27 粒度重构 Phase 5，E 类文档层端点之一）。

**Request Body:**
```json
{ "text": "# 源文档\n正文。" }
```

local 模式：写 `{项目目录}/source.md` 文件、更新 `source_document_path` 并清空遗留 `source_document` 文本列，manifest 镜像同步刷新。workers 模式：无文件系统，内容直接写 `source_document` 文本列。

**Response (200):** `{ "path": "文件绝对路径或 null", "project_updated_at": "服务端项目最新 updated_at" }`（后者供前端推进乐观锁 base）。

**错误:** 404 `project_not_found`；403 `forbidden_internal_project_id`（scratchpad）。

### PUT `/api/segmented-projects/{id}/narration-script`

写项目级完整旁白稿（2026-08-27 粒度重构 Phase 5，E 类文档层端点之一）。

**Request Body:**
```json
{ "text": "完整旁白稿" }
```

local 模式：写 `{项目目录}/narration.md` 文件、更新 `narration_document_path`，manifest 镜像同步刷新。项目级旁白稿与章节级 L1/L2/L3 层同步（sync_state）是两套机制，本端点不动 sync_state（章节层的置脏/重拆由 `chapters:batch`、`resplit-from-script` 等端点管理）。workers 模式该字段本就不持久化（对齐整量 PUT 的忽略语义），no-op 警告不报错，返回当前版本。

**Response (200):** `{ "path": "文件绝对路径或 null", "project_updated_at": "..." }`。

**错误:** 404 `project_not_found`；403 `forbidden_internal_project_id`（scratchpad）。

### POST `/api/segmented-projects/{id}/chapters/{cid}/segments/{sid}/synthesize`

**Request Body:**
```json
{
  "params": { "speed": 1.0, "volume": 80 },
  "text": null,
  "ssml": null,
  "keep_previous": true,
  "force": false
}
```

- `force`：默认 `false`。
  当分片 `audio.current.origin === 'recorded'`（用户自行录入的音频，处于锁定状态）时，未带 `force` 的请求会被跳过（返回 200 且音频不变）；`force: true` 才重新合成，录入音频降级为 `audio.previous` 供撤销。
- `params.underscore_to_space`：默认 `false`。
  为 `true` 时，传入 TTS 引擎前把文本中的下划线 `_` 替换为空格（有些引擎会把下划线读出来）。
  项目级全局开关 `configs.underscore_to_space`（项目设置）与此参数任一开启即生效。
  转换是瞬态的：分片显示文本、字幕导出与历史记录均保持原文。
  在 `prepare_text_for_engine` 中于风格 tag 适配之后执行。
- `params.skip_parenthesized`：默认 `false`。
  为 `true` 时，传入 TTS 引擎前移除文本中成对的半角 `()` / 全角 `（）` 括号及其内容（不含嵌套；未配对括号原样保留）。
  项目级全局开关 `configs.skip_parenthesized`（项目设置）与此参数任一开启即生效。
  转换是瞬态的：分片显示文本、字幕导出与历史记录均保持原文。
  在 `prepare_text_for_engine` 中于风格 tag 适配之前执行（避免吃掉引擎新加的 `(情绪)` 前导标签）。
- **合成时文本变换（发音映射 + 大写词转小写）**：在上述清洗之前执行，同样只影响送引擎文本。
  生效字典 = 全局（`system_configs.pronunciation_map_global`）∪ 项目（`configs.pronunciation_map`），同 source 项目条目整体覆盖全局；
  `configs.pronunciation_apply_all` 开启时全量生效，否则只应用段级 `text_transforms.applied_map_ids` 引用的条目（悬空 id 忽略）；
  替换按 source 长度降序单次执行（不递归）。
  `configs.lowercase_latin`（项目默认）与段级 `text_transforms.lowercase_latin`（三态覆盖，非 null 优先）开启时，全大写拉丁词 `[A-Z]{2,}` 转小写。
  纯函数实现于 `backend/app/services/text_transform_service.py`（local 与 workers 双路径共用），前端镜像 `frontend/src/services/textTransforms.ts`。
  实际送引擎文本记入 `generated_params.effective_text`（可追溯/双读断言）。

**Response:** 完整 `ProjectDetail` 对象。

**错误:** 404 `segment_not_found`；422 `segment_too_long`（`text` 覆盖文本超过 `MAX_SEGMENT_CHARS`，detail 为 `{code, max, chapter_id, segment_id}`）。

### POST `/api/segmented-projects/{id}/chapters/{cid}/segments/{sid}/audio`

用户自行录入/上传分片音频（应对个别分片 TTS 效果不佳）。

**Request:** `multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `file` | File | 是 | 音频文件，支持 mp3/wav/webm/ogg/m4a；非 mp3 在 ffmpeg 可用时转码为 mp3 |
| `duration_sec` | float | 否 | 客户端解码得到的时长；缺省由后端探测 |

**行为：**
- 写入项目资产目录 `segments/{segment-id}.rec-{8位随机}.mp3`（唯一文件名，保证 `previous` 撤销有效）。
- 设为 `audio.current` 并标记 `origin: 'recorded'`（锁定，agent/批量合成自动跳过）。
- 原 `current` 降级为 `previous`（保留其 `origin`）；不再被引用的旧文件从磁盘清理。

**Response:** 完整 `ProjectDetail` 对象。
**错误:** `404 segment_not_found`；`422 unsupported_audio_format / empty_audio`。

### POST `/api/segmented-projects/{id}/export-all-chapters`

一键导出项目**所有章节**的合成音频与字幕到项目导出目录（仅 backend 存储模式）。
每章产出 `{安全章节标题}.mp3` + `{安全章节标题}.srt`（章节内时间轴从 0 开始，风格 tag 已清洗）。

**Request:** 无 body。

**目录解析**（`resolve_export_target_dir`）：
1. `configs.export_directory` 为绝对路径（或 `~`）→ 直接使用，无需 Remotion 路径。
2. 相对路径 / 未设置且 `remotion_project_path` 已配置 → `{remotion_project_path}/{export_directory || 'public/audio'}`。
3. 否则 → `409 export_directory_not_configured`。

**预检**：任一章节存在缺音频（或音频文件丢失）的段落 → 整体中止，不写出任何文件。

**Response 200:**
```json
{
  "exported": [
    {"chapter_id": "c1", "title": "第一章", "audio_path": "/abs/out/第一章.mp3", "srt_path": "/abs/out/第一章.srt"}
  ],
  "count": 1
}
```

**错误:**
- `404 project_not_found`
- `409 export_directory_not_configured`（detail 为 `{code, message}`，A8 信封）
- `409 chapters_incomplete`（detail 为 `{code, message, chapters: ["章节名", ...], missing_counts: {"章节名": 缺音频分片数}}`；任一分片音频文件缺失即整体中止，不写任何文件）
- `422` ffmpeg 不可用 / 拼接失败

### GET `/api/segmented-projects/{id}/chapters/{cid}/sync-status`

Layer-sync Phase A：返回章节三层文本（L1 原文 / L2 改写稿 / L3 分段）的陈旧标记。

**Response:**
```json
{ "l1_dirty": false, "l2_dirty": false, "l3_dirty": true }
```

某层 hash 未设置（未拆分/旧章节）时对应 `false`。前端章节头据此显示 badge。

### GET `/api/segmented-projects/{id}/usage`

项目级用量合计：该项目归属的 `usage_events`（TTS 合成次数、字符数、LLM input/output token）聚合。
归属校验复用仓储作用域：workers 模式下他人项目返回 404（不泄露存在性）；local 单租户直接聚合。

**Response:**
```json
{
  "project_id": "project-uuid",
  "tts_count": 12,
  "chars": 3456,
  "input_tokens": 789,
  "output_tokens": 123
}
```

**错误:** 404 `project_not_found`。

前端在 ProjectOverview 的项目用量卡展示（仅 backend 存储模式的项目）。

### POST `/api/segmented-projects/{id}/chapters/{cid}/adjust-audio`

合成后音频调整：对本章所有已生成音频（`audio.current` 存在且文件在位）用 ffmpeg 做 `atempo`（0.5–2.0，不变调）和/或 `volume`（-12 ~ +12 dB）批处理。

**绝对语义**：首次调整把原始音频存入 `audio.previous`；再次调整始终从原始音频渲染（不在成品上级联）；已应用参数记录在 `chapter.audio_adjust`（`{tempo, volume_db, applied_at, segments}`）。传恒等参数（1.0×/0dB）且有记录时视为**还原原始**并清除记录（无记录则 422 `no_adjustment`）。

**录音段豁免**：`current.origin == "recorded"` 的用户录音段不参与变速——不渲染、不覆盖，恒等还原同样跳过（防止旧 TTS 变速版盖掉录音）。
`chapter.audio_adjust` 由本端点独占管理：`PUT /segmented-projects/{id}` 的 payload 中即使携带 `audio_adjust` 也会被忽略。
时长在渲染后重新 probe；probe 失败则整次调整中止报错（500 `probe_failed`，DB 经 SAVEPOINT 回滚，不落半完成状态）。

**Request Body:**
```json
{ "tempo": 1.5, "volume_db": 3 }
```
两者至少提供一个非恒等值（除非已有记录）。

**Response:**
```json
{ "adjusted": 5, "skipped_recorded": 1, "project": { ... } }
```
`adjusted` 为实际渲染的段数；`skipped_recorded` 为被豁免跳过的录音段数。

**错误:** 404 `chapter_not_found`；422 `tempo_out_of_range` / `volume_db_out_of_range` / `no_adjustment` / `ffmpeg_unavailable`。

### POST `/api/segmented-projects/{id}/chapters/{cid}/resplit-from-script`

Layer-sync Phase B：以当前 L2（`narration_script`）重新拆分 segments。
按章节 `split_config.delimiters` 走 `rule_split`，全部旧 segment（含 role/emotion/voice 配置）丢弃并分配新 ID，随后重基线 `sync_state` 与每段 `split_anchor`。

**Request Body:** 无。

**Response:** 完整 `ProjectDetail` 对象（含新 segments）。

**错误:** 404 `chapter_not_found`。

⚠ 前端必须先弹确认，明示"将丢弃 N 段的 role/emotion/voice 配置"。

### POST `/api/segmented-projects/{id}/chapters/{cid}/rewrite-script-from-segments`

Layer-sync Phase B：把 L3 分段文本的改动定位合并回写 L2。
前置条件 `l2_dirty == false`；从后往前按每段 `split_anchor.offset_*` 把 `text != baseline_text` 的段替换进 L2，未被任何 segment 覆盖的 L2 内容（标题/空行等）保留。完成后重基线 `sync_state` 并重算所有段的 `split_anchor`。

**Request Body:** 无。

**Response:**
```json
{ "narration_script": "回写后的完整改写稿" }
```

**错误:** 404 `chapter_not_found`；409 `l2_dirty_conflict`（L2 自上次拆分后也被编辑，前端走冲突分支）。

边界：无 `split_anchor` 的段（新增段）跳过；删除的段对应 L2 区域保留；L3 不允许重排。

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
| `target_dir` | string | `null` | 可选；缺省依次回退：项目的 `remotion_project_path` -> 全局设置 `{animation_root_folder}/{safe_project_name}`（见 `GET/PUT /api/config/animation-root`）。三者皆空时返回 422。 |

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

**Errors:** 404 `project_not_found`；422 `animation_root_not_configured`；500 `npx_not_found` / `create_video_failed`。

### GET `/api/segmented-projects/{id}/export`

导出项目为自包含 ZIP 包（`{name}.narraforge.zip`），含 `manifest.json`（DB 行快照）+ `assets/`（segment 音频、voice 试听/参考音频）+ `text/`（源/旁白文档人读副本）。非破坏：不修改原项目。草稿项目禁止导出。

**Response:** `application/zip`（Content-Disposition 附件下载，文件名 RFC 5987 编码）。

**Errors:** 403 `cannot_export_scratchpad`；404 `project_not_found`；422 `project_assets_not_under_project_dir`（资产未迁移到项目目录，先跑 `migrate_asset_layout`）。

### POST `/api/segmented-projects/import`

从 ZIP 包导入为**新项目**：ID 全重映射，不覆盖同名。FK（chapter/segment/role/voice_profile）重写；音频文件落盘并重写路径；`remotion_project_path` 清空；文本镜像重建。

**Request:** `multipart/form-data`，字段 `file` = ZIP。

**Response:** `201` + 新项目 `ProjectDetail`。

**Errors:** 422 `invalid_bundle`（非 ZIP / manifest 损坏）或 `unsupported bundle_version`。

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

### POST `/api/segmented-projects/sweep-orphan-audio`

孤儿音频文件 sweep（2026-08-27 粒度重构 Phase 6；local-only，workers 模式不挂载）。

自 Phase 0 起文件删除只由显式意图触发（删段/删章/重拆只删 DB 行，音频文件留盘），孤儿文件由此端点统一回收。

**Request Body:**
```json
{ "execute": false }
```

**dry-run 默认**（缺省或 `execute=false`）：只报告不删；`execute=true` 才真正 unlink。

判据：文件位于段级音频固定布局 `{slug}/chapters/{chapter-id}/segments/*.{mp3,wav}`（含 `.prev` 变体），且未被任何段行的 `audio.current`/`audio.previous` 引用（相对/绝对路径均可）。非音频文件（`.txt` 镜像、manifest、文档）绝不在扫描范围。

**Response (200):**
```json
{
  "dry_run": true,
  "orphans": [{ "path": "slug/chapters/c1/segments/s-ghost.mp3", "size_bytes": 12345 }],
  "total_count": 1,
  "total_size_bytes": 12345,
  "deleted_count": 0
}
```

`path` 为 `segmented_dir` 相对路径；dry-run 时 `deleted_count` 恒 0。

---

## 管理后台 (`/api/admin`)

仅 workers 模式挂载；全部端点要求管理员（legacy admin 恒通过，用户 JWT 邮箱需在 `ADMIN_EMAILS` 内，
否则 `403 admin_required`）。数据来自 Supabase 统计表（由 stats 中间件 best-effort 写入）。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/stats/overview` | 总览：总用户数、今日 DAU、近 30 天 DAU/访问量序列 |
| GET | `/api/admin/users` | 用户列表（分页，含操作次数） |
| GET | `/api/admin/logs` | 操作日志（分页，支持 user_id/action/date 过滤） |

### GET `/api/admin/stats/overview`

**Response:**
```json
{
  "total_users": 3,
  "today_dau": 1,
  "dau_series": [{ "date": "2026-08-17", "count": 1 }],
  "visit_series": [{ "date": "2026-08-17", "authed": 10, "anon": 2 }]
}
```

`dau_series` / `visit_series` 为近 30 天逐日序列。

### GET `/api/admin/users`

**Query:** `page`（默认 1）、`page_size`（默认 20，上限 200）。

**Response:**
```json
{
  "items": [
    {
      "id": "user-uuid",
      "email": "a@example.com",
      "created_at": "2026-08-01T00:00:00",
      "last_seen_at": "2026-08-17T03:00:00",
      "is_admin": true,
      "operation_count": 42
    }
  ],
  "total": 3,
  "page": 1,
  "page_size": 20
}
```

### GET `/api/admin/logs`

**Query:** `page`、`page_size`（默认 50）、`user_id`、`action`、`date`（`YYYY-MM-DD` 前缀过滤），均可选；按 `created_at` 倒序。

**Response:**
```json
{
  "items": [
    {
      "id": 1,
      "user_id": "user-uuid",
      "action": "tts.synthesize",
      "method": "POST",
      "path": "/api/tts/synthesize",
      "status": 200,
      "duration_ms": 1234,
      "created_at": "2026-08-17T03:00:00"
    }
  ],
  "total": 100,
  "page": 1,
  "page_size": 50
}
```

---

## 当前用户用量 (`/api/me`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/me/usage` | 当前用户用量：按项目分桶 + 总计 |

### GET `/api/me/usage`

两种部署模式都可用：workers 模式经仓储作用域只见本人数据；local 单租户返回全量用量。
`/api/me/*` 不在 workers 匿名 allowlist 中，匿名请求由认证中间件返回 `401 auth_required`。

**Response:**
```json
{
  "projects": [
    {
      "project_id": "project-uuid",
      "project_name": "项目名称",
      "tts_count": 12,
      "chars": 3456,
      "input_tokens": 789,
      "output_tokens": 123
    }
  ],
  "totals": { "tts_count": 12, "chars": 3456, "input_tokens": 789, "output_tokens": 123 }
}
```

- `projects` 按 `project_id` 分桶；`project_id` 为 `null` 的桶是无项目上下文的 LLM 调用（字幕校准/翻译、文本拆分）。
- `project_name` 从 `segmented_projects` 解析；已删除或无归属的项目为 `null`。
- `estimated=true` 的字符估算 token 与 API 返回 token 混合合计（不区分）。

前端有全局 Usage 页（导航 id `usage`，workers 匿名时隐藏），数据来自本端点。

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
- `401` — 未认证（workers 模式匿名访问非 allowlist 端点，`auth_required`）
- `403` — 权限不足（workers 模式非管理员访问 `/api/admin/*`，`admin_required`）
- `404` — 资源不存在（workers 模式下也用于跨用户访问，不泄露存在性）
- `409` — 资源冲突（如重复描述、项目已存在、配额上限 `project_limit_reached` / `chapter_limit_reached`）
- `422` — 请求体验证失败（含内容约束 `segment_too_long`）
- `500` — 服务器内部错误
- `502` — 外部服务调用失败（如 LLM API）
