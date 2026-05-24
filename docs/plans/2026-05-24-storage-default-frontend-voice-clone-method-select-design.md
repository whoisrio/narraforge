# 存储模式默认改为前端 & 声音克隆方法选择 设计方案

**日期**: 2026-05-24  
**状态**: 设计确认，待实现

---

## 概述

两个关联改动：

1. **存储模式默认值改为 `frontend`** — 新建实例默认使用前端 IndexedDB 存储
2. **声音克隆方法选择流程** — 用户先选择获取声音的方式（录制/上传/URL），再进入预览和克隆

---

## 一、存储模式默认值改为 frontend

### 1.1 后端

`system_config_service.py` 的 `get_storage_mode` 默认参数从 `STORAGE_MODE_BACKEND` 改为 `STORAGE_MODE_FRONTEND`。

```python
# 改前
def get_storage_mode(db: Session) -> str:
    mode = get_config(db, "storage_mode", STORAGE_MODE_BACKEND)

# 改后
def get_storage_mode(db: Session) -> str:
    mode = get_config(db, "storage_mode", STORAGE_MODE_FRONTEND)
```

### 1.2 前端

| 文件 | 改动 |
|------|------|
| `useStorageMode.ts` | Context 默认值 `'backend'` → `'frontend'` |
| `App.tsx` | `useState<StorageMode>` 初始值和 API 失败 fallback 改为 `'frontend'` |

---

## 二、声音克隆 — 方法选择流程（逐步引导）

### 2.1 交互流程

VoiceClone 页面使用三级状态机驱动：

```
STEP_CHOOSE_METHOD  →  STEP_INPUT  →  STEP_PREVIEW_CLONE
```

```
┌─────────────────────────────────────────────────────┐
│  STEP_CHOOSE_METHOD                                 │
│  三个方式卡片：🎙️ 实时录制 / 📁 上传文件 / 🌐 公网URL  │
│  点击任一 → STEP_INPUT                                │
├─────────────────────────────────────────────────────┤
│  STEP_INPUT                                         │
│  录制模式 → <AudioRecorder />                        │
│  上传模式 → <AudioUploader />                        │
│  URL模式  → <UrlInput />  (输入框 + 确认按钮)         │
│  完成/确认 → STEP_PREVIEW_CLONE                       │
├─────────────────────────────────────────────────────┤
│  STEP_PREVIEW_CLONE                                 │
│  <AudioPreview />  (音频播放 + "Clone Voice" 按钮)    │
│  成功/取消 → 回到 STEP_CHOOSE_METHOD                  │
└─────────────────────────────────────────────────────┘
```

### 2.2 URL 模式专属流程

1. 用户输入公网 URL → 点击「确认」
2. 前端调用已有接口 `POST /api/clone/upload-from-url`
3. 后端：`HEAD` 校验可访问 → 下载音频到 `uploads/voices/` → 保存 `external_audio_url` 到 DB
4. 返回 `{ id, name, audio_url, external_audio_url }`
5. 前端将 `voiceId` 传入 `AudioPreview`，跳过 upload 步骤
6. 点击「Clone Voice」→ `POST /api/clone/create-clone`，后端优先使用 `external_audio_url` 调 Qwen API

### 2.3 影响范围

| 文件 | 改动 |
|------|------|
| `frontend/src/pages/VoiceClone.tsx` | 引入 step 状态机 |
| `frontend/src/components/VoiceClone/UrlInput.tsx` | **新建**：公网 URL 输入 + 确认按钮 |
| `frontend/src/components/VoiceClone/AudioPreview.tsx` | 扩展支持 `voiceId` prop |
| `frontend/src/services/api.ts` | 新增 `voiceApi.uploadFromUrl()` |
| `VoiceClone.module.css` | 新增样式 |
| `backend/app/core/system_config_service.py` | 默认值改 frontend |
| `frontend/src/hooks/useStorageMode.ts` | 默认值改 frontend |
| `frontend/src/App.tsx` | 默认值改 frontend |