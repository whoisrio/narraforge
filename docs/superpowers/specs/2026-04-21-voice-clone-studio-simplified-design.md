# Voice Clone Studio - Simplified Design

## Overview

重新设计 Voice Clone，聚焦核心功能：声音克隆、声音列表管理、TTS 文字转语音、音频下载。

移除过重的 Timeline/视频编辑功能，简化为标签页式工具。

## Pages

### Page 1: Voice Clone (声音克隆)

**Features:**
- 录制/上传参考音频（支持 WebM/MP3/WAV/OGG，WebM 自动转 MP3）
- 输入声音名称
- 一键克隆，显示实时进度
- 克隆成功后自动添加到可用声音列表
- 已克隆声音列表展示（可删除）

**API:**
- `POST /api/clone/upload` - 上传参考音频
- `POST /api/clone/create-clone` - 调用千问 API 创建克隆
- `GET /api/clone/list` - 获取已克隆声音列表
- `DELETE /api/clone/{id}` - 删除克隆声音

### Page 2: TTS Synthesis (文字转语音)

**Features:**
- 多行文本输入框
- 声音选择器：
  - 分组显示：默认声音 | 克隆声音
  - 预览声音（播放参考音频，仅默认声音）
- 参数控制：
  - 语言：中文、英文、日语、韩语等（对应 Qwen 的 language_type）
  - 语速：0.5x - 2.0x（滑块）
  - 音量：0 - 100（滑块）
  - 语调：-12 到 +12（滑块）
  - 语气：平静、开心、悲伤、紧张等（下拉，对应 Qwen 的 instructions）
- 生成按钮（显示加载状态）
- 音频播放器（播放器）
- 下载按钮（支持 MP3/WAV 格式选择）

**API:**
- `GET /api/tts/voices` - 获取可用声音列表（默认+克隆）
- `POST /api/tts/synthesize` - 合成语音
- `GET /api/tts/audio/{id}` - 获取生成的音频

## Architecture

### Backend (FastAPI)

**Keep:**
- `app/api/clone.py` - 声音克隆 API
- `app/api/tts.py` - TTS 合成 API
- `app/models/voice_profile.py` - 声音档案模型
- `app/services/qwen_tts_service.py` - Qwen TTS 服务

**Remove:**
- `app/api/timeline.py` - 移除时间轴 API
- `app/models/timeline.py` - 移除时间轴模型

**Simplify:**
- 合并 `app/api/config.py` 到相关路由（如果只是简单配置）
- 简化 `app/api/tts.py`，移除 batch 相关的复杂逻辑

### Frontend (React + TypeScript + Vite)

**Structure:**
```
frontend/src/
├── App.tsx                 # 主应用，包含 Tab 导航
├── pages/
│   ├── VoiceClone.tsx      # 声音克隆页面
│   └── TTSSynthesis.tsx    # TTS 合成页面
├── components/
│   ├── VoiceClone/
│   │   ├── AudioRecorder.tsx
│   │   ├── AudioUploader.tsx
│   │   └── VoiceList.tsx
│   ├── TTSSynthesis/
│   │   ├── VoiceSelector.tsx
│   │   ├── TextEditor.tsx
│   │   ├── ParameterControls.tsx
│   │   └── AudioPlayer.tsx
│   └── ui/                # 通用 UI 组件
├── api/
│   └── client.ts           # API 客户端
└── types/
    └── index.ts            # TypeScript 类型定义
```

## Qwen API 参数映射

### TTS Series (qwen-tts-*)
- `voice`: 声音 ID（默认声音或克隆声音）
- `language_type`: 语言类型（Chinese, English, Japanese, Korean 等）
- `speed_ratio`: 语速（0.5-2.0）
- `volume`: 音量（0-100）
- `pitch_ratio`: 语调（-12 到 12）
- `format`: 音频格式（wav, mp3）
- `sample_rate`: 采样率（通常 16000）
- `instructions`: 语气指令（qwen3-tts-instruct-flash 模型支持）

### CosyVoice Series (cosyvoice-*)
- `voice`: 声音 ID
- `speed`: 语速（0.5-2.0）
- `volume`: 音量（0-100）
- `pitch`: 语调（-12 到 12）
- `format`: 音频格式
- `sample_rate`: 采样率

## Default Voices

Qwen TTS 提供的默认声音：
- xiaoyun (云溪) - 女
- xiaoyuan (晓晓) - 女
- ruoxi (若曦) - 女
- xiaogang (小刚) - 男
- yunjian (云健) - 男

## Language Support

- Chinese (中文)
- English (英文)
- Japanese (日语)
- Korean (韩语)
- 其他 Qwen 支持的语言

## Emotion/Tone Support

基于 Qwen 的 `instructions` 参数（需要 qwen3-tts-instruct-flash 模型）：
- 平静（neutral）
- 开心（happy）
- 悲伤（sad）
- 紧张（nervous）
- 激动（excited）

## Implementation Plan

### Phase 1: Backend Cleanup
1. 移除 Timeline 相关 API 和模型
2. 简化 TTS API，移除 batch 逻辑
3. 确保 Clone API 正常工作

### Phase 2: Frontend Structure
1. 创建 Tab 导航结构
2. 创建 VoiceClone 页面组件
3. 创建 TTSSynthesis 页面组件

### Phase 3: Voice Clone Page
1. AudioRecorder 组件（浏览器录音）
2. AudioUploader 组件（文件上传）
3. VoiceList 组件（显示已克隆声音）
4. 连接后端 Clone API

### Phase 4: TTS Synthesis Page
1. VoiceSelector 组件（声音选择，分组显示）
2. TextEditor 组件（文本输入）
3. ParameterControls 组件（参数调节）
4. AudioPlayer 组件（播放+下载）
5. 连接后端 TTS API

### Phase 5: Polish
1. 加载状态和错误处理
2. 响应式设计
3. 样式优化
4. 测试

## Success Criteria

1. 可以成功录制/上传音频并克隆声音
2. 可以在声音列表中看到默认声音和克隆声音
3. 可以选择声音并合成语音
4. 可以调节语言、语速、音量、语调等参数
5. 可以播放和下载生成的音频
6. 整体界面简洁易用，符合标签页式设计
