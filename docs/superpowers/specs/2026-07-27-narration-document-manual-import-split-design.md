# 手动导入旁白文档并按标题拆分章节 — 设计

- 日期: 2026-07-27
- 状态: Draft
- 关联: `2026-06-26-library-source-narration-design.md`, `2026-07-10-narration-workflow-design.md`, commit `639511e` (PR #32 章节拆分)

## 背景

「按标题拆分章节」功能（commit `639511e`）已实现并测试通过:
后端 `/text-split/markdown-detect` + `/markdown-split` + `chapters:batch` 三个接口,
前端 `ChapterSplitModal`（探测层级 -> 选 levels -> 预览 -> 应用替换章节）。

但用户反馈: 在「查看可编辑的 narration 文档」的界面找不到拆分入口。
排查发现三处真实缺口:

1. 拆分按钮只放在 `ProjectLibrary.tsx` 章节列表(overview)视图的顶栏,
   全文视图(`mode === 'fulltext'`)和 `SourceLibrary/NarrationFullView` 都没有入口。
2. 全文视图 `mode === 'fulltext'` 是**只读 Markdown 预览**,
   显示的是 `chapters.map(ch => chapterText(ch)).join('\n\n')`（章节合并文本）,
   并非项目级 `narration_script`, 也没有 textarea, 不可编辑。
3. 项目级 `narration_script`（旁白文档源稿）目前**只能由工作流写入**。
   `SourceLibrary` 里的「旁白文档」面板是 mock 假数据（`MOCK_NARRATIONS`）,
   `GenerateNarrationModal` 只往内存 state 塞对象, 不落库, 后端没有 narration 文档表。
   没有任何「手动把一份旁白文档放进项目」的入口。

因此用户无法: 手动粘一份旁白文档到项目 -> 就地拆成章节。

## 目标

- 让用户能手动把一份完整旁白文档粘进项目, 成为该项目的 `narration_script`（旁白文档源稿）。
- 在旁白文档编辑界面就地提供「按标题拆分章节」入口。
- 不破坏现有「章节优先」工作流（直接建章节、逐章编辑）。
- 后端零改动（复用已有的 `narration_script` 字段与 `PUT` 接口）。

## 非目标

- 不做独立的「旁白文档库」（不绑定项目的文档列表）。
  留待真有多项目复用需求再做（YAGNI）。
- 不做文件上传入口（本轮仅粘贴/输入）。
- 不把 `SourceLibrary` 的 mock 旁白面板做成真（独立库的非目标决定）。
- 不引入旁白文档版本管理（项目级 `narration_script` 单一源稿, 无版本）。

## 现状关键事实

### 后端（已就绪, 无需改）

- `PUT /segmented-projects/{project_id}` 的 `ProjectIn` schema 已含 `narration_script: str | None`。
- `segmented_project_service.get_project` 从磁盘文件 `narration_document_path` 读出 `narration_script`。
- `save_project` 把 `narration_script` 写回该文件（与 `source_document` 同链路）。
- `openSplitModal` 已通过 `segmentedProjectApi.getProject` 读 `narration_script`。

### 前端（需补）

- `SegmentedProject` 类型（`frontend/src/types/index.ts`）**没有** `narration_script` 字段, 只有 `source_document`。
- `useSegmentedProject` reducer 没有 `SET_NARRATION_SCRIPT` action（有 `SET_SOURCE_DOCUMENT`）。
- `mode === 'fulltext'` 视图只读, 显示章节合并文本。
- 持久化走 `projectStorage`（按 `storageMode` 切 IndexedDB / 后端）, `source_document` 已通, `narration_script` 照搬即可。

## 设计

### 核心思路: 全文视图按 `narration_script` 是否存在自适应

全文视图（`mode === 'fulltext'`）从「章节合并只读预览」升级为「项目旁白文档视图」,
根据 `narration_script` 是否存在呈现两种形态, 并提供互转。

#### 形态 A: `narration_script` 为空（章节优先项目）

- 仍显示「章节合并文本」**只读 Markdown 预览**（保留现有行为, 零破坏）。
- 顶部提示条 + 两个入口:
  - 「粘贴旁白文档」: 进入空编辑器, 粘完保存即写入 `narration_script`, 转为形态 B。
  - 「从现有章节生成旁白文档」: 把当前章节合并文本灌入 `narration_script`, 转为形态 B（可编辑 + 可拆分）, 内容不丢。

#### 形态 B: `narration_script` 已存在（文档优先 / 工作流产出）

- 编辑/预览 切换（镜像 `SourceDocumentView` 的 `sourceViewMode: 'edit' | 'view'`）:
  - 编辑 = textarea 双向绑定 `narration_script`。
  - 预览 = Markdown 渲染。
- 顶栏「按标题拆分章节」按钮（复用 `openSplitModal`, 读 `narration_script`）。
- 改稿后重新拆分 = `batchCreateChapters` 替换现有章节（已带替换警告）。

### 语义模型

- `narration_script` = 旁白文档**源稿**（单一, 项目级）。
- 章节 = 拆分**产物**。
- 编辑 `narration_script` 不会自动改章节; 只有重新拆分才更新章节。
- 章节优先项目通过「从现有章节生成旁白文档」可平滑转为文档优先, 不丢内容。

### 数据模型 / 持久化

- 前端 `SegmentedProject` 类型补字段:
  ```ts
  /** 项目级旁白文档源稿（落盘 narration_document_path） */
  narration_script?: string | null;
  ```
  镜像 `source_document`。
- `useSegmentedProject` reducer 新增 action:
  ```ts
  | { type: 'SET_NARRATION_SCRIPT'; text: string }
  ```
  case 体:
  ```ts
  case 'SET_NARRATION_SCRIPT':
    return { project: { ...p, narration_script: action.text, updated_at: new Date().toISOString() } };
  ```
- 持久化链路照搬 `source_document`:
  `projectStorage.saveProject` -> 后端 `PUT /segmented-projects/{id}`（`ProjectIn.narration_script`）-> `narration_document_path` 文件。
  IndexedDB 模式同样落 `narration_script` 字段。
- `openSplitModal` 不改（已读 `narration_script`）。

### UI 落点与入口

- 改造对象: `frontend/src/components/ProjectLibrary/ProjectLibrary.tsx` 中 `mode === 'fulltext'` 分支。
- 顶栏新增「按标题拆分章节」按钮（形态 B 时可见, 形态 A 时隐藏, 避免对已拆章节重复拆分）。
- 形态 A 的两个转换入口放在只读预览上方的提示条。
- 编辑/预览切换控件复用现有 `sourceViewMode` 模式, 新增本地 state `narrationViewMode: 'edit' | 'view'`。
- i18n: `zh-CN.ts` / `en-US.ts` 新增 `projectLibrary.narrationDoc.*` 文案键。

### 组件改动清单

- `frontend/src/types/index.ts`: `SegmentedProject` 加 `narration_script`。
- `frontend/src/hooks/useSegmentedProject.ts`: 加 `SET_NARRATION_SCRIPT` action + reducer case;
  确认 `segmentedProjectDB` / `projectStorage` 序列化该字段（IndexedDB 模式）。
- `frontend/src/services/api.ts`: 确认 `updateProject`/`saveProject` 提交体含 `narration_script`（`ProjectIn` 已有）。
- `frontend/src/pages/TTSSynthesis.tsx`: 把 `project.narration_script` 透传给 `ProjectLibrary`;
  新增 `onUpdateNarrationScript` 回调（镜像 `onUpdateSourceDocument`）, dispatch `SET_NARRATION_SCRIPT`。
- `frontend/src/components/ProjectLibrary/ProjectLibrary.tsx`:
  - props 加 `narrationScript?: string | null` 与 `onUpdateNarrationScript?: (text: string) => void`。
  - 改造 `mode === 'fulltext'` 分支为自适应双形态。
  - 顶栏接入 `openSplitModal`（复用现有 handler）。
- `frontend/src/i18n/{zh-CN,en-US}.ts`: 新增文案。

## 数据流

### 粘贴并拆分（文档优先, 新增）

1. 用户在章节库点「全文视图」进入。
2. `narration_script` 为空 -> 形态 A: 提示条 + 「粘贴旁白文档」。
3. 点「粘贴旁白文档」-> 进入空编辑器, 粘贴文本。
4. textarea onChange -> `onUpdateNarrationScript` -> dispatch `SET_NARRATION_SCRIPT` ->
   `projectStorage.saveProject` -> 后端 `PUT`（写 `narration_document_path`）。
5. 转为形态 B: 编辑/预览切换 + 顶栏「按标题拆分章节」。
6. 点拆分 -> `openSplitModal` -> `ChapterSplitModal` -> `chapters:batch` 替换章节。

### 章节优先转文档优先

1. `narration_script` 为空, 章节有内容 -> 形态 A 只读预览章节合并文本。
2. 点「从现有章节生成旁白文档」-> 取 `chapters.join('\n\n')` 作为 `narration_script` ->
   `SET_NARRATION_SCRIPT` -> 持久化。
3. 转为形态 B, 可继续编辑 + 拆分。

### 工作流产出项目（不变）

1. 工作流 `gen_script` + `split_segment` 同时写 `narration_script` 与章节。
2. 全文视图显示形态 B（`narration_script` 已存在）, 可改稿 + 重新拆分。

## 边界与错误处理

- `narration_script` 与章节文本不一致: 视为正常（源稿 vs 产物）。
  UI 不强行同步, 仅在拆分时用源稿覆盖章节（带警告）。
- 存储模式切换（frontend <-> backend）: `narration_script` 随 `source_document` 同链路迁移,
  无特殊处理。
- 空 `narration_script` + 空章节: 形态 A 预览显示「无内容」占位, 「从现有章节生成」入口灰化。
- 拆分时 `narration_script` 为空: `openSplitModal` 已有 fallback（章节合并 -> 源文档）,
  本设计不改变该 fallback, 但形态 A 默认不展示拆分按钮（避免对已拆章节重复拆分）。
- IndexedDB 旧数据无 `narration_script` 字段: 读取时按 `undefined` 处理, 走形态 A, 兼容。

## 测试计划（TDD）

### 前端单元测试（vitest）

- `useSegmentedProject` reducer: `SET_NARRATION_SCRIPT` 更新 `narration_script` 与 `updated_at`。
- `ProjectLibrary` fulltext 分支:
  - `narration_script` 为空 -> 显示章节合并只读预览 + 提示条 + 两个入口。
  - `narration_script` 为空 + 章节也空 -> 「从现有章节生成」灰化。
  - 点「粘贴旁白文档」-> 切换到编辑器。
  - 点「从现有章节生成旁白文档」-> 用章节合并文本调用 `onUpdateNarrationScript`。
  - `narration_script` 已存在 -> 显示编辑/预览切换 + 顶栏拆分按钮。
  - 编辑器 onChange -> 调用 `onUpdateNarrationScript`。
  - 顶栏拆分按钮 -> 调用 `openSplitModal`（已有路径, 验证可见性即可）。
- 持久化: `projectStorage.saveProject` 提交体含 `narration_script`。

### E2E 测试（playwright）

- 新建项目 -> 全文视图 -> 粘贴一份含 H2 标题的旁白文档 ->
  验证后端 `GET /segmented-projects/{id}` 返回 `narration_script` 一致（dual-read）。
- 点「按标题拆分章节」-> 预览 -> 应用 ->
  验证章节数与标题（UI + API + DB dual-read）。
- 章节优先项目（建一章写文本, 无 `narration_script`）-> 全文视图显示章节合并预览 ->
  点「从现有章节生成旁白文档」-> 验证 `narration_script` 等于章节合并文本。

### 后端

- 无新增接口, 复用现有 `PUT` + 拆分接口。
- 现有后端测试覆盖 `narration_script` 读写, 不需新增。

## 实现顺序（TDD）

1. 类型 + reducer + 持久化透传（`narration_script` 端到端能存能取）, 先写 reducer 测试。
2. `ProjectLibrary` fulltext 自适应双形态, 先写组件测试。
3. i18n 文案。
4. E2E 用例。
5. 全量回归（vitest + e2e + backend pytest）。

## 影响文档（PR 内同步更新）

- `docs/api-reference.md`: 无新接口, 无需改（确认 `PUT` 已记录 `narration_script`）。
- `docs/feature-spec.md`: 补「手动导入旁白文档」工作流说明。
- `backend/tests/TEST_MAP.md`: 若新增测试用例则登记。
- `docs/e2e-test-guide.md`: e2e 计数 +1。

## 实现说明（落地与设计的偏差）

- 全文视图改造抽成了独立展示组件 `NarrationDocView`（`frontend/src/components/ProjectLibrary/NarrationDocView.tsx`）, 不再内联在 `ProjectLibrary` 的 `mode === 'fulltext'` 分支里。
  原因: 隔离可测、`ProjectLibrary` 已过大; 辅助函数 `countTextChars`/`estimateDurationSec`/`formatSeconds` 抽到 `utils.ts` 共享。
- TDD 过程发现一个回归 bug: `mode === 'fulltext'` 是提前 `return`, 而 `ChapterSplitModal` 渲染在主 return 体里, 导致 fulltext 模式下点拆分 `setSplitModal` 被调用但 modal 不渲染。
  修复: fulltext 分支用 fragment 同时渲染 `NarrationDocView` + `ChapterSplitModal`, 并加单测 `fulltext view form B: split button opens the chapter-split modal` 锁定。
- i18n: `projectLibrary.narrationDoc` 由字符串（tab 标签）改为对象（`tab`/`title`/`emptyHint`/`paste`/`generateFromChapters`/`fallbackPreviewLabel`/`editorPlaceholder`）; tab 标签引用从 `t('projectLibrary.narrationDoc')` 改为 `t('projectLibrary.narrationDoc.tab')`。
- `openSplitModal` 优先用 `narrationScript` prop（内存最新值）, 避免 draftSync 防抖延迟导致拆分读到旧的后端值。
- 后端零改动, 复用 `PUT ProjectIn.narration_script` + `narration_document_path` 文件落盘。
- 验证: vitest 323 passed / 1 skipped, tsc 干净, backend pytest 477 passed, e2e 43 passed（含新增 `narration-manual-import-split.spec.ts` 2 条）。

## 后续修复（用户反馈：拆分后只有标题没内容 + 需确认/清理）

- **章节无内容**: 根因是 `batch_create_structure` 只设 `narration_script`（L2）不设 `original_text`，而章节卡片/工作室拆分源都用 `original_text`；ChapterSplitModal 又不带 segments。修复：`BatchChapterIn` 加 `original_text`，ChapterSplitModal 切片后剩掉标题行得到正文，`original_text`+`narration_script` 都落正文（与 agent `parse_markdown_chapters` 语义一致，L2 不含标题便于 studio 重拆）。
- **确认提示**: 已有章节时点「应用到项目」先弹 `ConfirmDialog`（`role="alertdialog"`，危险色），明确“将删除现有 N 个章节及其已生成的音频”，确认后才替换；无章节时直接应用。
- **清理生成内容**: `batch_create_structure` 删旧章节前先调 `_delete_segment_audio_files` 清理各 segment 的 current/previous 音频文件，避免重拆分时音频孤立（原先只删 DB 行）。
- 验证: vitest 325 / backend pytest 479 / e2e 43 全绿；新增后端 `test_batch_persists_chapter_original_text`、`test_batch_deletes_existing_chapter_audio`，前端 ChapterSplitModal 确认+正文剩标题测试。

## 后续修复 2（用户反馈：拆分章节进 studio 规则拆分报错 includes of undefined）

- 根因：`create_chapter_for_project` 不设 `split_config`，模型列默认 `{}`（空），batch 建的章节 `split_config = {}`；前端 `TextInputPanel` 直接 `splitConfig.delimiters.includes` -> `undefined.includes` 崩溃。章节优先的章节由前端 reducer 建带 delimiters，所以没这问题。
- 修复（双层）：后端 `create_chapter_for_project` 设默认 `split_config={delimiters:["，","。"],mode:"rule"}`（根因）；前端 `TextInputPanel` 防御性默认 `delimiters??[]`/`mode??'rule'`（兼容历史空 split_config 章节）。
- 验证: vitest 326 / backend pytest 480 / e2e 43 全绿；新增后端 `test_batch_chapter_has_default_split_config`、前端 TextInputPanel 空 split_config 不崩测试，E2E 断言拆分章节 `split_config.delimiters` 非空。
