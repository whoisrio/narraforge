# Agent Narration Write Path — 让 workflow 生成的 narration_script 落库

**Status**: TODO (待实施)
**Depends on**:
- PR #21 (`feat/narration-git-versioning`) 已合并 → 提供 `chapter.narration_script` 列
- `feat/narration-workflow` 已在 master (PR #20) → 提供 gen_script / script_review / split_segment 节点
**Created**: 2026-07-25

---

## 背景

当前状态：
```
用户 → agent workflow → gen_script / script_review / split_segment / synthesis
                              ↓
                       结果只存在 LangGraph in-memory state
                              ↓
                       session 结束就丢 ❌ 从未写回 DB
```

后果：
- `chapter.narration_script` 永远 `NULL`
- git snapshot 里的 `script.md` 永远缺失
- 用户无法在 workflow 结束后回看/编辑改写稿

## 目标

打通 **agent → backend HTTP → DB** 的写入链路，让 workflow 的中间产物（narration_script + segments）持久化。

---

## 前置调研（写 detailed plan 前必答）

1. **workflow node 现状**（读 `agent/app/graph.py` + master 上的 workflow 代码）：
   - `gen_script` node 输入 / 输出是什么？State schema 里 `narration_script` 字段叫什么？
   - `script_review` 有 LangGraph `interrupt()` 机制吗？人工确认后是 resume 到哪个 node？
   - `split_segment` 拆完后 segments 存在 state 的哪个字段？
2. **backend 端点现状**（读 master 上 `backend/app/api/segmented_projects.py`）：
   - 是否已存在 `PUT segments` 或类似的细粒度 segment 更新端点？
   - 还是只能通过 `PUT /api/segmented-projects/{id}` 全量 upsert？
3. **workflow run 粒度**：
   - 一次 run 处理**一章**还是**整本书**？
   - `chapter_id` 是 workflow 触发时绑定，还是 state 里动态选择？
4. **agent HTTP client 现状**（读 `agent/app/backend_client.py` 或等价文件）：
   - 已有哪些 backend 调用？封装模式是什么（`httpx.AsyncClient`？错误处理？）？

---

## 三个实现选项

### Option A：`gen_script` 后立即写（含 draft）
- 生成完就 PATCH 到 DB，哪怕后续 review 会改
- **缺点**：DB 里会有"未确认版本"污染，需要额外字段区分 draft/final

### Option B：`script_review` 通过后写（**倾向**）
- 只把"人工确认过的版本"落库
- 语义清晰：DB 里的 `narration_script` = 用户确认过的最终稿
- Draft 状态从 LangGraph state 拿，前端可以从 stream 里读
- **实施最简**

### Option C：Draft + Final 双字段
- `chapter.narration_script_draft` + `chapter.narration_script`
- 灵活但复杂，需要新增列 + 前端两个字段的 UI 逻辑
- **只有确认"draft 也需要跨 session 持久化"才用**

**推荐 Option B。**

---

## Backend 变更

### 端点

```
PATCH /api/segmented-projects/{project_id}/chapters/{chapter_id}/narration-script
Body:     { "narration_script": "..." }
Response: { chapter_id, narration_script, updated_at }
```

要点：
- **幂等**：可重复写同样内容不报错
- **只写这一列**：不动 segments / original_text
- **返回时不 mirror 到文件系统**：narration_script 是 DB-only，git snapshot 会自己抓
- **可选**：如果 layer-sync 的 hash 字段已加（TODO #1），顺便写 `narration_script_derived_from_l1_hash = hash(original_text)`

### 端点（如果 Option A: 需要一并写 segments）

如果调研发现 backend 目前只有 `PUT /api/segmented-projects/{id}` 全量端点：

**新增细粒度**：
```
PUT /api/segmented-projects/{project_id}/chapters/{chapter_id}/segments
Body:     { "segments": [ { id, position, text, ... }, ... ] }
Response: { chapter_id, segments: [...] }
```

要点：
- 全量替换该 chapter 的 segments（新 ID 全走 `next_segment_id()`）
- 顺便写 `segments_derived_from_l2_hash + segments_baseline_hash + l2_offset_*`（layer-sync 铺路）
- **并发保护**：如果同一 chapter 被并发写，后写覆盖（简单粗暴，agent 单 chapter 单 session 场景够用）

---

## Agent 变更

### 1. HTTP client 方法

```python
# agent/app/backend_client.py
async def patch_chapter_narration_script(
    self, project_id: str, chapter_id: str, script: str
) -> dict: ...

async def put_chapter_segments(
    self, project_id: str, chapter_id: str, segments: list[dict]
) -> dict: ...
```

### 2. Node 集成

**Option B 下的插入点**：

- **`script_review` 通过后**（resume 之后的下一步）→ `patch_chapter_narration_script`
- **`split_segment` 完成后** → `put_chapter_segments`

具体是**新加一个 "persist_script" node** 还是**在现有 node 尾部调 client**？

倾向**新加节点**，理由：
- 保持每个 node 单一职责
- 便于失败重试（graph 层面 retry 而不是 node 内 catch-all）
- LangGraph 的 stream 事件里能明确看到 "正在保存" 阶段

Graph 变化：
```
gen_script → script_review → persist_script → split_segment → persist_segments → synthesis
```

### 3. 失败处理

**简单方案**（推荐首版）：
- HTTP 失败 → node 抛异常 → LangGraph run 失败 → 用户看到错误 → 手动重试整个 workflow
- workflow 本身对状态 idempotent（script/segments 全量替换），重试安全

**复杂方案**（暂不做）：
- 本地缓存 pending writes
- APScheduler 补偿任务
- 不值得，因为 agent 是短生命周期，用户重试的心智负担 < 复杂化系统的维护成本

---

## Test 覆盖

- **Backend unit**：新端点的 round-trip 测试（follow 现有 `test_segmented_projects_api.py` 模式）
- **Agent unit**：mock backend HTTP，验证 node 调用正确的 URL/body
- **E2E**：真跑一次 workflow → 验证 DB 里 chapter.narration_script 有内容 → 触发 snapshot → 验证 git 里 script.md 有内容

---

## Open Questions

1. **在 `script_review` 里做人工编辑修正会怎样？**
   如果 review UI 允许用户手改 script，改完的版本应该落库。是从 LangGraph interrupt 的 resume payload 里拿最终 script，还是从 state 里拿？
2. **workflow run 失败但 script 已经生成**怎么办？
   Option B 下如果 `synthesis` 失败，前面几步已经写了 DB。这是好事（不需要重跑前半段），但要确保 workflow 支持 "从 synthesis 重启" 而不重跑 gen_script。
3. **一次 workflow 处理多章时**，PATCH 是逐 chapter 触发还是批量？
   如果是批量，需要新端点 `PATCH /api/segmented-projects/{id}/chapters/narration-scripts`（批量版）。
4. **Agent LangSmith / observability**：
   PATCH 失败的 trace 里能不能看到？需要给 backend_client 加合适的日志/tracing。

---

## 分阶段 Rollout

**Phase A — MVP write path**
- 前置调研（4 个问题答清）
- Backend PATCH 端点（narration_script only）
- Agent client 方法 + 新 `persist_script` node
- Backend + agent 各一个测试

**Phase B — Segments 持久化**
- Backend `PUT segments` 端点（如果调研发现不存在）
- Agent `persist_segments` node
- E2E: workflow → DB → git snapshot 验证

**Phase C — Layer sync hash 补齐**
- 触发 `todo/2026-07-25-narration-layer-sync.md` 的 Phase A
- write path 顺便把 hash 字段写好

**Phase D —（暂不做）**
- Draft 状态持久化
- 多 chapter 批量端点
- 复杂失败恢复

Phase A 单独可交付，价值立现（git snapshot 里能看到 script 内容）。

---

## 工作量估算

Phase A 独立完成：**约半天**
- 端点 + 测试：1-2 小时
- Agent node + client + 测试：2 小时
- E2E 联调：1-2 小时

Phase A + B 一起做：**1 天**

比 narration-git-versioning 那轮（10 tasks）小得多，可以 in-session 直接干，不需要 subagent 拆分。

---

## Related

- `docs/superpowers/plans/2026-07-25-narration-git-versioning.md`（父 plan）
- `todo/2026-07-25-narration-layer-sync.md`（依赖本 TODO 的 hash 字段落地）
- Backend feature spec: `docs/feature-spec.md`（可能需要补 workflow persistence 章节）
