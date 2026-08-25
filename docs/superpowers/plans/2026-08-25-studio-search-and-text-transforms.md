# Studio 全项目搜索 + 合成时文本变换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 spec `docs/superpowers/specs/2026-08-25-studio-search-and-text-transforms-design.md`：Studio 全项目搜索（纯前端）、发音映射（全局+项目双层字典、段级引用、合成时替换）、全大写拉丁词转小写（项目默认 + 段级三态覆盖）。

**Architecture:** 文本变换是挂在 `prepare_text_for_engine` 之前的纯函数（`backend/app/services/text_transform_service.py`），local（`synthesize_segment`）与 workers（`synthesize_segment_workers`）两条合成路径共用；前端 `textTransforms.ts` 为其镜像（预览 + frontend 存储模式本地合成用）。搜索为纯前端 hook（数据已在内存），结果跳转靠 `data-segment-id` DOM 锚点 + 闪烁高亮。发音映射全局字典存 `system_configs`（key=`pronunciation_map_global`），项目字典存 `project.configs.pronunciation_map`，段级引用存新增 JSON 列 `segmented_project_segments.text_transforms`。

**Tech Stack:** FastAPI + SQLAlchemy + pytest（backend）；React 19 + TS + Vitest/RTL（frontend）；Playwright（e2e）。

## 关键设计决策（先于代码定死）

1. **大写词正则**：`(?<![A-Za-z0-9])[A-Z]{2,}(?![A-Za-z0-9])`。`I`（单字母）、`Http`（首字母大写）、`API2`（尾随数字）不动；`REST API 接口` → `rest api 接口`（CJK 与字母相邻处也算词边界，因为边界集合只含 ASCII 字母数字）。Python 与 JS 语义一致，两侧共用同一规则。
2. **workers 读全局字典**：`segmented_synth_workers.py` 新增模块级 `_load_global_map()`，内部调 `app.core.system_config_service.get_config(None, PRONUNCIATION_MAP_GLOBAL_KEY)`（该函数在 `deploy_target=workers` 时自动走 SupabaseSystemConfigRepository）；失败一律返回空表。测试用 `monkeypatch.setattr(w, "_load_global_map", ...)` 替换。
3. **effective_text**：两条合成路径都把「实际送引擎的最终文本」记入 `generated_params.effective_text`（local 写在 `effective` dict 里随 `update_segment_after_synth` 落库；workers 写进 `seg["generated_params"]`）。e2e 靠它做双读断言。
4. **段级引用清理**：删除被引用映射时，前端确认后逐段 dispatch `SET_SEGMENT_TEXT_TRANSFORMS` 清理 `applied_map_ids`（走常规自动保存）；后端合成对悬空 id 一律忽略（merged map 里查不到即不生效，天然防御）。
5. **workers 不补 `underscore_to_space`/`skip_parenthesized` 的 configs 读取**（现状缺陷，非本 spec 范围）；只新增本特性的 configs 读取。
6. **i18n**：zh-CN 是类型源（`frontend/src/i18n/index.tsx` `import type { Messages } from './zh-CN'`），每个前端任务新增的 key 必须 zh-CN/en-US 同步添加，否则 `missing-keys.test.ts` 会红。

## 文件结构

**Backend**

| 文件 | 责任 |
|---|---|
| `backend/app/services/text_transform_service.py`（新增） | 纯函数：`merge_maps` / `apply_pronunciation_map` / `lowercase_latin_words` / `resolve_lowercase_latin` / `apply_text_transforms`。无 ORM 依赖（workers bundle 可加载）。 |
| `backend/app/models/segmented_project.py` | segment 加 `text_transforms` JSON 列 |
| `backend/app/core/database.py` | `_P19_TEXT_TRANSFORMS_ALTER_STMTS` 并入 `_ALL_ALTER_STMTS` |
| `backend/app/schemas/segmented_project.py` | `SegmentIn` 加 `text_transforms` 透传字段 |
| `backend/app/services/segmented_project_service.py` | `project_to_detail` / `save_project` 透传；`synthesize_segment` 接入变换 + `effective_text` |
| `backend/app/services/segmented_synth_workers.py` | `_load_global_map` + `synthesize_segment_workers` 接入变换 + `effective_text`；`_to_project_in` 透传 |
| `backend/app/core/system_config_service.py` | `PRONUNCIATION_MAP_GLOBAL_KEY` 常量 |
| `backend/app/api/config.py` | `GET/PUT /config/pronunciation-map-global` |
| `backend/tests/unit/test_text_transform_service.py`（新增） | 纯函数单测 |
| `backend/tests/test_segmented_text_transforms.py`（新增） | 持久化往返 + local 合成管道测试 |
| `backend/tests/test_config_pronunciation_map_api.py`（新增） | 全局字典 API 测试 |
| `backend/tests/unit/test_segmented_synth_workers.py` | 追加 workers 变换测试 |

**Frontend**

| 文件 | 责任 |
|---|---|
| `frontend/src/types/index.ts` | `PronunciationMapEntry` / `SegmentTextTransforms` 类型；`Segment.text_transforms`；configs 三个新字段 |
| `frontend/src/services/textTransforms.ts`（新增） | 后端镜像纯函数（预览 + frontend 模式合成） |
| `frontend/src/hooks/useSegmentedProject.ts` | `enrichSegment` 透传；`SET_SEGMENT_TEXT_TRANSFORMS` action；`SET_PROJECT_META` 白名单扩展 |
| `frontend/src/hooks/useSegmentSearch.ts`（新增） | `searchSegments` / `findUppercaseSegments` / `useSegmentSearch` / `splitSnippet` |
| `frontend/src/components/SegmentedTTS/SegmentSearchBar.tsx`（+ `.module.css`） | 搜索框 + 结果面板 + 键盘导航 + 「含全大写词」过滤 + 段级小写三态 |
| `frontend/src/components/SegmentedTTS/SegmentList.tsx` | 透传 `flashId` / `pronunciationPreviews` / `onUpdateTextTransforms` |
| `frontend/src/components/SegmentedTTS/SegmentRow.tsx` | 三种布局根元素加 `data-segment-id`；flash 高亮类；🗣 badge |
| `frontend/src/components/SegmentedTTS/SegmentEditPanel.tsx` | 大写转小写三态开关 |
| `frontend/src/components/SegmentedTTS/PronunciationMapPanel.tsx`（+ `.module.css`） | 项目字典 CRUD + 全局只读展示 + 命中段勾选 + 替换预览 |
| `frontend/src/components/ProjectSettings/ProjectSettings.tsx` | `pronunciation_apply_all` / `lowercase_latin` 开关 |
| `frontend/src/components/Settings/PronunciationMapSetting.tsx`（+ `.module.css`） | `/settings` 全局字典编辑器 |
| `frontend/src/pages/ModelConfig.tsx` | 挂载 PronunciationMapSetting |
| `frontend/src/pages/TTSSynthesis.tsx` | 工具栏挂搜索框/映射面板入口；搜索结果跳转；全局字典 state；frontend 模式合成挂接 |
| `frontend/src/services/api.ts` | `configApi.getPronunciationMapGlobal` / `setPronunciationMapGlobal` |
| `frontend/src/i18n/zh-CN.ts` + `en-US.ts` | 新文案 |

**E2E / 文档**

| 文件 | 责任 |
|---|---|
| `tests/e2e/specs/studio-text-transforms.spec.ts`（新增） | 搜索跳转、发音映射、apply_all、大写转小写 |
| `docs/feature-spec.md` / `docs/api-reference.md` / `docs/database-schema.md` / `backend/tests/TEST_MAP.md` / `docs/e2e-test-guide.md` / `docs/deployment-feature-matrix.md` | 文档同步 |

---

## Task 1: 后端 text_transform_service 纯函数

**Files:**
- Create: `backend/app/services/text_transform_service.py`
- Test: `backend/tests/unit/test_text_transform_service.py`

- [x] **Step 1: Write the failing test**

创建 `backend/tests/unit/test_text_transform_service.py`：

```python
"""合成时文本变换纯函数单测（发音映射 + 大写转小写）。

前端镜像：frontend/src/services/textTransforms.ts —— 本文件的测试用例与
textTransforms.test.ts 一一对应，规则改动两侧必须同步。
"""
from app.services.text_transform_service import (
    apply_pronunciation_map,
    apply_text_transforms,
    lowercase_latin_words,
    merge_maps,
    resolve_lowercase_latin,
)


# ---- merge_maps ----

def test_merge_project_overrides_global_same_source():
    merged = merge_maps(
        [{"id": "gpm_1", "source": "调动", "target": "全球版"}],
        [{"id": "pm_1", "source": "调动", "target": "项目版"}],
    )
    assert merged == [{"id": "pm_1", "source": "调动", "target": "项目版"}]


def test_merge_keeps_distinct_entries():
    merged = merge_maps(
        [{"id": "gpm_1", "source": "调动", "target": "掉动"}],
        [{"id": "pm_1", "source": "行长", "target": "行长2"}],
    )
    assert {e["id"] for e in merged} == {"gpm_1", "pm_1"}


def test_merge_ignores_empty_source():
    assert merge_maps([{"id": "gpm_1", "source": "", "target": "x"}], None) == []


# ---- apply_pronunciation_map ----

def test_apply_longest_source_first():
    # 长度降序：长 source 优先，避免短词吃掉长词前缀
    entries = [
        {"id": "pm_1", "source": "调动", "target": "掉动"},
        {"id": "pm_2", "source": "调动工作", "target": "调度工作"},
    ]
    assert apply_pronunciation_map("调动工作要调动", entries) == "调度工作要掉动"


def test_apply_is_single_pass_not_recursive():
    entries = [{"id": "pm_1", "source": "a", "target": "aa"}]
    assert apply_pronunciation_map("a", entries) == "aa"  # 不会循环成 aaaa...


# ---- lowercase_latin_words ----

def test_lowercase_mixed_text():
    assert lowercase_latin_words("REST API 接口") == "rest api 接口"


def test_lowercase_skips_single_letter_and_titlecase():
    assert lowercase_latin_words("I think Http is OK") == "I think Http is ok"


def test_lowercase_skips_trailing_digit_identifiers():
    assert lowercase_latin_words("HTTP2 协议") == "HTTP2 协议"


# ---- resolve_lowercase_latin ----

def test_resolve_lowercase_segment_overrides_project():
    assert resolve_lowercase_latin(False, True) is False
    assert resolve_lowercase_latin(True, False) is True
    assert resolve_lowercase_latin(None, True) is True
    assert resolve_lowercase_latin(None, None) is False


# ---- apply_text_transforms ----

MAP = [
    {"id": "pm_a", "source": "调动", "target": "掉动"},
    {"id": "pm_b", "source": "队伍", "target": "团队"},
]


def test_apply_all_ignores_segment_selection():
    out = apply_text_transforms("他调动了队伍", merged_map=MAP, apply_all=True)
    assert out == "他掉动了团队"


def test_segment_selection_picks_subset():
    out = apply_text_transforms(
        "他调动了队伍", merged_map=MAP, applied_map_ids=["pm_a"],
    )
    assert out == "他掉动了队伍"


def test_dangling_map_id_ignored():
    out = apply_text_transforms(
        "他调动了队伍", merged_map=MAP, applied_map_ids=["pm_gone"],
    )
    assert out == "他调动了队伍"


def test_lowercase_applied_after_mapping():
    # 映射 target 中的全大写词也会被小写化（顺序：映射 → 小写）
    entries = [{"id": "pm_1", "source": "接口", "target": "API"}]
    out = apply_text_transforms(
        "这个接口", merged_map=entries, apply_all=True, lowercase_latin=True,
    )
    assert out == "这个api"


def test_empty_text_noop():
    assert apply_text_transforms("", merged_map=MAP, apply_all=True) == ""
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run --extra test pytest tests/unit/test_text_transform_service.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.text_transform_service'`

- [x] **Step 3: Write minimal implementation**

创建 `backend/app/services/text_transform_service.py`：

```python
"""合成时文本变换（发音映射 + 大写转小写）— 纯函数，无 ORM 依赖。

前端镜像：frontend/src/services/textTransforms.ts —— 修改任一侧的规则时
必须同步另一侧（两侧测试用例一一对应）。

只影响送给 TTS 引擎的文本；segment.text 原文、字幕、SRT 导出不受影响。
本模块被 workers bundle 引用（segmented_synth_workers），不得 import
sqlalchemy / app.models。
"""
from __future__ import annotations

import re
from typing import Any, Iterable

# 全大写拉丁词：至少 2 个连续大写字母，前后不紧邻 ASCII 字母/数字。
# 排除 I（单字母）、Http（首字母大写）、HTTP2（尾随数字标识符）。
# 与前端 UPPERCASE_WORD_RE 同规则。
_UPPERCASE_WORD_RE = re.compile(r"(?<![A-Za-z0-9])[A-Z]{2,}(?![A-Za-z0-9])")


def merge_maps(
    global_map: list[dict[str, Any]] | None,
    project_map: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """全局 ∪ 项目，以 source 为键；同 source 项目条目整体覆盖全局条目（含 id）。"""
    merged: dict[str, dict[str, Any]] = {}
    for entry in global_map or []:
        source = entry.get("source")
        if source:
            merged[source] = entry
    for entry in project_map or []:
        source = entry.get("source")
        if source:
            merged[source] = entry
    return list(merged.values())


def apply_pronunciation_map(text: str, entries: Iterable[dict[str, Any]]) -> str:
    """按 source 长度降序做单次全量替换（不递归：target 含 source 也不循环）。

    长度降序保证重叠 source（如「调动」与「调动工作」）行为确定。
    """
    ordered = sorted(entries, key=lambda e: len(e.get("source") or ""), reverse=True)
    for entry in ordered:
        source = entry.get("source") or ""
        if source:
            text = text.replace(source, entry.get("target") or "")
    return text


def lowercase_latin_words(text: str) -> str:
    """全大写拉丁词 [A-Z]{2,} 转小写（REST API 接口 → rest api 接口）。"""
    return _UPPERCASE_WORD_RE.sub(lambda m: m.group(0).lower(), text)


def resolve_lowercase_latin(
    segment_value: bool | None,
    project_value: bool | None,
) -> bool:
    """段级覆盖（非 None 优先）→ 项目默认 → False。"""
    if segment_value is not None:
        return bool(segment_value)
    return bool(project_value)


def apply_text_transforms(
    text: str,
    *,
    merged_map: list[dict[str, Any]],
    apply_all: bool = False,
    applied_map_ids: Iterable[str] | None = None,
    lowercase_latin: bool = False,
) -> str:
    """发音映射替换 → 大写词小写化（顺序固定，先于 prepare_text_for_engine）。

    - apply_all=True：整个生效字典对所有段生效（项目级无脑开关）。
    - 否则只应用段级 applied_map_ids 引用的条目；悬空 id（被覆盖/已删除）
      在 merged_map 里查不到，天然忽略。
    - 小写化在映射之后：映射 target 中的全大写词也会被小写化（预期行为）。
    """
    if not text:
        return text
    if apply_all:
        effective = list(merged_map)
    else:
        ids = set(applied_map_ids or [])
        effective = [e for e in merged_map if e.get("id") in ids]
    text = apply_pronunciation_map(text, effective)
    if lowercase_latin:
        text = lowercase_latin_words(text)
    return text
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run --extra test pytest tests/unit/test_text_transform_service.py -q`
Expected: PASS (14 tests)

- [x] **Step 5: Commit**

```bash
git add backend/app/services/text_transform_service.py backend/tests/unit/test_text_transform_service.py
git commit -m "feat(backend): add text_transform_service pure functions (pronunciation map + latin lowercase)"
```

---

## Task 2: 后端 segment.text_transforms 持久化透传

**Files:**
- Modify: `backend/app/models/segmented_project.py:122`
- Modify: `backend/app/core/database.py:198-216`
- Modify: `backend/app/schemas/segmented_project.py:10-23`
- Modify: `backend/app/services/segmented_project_service.py:198-211, 464-488`
- Modify: `backend/app/services/segmented_synth_workers.py:284-299`
- Test: `backend/tests/test_segmented_text_transforms.py`（新增，本任务先只放往返测试；Task 4 继续追加）

- [x] **Step 1: Write the failing test**

创建 `backend/tests/test_segmented_text_transforms.py`：

```python
"""合成时文本变换（发音映射 + 大写转小写）持久化与合成管道测试。

- segment.text_transforms 的 save/load 往返（schema → ORM → 序列化）
- local synthesize_segment 的变换行为见 Task 4 追加的用例
"""
import json
from unittest.mock import patch

from app.models.segmented_project import SegmentedProjectSegment
from app.schemas.segmented_project import ProjectIn
from app.services import segmented_project_service as svc


def _seed(db_session, tmp_path, monkeypatch, *, seg_text="你好",
          configs=None, text_transforms=None):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    project = ProjectIn(
        id="p1", name="T", schema_version=2,
        configs=configs,
        chapters=[{
            "id": "c1", "position": 0, "name": "第一章",
            "voice": {"engine": "edge_tts", "voice_id": "v1"},
            "split_config": {"delimiters": ["。"], "mode": "rule"},
            "segments": [{
                "id": "s1", "position": 0, "text": seg_text,
                "voice": {"source": "chapter"},
                **({"text_transforms": text_transforms}
                   if text_transforms is not None else {}),
            }],
        }],
    )
    svc.save_project(db_session, project)
    db_session.commit()


def test_text_transforms_save_load_roundtrip(db_session, tmp_path, monkeypatch):
    tt = {"applied_map_ids": ["pm_x1"], "lowercase_latin": True}
    _seed(db_session, tmp_path, monkeypatch, text_transforms=tt)

    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    assert seg.text_transforms == tt

    detail = svc.get_project_detail(db_session, "p1")
    assert detail.chapters[0].segments[0].text_transforms == tt


def test_text_transforms_absent_defaults_to_none(db_session, tmp_path, monkeypatch):
    _seed(db_session, tmp_path, monkeypatch)
    detail = svc.get_project_detail(db_session, "p1")
    assert detail.chapters[0].segments[0].text_transforms is None
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run --extra test pytest tests/test_segmented_text_transforms.py -q`
Expected: FAIL — `TypeError: SegmentIn.__init__() got an unexpected keyword argument 'text_transforms'`（或断言 None != dict）

- [x] **Step 3: Implement**

1. `backend/app/models/segmented_project.py` — 在 `split_anchor` 行（:122）后加：

```python
    text_transforms = Column(JSON, nullable=True)  # 合成时文本变换: {applied_map_ids, lowercase_latin}
```

2. `backend/app/core/database.py` — `_P18_PROJECT_LOGO_ALTER_STMTS` 之后加新组，并并入 `_ALL_ALTER_STMTS`：

```python
# P19: synthesis-time text transforms - segment-level applied map ids + lowercase override.
_P19_TEXT_TRANSFORMS_ALTER_STMTS = (
    "ALTER TABLE segmented_project_segments ADD COLUMN text_transforms JSON",
)
```

`_ALL_ALTER_STMTS` 尾部改为：

```python
    + _P16_SPLIT_ANCHOR_ALTER_STMTS + _P17_AUDIO_ADJUST_ALTER_STMTS
    + _P18_PROJECT_LOGO_ALTER_STMTS + _P19_TEXT_TRANSFORMS_ALTER_STMTS
)
```

3. `backend/app/schemas/segmented_project.py` — `SegmentIn` 在 `audio` 字段后加：

```python
    text_transforms: dict[str, Any] | None = None
```

4. `backend/app/services/segmented_project_service.py` —
   - `project_to_detail`（:199-211）的 `SegmentIn(...)` 构造中，`audio=...` 行后加：

```python
                text_transforms=getattr(s, "text_transforms", None),
```

   - `save_project`（:477-478 `generated_params` 块后）加：

```python
            if s_in.text_transforms is not None:
                setattr(seg, "text_transforms", s_in.text_transforms)
```

5. `backend/app/services/segmented_synth_workers.py` — `_to_project_in`（:285-298）的 `SegmentIn(...)` 构造中，`audio=s.get("audio"),` 行后加：

```python
                        text_transforms=s.get("text_transforms"),
```

- [x] **Step 4: Run tests**

Run: `cd backend && uv run --extra test pytest tests/test_segmented_text_transforms.py tests/test_migration_idempotency.py tests/integration/test_workers_segmented_api.py -q`
Expected: PASS（幂等迁移测试自动覆盖新 ALTER 组）

- [x] **Step 5: Commit**

```bash
git add backend/app/models/segmented_project.py backend/app/core/database.py backend/app/schemas/segmented_project.py backend/app/services/segmented_project_service.py backend/app/services/segmented_synth_workers.py backend/tests/test_segmented_text_transforms.py
git commit -m "feat(backend): persist segment text_transforms (column + schema + save/load passthrough)"
```

---

## Task 3: 后端全局发音字典 API

**Files:**
- Modify: `backend/app/core/system_config_service.py:80-85`
- Modify: `backend/app/api/config.py`（文件尾部追加）
- Test: `backend/tests/test_config_pronunciation_map_api.py`（新增）

- [x] **Step 1: Write the failing test**

创建 `backend/tests/test_config_pronunciation_map_api.py`：

```python
"""全局发音映射字典端点测试（GET/PUT /config/pronunciation-map-global）。"""


def _entry(id="gpm_a1b2c3", source="调动", target="掉动", note=None):
    e = {"id": id, "source": source, "target": target}
    if note:
        e["note"] = note
    return e


def test_get_default_empty(client):
    resp = client.get("/api/config/pronunciation-map-global")
    assert resp.status_code == 200
    assert resp.json() == {"entries": []}


def test_put_roundtrip(client):
    entries = [_entry(), _entry(id="gpm_x9y8z7", source="REST", target="rest", note="防逐字母")]
    resp = client.put("/api/config/pronunciation-map-global", json={"entries": entries})
    assert resp.status_code == 200
    assert resp.json() == {"entries": entries}

    got = client.get("/api/config/pronunciation-map-global")
    assert got.json() == {"entries": entries}


def test_put_empty_source_rejected(client):
    resp = client.put(
        "/api/config/pronunciation-map-global",
        json={"entries": [_entry(source="  ")]},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "pronunciation_source_empty"


def test_put_duplicate_source_rejected(client):
    resp = client.put(
        "/api/config/pronunciation-map-global",
        json={"entries": [_entry(), _entry(id="gpm_zzzzzz")]},  # 同 source
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "pronunciation_source_duplicate"


def test_put_replaces_previous(client):
    client.put("/api/config/pronunciation-map-global", json={"entries": [_entry()]})
    client.put("/api/config/pronunciation-map-global", json={"entries": []})
    assert client.get("/api/config/pronunciation-map-global").json() == {"entries": []}
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run --extra test pytest tests/test_config_pronunciation_map_api.py -q`
Expected: FAIL — 404（路由不存在）

- [x] **Step 3: Implement**

1. `backend/app/core/system_config_service.py` — 在 `NARRATION_GIT_REMOTE_KEY`（:85）后加：

```python
PRONUNCIATION_MAP_GLOBAL_KEY = "pronunciation_map_global"
```

2. `backend/app/api/config.py` — 顶部加 `import json`；import 清单中加入 `PRONUNCIATION_MAP_GLOBAL_KEY`；文件尾部追加：

```python
# ---------------------------------------------------------------------------
# 全局发音映射字典（合成时文本替换，所有项目共享；项目字典存 project.configs）
# ---------------------------------------------------------------------------

class PronunciationMapEntryIn(BaseModel):
    id: str           # 全局条目 gpm_ 前缀（项目条目 pm_ 前缀，两层 id 不冲突）
    source: str
    target: str
    note: Optional[str] = None


class PronunciationMapGlobalRequest(BaseModel):
    entries: List[PronunciationMapEntryIn]


def _validate_pronunciation_entries(entries: List[PronunciationMapEntryIn]) -> str | None:
    """校验：source 去空白后非空，且同一字典内唯一。返回错误码或 None。"""
    seen: set[str] = set()
    for e in entries:
        source = e.source.strip()
        if not source:
            return "pronunciation_source_empty"
        if source in seen:
            return "pronunciation_source_duplicate"
        seen.add(source)
    return None


@router.get("/pronunciation-map-global")
async def get_pronunciation_map_global_endpoint(
    repo: SystemConfigRepository = Depends(get_system_config_repo),
):
    """读取全局发音映射字典（system_configs 里 JSON 数组字符串）。"""
    raw = repo.get(PRONUNCIATION_MAP_GLOBAL_KEY).strip()
    entries = json.loads(raw) if raw else []
    return {"entries": entries}


@router.put("/pronunciation-map-global")
async def set_pronunciation_map_global_endpoint(
    data: PronunciationMapGlobalRequest,
    repo: SystemConfigRepository = Depends(get_system_config_repo),
):
    """全量替换全局发音映射字典。改动对所有项目生效（前端保存前提示）。"""
    error = _validate_pronunciation_entries(data.entries)
    if error:
        raise HTTPException(status_code=400, detail=error)
    entries = [e.model_dump(exclude_none=True) for e in data.entries]
    repo.set(PRONUNCIATION_MAP_GLOBAL_KEY, json.dumps(entries, ensure_ascii=False))
    return {"entries": entries}
```

- [x] **Step 4: Run tests**

Run: `cd backend && uv run --extra test pytest tests/test_config_pronunciation_map_api.py tests/test_config_animation_root_api.py -q`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add backend/app/core/system_config_service.py backend/app/api/config.py backend/tests/test_config_pronunciation_map_api.py
git commit -m "feat(backend): global pronunciation map config endpoints"
```

---

## Task 4: local 合成管道接入（synthesize_segment）

**Files:**
- Modify: `backend/app/services/segmented_project_service.py:36-42`（import 区）、`:824-850`（文本清洗段）
- Test: `backend/tests/test_segmented_text_transforms.py`（追加）

- [x] **Step 1: Write the failing tests**

在 `backend/tests/test_segmented_text_transforms.py` 追加（文件头部 import 区补 `from app.core.system_config_service import PRONUNCIATION_MAP_GLOBAL_KEY, set_config`）：

```python
def _capture_synth_text(db_session, tmp_path, monkeypatch, *, seg_text,
                        configs=None, text_transforms=None, global_map=None):
    """seed + patch 引擎，返回实际送给引擎的文本。"""
    _seed(db_session, tmp_path, monkeypatch, seg_text=seg_text, configs=configs,
          text_transforms=text_transforms)
    if global_map is not None:
        set_config(db_session, PRONUNCIATION_MAP_GLOBAL_KEY,
                   json.dumps(global_map, ensure_ascii=False))
        db_session.commit()

    captured: dict = {}

    def fake_synth(text, p, db=None):
        captured["text"] = text
        return b"RIFF\x00\x00\x00\x00WAVEfmt ", "wav"

    with patch("app.services.segmented_project_service.is_ffmpeg_available", return_value=False), patch(
        "app.services.segmented_project_service.synthesize_with_engine",
        side_effect=fake_synth,
    ):
        svc.synthesize_segment(db_session, "p1", "c1", "s1")
    return captured


def test_synth_project_map_apply_all(db_session, tmp_path, monkeypatch):
    captured = _capture_synth_text(
        db_session, tmp_path, monkeypatch, seg_text="他调动了队伍",
        configs={
            "pronunciation_map": [{"id": "pm_1", "source": "调动", "target": "掉动"}],
            "pronunciation_apply_all": True,
        },
    )
    assert captured["text"] == "他掉动了队伍"


def test_synth_segment_applied_ids_select_subset(db_session, tmp_path, monkeypatch):
    captured = _capture_synth_text(
        db_session, tmp_path, monkeypatch, seg_text="他调动了队伍",
        configs={"pronunciation_map": [
            {"id": "pm_a", "source": "调动", "target": "掉动"},
            {"id": "pm_b", "source": "队伍", "target": "团队"},
        ]},
        text_transforms={"applied_map_ids": ["pm_a"]},
    )
    assert captured["text"] == "他掉动了队伍"


def test_synth_dangling_map_id_ignored(db_session, tmp_path, monkeypatch):
    captured = _capture_synth_text(
        db_session, tmp_path, monkeypatch, seg_text="他调动了队伍",
        configs={"pronunciation_map": [{"id": "pm_a", "source": "调动", "target": "掉动"}]},
        text_transforms={"applied_map_ids": ["pm_gone"]},
    )
    assert captured["text"] == "他调动了队伍"


def test_synth_project_map_overrides_global(db_session, tmp_path, monkeypatch):
    # 同 source 项目条目覆盖全局条目（含 id）：apply_all 用项目 target
    captured = _capture_synth_text(
        db_session, tmp_path, monkeypatch, seg_text="他调动了队伍",
        configs={
            "pronunciation_map": [{"id": "pm_1", "source": "调动", "target": "项目版"}],
            "pronunciation_apply_all": True,
        },
        global_map=[{"id": "gpm_1", "source": "调动", "target": "全球版"}],
    )
    assert captured["text"] == "他项目版了队伍"


def test_synth_overridden_global_id_becomes_dangling(db_session, tmp_path, monkeypatch):
    # 段引用了被项目条目覆盖的全局 id → 悬空，合成忽略
    captured = _capture_synth_text(
        db_session, tmp_path, monkeypatch, seg_text="他调动了队伍",
        configs={"pronunciation_map": [{"id": "pm_1", "source": "调动", "target": "项目版"}]},
        text_transforms={"applied_map_ids": ["gpm_1"]},
        global_map=[{"id": "gpm_1", "source": "调动", "target": "全球版"}],
    )
    assert captured["text"] == "他调动了队伍"


def test_synth_global_map_via_segment_ids(db_session, tmp_path, monkeypatch):
    captured = _capture_synth_text(
        db_session, tmp_path, monkeypatch, seg_text="他调动了队伍",
        text_transforms={"applied_map_ids": ["gpm_1"]},
        global_map=[{"id": "gpm_1", "source": "调动", "target": "掉动"}],
    )
    assert captured["text"] == "他掉动了队伍"


def test_synth_lowercase_latin_project_default(db_session, tmp_path, monkeypatch):
    captured = _capture_synth_text(
        db_session, tmp_path, monkeypatch, seg_text="使用 REST API 接口",
        configs={"lowercase_latin": True},
    )
    assert captured["text"] == "使用 rest api 接口"


def test_synth_lowercase_latin_segment_override_off(db_session, tmp_path, monkeypatch):
    captured = _capture_synth_text(
        db_session, tmp_path, monkeypatch, seg_text="使用 REST API 接口",
        configs={"lowercase_latin": True},
        text_transforms={"lowercase_latin": False},
    )
    assert captured["text"] == "使用 REST API 接口"


def test_synth_lowercase_latin_segment_override_on(db_session, tmp_path, monkeypatch):
    captured = _capture_synth_text(
        db_session, tmp_path, monkeypatch, seg_text="使用 REST API 接口",
        text_transforms={"lowercase_latin": True},
    )
    assert captured["text"] == "使用 rest api 接口"


def test_synth_transforms_run_before_engine_cleaning(db_session, tmp_path, monkeypatch):
    # 顺序：映射替换先于 prepare_text_for_engine —— target 里的下划线仍被
    # underscore_to_space 处理
    captured = _capture_synth_text(
        db_session, tmp_path, monkeypatch, seg_text="调动",
        configs={
            "pronunciation_map": [{"id": "pm_1", "source": "调动", "target": "调_动"}],
            "pronunciation_apply_all": True,
            "underscore_to_space": True,
        },
    )
    assert captured["text"] == "调 动"


def test_synth_effective_text_recorded(db_session, tmp_path, monkeypatch):
    captured = _capture_synth_text(
        db_session, tmp_path, monkeypatch, seg_text="他调动了队伍",
        configs={
            "pronunciation_map": [{"id": "pm_1", "source": "调动", "target": "掉动"}],
            "pronunciation_apply_all": True,
        },
    )
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    assert seg.generated_params["effective_text"] == captured["text"]
    # 原文不变（显示/字幕/SRT 不受影响）
    assert seg.text == "他调动了队伍"
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run --extra test pytest tests/test_segmented_text_transforms.py -q`
Expected: 新用例 FAIL（文本未变换、generated_params 无 effective_text）；Task 2 的两个往返用例仍 PASS

- [x] **Step 3: Implement**

`backend/app/services/segmented_project_service.py`：

1. import 区（:34 附近）加：

```python
from app.core.system_config_service import (
    PRONUNCIATION_MAP_GLOBAL_KEY,
    get_config,
)
from app.services.text_transform_service import (
    apply_text_transforms,
    merge_maps,
    resolve_lowercase_latin,
)
```

2. `_merge_params`（:680）之前加模块级 helper：

```python
def _load_global_pronunciation_map(db: Session) -> list[dict[str, Any]]:
    """读取全局发音字典（system_configs.pronunciation_map_global，JSON 数组字符串）。

    读取/解析失败一律返回空表（防御性：合成不能因字典损坏而失败）。
    """
    try:
        raw = get_config(db, PRONUNCIATION_MAP_GLOBAL_KEY, default="[]")
        data = json.loads(raw) if raw else []
        if not isinstance(data, list):
            return []
        return [e for e in data if isinstance(e, dict)]
    except Exception:  # noqa: BLE001
        logger.warning("[synthesize_segment] global pronunciation map unreadable; ignored")
        return []
```

3. `synthesize_segment` 中，在 `project_configs = ...`（:838-840）块之后、`text_to_speak = prepare_text_for_engine(`（:841）之前插入：

```python
    # 合成时文本变换（发音映射 + 大写转小写）：只改送引擎文本，不改原文。
    # 生效字典 = 全局 ∪ 项目（同 source 项目覆盖）；段级 applied_map_ids 选子集，
    # 项目级 configs.pronunciation_apply_all 开启则全量生效；小写化解析顺序：
    # 段级覆盖（非 None 优先）→ configs.lowercase_latin → False。
    tt = seg.text_transforms if isinstance(getattr(seg, "text_transforms", None), dict) else {}
    project_map = project_configs.get("pronunciation_map")
    text_to_speak = apply_text_transforms(
        text_to_speak,
        merged_map=merge_maps(
            _load_global_pronunciation_map(db),
            project_map if isinstance(project_map, list) else [],
        ),
        apply_all=bool(project_configs.get("pronunciation_apply_all")),
        applied_map_ids=tt.get("applied_map_ids"),
        lowercase_latin=resolve_lowercase_latin(
            tt.get("lowercase_latin"), project_configs.get("lowercase_latin"),
        ),
    )
```

4. 同函数中，`prepare_text_for_engine(...)` 调用块结束（:850）之后加：

```python
    effective["effective_text"] = text_to_speak  # 实际合成文本（可追溯；e2e 双读断言用）
```

（`sp = SynthesizeParams(**effective)` 在 :821 已构造，此处后加 key 不影响 sp；`effective` 在 :984 作为 `generated_params` 落库。）

- [x] **Step 4: Run tests**

Run: `cd backend && uv run --extra test pytest tests/test_segmented_text_transforms.py tests/test_segmented_synthesis.py -q`
Expected: PASS（旧合成测试全绿 = 无回归）

- [x] **Step 5: Commit**

```bash
git add backend/app/services/segmented_project_service.py backend/tests/test_segmented_text_transforms.py
git commit -m "feat(backend): apply text transforms in local synthesize_segment + record effective_text"
```

---

## Task 5: workers 合成管道接入（synthesize_segment_workers）

**Files:**
- Modify: `backend/app/services/segmented_synth_workers.py:13-23`（import 区）、`:124-142`（文本构造段）、`:179`（generated_params）
- Test: `backend/tests/unit/test_segmented_synth_workers.py`（追加）

- [x] **Step 1: Write the failing tests**

在 `backend/tests/unit/test_segmented_synth_workers.py` 追加：

```python
def _capture_edge_text(monkeypatch):
    """patch edge-tts 合成，返回 captured dict（合成后读 captured["text"]）。"""
    captured: dict = {}

    def _synth_internal(**kwargs):
        captured["text"] = kwargs["text"]
        return b"MP3BYTES", "mp3"

    monkeypatch.setattr("app.api.tts.synthesize_speech_internal", _synth_internal)
    return captured


@pytest.mark.asyncio
async def test_synthesize_applies_transforms_apply_all(monkeypatch):
    project = _project()
    project["configs"] = {
        "pronunciation_map": [{"id": "pm_1", "source": "调动", "target": "掉动"}],
        "pronunciation_apply_all": True,
        "lowercase_latin": True,
    }
    project["chapters"][0]["segments"][0]["text"] = "调动 REST API"
    repo = _repo(project)
    store = _store()
    captured = _capture_edge_text(monkeypatch)
    monkeypatch.setattr(w, "_load_global_map", lambda: [])

    await w.synthesize_segment_workers(
        repo, store,
        project_id="p1", chapter_id="c1", segment_id="s1",
        request_params=None, text_override=None, ssml_override=None,
        keep_previous=True, force=False,
    )

    assert captured["text"] == "掉动 rest api"
    saved = repo.save_project.call_args.args[0]
    seg = saved.chapters[0].segments[0]
    assert seg.generated_params["effective_text"] == "掉动 rest api"


@pytest.mark.asyncio
async def test_synthesize_applies_global_map_via_segment_ids(monkeypatch):
    project = _project()  # seg text = "第一段"
    project["chapters"][0]["segments"][0]["text_transforms"] = {
        "applied_map_ids": ["gpm_1"],
    }
    repo = _repo(project)
    store = _store()
    captured = _capture_edge_text(monkeypatch)
    monkeypatch.setattr(
        w, "_load_global_map",
        lambda: [{"id": "gpm_1", "source": "第一段", "target": "开篇"}],
    )

    await w.synthesize_segment_workers(
        repo, store,
        project_id="p1", chapter_id="c1", segment_id="s1",
        request_params=None, text_override=None, ssml_override=None,
        keep_previous=True, force=False,
    )

    assert captured["text"] == "开篇"


@pytest.mark.asyncio
async def test_synthesize_workers_preserves_text_transforms_on_save(monkeypatch):
    """text_transforms 随 workers 全量写回透传（_to_project_in → SegmentIn）。"""
    project = _project()
    tt = {"applied_map_ids": ["pm_x"], "lowercase_latin": False}
    project["chapters"][0]["segments"][0]["text_transforms"] = tt
    repo = _repo(project)
    store = _store()
    _capture_edge_text(monkeypatch)
    monkeypatch.setattr(w, "_load_global_map", lambda: [])

    await w.synthesize_segment_workers(
        repo, store,
        project_id="p1", chapter_id="c1", segment_id="s1",
        request_params=None, text_override=None, ssml_override=None,
        keep_previous=True, force=False,
    )

    saved = repo.save_project.call_args.args[0]
    assert saved.chapters[0].segments[0].text_transforms == tt
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run --extra test pytest tests/unit/test_segmented_synth_workers.py -q`
Expected: 3 个新用例 FAIL（`_load_global_map` 不存在 / 文本未变换）

- [x] **Step 3: Implement**

`backend/app/services/segmented_synth_workers.py`：

1. import 区加：

```python
import json

from app.core.system_config_service import (
    PRONUNCIATION_MAP_GLOBAL_KEY,
    get_config,
)
from app.services.text_transform_service import (
    apply_text_transforms,
    merge_maps,
    resolve_lowercase_latin,
)
```

2. `_audio_key` 之后加：

```python
def _load_global_map() -> list[dict[str, Any]]:
    """读取全局发音字典（workers 模式经 Supabase system_configs；local 测试可
    monkeypatch 本函数）。读取/解析失败一律返回空表。"""
    try:
        raw = get_config(None, PRONUNCIATION_MAP_GLOBAL_KEY, default="[]")
        data = json.loads(raw) if raw else []
        if not isinstance(data, list):
            return []
        return [e for e in data if isinstance(e, dict)]
    except Exception:  # noqa: BLE001
        logger.warning("[workers] global pronunciation map unreadable; ignored")
        return []
```

3. `synthesize_segment_workers` 中，`text_to_speak = text_override or seg.get("text") or ""`（:131）之后、`prepare_text_for_engine(`（:132）之前插入：

```python
    # 合成时文本变换（与 svc 同规则）：发音映射 + 大写转小写，只改送引擎文本
    project_configs = project.get("configs") if isinstance(project.get("configs"), dict) else {}
    tt = seg.get("text_transforms") if isinstance(seg.get("text_transforms"), dict) else {}
    project_map = project_configs.get("pronunciation_map")
    text_to_speak = apply_text_transforms(
        text_to_speak,
        merged_map=merge_maps(
            _load_global_map(),
            project_map if isinstance(project_map, list) else [],
        ),
        apply_all=bool(project_configs.get("pronunciation_apply_all")),
        applied_map_ids=tt.get("applied_map_ids"),
        lowercase_latin=resolve_lowercase_latin(
            tt.get("lowercase_latin"), project_configs.get("lowercase_latin"),
        ),
    )
```

4. `if ssml_override:` 块（:141-142）之后加：

```python
    effective["effective_text"] = text_to_speak  # 实际合成文本（随 generated_params 写回）
```

- [x] **Step 4: Run tests**

Run: `cd backend && uv run --extra test pytest tests/unit/test_segmented_synth_workers.py -q`
Expected: PASS（含既有 7 个用例无回归）

- [x] **Step 5: Commit**

```bash
git add backend/app/services/segmented_synth_workers.py backend/tests/unit/test_segmented_synth_workers.py
git commit -m "feat(backend): apply text transforms in workers synthesis path + effective_text"
```

---

## Task 6: 前端 types + textTransforms.ts 镜像

**Files:**
- Modify: `frontend/src/types/index.ts:471-518`（Segment）、`:578-590`（configs）
- Create: `frontend/src/services/textTransforms.ts`
- Test: `frontend/src/services/textTransforms.test.ts`

- [x] **Step 1: Write the failing test**

创建 `frontend/src/services/textTransforms.test.ts`（用例与后端 `test_text_transform_service.py` 一一对应，作为两侧同步的共享夹具）：

```ts
import { describe, expect, it } from 'vitest';
import {
  applyPronunciationMap,
  applyTextTransforms,
  lowercaseLatinWords,
  mergePronunciationMaps,
  resolveLowercaseLatin,
  resolveSegmentEngineText,
} from './textTransforms';

const MAP = [
  { id: 'pm_a', source: '调动', target: '掉动' },
  { id: 'pm_b', source: '队伍', target: '团队' },
];

describe('mergePronunciationMaps', () => {
  it('project entry overrides global entry with same source (including id)', () => {
    expect(mergePronunciationMaps(
      [{ id: 'gpm_1', source: '调动', target: '全球版' }],
      [{ id: 'pm_1', source: '调动', target: '项目版' }],
    )).toEqual([{ id: 'pm_1', source: '调动', target: '项目版' }]);
  });

  it('keeps distinct entries', () => {
    const merged = mergePronunciationMaps(
      [{ id: 'gpm_1', source: '调动', target: '掉动' }],
      [{ id: 'pm_1', source: '行长', target: '行长2' }],
    );
    expect(merged.map(e => e.id).sort()).toEqual(['gpm_1', 'pm_1']);
  });
});

describe('applyPronunciationMap', () => {
  it('applies longest source first', () => {
    expect(applyPronunciationMap('调动工作要调动', [
      { id: 'pm_1', source: '调动', target: '掉动' },
      { id: 'pm_2', source: '调动工作', target: '调度工作' },
    ])).toBe('调度工作要掉动');
  });

  it('is single-pass, not recursive', () => {
    expect(applyPronunciationMap('a', [{ id: 'pm_1', source: 'a', target: 'aa' }])).toBe('aa');
  });
});

describe('lowercaseLatinWords', () => {
  it('lowercase ALL-CAPS latin words in mixed text', () => {
    expect(lowercaseLatinWords('REST API 接口')).toBe('rest api 接口');
  });
  it('skips single letter and TitleCase words', () => {
    expect(lowercaseLatinWords('I think Http is OK')).toBe('I think Http is ok');
  });
  it('skips identifiers with trailing digits', () => {
    expect(lowercaseLatinWords('HTTP2 协议')).toBe('HTTP2 协议');
  });
});

describe('resolveLowercaseLatin', () => {
  it('segment override wins; falls back to project then false', () => {
    expect(resolveLowercaseLatin(false, true)).toBe(false);
    expect(resolveLowercaseLatin(true, false)).toBe(true);
    expect(resolveLowercaseLatin(null, true)).toBe(true);
    expect(resolveLowercaseLatin(null, null)).toBe(false);
  });
});

describe('applyTextTransforms', () => {
  it('applyAll ignores segment selection', () => {
    expect(applyTextTransforms('他调动了队伍', { mergedMap: MAP, applyAll: true }))
      .toBe('他掉动了团队');
  });
  it('segment selection picks subset', () => {
    expect(applyTextTransforms('他调动了队伍', { mergedMap: MAP, appliedMapIds: ['pm_a'] }))
      .toBe('他掉动了队伍');
  });
  it('dangling map id ignored', () => {
    expect(applyTextTransforms('他调动了队伍', { mergedMap: MAP, appliedMapIds: ['pm_gone'] }))
      .toBe('他调动了队伍');
  });
  it('lowercase runs after mapping (target uppercase words lowercased too)', () => {
    expect(applyTextTransforms('这个接口', {
      mergedMap: [{ id: 'pm_1', source: '接口', target: 'API' }],
      applyAll: true,
      lowercaseLatin: true,
    })).toBe('这个api');
  });
});

describe('resolveSegmentEngineText', () => {
  it('combines global + project + segment rules', () => {
    expect(resolveSegmentEngineText('他调动了 REST API', {
      globalMap: [{ id: 'gpm_1', source: '调动', target: '掉动' }],
      projectMap: [],
      applyAll: true,
      segmentTransforms: { lowercase_latin: true },
    })).toBe('他掉动了 rest api');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/services/textTransforms.test.ts`
Expected: FAIL（模块不存在）

- [x] **Step 3: Implement**

1. `frontend/src/types/index.ts` — `Segment` 接口前（:470 附近）加类型：

```ts
/** 发音映射条目：全局字典（gpm_ 前缀 id）与项目字典（pm_ 前缀 id）同构 */
export interface PronunciationMapEntry {
  id: string;
  source: string;
  target: string;
  note?: string;
}

/** 段级合成文本变换记录（只存 id 引用，不存替换内容副本） */
export interface SegmentTextTransforms {
  /** 对该段生效的发音映射 id 列表（可跨全局/项目两层引用） */
  applied_map_ids?: string[];
  /** 大写词转小写：true/false 覆盖项目默认，null/缺省 = 跟随项目 */
  lowercase_latin?: boolean | null;
}
```

`Segment`（:471）在 `animation_spec` 字段后加：

```ts
  /** 合成时文本变换（发音映射段级引用 + 小写化覆盖）；不影响原文/字幕 */
  text_transforms?: SegmentTextTransforms | null;
```

`configs`（:578-590）在 `skip_parenthesized` 声明后加：

```ts
    /** 项目级发音映射字典（与全局字典合并，同 source 项目覆盖全局） */
    pronunciation_map?: PronunciationMapEntry[] | null;
    /** 无脑全局生效：整个生效字典对本项目所有段生效，无需逐段勾选 */
    pronunciation_apply_all?: boolean | null;
    /** 项目级默认：全大写拉丁词转小写（段级 text_transforms.lowercase_latin 可覆盖） */
    lowercase_latin?: boolean | null;
```

2. 创建 `frontend/src/services/textTransforms.ts`：

```ts
/**
 * 合成时文本变换（发音映射 + 大写转小写）。
 *
 * 与后端 backend/app/services/text_transform_service.py 互为镜像——
 * 修改任一侧的规则时必须同步另一侧（两侧测试用例一一对应）。
 *
 * 前端用途：映射面板/搜索结果里的「替换后效果」预览，以及 frontend 存储
 * 模式下本地合成前的文本变换；backend 存储模式由后端合成管道执行。
 * 原文（segment.text）、字幕、SRT 导出一律不受影响。
 */
import type { PronunciationMapEntry, SegmentTextTransforms } from '../types';

/**
 * 全大写拉丁词：至少 2 个连续大写字母，前后不紧邻 ASCII 字母/数字。
 * （排除 I、Http、HTTP2。）与后端 _UPPERCASE_WORD_RE 同规则。
 * 非 global 实例：需要全局匹配时用 new RegExp(UPPERCASE_WORD_RE.source, 'g')
 * 重建，避免共享正则的 lastIndex 状态污染。
 */
export const UPPERCASE_WORD_RE = /(?<![A-Za-z0-9])[A-Z]{2,}(?![A-Za-z0-9])/;

/** 全局 ∪ 项目，以 source 为键；同 source 项目条目整体覆盖全局条目（含 id）。 */
export function mergePronunciationMaps(
  globalMap: PronunciationMapEntry[] | null | undefined,
  projectMap: PronunciationMapEntry[] | null | undefined,
): PronunciationMapEntry[] {
  const merged = new Map<string, PronunciationMapEntry>();
  for (const e of globalMap ?? []) if (e.source) merged.set(e.source, e);
  for (const e of projectMap ?? []) if (e.source) merged.set(e.source, e);
  return [...merged.values()];
}

/** 按 source 长度降序单次全量替换（不递归：target 含 source 也不循环）。 */
export function applyPronunciationMap(text: string, entries: PronunciationMapEntry[]): string {
  const ordered = [...entries].sort((a, b) => (b.source?.length ?? 0) - (a.source?.length ?? 0));
  let out = text;
  for (const e of ordered) {
    if (e.source) out = out.split(e.source).join(e.target ?? '');
  }
  return out;
}

/** 全大写拉丁词 [A-Z]{2,} 转小写（REST API 接口 → rest api 接口）。 */
export function lowercaseLatinWords(text: string): string {
  return text.replace(new RegExp(UPPERCASE_WORD_RE.source, 'g'), (m) => m.toLowerCase());
}

/** 段级覆盖（非 null 优先）→ 项目默认 → false。 */
export function resolveLowercaseLatin(
  segmentValue: boolean | null | undefined,
  projectValue: boolean | null | undefined,
): boolean {
  if (segmentValue !== null && segmentValue !== undefined) return Boolean(segmentValue);
  return Boolean(projectValue);
}

export interface ApplyTextTransformsOptions {
  mergedMap: PronunciationMapEntry[];
  applyAll?: boolean;
  appliedMapIds?: string[] | null;
  lowercaseLatin?: boolean;
}

/** 发音映射替换 → 大写词小写化（顺序固定，先于引擎文本清洗）。 */
export function applyTextTransforms(text: string, opts: ApplyTextTransformsOptions): string {
  if (!text) return text;
  const effective = opts.applyAll
    ? opts.mergedMap
    : opts.mergedMap.filter(e => (opts.appliedMapIds ?? []).includes(e.id));
  let out = applyPronunciationMap(text, effective);
  if (opts.lowercaseLatin) out = lowercaseLatinWords(out);
  return out;
}

/** 段级「送引擎文本」统一入口（映射面板预览 + frontend 存储模式合成共用）。 */
export function resolveSegmentEngineText(
  text: string,
  opts: {
    globalMap?: PronunciationMapEntry[] | null;
    projectMap?: PronunciationMapEntry[] | null;
    applyAll?: boolean | null;
    segmentTransforms?: SegmentTextTransforms | null;
    projectLowercaseLatin?: boolean | null;
  },
): string {
  return applyTextTransforms(text, {
    mergedMap: mergePronunciationMaps(opts.globalMap, opts.projectMap),
    applyAll: Boolean(opts.applyAll),
    appliedMapIds: opts.segmentTransforms?.applied_map_ids ?? null,
    lowercaseLatin: resolveLowercaseLatin(
      opts.segmentTransforms?.lowercase_latin ?? null,
      opts.projectLowercaseLatin ?? null,
    ),
  });
}
```

- [x] **Step 4: Run tests**

Run: `cd frontend && npx vitest run src/services/textTransforms.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/textTransforms.ts frontend/src/services/textTransforms.test.ts
git commit -m "feat(frontend): textTransforms mirror module + pronunciation/transform types"
```

---

## Task 7: 前端 reducer / enrichSegment / SET_PROJECT_META 接线

**Files:**
- Modify: `frontend/src/hooks/useSegmentedProject.ts:54-88`（enrichSegment）、`:180-229`（Action 联合）、`:183 + 305-319`（SET_PROJECT_META）、`:287-770`（reducer 末尾新 case）
- Test: `frontend/src/hooks/useSegmentedProject.test.ts`（追加）

- [x] **Step 1: Write the failing tests**

在 `frontend/src/hooks/useSegmentedProject.test.ts` 追加（若文件已有 `import` 则复用；所需导入：`segmentedReducer, createInitialProject, migrateV1, type State`，`type { Chapter, SegmentedProject }` from '../types'）：

```ts
// ===== 合成时文本变换：text_transforms / configs =====

function projectWithTwoChapters(): SegmentedProject {
  const voice = { engine: 'edge_tts' as const, voice: '', rate: '+0%', volume: '+0%' };
  return {
    schema_version: 2, id: 'p', name: 'P', layout: 'vertical',
    active_chapter_id: 'c1', created_at: 'x', updated_at: 'x',
    chapters: [
      { id: 'c1', name: '一', voice, segments: [], split_config: { delimiters: ['。'], mode: 'rule' }, created_at: 'x', updated_at: 'x' },
      { id: 'c2', name: '二', voice, split_config: { delimiters: ['。'], mode: 'rule' }, created_at: 'x', updated_at: 'x',
        segments: [{ id: 's2', text: 'hi', voice: { source: 'chapter' }, status: 'idle', audio: { format: 'mp3' }, segment_kind: 'narration', created_at: 'x', updated_at: 'x' }] },
    ],
  };
}

describe('SET_SEGMENT_TEXT_TRANSFORMS', () => {
  it('writes transforms on a segment in a NON-active chapter (updateSegmentById)', () => {
    const project = projectWithTwoChapters();  // active = c1，目标段在 c2
    const state = segmentedReducer({ project }, {
      type: 'SET_SEGMENT_TEXT_TRANSFORMS', id: 's2',
      transforms: { applied_map_ids: ['pm_a'], lowercase_latin: false },
    });
    const seg = state.project.chapters[1].segments[0];
    expect(seg.text_transforms).toEqual({ applied_map_ids: ['pm_a'], lowercase_latin: false });
    // bump updated_at 触发自动保存
    expect(state.project.updated_at).not.toBe('x');
  });

  it('merges with existing transforms (caller spreads; reducer stores as-is)', () => {
    const project = projectWithTwoChapters();
    project.chapters[1].segments[0].text_transforms = { applied_map_ids: ['pm_a'] };
    const prev = project.chapters[1].segments[0].text_transforms!;
    const state = segmentedReducer({ project }, {
      type: 'SET_SEGMENT_TEXT_TRANSFORMS', id: 's2',
      transforms: { ...prev, lowercase_latin: true },
    });
    expect(state.project.chapters[1].segments[0].text_transforms)
      .toEqual({ applied_map_ids: ['pm_a'], lowercase_latin: true });
  });

  it('returns same project when segment not found (no spurious autosave)', () => {
    const project = projectWithTwoChapters();
    const state = segmentedReducer({ project }, {
      type: 'SET_SEGMENT_TEXT_TRANSFORMS', id: 'nope', transforms: null,
    });
    expect(state.project).toBe(project);
  });
});

describe('SET_PROJECT_META text-transform fields', () => {
  it('stores pronunciation_map / pronunciation_apply_all / lowercase_latin in configs', () => {
    const project = projectWithTwoChapters();
    const map = [{ id: 'pm_1', source: '调动', target: '掉动' }];
    let state = segmentedReducer({ project }, { type: 'SET_PROJECT_META', meta: { pronunciation_map: map } });
    state = segmentedReducer(state, { type: 'SET_PROJECT_META', meta: { pronunciation_apply_all: true } });
    state = segmentedReducer(state, { type: 'SET_PROJECT_META', meta: { lowercase_latin: true } });
    expect(state.project.configs?.pronunciation_map).toEqual(map);
    expect(state.project.configs?.pronunciation_apply_all).toBe(true);
    expect(state.project.configs?.lowercase_latin).toBe(true);
  });

  it('does not clobber existing configs keys', () => {
    const project = projectWithTwoChapters();
    project.configs = { underscore_to_space: true };
    const state = segmentedReducer({ project }, { type: 'SET_PROJECT_META', meta: { lowercase_latin: true } });
    expect(state.project.configs?.underscore_to_space).toBe(true);
    expect(state.project.configs?.lowercase_latin).toBe(true);
  });
});

describe('enrichSegment text_transforms passthrough', () => {
  it('survives migrateV1 (IndexedDB reload round-trip)', () => {
    const project = projectWithTwoChapters();
    project.chapters[1].segments[0].text_transforms = { applied_map_ids: ['pm_a'], lowercase_latin: null };
    const reloaded = migrateV1(JSON.parse(JSON.stringify(project)));
    expect(reloaded.chapters[1].segments[0].text_transforms)
      .toEqual({ applied_map_ids: ['pm_a'], lowercase_latin: null });
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/hooks/useSegmentedProject.test.ts`
Expected: 新 describe 块 FAIL（action 类型不存在 / text_transforms 丢失）

- [x] **Step 3: Implement**

`frontend/src/hooks/useSegmentedProject.ts`：

1. import 行（:1）的类型清单加 `SegmentTextTransforms, PronunciationMapEntry`。

2. `enrichSegment`（:71-86 的 `base` 对象）在 `animation_spec` 行后加：

```ts
    // 合成时文本变换（发音映射段级引用 + 小写化覆盖），IndexedDB 透传
    text_transforms: raw.text_transforms ?? undefined,
```

3. `SET_PROJECT_META` action 类型（:183）替换为：

```ts
  | { type: 'SET_PROJECT_META'; meta: { remotion_project_path?: string | null; description?: string | null; export_directory?: string | null; underscore_to_space?: boolean | null; skip_parenthesized?: boolean | null; pronunciation_map?: PronunciationMapEntry[] | null; pronunciation_apply_all?: boolean | null; lowercase_latin?: boolean | null } }
```

4. Action 联合（:228 `SELECT_SEGMENT` 行后）加：

```ts
  | { type: 'SET_SEGMENT_TEXT_TRANSFORMS'; id: string; transforms: SegmentTextTransforms | null }
```

5. `SET_PROJECT_META` case（:305-319）destructure 行与写入块扩展为：

```ts
    case 'SET_PROJECT_META': {
      const { remotion_project_path, description, export_directory, underscore_to_space, skip_parenthesized, pronunciation_map, pronunciation_apply_all, lowercase_latin } = action.meta;
      const nextConfigs = { ...(p.configs ?? {}) };
      if ('description' in action.meta) nextConfigs.description = description ?? null;
      if ('export_directory' in action.meta) nextConfigs.export_directory = export_directory ?? null;
      if ('underscore_to_space' in action.meta) nextConfigs.underscore_to_space = underscore_to_space ?? null;
      if ('skip_parenthesized' in action.meta) nextConfigs.skip_parenthesized = skip_parenthesized ?? null;
      if ('pronunciation_map' in action.meta) nextConfigs.pronunciation_map = pronunciation_map ?? null;
      if ('pronunciation_apply_all' in action.meta) nextConfigs.pronunciation_apply_all = pronunciation_apply_all ?? null;
      if ('lowercase_latin' in action.meta) nextConfigs.lowercase_latin = lowercase_latin ?? null;
      const next: SegmentedProject = {
        ...p,
        ...("remotion_project_path" in action.meta ? { remotion_project_path: remotion_project_path ?? null } : {}),
        configs: nextConfigs,
        updated_at: new Date().toISOString(),
      };
      return { project: next };
    }
```

6. reducer 中 `CLEAR_ROLE_FROM_SEGMENTS` case 之后（default 之前）加：

```ts
    case 'SET_SEGMENT_TEXT_TRANSFORMS': {
      // 跨章节按 id 更新（搜索/映射面板可作用于非活动章节的段）；
      // updateSegmentById 找不到时原样返回（不 bump updated_at，不触发空保存）
      return { project: updateSegmentById(p, action.id, seg => ({
        ...seg,
        text_transforms: action.transforms ?? undefined,
        updated_at: new Date().toISOString(),
      })) };
    }
```

- [x] **Step 4: Run tests**

Run: `cd frontend && npx vitest run src/hooks/useSegmentedProject.test.ts`
Expected: PASS（含既有用例无回归）

- [x] **Step 5: Commit**

```bash
git add frontend/src/hooks/useSegmentedProject.ts frontend/src/hooks/useSegmentedProject.test.ts
git commit -m "feat(frontend): reducer wiring for text_transforms + pronunciation configs"
```

---

## Task 8: useSegmentSearch hook（全项目搜索 + 全大写词过滤）

**Files:**
- Create: `frontend/src/hooks/useSegmentSearch.ts`
- Test: `frontend/src/hooks/useSegmentSearch.test.ts`

- [x] **Step 1: Write the failing test**

创建 `frontend/src/hooks/useSegmentSearch.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import type { SegmentedProject } from '../types';
import { findUppercaseSegments, searchSegments, splitSnippet } from './useSegmentSearch';

function makeProject(): SegmentedProject {
  const voice = { engine: 'edge_tts' as const, voice: '', rate: '+0%', volume: '+0%' };
  const seg = (id: string, text: string, position: number) => ({
    id, text, position, voice: { source: 'chapter' as const }, status: 'idle' as const,
    audio: { format: 'mp3' }, segment_kind: 'narration' as const, created_at: 'x', updated_at: 'x',
  });
  return {
    schema_version: 2, id: 'p', name: 'P', layout: 'vertical',
    active_chapter_id: 'c1', created_at: 'x', updated_at: 'x',
    chapters: [
      { id: 'c1', name: '夜路', voice, split_config: { delimiters: ['。'], mode: 'rule' }, created_at: 'x', updated_at: 'x',
        segments: [seg('s1', '夜色渐浓，小路两旁的树影摇曳。', 0), seg('s2', '他加快了脚步。', 1)] },
      { id: 'c2', name: '破庙', design_title: '破庙（设计题）', voice, split_config: { delimiters: ['。'], mode: 'rule' }, created_at: 'x', updated_at: 'x',
        segments: [seg('s3', '破庙的门半掩着，夜色里透出微光。', 0)] },
    ],
  };
}

describe('searchSegments', () => {
  it('finds matches across chapters with chapter name and position', () => {
    const hits = searchSegments(makeProject(), '夜色');
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ chapterId: 'c1', chapterName: '夜路', segmentId: 's1', position: 0, matchCount: 1 });
    expect(hits[1]).toMatchObject({ chapterId: 'c2', chapterName: '破庙（设计题）', segmentId: 's3', matchCount: 1 });
    expect(hits[1].snippet).toContain('夜色');
  });

  it('is case-insensitive for latin text', () => {
    const p = makeProject();
    p.chapters[0].segments[0].text = '使用 REST API 接口';
    const hits = searchSegments(p, 'api');
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).toContain('REST API');
  });

  it('empty/whitespace query returns no hits', () => {
    expect(searchSegments(makeProject(), '')).toEqual([]);
    expect(searchSegments(makeProject(), '   ')).toEqual([]);
  });

  it('counts multiple matches in one segment', () => {
    const p = makeProject();
    p.chapters[0].segments[0].text = '好啊，真好啊';
    const hits = searchSegments(p, '好啊');
    expect(hits[0].matchCount).toBe(2);
  });

  it('long text snippet is ellipsized around the match', () => {
    const p = makeProject();
    p.chapters[0].segments[0].text = '一'.repeat(40) + '目标' + '二'.repeat(40);
    const hits = searchSegments(p, '目标');
    expect(hits[0].snippet.startsWith('…')).toBe(true);
    expect(hits[0].snippet.endsWith('…')).toBe(true);
    expect(hits[0].snippet).toContain('目标');
    expect(hits[0].snippet.length).toBeLessThan(60);
  });
});

describe('splitSnippet', () => {
  it('splits around case-insensitive matches for highlighting', () => {
    expect(splitSnippet('使用 REST API 接口', 'api')).toEqual([
      { text: '使用 REST ', match: false },
      { text: 'API', match: true },
      { text: ' 接口', match: false },
    ]);
  });
  it('empty query returns single non-match part', () => {
    expect(splitSnippet('abc', '')).toEqual([{ text: 'abc', match: false }]);
  });
});

describe('findUppercaseSegments', () => {
  it('finds segments containing ALL-CAPS latin words', () => {
    const p = makeProject();
    p.chapters[1].segments[0].text = '调用 REST API 接口';
    const hits = findUppercaseSegments(p);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ chapterId: 'c2', segmentId: 's3', matchCount: 2 });
    expect(hits[0].snippet).toContain('REST');
  });

  it('ignores single-letter and TitleCase words', () => {
    const p = makeProject();
    p.chapters[0].segments[0].text = 'I think Http works';
    expect(findUppercaseSegments(p)).toEqual([]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useSegmentSearch.test.ts`
Expected: FAIL（模块不存在）

- [x] **Step 3: Implement**

创建 `frontend/src/hooks/useSegmentSearch.ts`：

```ts
/**
 * 全项目搜索（跨章节，纯前端：所有 segment 数据已在内存）。
 *
 * 两处消费：Studio 工具栏搜索框（SegmentSearchBar）与发音映射面板的
 * 「包含该词的 segment」列表（PronunciationMapPanel）——一份搜索逻辑两处用。
 */
import { useMemo } from 'react';
import type { SegmentedProject } from '../types';
import { UPPERCASE_WORD_RE } from '../services/textTransforms';

export interface SegmentSearchHit {
  chapterId: string;
  /** 优先 design_title（展示用标题），回退 name */
  chapterName: string;
  segmentId: string;
  position: number;
  /** 首个命中词的上下文片段（前后各 16 字，截断处加 …） */
  snippet: string;
  /** 该段命中次数 */
  matchCount: number;
}

const CONTEXT = 16;

function buildSnippet(text: string, start: number, length: number): string {
  const from = Math.max(0, start - CONTEXT);
  const to = Math.min(text.length, start + length + CONTEXT);
  return (from > 0 ? '…' : '') + text.slice(from, to) + (to < text.length ? '…' : '');
}

/** 大小写不敏感子串匹配，跨全部章节；空查询返回空。 */
export function searchSegments(project: SegmentedProject, query: string): SegmentSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SegmentSearchHit[] = [];
  for (const ch of project.chapters) {
    ch.segments.forEach((seg, idx) => {
      const lower = seg.text.toLowerCase();
      const first = lower.indexOf(q);
      if (first < 0) return;
      let count = 0;
      let i = first;
      while (i >= 0) {
        count++;
        i = lower.indexOf(q, i + q.length);
      }
      hits.push({
        chapterId: ch.id,
        chapterName: ch.design_title || ch.name,
        segmentId: seg.id,
        position: seg.position ?? idx,
        snippet: buildSnippet(seg.text, first, q.length),
        matchCount: count,
      });
    });
  }
  return hits;
}

/** 含全大写拉丁词 [A-Z]{2,} 的段（与搜索同结果形状，供「含全大写词」快捷过滤器用）。 */
export function findUppercaseSegments(project: SegmentedProject): SegmentSearchHit[] {
  const re = new RegExp(UPPERCASE_WORD_RE.source, 'g');
  const hits: SegmentSearchHit[] = [];
  for (const ch of project.chapters) {
    ch.segments.forEach((seg, idx) => {
      const matches = [...seg.text.matchAll(re)];
      if (matches.length === 0) return;
      const first = matches[0];
      hits.push({
        chapterId: ch.id,
        chapterName: ch.design_title || ch.name,
        segmentId: seg.id,
        position: seg.position ?? idx,
        snippet: buildSnippet(seg.text, first.index ?? 0, first[0].length),
        matchCount: matches.length,
      });
    });
  }
  return hits;
}

/** 把片段按 query 的命中位置切开（大小写不敏感），供高亮渲染。 */
export function splitSnippet(snippet: string, query: string): { text: string; match: boolean }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text: snippet, match: false }];
  const lower = snippet.toLowerCase();
  const parts: { text: string; match: boolean }[] = [];
  let i = 0;
  while (i < snippet.length) {
    const idx = lower.indexOf(q, i);
    if (idx < 0) {
      parts.push({ text: snippet.slice(i), match: false });
      break;
    }
    if (idx > i) parts.push({ text: snippet.slice(i, idx), match: false });
    parts.push({ text: snippet.slice(idx, idx + q.length), match: true });
    i = idx + q.length;
  }
  return parts;
}

/** hook 版：query 变化时重算（结果按 chapters 顺序稳定）。 */
export function useSegmentSearch(project: SegmentedProject, query: string): SegmentSearchHit[] {
  return useMemo(() => searchSegments(project, query), [project, query]);
}
```

- [x] **Step 4: Run tests**

Run: `cd frontend && npx vitest run src/hooks/useSegmentSearch.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add frontend/src/hooks/useSegmentSearch.ts frontend/src/hooks/useSegmentSearch.test.ts
git commit -m "feat(frontend): project-wide segment search hook + uppercase-word finder"
```

---

## Task 9: SegmentSearchBar 组件 + 工具栏集成 + 滚动定位/闪烁

**Files:**
- Create: `frontend/src/components/SegmentedTTS/SegmentSearchBar.tsx`、`SegmentSearchBar.module.css`
- Modify: `frontend/src/components/SegmentedTTS/SegmentList.tsx`（props + rowProps）
- Modify: `frontend/src/components/SegmentedTTS/SegmentRow.tsx`（根元素 `data-segment-id` + flash 类）
- Modify: `frontend/src/components/SegmentedTTS/SegmentRow.module.css`（flash 动画）
- Modify: `frontend/src/pages/TTSSynthesis.tsx:2124-2126`（工具栏挂载）、`:524-530` 附近（navigate handler）
- Modify: `frontend/src/i18n/zh-CN.ts`、`frontend/src/i18n/en-US.ts`
- Test: `frontend/src/components/SegmentedTTS/SegmentSearchBar.test.tsx`

- [x] **Step 1: Write the failing test**

创建 `frontend/src/components/SegmentedTTS/SegmentSearchBar.test.tsx`（setup 已钉 zh-CN，直接断言中文）：

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { SegmentedProject } from '../../types';
import { SegmentSearchBar } from './SegmentSearchBar';

function makeProject(): SegmentedProject {
  const voice = { engine: 'edge_tts' as const, voice: '', rate: '+0%', volume: '+0%' };
  const seg = (id: string, text: string, position: number) => ({
    id, text, position, voice: { source: 'chapter' as const }, status: 'idle' as const,
    audio: { format: 'mp3' }, segment_kind: 'narration' as const, created_at: 'x', updated_at: 'x',
  });
  return {
    schema_version: 2, id: 'p', name: 'P', layout: 'vertical',
    active_chapter_id: 'c1', created_at: 'x', updated_at: 'x',
    chapters: [
      { id: 'c1', name: '夜路', voice, split_config: { delimiters: ['。'], mode: 'rule' }, created_at: 'x', updated_at: 'x',
        segments: [seg('s1', '夜色渐浓。', 0)] },
      { id: 'c2', name: '破庙', voice, split_config: { delimiters: ['。'], mode: 'rule' }, created_at: 'x', updated_at: 'x',
        segments: [seg('s2', '破庙里透出人声。', 0), seg('s3', '调用 REST API 接口。', 1)] },
    ],
  };
}

function renderBar(overrides: Partial<Parameters<typeof SegmentSearchBar>[0]> = {}) {
  const onNavigate = vi.fn();
  const onSetSegmentLowercase = vi.fn();
  render(
    <SegmentSearchBar
      project={makeProject()}
      onNavigate={onNavigate}
      onSetSegmentLowercase={onSetSegmentLowercase}
      projectLowercaseLatin={false}
      {...overrides}
    />,
  );
  return { onNavigate, onSetSegmentLowercase };
}

describe('SegmentSearchBar', () => {
  it('输入即搜，跨章节列出命中并显示总命中数', () => {
    renderBar();
    fireEvent.change(screen.getByLabelText('搜索全项目片段'), { target: { value: '人' } });
    expect(screen.getByRole('listbox', { name: '搜索结果' })).toBeTruthy();
    expect(screen.getByText('1 处命中')).toBeTruthy();
    expect(screen.getByText(/破庙里透出/)).toBeTruthy();
  });

  it('点击结果回调 onNavigate 并关闭面板', () => {
    const { onNavigate } = renderBar();
    fireEvent.change(screen.getByLabelText('搜索全项目片段'), { target: { value: '人声' } });
    fireEvent.click(screen.getByRole('option', { name: /破庙里透出/ }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ chapterId: 'c2', segmentId: 's2' }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('键盘 ↓/↑ 移动、Enter 跳转、Esc 关闭', () => {
    const { onNavigate } = renderBar();
    const input = screen.getByLabelText('搜索全项目片段');
    fireEvent.change(input, { target: { value: '调用' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ segmentId: 's3' }));
  });

  it('「含全大写词」过滤器列出大写词段，带小写三态开关', () => {
    const { onSetSegmentLowercase } = renderBar();
    fireEvent.click(screen.getByRole('button', { name: '含全大写词' }));
    expect(screen.getByText(/REST API/)).toBeTruthy();
    expect(screen.queryByText(/夜色渐浓/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '小写', exact: true }));
    expect(onSetSegmentLowercase).toHaveBeenCalledWith('s3', true);
  });

  it('段级覆盖已设时三态显示当前值', () => {
    const p = makeProject();
    p.chapters[1].segments[1].text_transforms = { lowercase_latin: false };
    renderBar({ project: p });
    fireEvent.click(screen.getByRole('button', { name: '含全大写词' }));
    const keepBtn = screen.getByRole('button', { name: '保持大写' });
    expect(keepBtn.getAttribute('aria-pressed')).toBe('true');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/SegmentedTTS/SegmentSearchBar.test.tsx`
Expected: FAIL（组件不存在）

- [x] **Step 3: Implement**

1. i18n —— `zh-CN.ts` 顶层（`projectSettings` 节后）加 `segmentSearch` 节；`en-US.ts` 同步：

```ts
  segmentSearch: {
    placeholder: '搜索全项目片段…',
    uppercaseFilter: '含全大写词',
    results: '搜索结果',
    hitCount: '{count} 处命中',
    noResults: '无命中',
    lowerFollow: '跟随项目',
    lowerOn: '小写',
    lowerOff: '保持大写',
  },
```

en-US：

```ts
  segmentSearch: {
    placeholder: 'Search all segments…',
    uppercaseFilter: 'Has UPPERCASE words',
    results: 'Search results',
    hitCount: '{count} matches',
    noResults: 'No matches',
    lowerFollow: 'Follow project',
    lowerOn: 'Lowercase',
    lowerOff: 'Keep uppercase',
  },
```

2. 创建 `SegmentSearchBar.tsx`：

```tsx
/**
 * Studio 工具栏搜索框：全项目跨章节搜索（输入即搜），结果按章节分组，
 * ↑/↓ 移动、Enter 跳转、Esc 关闭；内置「含全大写词」快捷过滤器，
 * 该模式下每段带小写化三态开关（跟随项目 / 小写 / 保持大写）。
 */
import { useMemo, useState } from 'react';
import { useTranslation } from '../../i18n';
import type { SegmentedProject } from '../../types';
import {
  findUppercaseSegments,
  splitSnippet,
  useSegmentSearch,
  type SegmentSearchHit,
} from '../../hooks/useSegmentSearch';
import { UPPERCASE_WORD_RE } from '../../services/textTransforms';
import styles from './SegmentSearchBar.module.css';

interface SegmentSearchBarProps {
  project: SegmentedProject;
  /** 点击/Enter 结果：父组件负责切章节 + 选中 + 滚动定位 */
  onNavigate: (hit: SegmentSearchHit) => void;
  /** 「含全大写词」模式下设置段级小写化覆盖（null=跟随项目） */
  onSetSegmentLowercase?: (segmentId: string, value: boolean | null) => void;
  /** 项目级 lowercase_latin 默认（三态「跟随项目」的状态提示用） */
  projectLowercaseLatin?: boolean;
}

function splitByRegex(snippet: string): { text: string; match: boolean }[] {
  const re = new RegExp(UPPERCASE_WORD_RE.source, 'g');
  const parts: { text: string; match: boolean }[] = [];
  let last = 0;
  for (const m of snippet.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push({ text: snippet.slice(last, idx), match: false });
    parts.push({ text: m[0], match: true });
    last = idx + m[0].length;
  }
  if (last < snippet.length) parts.push({ text: snippet.slice(last), match: false });
  return parts;
}

export function SegmentSearchBar({
  project, onNavigate, onSetSegmentLowercase, projectLowercaseLatin,
}: SegmentSearchBarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [uppercaseOnly, setUppercaseOnly] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const queryHits = useSegmentSearch(project, query);
  const hits = useMemo(
    () => (uppercaseOnly ? findUppercaseSegments(project) : queryHits),
    [uppercaseOnly, project, queryHits],
  );

  const segmentTransforms = useMemo(() => {
    const m = new Map<string, boolean | null>();
    for (const ch of project.chapters) {
      for (const s of ch.segments) m.set(s.id, s.text_transforms?.lowercase_latin ?? null);
    }
    return m;
  }, [project.chapters]);

  // 按章节分组（保持命中数组顺序），键盘导航用扁平 hits
  const grouped = useMemo(() => {
    const groups: { chapterName: string; items: { hit: SegmentSearchHit; flatIndex: number }[] }[] = [];
    hits.forEach((hit, flatIndex) => {
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.chapterName === hit.chapterName) {
        lastGroup.items.push({ hit, flatIndex });
      } else {
        groups.push({ chapterName: hit.chapterName, items: [{ hit, flatIndex }] });
      }
    });
    return groups;
  }, [hits]);

  const navigate = (hit: SegmentSearchHit) => {
    onNavigate(hit);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIndex(i => Math.min(i + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const hit = hits[Math.max(0, Math.min(activeIndex, hits.length - 1))];
      if (hit) navigate(hit);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const renderSnippet = (hit: SegmentSearchHit) => {
    const parts = uppercaseOnly ? splitByRegex(hit.snippet) : splitSnippet(hit.snippet, query);
    return parts.map((p, i) => (p.match ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>));
  };

  const showPanel = open && (uppercaseOnly || query.trim().length > 0);

  return (
    <div className={styles.root}>
      <input
        className={styles.input}
        aria-label={t('segmentSearch.placeholder').replace(/…$/, '')}
        placeholder={t('segmentSearch.placeholder')}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setUppercaseOnly(false); setOpen(true); setActiveIndex(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        aria-label={t('segmentSearch.uppercaseFilter')}
        aria-pressed={uppercaseOnly}
        className={`${styles.filterChip} ${uppercaseOnly ? styles.filterChipActive : ''}`}
        onClick={() => { setUppercaseOnly(v => !v); setOpen(true); setActiveIndex(0); }}
      >
        {t('segmentSearch.uppercaseFilter')}
      </button>
      {showPanel && (
        <div className={styles.results} role="listbox" aria-label={t('segmentSearch.results')}>
          <div className={styles.summary}>
            {hits.length > 0 ? t('segmentSearch.hitCount', { count: hits.length }) : t('segmentSearch.noResults')}
          </div>
          {grouped.map(group => (
            <div key={group.chapterName} className={styles.group}>
              <div className={styles.groupName}>{group.chapterName}</div>
              {group.items.map(({ hit, flatIndex }) => (
                <div
                  key={hit.segmentId}
                  role="option"
                  aria-selected={flatIndex === activeIndex}
                  aria-label={hit.snippet}
                  className={`${styles.hit} ${flatIndex === activeIndex ? styles.hitActive : ''}`}
                  onClick={() => navigate(hit)}
                  onMouseEnter={() => setActiveIndex(flatIndex)}
                >
                  <span className={styles.hitPos}>#{hit.position + 1}</span>
                  <span className={styles.hitSnippet}>{renderSnippet(hit)}</span>
                  {hit.matchCount > 1 && <span className={styles.hitCount}>×{hit.matchCount}</span>}
                  {uppercaseOnly && onSetSegmentLowercase && (
                    <span className={styles.lowerTri} onClick={(e) => e.stopPropagation()}>
                      {([null, true, false] as const).map(v => (
                        <button
                          key={String(v)}
                          type="button"
                          aria-pressed={(segmentTransforms.get(hit.segmentId) ?? null) === v}
                          className={`${styles.lowerBtn} ${(segmentTransforms.get(hit.segmentId) ?? null) === v ? styles.lowerBtnActive : ''}`}
                          aria-label={v === null ? t('segmentSearch.lowerFollow') : v ? t('segmentSearch.lowerOn') : t('segmentSearch.lowerOff')}
                          onClick={() => onSetSegmentLowercase(hit.segmentId, v)}
                        >
                          {v === null ? t('segmentSearch.lowerFollow') : v ? t('segmentSearch.lowerOn') : t('segmentSearch.lowerOff')}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

注意：测试用 `getByLabelText('搜索全项目片段')`，所以 input 的 `aria-label` 用 `placeholder` 文案去掉省略号（`segmentSearch.placeholder` 值以 `…` 结尾，`.replace(/…$/, '')` 处理）。

3. 创建 `SegmentSearchBar.module.css`（最小可用样式，遵循 variables.css 设计令牌）：

```css
.root { position: relative; display: flex; gap: 6px; align-items: center; margin-right: auto; }
.input {
  width: 220px; padding: 5px 10px; border-radius: var(--radius-sm, 6px);
  border: 1px solid var(--color-border, #d0d0d0); background: var(--color-bg, #fff);
  color: var(--color-text, #222); font-size: 0.85rem;
}
.filterChip {
  padding: 4px 10px; border-radius: 999px; font-size: 0.78rem; cursor: pointer;
  border: 1px solid var(--color-border, #d0d0d0); background: transparent;
  color: var(--color-text-secondary, #666);
}
.filterChipActive { background: var(--color-primary, #4a6cf7); color: #fff; border-color: transparent; }
.results {
  position: absolute; top: calc(100% + 6px); left: 0; z-index: 40;
  width: 420px; max-height: 320px; overflow-y: auto;
  background: var(--color-bg, #fff); border: 1px solid var(--color-border, #d0d0d0);
  border-radius: var(--radius-md, 10px); box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);
}
.summary { padding: 6px 12px; font-size: 0.75rem; color: var(--color-text-secondary, #666); }
.groupName { padding: 4px 12px; font-size: 0.75rem; font-weight: 600; color: var(--color-text-secondary, #666); }
.hit {
  display: flex; align-items: center; gap: 8px; padding: 6px 12px; cursor: pointer;
  font-size: 0.85rem;
}
.hitActive { background: var(--color-bg-hover, #f0f2ff); }
.hitPos { color: var(--color-text-secondary, #666); font-size: 0.75rem; flex-shrink: 0; }
.hitSnippet { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hitSnippet mark { background: #ffe58f; border-radius: 2px; }
.hitCount { font-size: 0.72rem; color: var(--color-text-secondary, #666); }
.lowerTri { display: flex; gap: 2px; flex-shrink: 0; }
.lowerBtn {
  padding: 2px 6px; font-size: 0.7rem; border-radius: 4px; cursor: pointer;
  border: 1px solid var(--color-border, #d0d0d0); background: transparent;
  color: var(--color-text-secondary, #666);
}
.lowerBtnActive { background: var(--color-primary, #4a6cf7); color: #fff; border-color: transparent; }
```

4. `SegmentList.tsx` — `SegmentListProps` 加：

```ts
  /** 搜索结果跳转后闪烁高亮的段 id（父组件负责 ~1.6s 后清除） */
  flashId?: string | null;
```

`rowProps` 工厂返回对象加一行：

```ts
    flash: props.flashId === seg.id,
```

5. `SegmentRow.tsx` — props 接口加 `flash?: boolean;`；三个布局的根元素都加 `data-segment-id` 与 flash 类：

- horizontal（:406 根 div）：className 模板尾部加 `${flash ? ` ${styles.flash}` : ''}`，元素上加 `data-segment-id={segment.id}`。
- compact（:445 根 div）：同样处理。
- expanded（:530 根 div）：同样处理。

`SegmentRow.module.css` 加：

```css
@keyframes segmentFlash {
  0%, 100% { box-shadow: none; }
  25%, 75% { box-shadow: 0 0 0 3px var(--color-primary, #4a6cf7); }
}
.flash { animation: segmentFlash 1.5s ease-in-out; }
```

6. `TTSSynthesis.tsx`：

import 区加：

```ts
import { SegmentSearchBar } from '../components/SegmentedTTS/SegmentSearchBar';
import type { SegmentSearchHit } from '../hooks/useSegmentSearch';
import type { SegmentTextTransforms } from '../types';
```

state 区（`const [compactMode, setCompactMode]...` 附近）加：

```ts
  // 搜索结果跳转后的闪烁高亮目标段
  const [flashSegmentId, setFlashSegmentId] = useState<string | null>(null);
```

`handleSelectChapter`（:524-530）之后加：

```ts
  // 搜索结果跳转：切章节 → 选中段 → 滚动定位 + 闪烁高亮
  const handleSearchNavigate = useCallback((hit: SegmentSearchHit) => {
    if (hit.chapterId !== activeChapter.id) {
      dispatch({ type: 'SELECT_CHAPTER', id: hit.chapterId });
    }
    dispatch({ type: 'SELECT_SEGMENT', id: hit.segmentId });
    setFlashSegmentId(hit.segmentId);
  }, [activeChapter.id, dispatch]);

  useEffect(() => {
    if (!flashSegmentId) return;
    const el = document.querySelector(`[data-segment-id="${flashSegmentId}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const timer = setTimeout(() => setFlashSegmentId(null), 1600);
    return () => clearTimeout(timer);
  }, [flashSegmentId, activeChapter.id]);

  // 「含全大写词」过滤器 / 编辑面板的段级小写化三态写回
  const handleSetSegmentLowercase = useCallback((segmentId: string, value: boolean | null) => {
    const seg = project.chapters.flatMap(c => c.segments).find(s => s.id === segmentId);
    const prev: SegmentTextTransforms = seg?.text_transforms ?? {};
    dispatch({ type: 'SET_SEGMENT_TEXT_TRANSFORMS', id: segmentId, transforms: { ...prev, lowercase_latin: value } });
  }, [project.chapters, dispatch]);
```

工具栏（:2124 `<div className={styles.sourceProductionBar} ...>` 内，`productionActions` div 之前）插入：

```tsx
              <SegmentSearchBar
                project={project}
                onNavigate={handleSearchNavigate}
                onSetSegmentLowercase={handleSetSegmentLowercase}
                projectLowercaseLatin={Boolean(project.configs?.lowercase_latin)}
              />
```

`<SegmentList ...>`（:2178 起）props 加一行：

```tsx
                flashId={flashSegmentId}
```

- [x] **Step 4: Run tests + lint**

Run: `cd frontend && npx vitest run src/components/SegmentedTTS/SegmentSearchBar.test.tsx src/hooks/useSegmentSearch.test.ts && npm run lint`
Expected: PASS，lint 无新错误

- [x] **Step 5: Commit**

```bash
git add frontend/src/components/SegmentedTTS/SegmentSearchBar.tsx frontend/src/components/SegmentedTTS/SegmentSearchBar.module.css frontend/src/components/SegmentedTTS/SegmentSearchBar.test.tsx frontend/src/components/SegmentedTTS/SegmentList.tsx frontend/src/components/SegmentedTTS/SegmentRow.tsx frontend/src/components/SegmentedTTS/SegmentRow.module.css frontend/src/pages/TTSSynthesis.tsx frontend/src/i18n/zh-CN.ts frontend/src/i18n/en-US.ts
git commit -m "feat(frontend): project-wide segment search bar with navigation + uppercase filter"
```

---

## Task 10: ProjectSettings 两个项目级开关

**Files:**
- Modify: `frontend/src/components/ProjectSettings/ProjectSettings.tsx:6-11, 105-142`
- Modify: `frontend/src/pages/TTSSynthesis.tsx:2339-2352`（props 接线）
- Modify: `frontend/src/i18n/zh-CN.ts`、`frontend/src/i18n/en-US.ts`
- Test: `frontend/src/components/ProjectSettings/ProjectSettings.test.tsx`（追加）

- [x] **Step 1: Write the failing tests**

在 `ProjectSettings.test.tsx` 追加（复用文件现有 render helper 的 props 风格；若 helper 是固定 props 对象，直接扩展）：

```tsx
describe('文本变换开关', () => {
  it('点击「全量应用发音映射」回调 pronunciation_apply_all', () => {
    const onUpdateProjectMeta = vi.fn();
    renderSettings({ onUpdateProjectMeta });
    fireEvent.click(screen.getByLabelText('全量应用发音映射'));
    expect(onUpdateProjectMeta).toHaveBeenCalledWith({ pronunciation_apply_all: true });
  });

  it('点击「大写英文词转小写」回调 lowercase_latin', () => {
    const onUpdateProjectMeta = vi.fn();
    renderSettings({ onUpdateProjectMeta });
    fireEvent.click(screen.getByLabelText('大写英文词转小写'));
    expect(onUpdateProjectMeta).toHaveBeenCalledWith({ lowercase_latin: true });
  });

  it('回显 configs 里的已存值', () => {
    renderSettings({ pronunciationApplyAll: true, lowercaseLatin: true });
    expect((screen.getByLabelText('全量应用发音映射') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('大写英文词转小写') as HTMLInputElement).checked).toBe(true);
  });
});
```

（`renderSettings` 为该文件现有的渲染辅助名；若实际名字不同（如内联 render），按现有测试的写法适配，断言逻辑不变。）

- [x] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/ProjectSettings/ProjectSettings.test.tsx`
Expected: FAIL（label 不存在）

- [x] **Step 3: Implement**

1. i18n —— `zh-CN.ts` 的 `projectSettings` 节（:1153 `skipParenthesizedHint` 行后）加：

```ts
    pronunciationApplyAll: '全量应用发音映射',
    pronunciationApplyAllHint: '开启后，生效发音字典（全局 + 项目）对所有段生效，无需在映射面板逐段勾选；不含映射原文的段不受影响。',
    lowercaseLatin: '大写英文词转小写',
    lowercaseLatinHint: '开启后，合成时把全大写拉丁词（如 REST API）转为小写再送引擎，避免逐字母朗读；仅影响合成语音，显示文本与字幕保持原文。段编辑面板可逐段覆盖。',
```

en-US 对应节加：

```ts
    pronunciationApplyAll: 'Apply pronunciation map to all segments',
    pronunciationApplyAllHint: 'When on, the effective pronunciation map (global + project) applies to every segment; no per-segment selection needed. Segments without a mapped word are unaffected.',
    lowercaseLatin: 'Lowercase ALL-CAPS latin words',
    lowercaseLatinHint: 'When on, ALL-CAPS latin words (e.g. REST API) are lowercased before synthesis to avoid letter-by-letter reading. Display text and subtitles keep the original. Per-segment override available in the segment editor.',
```

2. `ProjectSettings.tsx`：

`ProjectSettingsMeta`（:6-11）加两字段：

```ts
  pronunciation_apply_all?: boolean | null;
  lowercase_latin?: boolean | null;
```

`ProjectSettingsProps` 加：

```ts
  pronunciationApplyAll?: boolean | null;
  lowercaseLatin?: boolean | null;
```

解构加同名两项；「语音合成」卡片内 `ignoreGroup` div 之后（:141 `</div>` 后、`:142 </section>` 前）加：

```tsx
          <label className={styles.toggleField}>
            <input
              type="checkbox"
              aria-label={t('projectSettings.pronunciationApplyAll')}
              checked={pronunciationApplyAll ?? false}
              onChange={(event) => onUpdateProjectMeta({ pronunciation_apply_all: event.target.checked })}
            />
            <span>{t('projectSettings.pronunciationApplyAll')}</span>
          </label>
          <p className={styles.toggleHint}>{t('projectSettings.pronunciationApplyAllHint')}</p>
          <label className={styles.toggleField}>
            <input
              type="checkbox"
              aria-label={t('projectSettings.lowercaseLatin')}
              checked={lowercaseLatin ?? false}
              onChange={(event) => onUpdateProjectMeta({ lowercase_latin: event.target.checked })}
            />
            <span>{t('projectSettings.lowercaseLatin')}</span>
          </label>
          <p className={styles.toggleHint}>{t('projectSettings.lowercaseLatinHint')}</p>
```

3. `TTSSynthesis.tsx` `<ProjectSettings ...>`（:2339-2352）props 加：

```tsx
            pronunciationApplyAll={project.configs?.pronunciation_apply_all ?? null}
            lowercaseLatin={project.configs?.lowercase_latin ?? null}
```

- [x] **Step 4: Run tests**

Run: `cd frontend && npx vitest run src/components/ProjectSettings src/i18n`
Expected: PASS（含 missing-keys 守门）

- [x] **Step 5: Commit**

```bash
git add frontend/src/components/ProjectSettings/ProjectSettings.tsx frontend/src/components/ProjectSettings/ProjectSettings.test.tsx frontend/src/pages/TTSSynthesis.tsx frontend/src/i18n/zh-CN.ts frontend/src/i18n/en-US.ts
git commit -m "feat(frontend): project settings toggles for pronunciation_apply_all + lowercase_latin"
```

---

## Task 11: SegmentEditPanel 三态开关 + SegmentRow 🗣 badge

**Files:**
- Modify: `frontend/src/components/SegmentedTTS/SegmentEditPanel.tsx:21-36`（props）、`:231-243`（情绪 chips 区块之后插入）
- Modify: `frontend/src/components/SegmentedTTS/SegmentList.tsx`（props + rowProps + SegmentEditPanel 透传）
- Modify: `frontend/src/components/SegmentedTTS/SegmentRow.tsx:9-63`（props）、`:469-495`（compact badges）、`:574-610`（expanded badges）
- Modify: `frontend/src/components/SegmentedTTS/SegmentRow.module.css`
- Modify: `frontend/src/pages/TTSSynthesis.tsx`（SegmentList props）
- Modify: `frontend/src/i18n/zh-CN.ts`、`frontend/src/i18n/en-US.ts`
- Test: `frontend/src/components/SegmentedTTS/SegmentEditPanel.test.tsx`（新建）、`frontend/src/components/SegmentedTTS/SegmentRow.test.tsx`（新建）

- [x] **Step 1: Write the failing tests**

创建 `SegmentEditPanel.test.tsx`：

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Segment } from '../../types';
import { SegmentEditPanel } from './SegmentEditPanel';

function makeSegment(transforms?: Segment['text_transforms']): Segment {
  return {
    id: 's1', text: '调用 REST API 接口。', voice: { source: 'chapter' }, status: 'idle',
    audio: { format: 'mp3' }, segment_kind: 'narration',
    text_transforms: transforms, created_at: 'x', updated_at: 'x',
  };
}

function renderPanel(segment: Segment, onUpdateTextTransforms = vi.fn()) {
  render(
    <SegmentEditPanel
      segment={segment}
      voices={[]}
      roles={[]}
      chapterEngine="edge_tts"
      onClose={() => {}}
      onUpdateText={() => {}}
      onUpdateSSML={() => {}}
      onUpdateEmotion={() => {}}
      onUndo={() => {}}
      onRegenerate={() => {}}
      onConfirmCustom={() => {}}
      onAnnotateSSML={() => {}}
      onSplit={() => {}}
      onUpdateTextTransforms={onUpdateTextTransforms}
    />,
  );
  return { onUpdateTextTransforms };
}

describe('SegmentEditPanel 大写词转小写三态', () => {
  it('默认「跟随项目」为激活态', () => {
    renderPanel(makeSegment());
    expect(screen.getByRole('button', { name: '跟随项目' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('点击「开」写回 lowercase_latin: true（保留已有 applied_map_ids）', () => {
    const { onUpdateTextTransforms } = renderPanel(makeSegment({ applied_map_ids: ['pm_a'] }));
    fireEvent.click(screen.getByRole('button', { name: '开' }));
    expect(onUpdateTextTransforms).toHaveBeenCalledWith('s1', { applied_map_ids: ['pm_a'], lowercase_latin: true });
  });

  it('已设为 false 时「关」为激活态', () => {
    renderPanel(makeSegment({ lowercase_latin: false }));
    expect(screen.getByRole('button', { name: '关' }).getAttribute('aria-pressed')).toBe('true');
  });
});
```

创建 `SegmentRow.test.tsx`：

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Segment } from '../../types';
import { SegmentRow } from './SegmentRow';

function makeSegment(): Segment {
  return {
    id: 's1', text: '调用 REST API 接口。', voice: { source: 'chapter' }, status: 'idle',
    audio: { format: 'mp3' }, segment_kind: 'narration', created_at: 'x', updated_at: 'x',
  };
}

const noop = () => {};

function renderRow(extra: Partial<Parameters<typeof SegmentRow>[0]> = {}) {
  return render(
    <SegmentRow
      segment={makeSegment()}
      index={1}
      layout="compact"
      compact
      voices={[]}
      onSelect={noop} onDelete={noop} onInsertAfter={noop} onEdit={noop}
      onRegenerate={noop} onPlay={noop} onUndo={noop}
      {...extra}
    />,
  );
}

describe('SegmentRow 发音映射 badge', () => {
  it('有已应用映射时显示 🗣 + 数量，title 列出 source→target', () => {
    renderRow({ pronunciationPreview: [{ source: '调动', target: '掉动' }, { source: 'REST', target: 'rest' }] });
    const badge = screen.getByText('🗣 2');
    expect(badge.getAttribute('title')).toBe('调动→掉动\nREST→rest');
  });

  it('无已应用映射时不显示 badge', () => {
    renderRow();
    expect(screen.queryByText(/🗣/)).toBeNull();
  });

  it('根元素带 data-segment-id（搜索结果滚动定位锚点）', () => {
    const { container } = renderRow();
    expect(container.querySelector('[data-segment-id="s1"]')).toBeTruthy();
  });
});
```

（SegmentRow props 以实际接口为准微调：若必填 prop 比上面多，按 `:9-63` 的接口补齐 noop/默认值；断言逻辑不变。）

- [x] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/SegmentedTTS/SegmentEditPanel.test.tsx src/components/SegmentedTTS/SegmentRow.test.tsx`
Expected: FAIL（prop 不存在 / badge 不存在 / data 属性不存在）

- [x] **Step 3: Implement**

1. i18n —— `zh-CN.ts` 的 `segmentEdit` 节（现有，含 `followGlobal` 等 key）加：

```ts
    lowercaseLatin: '大写词转小写',
    lowercaseLatinFollow: '跟随项目',
    lowercaseLatinOn: '开',
    lowercaseLatinOff: '关',
    lowercaseLatinHint: '合成时把全大写拉丁词（如 REST API）转小写，避免逐字母朗读；默认跟随项目设置。',
```

`segmentRow` 相关 key 放在现有 `segment` 命名空间的 `segmentRow` 子节：

```ts
      pronunciationBadgeTooltip: '合成时应用的发音映射',
```

en-US：

```ts
    lowercaseLatin: 'Lowercase ALL-CAPS words',
    lowercaseLatinFollow: 'Follow project',
    lowercaseLatinOn: 'On',
    lowercaseLatinOff: 'Off',
    lowercaseLatinHint: 'Lowercase ALL-CAPS latin words (e.g. REST API) before synthesis to avoid letter-by-letter reading; follows project setting by default.',
```

```ts
      pronunciationBadgeTooltip: 'Pronunciation map applied at synthesis',
```

2. `SegmentEditPanel.tsx` — props 接口（:21-36）加：

```ts
  /** 段级合成文本变换写回（大写词转小写三态）；即改即存 */
  onUpdateTextTransforms?: (id: string, transforms: import('../../types').SegmentTextTransforms | null) => void;
```

情绪 chips 区块（:231-243）之后插入：

```tsx
        {/* 大写词转小写：三态（跟随项目 / 开 / 关），即改即存 */}
        {onUpdateTextTransforms && (
          <div className={styles.section}>
            <span className={styles.sectionLabel}>{t('segmentEdit.lowercaseLatin')}</span>
            <div className={styles.enginePills}>
              {([null, true, false] as const).map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  aria-pressed={(segment.text_transforms?.lowercase_latin ?? null) === v}
                  className={`${styles.enginePill} ${(segment.text_transforms?.lowercase_latin ?? null) === v ? styles.enginePillActive : ''}`}
                  aria-label={v === null ? t('segmentEdit.lowercaseLatinFollow') : v ? t('segmentEdit.lowercaseLatinOn') : t('segmentEdit.lowercaseLatinOff')}
                  onClick={() => onUpdateTextTransforms(segment.id, { ...(segment.text_transforms ?? {}), lowercase_latin: v })}
                >
                  {v === null ? t('segmentEdit.lowercaseLatinFollow') : v ? t('segmentEdit.lowercaseLatinOn') : t('segmentEdit.lowercaseLatinOff')}
                </button>
              ))}
            </div>
            <p className={styles.hint}>{t('segmentEdit.lowercaseLatinHint')}</p>
          </div>
        )}
```

（包裹 className 用该文件情绪/引擎区块实际使用的容器类——若 `styles.section`/`styles.sectionLabel`/`styles.hint` 不存在，换成现有区块的类名；pills 复用 `enginePill`/`enginePillActive`。）

3. `SegmentList.tsx` — props 接口加：

```ts
  /** 搜索结果跳转后闪烁高亮的段 id */
  flashId?: string | null;
  /** 每段已应用的发音映射（🗣 badge tooltip）：segmentId → 生效条目 */
  pronunciationPreviews?: Record<string, { source: string; target: string }[]>;
  /** 段级合成文本变换写回（编辑面板三态） */
  onUpdateTextTransforms?: (id: string, transforms: import('../../types').SegmentTextTransforms | null) => void;
```

`rowProps` 返回对象加：

```ts
    flash: props.flashId === seg.id,
    pronunciationPreview: props.pronunciationPreviews?.[seg.id],
```

内联 `SegmentEditPanel`（:181-195）props 加：

```tsx
                  onUpdateTextTransforms={props.onUpdateTextTransforms}
```

4. `SegmentRow.tsx` — props 接口（:9-63）加：

```ts
  /** 搜索结果跳转后的闪烁高亮 */
  flash?: boolean;
  /** 已应用的发音映射（🗣 badge；空/缺省不显示） */
  pronunciationPreview?: { source: string; target: string }[];
```

expanded `.badges` 容器内（:600 `ssmlMark` 附近）加：

```tsx
        {pronunciationPreview && pronunciationPreview.length > 0 && (
          <span
            className={styles.pronunciationBadge}
            title={`${t('segment.segmentRow.pronunciationBadgeTooltip')}\n${pronunciationPreview.map(p => `${p.source}→${p.target}`).join('\n')}`}
          >
            🗣 {pronunciationPreview.length}
          </span>
        )}
```

compact badges 区（:469-495）加同款（类名相同）。

`SegmentRow.module.css` 加：

```css
.pronunciationBadge {
  font-size: 0.7rem;
  color: var(--color-text-secondary, #666);
  border: 1px solid var(--color-border, #d0d0d0);
  border-radius: 4px;
  padding: 0 4px;
  cursor: help;
}
```

（注：测试断言 `title` 以 `调动→掉动\nREST→rest` 结尾——若 badge 加了前缀文案，测试断言改为 `toContain('调动→掉动\nREST→rest')`；实现与测试保持一致即可。）

5. `TTSSynthesis.tsx` — `<SegmentList ...>` props 加：

```tsx
                pronunciationPreviews={pronunciationPreviews}
                onUpdateTextTransforms={(id, transforms) => dispatch({ type: 'SET_SEGMENT_TEXT_TRANSFORMS', id, transforms })}
```

（`pronunciationPreviews` memo 在 Task 12 与全局字典 state 一起加；本任务先加一个临时 `const pronunciationPreviews = useMemo(() => ({} as Record<string, { source: string; target: string }[]>), []);` 占位，Task 12 替换为真实计算。）

- [x] **Step 4: Run tests + lint**

Run: `cd frontend && npx vitest run src/components/SegmentedTTS && npm run lint`
Expected: PASS，lint 无新错误

- [x] **Step 5: Commit**

```bash
git add frontend/src/components/SegmentedTTS/SegmentEditPanel.tsx frontend/src/components/SegmentedTTS/SegmentEditPanel.test.tsx frontend/src/components/SegmentedTTS/SegmentList.tsx frontend/src/components/SegmentedTTS/SegmentRow.tsx frontend/src/components/SegmentedTTS/SegmentRow.module.css frontend/src/components/SegmentedTTS/SegmentRow.test.tsx frontend/src/pages/TTSSynthesis.tsx frontend/src/i18n/zh-CN.ts frontend/src/i18n/en-US.ts
git commit -m "feat(frontend): segment lowercase tri-state + pronunciation badge"
```

---

## Task 12: configApi + PronunciationMapPanel + TTSSynthesis 接线（全局字典获取 + frontend 合成挂接）

**Files:**
- Modify: `frontend/src/services/api.ts:307-336`（configApi 尾部追加）
- Create: `frontend/src/components/SegmentedTTS/PronunciationMapPanel.tsx`、`PronunciationMapPanel.module.css`
- Modify: `frontend/src/pages/TTSSynthesis.tsx`（全局字典 state、面板入口、frontend 合成挂接、真实 pronunciationPreviews）
- Modify: `frontend/src/i18n/zh-CN.ts`、`frontend/src/i18n/en-US.ts`
- Test: `frontend/src/components/SegmentedTTS/PronunciationMapPanel.test.tsx`（新建）

- [x] **Step 1: Write the failing tests**

创建 `PronunciationMapPanel.test.tsx`：

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PronunciationMapEntry, SegmentedProject } from '../../types';
import { PronunciationMapPanel } from './PronunciationMapPanel';

function makeProject(configs?: SegmentedProject['configs']): SegmentedProject {
  const voice = { engine: 'edge_tts' as const, voice: '', rate: '+0%', volume: '+0%' };
  const seg = (id: string, text: string, position: number, text_transforms?: { applied_map_ids?: string[] }) => ({
    id, text, position, voice: { source: 'chapter' as const }, status: 'idle' as const,
    audio: { format: 'mp3' }, segment_kind: 'narration' as const,
    text_transforms, created_at: 'x', updated_at: 'x',
  });
  return {
    schema_version: 2, id: 'p', name: 'P', layout: 'vertical',
    active_chapter_id: 'c1', created_at: 'x', updated_at: 'x', configs,
    chapters: [
      { id: 'c1', name: '夜路', voice, split_config: { delimiters: ['。'], mode: 'rule' }, created_at: 'x', updated_at: 'x',
        segments: [seg('s1', '他调动了队伍。', 0)] },
      { id: 'c2', name: '破庙', voice, split_config: { delimiters: ['。'], mode: 'rule' }, created_at: 'x', updated_at: 'x',
        segments: [seg('s2', '再次调动人马。', 0, { applied_map_ids: ['pm_exist'] })] },
    ],
  };
}

const GLOBAL_MAP: PronunciationMapEntry[] = [
  { id: 'gpm_1', source: '行长', target: '行长(读háng)' },
];

function renderPanel(overrides: Partial<Parameters<typeof PronunciationMapPanel>[0]> = {}) {
  const onUpdateProjectMeta = vi.fn();
  const onSetSegmentTransforms = vi.fn();
  render(
    <PronunciationMapPanel
      open
      project={makeProject()}
      globalMap={GLOBAL_MAP}
      onClose={() => {}}
      onUpdateProjectMeta={onUpdateProjectMeta}
      onSetSegmentTransforms={onSetSegmentTransforms}
      {...overrides}
    />,
  );
  return { onUpdateProjectMeta, onSetSegmentTransforms };
}

describe('PronunciationMapPanel', () => {
  it('全局条目只读展示（带「全局」徽标，无删除按钮）', () => {
    renderPanel();
    expect(screen.getByText('全局')).toBeTruthy();
    expect(screen.getByText(/行长 →/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '删除映射' })).toBeNull();
  });

  it('新增项目映射：校验后回调 onUpdateProjectMeta', () => {
    const { onUpdateProjectMeta } = renderPanel();
    fireEvent.change(screen.getByLabelText('映射原文'), { target: { value: '调动' } });
    fireEvent.change(screen.getByLabelText('替换为'), { target: { value: '掉动' } });
    fireEvent.click(screen.getByRole('button', { name: '添加映射' }));
    expect(onUpdateProjectMeta).toHaveBeenCalledWith({
      pronunciation_map: [expect.objectContaining({ source: '调动', target: '掉动', id: expect.stringMatching(/^pm_/) })],
    });
  });

  it('原文为空或与项目字典重复时给出错误提示且不回调', () => {
    const { onUpdateProjectMeta } = renderPanel({
      project: makeProject({ pronunciation_map: [{ id: 'pm_1', source: '调动', target: '掉动' }] }),
    });
    fireEvent.change(screen.getByLabelText('映射原文'), { target: { value: '调动' } });
    fireEvent.click(screen.getByRole('button', { name: '添加映射' }));
    expect(screen.getByRole('alert').textContent).toContain('唯一');
    expect(onUpdateProjectMeta).not.toHaveBeenCalled();
  });

  it('选中映射后列出全项目命中段，含替换后效果预览', () => {
    renderPanel({ project: makeProject({ pronunciation_map: [{ id: 'pm_1', source: '调动', target: '掉动' }] }) });
    fireEvent.click(screen.getByRole('button', { name: /调动 → 掉动/ }));
    expect(screen.getByText('2 个命中段')).toBeTruthy();
    expect(screen.getByText('他掉动了队伍。')).toBeTruthy();
    expect(screen.getByText('再次掉动人马。')).toBeTruthy();
  });

  it('勾选命中段写回 applied_map_ids（保留已有引用）', () => {
    const { onSetSegmentTransforms } = renderPanel({
      project: makeProject({ pronunciation_map: [{ id: 'pm_1', source: '调动', target: '掉动' }] }),
    });
    fireEvent.click(screen.getByRole('button', { name: /调动 → 掉动/ }));
    const boxes = screen.getAllByLabelText('应用到该段');
    fireEvent.click(boxes[1]);  // s2 已引用 pm_exist
    expect(onSetSegmentTransforms).toHaveBeenCalledWith('s2', { applied_map_ids: ['pm_exist', 'pm_1'] });
  });

  it('删除被引用映射：确认后清理引用并更新项目字典', () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const { onUpdateProjectMeta, onSetSegmentTransforms } = renderPanel({
      project: makeProject({ pronunciation_map: [{ id: 'pm_exist', source: '调动', target: '掉动' }] }),
    });
    const deleteButtons = screen.getAllByRole('button', { name: '删除映射' });
    fireEvent.click(deleteButtons[0]);
    expect(window.confirm).toHaveBeenCalled();
    expect(onSetSegmentTransforms).toHaveBeenCalledWith('s2', { applied_map_ids: [] });
    expect(onUpdateProjectMeta).toHaveBeenCalledWith({ pronunciation_map: [] });
    vi.unstubAllGlobals();
  });

  it('pronunciation_apply_all 开启时勾选列表置灰并提示', () => {
    renderPanel({
      project: makeProject({
        pronunciation_map: [{ id: 'pm_1', source: '调动', target: '掉动' }],
        pronunciation_apply_all: true,
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: /调动 → 掉动/ }));
    expect(screen.getByText(/全量应用发音映射/)).toBeTruthy();
    expect((screen.getAllByLabelText('应用到该段')[0] as HTMLInputElement).disabled).toBe(true);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/SegmentedTTS/PronunciationMapPanel.test.tsx`
Expected: FAIL（组件不存在）

- [x] **Step 3: Implement**

1. i18n —— `zh-CN.ts` 顶层加 `pronunciationMap` 节：

```ts
  pronunciationMap: {
    title: '发音映射',
    description: '合成时把「原文」替换为「替换为」再送 TTS 引擎，修正多音字/读错词；显示文本与字幕保持原文。',
    sourceLabel: '映射原文',
    sourcePlaceholder: '如：调动',
    targetLabel: '替换为',
    targetPlaceholder: '如：掉动',
    noteLabel: '备注（可选）',
    notePlaceholder: '如：edge_tts 读错',
    add: '添加映射',
    delete: '删除映射',
    globalBadge: '全局',
    overriddenHint: '已被项目级同名映射覆盖',
    hitCount: '{count} 个命中段',
    selectAll: '全选',
    applyToSegment: '应用到该段',
    applyAllActiveHint: '项目设置已开启「全量应用发音映射」，所有段自动生效，无需逐段勾选。',
    deleteConfirm: '删除该映射？',
    deleteConfirmWithRefs: '{count} 个段正在引用该映射，删除后将同时清理这些引用。确认删除？',
    errorSourceEmpty: '映射原文不能为空',
    errorSourceDuplicate: '同一字典内映射原文必须唯一',
  },
```

en-US：

```ts
  pronunciationMap: {
    title: 'Pronunciation Map',
    description: 'At synthesis time, "source" is replaced with "target" before text is sent to the TTS engine, fixing mispronunciations. Display text and subtitles keep the original.',
    sourceLabel: 'Source text',
    sourcePlaceholder: 'e.g. 调动',
    targetLabel: 'Replace with',
    targetPlaceholder: 'e.g. 掉动',
    noteLabel: 'Note (optional)',
    notePlaceholder: 'e.g. misread by edge_tts',
    add: 'Add mapping',
    delete: 'Delete mapping',
    globalBadge: 'Global',
    overriddenHint: 'Overridden by a project mapping with the same source',
    hitCount: '{count} matching segments',
    selectAll: 'Select all',
    applyToSegment: 'Apply to this segment',
    applyAllActiveHint: '"Apply pronunciation map to all segments" is on in project settings; every segment is covered, no per-segment selection needed.',
    deleteConfirm: 'Delete this mapping?',
    deleteConfirmWithRefs: '{count} segments reference this mapping; deleting also removes those references. Continue?',
    errorSourceEmpty: 'Source text cannot be empty',
    errorSourceDuplicate: 'Source text must be unique within a dictionary',
  },
```

2. `api.ts` — `configApi` 内（`snapshotNarrationGit` 之后）加（文件顶部 import 处补 `PronunciationMapEntry` 类型）：

```ts
  getPronunciationMapGlobal: async (): Promise<{ entries: PronunciationMapEntry[] }> => {
    const { data } = await api.get<{ entries: PronunciationMapEntry[] }>('/config/pronunciation-map-global');
    return data;
  },

  setPronunciationMapGlobal: async (entries: PronunciationMapEntry[]): Promise<{ entries: PronunciationMapEntry[] }> => {
    const { data } = await api.put<{ entries: PronunciationMapEntry[] }>('/config/pronunciation-map-global', { entries });
    return data;
  },
```

3. 创建 `PronunciationMapPanel.tsx`：

```tsx
/**
 * 发音映射面板（Studio 内）：
 * - 项目字典 CRUD（写 project.configs.pronunciation_map，随整项目自动保存）
 * - 全局字典只读展示（「全局」徽标；被项目同名条目覆盖的灰显提示）
 * - 选中条目后用 useSegmentSearch 列出全项目命中段：复选框逐段应用 +
 *   全选 + 「替换后效果」预览（textTransforms 镜像计算，与后端一致）
 * - 项目设置开启 pronunciation_apply_all 时勾选列表置灰（全量自动生效）
 */
import { useMemo, useState } from 'react';
import { useTranslation } from '../../i18n';
import type { PronunciationMapEntry, SegmentTextTransforms, SegmentedProject } from '../../types';
import { useSegmentSearch } from '../../hooks/useSegmentSearch';
import { applyPronunciationMap, mergePronunciationMaps } from '../../services/textTransforms';
import styles from './PronunciationMapPanel.module.css';

function newProjectMapId(): string {
  return `pm_${Math.random().toString(36).slice(2, 8)}`;
}

interface PronunciationMapPanelProps {
  open: boolean;
  project: SegmentedProject;
  /** 全局字典（/settings 维护），面板内只读 */
  globalMap: PronunciationMapEntry[];
  onClose: () => void;
  onUpdateProjectMeta: (meta: { pronunciation_map?: PronunciationMapEntry[] | null }) => void;
  onSetSegmentTransforms: (segmentId: string, transforms: SegmentTextTransforms | null) => void;
}

export function PronunciationMapPanel({
  open, project, globalMap, onClose, onUpdateProjectMeta, onSetSegmentTransforms,
}: PronunciationMapPanelProps) {
  const { t } = useTranslation();
  const projectMap = useMemo(
    () => ((project.configs?.pronunciation_map as PronunciationMapEntry[] | null | undefined) ?? []),
    [project.configs],
  );
  const applyAll = Boolean(project.configs?.pronunciation_apply_all);
  const merged = useMemo(() => mergePronunciationMaps(globalMap, projectMap), [globalMap, projectMap]);

  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedEntry = merged.find(e => e.source === selectedSource) ?? null;
  const hits = useSegmentSearch(project, selectedEntry?.source ?? '');

  const segmentById = useMemo(() => {
    const m = new Map<string, { id: string; text: string; text_transforms?: SegmentTextTransforms | null }>();
    for (const ch of project.chapters) {
      for (const s of ch.segments) m.set(s.id, s);
    }
    return m;
  }, [project.chapters]);

  if (!open) return null;

  const handleAdd = () => {
    const src = source.trim();
    if (!src) { setError(t('pronunciationMap.errorSourceEmpty')); return; }
    if (projectMap.some(e => e.source === src)) { setError(t('pronunciationMap.errorSourceDuplicate')); return; }
    const entry: PronunciationMapEntry = {
      id: newProjectMapId(), source: src, target,
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    onUpdateProjectMeta({ pronunciation_map: [...projectMap, entry] });
    setSource(''); setTarget(''); setNote(''); setError(null);
    setSelectedSource(src);
  };

  const handleDelete = (entry: PronunciationMapEntry) => {
    const referencing = project.chapters
      .flatMap(ch => ch.segments)
      .filter(s => (s.text_transforms?.applied_map_ids ?? []).includes(entry.id));
    const msg = referencing.length > 0
      ? t('pronunciationMap.deleteConfirmWithRefs', { count: referencing.length })
      : t('pronunciationMap.deleteConfirm');
    if (!window.confirm(msg)) return;
    for (const s of referencing) {
      const prev = s.text_transforms ?? {};
      onSetSegmentTransforms(s.id, {
        ...prev,
        applied_map_ids: (prev.applied_map_ids ?? []).filter(id => id !== entry.id),
      });
    }
    onUpdateProjectMeta({ pronunciation_map: projectMap.filter(e => e.id !== entry.id) });
    if (selectedSource === entry.source) setSelectedSource(null);
  };

  const handleToggleHit = (segmentId: string) => {
    if (!selectedEntry) return;
    const seg = segmentById.get(segmentId);
    const prev = seg?.text_transforms ?? {};
    const ids = new Set(prev.applied_map_ids ?? []);
    if (ids.has(selectedEntry.id)) ids.delete(selectedEntry.id);
    else ids.add(selectedEntry.id);
    onSetSegmentTransforms(segmentId, { ...prev, applied_map_ids: [...ids] });
  };

  const handleSelectAll = () => {
    if (!selectedEntry) return;
    for (const hit of hits) {
      const seg = segmentById.get(hit.segmentId);
      const prev = seg?.text_transforms ?? {};
      const ids = new Set(prev.applied_map_ids ?? []);
      if (!ids.has(selectedEntry.id)) {
        ids.add(selectedEntry.id);
        onSetSegmentTransforms(hit.segmentId, { ...prev, applied_map_ids: [...ids] });
      }
    }
  };

  return (
    <div className={styles.overlay} role="dialog" aria-label={t('pronunciationMap.title')}>
      <div className={styles.panel}>
        <header className={styles.header}>
          <h2>{t('pronunciationMap.title')}</h2>
          <button type="button" aria-label={t('common.close')} onClick={onClose}>×</button>
        </header>
        <p className={styles.desc}>{t('pronunciationMap.description')}</p>

        <div className={styles.addForm}>
          <input aria-label={t('pronunciationMap.sourceLabel')} placeholder={t('pronunciationMap.sourcePlaceholder')}
            value={source} onChange={(e) => setSource(e.target.value)} />
          <input aria-label={t('pronunciationMap.targetLabel')} placeholder={t('pronunciationMap.targetPlaceholder')}
            value={target} onChange={(e) => setTarget(e.target.value)} />
          <input aria-label={t('pronunciationMap.noteLabel')} placeholder={t('pronunciationMap.notePlaceholder')}
            value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="button" onClick={handleAdd}>{t('pronunciationMap.add')}</button>
        </div>
        {error && <p role="alert" className={styles.error}>{error}</p>}

        <div className={styles.body}>
          <ul className={styles.entryList}>
            {merged.map((entry) => {
              const isGlobal = entry.id.startsWith('gpm_');
              const overridden = isGlobal && projectMap.some(e => e.source === entry.source);
              return (
                <li key={entry.id} className={styles.entryRow}>
                  <button
                    type="button"
                    className={`${styles.entry} ${selectedSource === entry.source ? styles.entryActive : ''} ${overridden ? styles.entryOverridden : ''}`}
                    onClick={() => setSelectedSource(entry.source)}
                  >
                    <span>{entry.source} → {entry.target}</span>
                    {isGlobal && <span className={styles.globalBadge}>{t('pronunciationMap.globalBadge')}</span>}
                    {overridden && <span className={styles.overriddenHint}>{t('pronunciationMap.overriddenHint')}</span>}
                  </button>
                  {!isGlobal && (
                    <button type="button" aria-label={t('pronunciationMap.delete')}
                      className={styles.deleteBtn} onClick={() => handleDelete(entry)}>🗑</button>
                  )}
                </li>
              );
            })}
          </ul>

          <div className={styles.hits}>
            {selectedEntry && (
              <>
                {applyAll && <p className={styles.applyAllHint}>{t('pronunciationMap.applyAllActiveHint')}</p>}
                <div className={styles.hitsHeader}>
                  <span>{t('pronunciationMap.hitCount', { count: hits.length })}</span>
                  <button type="button" disabled={applyAll} onClick={handleSelectAll}>
                    {t('pronunciationMap.selectAll')}
                  </button>
                </div>
                <ul>
                  {hits.map((hit) => {
                    const seg = segmentById.get(hit.segmentId);
                    const applied = (seg?.text_transforms?.applied_map_ids ?? []).includes(selectedEntry.id);
                    const preview = seg ? applyPronunciationMap(seg.text, [selectedEntry]) : '';
                    return (
                      <li key={hit.segmentId} className={styles.hitRow}>
                        <label>
                          <input
                            type="checkbox"
                            disabled={applyAll}
                            checked={applyAll || applied}
                            onChange={() => handleToggleHit(hit.segmentId)}
                            aria-label={t('pronunciationMap.applyToSegment')}
                          />
                          <span className={styles.hitLoc}>{hit.chapterName} #{hit.position + 1}</span>
                        </label>
                        <span className={styles.hitPreview}>{preview}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

4. 创建 `PronunciationMapPanel.module.css`：

```css
.overlay {
  position: fixed; inset: 0; z-index: 60; background: rgb(0 0 0 / 0.35);
  display: flex; align-items: center; justify-content: center;
}
.panel {
  width: min(860px, 92vw); max-height: 84vh; overflow-y: auto;
  background: var(--color-bg, #fff); border-radius: var(--radius-lg, 14px);
  padding: 20px 24px; box-shadow: 0 16px 48px rgb(0 0 0 / 0.2);
}
.header { display: flex; justify-content: space-between; align-items: center; }
.header h2 { margin: 0; font-size: 1.1rem; }
.desc { color: var(--color-text-secondary, #666); font-size: 0.82rem; }
.addForm { display: flex; gap: 8px; margin: 12px 0; flex-wrap: wrap; }
.addForm input {
  padding: 6px 10px; border-radius: var(--radius-sm, 6px);
  border: 1px solid var(--color-border, #d0d0d0); font-size: 0.85rem;
}
.error { color: var(--color-danger, #d33); font-size: 0.82rem; }
.body { display: grid; grid-template-columns: 1fr 1.4fr; gap: 16px; }
.entryList { list-style: none; margin: 0; padding: 0; }
.entryRow { display: flex; align-items: center; gap: 4px; }
.entry {
  flex: 1; text-align: left; padding: 6px 10px; border-radius: var(--radius-sm, 6px);
  border: 1px solid transparent; background: transparent; cursor: pointer; font-size: 0.85rem;
  display: flex; gap: 6px; align-items: center;
}
.entryActive { border-color: var(--color-primary, #4a6cf7); background: var(--color-bg-hover, #f0f2ff); }
.entryOverridden { opacity: 0.55; }
.globalBadge {
  font-size: 0.68rem; padding: 0 5px; border-radius: 4px;
  background: var(--color-primary-soft, #e5ebff); color: var(--color-primary, #4a6cf7);
}
.overriddenHint { font-size: 0.68rem; color: var(--color-text-secondary, #666); }
.deleteBtn { border: none; background: transparent; cursor: pointer; }
.hitsHeader { display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; margin-bottom: 6px; }
.hits ul { list-style: none; margin: 0; padding: 0; }
.hitRow { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; border-bottom: 1px solid var(--color-border, #eee); }
.hitRow label { display: flex; gap: 6px; align-items: center; font-size: 0.82rem; }
.hitLoc { color: var(--color-text-secondary, #666); font-size: 0.75rem; }
.hitPreview { font-size: 0.85rem; padding-left: 22px; }
.applyAllHint { font-size: 0.78rem; color: var(--color-text-secondary, #666); background: var(--color-bg-hover, #f5f5f5); padding: 6px 10px; border-radius: 6px; }
```

5. `TTSSynthesis.tsx`：

import 区加：

```ts
import { PronunciationMapPanel } from '../components/SegmentedTTS/PronunciationMapPanel';
import { configApi } from '../services/api';  // 若已导入则合并
import type { PronunciationMapEntry } from '../types';
import { mergePronunciationMaps, resolveSegmentEngineText } from '../services/textTransforms';
```

（注意 :18 已有 `import { textSplitApi, ttsApi, ..., apiErrorCode } from '../services/api'`——把 `configApi` 并入该行的导入清单，不新增一行重复 import。`mergePronunciationMaps`/`resolveSegmentEngineText` 同样并入或新增一条 import。）

state 区加：

```ts
  // 发音映射：全局字典（/settings 维护）；打开面板时重新拉取
  const [globalPronunciationMap, setGlobalPronunciationMap] = useState<PronunciationMapEntry[]>([]);
  const [pronunciationPanelOpen, setPronunciationPanelOpen] = useState(false);
```

effect（挂在 `handleSearchNavigate` 附近）：

```ts
  useEffect(() => {
    let alive = true;
    configApi.getPronunciationMapGlobal()
      .then(res => { if (alive) setGlobalPronunciationMap(res.entries ?? []); })
      .catch(() => { /* 全局字典不可用时按空表处理 */ });
    return () => { alive = false; };
  }, [pronunciationPanelOpen]);  // 打开面板时刷新（/settings 可能刚改过）
```

生效字典 + badge previews memo（替换 Task 11 的临时空对象占位）：

```ts
  const mergedPronunciationMap = useMemo(
    () => mergePronunciationMaps(
      globalPronunciationMap,
      (project.configs?.pronunciation_map as PronunciationMapEntry[] | null | undefined) ?? [],
    ),
    [globalPronunciationMap, project.configs?.pronunciation_map],
  );

  // 每段已应用映射的 source→target（SegmentRow 🗣 badge tooltip；悬空 id 已被 filter 掉）
  const pronunciationPreviews = useMemo(() => {
    const out: Record<string, { source: string; target: string }[]> = {};
    for (const ch of project.chapters) {
      for (const seg of ch.segments) {
        const ids = seg.text_transforms?.applied_map_ids ?? [];
        const entries = mergedPronunciationMap.filter(e => ids.includes(e.id));
        if (entries.length > 0) out[seg.id] = entries.map(e => ({ source: e.source, target: e.target }));
      }
    }
    return out;
  }, [project.chapters, mergedPronunciationMap]);
```

工具栏 `productionRight` div 内（视图切换前）加入口按钮：

```tsx
                <button
                  type="button"
                  className={styles.toolbarPill}
                  onClick={() => setPronunciationPanelOpen(true)}
                >
                  {t('pronunciationMap.title')}
                </button>
```

面板挂载（`<ExportDialog` 附近，组件树尾部）：

```tsx
      <PronunciationMapPanel
        open={pronunciationPanelOpen}
        project={project}
        globalMap={globalPronunciationMap}
        onClose={() => setPronunciationPanelOpen(false)}
        onUpdateProjectMeta={(meta) => dispatch({ type: 'SET_PROJECT_META', meta })}
        onSetSegmentTransforms={(id, transforms) => dispatch({ type: 'SET_SEGMENT_TEXT_TRANSFORMS', id, transforms })}
      />
```

frontend 存储模式合成挂接（:1308-1317 区块）——把：

```ts
      const underscoreToSpaceEffective = Boolean(effectiveParams.underscore_to_space) || Boolean(project.configs?.underscore_to_space);
      const skipParenthesizedEffective = Boolean(effectiveParams.skip_parenthesized) || Boolean(project.configs?.skip_parenthesized);
      const textForEngine = applyEngineTextCleaning(textToSend, {
        skipParenthesized: skipParenthesizedEffective,
        underscoreToSpace: underscoreToSpaceEffective,
      });
```

改为：

```ts
      const underscoreToSpaceEffective = Boolean(effectiveParams.underscore_to_space) || Boolean(project.configs?.underscore_to_space);
      const skipParenthesizedEffective = Boolean(effectiveParams.skip_parenthesized) || Boolean(project.configs?.skip_parenthesized);
      // 合成时文本变换（发音映射 + 大写转小写）：backend 模式由后端合成管道执行，
      // frontend 模式在此镜像执行（规则与后端 text_transform_service.py 一致）；
      // 先于引擎文本清洗，只影响送引擎文本，seg.text/字幕保持原文。
      const transformedText = resolveSegmentEngineText(textToSend, {
        globalMap: globalPronunciationMap,
        projectMap: (project.configs?.pronunciation_map as PronunciationMapEntry[] | null | undefined) ?? [],
        applyAll: Boolean(project.configs?.pronunciation_apply_all),
        segmentTransforms: seg.text_transforms ?? null,
        projectLowercaseLatin: project.configs?.lowercase_latin ?? null,
      });
      const textForEngine = applyEngineTextCleaning(transformedText, {
        skipParenthesized: skipParenthesizedEffective,
        underscoreToSpace: underscoreToSpaceEffective,
      });
```

（确认该区块作用域里当前段变量名是 `seg`；若实际是别的名字（如 `segment`），以现有代码为准替换。）

- [x] **Step 4: Run tests + lint**

Run: `cd frontend && npx vitest run src/components/SegmentedTTS src/i18n && npm run lint && npm run build`
Expected: PASS；lint/typecheck 无新错误

- [x] **Step 5: Commit**

```bash
git add frontend/src/services/api.ts frontend/src/components/SegmentedTTS/PronunciationMapPanel.tsx frontend/src/components/SegmentedTTS/PronunciationMapPanel.module.css frontend/src/components/SegmentedTTS/PronunciationMapPanel.test.tsx frontend/src/pages/TTSSynthesis.tsx frontend/src/i18n/zh-CN.ts frontend/src/i18n/en-US.ts
git commit -m "feat(frontend): pronunciation map panel + global map fetch + frontend-mode transforms"
```

---

## Task 13: /settings 全局发音字典编辑器

**Files:**
- Create: `frontend/src/components/Settings/PronunciationMapSetting.tsx`、`PronunciationMapSetting.module.css`
- Modify: `frontend/src/pages/ModelConfig.tsx:280-281`（挂载）
- Modify: `frontend/src/i18n/zh-CN.ts`、`frontend/src/i18n/en-US.ts`
- Test: `frontend/src/components/Settings/PronunciationMapSetting.test.tsx`（新建）

- [x] **Step 1: Write the failing test**

创建 `PronunciationMapSetting.test.tsx`（mock 模式照 `AnimationRootSetting.test.tsx`）：

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { getPronunciationMapGlobal, setPronunciationMapGlobal } = vi.hoisted(() => ({
  getPronunciationMapGlobal: vi.fn(),
  setPronunciationMapGlobal: vi.fn(),
}));
vi.mock('../../services/api', () => ({
  configApi: { getPronunciationMapGlobal, setPronunciationMapGlobal },
}));

import { PronunciationMapSetting } from './PronunciationMapSetting';

describe('PronunciationMapSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPronunciationMapGlobal.mockResolvedValue({
      entries: [{ id: 'gpm_1', source: '调动', target: '掉动', note: 'edge_tts 读错' }],
    });
    setPronunciationMapGlobal.mockImplementation(async (entries) => ({ entries }));
  });

  it('加载并展示已有全局映射', async () => {
    render(<PronunciationMapSetting />);
    await waitFor(() => expect(screen.getByDisplayValue('调动')).toBeTruthy());
    expect(screen.getByDisplayValue('掉动')).toBeTruthy();
    expect(screen.getByDisplayValue('edge_tts 读错')).toBeTruthy();
  });

  it('新增一行并保存（id 带 gpm_ 前缀）；保存前提示影响范围', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    render(<PronunciationMapSetting />);
    await waitFor(() => expect(screen.getByDisplayValue('调动')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '添加映射' }));
    const sourceInputs = screen.getAllByLabelText('映射原文');
    fireEvent.change(sourceInputs[1], { target: { value: '行长' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(setPronunciationMapGlobal).toHaveBeenCalled());
    const saved = setPronunciationMapGlobal.mock.calls[0][0];
    expect(saved).toHaveLength(2);
    expect(saved[1]).toMatchObject({ source: '行长', id: expect.stringMatching(/^gpm_/) });
    vi.unstubAllGlobals();
  });

  it('删除一行后保存', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    render(<PronunciationMapSetting />);
    await waitFor(() => expect(screen.getByDisplayValue('调动')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '删除该行' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(setPronunciationMapGlobal).toHaveBeenCalledWith([]));
    vi.unstubAllGlobals();
  });

  it('后端 400 时展示错误信息', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    setPronunciationMapGlobal.mockRejectedValue({
      response: { data: { detail: { code: 'pronunciation_source_duplicate', message: 'pronunciation_source_duplicate' } } },
    });
    render(<PronunciationMapSetting />);
    await waitFor(() => expect(screen.getByDisplayValue('调动')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('pronunciation_source_duplicate'));
    vi.unstubAllGlobals();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/Settings/PronunciationMapSetting.test.tsx`
Expected: FAIL（组件不存在）

- [x] **Step 3: Implement**

1. i18n —— `zh-CN.ts` 的 `settings` 节加 `pronunciationMap` 子节：

```ts
    pronunciationMap: {
      kicker: 'Pronunciation',
      title: '全局发音映射',
      description: '合成时把「原文」替换为「替换为」再送 TTS 引擎。全局字典对所有项目生效；项目可在 Studio「发音映射」面板用同名条目覆盖。',
      source: '映射原文',
      target: '替换为',
      note: '备注（可选）',
      add: '添加映射',
      deleteRow: '删除该行',
      saveConfirm: '全局字典的改动对所有项目生效，确认保存？',
      saveSuccess: '已保存',
      empty: '暂无映射，点击「添加映射」创建第一条。',
    },
```

en-US：

```ts
    pronunciationMap: {
      kicker: 'Pronunciation',
      title: 'Global pronunciation map',
      description: 'At synthesis time, "source" is replaced with "target" before text is sent to the TTS engine. The global dictionary applies to all projects; a project may override an entry with the same source in the Studio pronunciation panel.',
      source: 'Source text',
      target: 'Replace with',
      note: 'Note (optional)',
      add: 'Add mapping',
      deleteRow: 'Delete row',
      saveConfirm: 'Changes to the global dictionary affect all projects. Save anyway?',
      saveSuccess: 'Saved',
      empty: 'No mappings yet. Click "Add mapping" to create one.',
    },
```

2. 创建 `PronunciationMapSetting.tsx`（结构照 `AnimationRootSetting.tsx`：card + status 反馈 + extractDetail）：

```tsx
/**
 * 全局发音字典编辑器（/settings）：增删改后全量 PUT。
 * 全局条目 id 统一 gpm_ 前缀（项目字典 pm_ 前缀，两层永不冲突）。
 * 保存前 confirm 提示影响范围（改动对所有项目生效）。
 */
import { useCallback, useEffect, useState } from 'react';
import { configApi } from '../../services/api';
import { useTranslation } from '../../i18n';
import type { PronunciationMapEntry } from '../../types';
import styles from './PronunciationMapSetting.module.css';

interface Status {
  type: 'success' | 'error';
  message: string;
}

function extractDetail(err: unknown): string {
  const resp = (err as { response?: { data?: { detail?: unknown } } })?.response;
  const detail = resp?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (typeof detail === 'object' && detail !== null && 'message' in detail) {
    return (detail as { message: string }).message;
  }
  return String(err);
}

function newGlobalMapId(): string {
  return `gpm_${Math.random().toString(36).slice(2, 8)}`;
}

export function PronunciationMapSetting() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<PronunciationMapEntry[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    configApi.getPronunciationMapGlobal()
      .then((res) => { if (alive) setEntries(res.entries ?? []); })
      .catch(() => { /* 读取失败按空表处理，仍可编辑 */ });
    return () => { alive = false; };
  }, []);

  const updateEntry = (id: string, patch: Partial<PronunciationMapEntry>) => {
    setEntries(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)));
  };

  const handleAdd = () => {
    setEntries(prev => [...prev, { id: newGlobalMapId(), source: '', target: '' }]);
  };

  const handleDelete = (id: string) => {
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  const handleSave = useCallback(async () => {
    if (!window.confirm(t('settings.pronunciationMap.saveConfirm'))) return;
    setBusy(true);
    setStatus(null);
    try {
      const payload = entries.map(e => ({ ...e, source: e.source.trim(), target: e.target }));
      const res = await configApi.setPronunciationMapGlobal(payload);
      setEntries(res.entries ?? []);
      setStatus({ type: 'success', message: t('settings.pronunciationMap.saveSuccess') });
    } catch (err) {
      setStatus({ type: 'error', message: extractDetail(err) });
    } finally {
      setBusy(false);
    }
  }, [entries, t]);

  return (
    <section className={styles.card}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>{t('settings.pronunciationMap.kicker')}</span>
          <h2 className={styles.title}>{t('settings.pronunciationMap.title')}</h2>
          <p className={styles.desc}>{t('settings.pronunciationMap.description')}</p>
        </div>
      </header>
      <div className={styles.body}>
        {entries.length === 0 && <p className={styles.empty}>{t('settings.pronunciationMap.empty')}</p>}
        {entries.map((entry) => (
          <div key={entry.id} className={styles.row}>
            <input aria-label={t('settings.pronunciationMap.source')} value={entry.source}
              onChange={(e) => updateEntry(entry.id, { source: e.target.value })} />
            <input aria-label={t('settings.pronunciationMap.target')} value={entry.target}
              onChange={(e) => updateEntry(entry.id, { target: e.target.value })} />
            <input aria-label={t('settings.pronunciationMap.note')} value={entry.note ?? ''}
              onChange={(e) => updateEntry(entry.id, { note: e.target.value || undefined })} />
            <button type="button" aria-label={t('settings.pronunciationMap.deleteRow')}
              className={styles.deleteBtn} onClick={() => handleDelete(entry.id)}>🗑</button>
          </div>
        ))}
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={handleAdd}>
            {t('settings.pronunciationMap.add')}
          </button>
          <button type="button" className={styles.primary} onClick={handleSave} disabled={busy}>
            {t('common.save')}
          </button>
        </div>
        {status && (
          <p role="alert" className={status.type === 'success' ? styles.success : styles.error}>
            {status.message}
          </p>
        )}
      </div>
    </section>
  );
}
```

（若 zh-CN 里 `common.save` 不存在，用 `settings.pronunciationMap` 节内自加的 `save: '保存'`；先 grep 确认 `common.save` 已存在——AnimationRootSetting 已用 `t('common.save')`，存在。）

3. 创建 `PronunciationMapSetting.module.css`：

```css
.card {
  background: var(--color-bg, #fff); border: 1px solid var(--color-border, #e0e0e0);
  border-radius: var(--radius-lg, 14px); padding: 20px 24px; margin-top: 16px;
}
.kicker { font-size: 0.72rem; letter-spacing: 0.08em; color: var(--color-text-secondary, #666); text-transform: uppercase; }
.title { margin: 4px 0; font-size: 1.05rem; }
.desc { color: var(--color-text-secondary, #666); font-size: 0.82rem; }
.body { display: flex; flex-direction: column; gap: 8px; }
.empty { color: var(--color-text-secondary, #666); font-size: 0.82rem; }
.row { display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 8px; align-items: center; }
.row input {
  padding: 6px 10px; border-radius: var(--radius-sm, 6px);
  border: 1px solid var(--color-border, #d0d0d0); font-size: 0.85rem;
}
.deleteBtn { border: none; background: transparent; cursor: pointer; }
.actions { display: flex; gap: 8px; margin-top: 8px; }
.primary {
  padding: 6px 16px; border-radius: var(--radius-sm, 6px); border: none; cursor: pointer;
  background: var(--color-primary, #4a6cf7); color: #fff;
}
.secondary {
  padding: 6px 16px; border-radius: var(--radius-sm, 6px); cursor: pointer;
  border: 1px solid var(--color-border, #d0d0d0); background: transparent;
}
.success { color: var(--color-success, #2a7); font-size: 0.82rem; }
.error { color: var(--color-danger, #d33); font-size: 0.82rem; }
```

4. `ModelConfig.tsx`（:280-281）挂载：

```tsx
      <AnimationRootSetting />
      <PronunciationMapSetting />
      <NarrationGitSetting />
```

（import 区加 `import { PronunciationMapSetting } from '../components/Settings/PronunciationMapSetting';`）

- [x] **Step 4: Run tests + lint**

Run: `cd frontend && npx vitest run src/components/Settings src/i18n && npm run lint`
Expected: PASS，lint 无新错误

- [x] **Step 5: Commit**

```bash
git add frontend/src/components/Settings/PronunciationMapSetting.tsx frontend/src/components/Settings/PronunciationMapSetting.module.css frontend/src/components/Settings/PronunciationMapSetting.test.tsx frontend/src/pages/ModelConfig.tsx frontend/src/i18n/zh-CN.ts frontend/src/i18n/en-US.ts
git commit -m "feat(frontend): global pronunciation map editor on settings page"
```

---

## Task 14: E2E（tests/e2e/specs/studio-text-transforms.spec.ts）

**Files:**
- Create: `tests/e2e/specs/studio-text-transforms.spec.ts`
- Modify: `docs/e2e-test-guide.md`（登记新 spec）

前置约定（来自现有 spec）：
- e2e 跑 backend 存储模式；`seedTestProject` 建 `test-e2e-project`（`test-chapter-1/2`）。
- `readBackendProject(page, id)` 读 API 层；合成按钮拦截用 `interceptPostResponse(page, '/synthesize')`。
- 真实 edge_tts 合成，轮询 60s。
- 双读校验：UI 操作 → API 读数据 → 关键行 DB/回显。

- [x] **Step 1: 编写 spec**

创建 `tests/e2e/specs/studio-text-transforms.spec.ts`：

```ts
/**
 * Studio 全项目搜索 + 合成时文本变换（发音映射 / 大写转小写）E2E.
 *
 * 链路：UI 操作 → 后端持久化（整项目 PUT / config 端点）→ 双读校验
 * （readBackendProject API 层 + 页面回显）→ 合成后 generated_params.effective_text
 * 为实际送引擎文本，segment.text 原文与导出不变。
 *
 * @feature docs/superpowers/specs/2026-08-25-studio-search-and-text-transforms-design.md
 */
import { expect, test } from '@playwright/test';
import { E2E_BACKEND_URL } from '../helpers/ports';
import {
  collectErrors,
  setLocaleToZhCN,
  goToStudio,
  readBackendProject,
  interceptPostResponse,
  seedTestProject,
} from '../helpers';

const BACKEND = E2E_BACKEND_URL;
const PROJECT_ID = 'test-e2e-project';
const SEG_ID = 'seg-e2e-transform';

/** 读项目（API 层），失败抛错。 */
async function readProject(page: import('@playwright/test').Page) {
  const p = await readBackendProject(page, PROJECT_ID);
  expect(p).toBeTruthy();
  return p!;
}

async function findSeg(page: import('@playwright/test').Page, segId: string) {
  const p = await readProject(page);
  return p.chapters.flatMap((c) => c.segments).find((s) => s.id === segId);
}

/** 清掉目标段音频使其回到 idle（compact 模式只有 idle 有生成按钮）。 */
async function resetSegmentAudio(page: import('@playwright/test').Page) {
  const resp = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
  const project = await resp.json();
  const seg = project.chapters
    .flatMap((c: { segments: { id: string }[] }) => c.segments)
    .find((s: { id: string }) => s.id === SEG_ID);
  seg.audio = { format: 'mp3' };
  seg.status = 'idle';
  await page.request.put(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`, { data: project });
}

/** 项目级 configs 补丁（发音映射/开关），经整项目 PUT 落库。 */
async function patchProjectConfigs(
  page: import('@playwright/test').Page,
  patch: Record<string, unknown>,
) {
  const resp = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
  const project = await resp.json();
  project.configs = { ...(project.configs ?? {}), ...patch };
  await page.request.put(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`, { data: project });
}

test.describe('Studio 搜索 + 文本变换', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await seedTestProject(page);
      // 本 spec 专用数据：项目字典（调动→掉动）+ 第 2 章含「调动」「REST API」的段
      const resp = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
      const project = await resp.json();
      project.configs = {
        ...(project.configs ?? {}),
        pronunciation_map: [{ id: 'pm_e2e_diaodong', source: '调动', target: '掉动' }],
      };
      const ch2 = project.chapters.find((c: { id: string }) => c.id === 'test-chapter-2');
      if (!ch2.segments.some((s: { id: string }) => s.id === SEG_ID)) {
        ch2.segments.push({
          id: SEG_ID, position: ch2.segments.length,
          text: '他调动了 REST API 接口。', segment_kind: 'narration',
          emotion: 'neutral', voice: { source: 'chapter' }, audio: { format: 'mp3' },
        });
      }
      await page.request.put(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`, { data: project });
    } finally {
      await page.close();
    }
  });

  test.afterAll(async ({ browser }) => {
    // 复位：清掉本 spec 的变换配置与专用段，避免影响其他 spec
    const page = await browser.newPage();
    try {
      const resp = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
      const project = await resp.json();
      if (project.configs) {
        delete project.configs.pronunciation_map;
        delete project.configs.pronunciation_apply_all;
        delete project.configs.lowercase_latin;
      }
      const ch2 = project.chapters.find((c: { id: string }) => c.id === 'test-chapter-2');
      ch2.segments = ch2.segments.filter((s: { id: string }) => s.id !== SEG_ID);
      await page.request.put(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`, { data: project });
    } finally {
      await page.close();
    }
  });

  test('全项目搜索：跨章节命中 → 点击结果切换章节并定位高亮', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);
    await goToStudio(page);

    // 「调动」只在第 2 章的专用段里
    const searchInput = page.getByLabel('搜索全项目片段');
    await searchInput.fill('调动');
    const results = page.getByRole('listbox', { name: '搜索结果' });
    await expect(results).toBeVisible({ timeout: 5_000 });
    await expect(results.getByText('1 处命中')).toBeVisible();

    await results.getByRole('option', { name: /他调动了/ }).click();

    // 章节切换 + 目标段可见 + 闪烁高亮（data-segment-id 锚点 + flash 类）
    const target = page.locator(`[data-segment-id="${SEG_ID}"]`);
    await expect(target).toBeVisible({ timeout: 5_000 });
    await expect(target).toHaveClass(/flash/, { timeout: 3_000 });
    expect(errors).toEqual([]);
  });

  test('发音映射：面板勾选命中段 → 合成文本替换，原文不变', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);
    await goToStudio(page);

    // ── UI: 打开发音映射面板 → 选中「调动 → 掉动」→ 勾选命中段 ──
    await page.getByRole('button', { name: '发音映射' }).click();
    const dialog = page.getByRole('dialog', { name: '发音映射' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /调动 → 掉动/ }).click();
    await expect(dialog.getByText('1 个命中段')).toBeVisible();
    // 替换后效果预览（镜像计算）
    await expect(dialog.getByText('他掉动了 REST API 接口。')).toBeVisible();
    await dialog.getByLabel('应用到该段').check();
    await dialog.getByLabel('关闭').click();

    // ── 双读: applied_map_ids 随整项目 PUT 落库 ──
    await expect.poll(async () => {
      const seg = await findSeg(page, SEG_ID);
      return (seg as unknown as { text_transforms?: { applied_map_ids?: string[] } })
        ?.text_transforms?.applied_map_ids ?? [];
    }, { timeout: 10_000 }).toContain('pm_e2e_diaodong');

    // ── 触发合成（先清音频回 idle，再点生成） ──
    await resetSegmentAudio(page);
    await goToStudio(page);
    // 用搜索切到第 2 章
    await page.getByLabel('搜索全项目片段').fill('调动');
    await page.getByRole('option', { name: /他调动了/ }).click();

    const synthResponsePromise = interceptPostResponse(page, '/synthesize');
    const row = page.locator(`[data-segment-id="${SEG_ID}"]`);
    await row.locator('[class*="compactGenBtn"]').click();
    const synthResponse = await synthResponsePromise;
    expect(synthResponse.status).toBe(200);

    // ── 双读: effective_text = 替换后文本；原文不变 ──
    await expect.poll(async () => {
      const seg = await findSeg(page, SEG_ID);
      return (seg?.generated_params as Record<string, unknown> | undefined)?.effective_text ?? null;
    }, { timeout: 60_000 }).toBe('他掉动了 REST API 接口。');

    const seg = await findSeg(page, SEG_ID);
    expect(seg!.text).toBe('他调动了 REST API 接口。');
    expect(errors).toEqual([]);
  });

  test('pronunciation_apply_all 无脑流程：项目开关 → 任意段全量生效', async ({ page }) => {
    await setLocaleToZhCN(page);
    // 项目设置开关经 API 打开（UI 开关的单元测试已覆盖回调链路）
    await patchProjectConfigs(page, { pronunciation_apply_all: true });
    // 清掉段级引用：证明生效不依赖逐段勾选
    await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`).then(async (r) => {
      const project = await r.json();
      const seg = project.chapters
        .flatMap((c: { segments: { id: string }[] }) => c.segments)
        .find((s: { id: string }) => s.id === SEG_ID);
      delete seg.text_transforms;
      seg.audio = { format: 'mp3' };
      seg.status = 'idle';
      await page.request.put(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`, { data: project });
    });

    await goToStudio(page);
    await page.getByLabel('搜索全项目片段').fill('调动');
    await page.getByRole('option', { name: /他调动了/ }).click();
    const synthResponsePromise = interceptPostResponse(page, '/synthesize');
    await page.locator(`[data-segment-id="${SEG_ID}"]`).locator('[class*="compactGenBtn"]').click();
    expect((await synthResponsePromise).status).toBe(200);

    await expect.poll(async () => {
      const seg = await findSeg(page, SEG_ID);
      return (seg?.generated_params as Record<string, unknown> | undefined)?.effective_text ?? null;
    }, { timeout: 60_000 }).toBe('他掉动了 REST API 接口。');

    await patchProjectConfigs(page, { pronunciation_apply_all: null });
  });

  test('大写转小写：项目默认开 → 段级关覆盖 → 恢复跟随项目', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);
    await patchProjectConfigs(page, { lowercase_latin: true, pronunciation_apply_all: true });

    // ── 段级关覆盖（UI：点击段 → 编辑面板三态「关」） ──
    await resetSegmentAudio(page);
    await goToStudio(page);
    await page.getByLabel('搜索全项目片段').fill('调动');
    await page.getByRole('option', { name: /他调动了/ }).click();
    await page.locator(`[data-segment-id="${SEG_ID}"]`).click();  // 选中 → 手风琴编辑面板
    await page.getByRole('button', { name: '关', exact: true }).click();

    await expect.poll(async () => {
      const seg = await findSeg(page, SEG_ID);
      return (seg as unknown as { text_transforms?: { lowercase_latin?: boolean | null } })
        ?.text_transforms?.lowercase_latin ?? null;
    }, { timeout: 10_000 }).toBe(false);

    // 段级关 → REST API 保持大写；发音映射（apply_all）仍生效
    let synthResponsePromise = interceptPostResponse(page, '/synthesize');
    await resetSegmentAudio(page);
    await goToStudio(page);
    await page.getByLabel('搜索全项目片段').fill('调动');
    await page.getByRole('option', { name: /他调动了/ }).click();
    await page.locator(`[data-segment-id="${SEG_ID}"]`).locator('[class*="compactGenBtn"]').click();
    expect((await synthResponsePromise).status).toBe(200);
    await expect.poll(async () => {
      const seg = await findSeg(page, SEG_ID);
      return (seg?.generated_params as Record<string, unknown> | undefined)?.effective_text ?? null;
    }, { timeout: 60_000 }).toBe('他掉动了 REST API 接口。');

    // ── 恢复「跟随项目」→ 项目默认开 → 小写化生效 ──
    await page.locator(`[data-segment-id="${SEG_ID}"]`).click();
    await page.getByRole('button', { name: '跟随项目' }).click();
    await expect.poll(async () => {
      const seg = await findSeg(page, SEG_ID);
      return (seg as unknown as { text_transforms?: { lowercase_latin?: boolean | null } })
        ?.text_transforms?.lowercase_latin ?? null;
    }, { timeout: 10_000 }).toBe(null);

    synthResponsePromise = interceptPostResponse(page, '/synthesize');
    await resetSegmentAudio(page);
    await goToStudio(page);
    await page.getByLabel('搜索全项目片段').fill('调动');
    await page.getByRole('option', { name: /他调动了/ }).click();
    await page.locator(`[data-segment-id="${SEG_ID}"]`).locator('[class*="compactGenBtn"]').click();
    expect((await synthResponsePromise).status).toBe(200);
    await expect.poll(async () => {
      const seg = await findSeg(page, SEG_ID);
      return (seg?.generated_params as Record<string, unknown> | undefined)?.effective_text ?? null;
    }, { timeout: 60_000 }).toBe('他掉动了 rest api 接口。');

    // 原文始终不变（字幕/SRT 导出同源）
    const seg = await findSeg(page, SEG_ID);
    expect(seg!.text).toBe('他调动了 REST API 接口。');

    await patchProjectConfigs(page, { lowercase_latin: null, pronunciation_apply_all: null });
    expect(errors).toEqual([]);
  });
});
```

- [x] **Step 2: 运行 E2E**

Run: `npx playwright test tests/e2e/specs/studio-text-transforms.spec.ts`
Expected: 4 个用例 PASS（真实 edge_tts 合成，单用例最长 ~60s 轮询）

若 UI 选择器与实现有出入（按钮文案/类名），以 Task 9-13 的实际实现为准微调 spec，不改断言语义。

- [x] **Step 3: 登记 e2e-test-guide**

`docs/e2e-test-guide.md` 的用例清单中追加一行：`studio-text-transforms.spec.ts` — Studio 全项目搜索跳转、发音映射（逐段勾选 + apply_all）、大写转小写（项目默认 + 段级三态覆盖）。

- [x] **Step 4: Commit**

```bash
git add tests/e2e/specs/studio-text-transforms.spec.ts docs/e2e-test-guide.md
git commit -m "test(e2e): studio search + pronunciation map + latin lowercase"
```

---

## Task 15: 文档更新

**Files:**
- Modify: `docs/feature-spec.md`
- Modify: `docs/api-reference.md`
- Modify: `docs/database-schema.md`
- Modify: `backend/tests/TEST_MAP.md`
- Modify: `docs/deployment-feature-matrix.md`

- [x] **Step 1: feature-spec.md**

新增三节（Studio 章节内）：
- **全项目搜索**：工具栏搜索框，输入即搜（大小写不敏感子串），跨章节分组结果（章节名 + 段号 + 高亮片段 + 总命中数），↑/↓/Enter/Esc 键盘导航，点击结果切章节 + 滚动定位 + 闪烁高亮；「含全大写词」快捷过滤器（`[A-Z]{2,}`），过滤器内每段带小写化三态。
- **发音映射**：`{id, source, target, note}`；全局（`gpm_` 前缀，`/settings` 维护）+ 项目（`pm_` 前缀，Studio 发音映射面板维护）双层，同 source 项目覆盖全局；段级 `applied_map_ids` 引用（面板搜索命中段后勾选/全选，含替换后效果预览）；`configs.pronunciation_apply_all` 全量生效开关（项目设置）；合成时长度降序单次替换，只改送引擎文本；删除被引用映射时确认并清理引用，悬空 id 合成忽略；`SegmentRow` 🗣 badge。
- **大写词转小写**：`configs.lowercase_latin` 项目默认 + `segment.text_transforms.lowercase_latin` 三态覆盖（跟随项目/开/关，SegmentEditPanel）；仅 `[A-Z]{2,}`；解析顺序段级 → 项目 → false；映射之后、`prepare_text_for_engine` 之前执行。

- [x] **Step 2: api-reference.md**

- 新增端点：`GET /api/config/pronunciation-map-global` → `{"entries": [{id, source, target, note?}]}`；`PUT /api/config/pronunciation-map-global`（全量替换；400 `pronunciation_source_empty` / `pronunciation_source_duplicate`）。
- segment 对象新增 `text_transforms: {applied_map_ids?: string[], lowercase_latin?: boolean|null} | null` 字段说明；`generated_params.effective_text` 记录实际合成文本。

- [x] **Step 3: database-schema.md**

- `segmented_project_segments` 新增 `text_transforms JSON`（幂等迁移 P19）。
- `system_configs` 新增 key `pronunciation_map_global`（JSON 数组字符串）。
- `project.configs` 新增键：`pronunciation_map` / `pronunciation_apply_all` / `lowercase_latin`。

- [x] **Step 4: TEST_MAP.md**

追加一行：

```markdown
| Synthesis text transforms (pronunciation map + latin lowercase) | app/services/text_transform_service.py, app/services/segmented_project_service.py, app/services/segmented_synth_workers.py, app/api/config.py | tests/unit/test_text_transform_service.py, tests/test_segmented_text_transforms.py, tests/test_config_pronunciation_map_api.py, tests/unit/test_segmented_synth_workers.py | 纯函数 + local/workers 双路径捕获文本断言 + effective_text 记录；全局字典 API 校验 |
```

- [x] **Step 5: deployment-feature-matrix.md**

发音映射 / 大写转小写标注为 **A（workers-capable）**：workers 合成路径经 `system_configs`（Supabase）读全局字典，项目字典/段级引用随项目 JSON 走 PostgREST，纯函数无本地依赖。

- [x] **Step 6: 全量回归 + Commit**

Run: `cd backend && uv run --extra test --extra local-ml --extra local-services pytest -q && cd ../frontend && npx vitest run && npm run lint && npm run build`
Expected: 全绿

```bash
git add docs/feature-spec.md docs/api-reference.md docs/database-schema.md backend/tests/TEST_MAP.md docs/deployment-feature-matrix.md
git commit -m "docs: studio search + text transforms (feature-spec, api-reference, schema, TEST_MAP)"
```

---

## 自审记录（writing-plans checklist）

**Spec 覆盖**：
- 功能 1（搜索）→ Task 8/9；结果跳转/键盘/含全大写词过滤器 → Task 9；e2e → Task 14。
- 功能 2（发音映射）→ 数据模型 Task 2/3；合并覆盖/悬空 id → Task 1/4；CRUD（全局 /settings → Task 13，项目面板 → Task 12）；删除引用清理 → Task 12；搜索驱动应用流程 + 预览 → Task 12；badge → Task 11；apply_all → Task 10/4/5；e2e → Task 14。
- 功能 3（大写转小写）→ 规则 Task 1/6；项目默认 Task 10；段级三态 Task 11 + Task 9（搜索过滤器内批量）；生效顺序 Task 1/4/5；e2e → Task 14。
- IndexedDB 无模式透传验证 → Task 7（enrichSegment round-trip 测试）。
- workers 读全局字典方式 → 关键设计决策 2 + Task 5。
- 非目标（正则搜索、按引擎区分、拼音探测、全局字典导入导出、agent 改动）→ 均未纳入。

**已知限制（执行时注意）**：
- Task 11 的 SegmentRow/SegmentEditPanel 测试 props 以实际接口为准微调（计划已注明）。
- Task 14 的 UI 选择器以 Task 9-13 实际产出为准微调，断言语义不变。
- e2e 使用真实 edge_tts，需要网络；失败重试时再排查。
