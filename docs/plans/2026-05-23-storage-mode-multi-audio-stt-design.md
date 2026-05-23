# 存储模式切换 & 多音频拼接字幕识别 设计方案

**日期**: 2026-05-23  
**状态**: 设计确认，待实现

---

## 概述

三个关联改动：

1. **存储模式配置** — 允许用户在「后端存储」和「前端 IndexedDB 存储」之间切换
2. **Tab 切换保持内容** — 切换 Tab 时不卸载组件，保留页面状态
3. **多音频拼接字幕识别** — 从 TTS 合成历史中选择多个音频，按序拼接（0.5s 静音间隔）后统一转字幕

---

## 一、系统配置 — 存储模式

### 1.1 后端

**新增数据库表 `system_config`**：

```sql
CREATE TABLE system_config (
    key        VARCHAR PRIMARY KEY,
    value      VARCHAR NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**新增 API**（挂在 `/api/config` 路由下）：

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/config/storage-mode` | 返回 `{ "storage_mode": "backend" \| "frontend" }` |
| `PUT` | `/api/config/storage-mode` | body: `{ "storage_mode": "..." }` |

默认值为 `"backend"`，首次访问时自动初始化。

**影响范围**：

| 端点 | 后端模式（现状） | 前端模式 |
|------|-----------------|---------|
| `POST /api/tts/synthesize` | 音频落盘 + DB 记录 | 返回 base64 音频数据，不落盘不写库 |
| `GET /api/tts/history` | 查 DB 返回 | 返回空列表 |
| `DELETE /api/tts/history/{id}` | 删文件 + 记录 | 返回 200（前端自行管理） |
| `POST /api/speech-to-text/transcribe` | 音频/SRT 落盘 + DB 记录 | 返回 SRT 内容，不落盘不写库 |
| `GET /api/speech-to-text/history` | 查 DB 返回 | 返回空列表 |
| `DELETE /api/speech-to-text/history/{id}` | 删文件 + 记录 | 返回 200 |

### 1.2 前端

- 导航栏右侧增加齿轮图标 → 设置面板 → 存储模式切换开关
- App 启动时调用 `GET /api/config/storage-mode`，结果通过 React Context 下发
- `api.ts` 新增 `configApi.getStorageMode()` / `configApi.setStorageMode()`

---

## 二、Tab 切换

**当前问题**：[App.tsx](../../frontend/src/App.tsx) 使用条件渲染，切换时组件卸载，状态丢失。

**方案**：三个页面全部挂载，用 `display: none/block` 控制显隐。

```tsx
// 改前（条件渲染 — 卸载）
{activeTab === 'voice-clone' && <VoiceClone />}

// 改后（CSS 显隐 — 保持挂载）
<div style={{ display: activeTab === 'voice-clone' ? 'block' : 'none' }}>
  <VoiceClone />
</div>
```

首次加载时三个页面同时挂载并各自拉取数据，后续切换不再重复加载。

---

## 三、多音频拼接字幕识别

### 3.1 前端交互

在 [SpeechToText.tsx](../../frontend/src/pages/SpeechToText.tsx) 中新增「从合成历史选择」区域，与现有「上传音频」并列。

交互流程：
1. 切换到「从合成历史选择」标签
2. 获取合成历史列表（后端模式调 API，前端模式读 IndexedDB）
3. 多选音频（复选框）
4. 在排序区拖拽调整顺序
5. 点击「合并并识别」

**前端存储模式**：选中的音频从 IndexedDB 取出 Blob → 通过 FormData 上传到后端合并端点。

### 3.2 后端 API

**新增端点** `POST /api/speech-to-text/merge-transcribe`（后端存储模式）：

```json
// 请求
{
  "audio_ids": ["id1", "id3", "id2"],
  "model_size": "large-v3",
  "beam_size": 5,
  "silence_seconds": 0.5
}

// 响应
{
  "file_id": "...",
  "filename": "merged_xxx.srt",
  "content": "1\n00:00:00,000 --> ...",
  "language": "zh",
  "language_probability": 0.98
}
```

**新增端点** `POST /api/speech-to-text/merge-transcribe-upload`（前端存储模式）：
- 接收多个音频文件（multipart）+ 顺序 + 参数
- 临时落盘 → ffmpeg 合并 → Whisper 识别 → 返回结果 → 清理临时文件

### 3.3 ffmpeg 拼接

使用 `ffmpeg` 的 concat 滤镜实现带静音间隔的拼接。每段之间插入 `silence_seconds` 秒静音。

在 [config.py](../../backend/app/core/config.py) 中新增 `ffmpeg_path` 配置项，默认 `"ffmpeg"`。

---

## 四、前端 IndexedDB 存储层

### 4.1 新增文件

```
frontend/src/services/indexedDB.ts   (新增)
```

### 4.2 数据库结构

| Object Store | Key | 内容 |
|-------------|-----|------|
| `tts_results` | `id` | `{ id, text, voice_name, audioBlob, audio_format, created_at, ... }` |
| `stt_results` | `id` | `{ id, original_filename, srtContent, language, created_at, ... }` |

### 4.3 导出方法

```typescript
// TTS
saveTTSResult(result: TTSResultRecord, audioBlob: Blob): Promise<void>
getTTSHistory(): Promise<TTSResultRecord[]>
deleteTTSResult(id: string): Promise<void>
getTTSAudioBlob(id: string): Promise<Blob | null>

// STT
saveSTTResult(record: STTLocalRecord): Promise<void>
getSTTHistory(): Promise<STTLocalRecord[]>
deleteSTTResult(id: string): Promise<void>
```

### 4.4 数据流

```
[后端模式]
  TTS: 合成 → 后端存储 → API 历史列表 → 页面展示
  STT: 识别 → 后端存储 → API 历史列表 → 页面展示

[前端模式]
  TTS: 合成 → 后端返回 base64 → IndexedDB → 本地历史列表 → 页面展示
  STT: 识别 → 后端返回 SRT → IndexedDB → 本地历史列表 → 页面展示
```

---

## 五、实现顺序

1. 后端：`system_config` 表 + 存储模式 API
2. 后端：TTS/STT 接口适配双模式
3. 前端：IndexedDB 存储层
4. 前端：存储模式 Context + 设置面板
5. 前端：Tab 切换改为 CSS 显隐
6. 后端：ffmpeg 合并 + 多音频识别 API
7. 前端：多音频选择 + 排序 + 合并识别交互