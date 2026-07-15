# NarraForge UI 大改造设计方案

> 状态：设计方案草案
> 日期：2026-06-23
> 范围：全局工作台、项目内 Library/Studio/Voices/Settings、全局字幕识别、全局音色设计

## 1. 背景与目标

当前 NarraForge 已经形成了“项目制分段配音”的主线，但 UI 仍然更像功能页集合：TTS、语音转文字、音色克隆、模型配置等相对割裂。`docs/design/stitch_narraforge_story_global_prj/` 下的设计稿提供了一套更完整的 Studio 视觉方向：暖石色与琥珀色、全局项目 Hub、项目内 Library、Voice Studio、Transcription Hub、新建项目流程。

本方案的目标不是照搬设计稿的小说/角色平台，而是吸收其视觉系统与布局骨架，重构为 NarraForge 的真实工作流：

```text
全局项目入口
  → 进入项目
    → Library 管理章节整体文本
    → Studio 选择章节进行分段语音合成
    → Voices 管理项目内声音角色/配音位
    → Settings 配置 Remotion 路径与项目默认参数

全局工具
  → 字幕识别：多文件上传、拼接、统一 ASR、导出 SRT
  → 音色设计：全局音色资产、克隆音色、风格预设
```

明确暂缓：Source Library 相关 UI 暂不作为本轮主线。原始素材/Source 能力后续再与 Library/字幕识别衔接。

---

## 2. 设计原则

### 2.1 保留设计稿的视觉方向

采用 Warm Stone & Amber Studio 风格：

- 背景：亚麻/羊皮纸暖色，而不是冷灰后台。
- 主色：继续以 NarraForge 既定琥珀色 `#c47a3a` 为主。
- 深铜色 `#8b4c0d` 用作 primary-dark、标题强调、深态文字，不直接替代主品牌色。
- 卡片、侧栏、顶栏采用轻质感层级：暖边框、柔阴影、轻微毛玻璃。
- 交互反馈使用轻微 scale/hover/glow，但避免模板感和廉价动效。

推荐色彩映射：

```css
--color-primary: #c47a3a;
--color-primary-dark: #8b4c0d;
--color-primary-light: #d4944e;
--color-primary-container: #ffdcc3;

--color-background: #fff8f1;
--color-surface: #ffffff;
--color-surface-low: #f9f3eb;
--color-surface-container: #f3ede6;
--color-surface-high: #ede7e0;

--color-text-primary: #1d1b17;
--color-text-secondary: #534439;
--color-border: #e8e1db;
--color-border-strong: #d8c2b4;

--color-success: #2a9d8f;
--color-warning: #d4944e;
--color-danger: #c0392b;
```

### 2.2 不让产品被 Character-first 带偏

设计稿中的 Character / World Building / Manuscript 概念偏小说创作平台。NarraForge 的核心是 narration workshop，不应把角色作为全局主概念。

本轮定义：

- 全局管理的是 Voice Profile / 音色档案。
- 项目内使用的是 Voice Role / 声音角色 / 配音位。
- Character 只是 Voice Role 的一种使用场景，不是主导航和主数据模型。

### 2.3 Library 与 Studio 明确分工

项目内最核心的拆分：

```text
Library = 章节整体文本管理
Studio  = 选择章节后的分段语音合成工作台
```

Library 不处理单段语音合成；Studio 不承担章节整体文本资产管理。

### 2.4 生成结果不可被隐式覆盖

无论是项目默认音色、Voice Role、全局参数还是模型选择发生变化，都不能静默覆盖已生成段落。段落生成成功时必须保存实际生成快照，用于 stale audio 检测。

---

## 3. 全局信息架构

第一版全局导航建议：

```text
Projects        项目
Subtitles       字幕识别
Voice Design    音色设计
Settings        设置
```

不建议第一版加入全局 Source Library 或 Export Center。Source 暂缓；导出是 Studio 的动作，不先做一级全局模块。

### 3.1 Projects / 项目

参考：`stitch_narraforge.global_prjs.html`

用途：全局项目 Hub。

内容：

- 最近项目网格。
- 新建项目卡片。
- 最近活动。
- 项目状态概览。

项目卡片不要照搬 fantasy/sci-fi 封面图逻辑。真实卡片应显示 NarraForge 工作状态：

- 项目名。
- 项目类型：旁白 / 视频解说 / 播客 / 课程 / 短剧 / 其他。
- 最近编辑时间。
- 章节数。
- 分段数。
- 已生成音频总时长。
- 当前阶段：文本整理 / 分段配音 / 待导出 / 已完成。
- 未生成段落数量。
- stale audio 数量。
- 默认 TTS 引擎提示。

### 3.2 Subtitles / 字幕识别

参考：`stitch_narraforge.global.transcript.html`

用途：全局语音转字幕工具台。支持多文件上传、排序、拼接、统一 ASR、统一字幕输出。

核心流程：

```text
上传多个音频/视频文件
  → 拖拽排序
  → 视频抽音频（如需要）
  → 按顺序拼接
  → 统一 ASR
  → 输出 SRT / TXT / JSON
```

主区结构：

1. 多文件上传区
   - 支持音频和视频。
   - 支持批量上传。
   - 支持拖拽排序。
   - 每个文件显示名称、类型、时长、大小、状态。
   - 状态包括：等待、抽音频中、已就绪、拼接中、识别中、完成、失败。

2. 拼接设置
   - 按当前文件顺序拼接。
   - 文件间间隔默认 0ms。
   - 输出连续时间轴，从 00:00:00 开始。
   - 保存文件边界 boundary map。

3. 识别设置
   - ASR 引擎：Whisper / FunASR。
   - 语言：自动 / 中文 / 英文。
   - 字幕粒度：按句子 / 短句 / 停顿。
   - 输出格式：SRT / TXT / JSON。

4. 字幕结果编辑器
   - 时间码列。
   - 文本列。
   - 置信度/问题词标记。
   - 文件边界标记。
   - 可编辑字幕文本。

右侧栏：

- 文件数。
- 总时长。
- 预计识别耗时。
- ASR 质量报告。
- 最近任务。
- 下载 SRT/TXT/JSON。

关键数据：拼接后必须保存 boundary map，便于 UI 显示字幕来自哪个源文件。

```ts
interface SubtitleSourceBoundary {
  fileId: string;
  filename: string;
  startSec: number;
  endSec: number;
}
```

已有“选择合成语音再拼接”的能力可复用，但语音转字幕的拼接目标不同：这里拼接是为了统一 ASR 时间轴，不是为了最终听感导出。

### 3.3 Voice Design / 音色设计

参考设计稿中的 Character UI，但不使用 Character Design 作为主概念。

用途：全局音色资产管理。

全局对象：Voice Profile / 音色档案。

Voice Profile 类型：

- 系统音色：Edge-TTS、CosyVoice、MiMo、VoxCPM 等 provider 暴露的音色。
- 克隆音色：用户上传参考音频后创建的音色。
- 风格预设：沉稳解说、热情口播、新闻播报、温柔旁白、科技感等。
- 组合配置：provider/model/voice/params/style instruction 的可复用 preset。

卡片信息：

- 音色名称。
- 类型标签。
- provider / model。
- voice id / voice name。
- 语言。
- 性别/年龄/风格标签（可选）。
- 示例试听。
- 克隆来源（如有）。
- 最近使用项目。

不要把全局音色设计改名为角色设计。角色是项目内 Voice Role 的一种类型，不是全局音色资产的本质。

---

## 4. 项目内信息架构

进入项目后，左侧栏建议：

```text
Overview
Library
Studio
Voices
Settings
```

不放 Exports 作为第一版一级入口。导出动作留在 Studio；最近导出记录可放 Overview。

### 4.1 Overview / 项目总览

用途：项目状态 Dashboard。

内容：

- 项目名称、描述、类型。
- 章节总数。
- 分段总数。
- 已生成音频时长。
- 未生成段落数。
- stale audio 数量。
- 最近编辑章节。
- 最近导出记录。
- 快捷入口：进入 Library、进入 Studio、配置 Voices、设置 Remotion 路径。

第一版可做轻量，不必成为复杂 Dashboard。

### 4.2 Library / 章节文本库

参考设计稿中项目内 Library 的位置，但语义改为章节整体文本管理。

用途：管理每一章/每一节的完整旁白稿。

Library 负责：

- 章节列表。
- 章节标题。
- 章节整体文本。
- 章节顺序。
- 字数。
- 预计时长。
- 旁白版本。
- 默认 Voice Role。
- 一键进入 Studio。

Library 不负责：

- 单段语音生成。
- 单段试听。
- 每段参数微调。
- 生成队列。
- 音频导出。

建议布局：

```text
┌─────────────────────────────────────────────┐
│ Project Header / Breadcrumb                  │
├───────────────┬─────────────────────────────┤
│ Chapter List  │ Chapter Text Editor          │
│               │ - title                      │
│ 01 Chapter A  │ - full text                  │
│ 02 Chapter B  │ - word count                 │
│ 03 Chapter C  │ - estimated duration         │
│               │ - default voice role         │
│ + New Chapter │ - Enter Studio               │
└───────────────┴─────────────────────────────┘
```

### 4.3 Studio / 分段语音合成工作台

参考：`stitch_narraforge.prj.studio.html`

用途：选择某个章节，对其文本做智能切分、分段编辑、分段 TTS、试听、重生成、导出。

Studio 负责：

- 章节选择。
- 分段列表。
- 单段文本编辑。
- 单段 emotion。
- 单段 Voice Role。
- 单段参数 override。
- 批量合成。
- 生成队列。
- 音频播放。
- 当前章节导出。
- Remotion brief/spec 导出。

建议布局：

```text
┌────────────────────────────────────────────────────────────┐
│ Studio Header: Chapter selector / version / batch synth     │
├──────────────────────────────────┬─────────────────────────┤
│ Segment Timeline                 │ Right Panel             │
│                                  │ - current segment info  │
│ [01] 默认旁白 · ready            │ - Voice Role settings   │
│ text...                          │ - synthesis queue       │
│ play / regenerate / params       │ - global engine         │
│                                  │                         │
│ [02] 嘉宾A · draft               │                         │
│ text...                          │                         │
├──────────────────────────────────┴─────────────────────────┤
│ Transport / Export Bar                                      │
└────────────────────────────────────────────────────────────┘
```

保留设计稿中值得借鉴的元素：

- segment timeline card。
- active segment inline editing。
- status badge。
- play button。
- synthesis queue。
- bottom transport bar。
- Remotion path / export action。

需要弱化或删除的元素：

- World Building。
- Scene Atmospherics。
- Character-first 强叙事面板。
- 大量装饰头像。
- 一直展示的复杂音频仪表。

Studio 的导出动作：

- 当前章节 MP3。
- 当前章节 SRT。
- 分段音频 ZIP。
- Segment JSON。
- Remotion Brief / spec。
- 后续可支持全项目导出。

### 4.4 Voices / 项目声音角色

用途：管理项目内 Voice Role / 声音角色 / 配音位。

项目内对象：Voice Role。

Voice Role 不是具体模型音色，而是项目语义层：

- 默认旁白。
- 男声旁白。
- 女声旁白。
- 访谈嘉宾 A。
- 角色 A。
- 旁白-沉稳版。
- 旁白-激昂版。

每个 Voice Role 绑定具体 TTS 实现：

```ts
interface VoiceRole {
  id: string;
  projectId: string;
  name: string;
  type: 'narrator' | 'speaker' | 'character' | 'style_variant';
  color?: string;
  avatar?: string;

  provider: 'edge_tts' | 'cosyvoice' | 'mimo_tts' | 'voxcpm';
  model?: string;
  voiceId?: string;
  voiceName?: string;

  speed?: number;
  pitch?: number;
  volume?: number;
  defaultEmotion?: string;
  styleInstruction?: string;

  sourceVoiceProfileId?: string;
  createdAt: string;
  updatedAt: string;
}
```

Voice Role 与全局 Voice Profile 的关系：

```text
全局 Voice Profile = 可复用音色资产
项目 Voice Role   = 项目内语义角色/配音位

Voice Role 可以绑定 Voice Profile，或直接绑定 provider/model/voice。
```

Studio 中每个 segment 分配 Voice Role，而不是强迫用户每段直接选择 provider/model/voice。

### 4.5 Settings / 项目设置

用途：项目级配置，不是导出页面。

第一版核心就是当前项目的 Remotion 路径 / 导出目标，同时保留少量项目默认设置。

建议内容：

1. 项目信息
   - 项目名称。
   - 项目描述。
   - 项目类型。
   - 默认语言。

2. 默认声音设置
   - 默认 Voice Role。
   - 默认 TTS provider/model/voice。
   - 默认 speed / pitch / volume。
   - 修改后只影响新章节/新分段，不覆盖已生成音频。

3. Remotion / 输出目标
   - Remotion 项目路径。
   - 默认导出目录。
   - 默认文件命名规则。
   - 是否生成 Remotion brief/spec。

4. 高级设置
   - storage mode：frontend / backend。
   - 是否保留生成历史。
   - backend assets path（如需要，只读或高级）。

导出按钮不放 Settings。导出动作仍在 Studio。

---

## 5. Voice-first 与 Model-first 的结合方式

当前 NarraForge 偏 model/engine/voice-first：用户直接选择 TTS 引擎、模型、音色和参数。

设计稿偏 character-first：用户给角色配置声音。

本方案增加中间层 Voice Role，使两者兼容：

```text
Segment
  → Voice Role / 声音角色
    → provider/model/voice/params/style instruction
```

默认项目自动创建一个 Voice Role：

```text
默认旁白
  provider: edge_tts
  voice: 当前默认中文音色
  speed: 1.0
  pitch: 0
  volume: 1.0
```

新手路径：

- 只看到“默认旁白”。
- 在项目 Settings 或 Studio 全局控制条里选择模型和音色。
- 不需要理解 Voice Role。

高级路径：

- 在 Voices 中创建多个 Voice Role。
- 在 Studio 中给不同 segment 分配不同 Voice Role。
- Voice Role 可绑定全局音色档案，也可直接绑定模型音色。

生成快照要求：

```ts
interface SegmentGenerationSnapshot {
  generatedVoiceRoleId?: string;
  generatedProvider: string;
  generatedModel?: string;
  generatedVoiceId?: string;
  generatedVoiceName?: string;
  generatedSpeed?: number;
  generatedPitch?: number;
  generatedVolume?: number;
  generatedEmotion?: string;
  generatedStyleInstruction?: string;
  generatedAt: string;
}
```

当 Voice Role 或全局默认参数变化时，已生成段落不自动重生成，只显示 stale 状态：

```text
当前声音角色已变更，这段音频使用旧配置生成。可选择重新生成。
```

---

## 6. 国际化设计

本次 UI 大改造需要从第一阶段开始考虑中英文国际化，不要等页面写死中文后再回头替换。NarraForge 的核心界面应支持 `zh-CN` 与 `en-US` 两套文案。

### 6.1 语言策略

默认语言：

- 本地开发与当前用户环境默认 `zh-CN`。
- 预留 `en-US`。
- 后续可根据浏览器语言或用户设置切换。

第一版不要求复杂多语言后台，只需要前端静态词典即可。

建议语言包结构：

```text
frontend/src/i18n/
  index.ts
  zh-CN.ts
  en-US.ts
```

推荐 key 风格：按产品语义分组，不按页面临时命名。

```ts
export const zhCN = {
  nav: {
    projects: '项目',
    subtitles: '字幕识别',
    voiceDesign: '音色设计',
    settings: '设置',
  },
  projectNav: {
    overview: '总览',
    library: '文本库',
    studio: '工作室',
    voices: '声音角色',
    settings: '项目设置',
  },
  projectHub: {
    title: '项目工作台',
    newProject: '新建项目',
    recentProjects: '最近项目',
  },
};
```

```ts
export const enUS = {
  nav: {
    projects: 'Projects',
    subtitles: 'Subtitles',
    voiceDesign: 'Voice Design',
    settings: 'Settings',
  },
  projectNav: {
    overview: 'Overview',
    library: 'Library',
    studio: 'Studio',
    voices: 'Voices',
    settings: 'Project Settings',
  },
  projectHub: {
    title: 'Project Hub',
    newProject: 'New Project',
    recentProjects: 'Recent Projects',
  },
};
```

### 6.2 命名中英文对照

核心导航命名：

| 中文 | 英文 | 说明 |
|---|---|---|
| 项目 | Projects | 全局项目入口 |
| 字幕识别 | Subtitles | 多文件拼接后统一识别字幕 |
| 音色设计 | Voice Design | 全局音色资产与克隆音色 |
| 设置 | Settings | 全局设置 |
| 总览 | Overview | 项目内状态总览 |
| 文本库 | Library | 项目内章节整体文本管理 |
| 工作室 | Studio | 项目内分段语音合成 |
| 声音角色 | Voices | 项目内 Voice Role / 配音位 |
| 项目设置 | Project Settings | Remotion 路径与项目默认配置 |

核心数据概念：

| 中文 | 英文 | 说明 |
|---|---|---|
| 音色档案 | Voice Profile | 全局可复用音色资产 |
| 声音角色 / 配音位 | Voice Role | 项目内语义声音角色 |
| 章节 | Chapter | Library 中的整体文本单元 |
| 分段 | Segment | Studio 中的合成单元 |
| 生成快照 | Generation Snapshot | 生成时实际 provider/model/voice/params |
| 字幕任务 | Subtitle Job | 多文件识别任务 |
| 文件边界 | Source Boundary | 拼接后文件来源时间段 |

注意：

- 不建议把全局“音色设计”翻译成 Character Design。
- 不建议把项目内 Voices 翻译成 Characters。
- Character 只能作为 Voice Role 的一种类型或标签。
- 中文“工作室”在项目内语境中对应 Studio；全局产品名里的 Studio 不应和页面名冲突。

### 6.3 UI 布局对国际化的要求

中英文长度差异较大，组件设计必须预留弹性：

- 侧栏 nav item 不要依赖固定中文宽度。
- 顶部 header 的项目名与 breadcrumb 需要 `min-width: 0`、ellipsis、flex shrink。
- 按钮不要为了中文短词写死过窄宽度，英文 `Initialize Project`、`Batch Synthesize` 会更长。
- 状态 badge 文案要可换行或有短 label 版本。
- 卡片标题、章节标题、文件名全部需要 ellipsis 与 tooltip。
- 表单 label 不要和输入框强绑定同一行，避免英文溢出。

建议为部分 key 提供短文案：

```ts
voiceRole: {
  label: '声音角色',
  short: '声音',
}
```

```ts
voiceRole: {
  label: 'Voice Role',
  short: 'Voice',
}
```

### 6.4 文案原则

中文：

- 避免过度技术化，但保留关键专业词。
- “字幕识别”优先于“语音转文字”，因为该全局工具的目标产物是字幕。
- “音色设计”优先于“角色设计”，避免产品跑向小说角色管理。
- “声音角色”用于项目内语义配音位。

英文：

- `Voice Design` 用作全局音色设计入口。
- `Voice Profile` 表示全局音色资产。
- `Voice Role` 表示项目内配音位。
- `Studio` 表示项目内分段语音合成工作台。
- `Subtitles` 表示全局字幕识别工具，避免 `Transcription` 过度偏文本稿。

### 6.5 实现约束

- 新增页面和组件不得写死用户可见文案。
- CSS class、数据字段、代码变量继续使用英文。
- URL path 使用英文：`/projects`、`/subtitles`、`/voice-design`。
- 数据库存储稳定枚举使用英文：`narrator`、`speaker`、`character`、`style_variant`。
- 导出文件名默认可使用用户输入的章节名/项目名，不强制翻译。
- 现有旧页面迁移时，可先包一层 `t()`，再逐步整理 key。

---

## 7. 推荐落地阶段

### Phase 1：设计系统、国际化基础与 App Shell

目标：先把产品骨架、视觉基调和 i18n 基础统一。

内容：

- 抽取 design tokens 到 `frontend/src/styles/variables.css`。
- 更新 `frontend/src/styles/global.css`。
- 新建 `frontend/src/i18n/` 静态词典。
- 新建 `useI18n()` 或等价轻量翻译工具。
- 新建共享壳组件：
  - `StudioHeader`
  - `SidebarNav`
  - `AppShell`
  - `BentoCard`
  - `StatusBadge`
- 全局导航先放：Projects、Subtitles、Voice Design、Settings。
- 所有新 App Shell 文案通过 i18n key 输出。

验收：

- UI 统一为 warm amber 风格。
- 没有紫色主色。
- 侧栏可为后续折叠预留结构。
- 切换 `zh-CN` / `en-US` 时主导航和项目内导航可正常显示。

### Phase 2：Project Hub 与 New Project

目标：用户打开应用能看到新的全局工作台。

内容：

- 实现 Project Hub。
- 实现 New Project 页面。
- 新建项目时默认创建：
  - 默认章节（可选）。
  - 默认 Voice Role：默认旁白。

New Project 起始方式：

- 空白项目。
- 粘贴文本。
- 导入文档。
- 导入音频/视频转字幕（可先展示入口，后续接入）。

### Phase 3：项目内 Library

目标：把章节整体文本从分段合成中拆出来。

内容：

- 项目内左侧导航：Overview、Library、Studio、Voices、Settings。
- Library 章节列表。
- 章节整体文本编辑器。
- 章节默认 Voice Role。
- 进入 Studio 的入口。

### Phase 4：项目内 Studio 改造

目标：把现有分段 TTS 页迁入 Studio 语义。

内容：

- Studio 顶部章节选择器。
- segment timeline card。
- inline segment edit。
- Voice Role 选择。
- 保留现有 provider/model/voice 的实际合成能力。
- 生成成功写入 generation snapshot。
- 底部 transport/export bar。

必须保留的行为：

- 全局音色变更不覆盖已生成段落。
- 新分段继承当前章节/项目默认设置。
- 已生成段落可检测 stale audio。

### Phase 5：Voices 与 Voice Design

目标：补齐音色管理能力。

内容：

- 项目内 Voices：Voice Role 管理。
- 全局 Voice Design：Voice Profile 管理。
- Voice Role 可绑定 Voice Profile。
- 克隆音色与系统音色统一展示。

### Phase 6：全局字幕识别

目标：升级现有语音转字幕为多文件统一识别工具。

内容：

- 多文件上传。
- 视频抽音频。
- 文件排序。
- 拼接。
- boundary map。
- 统一 ASR。
- SRT/TXT/JSON 导出。

---

## 7. 不做或后置

第一版不做：

- Source Library 一级入口。
- Export Center 一级入口。
- Character Design 全局入口。
- World Building。
- Scene Atmospherics。
- 复杂导出历史管理。
- 直接在项目内编辑 Remotion 动画。

后续可做：

- 从全局字幕识别导入到项目 Library。
- 从 Library 自动生成多版本 narration document。
- 从 Studio 导出严格 Remotion segment spec。
- 输出 spec 后由外部 Remotion 项目导入并组合视频。
- Export Center / Deliverables，用于多章节批量导出与历史管理。

---

## 8. 关键命名约定

全局：

- Projects：项目。
- Subtitles：字幕识别。
- Voice Design：音色设计。
- Settings：全局设置。

项目内：

- Overview：项目总览。
- Library：章节文本库。
- Studio：分段语音合成工作台。
- Voices：项目声音角色/配音位。
- Settings：项目设置。

数据概念：

- Voice Profile：全局音色档案。
- Voice Role：项目声音角色/配音位。
- Chapter：章节整体文本。
- Segment：Studio 中的分段合成单元。
- Generation Snapshot：段落生成时使用的实际 provider/model/voice/params 快照。

---

## 9. 验收标准

UI 改造完成后应满足：

1. 打开应用后，用户首先看到 Project Hub，而不是散乱功能页。
2. 进入项目后，用户能清楚区分：
   - Library 管整体章节文本。
   - Studio 管分段合成。
   - Voices 管项目声音角色。
   - Settings 管 Remotion 路径和项目默认配置。
3. 用户无需理解“角色设计”也能完成单人旁白项目。
4. 多角色/多人声项目可以通过 Voice Role 完成。
5. 现有按 provider/model/voice 选择音色的能力不丢失，只是被 Voice Role 包装。
6. 已生成音频不会因为 Voice Role 或全局音色变化而被静默覆盖。
7. 全局字幕识别支持多文件上传、排序、拼接和统一 SRT 输出。
8. 视觉系统统一为暖琥珀/暖石色，不引入紫色主色。
