# 分段项目保存冲突自愈与草稿保护设计 Spec

日期：2026-09-23
状态：草案（待评审）
关联：`docs/plans/2026-08-27-segmented-api-granularity-design.md`、`docs/api-reference.md`、`backend/app/services/segmented_project_service.py`、`backend/app/api/segmented_projects.py`、`frontend/src/hooks/useSegmentedDraftSync.ts`、`frontend/src/pages/TTSSynthesis.tsx`

## 1. 背景

### 1.1 用户可见现象

后端为整包 PUT 加入项目级乐观锁之后，前端编辑期间频繁弹出"检测到项目已在别处更新"。
弹出的同时，尚未保存的本地编辑被静默替换为后端状态，用户输入直接丢失。

### 1.2 根因链路（已逐行核实）

完整链路如下，四步都已在代码中确认：

1. 后端整包 PUT（`save_project`，`segmented_project_service.py:445`）带项目级乐观锁：payload 的 `base_updated_at` 与服务端当前 `updated_at` 不符即 409 `stale_payload`（L451-456）。
   workers 仓库路径（`repositories/segmented_projects.py:607-611`）同语义。
2. 前端任何 bump 了 `project.updated_at` 的 reducer 变更都会 `markDirty` → 防抖 1 秒 → 整包 PUT（`TTSSynthesis.tsx:429-452`、`useSegmentedDraftSync.ts` 的 `flush`）。
3. 409 之后 `onSaveError` 走 `recoverStaleProject`（`TTSSynthesis.tsx:505-525`、`recoverStaleProject.ts`）：拉后端权威态 → `adoptBackendVersion` 把草稿整份替换为后端态、dirty 清零 → `LOAD_PROJECT` 灌回 UI。
4. 本地未保存的编辑在第 3 步被静默丢弃，没有合并，没有用户选择，toast 只说"已恢复"。

结论：冲掉端侧更新的直接凶手是"server wins、草稿扔掉"的恢复策略，409 只是触发器。

### 1.3 409 频发的三个来源

- 来源一（主因）：自己撞自己。
  乐观锁版本是项目级单时间戳，但约 20 个细粒度端点（段 PATCH、合成、调音、章节操作）都会推进它。
  前端靠 `noteServerVersion` 人肉追新 base（6 处调用点：`TTSSynthesis.tsx:538、1063、1102、1191、1582、1724`）。
  结构性竞态堵不死：flush 发出 PUT 时读当时的 base，PUT 在途时合成/PATCH 完成、服务端版本前移，PUT 落地即 409——尽管服务端变更就是本端发起的，本地草稿早已包含其结果。
- 来源二：章节级编辑仍走整包 PUT。
  `SET_CHAPTER_META`（`useSegmentedProject.ts:393-394`）在 engine/voice 等变化时触发（`TTSSynthesis.tsx:458-463`），touch=true → 整包 PUT。
  批量合成跑到一半用户改音色，自动保存 PUT 必然带旧 base 撞 409。
- 来源三：真外部写入。
  agent 写入走 `base_updated_at=None` 直接放行（service L453 注释"老客户端/agent, 放行"），agent 一写，打开的 tab 全部变 stale；双开标签页同理。

### 1.4 本次范围决策

先落地前两层，暂不做第三层：

- 第一层：409 自愈——识别假冲突（自撞），零感知重试，不丢任何本地编辑。
- 第二层：真冲突用户裁决——不静默丢草稿，弹窗选择，被放弃的草稿归档可找回。
- 第三层（实体级乐观锁 + 章节字段走细粒度端点）延后，见 §10。

配套的产品假设：单浏览器 tab 为唯一写者；agent 写入与双开标签页视为真冲突源，交给第二层弹窗，不做自动合并。

## 2. 目标与非目标

### 目标

- 自撞型 409 全程零 UI 打扰（无 toast、无弹窗），本地编辑零丢失。
- 真冲突必须由用户裁决，任何路径都不允许静默丢弃草稿。
- 被放弃的草稿自动归档（带时间戳），用户可查看、恢复。
- 冲突裁决中"用草稿"必须真正落库（force save），不能只是载入 UI。
- 加载期与保存期两套冲突流程统一为同一裁决逻辑，并修复其既有 bug（见 §3-B/C）。

### 非目标

- 不做多写者自动合并（字段级/实体级 merge）——那是第三层与 granularity refactor 收尾的事。
- 不改后端乐观锁语义与 409 响应契约（现状已满足本设计需要，见 §3-A）。
- 不处理 frontend 存储模式（纯 IndexedDB，无后端无 409）。
- 不做归档草稿与后端态的 diff 视图（保持最小，后续按需加）。

## 3. 已核实的现状事实

| # | 事实 | 位置 |
|---|---|---|
| 1 | 409 响应体已含服务端当前版本：`detail={code:'stale_payload', server_updated_at}` | `api/segmented_projects.py:211-214` |
| 2 | `base_updated_at=None`（或不发送）即绕过乐观锁，后端放行 | service L451-456、`backendSegmentedProjectStorage.ts:44`（`null ?? undefined` → 字段不序列化） |
| 3 | 前端已有 `apiErrorCode(err)` 从 `err.response.data.detail.code` 取错误码，同一 detail 里就有 `server_updated_at` | `services/api.ts:13-17` |
| 4 | 加载期已有真冲突弹窗 `ConflictPrompt`（backend vs draft 二选一），保存期反而静默丢弃，行为不一致 | `TTSSynthesis.tsx:373、2766-2780`、`ConflictPrompt.tsx` |
| 5 | `flush` 的 catch 中，草稿被取代时（`latest.updated_at !== rec.updated_at`）仍无条件调用 `onSaveError` | `useSegmentedDraftSync.ts` flush |
| 6 | `noteServerVersion` 无单调保护：响应乱序到达时会把 base 回退到旧版本 | `useSegmentedDraftSync.ts` noteServerVersion |
| 7 | IndexedDB DB_VERSION=3，onupgradeneeded 按 store 名判建；新增 store 需 bump 版本 | `services/indexedDB.ts:4-33` |
| 8 | 后端测试已断言 409 code，未断言 detail 中的 `server_updated_at` | `backend/tests/test_segmented_projects_api.py:349-358` |

核实过程中的三个新发现（本设计直接受益）：

- A：409 响应体已带 `server_updated_at`，第一层判定不需要额外 GET，一次读错误体即可。
- B：`flush` 在草稿被取代后仍调 `onSaveError`（事实 5），这正是数据丢失的放大器：包含合成结果与新编辑的新草稿本已排程重发，却被 `recoverStaleProject` 整份冲掉。第一层必须先修这一点。
- C：加载期 `ConflictPrompt` 的两个裁决 handler 都不恢复 `initialLoadDoneRef`（冲突分支在 L407 之前 early return），裁决后 autosave 永久暂停；"用草稿"从不落库，刷新后服务端仍是旧态、弹窗重复出现。第二层统一裁决时一并修复。

## 4. 设计总览

两层职责划分：

- 第一层完全收敛在 `useSegmentedDraftSync` 内部：识别假冲突 → 换 base 重试 → 成功或上抛，不外泄到 UI。
- 第二层在 `TTSSynthesis` 的 `onSaveError`（仅剩真冲突会走到）：归档 → 拉后端 → 模态弹窗裁决 → 落库或采纳。
- 加载期冲突复用第二层的裁决动作，删除单独的一套 handler。

数据流（真冲突时）：

```
PUT 409 (S ∉ known, 等待窗口后仍未知)
  → onSaveError(stale_payload)
  → draftSync.pause()
  → 归档草稿 → conflicted_drafts (IndexedDB, prune 10/项目)
  → GET 后端权威态
  → ConflictPrompt(模态): [用草稿(force save)] [用后端(adopt)]
  → 裁决 → resume() → 归档保留可找回
```

## 5. 第一层：自撞型 409 自愈

### 5.1 判定原理：已知服务端版本登记

在 `useSegmentedDraftSync` 内维护会话级内存结构：`Map<projectId, Set<string>>`，记"本端发起的写所产生的服务端版本"。

登记入口（只登记本端写的产物，不登记 GET/adopt 观察值）：

1. `noteServerVersion(v)`：v 入集（所有细粒度端点响应的 `project_updated_at` 都经此入口）。
2. `flush` 成功：`saved.updated_at` 入集。

每项目保留最近 64 个（防无界增长，足够覆盖批量合成的在途窗口）；会话内存，不持久化。

判定规则：409 携带的 `S = server_updated_at` ∈ 集合 ⟺ 假冲突。

正确性论证：服务端 `updated_at` 随每次写前进；409 的 S 是 PUT 校验时刻的服务端当前值。
若 S 恰等于本端某次写的响应版本，则那次写之后服务端无任何进一步写入（否则 S 必然更大且不在本端已知集合中）。
因此该 409 不存在"他方写入"，纯自撞，重试安全。
反之，外部写入（agent、另开标签页）产生的 S 不在本端集合中，进入第二层。
同微秒两次写版本相同的情况：相等比较天然视为同一版本，成员判定不受影响。

### 5.2 flush 的冲突处理与重试

`flush` 的 PUT 包一层有界重试，伪代码：

```
rec = getDraft(pid); if (!rec?.dirty) return
for attempt in 0..MAX_STALE_RETRIES(3):
  try:
    saved = saveProject(rec.draft, { base_updated_at: base })
    → 成功收尾（现状逻辑：latest 校验、base=saved.updated_at、dirty=false、入已知集）
    return
  catch e:
    if apiErrorCode(e) != 'stale_payload': throw e          // 其他错误走现状路径
    latest = getDraft(pid)
    if latest.updated_at != rec.updated_at: return          // 草稿被取代：静默退出（§5.3）
    S = apiStaleServerUpdatedAt(e)                          // 新 helper，读 detail.server_updated_at
    if S == null: throw e                                   // 防御：老后端无该字段
    if S ∈ known(pid): base = S; continue                   // 自撞：以 409 报告的服务端当前值为新 base 重试
    if await waitForSelfWrite(pid, S, ~1s): base = S; continue  // 在途自写响应晚到：等登记后重试
    throw e                                                 // 真冲突：交第二层
```

要点：

- 重试的新 base 直接取 `S`（409 报告的服务端当前值），不取草稿记录的 base——后者可能因乱序响应而落后（§5.4 修复前）。
- `waitForSelfWrite`：每 250ms 检查一次 S 是否入集，最多约 1 秒。
  场景：409 先于本端在途自写响应到达（网络乱序），该响应到达后 `noteServerVersion` 登记 S。
  轮询期间若草稿被取代则立即放弃等待并静默返回（新草稿的 flush 已排程）。
- 重试上限 3 次：每次重试用最新草稿重读 base；连续自撞超过 3 次按真冲突上抛（安全方向）。
- 上抛后的错误处理与现状一致（写 `last_save_error`、调 `onSaveError`），由第二层接手。

与"草稿被取代"的分工说明（实现者需理解的时序矩阵）：

- 自写响应先到、其结果已触发 `markDirty`：新草稿 updated_at 变化 → 在途 flush 走 §5.3 静默退出，新 flush 带新 base 自然成功，不需要重试。
- 自写响应先到、但草稿内容未变（结果早已在草稿里，只是 base 落后）：latest 仍是本份 → S ∈ known → 重试换 base 成功。
  这就是"合成成功但 PUT 撞自己"的主场景。
- 自写在途未回：S 暂不在集合 → 等待窗口内登记 → 重试；窗口耗尽 → 真冲突路径。

### 5.3 草稿被取代时静默退出（关键修复）

现状：catch 里 `latest.updated_at !== rec.updated_at` 只拦住错误记录的写回，`onSaveError` 仍被无条件调用（事实 5）。
修改：草稿被取代时直接 return——不写 `last_save_error`、不调 `onSaveError`。

理由：被取代说明更新的草稿（含新编辑/合成结果）已排程自己的 flush，本次失败的结果由它接手；旧 flush 的错误回调只会触发 `recoverStaleProject` 把新草稿冲掉。
该静默规则对非 stale 错误同样适用（422 等由新 flush 重新触发各自的提示）。

### 5.4 noteServerVersion 单调化

`noteServerVersion` 加单调保护：仅当新版本晚于当前 base 时前移（时间比较用 `Date.parse`，NaN 容错为不前移），防止乱序响应把 base 回退。
该修复独立成立：即使没有第一层，回退的 base 也会制造本可避免的 409。

### 5.5 行为约束

- 自愈全程无 toast、无弹窗、无状态栏打扰；仅 `console.debug` 级日志（含 S、attempt 数），便于排查。
- 重试不修改草稿内容，只换 base；不产生新的用户可见状态。
- 第一层成功时 `onSaved` 正常回调（`serverChapterIds` 同步等派生逻辑不受影响）。

## 6. 第二层：真冲突用户裁决与草稿归档

### 6.1 onSaveError 的 stale_payload 分支重写

`recoverStaleProject` 的调用点替换为新流程 `handleStaleSave`（函数可落在 `recoverStaleProject.ts` 并重命名，测试同步改造）：

1. `draftSync.pause()`（§6.6）——立即止血，防止弹窗期间继续 PUT→409 循环。
2. 归档当前草稿：`putConflictedDraft(projectId, 当前草稿记录)`，随后 prune（§6.4）。
3. 拉后端权威态 `projectStorage.getProject(pid)`。
   失败处理：toast 错误并保持 pause，草稿与归档原样保留，等用户下次动作或重试；绝不降级为静默 adopt。
4. `setConflictPrompt({ backend, draft })` 弹模态窗。
5. toast `tts.staleSaveRecovered` 删除（弹窗即通知），或改为"检测到版本冲突，请选择保留哪份"。

防御：裁决动作执行时若草稿记录在弹窗期间又变化（模态化后理论上不可能），先再归档一份再继续。

### 6.2 ConflictPrompt 模态化与裁决动作

现状 `ConflictPrompt` 是非模态 div（`ConflictPrompt.tsx`）。
改为遮罩模态：冲突未决期间阻止编辑，杜绝"弹窗开着还在产生第三态写入"。

两个裁决动作（加载期与保存期共用同一实现 `resolveConflict(choice)`）：

- 用后端：`adoptBackendVersion(backend)` → `LOAD_PROJECT` → `lastSavedUpdatedAtRef.current = backend.updated_at` → `resume()`。
  归档保留。
- 用草稿：`LOAD_PROJECT(draft)` → force save：`saveProject(draft, { base_updated_at: null })`（后端 None=放行语义，客户端 `null ?? undefined` 不序列化，链路已兼容，见事实 2）→ 成功后 base=`saved.updated_at` 并入已知集 → `resume()`。
  force save 失败：toast 错误、关闭弹窗、保持归档；下次保存重新走冲突流程（幂等，不会丢数据）。
  归档保留。

force save 通道（`base_updated_at=None`）的使用范围严格限定为：冲突裁决"用草稿"、归档恢复。
代码评审时任何新增调用点都应被拒绝——这是防止 last-writer-wins 回潮的硬约束。

弹窗文案补充一行：本地草稿已自动归档，可在"冲突草稿"入口找回（§6.5）。

### 6.3 加载期冲突流程统一（修复两个既有 bug）

现状加载期 `ConflictPrompt` 的 handler（`TTSSynthesis.tsx:2766-2780`）有两个 bug（事实 C）：

- 裁决后 `initialLoadDoneRef` 不恢复（冲突分支在 L407 设置之前 early return），autosave 永久暂停直到切换项目。
- "用草稿"从不落库，刷新后弹窗重复出现。

统一方案：加载期检测到冲突后，同样走 `setConflictPrompt` + §6.2 的 `resolveConflict`；删除现有独立 handler。
`resolveConflict` 收尾统一执行 `initialLoadDoneRef.current = true` 与 `lastSavedUpdatedAtRef` 同步。

### 6.4 冲突草稿归档存储

- `services/indexedDB.ts`：DB_VERSION 3 → 4，onupgradeneeded 增加 `conflicted_drafts` store（keyPath `id`）。
- 新文件 `services/conflictedDraftStore.ts`：
  - `putConflictedDraft(projectId, record: ProjectDraftRecord)`：写 `{ id: uuid, project_id, archived_at: now, record }`，写后 prune。
  - `listConflictedDrafts(projectId?)`：按 `archived_at` 降序。
  - `deleteConflictedDraft(id)`。
  - prune 策略：每项目保留最近 10 份，超出删最旧。
- 归档的是完整 `ProjectDraftRecord`（含 base_updated_at、updated_at），恢复时保留原语义。

### 6.5 归档找回入口（最小 UI）

- 入口：TTSSynthesis 保存/同步状态区，当前项目存在归档时显示"冲突草稿 (N)"。
- 对话框：列表项显示归档时间、草稿更新时间、章/段计数。
- 操作：
  - 恢复：拉当前后端态，直接进入 §6.2 的冲突裁决弹窗（backend vs 该归档草稿），复用同一流程，不做"静默覆盖服务器"的捷径。
  - 删除：删除该归档条目。
- UI 实现须遵循 `docs/design/stitch_narraforge_story_global_prj/DESIGN.md` 的组件与文案规范。

### 6.6 autosave 暂停语义（pause/resume）

`useSegmentedDraftSync` 新增：

- `pause()`：挂起 flush 的排程与执行；`markDirty` 照常写草稿（编辑不丢，只是不推送）。
- `resume()`：若当前草稿 dirty 则立即 `schedule()`。

用途：冲突弹窗期间。
注意 pause 不清除已排程的语义冲突——`pause()` 时若已有 pending timer，直接取消，resume 后按 dirty 重排。

### 6.7 多写者边界声明

- 本设计不做多写者合并；agent 写入（`base_updated_at=None` 直写）与双开标签页都表现为真冲突，走弹窗。
- 后续若要规范 agent 写入（加 If-Match 或写前广播失效），另行立项，不在本 spec 范围。

## 7. 文件级变更清单

| 文件 | 变更 |
|---|---|
| `frontend/src/services/api.ts` | 新增 `apiStaleServerUpdatedAt(err)`：读 `err.response.data.detail.server_updated_at` |
| `frontend/src/hooks/useSegmentedDraftSync.ts` | 已知版本登记；flush 有界重试 + waitForSelfWrite；草稿被取代静默；noteServerVersion 单调化；pause/resume |
| `frontend/src/hooks/recoverStaleProject.ts` | 重构为 `handleStaleSave`：pause → 归档 → 拉取 → 回调弹窗（不再静默 adopt） |
| `frontend/src/services/indexedDB.ts` | DB_VERSION 4，新增 `conflicted_drafts` store |
| `frontend/src/services/conflictedDraftStore.ts` | 新文件：put/list/delete/prune |
| `frontend/src/components/SegmentedTTS/ConflictPrompt.tsx` | 模态化；归档提示文案；加载期/保存期共用 |
| `frontend/src/components/SegmentedTTS/`（新） | `ConflictDraftsDialog.tsx` 归档列表/恢复/删除 |
| `frontend/src/pages/TTSSynthesis.tsx` | onSaveError stale 分支重写；resolveConflict 统一裁决（含 initialLoadDoneRef/lastSavedUpdatedAtRef 修复）；归档入口 |
| `frontend/src/i18n/zh-CN.ts`、`en-US.ts` | 新键：冲突弹窗补充文案、冲突草稿对话框、删除 staleSaveRecovered 或改文案 |
| `backend/tests/test_segmented_projects_api.py` | 补断言 409 detail 含 `server_updated_at`（契约固化，防回归） |

后端业务代码零变更。

## 8. 测试计划（TDD）

### 单元测试（vitest，与源码同目录）

`useSegmentedDraftSync.test.ts` 新增用例：

1. 409 且 S ∈ 已知集（`noteServerVersion` 预登记）→ 换 base 重试成功；不触发 `onSaveError`；草稿 dirty=false、base=S。
2. 409 且 S 初始不在集合、等待窗口内登记到 → 重试成功。
3. 409 且 S 超时未登记 → `onSaveError` 收到原错误；错误记录写入。
4. PUT 在途草稿被取代 + 409 → 静默返回：无错误记录写入、无 `onSaveError`。
5. 连续 3 次自撞 409 → 第 3 次后按真冲突上抛。
6. `noteServerVersion` 乱序（旧版本后到）不回退 base。
7. pause 期间不 flush；resume 后 dirty 立即排程；pause 期间 markDirty 正常写草稿。

`conflictedDraftStore.test.ts`：put/list 排序/prune（第 11 份触发删除最旧）/delete。

`handleStaleSave`（原 `recoverStaleProject.test.ts` 改造）：

- 调用顺序：pause → 归档 → getProject → 弹窗回调。
- getProject 失败：不弹窗、不 resume、归档已写入。
- 裁决"用草稿"：force save 不携带 base（断言请求体无 `base_updated_at`）。

`ConflictPrompt.test.tsx`：模态渲染、两按钮回调、归档提示文案。

`TTSSynthesis` 集成测试（沿用 `__tests__/` 现有模式）：

- 409 真冲突 → 归档 +1 + 弹窗出现。
- "用草稿" → force save 落库 + autosave 恢复（后续编辑正常 markDirty）。
- "用后端" → adopt + `initialLoadDoneRef` 恢复（后续编辑正常保存）。
- 加载期冲突选"用草稿" → 服务端被覆盖为草稿内容（回归验证事实 C 的修复）。

### E2E（`tests/e2e/`，遵循 `docs/e2e-test-guide.md` 双读验证）

1. 假冲突：编辑期间触发段合成（服务端版本前移）→ 自动保存 → 断言无弹窗、编辑保留、DB 与 UI 一致。
2. 真冲突：编辑未保存时通过 API 直接改服务端（模拟 agent/他端）→ 自动保存 → 弹窗出现 → 分别验证"用草稿"（DB=草稿内容）与"用后端"（UI=服务端态）两条路径，且归档列表 +1。
3. 归档恢复：真冲突后"用后端"，再从冲突草稿入口恢复该归档 → 走裁决弹窗选"用草稿" → DB 反映归档内容。

### 后端

- 补 409 detail `server_updated_at` 断言（§7 最后一行）。
- 既有 stale_payload / matching-base 测试保持通过（零行为变更的证明）。

## 9. 风险与权衡

- 已知集为会话内存，reload 后为空：reload 后 base 即加载版本且无在途自写，自撞场景不存在；若恰逢外部写则正确进入真冲突。安全方向无误伤。
- 等待窗口（~1s）推迟真冲突弹窗：真冲突本身罕见，1 秒可接受；窗口内轮询不阻塞 UI（异步）。
- force save 通道扩大覆盖面：严格限定两个调用点（§6.2），评审硬约束。
- 模态弹窗打断输入：冲突是需要立即裁决的事件，且草稿已归档、选择"用草稿"不丢任何内容，代价可接受。
- prune 上限 10/项目：极端高频冲突下旧归档被清；归档是兜底而非版本历史，10 份足够（如需更多后续再做导出）。
- `SET_CHAPTER_META` 仍走整包 PUT（来源二）：第一层自愈使其不再造成数据丢失，但 409 仍会偶发（自愈消化）；彻底消除待第三层。

## 10. 第三层展望（不在本期）

结构性根治 = `docs/plans/2026-08-27-segmented-api-granularity-design.md` §4 的收尾：

- 乐观锁粒度从项目级降到 chapter/segment 实体级，整包 PUT reconcile 只对"用户改过且服务端也改过"的实体报冲突，其余自动取服务端新值。
- `SET_CHAPTER_META` 等章节字段改走已有 chapter PATCH 端点（`api/segmented_projects.py` 的 `/chapters/{cid}/structure` 及章节 PATCH），整包 PUT 退出自动保存热路径。

前置条件：产品确认是否支持多写者（多标签页同时编辑、agent 与人同时写）。
若确认单写者，第一层+第二层已是终态，第三层仅作为体验优化排期。
