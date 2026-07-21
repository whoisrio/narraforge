# Narration Layer Sync — 分层文本一致性检测与同步

**Status**: TODO (待实施)
**Depends on**: `feat/narration-git-versioning` 已合并；agent write path 已打通（Post-MVP #1）
**Created**: 2026-07-25

---

## 背景

三层文本内容各自独立可编辑，需要"检测不一致 + 手动裁定"机制：

```
L1 chapter.original_text  ──[agent 改写]──▶  L2 chapter.narration_script  ──[拆分]──▶  L3 segments[].text
```

- 上游改动**不自动传播**（防止用户手工微调被冲掉）；
- 检测差异后 UI 提示，用户选"以谁为准"手动同步；
- L1↔L2 只做提示，不提供同步按钮（无确定性映射）；
- L2↔L3 提供双向手动同步。

---

## 数据模型改动

### `SegmentedProjectChapter` 新增字段

```python
# L1 → L2 stale 检测
narration_script_derived_from_l1_hash: str | None = None

# L2 ↔ L3 双向 stale 检测
segments_derived_from_l2_hash: str | None = None   # 上次 split 时 L2 的 hash
segments_baseline_hash: str | None = None          # 上次 split 时 L3 join 的 hash
```

### `SegmentedProjectSegment` 新增字段（用于 L3→L2 定位合并）

```python
l2_offset_start: int | None = None
l2_offset_end:   int | None = None
l2_baseline_text: str | None = None    # split 时的原文，用来判断"没改过"
```

三个字段在 `split_segment` 结束时一次性写入；此后所有 L3 编辑**不动这些字段**，它们是"上次一致状态"的书签。

### Hash 计算

统一用 `blake2s(text.encode("utf-8"), digest_size=8).hexdigest()`（16 字符），足够抗碰撞、比 sha1 快。

`segments_baseline_hash` = hash of `"\n".join(seg.content_hash for seg in segments)`，只对 hash 序列再 hash 一次。

---

## 检测逻辑

```python
def sync_status(chapter) -> dict:
    l1_dirty = (
        chapter.narration_script_derived_from_l1_hash is not None
        and _hash(chapter.original_text or "") != chapter.narration_script_derived_from_l1_hash
    )
    l2_dirty = (
        chapter.segments_derived_from_l2_hash is not None
        and _hash(chapter.narration_script or "") != chapter.segments_derived_from_l2_hash
    )
    l3_dirty = (
        chapter.segments_baseline_hash is not None
        and _segments_hash(chapter.segments) != chapter.segments_baseline_hash
    )
    return {"l1_dirty": l1_dirty, "l2_dirty": l2_dirty, "l3_dirty": l3_dirty}
```

### 状态矩阵（L2/L3 部分）

| l2_dirty | l3_dirty | 状态 | 允许操作 |
|---|---|---|---|
| ✗ | ✗ | 一致 | 无提示 |
| ✓ | ✗ | L2 单边脏 | "重新拆分 segments（无损）" |
| ✗ | ✓ | L3 单边脏 | "以 L3 为准回写 L2（定位合并，无损）" |
| ✓ | ✓ | 冲突 | 两个按钮 + 显式警告"另一侧改动将丢失" |

`l1_dirty` 独立展示为 badge，无同步动作（仅提示"原文已改，改写稿可能过时"）。

---

## 后端 API

```
GET  /api/segmented-projects/{pid}/chapters/{cid}/sync-status
       → {l1_dirty, l2_dirty, l3_dirty}

POST /api/segmented-projects/{pid}/chapters/{cid}/resplit-from-script
       → 以 L2 重新拆分 segments，全部旧 segment 元信息丢弃
       → 新 segment ID 全部走 next_segment_id() 分配（永不复用）
       → 完成后重写 segments_derived_from_l2_hash + segments_baseline_hash
       → 返回新 segments 列表
       ⚠ 前端必须先弹确认框，明示 "将丢弃 N 段的 role/emotion/voice 配置"

POST /api/segmented-projects/{pid}/chapters/{cid}/rewrite-script-from-segments
       → 定位合并算法（见下）把 segments 变化回写到 L2
       → 完成后重写 segments_derived_from_l2_hash + segments_baseline_hash
       → 返回新的 narration_script
```

### L3→L2 定位合并算法

**前提**：`l2_dirty == false`（L2 从上次 split 后未被编辑）。若 L2 也脏了，端点返回 409，前端走冲突分支。

```python
def rewrite_l2_from_segments(chapter):
    l2 = chapter.narration_script
    # 从后往前替换，避免偏移错位
    for seg in sorted(chapter.segments, key=lambda s: s.l2_offset_start, reverse=True):
        if seg.text != seg.l2_baseline_text:
            l2 = l2[:seg.l2_offset_start] + seg.text + l2[seg.l2_offset_end:]

    # 更新所有 offset 和 baseline
    new_l2 = l2
    offset = 0
    for seg in sorted(chapter.segments, key=lambda s: s.position):
        idx = new_l2.index(seg.text, offset)  # 或维护累计偏移，避免 index()
        seg.l2_offset_start = idx
        seg.l2_offset_end = idx + len(seg.text)
        seg.l2_baseline_text = seg.text
        offset = seg.l2_offset_end

    chapter.narration_script = new_l2
    _refresh_hashes(chapter)
```

**边界情况**：
- **新增段落**：新段没有 `l2_offset_*`，用相邻段落的锚点插入（当前段的 `end` == 下一段的 `start`）。
- **删除段落**：直接在算法里跳过即可，L2 对应区域保留（不删——那是"未拆到的空白"，可能是空行/标题）。
- **重排段落**：`sorted by position` 处理即可，但要注意 offset 会大乱。**建议第一版禁止 L3 重排**，或重排后强制走 resplit-from-script 路径。

---

## Split 服务改动

在 `text_split_service.py`（或对应的 split_segment 出口）末尾：

```python
def split_chapter(chapter):
    segments = _split_by_punct(chapter.narration_script, chapter.split_config)
    offset = 0
    for i, seg in enumerate(segments):
        idx = chapter.narration_script.index(seg.text, offset)
        seg.l2_offset_start = idx
        seg.l2_offset_end = idx + len(seg.text)
        seg.l2_baseline_text = seg.text
        offset = seg.l2_offset_end

    chapter.segments = segments
    chapter.segments_derived_from_l2_hash = _hash(chapter.narration_script)
    chapter.segments_baseline_hash = _segments_hash(segments)
```

同时 agent write path（写入 `narration_script` 时）：

```python
chapter.narration_script = new_script
chapter.narration_script_derived_from_l1_hash = _hash(chapter.original_text or "")
```

---

## 前端 UI

### 章节头 badge

- 三个独立 badge（L1/L2/L3），只有对应 dirty 时显示；
- 颜色：warning（脏）/ success（干净）；
- 点击 badge 打开同步 modal。

### 同步 Modal

- **L2 单边脏**：只显示一个按钮 "以 L2 为准重新拆分（丢弃现有 segment 配置）"，含二次确认。
- **L3 单边脏**：只显示一个按钮 "以 L3 为准回写改写稿（定位合并，无损）"。
- **冲突**：两个按钮并列，附 diff 预览（用 `difflib` HTML 输出）。
- **L1 dirty**：不提供按钮，只显示 "重新运行 agent workflow" 的跳转链接。

---

## 算法选型（diff 展示）

**脏检测**：`blake2s` hash 比较，O(1) 每层。

**Diff 预览**（可选，用于冲突态 modal 里的可视化）：
- 一期：`difflib.SequenceMatcher`（stdlib，无依赖）
- 按 `split("\n\n")` 段落粒度而不是字符/行，避免大文本卡顿
- 若一期用户反馈定位不准，再考虑 `diff-match-patch`（Google，MIT，Myers 算法）

---

## 分阶段 Rollout

**Phase A — 脏检测最小化**（低成本，价值立现）
- 加 hash 字段（chapter 3 列 + segment 3 列）
- P14 migration
- Split 服务写入 hash + offset
- Agent write path 写入 L1 hash
- `GET /sync-status` 端点
- 前端章节头 badge（只显示，不含 modal）

**Phase B — 手动同步动作**
- `POST /resplit-from-script` + `POST /rewrite-script-from-segments`
- 前端 modal + 二次确认

**Phase C —（观察 2-4 周后再定）**
- diff 预览
- L1 diff 详情面板
- 冲突态的可视化 3-way 对比

Phase A 完全独立可交付，能立即解决 80% 的"用户不知道数据是否 stale"痛点。

---

## Open Questions

1. **L3 重排是否允许？** 允许则 `l2_offset_*` 定位失效，需要重新扫描或干脆走 resplit 路径。倾向：**不允许在 L3 上重排**，若需重排就走 resplit-from-script。
2. **新增段落的锚点位置**：默认插到相邻段 end/start 中间；但可能落在空行/标题中间，会破坏 L2 结构。倾向：**L3 上不允许新增段**，只允许拆开现有段（split_at_cursor）。这样新段总是"来自旧段"，锚点继承旧段的。
3. **删除段落对应 L2 区域怎么处理**：保留（当前算法）还是删除？倾向：**保留**，因为可能是标题/空行。这一条会导致 L3→L2 回写后 L2 出现"没有对应 segment 的孤立文本块"，需要文档说明。

---

## Test 覆盖计划

- Unit: hash 计算稳定性、offset 追踪、定位合并算法（含空段/新增/删除各一）
- Integration: split → edit L3 → rewrite-from-segments 往返一致性
- E2E: 前端 badge 显示正确状态转移

---

## Related

- Parent plan: `docs/superpowers/plans/2026-07-25-narration-git-versioning.md`
- Depends on: `feat/narration-workflow` 分支的 agent write path (PATCH narration-script 端点)
