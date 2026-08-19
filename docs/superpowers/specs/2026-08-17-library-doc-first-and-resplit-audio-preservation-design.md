# Library 文档优先重构 + 重拆音频保留修复 - 设计

- 日期: 2026-08-17
- 状态: Draft（待用户评审）
- 关联: `2026-07-27-narration-document-manual-import-split-design.md`, PR #69 (`cdb1f7f`), 诊断测试 `backend/tests/integration/test_repro_preserve_audio_gaps.py`

## 背景

两条线索汇合成本设计。

### 线索 1: Library 界面复杂度

当前 `ProjectLibrary` 是 3 tab × 3 mode 的导航矩阵:

- Tab: 源文档 / 旁白文档 / 分镜。
- Mode: overview（章节卡片网格）/ chapter（沉浸式章节编辑器）/ fulltext（`NarrationDocView`）。
- 再叠加各层自己的 编辑/查看 切换、对比视图。

主流程「贴旁白 -> 拆章节」在 landing 视图埋了三层:

进 library（落在章节网格）-> 点「查看全文」-> 点「编辑」-> 粘贴 -> 回头部点「拆分章节」。

landing 视图（章节网格）是漏斗的中间产物, 它假设章节已存在, 但新项目从零开始。
源文档只在工作流存在时才有意义, 却占据一级 tab。
`NarrationDocView` 的形态 A（空文档粘贴入口）已经就是目标设计, 只是被藏在 mode 链末端。

### 线索 2: 重拆音频保留功能（preserve_audio）违背承诺

UI 承诺文案: 「文本未变的 segment 会保留已合成音频」。
诊断（复现测试已落盘, 3 场景全部坐实）:

| 场景 | 操作 | 实际结果 |
|---|---|---|
| S1 弹窗默认路径 | 文档不改, 直接重新拆分（「同时拆分 segment」默认不勾） | 新章节 0 segment, 旧音频文件全部被 GC（含 origin=recorded 用户录音） |
| S2 边界不同 | 文档不改, 勾拆分, 但旧 segment 来自 studio LLM 拆分 | rule_split 边界 ≠ LLM 边界 -> 0 复用, 全部 GC |
| S3 章节重组 | 文档中加/改标题, segment 文本逐字未动 | 匹配按章节标题 scoped -> 0 复用, 全部 GC |

根因:

- S1: `ChapterSplitModal.tsx:54` `splitSegments` 默认 `false`, payload 章节不带 segments;
  `segmented_project_service.py:1515` 据此建空章节, `:1584-1588` 的 GC 只看「未消费即删」, 无「新结构零 segment」保护。
- S2: `batch_reuse.py` 仅做 `.strip()` 后全等匹配, 无边界变化识别。
- S3: `build_reuse_index` 以规范化标题为 key 建池, 标题变即整池失联, 无全局兜底。

次要问题:

- S4: `_move_reused_audio` 用 `os.replace` 在 `db.commit()` 之前搬文件, 中途异常回滚会留下「DB 指旧路径、文件已搬走」的断裂;
  复用 segment 的 `audio.previous` 仍指旧路径（只搬了 `current`）。
- S5: `openSplitModal` 优先取 `narration_script`, 文档与章节侧编辑分叉时无任何警告。

既有测试（`test_chapters_batch_reuse.py`、e2e `chapter-split-preserve-audio.spec.ts`）只覆盖最窄 happy path（标题相同 + 边界相同 + 手工构造 payload segments）, 真实 UI 流程零覆盖。

### 已确认的用户决策

- 旁白文档保持可编辑: `narration_script` 是 master, 拆分只是投影, 章节侧后续编辑不回写文档;
  重新拆分永远以文档为准（S5 由「缺陷」转为「需明示的语义」）。
- Library 主视图直接进入旁白文档全文, 方便粘贴和拆分;
  可切换按章节呈现。

## 目标

- Library 默认落在旁白文档视图, 「粘贴 -> 拆分」零层级可达。
- 全文/章节双视图切换, 章节网格降级为结果/管理视图。
- 源文档保留为独立视图, 无工作流能力时也可访问; 工作流启动按钮仅在有能力时展示。
- 分镜本轮从 Library 切换器移除（组件保留, 入口后续再说）。
- 重拆保留功能兑现承诺: 默认路径不再销毁音频（S1）, 章节重组不丢未变文本的音频（S3）。
- 拆分前如实预告保留/丢弃明细, 含用户录音特别警示（S2 诚实化 + F2a）。
- 文档与章节分叉时, 拆分前明示「以文档为准, 章节侧改动将被覆盖」（S5）。

## 非目标

- 不做边界变化 segment 的音频拼接复用（新文本 = 多段旧文本连接时 ffmpeg concat 出新音频, 即 F2b）;
  本轮只识别并如实报告, 拼接收敛为后续独立设计。
- 不做 `narration_script` 与章节编辑的自动同步（用户已决策: 文档是 master, 不回写）。
- 不改分镜面板内部（`StoryboardPanel` 代码保留, 仅从切换器移除入口, 不删组件）。
- 不做源文档抽屉/滑出层（用户决策: 源文档作为常规视图保留, 见 B4）。
- 不改 agent 工作流调用（工作流从不传 preserve_audio/split_segments, 行为不变）。
- 不引入数据库 schema 变更或迁移。
- 不做文档版本管理。

## 现状关键事实

### 后端

- `chapters:batch` 入口: `app/api/segmented_projects.py:310-344`, 参数 `preserve_audio` / `split_segments`。
- 核心实现: `app/services/segmented_project_service.py` `batch_create_structure`（local 模式, 含文件搬运/GC）;
  `app/core/repositories/segmented_projects.py:581+`（workers 模式, 行级匹配, 无文件管理）。
- 匹配纯逻辑: `app/services/batch_reuse.py`（`normalize_chapter_title` + `build_reuse_index`, 两模式共用, 不得引入 sqlalchemy/文件系统依赖）。
- reuse 报告字段: `chapters_matched / segments_matched / segments_reused / segments_new / per_chapter`。
- 音频路径: `audio.current.path` 为相对 `segmented_dir` 的规范路径; `origin` 区分 `tts` / `recorded`。

### 前端

- `ProjectLibrary.tsx:93-94`: `mode` 默认 `'overview'`, `activeTab` 默认 `'narration'`。
- `ChapterSplitModal.tsx:54`: `splitSegments` 默认 `false`; `:126-129` 重拆时自动带 `preserveAudio: existingChapterCount > 0`。
- `openSplitModal`（`ProjectLibrary.tsx`）: fullText 优先级 `narrationScript` > 项目详情 `narration_script` > 章节合并文本 > `sourceDocument`。
- `NarrationDocView` 形态 A/B 自适应已就绪; 底部有「返回资料库 / 按章节查看」条。
- `features.agent_workflow` 能力开关已存在, 控制工作流触发块显隐。
- 已知 i18n 缺陷: tab「分镜」为硬编码中文（英文界面下漏出）。

## 设计

分两个 Phase, 数据安全修复先行, UI 重构随后消费新 API。

---

### Part A（Phase 1）: 重拆音频保留修复

#### A1. 抽取纯匹配规划器 `plan_batch_reuse`

位置: `app/services/batch_reuse.py`（新增纯函数, 两模式共用）。

输入: 旧章节结构快照 + 新章节 payload（**调用方已把 payload segments / rule_split 结果算好**, 规划器不碰拆分）。

```
plan_batch_reuse(old_chapters, new_chapters, *, preserve_audio) -> BatchPlan

BatchPlan = {
  chapters: [{
    title, voice, split_config,          # 沿承决策（payload > 标题匹配快照 > 默认）
    segments: [{
      text,
      match: OldSeg | None,              # 命中的旧 segment（audio/params/emotion/role_id/voice）
      source: 'chapter' | 'global',      # 章节内命中 / 全局兜底命中
    }],
  }],  report: {
    chapters_matched, segments_matched, segments_reused, segments_new, per_chapter,   # 现有字段不变
    discard: {                            # 新增: 丢弃明细
      text_changed,                       # 全局找不到同文本旧段
      boundary_changed,                   # 新文本 == 同一章内连续多段旧文本的连接（S2 识别）
      no_audio,                           # 文本命中但旧段无音频记录（从未合成）, 无可保留
    },
    recorded_discard,                     # 将丢弃的用户录音段数（origin=recorded）
  },
}
```

注: 规划器不碰磁盘; `no_audio` 仅按旧段 audio 记录判空。
应用时文件缺失按现行为降级为不复用（计入 toast 实际数）; dry_run 不做磁盘探测, 保留数可能略高估, 确认框文案注明「预计」。
```

匹配顺序（每个新章节）:

1. 章节内精确匹配（现行为, 池消费一次）。
2. 全部章节完成第 1 步后, 剩余新段进入**全局兜底池**（所有旧章节未消费段, 按 文本 -> deque）:
   解决 S3——章节重组/文本跨章移动时同文本仍可复用。
3. 未命中的新段分类: 先做边界检测（同一旧章节内连续 ≥2 段连接等于新文本, 连接时忽略空白）, 命中记 `boundary_changed`, 否则 `text_changed`。

约束: 规划器保持纯函数, 无 IO; 现有 `build_reuse_index` / `normalize_chapter_title` 保留为规划器的内部件。

#### A2. 保留即重建: 自动拆分（封 S1 后端层）

`batch_create_structure` 与 workers 仓储规则:

当 `preserve_audio=true` 且某章 payload 无 `segments` 且该章命中了含旧 segment 的快照 ->
按该章最终 split_config（payload > 快照 > 默认）的 delimiters 执行 `rule_split`, 等价于 `split_segments` 对该章生效。

效果: 只要带着 `preserve_audio` 重拆, 匹配章节必然重建 segment, 保留逻辑有对象可依。
未匹配（新标题）章节不受影响, 按原 split_segments 语义处理。

#### A3. 弹窗默认值与勾选框（封 S1 前端层）

`ChapterSplitModal`:

- 重拆（`existingChapterCount > 0`）: 隐藏「同时拆分 segment」勾选框, 恒发 `split_segments: true`——保留音频在语义上就蕴含重建 segment, 不再提供「空章节 + 全删」的组合。
- 首次拆分（无现有章节）: 勾选框保留, 默认改为勾选（funnel 连贯: 拆完即可进 Studio 合成）;
  用户可取消勾选以获得裸章节。
- `preserveAudio` 逻辑不变（已有章节自动 true）。

#### A4. dry-run 与诚实确认（F2a）

`chapters:batch` 新增 `dry_run: bool = False`:

- `dry_run=true`: 走完整规划（含 A2 自动拆分、全局兜底）, **不写库、不动文件**, 返回 `report`（含 discard 明细）。
- 实现方式: apply 路径重构为「先 `plan_batch_reuse` 出计划 -> 落库 -> 按 match 做文件搬运 -> 提交后 GC」;
  dry_run 即「只跑第一步返回报告」。

弹窗在预览阶段（已有章节时）后台调 dry_run, 确认框如实展示:

```
将替换为 N 章。
预计保留 X 段已合成音频。
丢弃 Y 段: 文本变化 a / 拆分边界变化 b。
⚠ 其中用户录音 Z 段将被删除, 无法恢复。     # Z>0 时高亮
```

应用完成后的 toast 同口径（现有 `reuseReport` 文案扩展）。

#### A5. 文件操作事务安全（修 S4）

local 模式 `batch_create_structure` 调整顺序:

1. 规划 + 落库行（audio dict 先指向计划路径）。
2. 执行 `os.replace` 搬运列表;
   单个搬运失败时保留旧路径引用（现行为, 文件未动, 引用仍有效）, 记 warning。
3. `db.commit()`。
4. **提交成功后**才 GC 未消费旧音频（现顺序是 GC 在 commit 前, 颠倒）。
5. commit 抛异常 -> 对已成功搬运的文件执行反向补偿（搬回旧路径）, 再向上抛;
   保证「DB 回滚到旧段引用旧路径时, 文件也在旧路径」。

`audio.previous` 旧路径问题: 搬运 `current` 时若存在 `previous`, 一并搬到新段目录旁（同名加 `-prev` 后缀）并更新引用, 消除悬空引用。

#### A6. 分叉警告（S5 语义化）

拆分弹窗打开时, 若 `narration_script` 非空 且 与章节合并文本不一致（去空白后字符串比较）:
弹窗顶部显示警告——「旁白文档与当前章节内容存在分叉（章节侧有编辑）。应用后以文档为准, 章节侧改动将被覆盖。」
纯前端比较, 无后端改动。

---

### Part B（Phase 2）: Library 文档优先重构

#### B1. 信息架构: 3 mode + 3 tab -> 3 视图 + 章节编辑器

```
view: 'doc' | 'chapters' | 'source'      # 头部一等切换
chapterEditorId: string | null           # 章节沉浸编辑器（现 chapter mode 原样保留）
```

- 默认 `view = 'doc'`; 每个 project 记住上次视图（localStorage `nf.library.view.{projectId}`）, 新项目/无记录时落 `doc`。
- 头部切换器替代现有 tab 条: `[全文 | 章节 | 源文档]`。
- 分镜从切换器移除, `StoryboardPanel` 代码保留、入口本轮不呈现。
- `onModeChange` 契约同步: `'overview' | 'chapter' | 'fulltext'` -> `'doc' | 'chapters' | 'source' | 'chapter'`, 调用方 `TTSSynthesis` 适配。

#### B2. doc 视图（landing, `NarrationDocView` 演进）

- 头部: 切换器 + 统计（字数 / 预计时长 / 章数）+ 动作（编辑|预览、拆分章节）。
- 形态 B（有文档）: 现状保留（编辑/预览 + 拆分）。
- 形态 A（空文档）: 粘贴 CTA 主按钮 + 「去源文档」次按钮（切到 source 视图）;
  有章节无文档时保留「从现有章节生成」回退预览（现行为）。
- 删除底部「返回资料库 / 按章节查看」条--头部切换器已覆盖（`onBack` / `onViewByChapter` props 移除）。

#### B3. chapters 视图（现章节网格降级入驻）

- 现有章节卡片网格、改名/删除/新建章节、进度条、进 Studio 全部保留。
- 「新建章节」入口从 doc 视图头部移到 chapters 视图头部（手工建章成为次级路径）。
- 删除装饰性 filter chips 行（「进行中/草稿/完成」无交互无实义）。

#### B4. 源文档保留为第三个视图

- 源文档视图 = 现 `SourceDocumentView`（编辑/查看 + 对比入口）原样入驻切换器, 无论工作流能力开关始终可访问。
- 工作流触发块（生成旁白 / 知识视频 -> `WorkflowDrawer`）保留在源文档视图内, 仅 `features.agent_workflow` 开启时渲染。
- 不引入抽屉/滑出层; 原「从原文生成抽屉」方案被否决（用户反馈: 源文档在无工作流时也需要保留, 常规视图更直接）。
- CompareView 保留, 入口随迁。

#### B5. 拆分应用后的落点

应用成功 -> **留在 doc 视图**（不自动切换）, 弹出结果反馈:

- 展示诚实 reuse 报告（保留 X / 丢弃 Y 明细, 同 A4 口径）。
- 附「查看章节」跳转按钮, 用户主动点击才切到 chapters 视图。
- 点 OK/关闭则停留在当前 UI。

实现落点: 复用 toast 或小型结果弹窗;
若 toast 不支持动作按钮, 则用轻量结果弹窗（仅含报告文本 + [查看章节] [留在文档] 两钮）。

#### B6. 顺手清理

- 删除 `ProjectLibrary.tsx` 头部注释掉的标题代码块。
- 移除分镜入口后, 「分镜」硬编码文案随入口一并退场（新增的切换器三键全部走 i18n key: `projectLibrary.viewDoc / viewChapters / viewSource`）。
- 移除因重构失效的 i18n key, `missing-keys` 测试保绿。

---

## API 变更

`POST /api/segmented-projects/{project_id}/chapters:batch`:

| 变更 | 内容 |
|---|---|
| 新增参数 | `dry_run: bool = False` |
| 行为变更 | `preserve_audio=true` 且匹配章节有旧 segment 且 payload 无 segments 时自动 rule_split（A2） |
| 响应扩展 | `reuse` 报告新增 `discard: {text_changed, boundary_changed, no_audio}` 与 `recorded_discard`; dry_run 时 `chapters` 为空数组、仅返回 `reuse` |

`dry_run=true` 保证零副作用（不写库、不动文件、不更新 `narration_document_path`）。
向后兼容: 现有字段全部保留, agent 工作流调用不传新参数, 行为不变。

## 数据流

### 拆分主流程（重构后）

```
弹窗打开
  -> 检测文档/章节分叉 -> 警告（A6）
  -> markdown-detect / markdown-split 预览（现流程）
  -> [已有章节] 后台 chapters:batch dry_run -> 确认框展示保留/丢弃明细（A4）
  -> 用户确认
  -> chapters:batch（preserve_audio=true, split_segments=true）           # 重拆
      后端: plan_batch_reuse -> 落库 -> 搬文件 -> commit -> GC（A1/A2/A5）
  -> 留在 doc 视图 + 结果反馈（含「查看章节」跳转按钮, B5）
```

### 首次拆分

```
doc 视图粘贴 -> 拆分（split_segments 默认勾选, 可关, A3）
  -> chapters:batch（preserve_audio=false）-> 留在 doc 视图 + 结果反馈（B5）
```

### 工作流产文档（不变）

`agent -> 后端`, 前端只在 WorkflowDrawer（工作流运行侧边抽屉, 现有组件不变）里看进度;
结束后 doc 视图呈现 `narration_script`。

## 边界与错误处理

- dry_run 失败（网络/后端不可用）: 确认框退回现文案（不带明细）, 不阻塞拆分。
- 文档无标题可拆: 现行为保留（预览为空, 应用按钮禁用）。
- 匹配章节正文为空: 自动拆分产出 0 段, 该章无 segment（与现 split_segments 语义一致）;
  旧音频因未消费被 GC, 但 discard 明细已预告。
- `os.replace` 跨设备失败: 回退 `shutil.move`（现行为）; 仍失败保留旧路径引用 + warning。
- 反向补偿也失败: 记 error 日志（文件位置以日志为准人工恢复）, 不阻断异常上抛。
- workers 模式: A1/A2/A4 纯逻辑共享; A5 文件部分不适用（无文件管理）; 行为对齐靠仓储测试覆盖。
- localStorage 不可用: 视图记忆静默降级为每次默认 doc。

## 测试计划（TDD）

### 后端单元（`batch_reuse` 规划器, 纯函数）

- 章节内精确匹配、重复文本消费一次、标题忽略序号（现有用例迁移）。
- 全局兜底: 章节重组后同文本跨章复用（S3 期望行为）。
- 边界检测: 新文本 = 同章连续旧段连接 -> `boundary_changed`（S2 识别）;
  跨章连接不识别（v1 范围, 断言明确）。
- discard 分类: `text_changed` / `no_audio` / `recorded_discard` 计数。

### 后端集成（local + workers 两套）

- `dry_run=true`: DB 无变更、无文件变更、报告正确。
- S1 场景翻转: preserve_audio + 无 payload segments + 匹配章节 -> 自动拆分 + 音频保留（翻转 `test_repro_preserve_audio_gaps.py` 断言, 正式并入 `test_chapters_batch_reuse.py`）。
- S2 场景: 边界不同 -> `boundary_changed` 报告 + 音频不复用（诚实而非静默）。
- S3 场景翻转: 章节重组 -> 全局兜底复用。
- GC 时序: commit 失败注入 -> 文件留在旧路径（补偿生效）; 成功 -> 未消费文件被清。
- `audio.previous` 随迁与引用更新。

### 前端单元（vitest）

- `ProjectLibrary`: 默认 view=doc; 切换器三态（全文/章节/源文档）; 源文档视图无工作流能力时仍可见（仅工作流按钮隐藏）; 空 doc 空 chapter 的粘贴 CTA + 去源文档次按钮; 视图记忆; 分镜入口不存在; `onModeChange` 新契约。
- `NarrationDocView`: 底部条移除后 props 收窄。
- `ChapterSplitModal`: 重拆隐藏勾选框且恒发 split_segments=true; 首拆默认勾选; dry_run 明细渲染（含 recorded 高亮）; 分叉警告显隐。
- 拆分结果反馈: 留在 doc 视图 + 「查看章节」跳转按钮可用。
- i18n `missing-keys` 保绿; 新 key 中英齐全。

### E2E（`tests/e2e/`）

- 扩展 `chapter-split-preserve-audio.spec.ts`:
  - S1 真实 UI 默认路径（不碰勾选框）重拆 -> 音频保留, 双读验证（DB audio + 磁盘文件）。
  - S3 章节重组场景 -> 兜底保留。
- 新增 `library-doc-first.spec.ts`:
  新项目 -> library 落 doc 视图 -> 粘贴 -> 拆分 -> 留在 doc 视图、结果反馈可跳转章节;
  源文档视图在无工作流能力下仍可访问;
  数据断言: `narration_script` 落库、章节/段落数量与文本逐字段核对。
- 既有 spec 受影响面回归（tab 文案变化: `project-pages.spec.ts`、`navigation.ts`、`narration-manual-import-split.spec.ts`）。

## 实现顺序

Phase 1（数据安全, 先行合入并部署）:

1. 规划器单测 -> `plan_batch_reuse`（A1, 含全局兜底与 discard 分类）。
2. `batch_create_structure` / workers 仓储接规划器 + 自动拆分（A2）。
3. `dry_run` 参数（A4 后端半）。
4. 文件事务顺序与补偿（A5）。
5. 翻转诊断测试断言, 并入正式测试文件。
6. 弹窗: 默认值/隐藏勾选框/dry_run 明细/分叉警告（A3/A4 前端半/A6）。
7. e2e 扩展 + 文档同步。

Phase 2（Library 重构）:

1. `ProjectLibrary` 视图状态机单测 -> 重构（B1/B3, 含分镜入口移除）。
2. `NarrationDocView` 收窄（B2）。
3. 源文档视图入驻切换器 + 工作流块能力开关（B4）。
4. 拆分结果反馈与跳转（B5）。
5. i18n 与清理（B6）。
6. e2e 新 spec + 回归 + 文档同步。

部署提醒: 用户实测环境曾运行 PR #69 之前的旧前端;
Phase 1 合入后需确认 Vercel 重建生效再验证体验。

## 影响文档（PR 内同步更新）

- `docs/feature-spec.md` §4.5（Library 与章节拆分整节改写）。
- `docs/api-reference.md`（chapters:batch 参数与 reuse 报告 schema）。
- `backend/tests/TEST_MAP.md`（新用例映射）。
- `docs/e2e-test-guide.md`（新 spec 与缺口分析更新）。
- `docs/frontend-audit.md`（标记 filter chips / 分镜 i18n / 注释代码三项已处理）。

## 已决决策（2026-08-17 用户拍板）

1. **拆分后落点**: 不自动切换视图; 留在当前 UI, 结果反馈附「查看章节」跳转按钮, 用户主动点击才切（B5）。
2. **源文档形态**: 不做抽屉; 源文档作为第三个视图常驻切换器, 无工作流能力时也可访问, 仅工作流按钮按能力显隐（B4）。
3. **首拆默认值**: 「同时拆分 segment」首次拆分默认勾选（A3）。

附: 分镜本轮从切换器移除, 组件代码保留, 入口后续需要时再恢复。
