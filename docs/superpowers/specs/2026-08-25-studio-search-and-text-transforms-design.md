# Studio 全项目搜索 + 合成时文本变换（发音映射 / 大写转小写）- 设计

- 日期: 2026-08-25
- 状态: Draft（待用户评审）
- 关联: `frontend/src/components/SegmentedTTS/SegmentList.tsx`, `backend/app/services/segmented_project_service.py`, `backend/app/services/engine_capabilities.py`, `backend/app/services/segmented_synth_workers.py`

## 背景

三个需求指向同一条主线：Studio 的 segment 列表缺乏定位手段，且 TTS 引擎对中文多音字、全大写英文词的朗读经常不符合预期。

1. Studio 的 segment 列表不支持搜索，章节/段一多就找不到内容。
2. 某些 TTS 引擎对中文多音字支持不好（如「调动」被读错），需要在合成时用同音字替换（调动→掉动），但**不改原文**——显示、字幕、SRT 导出都保持原样。
3. 全大写英文词（如 `REST API`）常被逐字母朗读，需要合成时转小写，且支持按 segment 粒度控制。

## 已确认的用户决策

- 映射字典分**全局 + 项目**两层，项目级自动继承全局字典，同 `source` 时项目条目覆盖全局条目。
- 映射的段级应用记录只存在于项目内（全局字典不携带任何段引用）。
- 搜索范围为**全项目**（跨章节，结果跳转定位）。
- 小写规则仅处理**全大写拉丁词** `[A-Z]{2,}`，单字母与首字母大写词不动。
- 映射不按引擎区分。
- 字典必须支持增删改：全局字典在 `/settings` 页维护，项目字典在 Studio 映射面板维护。
- 发音映射与大写转小写都走「**先搜出命中的 segment → 再选择应用范围**」的交互流程，并各自提供「无脑全局生效」选项：发音映射的全局生效开关 `configs.pronunciation_apply_all` 配置在**项目设置**里（对本项目所有段应用整个生效字典，无需逐段勾选）；大写转小写用项目级默认开关 `configs.lowercase_latin`。

## 术语

- **发音映射（pronunciation map）**：一条 `{source → target}` 规则，合成时把原文中的 `source` 子串替换为 `target`，仅影响送引擎文本。
- **生效字典（effective map）**：全局字典与项目字典合并后的结果，以 `source` 为键，项目条目覆盖同 `source` 的全局条目。
- **段级应用（applied map ids）**：segment 上记录的映射 id 引用列表，决定哪些映射对该段生效。
- **文本变换（text transforms）**：发音映射替换 + 大写转小写的统称，发生在 `prepare_text_for_engine` 之前。

## 总体设计

三个需求中的 2、3 本质都是「合成时文本变换」：只改送给 TTS 引擎的文本，不改 `segment.text` 原文。
统一挂接在现有合成管道中：

```text
seg.text
  → apply_text_transforms(合并生效字典 → 应用该段命中的映射 → 大写词小写化)   ← 新增
  → prepare_text_for_engine(...)                                            ← 现有，不动
  → 引擎合成
```

这一挂接点带来三个好处：

- 本地合成（`synthesize_segment`）与 workers 合成（`segmented_synth_workers.py`）两条路径接入同一纯函数，行为一致。
- agent 工作流（knowledge_video 等）经 HTTP 调后端合成端点，自动生效，无需改动 agent。
- 与项目级 `configs.underscore_to_space` / `configs.skip_parenthesized` 的既有模式一致。

前端新增 `textTransforms.ts` 镜像模块（与 `styleTags.ts` 镜像 `engine_capabilities.py` 的先例一致），用于映射面板里的「替换后效果」预览，不承担合成职责。

## 功能 1：全项目搜索（纯前端）

所有 segment 数据已在前端内存中，零后端改动。

### 交互

- `SegmentList` 顶部工具栏新增搜索框，输入即搜，大小写不敏感子串匹配。
- 结果面板按章节分组：章节名 + 段 position + 命中上下文片段（命中词高亮），顶部显示总命中数。
- 点击结果：切换到对应章节 → 滚动定位 → 闪烁高亮该段。
- 键盘：↑/↓ 在结果间移动，Enter 跳转，Esc 关闭结果面板。
- 搜索框内置一个快捷过滤器「含全大写词」（内部用 `[A-Z]{2,}` 检测），供功能 3 的流程复用。

### 实现

- 核心抽为 `useSegmentSearch(project, query)` hook，返回 `{chapterId, chapterName, segmentId, position, snippet, matchCount}[]`。
- 另提供同结果形状的 `findUppercaseSegments(project)` 工具函数。
- 功能 2 映射面板的「包含该词的 segment」列表复用 `useSegmentSearch`，一份搜索逻辑两处用。

## 功能 2：发音映射

### 数据模型

**映射条目**（全局与项目同构）：

```json
{
  "id": "gpm_a1b2c3 | pm_x9y8z7",
  "source": "调动",
  "target": "掉动",
  "note": "edge_tts 读错（可选）"
}
```

- `id` 生成时带前缀：全局 `gpm_`、项目 `pm_`，保证两层 id 永不冲突，段级引用可安全跨层解析。
- `source` 在同一字典内唯一（后端写入时校验）。
- 项目级「无脑全局映射」开关：`project.configs.pronunciation_apply_all: bool`（默认 false），在**项目设置**中配置。
  - 开启后，生效字典（全局 ∪ 项目）中的**所有映射对本项目所有段生效**，无需逐段勾选。
- 每条映射对文本做单次全量替换，不递归扫描（`target` 中即使含 `source` 也不会循环）。

**存储位置**：

| 层 | 位置 |
|---|---|
| 全局字典 | `system_configs` 表，key=`pronunciation_map_global`，value 为 JSON 数组 |
| 项目字典 | `project.configs.pronunciation_map`（JSON 数组），随整项目 PUT 保存，随项目导出/导入走 |
| 段级应用 | `segmented_project_segments.text_transforms`（**新增 JSON 列**） |

**segment.text_transforms**：

```json
{
  "applied_map_ids": ["pm_x9y8z7", "gpm_a1b2c3"],
  "lowercase_latin": null
}
```

段上只存 id 引用，不存替换内容副本——修改映射的 `target` 后，所有引用段自动跟随。

### 继承与合并规则

- 生效字典 = 全局 ∪ 项目，以 `source` 为键合并，**同 `source` 项目条目整体覆盖全局条目**（含其 `id`）。
- 段级 `applied_map_ids` 引用了被覆盖的全局 id 时，该引用成为悬空引用：合成时忽略，UI 灰显并提示「已被项目级同名映射覆盖」。

### CRUD 与删除语义

- **全局字典**：`/settings` 页新增编辑器，支持增、删、改；改动对所有项目生效，保存前提示影响范围。
- **项目字典**：Studio 映射面板内增、删、改。
- **删除被引用的映射**：删除时统计并提示「N 个段正在引用」，确认后前端同步清理这些段的 `applied_map_ids`（随整项目保存落盘）；后端合成对残留悬空引用一律忽略（防御性）。

### 搜索驱动的应用流程

1. 映射面板中新增/选中一条映射，输入 `source` 后，面板实时用 `useSegmentSearch` 列出**全项目所有命中段**（章节名 + 段号 + 上下文高亮 + 复选框）。
2. 用户勾选要应用的段（提供「全选」），保存时写入各段 `applied_map_ids`，走常规整项目 PUT。
3. 或者在**项目设置**中打开 `pronunciation_apply_all` 开关，跳过逐段勾选，整个生效字典对本项目全量生效。
4. 每条命中段旁展示「替换后效果」预览（前端 `textTransforms.ts` 镜像计算），确认读音替换符合预期。
5. 已应用映射的段在 `SegmentRow` 上显示 🗣 badge（含数量），hover 展示各条 `source→target`。

### 合成时生效规则

```python
merged = merge(global_map, project_map)   # 以 source 为键，项目覆盖全局
effective = merged if project_apply_all else [e for e in merged if e.id in seg.applied_map_ids]
effective.sort(key=lambda e: len(e.source), reverse=True)  # 长 source 优先，避免短词吃掉长词前缀
for e in effective:
    text = text.replace(e.source, e.target)
```

- 长度降序保证重叠 source（如「调动」与「调动工作」）行为确定。
- 开启 `pronunciation_apply_all` 后，映射对不含 `source` 的段天然是无副作用的 no-op。

## 功能 3：大写词转小写

### 数据模型

- 项目默认：`project.configs.lowercase_latin: bool`（「无脑全局」开关，配置在项目设置）。
- 段级覆盖：`segment.text_transforms.lowercase_latin: true | false | null`，`null` = 跟随项目默认。

### 搜索驱动的应用流程

- 搜索栏的「含全大写词」快捷过滤器列出全项目命中段，列表中每段带一个小写化开关，可逐段或批量设置段级覆盖。
- 想全项目一刀切时，直接开项目级 `configs.lowercase_latin`，无需逐段操作。
- `SegmentEditPanel` 内提供三态开关（跟随项目 / 开 / 关），供单段微调。

### 生效规则

- 解析顺序：`segment.text_transforms.lowercase_latin`（非 null 优先）→ `project.configs.lowercase_latin` → 默认 false。
- 规则：仅 `[A-Z]{2,}` 全大写拉丁词转小写（`REST API 接口` → `rest api 接口`）。
- 单字母（如英文 `I`）、首字母大写词（如 `Http`）不变。
- 执行顺序在发音映射替换**之后**、`prepare_text_for_engine` **之前**——映射 `target` 中若含全大写词也会被小写化，属预期行为。

## 后端改动

| 位置 | 改动 |
|---|---|
| `app/services/text_transform_service.py`（新增） | 纯函数：`merge_maps` / `apply_pronunciation_map` / `lowercase_latin_words` / `apply_text_transforms`，易单测 |
| `app/models/segmented_project.py` | segment 加 `text_transforms` JSON 列 |
| `app/core/database.py` | 幂等 ALTER 清单加 `ALTER TABLE segmented_project_segments ADD COLUMN text_transforms JSON` |
| `app/api/config.py` | 新增 `GET /config/pronunciation-map-global`、`PUT /config/pronunciation-map-global`（全量替换，校验 source 非空且唯一），仿 animation-root 端点模式 |
| `app/services/segmented_project_service.py` | `synthesize_segment` 在 `prepare_text_for_engine` 前接入 `apply_text_transforms`；`generated_params.effective_text` 记录实际合成文本 |
| `app/services/segmented_synth_workers.py` | workers 路径接入同一纯函数（注意：workers 不依赖 ORM，读取 `system_configs` 全局字典的方式在实现计划中确定） |
| 项目/段 schemas | `configs` 与 segment 进出 schema 增加 `text_transforms` 透传与校验 |

## 前端改动

| 位置 | 改动 |
|---|---|
| `src/services/textTransforms.ts`（新增） | 后端 `text_transform_service.py` 的镜像，供预览用，注释标明镜像关系 |
| `src/hooks/useSegmentSearch.ts`（新增） | 全项目搜索 hook + `findUppercaseSegments` |
| `src/components/SegmentedTTS/SegmentSearchBar.tsx`（新增） | 搜索框 + 结果面板 + 键盘导航 |
| `src/components/SegmentedTTS/PronunciationMapPanel.tsx`（新增） | 项目字典 CRUD、全局字典只读展示（带「全局」徽标）、命中段勾选列表、替换效果预览 |
| `src/pages/Settings`（既有页面） | 全局发音字典编辑器（增删改） |
| `src/components/SegmentedTTS/SegmentEditPanel.tsx` | 小写化三态开关 |
| `src/components/SegmentedTTS/SegmentRow.tsx` | 🗣 映射 badge |
| `src/types/index.ts` | `Segment.text_transforms`、项目 `configs` 类型扩展 |
| i18n | zh / en 文案 |

IndexedDB（frontend 存储模式）下 segment JSON 为无模式透传，新字段自然随项目保存，无需迁移逻辑（实现计划中验证）。

## 错误处理与边界情况

- `source` 为空或同字典内重复 → API 拒绝（400），前端表单即时校验。
- 段级悬空映射 id → 合成忽略；UI 灰显提示。
- 映射重叠 → 长度降序替换保证确定性。
- 全局字典条目被删/改影响所有项目 → 设置页保存前明示影响范围。
- `pronunciation_apply_all` 与段级勾选是「或」关系，项目设置开启后段级勾选不再影响结果（UI 上勾选列表置灰并说明）。
- 变换后文本为空 → 与现有空文本段行为一致（合成端点原有校验拦截）。
- 原文、SRT/字幕导出、动画 spec 全部不受影响——变换只发生在送引擎前。

## 测试计划（TDD）

**后端单测**：

- `text_transform_service`：合并覆盖（同 source 项目赢）、`pronunciation_apply_all` 项目级开关生效与范围、长度降序替换、单次替换不递归、`[A-Z]{2,}` 边界（`I` 不变 / `API` 变 / 中英混排 / `target` 含大写词被小写化）、悬空 id 忽略。
- 合成管道：本地与 workers 两条路径分别断言 mock 引擎收到的 `text_to_speak`；`generated_params.effective_text` 已记录。
- 全局字典 API：GET/PUT、校验失败 400、与项目字典合并后的合成行为。

**前端测试**：

- `useSegmentSearch`：跨章节命中、大小写不敏感、高亮片段、空查询、含全大写词过滤器。
- `PronunciationMapPanel`：CRUD、命中段勾选写回 `applied_map_ids`、删除引用清理、替换效果预览（镜像与后端共享测试夹具保证一致）。
- `SegmentEditPanel` 三态开关；`SegmentRow` badge。

**E2E**（`tests/e2e/`，遵循双读校验约定）：

- 搜索：跨章节输入关键词 → 点击结果 → 断言章节切换 + 段定位高亮。
- 发音映射：添加映射 → 勾选命中段 → 合成 → 断言 mock/捕获的合成文本为替换后文本，且段原文与导出 SRT 不变。
- `pronunciation_apply_all` 无脑流程：项目设置开启 → 任意段合成 → 断言整个生效字典替换生效。
- 大写转小写：项目默认开 + 单段关的组合断言；段级开 + 项目默认关的组合断言。

## 文档更新

- `docs/feature-spec.md`：搜索、发音映射、大写转小写三节。
- `docs/api-reference.md`：全局字典端点、segment `text_transforms` 字段。
- `docs/database-schema.md`：segment 新列、`system_configs` 新 key。
- `backend/tests/TEST_MAP.md`：新测试映射。
- `docs/e2e-test-guide.md`：新 E2E 用例登记。
- `docs/deployment-feature-matrix.md`：workers 模式接入说明。

## 非目标（YAGNI）

- 正则搜索、按状态/情绪/角色筛选 segment。
- 按引擎区分的映射规则。
- 基于拼音库的自动多音字探测（映射完全由用户定义）。
- 全局字典的导入导出（项目字典随项目导出/导入自动携带）。
- agent 侧任何改动（经后端 HTTP 自动受益）。
