# Narration Layer Sync - Phase B（手动同步动作）

**Status**: Approved
**Created**: 2026-07-25
**Branch**: feat/narration-layer-sync（Phase A 之上）
**Parent**: `2026-07-25-narration-layer-sync-phase-a-design.md`

## 范围

Phase A 只检测+提示；Phase B 让用户**点按钮对齐** L2<->L3。按状态矩阵提供动作：

| l2_dirty | l3_dirty | 动作 |
|---|---|---|
| ✓ | ✗ | `resplit-from-script`（以 L2 重拆 segments） |
| ✗ | ✓ | `rewrite-script-from-segments`（以 L3 回写 L2，定位合并） |
| ✓ | ✓ | 两个按钮 + 冲突警告 |
| ✗ | ✗ | 无（badge 不亮） |

## 数据模型（加 segment 级 split_anchor）

`SegmentedProjectSegment` 加 1 列 `split_anchor` (JSON, nullable)：
```json
{ "offset_start": 123, "offset_end": 156, "baseline_text": "拆分时的段原文" }
```
migration P16。Phase A 的 `mark_split` 现在额外写每段的 split_anchor（按 position 顺序在 narration_script 里 `find` 定位 offset，baseline_text=当前 seg.text）。

## 后端

### `mark_split` 扩展
写 split_anchor：遍历 segments（按 position），在 `chapter.narration_script` 里从上一段 offset 起找 `seg.text`，记 offset_start/end + baseline_text。

### `POST /segmented-projects/{pid}/chapters/{cid}/resplit-from-script`
以当前 L2（`chapter.narration_script`）重新拆分：
1. `rule_split(narration_script, delimiters)` -> items。
2. 替换 chapter 的 segments（新 ID，丢弃旧 role/emotion/voice）。
3. `mark_split`（重基线 l2/segments + split_anchor）。
4. 返回新 chapter detail。
⚠ 前端先弹确认："将丢弃 N 段的 role/emotion/voice 配置"。

### `POST /segmented-projects/{pid}/chapters/{cid}/rewrite-script-from-segments`
定位合并回写 L2：
1. 前置：`sync_status(chapter).l2_dirty == false`，否则 **409** `l2_dirty_conflict`。
2. 从后往前按 `split_anchor.offset_*` 替换：`seg.text != baseline_text` 的段，把 L2[offset_start:offset_end] 换成 seg.text。
3. `chapter.narration_script = 新 L2`。
4. `mark_split`（重基线 + 重算 offset/baseline，因为长度变了）。
5. 返回新 narration_script。

边界（沿用设计 Open Questions 决策）：
- L3 不允许新增段（只允许拆现有段）-- 没有的 split_anchor 的段跳过。
- L3 不允许重排。
- 删除的段：L2 对应区域保留。

## 前端

章节头 dirty badge 可点击 -> 打开同步 modal：
- L2 单边脏：只显「以改写稿重新拆分（丢弃现有分段配置）」+ 二次确认。
- L3 单边脏：只显「以分段回写改写稿（定位合并）」。
- 冲突：两按钮并列 + 警告"另一侧改动将丢失"。
- 一致：modal 不打开（badge 不亮）。
i18n zh-CN + en-US。

## 测试

- **Backend unit**：`mark_split` 写 split_anchor（offset 正确、重复文本顺序定位）；`rewrite_script_from_segments` 定位合并（改一段回写、未改段不动、保留 L2 非段文本、L2 脏则 raise）；`resplit_from_script` 重拆+重基线。
- **Backend API**：resplit 端点返回新 segments、旧配置丢弃；rewrite 端点 l2_dirty 时 409、否则回写成功。
- **Frontend**：modal 按状态矩阵显示对应按钮；冲突警告。
- **E2E**（可选）：L3 脏 -> 点 badge -> 回写 -> badge 消失。

## 涉及文件

- `backend/app/models/segmented_project.py` - 加 `split_anchor` 列
- `backend/app/core/database.py` - migration P16
- `backend/app/services/layer_sync_service.py` - `mark_split` 扩展 + `rewrite_script_from_segments` + `resplit_from_script`
- `backend/app/api/segmented_projects.py` - 2 个端点
- `frontend/src/components/...` - 同步 modal
- `docs/api-reference.md` / `backend/tests/TEST_MAP.md`
