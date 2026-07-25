# Narration Layer Sync - Phase A（脏检测 + Badge）

**Status**: Approved
**Created**: 2026-07-25
**Branch**: feat/narration-layer-sync
**Parent design**: `todo/2026-07-25-narration-layer-sync.md`
**Size**: Medium

## 范围（仅 Phase A）

三层文本陈旧检测 + 章节头 badge（只显示脏/干净，不含同步 modal）。
解决 80% "用户不知道数据是否 stale" 痛点。Phase B（同步动作）/ C（diff）后续再做。

三层：
```
L1 chapter.original_text  ──[agent 改写]──▶  L2 chapter.narration_script  ──[拆分]──▶  L3 segments[].text
```

## 数据模型（1 个 JSON 列，非 6 个独立列）

`SegmentedProjectChapter` 加 1 列 `sync_state` (JSON, nullable)：

```json
{
  "l1_hash": "...",          // 生成 L2 时的 hash(original_text)
  "l2_hash": "...",          // 拆分时的 hash(narration_script)
  "segments_hash": "..."     // 拆分时的 hash(各段 text)
}
```

migration：`ALTER TABLE segmented_project_chapters ADD COLUMN sync_state JSON`。
不存 segment 级 offset/baseline（那是 Phase B 的定位合并才需要）。

脏检测在应用层做（`存储旧 hash` vs `当前文本算出的新 hash`），不跨行查询，所以 JSON 列无损失。

## Hash 计算

- `blake2s(text.encode("utf-8"), digest_size=8).hexdigest()`（16 字符）
- `segments_hash = blake2s("\n".join(seg_hash(s.text) for s in segs).encode(), digest_size=8).hexdigest()`

## Re-baseline 钩子（关键：只在真拆分/真派生时重置基线）

| 钩子 | 何时 | 写什么 |
|---|---|---|
| `batch_create_structure`（agent 写 L2+L3） | agent 生成 narration_script 并拆分 | 全部 3 个 hash（l1=hash(original_text), l2=hash(narration_script), segments=hash(segments)） |
| split 端点 `replace_chapter_segments` | 用户/前端重新拆分 | l2 + segments（l1 不动） |
| **generic `save_project`（PUT）** | 编辑段文本/改写稿 | **不碰 sync_state**（否则每次编辑都重置基线，脏检测失效） |

## 脏检测

```python
def sync_status(chapter) -> dict:
    st = chapter.sync_state or {}
    l1_dirty = bool(st.get("l1_hash")) and _h(chapter.original_text or "") != st["l1_hash"]
    l2_dirty = bool(st.get("l2_hash")) and _h(chapter.narration_script or "") != st["l2_hash"]
    l3_dirty = bool(st.get("segments_hash")) and _segs_h(chapter.segments) != st["segments_hash"]
    return {"l1_dirty": l1_dirty, "l2_dirty": l2_dirty, "l3_dirty": l3_dirty}
```

hash 未设置（旧章节 / 未拆分）-> 对应 dirty = False（无 badge）。

## 后端 API

```
GET /api/segmented-projects/{pid}/chapters/{cid}/sync-status
  -> { "l1_dirty": bool, "l2_dirty": bool, "l3_dirty": bool }
```

## 前端

章节头 3 个独立 badge（L1/L2/L3），仅对应 dirty 时显示（warning 色）。
点击 badge 暂无动作（Phase B 加 modal）。i18n zh-CN + en-US。

## 测试

- **Backend unit**：hash 稳定性；`sync_status` 各状态（一致/L1脏/L2脏/L3脏/全脏）；re-baseline 钩子（batch_create 写全 3、split 写 l2+segments、save_project 不碰）。
- **Backend API**：`GET /sync-status` 返回正确；未拆分章节全 false。
- **Frontend**：badge 仅 dirty 时出现；i18n。
- **E2E**（可选，Phase A 轻量）：split 后 badge 干净 -> 改一段文本 -> L3 badge 亮。

## 涉及文件

- `backend/app/models/segmented_project.py` - 加 `sync_state` 列
- `backend/app/core/database.py` - migration
- `backend/app/services/layer_sync_service.py`（新）- hash + sync_status + re-baseline
- `backend/app/services/segmented_project_service.py` - `batch_create_structure` 钩子
- `backend/app/api/segmented_projects.py` - split 端点钩子 + `GET /sync-status`
- `frontend/src/components/...` - 章节 badge
- `docs/api-reference.md` / `backend/tests/TEST_MAP.md`
