# NarraForge UI 大改造实施计划

> **For Hermes:** 后续实现必须同时遵守 `test-driven-development` 与 `react-ui-refactoring`。每个阶段先写测试、确认失败，再实现。每个阶段完成后停止，给用户 review 视觉与交互效果，通过后再进入下一阶段。

**Goal:** 将 NarraForge 从散功能页改造成项目制 Studio：全局 Projects / 字幕识别 / 音色设计，项目内 Library / Studio / Voices / Settings，并确保现有分段 TTS 的列表视图生成与对话视图生成都被保留并融入新 UI。

**Architecture:** 先建立 i18n、设计 token 与 AppShell，再迁移现有 TTSSynthesis 的项目/章节/分段能力。Library 管章节整体文本；Studio 管当前章节的分段生成；Voices 管项目内 Voice Role；全局 Voice Design 管 Voice Profile。现有 SegmentList 与 ChatSegmentView 都保留，但被包装进新的 Studio layout。

**Tech Stack:** React 19 + TypeScript + Vite；CSS Modules camelCase；Vitest + React Testing Library；现有 IndexedDB/backend storage 双路径；FastAPI 后端暂不优先改动。

---

## 0. 当前代码事实

已存在能力：

- `frontend/src/pages/TTSSynthesis.tsx`
  - 已有项目列表、scratchpad、章节、分段、导出、播放、生成逻辑。
  - 已有 `segmentViewMode: 'list' | 'dialogue'`。
  - 已有 `compactMode`、项目侧栏折叠、章节状态恢复等。
- `frontend/src/components/SegmentedTTS/SegmentList.tsx`
  - 当前列表视图。
  - 支持 vertical/horizontal、inline edit panel、insert、append、regenerate、play。
- `frontend/src/components/SegmentedTTS/ChatSegmentView.tsx`
  - 当前对话视图。
  - 使用 `ChatBubble`、`NarrationBlock`、`ProsodyMarkEditor`。
  - 支持 dialogue / narration segment kind。
- `frontend/src/types/index.ts`
  - 已有 `Role` / `RoleSnapshot` / `role_id` / `segment_kind` / `default_narrator_role_id`。
- `frontend/src/services/segmentGenerationInputs.ts`
  - 已经有 role/snapshot/stale input 相关逻辑。

关键约束：

- 不重写核心生成链路，先用新 UI 包装现有能力。
- 列表视图与对话视图必须都能生成、播放、重新生成。
- 对话视图 UI 需要本轮一起改进，不能只是旧样式搬过去。
- 所有新增可见文案走 i18n，不写死中文。
- 每次代码改动后必须验证：`npx tsc --noEmit` + Vite transform/browser smoke。

---

## 1. 阶段划分与 Review Gate

每个阶段完成后都必须停止开发，向用户展示当前效果与说明，等待 review。

### Phase 0：文档、分支、测试基线

目标：建立工作分支与基线验证。

输出：

- `docs/plans/2026-06-23-narraforge-ui-redesign-design.md`
- `docs/plans/2026-06-23-narraforge-ui-redesign-implementation-plan.md`
- feature worktree + branch
- 当前 frontend 测试/类型检查基线记录

Review Gate：

- 用户确认设计方案与实施阶段顺序。
- 用户确认先做 AppShell/Studio shell，而不是先做后端模型。

### Phase 1：i18n 与设计系统基础

目标：先让新 UI 有统一 token 和中英文文案能力。

输出：

- `frontend/src/i18n/index.ts`
- `frontend/src/i18n/zh-CN.ts`
- `frontend/src/i18n/en-US.ts`
- `frontend/src/i18n/i18n.test.ts`
- `frontend/src/styles/variables.css` 更新为 warm amber/studio tokens
- `frontend/src/styles/global.css` 最小更新

Review Gate：

- 只展示基础 shell demo 或现有页局部样式，不大规模迁移页面。
- 用户确认中英文命名：Projects / Subtitles / Voice Design / Library / Studio / Voices。

### Phase 2：AppShell 与全局导航骨架

目标：建立新全局外壳，但不破坏现有页面功能。

输出：

- `frontend/src/components/AppShell/AppShell.tsx`
- `frontend/src/components/AppShell/AppShell.module.css`
- `frontend/src/components/AppShell/StudioHeader.tsx`
- `frontend/src/components/AppShell/SidebarNav.tsx`
- 对应测试：导航项、active state、collapse、i18n 文案

全局 nav 第一版：

- Projects / 项目
- Subtitles / 字幕识别
- Voice Design / 音色设计
- Settings / 设置

Review Gate：

- 用户 review 新 shell 的视觉质感：顶部、侧栏、暖色、间距、字体、hover。
- 只确认框架，不要求业务完整。

### Phase 3：Project Shell 与项目内导航

目标：进入项目后的 IA 成型。

输出：

- `frontend/src/components/ProjectShell/ProjectShell.tsx`
- `frontend/src/components/ProjectShell/ProjectSidebar.tsx`
- `frontend/src/components/ProjectShell/ProjectHeader.tsx`
- 项目内 nav：Overview / Library / Studio / Voices / Settings
- 先用现有 TTSSynthesis 项目数据驱动 project title / active chapter

Review Gate：

- 用户确认进入项目后的左侧栏和顶部层级。
- 用户确认不放 Exports 一级入口。

### Phase 4：Library 页面：章节整体文本管理

目标：把“章节整体文本”作为 Library 的主界面，而不是直接进入分段合成。

输出：

- `frontend/src/pages/ProjectLibrary.tsx` 或 `frontend/src/components/ProjectLibrary/*`
- 章节列表、章节标题、整体文本、字数、预计时长、默认 Voice Role、进入 Studio
- 测试：选择章节、编辑整体文本、进入 Studio 按钮、默认 Voice Role 展示

Review Gate：

- 用户 review Library 是否符合“管理章节整体文本”的理解。
- 用户确认章节整体文本与分段 Studio 的边界。

### Phase 5：Studio Layout 包装现有列表视图

目标：先把当前 SegmentList 融入新 Studio UI，确保列表视图生成不退化。

输出：

- `frontend/src/components/VoiceStudio/VoiceStudio.tsx`
- `frontend/src/components/VoiceStudio/StudioToolbar.tsx`
- `frontend/src/components/VoiceStudio/StudioSegmentCanvas.tsx`
- `frontend/src/components/VoiceStudio/StudioRightPanel.tsx`
- `frontend/src/components/VoiceStudio/StudioTransportBar.tsx`
- list mode 仍调用现有 `SegmentList`

必须保留：

- 分段列表显示。
- 选择段落。
- inline edit panel。
- 单段生成 / 重新生成。
- 播放。
- 追加/插入段落。
- 导出入口。
- stale audio 提示。

Review Gate：

- 用户在新 Studio 中 review 列表视图。
- 通过后再改对话视图。

### Phase 6：Studio 对话视图 UI 改造

目标：改进 ChatSegmentView 的视觉，并接入 Studio Layout。

输出：

- 改造 `frontend/src/components/SegmentedTTS/ChatSegmentView.tsx`
- 改造 `ChatBubble.module.css`、`NarrationBlock.module.css`、`ChatSegmentView.module.css`
- 必要时新增：
  - `DialogueTurnCard.tsx`
  - `NarrationStudioBlock.tsx`
  - `VoiceRoleBadge.tsx`

对话视图设计要求：

- 不再像普通聊天气泡；改成“剧本/对话配音工作台”。
- 旁白块与台词块明确区分。
- 每个台词块显示：序号、声音角色、engine/voice、emotion、状态、播放、生成。
- 旁白块显示：旁白编号、默认旁白 Voice Role、是否缺少旁白音色、局部语气标记。
- 对话流不应过度左右摇摆导致阅读困难；建议采用轻微缩进/角色色条，而不是微信式左右气泡。
- 选中态使用 amber border + glow。
- 操作按钮永远可见，不靠 hover 才出现。

必须保留：

- dialogue segment 生成。
- narration segment 生成。
- play。
- prosody mark selection/editor。
- stale audio 检测。
- 新增台词 / 新增旁白。

Review Gate：

- 用户 review 对话视图视觉。
- 必须确认“对话视图生成”和“列表视图生成”都可用。

### Phase 7：Voices：项目内 Voice Role 管理

目标：把现有角色/旁白设置整理成项目内 Voices 页面/面板。

输出：

- `frontend/src/components/ProjectVoices/*`
- 显示 Voice Role 列表。
- 默认旁白 role 设置。
- Role 绑定 provider/model/voice params。
- Studio segment 可选择 Voice Role。

TDD 要覆盖：

- 默认项目有默认旁白。
- 新 segment 继承章节/项目默认 Voice Role。
- 修改 Voice Role 不覆盖已生成 segment snapshot。
- stale audio 正常显示。

Review Gate：

- 用户 review Voice Role 是否解决“Character UI 与模型选音色”的冲突。

### Phase 8：Project Settings：Remotion 路径与项目默认配置

目标：项目设置页最小可用。

输出：

- 项目名/描述/类型。
- 默认语言。
- 默认 Voice Role。
- Remotion 项目路径。
- 默认导出目录/命名规则。

Review Gate：

- 用户确认 Settings 信息量是否合适。
- 用户确认 Remotion 路径配置与 Studio 导出入口的关系。

### Phase 9：全局 Subtitles 多文件拼接识别 UI

目标：先做 UI 与状态模型，再接已有拼接/ASR。

输出：

- 多文件上传队列。
- 排序。
- boundary map 显示。
- 拼接设置。
- ASR 设置。
- SRT/TXT/JSON 输出区。

Review Gate：

- 用户 review 全局字幕识别工具台。
- 确认多文件拼接识别流程。

---

## 2. TDD 执行规则

每个代码阶段必须遵守：

1. 写测试。
2. 运行目标测试，确认失败。
3. 写最小实现。
4. 运行目标测试，确认通过。
5. 运行 `npx tsc --noEmit`。
6. 运行 Vite transform/browser smoke。
7. 提交阶段 commit。
8. 停止，等待用户 review。

前端测试位置：

- 组件测试与源码同目录或现有 `frontend/src/__tests__` 结构保持一致。
- 新组件建议同目录：`Component.test.tsx`。
- i18n/service 纯函数测试放同目录或 `services/__tests__`。

验证命令：

```bash
cd frontend
npx vitest run <specific-test-file>
npx tsc --noEmit
```

Vite 验证：

```bash
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173
curl -s http://127.0.0.1:5173/ -o /dev/null -w "%{http_code}\n"
```

必要时使用浏览器 smoke：

- 页面 body 非空。
- 无 `pageerror`。
- 主导航、项目内导航、Studio list/dialogue toggle 可见。

---

## 3. 关键测试清单

### 3.1 i18n

- `t('nav.projects')` 在 zh-CN 返回“项目”。
- `t('nav.projects')` 在 en-US 返回“Projects”。
- 缺失 key 返回 key 或 fallback，不 crash。
- 语言切换后 nav 文案变化。

### 3.2 AppShell

- 渲染全局导航。
- active nav 有当前态。
- collapse 后只显示图标/短 label。
- 英文长 label 不撑爆布局。

### 3.3 ProjectShell

- 渲染 Overview / Library / Studio / Voices / Settings。
- 当前项目名显示且超长 ellipsis。
- 不渲染 Exports 一级入口。

### 3.4 Library

- 章节列表按顺序显示。
- 选择章节后显示整体文本。
- 修改章节文本触发保存/dispatch。
- “进入 Studio”带着当前 chapter id。
- 字数和预计时长正确显示。

### 3.5 Studio list mode

- `segmentViewMode='list'` 时渲染 `SegmentList`。
- 点击生成调用现有 `onRegenerate`。
- 点击播放调用现有 `onPlay`。
- inline edit panel 仍在当前段下方展开。
- ready/stale 状态可见。

### 3.6 Studio dialogue mode

- `segmentViewMode='dialogue'` 时渲染改造后的对话视图。
- narration segment 渲染为旁白块。
- dialogue segment 渲染为台词块。
- 台词块生成按钮调用 `onRegenerate`。
- 台词块播放按钮调用 `onPlay`。
- 缺少旁白音色时显示 warning。
- prosody mark 选择后 editor 可保存。
- 操作按钮默认可见。

### 3.7 Voice Role / snapshot

- 新 segment 默认继承 chapter/project 默认 Voice Role。
- 切换 Voice Role 不改变已生成 segment 的 generation snapshot。
- 当前 Role 与生成快照不一致时显示 stale audio。

### 3.8 Project Settings

- Remotion 路径可编辑。
- 默认导出目录可编辑。
- 设置保存后 Library/Studio 不丢状态。

---

## 4. 对话视图详细设计

当前对话视图的目标不是“聊天软件”，而是“对话配音工作台”。建议采用单列剧本流：

```text
[旁白 #01] 默认旁白 · Edge-TTS/Yunxi · calm       [播放] [生成]
夜色压下来，城市的灯像被风吹散的星群。

[台词 #02] 嘉宾A · CosyVoice/xxx · excited        [播放] [生成]
“你真的准备好了吗？”

[台词 #03] 嘉宾B · MiMo/xxx · sad                 [播放] [生成]
“我没有选择。”
```

视觉规则：

- 旁白块：更宽、更安静，左侧 amber 细线，背景接近 surface。
- 台词块：左侧显示 VoiceAvatar / VoiceRoleBadge，但不大面积头像化。
- 不使用强左右气泡，避免长文本阅读割裂。
- 每块顶部 metadata 一行：编号、类型、声音角色、engine/voice、emotion、状态。
- 正文使用 17px / 1.7 line-height，适合长时间审稿。
- 底部操作按钮始终可见。
- 选中态：2px amber border + 4px glow。
- stale：warning badge，“音色已变更”。
- prosody marks：使用温和 underline/mark，不要高饱和荧光色。

---

## 5. 数据演进策略

第一阶段不要强行改后端 schema。优先使用现有前端类型与项目存储：

- 已有 `Role` / `RoleSnapshot` 先作为 Voice Role 的基础。
- UI 文案改为“声音角色 / Voice Role”。
- 后续如需全局 Voice Profile，再单独做后端迁移。

新增字段原则：

- 能从现有 `generated_params` / `role_snapshot` 表达的，先不新增字段。
- 真正需要时再增加 `voice_roles` / `voice_profiles` 的持久化结构。
- 任何会影响生成结果的参数，生成成功时必须进入 snapshot。

---

## 6. 阶段提交建议

每个阶段一个或多个 commit：

```bash
feat(ui): add i18n and studio design tokens
feat(ui): add app shell navigation
feat(project): add project shell navigation
feat(library): add chapter library view
feat(studio): wrap list mode in voice studio layout
feat(studio): redesign dialogue mode
feat(voices): add project voice roles panel
feat(settings): add project remotion settings
feat(subtitles): add multi-file subtitle workspace
```

每个阶段 commit 前必须：

- 目标测试通过。
- `npx tsc --noEmit` 通过。
- Vite transform/browser smoke 通过。

---

## 7. 第一阶段开始前确认项

需要用户 review/确认：

1. 全局 nav 是否定为：Projects / 字幕识别 / 音色设计 / Settings。
2. 项目 nav 是否定为：Overview / Library / Studio / Voices / Settings。
3. 对话视图是否采用“单列剧本流”，不走强左右聊天气泡。
4. 第一版是否只包装现有生成链路，不做后端大迁移。
5. 每个阶段是否按上面的 Review Gate 停止给用户看效果。
