# NarraForge Roadmap

> NarraForge 是文档/音频/视频音轨驱动的项目制分段配音工作台。主线不是视频剪辑，而是从原始素材提取叙事内容，打磨为口播文稿，拆分为可控分段，生成语音、字幕和下游制作 Brief。

## 0. 产品边界

### 核心主线

```text
原始素材
  ├── 文本 / Markdown / PDF / 网页
  ├── 音频
  └── 视频音轨（FFmpeg 抽音频，不做画面理解）
        ↓
素材解析 / 转写
        ↓
口播文稿打磨
        ↓
章节 / 分段
        ↓
分段语音
        ↓
导出音频 / 字幕 / manifest / 制作 Brief
```

### NarraForge 做什么

- 文档理解与清理
- 音频转写
- 视频音轨抽取与转写
- 原文/转写稿到口播文稿
- 章节、分段、情绪、停顿管理
- 分段语音生成
- 音色资产管理
- 字幕、音频、manifest 导出
- 基于完整文稿和分段语音生成视觉/动画/视频制作 Brief

### NarraForge 不做什么

- 不做 Premiere 式视频剪辑器
- 不做多轨自由剪辑
- 不做视频画面理解（近期）
- 不做关键帧 OCR / 场景识别 / 多模态视觉分析（近期）
- 不让素材轨道反过来主导工作流

视频输入的近期定义：视频是带音轨的原始素材。系统用 FFmpeg 抽取音频，再基于 ASR 转写理解内容。

---

## Phase 0：文档与产品骨架整理

**目标：** 把产品方向、阶段计划和边界写清楚，避免后续功能发散。

**预计：** 0.5 天

**文档位置：** 全部放在 `docs/` 下。

建议维护：

- `docs/roadmap.md`：总路线图
- `docs/todo-list.md`：简短 TODO 索引
- `docs/config-onboarding.md`：配置引导设计
- `docs/source-ingestion.md`：文本/音频/视频输入设计
- `docs/narration-pipeline.md`：原文到口播稿流程
- `docs/voice-library-plan.md`：音色库规划
- `docs/visual-production-brief.md`：视觉制作 Brief 规划

---

## Phase 1：项目制语音工作台重构

**目标：** 从“单段/分段双模式”统一成“项目制分段配音”。

**预计：** 2-4 天

### 核心决策

- 删除单段模式
- 默认进入草稿项目
- 分段配音成为唯一主流程
- 项目管理从下拉框升级为可收缩侧栏
- 草稿项目替代原来的快速单段体验
- 分段音频都挂在项目/章节/段落下

### 1. 草稿项目

固定 ID：

```ts
const SCRATCHPAD_PROJECT_ID = '__scratchpad__';
```

规则：

- 永远存在
- 默认进入
- 不可删除
- 不可重命名
- 单章节隐藏章节选择器
- 可清空
- 适合临时试稿、快速生成

### 2. 可收缩项目侧栏

状态：

- 收起态：48px，只显示图标
- 展开态：220px，显示项目名、段数、时长、更新时间
- 状态保存到 `localStorage('sidebar_expanded')`

收起态示例：

```text
★
📖
📖
+
```

展开态示例：

```text
项目  ◀

★ 草稿
  8 段 · 2:35
  刚刚编辑

📖 DeepSeek 解说
  3 章 · 8:20
  2 小时前

+ 新建项目
```

### 3. 主编辑区重排

保留：

- 项目名 / 章节选择
- 统计：段数、总时长、已生成数量
- 全部生成
- 全部播放
- 导出
- 引擎和音色控制
- 文稿输入 / 分段
- SegmentList

### 4. 删除旧链路

删除或废弃：

- 单段模式 JSX
- `SynthesisHistory`
- 单段 `AudioPlayer`
- `TTSResult` IndexedDB 历史链路

---

## Phase 1.5：配置引导 / 模型能力中心

**目标：** 在用户使用 LLM、ASR、TTS、克隆、本地模型之前，明确当前能力是否可用，以及缺什么配置。

**建议时机：** 项目制重构之后，文稿打磨和多输入之前。

**预计：** MVP 2-3 天；完整 5-7 天

### 为什么放在这里

后续功能都依赖模型能力：

- 文档 → 口播稿：依赖 LLM
- 音频/视频 → 转写：依赖 ASR
- 智能分段 + 情感标注：依赖 LLM
- 音色克隆：依赖外部 API 或本地模型
- 视觉制作 Brief：依赖强 LLM
- 本地模型：依赖模型下载、缓存路径、硬件资源

如果没有配置引导，用户会在点击功能后才遇到 API key 缺失、模型未下载、显存/内存不足等问题。

### 首次使用向导

```text
欢迎使用 NarraForge

你想如何使用模型能力？

[使用在线模型]
  适合：快速开始，质量稳定
  需要：API Key

[使用本地模型]
  适合：隐私、本地化、离线
  需要：下载模型，检查硬件资源

[先跳过]
  只使用 Edge-TTS 和基础编辑功能
```

### 模型能力中心

长期入口：

```text
设置 → 模型能力
```

能力面板：

```text
能力                  状态
────────────────────────────
文本打磨 LLM           ✅ 已配置 Qwen
智能分段 LLM           ✅ 已配置 Qwen
语音转文字 ASR         ⚠️ 本地模型未下载
CosyVoice 克隆         ❌ 缺少 QWEN_API_KEY
MiMo TTS               ❌ 缺少 MIMO_API_KEY
Edge-TTS               ✅ 可用，无需配置
FFmpeg 视频抽音频      ✅ 可用
```

### 外部模型配置

支持：

- Qwen API
- MiMo API
- OpenAI-compatible provider
- Base URL
- API Key
- Model Name
- 测试连接

示例模型：

```ts
interface ExternalModelProvider {
  id: string;
  type: 'openai_compatible' | 'qwen' | 'mimo';
  name: string;
  base_url?: string;
  api_key?: string;
  model: string;
  capabilities: ('llm' | 'tts' | 'voice_clone' | 'asr')[];
  enabled: boolean;
}
```

### 本地模型配置

按能力区分：

1. 本地 ASR：FunASR / Whisper，用于音频转写、视频音轨转写、字幕生成。
2. 本地 LLM：Ollama / llama.cpp / vLLM / LM Studio，用于文稿打磨、智能分段、情感标注、制作 Brief。
3. 本地 TTS / Voice Clone：后续再深入，不建议 MVP 重投入。

### 本地硬件资源评估

后端接口：

```http
GET /api/system/hardware
```

返回示例：

```json
{
  "os": "macOS",
  "arch": "arm64",
  "cpu": "Apple M3 Max",
  "memory_gb": 36,
  "disk_free_gb": 420,
  "gpu": {
    "type": "apple_silicon",
    "metal_available": true
  },
  "tools": {
    "ffmpeg": true,
    "uv": true
  }
}
```

模型推荐示例：

```text
你的设备：Apple Silicon / 36GB 内存

推荐：
✅ FunASR paraformer-zh：可运行
✅ Whisper small：可运行
✅ Qwen2.5 7B Q4：可运行
⚠️ Qwen2.5 14B Q4：可运行但较慢
❌ 32B 本地模型：不建议
```

### MVP 范围

做：

- 首次使用向导
- API Key 配置
- 测试连接
- FFmpeg 检测
- ASR 模型状态检测
- 简单硬件评估：内存、磁盘、架构
- 功能可用性面板

暂不做：

- 自动下载所有本地 LLM
- 复杂 benchmark
- GPU 性能打分
- 本地 TTS 大模型管理
- 模型市场

---

## Phase 2：输入源统一：文本 / 音频 / 视频音轨

**目标：** 支持多种原始输入，但统一转成文本，不做视频画面理解。

**预计：** 3-5 天

### 输入类型

- 文本：粘贴文本、txt、Markdown；后续 PDF/DOCX/网页
- 音频：mp3、wav、m4a、webm
- 视频：mp4、mov、mkv、webm

### 视频处理边界

```text
视频 → FFmpeg 抽音频 → ASR → 转写文本
```

明确不做：

- 关键帧理解
- 画面 OCR
- 场景识别
- 多模态视觉分析

### SourceDocument 模型

```ts
interface SourceDocument {
  id: string;
  sourceType: 'text' | 'audio' | 'video';
  title: string;

  originalFileName?: string;
  originalAssetPath?: string;

  extractedAudioPath?: string;

  transcriptText?: string;
  transcriptSegments?: {
    startMs: number;
    endMs: number;
    text: string;
    speaker?: string;
  }[];

  cleanedText?: string;
  narrationText?: string;

  createdAt: string;
  updatedAt: string;
}
```

### 视频抽音频命令

```bash
ffmpeg -i input.mp4 -vn -acodec pcm_s16le -ar 16000 -ac 1 extracted.wav
```

### UI 文案

```text
导入素材

[粘贴文本] [上传音频] [上传视频]

视频导入仅提取音轨，不分析画面。
系统会根据音频转写内容生成文稿。
```

---

## Phase 3：原始文档 → 口播文稿

**目标：** 把原始文本/转写稿转换成适合中文 TTS 朗读的口播文稿。

**预计：** MVP 2-3 天；专业版 5-7 天

### 流程

```text
原始文本 / 转写稿
  ↓
清理格式
  ↓
事实/术语提取
  ↓
口播化改写
  ↓
质量检查
  ↓
应用到当前章节
  ↓
智能拆分
```

### 第一版能力

1. 清理格式
   - Markdown 清理
   - 表格转自然语言
   - URL 删除
   - 脚注删除
   - 多余空行删除
   - 保留关键数字/术语

2. 口播化改写
   - 知识科普
   - 商业分析
   - 纪录片旁白
   - 技术讲解
   - 有声书叙事
   - 短视频快节奏

3. 长度控制
   - 精简
   - 保持
   - 略扩展

4. 质量检查
   - 是否保留关键数字
   - 是否还有 Markdown 残留
   - 是否有 URL
   - 是否句子过长
   - 是否过度 AI 腔
   - 按中文 5 字/秒估算时长

5. 应用
   - 应用到当前章节
   - 应用并智能拆分

### API

```http
POST /api/text-polish/to-narration
```

Request：

```json
{
  "text": "...",
  "style": "knowledge_explainer",
  "length": "keep",
  "preserve_terms": true
}
```

Response：

```json
{
  "narration_text": "...",
  "summary": "...",
  "stats": {
    "original_chars": 3200,
    "narration_chars": 2600,
    "estimated_seconds": 520,
    "markdown_removed": true
  },
  "warnings": []
}
```

---

## Phase 4：分段语音工作流精修

**目标：** 让核心配音体验更专业、稳定、可控。

**预计：** 2-4 天

### 分段质量增强

- 智能拆分更稳定
- 情感标注更准
- 长段警告
- 空段/过短段提示
- 建议停顿

### 批量生成增强

- 全部生成
- 只生成未生成
- 重新生成未锁定
- 跳过独立音色锁定段
- 明确 ConfirmDialog，不用原生 confirm

### 播放增强

- 全部播放
- 当前段高亮
- 时间范围显示
- 已生成/待生成统计

### 导出前检查

- 是否所有段落已生成
- 是否有过期音色
- 是否有失败段落
- 是否有空文本

---

## Phase 5：音色管理增强

**目标：** 把声音设计/克隆升级成真正的音色资产管理。

**建议时机：** 文稿打磨和分段语音稳定之后，视觉 Brief 之前。

**预计：** MVP 3-4 天；专业版 5-7 天

### VoiceAsset 模型

```ts
interface VoiceAsset {
  id: string;
  provider: 'edge_tts' | 'cosyvoice' | 'mimo';
  providerVoiceId: string;

  name: string;
  displayName: string;
  sourceType: 'system' | 'preset' | 'cloned';

  gender?: 'male' | 'female' | 'unknown';
  language?: string;

  tags: string[];
  description?: string;
  avatar?: string;
  sampleAudioId?: string;

  favorite?: boolean;
  qualityScore?: number;

  createdAt: string;
  updatedAt: string;
}
```

### 音色库结构

```text
音色库
  ├── 收藏
  ├── 系统音色
  ├── 我的克隆
  └── MiMo 预设
```

音色卡片：

```text
头像  我的旁白音
      CosyVoice · 克隆
      沉稳 / 男声 / 中文

[▶ 试听] [设为项目默认] [⋯]
```

### 应用范围

音色库必须能服务项目流程：

- 设为全局默认
- 设为当前项目默认
- 设为当前章节默认
- 应用到选中段落
- 应用到所有未生成段落
- 应用到所有未锁定段落

### 克隆管理

- 样本上传
- 克隆状态
- 失败原因
- 试听
- 重命名
- 标签
- 删除
- 设为默认

---

## Phase 6：导出增强

**目标：** 让 NarraForge 产出的内容真正能进入生产流程。

**预计：** 2-4 天

### 音频导出

- 整章音频
- 分段音频 ZIP
- 按章节导出
- 自动去除段间双重静音

### 字幕导出

- SRT
- ASS
- 纯文本
- 分段时间轴 JSON

### 项目数据导出

- 项目备份 JSON
- segment manifest

Manifest 示例：

```json
{
  "project": "DeepSeek 解说",
  "chapter": "第一章",
  "segments": [
    {
      "id": "seg_001",
      "index": 1,
      "text": "...",
      "emotion": "calm",
      "audio_file": "segment_001.wav",
      "duration_ms": 3400,
      "start_ms": 0,
      "end_ms": 3400,
      "voice": "Edge-TTS Xiaoxiao"
    }
  ]
}
```

---

## Phase 7：视觉 / 动画 / 视频制作 Brief

**目标：** 基于分段旁白生成下游制作要求，而不是做视频编辑器。

**预计：** MVP 5-7 天；专业版更长

### 边界

NarraForge 做：

- 整体视觉风格建议
- 每段视觉呈现要求
- Remotion 动画规格
- B-roll / 图表 / 截图 / Logo 的制作建议
- 严格时长约束
- 导出 Markdown / JSON / Remotion contract

NarraForge 不做：

- 多轨视频剪辑
- 素材库管理
- 调色
- 自由时间线剪辑
- 视频画面理解

### 输入

- 完整文稿
- 分段文本
- 每段语音时长
- 情感标签
- 用户风格偏好

### ProductionBrief 模型

```ts
interface ProductionBrief {
  id: string;
  projectId: string;
  chapterId: string;

  sourceDocumentSummary: string;
  narrativeIntent: string;

  globalVisualStyle: VisualStyle;

  segmentBriefs: SegmentProductionBrief[];
}
```

每段：

```ts
interface SegmentProductionBrief {
  segmentId: string;
  index: number;

  text: string;
  emotion: string;
  audioDurationMs: number;

  visualTreatment:
    | 'remotion_animation'
    | 'diagram_animation'
    | 'kinetic_typography'
    | 'broll_video'
    | 'still_image'
    | 'chart'
    | 'screenshot'
    | 'logo_montage'
    | 'mixed';

  productionIntent: string;
  visualDescription: string;

  timingRequirements: {
    durationMs: number;
    fps: number;
    mustMatchAudio: true;
    suggestedBeats: {
      atMs: number;
      action: string;
    }[];
  };

  remotionRequirements?: {
    compositionName: string;
    durationFrames: number;
    layout: string;
    animationBeats: string[];
    requiredElements: string[];
    technicalConstraints: string[];
  };

  videoRequirements?: {
    brollDescription?: string;
    stockSearchQueries?: string[];
    framing?: string;
    cameraMotion?: string;
  };

  assetRequirements: {
    type: 'logo' | 'image' | 'video' | 'chart' | 'screenshot' | 'svg';
    description: string;
    required: boolean;
  }[];
}
```

### 导出包

```text
production_brief.md
production_brief.json
visual_style.json
segment_manifest.json
audio/
subtitle/
remotion_contract.json   # 可选
```

---

## Phase 8：可选的回导 / 合成闭环

**目标：** 后期如有需要，把外部制作好的动画片段回导，与音频/字幕拼成完整视频。

**建议：** 后期再做，不作为近期主线。

### 允许做

- 按 segment_id 匹配动画文件
- 校验时长
- 拼接视频
- 叠字幕
- 合成旁白

### 不做

- Premiere 式剪辑
- 复杂多轨
- 关键帧编辑
- 素材管理

---

## 推荐近期执行顺序

### 第一批：把产品主线扶正

1. 完成 `docs/roadmap.md`
2. 去单段模式
3. 默认草稿项目
4. 可收缩项目侧栏
5. 项目/章节/分段 UI 收敛

### 第二批：模型能力底座

6. 首次使用配置引导
7. 模型能力中心
8. 外部 API 配置
9. FFmpeg / ASR / 本地硬件检测
10. 功能可用性状态

### 第三批：输入与口播稿

11. 文本导入
12. 音频 ASR
13. 视频 FFmpeg 抽音频 + ASR
14. 文稿清理
15. 口播化改写
16. 应用并智能拆分

### 第四批：语音专业化

17. 分段生成体验打磨
18. 音色库增强
19. 音色应用范围
20. 克隆管理重做
21. 导出增强

### 第五批：制作 Brief

22. 视觉制作 Brief
23. Remotion contract
24. Markdown / JSON 导出
25. 后续再考虑回导合成

---

## 阶段结论

配置引导应该放在：

```text
项目制重构之后，文稿打磨和多输入之前。
```

原因：

- 项目制重构决定产品结构
- 配置引导决定模型能力是否可用
- 文稿打磨、ASR、音色克隆、制作 Brief 都依赖模型配置
- 本地模型尤其需要提前做硬件评估，否则用户会踩坑

最终路线：

```text
Phase 0   文档与路线
Phase 1   项目制语音工作台
Phase 1.5 配置引导 / 模型能力中心
Phase 2   文本/音频/视频音轨输入
Phase 3   原文 → 口播文稿
Phase 4   分段语音体验精修
Phase 5   音色库增强
Phase 6   导出增强
Phase 7   视觉制作 Brief
Phase 8   回导合成（可选后期）
```
