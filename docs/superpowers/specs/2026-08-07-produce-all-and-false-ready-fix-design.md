# 一键制作全本 + 修复「假 ready」设计

- 日期: 2026-08-07
- 状态: Draft
- 关联: `2026-08-04-export-all-chapters-design.md`、`2026-07-25-narration-layer-sync-phase-b-design.md`

## 背景与问题

Studio 的批量合成入口 `BatchSynthesizeMenu` 只作用于**当前章节**(`activeChapter.segments`)。
没有「全本一键」入口,用户要逐章点合成才能让整本项目就绪。

「导出全部」(`export_all_chapters`)在 transport bar 里**总是报未完成 TTS**,用户反馈「明明每个 segment 都完成了 TTS」。
经核查这是**真阳性**,不是误报:

- 全库 1927 个段在 DB 里都有 `audio.current.path`,但 **560 个 mp3 文件在磁盘上不存在**(`data/projects/` 与旧目录 `uploads/segmented/` 都没有)。
- 丢失分散在 13 个项目,连 DB 显示「全有 path」的 `leo_three_plates`、`nfintroduct` 也是全军覆没。
- 根因:`voice_clone.db` 与 `backend/data/` 均不在 git 里(db 未跟踪、data 被 ignore),二者独立漂移;叠加历史 `uploads/segmented -> data/projects` 迁移(commit `faa86ff`)。

真正的 bug 是 **UI「假 ready」**:`useSegmentedProject.enrichSegment` 用 `hasAudio = !!(audio.current || audio.previous)` 判定 `status='ready'`,只看 DB JSON 有没有值,**不校验文件是否在磁盘**。
后端 `get_project_detail` 也原样返回存的 `audio`,不做文件存在性校验。
于是文件早没了,UI 仍显示「已完成」,导出一查文件就露馅。

## 目标

1. 在 Studio transport bar 增加「一键制作全本」入口:对全项目所有章节,先给无 segment 的章节补切(规则切),再逐段 TTS。
2. 合成复用每段已有音色配置,不新增设置 UI。
3. 修复「假 ready」:让 segment 的 ready 状态反映文件真实存在性。
4. 导出校验保持严格(它是对的),只改进报错信息。

## 非目标

- 调用 agent `split_segment` 节点；emotion / LLM 语义切段不在本场景范围（只用规则切）。
- 把按钮挪到更合适的位置 / 新增引擎+音色设置面板。
- frontend 存储模式(IndexedDB)下的音频存在性校验(本版只修 backend 模式,因为问题只在 backend 模式暴露)。
- 全本流程里按章节选不同引擎。

## 现状关键事实

- transport bar:`VoiceStudioLayout` 的 `footer.transportBar`,默认折叠,展开后 `exportGroup` 含 Export / ExportAll / AdjustAudio。`onExportAll` 仅在 `storageMode==='backend' && !isScratchpadProject` 时传入。
- 切段有 3 套:agent `split_segment`(全项目、带 emotion、破坏性替换)、后端 `/chapters/{cid}/split`(`mode=rule|llm`、per-chapter、纯文本)、后端 `resplit-from-script`(per-chapter、规则切、服务端取 `narration_script`)。本版用规则切。
- `handleRegenerate`(TTSSynthesis.tsx:666)用 `activeChapter.segments.find(s => s.id === id)` 查段,**只在当前章找**,无法直接合成其他章节的段。
- 前端 `segmentedProjectApi` 已有 `synthesizeSegment`(返回全量 `SegmentedProject`)、`exportAllChapters`、`resplitFromScript`;**没有** `splitChapter` 包装。
- `BatchSynthesizeMenu` 已有 `BatchSynthesizeMode = 'unsynthesized' | 'all'` 双模式范式,本版镜像它。
- `export_all_chapters`(segmented_project_service.py:1190)预检所有章节所有段,任一缺 `audio.current.path` 文件就 `ChaptersIncompleteError(chapters)` 整体 abort。

## 设计

### 1. 新入口:「一键制作全本」下拉按钮

- 位置:`VoiceStudioLayout` 的 `exportGroup`,与 Export 并列。
- 形态:复用 `BatchSynthesizeMenu` 组件(已是 `disabled` + `onSelect(mode)` 通用下拉),新增可选 `label` prop 以区分文案(默认仍为「批量合成」,此处传「一键制作全本」)。两项:
  - **增量制作全本**:只合成「无有效音频」的段。
  - **覆盖重制全本**:重合成所有非录制段(先删旧音频)。
- 显隐条件:同 `onExportAll`(`storageMode==='backend' && !isScratchpadProject`)。
- 通过新增 `onProduceAll?: (mode: 'unsynthesized' | 'all') => void` prop 传入 `VoiceStudioLayout`,内部渲染 `BatchSynthesizeMenu`(label=「一键制作全本」,disabled={generating})。

### 2. `handleProduceAll(mode)` 行为

遍历**全项目所有章节**(`project.chapters`,不是只 `activeChapter`):

**Step 1 — chapter->segment(补切)**

- 对每个 `segments.length === 0` 的章节,调 `splitChapter(projectId, chapterId, { mode:'rule', replace_strategy:'replace_chapter_segments', text: chapter.narration_script || chapter.original_text || '' })`。
- 新段继承 chapter 音色(`voice.source='chapter'`),无 emotion。
- 已有 segment 的章节跳过(非破坏,保留段级音色覆盖与已有音频)。
- 补切完成后 `reloadProjectData()` 拿到新段。
- 该步与合成模式无关,两种模式都先跑。

**Step 2 — segment->tts(按 mode)**

- 收集目标段(全项目):
  - 跳过 `audio.current?.origin === 'recorded'`(录制锁定,与 `handleRegenerateAll` 一致)。
  - `mode='unsynthesized'`(增量):目标是「无有效音频」的段,即 `!audio.current || !audio.current.path || !audio.current.file_exists`(依赖第 3 节的 file_exists 修复)。自然覆盖「文件丢失」的脱节段与从未合成的段,保留好音频。
  - `mode='all'`(覆盖):目标是所有非录制段;先逐个删旧音频(`deleteTTSResult` + `CLEAR_SEGMENT_AUDIO`,同 `doRegenerateAll`),再合成。
- 顺序合成(避免外部 TTS 限流),复用 `handleRegenerate`(见第 4 节重构),不传 params 覆盖,沿用每段已有音色配置。
- 进度按全本 `done/total` 显示(跨章节),复用现有 progress 事件机制。
- 合成结束 `showToast` 汇总(成功数 / 跳过数 / 失败数)。

### 3. 修复「假 ready」

**后端**:`get_project_detail`(segmented_project_service.py:237)的 segment 序列化里,给 `audio.current` 增加 `file_exists` 标志:

- `file_exists = bool(rel) and (settings.segmented_dir / rel).exists()`,`rel = current.path`。
- 一次 `stat`/段,开销可接受;仅在 `current` 存在时计算。
- 覆盖所有读取路径(单段 synthesize 响应也走 `get_project_detail`,自动带上)。

**前端**:`useSegmentedProject.enrichSegment`(useSegmentedProject.ts:57):

- backend 模式下 `hasAudio = !!(audio.current?.path && audio.current?.file_exists)`(`storageMode` 由 `useSegmentedProject` 已有的入参/上下文获取)。
- `status = raw.status ?? (hasAudio ? 'ready' : 'idle')`。
- 文件丢失的段降级为 `idle`,UI 显示未完成,`'unsynthesized'` 合成才会瞄准它们。
- frontend 模式保持现有 `id` 判定不变(本版不修 IndexedDB 存在性)。

### 4. `handleRegenerate` 重构:段查找改为全项目范围

- 现状:`activeChapter.segments.find(s => s.id === id)`(TTSSynthesis.tsx:666),只认当前章。
- 改为跨 `project.chapters` 查找(如 `project.chapters.flatMap(c => c.segments).find(...)`)。
- 这样 `handleProduceAll` 可复用同一套合成逻辑(参数解析、voice、dispatch、toast)对任意章节的段合成,无需为全本另写一套。
- 现有 per-chapter `handleRegenerateAll` / `doRegenerateAll` 行为不变(本来就在 activeChapter 范围内调用)。

### 5. `splitChapter` api 包装

- 在 `segmentedProjectApi` 增加 `splitChapter(projectId, chapterId, body: { mode; text; replace_strategy; delimiters? })`。
- 对应 `POST /segmented-projects/{id}/chapters/{cid}/split`。

### 6. 导出报错改进(校验保持严格)

- `ChaptersIncompleteError` 扩展携带 `[{ chapter, missing_count }]`(每个缺音频章节的缺失段数)。
- 前端 toast `studio.exportAllIncomplete` 显示章节名 + 缺失段数。
- 不改 abort 语义(缺任一段仍整体拒绝导出)。
- 可选(锦上添花):toast 附「去制作全本」按钮,触发 `handleProduceAll('unsynthesized')`。

## 数据流

```
用户点「一键制作全本」(增量/覆盖)
  -> handleProduceAll(mode)
     -> Step1: 对无 segment 的章节 splitChapter(rule) -> reloadProjectData
     -> Step2: 收集目标段(全项目,按 mode + recorded 跳过 + file_exists)
        -> 逐段 handleRegenerate(segId)(复用,全项目查找)
           -> segmentedProjectApi.synthesizeSegment(pid, cid, sid)  # 复用已有音色
           -> dispatch GENERATE_SUCCESS / 错误处理
        -> 全本进度 N/M
     -> 汇总 toast
```

## 错误处理

- 补切失败:toast 报错,该章跳过,继续后续章节;不中断全本。
- 单段合成失败:沿用 `handleRegenerate` 现有错误处理(标 failed),继续下一段;最后汇总失败数。
- 无目标段(全部已就绪 / 全部录制):toast 提示无可合成段,不报错。
- `generating` 期间禁用按钮(同 `BatchSynthesizeMenu disabled={generating}`)。

## 测试(TDD)

### 后端

- `get_project_detail` 返回 `file_exists=true`(文件在)/ `false`(文件被删)。
- `export_all_chapters` 在段文件缺失时仍抛 `ChaptersIncompleteError`(回归守卫)。
- `ChaptersIncompleteError` 携带 `missing_count`。
- `splitChapter` 对无 segment 的章节用 `mode=rule` 生成段并继承 chapter 音色(若现有测试未覆盖)。

### 前端

- `enrichSegment`:backend 模式下 `current.path && current.file_exists` 才 `ready`;文件缺失降级 `idle`。
- `handleProduceAll`:
  - 只对 `segments.length===0` 的章节调 `splitChapter`,有段的章节不调。
  - `unsynthesized`:只合成无有效音频段,跳过 recorded 与好音频段。
  - `all`:合成所有非录制段,先删旧音频。
  - 进度按全本 N/M。
  - 不传 params 覆盖(沿用已有音色)。
- `splitChapter` api 包装契约测试。

### E2E

- 项目含「无 segment 章节」+「文件丢失段」-> 点「增量制作全本」-> 章节被补切、丢失文件被重新生成 -> 「导出全部」成功。
- `VoiceStudioLayout` transport bar 下拉渲染与显隐条件。

## 影响面

- 后端:`segmented_project_service.py`(`get_project_detail` 序列化、`ChaptersIncompleteError`、`export_all_chapters` 报错)。
- 前端:`VoiceStudioLayout.tsx`(新下拉 + prop)、`TTSSynthesis.tsx`(`handleProduceAll`、`handleRegenerate` 重构)、`useSegmentedProject.ts`(`enrichSegment`)、`services/api.ts`(`splitChapter`)。
- i18n:新增「一键制作全本 / 增量 / 覆盖」等文案(zh-CN / en-US)。
- 文档:更新 `docs/api-reference.md`(`/chapters/{cid}/split` 已有,补 `file_exists` 字段说明)、`docs/feature-spec.md`、`docs/frontend-audit.md`、`docs/backend-data-audit.md`、`backend/tests/TEST_MAP.md`。

## 实现中发现的两个 bug（一并修复）

1. **`/chapters/{cid}/split` 全量 reconcile 丢项目级字段**:端点重建 `ProjectIn` 时漏带 `configs`/`source_document`/`narration_script`/`default_narrator_role_id`/`logo`,导致补切后 `configs.export_directory` 等丢失（导出全部报 `export_directory_not_configured`）。已补齐这些字段。`tests/test_chapter_split_empty.py` 增 configs 保留断言。
2. **produce-all 逐段合成与 autosave 竞态**:循环中 `handleRegenerate` dispatch 的状态更新会触发防抖全量 PUT,用陈旧内存态覆盖刚合成段的音频路径(reconcile 还会删掉刚写的文件)。`handleProduceAll` 在合成循环前 `initialLoadDoneRef.current=false` 暂停 autosave（此时未合成、态与后端一致,暂停安全）,循环后 `reloadProjectData` 恢复并拉回后端权威态。E2E `tests/e2e/specs/produce-all.spec.ts`（edge-tts）覆盖:补切 + 脱节段重合成 -> 导出全部成功。
