# 分段项目 API 粒度重构设计 Spec

日期：2026-08-27
状态：草案（止血 Phase 0 已落地）
关联：`docs/api-reference.md`、`backend/app/services/segmented_project_service.py`、`frontend/src/hooks/useSegmentedDraftSync.ts`

## 1. 背景

### 1.1 事故回顾（2026-08-27，409 audio_missing）

新建项目粘贴原始文档拆出 1 章 79 段，批量合成全部成功（mp3 落盘、DB 路径写入），播放时全部返回 409 `audio_missing`。
直接原因：批量合成期间（`doRegenerateAll`）自动保存未暂停，每段的 `GENERATE_SUCCESS` 触发防抖全量 PUT；PUT 携带的是快照时刻的前端内存态，其中刚合成完的段 audio 已被清空（批量开始时 `CLEAR_SEGMENT_AUDIO`），但后端 DB 已被合成端点写入音频路径。
`save_project` 的 reconcile 把"payload 没引用的路径"当作"应删除的文件"，由 `_delete_dropped_audio_files` unlink 了刚写好的 79 个 mp3。
随后带完整状态的 PUT 又把 DB 路径恢复，形成"DB 有路径、盘上无文件"的脱节。

### 1.2 根因

大 PUT（`PUT /api/segmented-projects/{id}`，`save_project`）是 MVP 时期的全量状态保存接口，现在承担了过多职责：

- 全量 reconcile（章节/段增删改、position 重排）；
- 覆盖服务端自产字段（`audio`、`generated_params`、`generated_at`）；
- 文件系统 GC（按 payload diff 删文件，已在 Phase 0 摘除）；
- 项目改名目录搬迁；
- 无版本控制，last-writer-wins。

同时存在两类写入者（全量 PUT 与合成/录音/调整等细粒度端点）写同一批行，互不感知。

## 2. 目标

- 任何客户端的陈旧/残缺状态都不能造成音频文件丢失或 DB 元数据回退。
- 接口粒度匹配操作意图的影响面：段编辑影响段，章节操作影响章，项目元信息影响项目。
- 大 PUT 退化为"显式保存 / 整包恢复"专用，带乐观锁。
- 前端 autosave 从"全项目防抖 PUT"退化为实体级脏标记保存；批量合成/全本合成不再需要 `initialLoadDoneRef` 暂停 hack。

非目标：不改动 workers 模式已有端点的行为契约；不动合成/导出/拆分等已有细粒度端点的语义。

## 3. 设计原则

1. **副作用在服务端，事实源在服务端**：产生文件/调用外部服务的操作必须走专用端点，前端拿响应更新本地态，不回写。
2. **文件删除只能由显式删除意图触发**（删段、重拆、删项目、覆盖合成），绝不由"状态 diff"触发（Phase 0 已落地，本 spec 固化此约束）。
3. **服务端自产字段服务端管**：`audio` / `generated_params` / `generated_at` 只能由合成、录音、adjust-audio 端点写入；其余端点（含大 PUT）对它们只读或忽略。
4. **音频生命周期收归后端**：段文本变更使音频失效应由后端在段编辑端点内完成（标记 missing 并保留文件），不再由前端 `CLEAR_SEGMENT_AUDIO` 借全量 PUT 表达。
5. **乐观锁以服务端 `updated_at` 为准**：客户端凭 `base_updated_at` 写，不匹配即 409，由前端 reload 恢复。

## 4. 场景分类

| 类别 | 场景（reducer action） | 目标接口 |
|---|---|---|
| 已有小粒度，不动 | 合成、录音上传、章节拆分/重拆、chapters:batch、adjust-audio、导出、scaffold、import | 现状保持 |
| A. 段内容编辑 | UPDATE_TEXT / UPDATE_SSML / BATCH_SET_SSML / UPDATE_EMOTION / SET_SEGMENT_ROLE / SET_SEGMENT_KIND / UPDATE_PROSODY_MARKS / UPDATE_PARAMS / TOGGLE_INDEPENDENT_VOICE | `PATCH .../segments/{sid}` |
| B. 段结构 | APPEND_SEGMENT / INSERT_SEGMENT / DELETE_SEGMENT(S) / MERGE_SEGMENTS / SPLIT_SEGMENT / REORDER | `POST .../segments` + `PATCH .../chapters/{cid}/structure` |
| C. 章节操作 | ADD_CHAPTER / DELETE_CHAPTER / RENAME_CHAPTER / MOVE_CHAPTER / SET_SPLIT_CONFIG / SET_CHAPTER_META / SET_ALL_CHAPTERS_PARAMS | `POST / PATCH / DELETE .../chapters[/{cid}]` + `POST .../chapters:reorder` |
| D. 项目元信息 | RENAME_PROJECT / SET_LAYOUT / SET_PROJECT_META / SET_PROJECT_NARRATOR / logo | `PATCH /segmented-projects/{id}` |
| E. 文档层 | SET_SOURCE_DOCUMENT / SET_NARRATION_SCRIPT | `PUT .../source-document`、`PUT .../narration-script` |
| 保留大 PUT | 显式保存、草稿整包恢复、import 内部复用 | `PUT /segmented-projects/{id}` + 乐观锁 |

## 5. 目标 API 面

### 5.1 大 PUT 改造（保留，加锁）

`PUT /api/segmented-projects/{id}`

- 请求体 `ProjectIn` 新增可选字段 `base_updated_at: str | None`。
- 服务端语义：
  - 项目已存在且 `base_updated_at` 非空且不等于 DB 当前 `updated_at` → `409 {"detail": {"code": "stale_payload", "server_updated_at": ...}}`；
  - `base_updated_at` 为空 → 接受（兼容 agent、import、老客户端）；
  - upsert 新建不做校验。
- 服务端自产字段处理：`audio`、`generated_params`、`generated_at` 在 reconcile 中**忽略 payload 值、保留 DB 现值**（当前为覆盖语义，属缺陷；改动后前端不再需要把这些字段塞进 payload）。
- 不删除任何文件（Phase 0 已落地）。
- 响应 `ProjectDetail` 的 `updated_at` 是服务端新值，前端用它刷新 `base_updated_at`。

前端配套：`useSegmentedDraftSync.flush` 从 draft record 读 `base_updated_at` 放入 payload；`backendStorage.saveProject` 返回响应，flush 成功后以响应的 `updated_at` 更新 draft 的 `base_updated_at`；收到 409 `stale_payload` 时触发 `reloadProjectData()` 并丢弃本地草稿。

### 5.2 段内容编辑（A 类，最高优先级新增）

`PATCH /api/segmented-projects/{pid}/chapters/{cid}/segments/{sid}`

请求体（全部可选，只更新出现的字段）：

```json
{
  "text": "...", "ssml": "...", "emotion": "happy",
  "role_id": "role-xxx 或 null", "segment_kind": "narration",
  "prosody_marks": [...], "voice": {"source": "custom", "engine": "...", "params": {...}},
  "unlock_audio": true
}
```

语义（实现后修订）：

- `text` 变更不影响音频（对齐现有前端 UPDATE_TEXT 语义；音画一致性由层同步/重新合成流程负责，不在 PATCH 内做失效）。
- `voice` 变更 → 后端把旧 `audio.current` 降级为 `previous`、清空 `current` 与 `duration_sec`（**文件保留在盘上**，可撤销），`generated_params`/`generated_at` 置空；voice 未变则不动音频。
- `unlock_audio: true`（实现后新增）→ 清除 `audio.current.origin` 录音锁，音频引用本身保留；这是 PATCH 唯一允许触碰的 audio 元数据（显式解锁意图）。
- 其余字段（emotion/role_id/segment_kind）纯更新。
- 响应：`{segment, project_updated_at}`；前端用响应段数据回写本地（`APPLY_SERVER_SEGMENT`），并用 `project_updated_at` 推进乐观锁 base。
- 错误：404 `segment_not_found`；422 `segment_too_long`（复用 `validate_synthesis_text` 的长度规则）。
- local 与 workers 模式都挂载（`SegmentedProjectRepository` Protocol 新增方法，workers 走 PostgREST 行级 PATCH）。

### 5.3 段结构（B 类）

- `POST /api/segmented-projects/{pid}/chapters/{cid}/segments` — 新建段。body：`{text?, after_id?: string | null}`。返回 `{segment, positions: [{id, position}], project_updated_at}`（positions 为插入后章内全部段的终态；`after_id` 在章内无对应段 → 404 `segment_not_found`）。
- `PATCH /api/segmented-projects/{pid}/chapters/{cid}/structure` — 章节内结构 reconcile（删除/合并/拆段/排序的唯一入口）。body：`{segments: [{id?, text, position}]}`，与现有 save_project 的段 reconcile 同语义但范围收敛到一章；被删段的 DB 行删除、音频文件保留（原则 2）；事务内完成 position 两阶段重排（沿用现有负哨兵手法）。返回 `{segments: 该章全部段（按 position 升序）, project_updated_at}`。**实现后修订**：已存在段的 `text` 发生变化时（合并等结构操作），旧音频在后端失效降级（`current`→`previous`、文件保留、`generated_params`/`generated_at` 置空）——原则 4 要求文本变更的音频失效由后端在意图明确的端点内完成；纯重排（text 未变）不动音频。

### 5.3.1 前端切换现状（e2e 回归修复，2026-08-27）

- 合并（`MERGE_SEGMENTS`）已切到 structure 端点：dispatch `touch=false` + `reconcileChapterStructure` + `APPLY_SERVER_CHAPTER_SEGMENTS` 回写 + `noteServerVersion`；远端失败回退整包 PUT 兜底。
- 删除/拆段/插入/重排仍走整包 PUT（行 reconcile 语义不变，双写兼容）；后续阶段再统一切换。
- 解锁录音走 PATCH `unlock_audio`（见 5.2）。
- 新增 `useSegmentedDraftSync.refreshDraft`：touch=false 的变更（PATCH/结构端点已远端持久化）也要刷新已有草稿内容，否则待冲刷的陈旧草稿会把 PATCH 刚写入的字段整包 PUT 回旧值（dialogue-prosody e2e 实证：kind 切换 PATCH 被进入工作室时标记的陈旧 PUT 覆盖回 narration）。

### 5.4 章节操作（C 类）

- `POST /api/segmented-projects/{pid}/chapters` — `{name}` → 新章节（workers 模式走章节配额检查 `_enforce_chapter_quota`）。
- `PATCH /api/segmented-projects/{pid}/chapters/{cid}` — `{name?, voice?, split_config?, design_title?}` 部分更新。
- `DELETE /api/segmented-projects/{pid}/chapters/{cid}` — 删章（DB 行；音频文件保留待 sweep）。
- `POST /api/segmented-projects/{pid}/chapters:reorder` — `{chapter_ids: [...]}` 按数组顺序重排 position。

### 5.5 项目元信息（D 类）

`PATCH /api/segmented-projects/{id}` — `{name?, layout?, configs?, default_narrator_role_id?, logo?, remotion_project_path?, animation_theme?}`。
改名时复用 `_relocate_project_assets` 做目录搬迁，在该端点事务内完成。

### 5.6 文档层（E 类）

- `PUT /api/segmented-projects/{id}/source-document` — `{text}` → 写文件、更新 `source_document_path`。
- `PUT /api/segmented-projects/{id}/narration-script` — `{text}` → 写文件、更新 `narration_document_path`，并按层同步规则置脏 L3（复用现有 sync_state 机制）。

## 6. 前端改造要点

1. `segmentedProjectApi` 新增上述端点的封装；reducer action 不再触发"全项目 autosave"，改为：
   - 段内容编辑 → 调 5.2，用响应增量更新；
   - 结构操作 → 调 5.3，用响应增量更新；
   - 文本输入等击键级场景保留防抖，但防抖的单位是"段"而非"项目"（每段一个 dirty 标记/定时器）。
2. `useSegmentedDraftSync` 保留为大 PUT 专用（显式保存/恢复），加 `base_updated_at` 携带与 409 恢复逻辑。
3. 删除 `handleProduceAll` / `doRegenerateAll` 中的 `initialLoadDoneRef` 暂停 hack（批量合成期间不再有全量 PUT 需要防）。
4. `CLEAR_SEGMENT_AUDIO` 从前端主动清空改为：编辑文本后由 PATCH 响应驱动状态更新。
5. 每步以"后端返回为准"收敛状态，消除 previous==current 之类的前端伪造字段。

## 7. 迁移阶段

| 阶段 | 内容 | 可独立交付 |
|---|---|---|
| 0（已完成） | 大 PUT 摘除文件 GC（`_delete_dropped_audio_files` 调用点 + 孤儿段文件删除） | ✅ 已实现并通过测试，待提交 |
| 1（已完成） | 大 PUT 乐观锁 + 自产字段忽略 + 前端 409 恢复 | ✅ 已实现并通过测试，待提交 |
| 2（已完成） | 段内容 PATCH + 前端切换（reducer touch 透传 + useSegmentPatchSync 段级防抖 + APPLY_SERVER_SEGMENT 回写 + noteServerVersion 推进 base） | ✅ 已实现并通过测试，待提交 |
| 3 | 段结构端点（新建 + structure reconcile） | ✅ 已实现并通过测试，待提交 |
| 4 | 章节 CRUD + reorder | ✅ |
| 5 | 项目 PATCH + 文档 PUT | ✅ |
| 6 | 孤儿文件 sweep（脚本或管理端点，dry-run 默认） | ✅ |
| 7 | 清理：reducer 冗余 action、draftSync 瘦身、docs/e2e 更新 | — |

每阶段保持双写兼容：旧路径（全量 PUT autosave）在新端点上线、前端切换并回归后才下线对应 action 的 autosave 触发。

## 8. 兼容与风险

- **workers 模式**：所有新端点需在 `SegmentedProjectRepository` Protocol 上声明并双实现（local=SQLAlchemy / workers=PostgREST）；行级 PATCH 在 PostgREST 下是天然映射，风险低。
- **乐观锁兼容**：`base_updated_at` 为空即放行，agent（chapters:batch 之外如整包保存）与老前端不受影响；但 agent 整包保存场景建议后续也带上 base。
- **孤儿文件累积**：阶段 0 起文件删除全部依赖显式意图，删段/清音频的文件要等地毯式 sweep（阶段 6）才释放磁盘；磁盘增长可控（段级 mp3 约几十 KB），阶段间隔内可接受。
- **position 唯一约束**：结构端点沿用现有负哨兵两阶段重排，避免 UNIQUE 冲突（`segmented_project_service.py` 现有手法）。
- **大 PUT 行为变化**（自产字段忽略）是破坏性变更：依赖"PUT 回写 audio"的现存调用需在阶段 1 前审计（当前只有前端 autosave 与 migrate；migrate 走 `/migrate` 独立端点，不受影响）。

## 9. 验收标准

- 复现脚本：单章 80 段批量合成 + 全程自动保存开启 → 合成后所有段可播放（无 409），`audio.missing` 无假阳性。
- 并发测试：陈旧 `base_updated_at` 的 PUT 被 409；自产字段在 PUT 后保持 DB 原值。
- 段编辑 PATCH 后：文本更新、音频标记 missing、文件仍在盘上、其余段不受影响。
- 前端：批量合成全程无全量 PUT（网络面板断言），编辑段后 IndexedDB 与后端数据一致（dual-read）。
