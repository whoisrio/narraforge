# Phase 7 制作 Brief — agent / backend 待办

**Status**: TODO
**Depends on**: Phase 1–6（已完成）；现有 animation_spec 存储 + remotion scaffold 已通
**Created**: 2026-08-28

## 背景 / 现存问题

Roadmap Phase 7（`docs/roadmap.md:654`）定义了完整的 ProductionBrief：全局视觉风格 + 每段制作要求 + 导出包。
当前只跑通了「Remotion 动画规格」一条支线：外部 skill `narraforge-anim-spec` 生成 spec → `POST /api/segmented-projects/{pid}/apply-animation-spec` 落库（`segments.animation_spec_json`）→ scaffold 导出音频/SRT/manifest。
ProductionBrief 的完整形态（visualTreatment 九类、productionIntent、assetRequirements、导出包）在 agent 和 backend 都不存在。
agent 代码注释已引用一个「animation-brief 节点」，但图里没有这个节点（`agent/app/graph_knowledge_video.py:76-83` 止于 `scaffold_remotion`）。

## Agent 待办（`agent/`）

### A1. knowledge_video 图补 `animation_brief` 节点

- 位置：`split_chapters`/`synthesis` 之后、`scaffold_remotion` 之前（或之后，待设计，见 Open Questions）。
- 输入：分段文本 + 情感标签 + 每段实测音频时长 + `state["source_elements"]`（`gen_narration` 已为下游备好代码块/图片引用映射，见 `agent/app/source_elements.py`）。
- 输出：每段 SegmentProductionBrief（visualTreatment / productionIntent / visualDescription / timingRequirements.suggestedBeats / remotionRequirements / assetRequirements）。
- 写回：调已有的 `backend_client.apply_animation_spec`（`agent/app/backend_client.py:156`）；若 Brief 超出现有 animation_spec schema，需先扩后端（见 B1）。
- 需要新增 LLM prompt（`agent/app/prompts/knowledge_video.py` 旁边），含主题选择逻辑（现 skill 里的 dark-botanical / tech-blueprint / warm-paper 三主题，或读项目 `animation_theme` 字段）。

### A2. preflight_check 统计补上 animation brief 计数

- `agent/app/nodes/knowledge_video/preflight.py:4` docstring 声称 stats 含 animation briefs，实际 `stats`（第 54 行）只统计章节数和已合成音频数。
- 需要后端先暴露「已有 spec 段数」的查询（见 B3），agent 侧再接入。

### A3. scaffold_remotion 与 brief 的关系

- `scaffold_remotion.py` docstring 明确写 "there is no animation_brief created"，manifest 目前只有音频 + SRT。
- 若 A1 落地，manifest 需扩展携带每段 brief 摘要（依赖 B2 导出包设计）。

## Backend 待办（`backend/`）

### B1. ProductionBrief 数据模型

- 现状：只有 `segments.animation_spec_json`（`backend/app/models/segmented_project.py:126`）和项目级 `animation_theme`（第 38 行）。
- 缺口：chapter 级 / 项目级的 ProductionBrief（`sourceDocumentSummary` / `narrativeIntent` / `globalVisualStyle`），以及每段 brief 的完整字段（visualTreatment 九类、productionIntent、assetRequirements、videoRequirements）。
- 设计选择：扩 animation_spec_json schema，还是新建 production_brief 表 / JSON 列（见 Open Questions）。
- 若动 schema：走 migrations，注意 workers(Supabase) 模式的双仓储同步（参考 `animation_spec_codec.py` 的拆分原因）。

### B2. 导出包

- Roadmap 定义：`production_brief.md` / `production_brief.json` / `visual_style.json` / `segment_manifest.json` / `audio/` / `subtitle/` / 可选 `remotion_contract.json`。
- 现状：scaffold 只导出音频 + SRT + manifest（`backend/app/services/remotion_scaffold_service.py`）。
- 需要新增导出端点（或扩展 scaffold），生成 brief 的 Markdown 人类可读版 + JSON 机器版。

### B3. 查询 / 状态端点

- 「项目已有多少段带 brief/spec」的统计，供 agent preflight（A2）和前端展示用。
- 可考虑挂在现有 `sync-status` / `usage` 端点旁（`backend/app/api/segmented_projects.py:885,898`）。

### B4. `apply_animation_spec` schema 扩展

- 现端点（`segmented_projects.py:682`）只接受 `{theme, segments}`。
- 若 B1 落地新字段，该端点（及 `repo.apply_animation_spec`）需同步扩展，保持幂等。

## 分阶段 Rollout

1. B1 模型设计定型（含迁移方案）→ B4 端点扩展。
2. A1 animation_brief 节点 + prompt，TDD（agent 测试：`uv run --extra test pytest -q`）。
3. B2 导出包 + A3 manifest 扩展。
4. A2 preflight 统计 + B3 查询端点。
5. 全部完成后更新 `docs/roadmap.md`、`docs/api-reference.md`、`docs/database-schema.md`。

## Open Questions

- animation_brief 节点放在 synthesis 之前还是之后？之前则时长靠估算（5 字/秒），之后则有实测音频时长但失败后重跑成本高。
- ProductionBrief 是扩 `animation_spec_json` 还是独立存储？前者改动小，后者更贴合 roadmap 且能给非动画类（broll/chart/screenshot）段落建模。
- 现有 `narraforge-anim-spec` skill 与 agent 内节点如何分工？skill 保留为手动/CLI 入口，还是迁移为节点调用同一套 prompt？
- 非 Remotion 的 visualTreatment（broll_video / chart / screenshot 等）是 Phase 7 MVP 范围还是专业版？roadmap 写「MVP 5-7 天；专业版更长」，需确认 MVP 是否只做 remotion_animation + diagram_animation。
