# 知识分享视频工作流（knowledge_video）设计

日期：2026-07-21
状态：已评审（brainstorming 阶段）

## 1. 背景与目标

现有 narration workflow（gen_script → script_review → split_segment → synthesis）面向原始文档的「创作型旁白改写」，与知识分享类视频制作不匹配。本设计新增一条独立的 LangGraph 工作流 `knowledge_video`，覆盖从源文档到 Remotion 工程 + 动画 brief 的完整链路：

1. 基础质量 review（自动审查 + 人工确认）；
2. 旁白改写：移除 markdown 格式 + 轻度改写，**严格忠于原文**；
3. 拆分生成项目章节；
4. 触发 TTS 合成（本期固定 edge-tts 默认音色；项目级默认音色设置留作后续）；
5. 在指定目录用 `npx create-video` 生成 Remotion 工程，并注入音频 / srt / manifest / AGENTS.md；
6. 生成动画 story brief（按 segment × 时间轴），不写动画代码。

## 2. 总体架构

新增独立 graph，注册为第二个 assistant，与现有 `narration` 完全解耦：

```
preflight_check → gen_narration → quality_review (interrupt)
  → split_chapters → synthesis → scaffold_remotion → gen_animation_brief → END
```

- Agent：`agent/app/graph_knowledge_video.py`（新图）+ `agent/app/nodes/knowledge_video/`（新节点目录），`langgraph.json` 注册 `"knowledge_video": "./app/graph_knowledge_video.py:graph"`。
- 复用：`BackendClient`（按需扩展方法）、`llm.py`、`prompts/` 组织方式（新增 `prompts/knowledge_video.py`）、drawer 流式协议与 interrupt 机制。
- **Prompt 获取逻辑与现有 workflow 保持一致**：统一走 `get_prompt(name, **vars)`，优先从 LangSmith prompt hub 拉取（支持 prompt 热更新），拉取失败回退到代码内的默认 prompt。新 workflow 的 prompt 使用独立命名（如 `narraforge-kv-gen-narration`、`narraforge-kv-quality-review`、`narraforge-kv-split-chapters`、`narraforge-kv-animation-brief`），与 narration 的 prompt 互不干扰。
- 前端 thread metadata 新增 `kind: 'knowledge_video_workflow'`。

## 3. 节点详细设计

### 3.0 preflight_check

- 调 `GET /api/segmented-projects/{pid}` 检查项目是否已有章节 / 已合成音频 / 已写入 animation_spec。
- 无内容：直接进入 `gen_narration`。
- 有内容：`interrupt()`，payload 含统计信息（章节数、已合成 segment 数、是否有 brief），`available_actions: ["confirm", "cancel"]`。
  - `confirm`：继续。后续 `split_chapters` 的 batch 写入会事务性替换旧章节结构（沿用现有 `chapters:batch` 语义）。
  - `cancel`：写 `state.error = "用户取消"` 并直接到 END，不改动任何数据。

### 3.1 gen_narration

- 拉 `source_document`，LLM 流式生成旁白稿：
  - 移除 markdown 语法（标题井号、加粗、列表符号、代码块围栏等），保留代码内容的纯文本；
  - 轻度改写使口语化，**不得增删事实、不得改变观点与结构顺序**；
  - 按 `#`/`##` 章节结构输出（沿用 `parse_markdown_chapters`）。
- 同时产出**原文结构映射** `source_structure_map`：对每个章节记录其包含的特殊元素（代码块、图片引用及其原文位置/URL），存入 state，供 brief 节点使用。图片只记录引用，不复制文件。

### 3.2 quality_review

- 自动审查（instructor + schema），维度：
  - `markdown_residue`：是否残留 markdown 语法；
  - `fidelity`：是否偏离原文（漏段、臆造内容）；
  - `chapter_split`：章节划分合理性；
  - `readability`：口播可读性。
- 审查后**总是 `interrupt()`** 等待人工确认旁白稿：
  - payload 含审查结果（通过 / 各维度问题列表）与完整旁白稿；
  - `available_actions: ["approve", "reject"]`，`approve` 可带 `edited_script`，`reject` 可带 `feedback` 回到 `gen_narration` 重新生成（沿用 `MAX_AUTO_REJECT` 上限思路，人工 reject 不限次数）。

### 3.3 split_chapters

- instructor + 拆分 schema，将确认后的旁白稿拆为章节 / segment；
- 调 `batch_create_structure`（`POST /api/segmented-projects/{pid}/chapters:batch`）写入**当前项目**，回填后端分配的 id。

### 3.4 synthesis

- 逐 segment 调现有 `POST .../segments/{sid}/synthesize`，params 固定 edge-tts 默认音色（`engine: edge_tts` + 默认中文音色，具体音色常量写在 agent config，后续由「项目级默认音色」替代）；
- 逐段发 `progress N/M` 事件（沿用现有模式）。

### 3.5 scaffold_remotion

- 调后端新端点 `POST /api/segmented-projects/{pid}/scaffold-remotion`，body `{ "target_dir": <可选，默认项目 remotion_project_path> }`。
- 后端行为：
  1. 目标目录下**已存在 Remotion 工程**（判定：存在 `package.json` 且含 remotion 依赖）→ 跳过创建，仅刷新资产（幂等，可重跑）；
  2. 否则执行 `npx create-video@latest --yes --blank <dir>`（已验证支持非交互；需设超时，首次含依赖安装可能数分钟）；
  3. 生成 srt：后端新增 srt 生成工具，按 segment `audio.current.duration_sec` 累加时间戳（逻辑移植自前端 `buildSRTContent`），按章节输出到 `<工程>/public/subtitles/chapter_<position>.srt`；
  4. 复制章节拼接音频（复用 `concat_to_mp3`）到 `<工程>/public/audio/chapter_<position>.mp3`；
  5. 写 `segment_manifest.json` 到工程根（结构见 §5）；
  6. 写 `AGENTS.md` 到工程根：说明工程结构、资产清单、`animation_brief.json` 的位置与格式、如何用 `npx remotion studio` 预览。
- 前置条件：后端 host 装有 Node.js / npm；缺失时返回明确错误。

### 3.6 gen_animation_brief

- 输入：各 segment 文本 + 时间轴（`duration_sec` 累加）+ `source_structure_map`（代码 / 图片引用）；
- LLM（instructor + schema）按 segment 生成 brief：哪几段旁白、呈现什么内容、用什么动画效果；
- 双写：
  - 逐 segment 写 `animation_spec_json`（走现有 `POST .../apply-animation-spec` 批量端点）；
  - 汇总写 `animation_brief.json` 到 Remotion 工程根：`scaffold-remotion` 端点的 body 增加可选字段 `animation_brief`，`gen_animation_brief` 节点带 brief 再次调用该端点，由其实现幂等刷新（工程已存在时仅更新资产与文件）。

## 4. State 与 Schema

### 4.1 `KnowledgeVideoState`（TypedDict，全部 plain dict 可序列化）

`project_id`、`source_document`、`source_structure_map`、`narration_script`、`script_chapters`、`review_result`、`edited_script`、`structured_segments`（含回填 id）、`synthesis_results`、`remotion_project_dir`、`animation_brief`、`current_stage`、`review_retry_count`、`error`。

`STAGE_ORDER = ["preflight_check", "gen_narration", "quality_review", "split_chapters", "synthesis", "scaffold_remotion", "gen_animation_brief"]`。

### 4.2 新增 Pydantic schema（`agent/app/schemas.py` 扩展）

- `QualityReviewResult { passed: bool, dimensions: list[QualityDimension], issues: list[str] }`，`QualityDimension { name, passed, comment }`；
- `SourceElement { kind: "code"|"image", ref: str, chapter_index: int, excerpt: str }`，`source_structure_map: list[SourceElement]`；
- `SegmentBrief { segment_position, narration_text, visual_content_type: "code"|"image"|"key_points"|"text", visual_content_desc, source_ref: str|None, animation_effect, animation_notes }`，`ChapterBrief { chapter_position, title, segments: list[SegmentBrief] }`，`AnimationBrief { chapters: list[ChapterBrief] }`。

## 5. 数据契约

### 5.1 `animation_brief.json`（Remotion 工程根）

```json
{
  "project_id": 1,
  "generated_at": "2026-07-21T00:00:00Z",
  "total_duration_sec": 123.4,
  "chapters": [
    {
      "chapter_id": 10, "position": 0, "title": "...",
      "start_sec": 0.0, "end_sec": 45.2,
      "segments": [
        {
          "segment_id": 100, "position": 0,
          "start_sec": 0.0, "end_sec": 4.2,
          "narration_text": "...",
          "visual_content": { "type": "code|image|key_points|text", "description": "...", "source_ref": "图片URL/代码出处或null" },
          "animation": { "effect": "typewriter|fade_in|highlight_lines|slide_in|...", "notes": "..." }
        }
      ]
    }
  ]
}
```

`segment.animation_spec_json` 存对应单个 segment 的 brief 对象（同上 segments 项结构）。

### 5.2 `segment_manifest.json`（Remotion 工程根）

```json
{
  "project_id": 1, "project_name": "...",
  "chapters": [
    { "chapter_id": 10, "position": 0, "title": "...",
      "audio": "public/audio/chapter_0.mp3",
      "subtitles": "public/subtitles/chapter_0.srt",
      "duration_sec": 45.2 }
  ]
}
```

## 6. 后端改动

- 新增 `POST /api/segmented-projects/{pid}/scaffold-remotion`（`backend/app/api/segmented_projects.py` + service 层）：工程探测 / npx 创建 / srt 生成 / 音频复制 / manifest 与 AGENTS.md 写入 / brief 文件刷新。幂等。
- 新增 srt 生成工具（service 层纯函数，输入 segments 返回 srt 文本）。
- `BackendClient`（agent 侧）新增 `scaffold_remotion(project_id, target_dir)`、`apply_animation_spec(project_id, specs)`。

## 7. 前端改动

- `ProjectLibrary.startWorkflow`：drawer 触发处加工作流类型选择（narration / knowledge_video），kind → assistantId 映射常量，替换现有硬编码 `'narration'`。
- `WorkflowDrawer`：
  - 支持新图节点状态键（`NODE_STATE_KEYS` 按 kind 区分）与阶段摘要；
  - 支持确认型 interrupt（preflight 的 confirm/cancel）——目前只有 review 型，需小幅扩展 `ReviewPanel` 或新增 `ConfirmPanel`；
  - quality_review 的 interrupt 复用现有 `ReviewPanel` + `stream.respond()`。
- 新增**分镜视图**组件（如 `StoryboardPanel`）：按章节分组，每个 segment 一张分镜卡（时间码区间 / 旁白文本 / 呈现内容类型与描述 / 动画效果），数据源 `animation_spec_json`；附「复制为文本」动作。纯文本不做独立视图。

## 8. 错误处理

- 每节点异常捕获后写 `state.error` 并终止，drawer 显示失败阶段（沿用现有模式）；
- scaffold 失败（无 Node、npx 超时、目录不可写）不阻塞已完成章节与音频，state 保留 `synthesis_results`，错误信息明确指出可修复后重跑（scaffold 幂等）；
- 后端 scaffold 端点对 npx 调用设超时（建议 600s）并将 stderr 摘要写入错误响应。

## 9. 测试策略

- Agent：沿用现有测试模式，mock `BackendClient` 与 LLM；逐节点测 preflight 分支（有/无内容、confirm/cancel）、review interrupt、brief schema 约束；
- 后端：scaffold 端点 mock npx 调用，测目录结构、srt 时间戳正确性、幂等重跑、无 Node 时的错误；
- 前端单元/组件测试：kind 映射、ConfirmPanel、分镜视图渲染（与源文件同目录）。

### 9.1 E2E 验证（遵循 `docs/e2e-test-guide.md`）

**范围决策**：完整工作流链路（drawer → agent 2024 → LLM → 后端）**不进浏览器 E2E**——Playwright `webServer` 只起 backend/frontend，agent server 与 LLM 调用的不确定性会使测试不稳定；该链路靠 agent pytest（全 mock）+ 手动验证覆盖。浏览器 E2E 覆盖不依赖 agent 的部分：

- 新增 `tests/e2e/specs/knowledge-video-workflow.spec.ts`（中文 locale、`--workers=1` serial）：
  1. **工作流类型选择**：从源文档 tab 打开 drawer，验证可选择 `knowledge_video` 类型（UI 状态 + `collectErrors` 无新增 console 错误）；
  2. **分镜视图**：先通过 `apply-animation-spec` API 给种子项目写入 brief 数据（BEFORE 快照），前端打开分镜视图，用 CSS module 部分选择器（如 `[class*="storyboardCard"]`）验证分镜卡渲染：时间码区间、旁白文本、呈现内容类型、动画效果（AFTER UI 验证）；
  3. **双层数据验证**：分镜数据写入后，API 层 `readBackendProject` + `validateSegment` 校验 `animation_spec_json`，DB 层 `readDbProject` + `validateDbProjectRow` 按 `docs/database-schema.md` 校验——两层各自对各自契约，不断言 `api === db`；
  4. 每个验证点用 `verifyDbWithScreenshot()` 留带标签截图。
- 实现时同步更新 `docs/e2e-test-guide.md` 的 Gap Analysis（新增条目并标记状态）及相关文档（`docs/api-reference.md`、`docs/feature-spec.md`）。

## 10. 明确不做（YAGNI）

- 不生成 Remotion 动画代码（brief 为止）；
- 不做项目级默认合成音色设置（后续迭代）；
- 不做逐词字幕（edge-tts word boundary 不启用）；
- 不复制图片文件到 Remotion 工程（brief 只记引用）；
- 不改动现有 narration workflow 行为。
