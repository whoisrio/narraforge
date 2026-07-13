# Workflow 迁移到 LangGraph Agent 架构设计

## 目录

| 章节 | 内容 |
|---|---|
| [1. 概述](#1-概述) | 目标、核心决策、范围 |
| [2. 架构与拓扑](#2-架构与拓扑) | 三服务拓扑、通信方向、保留/删除清单 |
| [3. Agent 设计](#3-agent-设计) | langgraph.json、图定义、状态、节点、instructor、backend_client |
| [4. 后端变更](#4-后端变更) | chapters:batch 端点、删除清单 |
| [5. 前端重建](#5-前端重建) | useStream、组件结构、流通道映射、视觉重构 |
| [6. 实时进度数据流](#6-实时进度数据流) | 流通道、里程碑事件、UI 映射 |
| [7. Project ↔ Run 关联与并发](#7-project--run-关联与并发) | thread metadata、并发控制、项目删除清理 |
| [8. 持久化（暂不处理）](#8-持久化暂不处理) | dev 内存模式现状、后续路径 |
| [9. 错误处理](#9-错误处理) | 节点软/硬失败、前端展示 |
| [10. 测试](#10-测试) | 双读验证、E2E 用例、agent/backend/frontend 测试 |
| [11. 切换计划](#11-切换计划) | big-bang 阶段序列 |
| [12. 依赖](#12-依赖) | 新增 Python/前端依赖 |
| [13. 遗留与后续](#13-遗留与后续) | 持久化、跨重启 time-travel、生产部署 |

---

## 1. 概述

### 1.1 目标

把当前直接写在 FastAPI 后端的旁白工作流（`workflow_*.py` + 自定义 SSE + 自定义进度存储 + `WorkflowRun` 表）迁移到独立的 `agent/` 服务，按 LangGraph Agent 架构提供工作流能力。
前端工作流 UI 基于 `@langchain/langgraph-sdk` 的 `useStream` 重建，使用 LangGraph Server 默认提供的后端 API，消除手写粘合层。
Project 与其 workflow 运行记录的关联通过 LangGraph thread metadata 表达。

### 1.2 核心决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| Agent -> 后端 | HTTP | agent 是纯 LangGraph 服务，不持有 project/chapter/segment 表；后端保持单一数据源 |
| 前端 -> 服务 | 直连两个源 (`/api` + `/agent`) | SSE 流端到端，`useStream` 原生可用 |
| Run 关联 | thread metadata（`{project_id, project_name, kind}`） | LangGraph thread 原生可按 metadata 搜索；无需后端索引表 |
| 前端 UX | 图驱动骨架 + 领域审批编辑器 | pipeline 拓扑来自 `/assistants/{name}/graph`；ReviewEditor 是领域组件，保留手写 |
| 实时进度 | LangGraph 流通道（values/messages/custom/interrupts） | 消除 `workflow_progress.py`；节点用 `get_stream_writer()` 发里程碑 |
| 结构化 LLM 输出 | instructor | 消除 `extract_json_object`/`extract_json_array` 脆弱解析 + 手写重试 |
| 迁移方式 | big-bang 整体切换 | 一次性删除旧后端工作流代码，无长期双系统并存 |
| 持久化 | **暂不处理** | dev 用 `langgraph dev` 内存模式，重启即失；持久化后续再决策 |

### 1.3 范围

**本设计覆盖**：agent 服务搭建、后端工作流代码删除、前端 `useStream` 重建、E2E 适配、big-bang 切换序列。
**本设计不覆盖**：**持久化**（run 记录跨重启存活）、生产部署（Docker/Postgres/Redis）、跨重启的 time-travel、LangGraph Platform 自定义认证、多 workflow 支持（架构预留但仅实现 narration 一个）。

### 1.4 持久化现状（明确接受）

`langgraph dev` 是内存模式，所有 thread/checkpoint/store/线程 metadata 重启即失。
本设计接受此现状：dev 会话内 run 记录完整可用；重启后 run 列表清空。
后续若需持久化，切 `langgraph up`（Docker + Postgres + Redis），thread metadata 即持久，无需改架构。

---

## 2. 架构与拓扑

### 2.1 三服务拓扑

```
┌──────────────────────────────────────────────────────────────────┐
│                        Frontend (React, :5173)                    │
│  Vite proxy:  /api   -> http://127.0.0.1:8002  (backend)         │
│               /agent -> http://127.0.0.1:2024  (langgraph dev)   │
│                                                                  │
│  useStream({ apiUrl: "/agent", assistantId: "narration" })       │
│  + Client.threads.search/create/delete（/agent）                  │
│  + axios("/api/...")  for project/chapter/segment/TTS            │
└──────────────────────────┬───────────────────────────┬───────────┘
                           │ HTTP                       │ HTTP (SSE via /agent)
                           ▼                            ▼
┌────────────────────────────────────┐   ┌───────────────────────────────────┐
│  Backend (FastAPI, :8002)          │   │  Agent (LangGraph Server, :2024)  │
│                                    │   │  langgraph dev (in-memory)        │
│  KEEPS:                            │   │                                   │
│  - projects, chapters, segments    │◄──┤  narration graph (4 nodes)        │
│  - TTS engines (edge/cosy/mimo/vox)│   │  gen_script -> script_review      │
│  - roles, sources, clone, STT      │   │     -> split_segment -> synthesis │
│  - model_config, config            │   │                                   │
│                                    │   │  Nodes call backend over HTTP for │
│  ADDS:                             │   │  - project source_document        │
│  - POST /chapters:batch            │   │  - chapter/segment 批量持久化     │
│                                    │   │  - TTS synthesis per segment      │
│  DELETES (big-bang):               │   │                                   │
│  - api/workflow.py                 │   │  Store: director feedback +       │
│  - services/workflow_*.py (5 files)│   │  preferences（内存，会话内）       │
│  - services/prompts/workflow_*     │   │                                   │
│  - models/workflow_run.py          │   │  langgraph.json:                  │
│  - schemas/workflow.py             │   │  - narration assistant            │
│  - 自定义 SSE / progress store     │   │  - 平台注入 checkpointer + store  │
└────────────────────────────────────┘   └───────────────────────────────────┘
```

### 2.2 通信方向（无后端->agent 调用）

- **agent -> 后端**：HTTP（`backend_client.py`），获取 project source_document、批量持久化 chapters/segments、调用 TTS。
- **前端 -> agent**：`useStream` + LangGraph SDK `Client`（直连 `/agent`），流式执行、thread 创建/搜索/删除。
- **前端 -> 后端**：axios（`/api`），project/chapter/segment/TTS。
- **后端 -> agent**：**无**。项目删除时由前端编排 thread 清理（best-effort）；agent 内存孤儿 thread 随重启消失，无害。

### 2.3 端口

- agent `:2024`（LangGraph 默认），后端 `:8002`，前端 `:5173`。
- Vite proxy 增加 `/agent` -> `:2024`。

### 2.4 配置

- agent 读 `BACKEND_API_URL=http://127.0.0.1:8002` + LLM keys（`AGENT_LLM_*` / `LLM_*` / `MIMO_*`）。
- 后端无需 agent URL（不调用 agent）。
- 开发态 agent 无认证；生产认证后续按 LangGraph Platform custom auth 处理（out of scope）。

### 2.5 agent/ 代码布局

```
agent/
├── langgraph.json              # 注册 "narration" assistant
├── pyproject.toml             # langgraph, langgraph-cli[inmem], httpx, instructor, openai, pydantic
├── app/
│   ├── graph.py               # StateGraph 定义 + 编译（不自带 checkpointer/store）
│   ├── state.py               # NarrationWorkflowState TypedDict
│   ├── schemas.py             # Pydantic 模型（ReviewResult/SegmentChapters/Preference）
│   ├── nodes/
│   │   ├── gen_script.py
│   │   ├── script_review.py
│   │   ├── split_segment.py
│   │   └── synthesis.py
│   ├── prompts/
│   │   └── narration.py       # 从 prompts/workflow_prompts.py 迁移
│   ├── backend_client.py      # 后端 HTTP 客户端（agent 唯一的后端契约）
│   └── llm.py                 # instructor 客户端 + 原始流式
└── tests/
```

节点文件从当前 ~800 行 `workflow_nodes.py` 拆为每节点一文件（符合 200-400 行规范）。

---

## 3. Agent 设计

### 3.1 langgraph.json

```json
{
  "dependencies": ["."],
  "graphs": { "narration": "./app/graph.py:graph" },
  "env": ".env"
}
```

图导出为编译后的 `StateGraph`，**不自带 checkpointer/store**。
LangGraph Server 自动注入平台管理的 checkpointer + store（`langgraph dev` 下为内存实现）。
节点通过 `runtime.store` 访问 store（`aput`/`asearch`），与当前节点代码 API 一致。
**这消除了 `workflow_store.py`（自定义 `AsyncSqliteStore`）**，平台 store 取代之，namespace 模型不变。

### 3.2 图定义（agent/app/graph.py + state.py）

4 节点拓扑 + 条件路由不变，但状态字段改为 **Pydantic 类型化**：

```python
class NarrationWorkflowState(TypedDict, total=False):
    # inputs
    project_id: str
    # gen_script
    source_document: str
    narration_script: str
    script_chapters: list[ChapterStructure]
    # script_review
    review_feedback: ReviewResult          # 原 Any
    edited_script: str
    review_status: Literal["approved", "rejected"]
    # split_segment
    structured_segments: list[ChapterStructure]   # 携带后端分配的 id
    # synthesis
    synthesis_results: list[SynthResult]
    # metadata
    current_stage: str
    review_retry_count: int
    error: str | None
```

边不变：`START -> gen_script -> script_review ->(route_after_review)-> split_segment -> synthesis -> END`，reject 回环 `gen_script`。
`route_after_review` 与 `MAX_AUTO_REJECT=3` 自动拒绝逻辑原样迁移。

### 3.3 LLM 层（agent/app/llm.py）- instructor

provider 感知客户端，镜像后端 `_supports_response_format()` 逻辑但用 instructor 的 `Mode`：

```python
import instructor
from openai import AsyncOpenAI
from instructor import Mode

def get_instructor_client() -> tuple[instructor.AsyncInstructor, str]:
    api_key, base_url, model = get_agent_llm_config()
    if "xiaomimimo" in base_url:
        # MiMo: api-key header, 不支持 response_format -> MD_JSON
        raw = AsyncOpenAI(base_url=base_url, api_key=api_key,
                          default_headers={"api-key": api_key})
        mode = Mode.MD_JSON
    else:
        # DashScope/Qwen（OpenAI 兼容, 支持 response_format）-> JSON
        raw = AsyncOpenAI(base_url=base_url, api_key=api_key)
        mode = Mode.JSON
    return instructor.from_openai(raw, mode=mode), model
```

instructor 自动处理 schema 注入、`response_format`（或 MD_JSON 下解析 markdown 中 JSON）、`ValidationError` 重试。
**消除** `extract_json_object`、`extract_json_array`、`_inject_schema_instruction`、`call_llm_structured` 手写重试循环。

### 3.4 节点 LLM 使用策略

| 节点 | 输出 | instructor? | 实时进度通道 |
|---|---|---|---|
| `gen_script` | 纯 markdown | 否 - 原始 `client.chat.completions.create(stream=True)` | `messages` 通道（按 token，按节点过滤） |
| `script_review` | 结构化 JSON | 是 - `create(response_model=ReviewResult)` | `custom` 通道：`llm_call` + `llm_response` 里程碑 |
| `split_segment` | 结构化 JSON 数组 | 是 - `create(response_model=SegmentChapters)` | `custom` 通道：里程碑 + 最终计数 |
| `synthesis` | 无 LLM | N/A | `custom` 通道：每段 `{"completed": N, "total": M}` |
| `_extract_preference`（辅助） | 结构化 JSON | 是 - `create(response_model=Preference)` | 无（best-effort 后台） |

结构化节点用简单 `create()` + 里程碑（不 prematurely 用 `create_partial`）；后续若需实时构建展示再加 `create_partial`。

### 3.5 Pydantic schemas（agent/app/schemas.py）

单一真相源 - 图状态字段与 instructor 校验目标都引用：

```python
class ReviewDimension(BaseModel):
    name: str
    status: Literal["pass", "warn", "fail"]
    comment: str
    suggestion: str | None = None

class ReviewResult(BaseModel):
    dimensions: list[ReviewDimension]
    overall_score: int          # 1-5
    overall_comment: str
    has_critical_issue: bool

class Segment(BaseModel):
    text: str
    emotion: Literal["neutral","happy","sad","angry","calm","excited"]
    role: str = "narration"
    segment_kind: Literal["narration","dialogue"] = "narration"

class ChapterStructure(BaseModel):
    chapter_title: str
    segments: list[Segment]

class SegmentChapters(BaseModel):   # JSON mode 需对象包裹
    chapters: list[ChapterStructure]

class Preference(BaseModel):
    preference: str
    category: Literal["pacing","style","length","tone","structure","other"]

class SynthResult(BaseModel):
    chapter_id: str
    segment_id: str
    audio_path: str | None
    duration_sec: float | None
```

### 3.6 backend_client.py - agent 唯一的后端契约

```python
class BackendClient:
    def __init__(self, base_url: str): ...

    async def get_project(self, project_id: str) -> ProjectDetail:
        """GET /api/segmented-projects/{project_id}（已存在）"""

    async def batch_create_structure(
        self, project_id: str, structure: SegmentChapters
    ) -> list[ChapterWithSegmentIds]:
        """POST /api/segmented-projects/{project_id}/chapters:batch（新增）
        单事务创建全部 chapters + segments，解析默认 voice，替换已有 chapters，
        返回分配的 id。"""

    async def synthesize_segment(
        self, project_id: str, chapter_id: str, segment_id: str
    ) -> None:
        """POST /api/segmented-projects/{pid}/chapters/{cid}/segments/{sid}/synthesize
        （已存在）。按 chapter 配置的 voice 跑 TTS。"""
```

`httpx.AsyncClient` + 重试传输（2 次退避）处理瞬时后端失败；不可重试错误上抛为硬失败。

### 3.7 节点 HTTP 调用矩阵

| 节点 | 后端调用 | Store 调用 | LLM |
|---|---|---|---|
| `gen_script` | `get_project(pid)` -> `source_document` | `store.asearch(("director_feedback", pid), query="reject feedback")` | 原始流式 |
| `script_review` | 无 | `store.aput(("director_feedback", pid), ...)` 存 review/comment/reject | instructor -> `ReviewResult` |
| `split_segment` | `batch_create_structure(pid, SegmentChapters)` -> 返回 id | `store.asearch(("director_preference","global"))` | instructor -> `SegmentChapters` |
| `synthesis` | `synthesize_segment(pid, cid, sid)` 每段循环 | 无 | 无 |

### 3.8 UI 契约文件（graph 与 UI 的唯一契约）

前端 `src/services/langgraph/contracts.ts`，换 workflow 时只改这里：

```typescript
// 节点名 -> 节点完成时填充的 state key
export const NODE_STATE_KEYS: Record<string, string[]> = {
  gen_script:    ["narration_script"],
  script_review: ["review_feedback"],
  split_segment: ["structured_segments"],
  synthesis:     ["synthesis_results"],
};

// 启动 run 时前端渲染的输入字段
export const INPUT_FIELDS: Record<string, Record<string, string>> = {
  narration: { project_id: "Project" },
};
```

节点状态纯从 `stream.values` 推断：某节点 state key 全部填充 = completed；其下游未完成 = running；其余 = pending。
节点列表来自 `GET /assistants/narration/graph`，前端不 hardcode `STAGE_ORDER`。

---

## 4. 后端变更

### 4.1 新增端点：POST /api/segmented-projects/{project_id}/chapters:batch

替代当前 `split_segment_node` 内联的 `create_chapter_for_project` + `create_segment_for_chapter` 循环。

**请求**：
```json
{ "chapters": [{ "chapter_title": "...", "segments": [{ "text": "...", "emotion": "neutral", "role": "narration", "segment_kind": "narration" }] }] }
```

**响应**：
```json
{ "chapters": [{ "id": "...", "segments": [{ "id": "..." }] }] }
```

**行为**：
- 解析默认 voice（项目已有 chapter 的 voice，或 `edge_tts`/`zh-CN-YunxiNeural` 默认）- 把当前在节点里的 voice 解析逻辑移回后端。
- **替换**项目已有 chapters（删旧建新），修复当前 replay `split_segment` 产生重复 chapter 的预存 bug。
- 单事务，返回分配 id 供 `synthesis_node` 复用。

### 4.2 删除清单（big-bang）

| 文件 | 替代 |
|---|---|
| `api/workflow.py`（8 端点） | LangGraph server 端点（前端直连 `/agent`） |
| `services/workflow_service.py` | LangGraph server run 管理 |
| `services/workflow_graph.py` | `agent/app/graph.py` |
| `services/workflow_nodes.py` | `agent/app/nodes/*.py` |
| `services/workflow_progress.py` | `get_stream_writer()` + `custom` 通道 |
| `services/workflow_store.py`（`AsyncSqliteStore`） | LangGraph 平台 store（内存） |
| `services/prompts/workflow_prompts.py` | `agent/app/prompts/narration.py` |
| `models/workflow_run.py`（`WorkflowRun` 表） | LangGraph thread metadata |
| `schemas/workflow.py` | agent Pydantic schemas + 前端 TS 类型 |

### 4.3 修改

- `main.py`：删除 `init_workflow_engine()` 调用 + `workflow.router` 注册；保留 `segmented_projects.router`。
- `models/segmented_project.py`：删除 `workflow_runs` relationship（`WorkflowRun` 已删）。
- DB 迁移：drop `workflow_runs` 表。

### 4.4 保留不变

- `llm_client.py` - 仍被 subtitle/text_split 使用（非工作流）。agent **不共享**它，自带 `llm.py`（instructor）。
- 所有 project/chapter/segment/TTS/clone/STT/config API。
- 现有 `synthesize_segment` 端点（agent 调用）。

---

## 5. 前端重建

### 5.1 两层 agent 访问

| 层 | 工具 | 用途 | 位置 |
|---|---|---|---|
| **活跃 run**（流式） | `useStream`（`@langchain/langgraph-sdk/react`） | 实时 values/messages/custom/interrupts、`submit`、`respond` | `LiveRunView`、`ReviewPanel` |
| **Thread 操作**（非流式） | `Client`（`@langchain/langgraph-sdk`） | 创建/搜索/删除 thread、取 state、取 history（time-travel） | `WorkflowHub`、`LiveRunView` 启动、`WorkflowRunDetail` |
| **后端数据** | axios（现有 `/api`） | project/chapter/segment/TTS | 各处 |

新增前端依赖：`@langchain/langgraph-sdk`。

### 5.2 组件结构

```
src/services/langgraph/
├── client.ts          # Client 单例: new Client({ apiUrl: "/agent" })
├── contracts.ts       # NODE_STATE_KEYS, INPUT_FIELDS
├── types.ts           # NarraWorkflowState TS 镜像（镜像 agent schemas）
└── useProjectRuns.ts  # hook: client.threads.search({ metadata: { project_id, kind } })

src/components/Workflow/
├── WorkflowPage.tsx        # 视图路由: hub | live | detail（保留，简化）
├── WorkflowHub.tsx         # run 列表（useProjectRuns）+ 新建（重建）
├── LiveRunView.tsx         # 活跃 run，持有 useStream（替代 LiveProgress）
├── PipelineTimeline.tsx    # 图驱动节点拓扑（来自 GET /assistants/narration/graph）
├── NodeStatusCard.tsx      # 单节点：状态 + 流式文本 + 里程碑
├── ReviewPanel.tsx         # HITL 审批：stream.interrupts + stream.respond（替代 ReviewEditor）
├── WorkflowRunDetail.tsx   # 历史 run：client.threads.getState + getHistory（重建）
└── *.module.css            # 按 NarraForge warm-amber token 重构
```

`useWorkflowStream.ts`（自定义 SSE hook）**删除** - `useStream` 完全取代。

### 5.3 useStream 接线（LiveRunView）

```tsx
const stream = useStream<NarraWorkflowState>({
  apiUrl: "/agent",
  assistantId: "narration",
  threadId,
  streamMode: ["values", "messages", "custom", "updates"],
  onCustomEvent: (event, { meta }) => {
    // event = { type: "llm_call"|"llm_response"|"auto_reject"|"progress", stage, message, data }
    setMilestones(prev => appendByStage(prev, meta.langgraph_node, event));
  },
});

// thread idle 且未启动过 -> 启动
useEffect(() => {
  if (threadStatus === "idle" && !runStarted) {
    stream.submit({ input: { project_id } });
    setRunStarted(true);
  }
}, [threadStatus]);
```

`PipelineTimeline` 读 `stream.values` + 拉取的图拓扑 + `NODE_STATE_KEYS` 渲染每个 `NodeStatusCard` 状态。
`NodeStatusCard`（gen_script）额外读 `stream.messages`（按 `metadata.langgraph_node === "gen_script"` 过滤）显示实时 token。

### 5.4 ReviewPanel（HITL 领域组件）

读 `stream.interrupts[0].value = { script, review: ReviewResult, available_actions }`。
复用当前 `ReviewEditor` UI（维度卡、星级、脚本 textarea、导演备注、拒绝反馈）- 已打磨，仅重新接线到 `stream.respond()`：

```tsx
stream.respond({ action: "approve", edited_script, comment });
stream.respond({ action: "reject", feedback });
```

agent 侧 `interrupt()` payload 形状不变，ReviewPanel 契约与今天一致 - 只换传输（SSE -> `stream.interrupts`，resume 端点 -> `stream.respond`）。

### 5.5 启动 + 中断流程

1. Hub "新建运行" -> 并发检查（`client.threads.search` 按 `metadata.project_id` 过滤活跃 thread；若有 busy/interrupted 则阻断）。
2. `client.threads.create({ metadata: { project_id, project_name, kind: "narration_workflow" } })` -> `thread_id`。
3. 跳转 `LiveRunView(thread_id)`。
4. `useStream` 连接 -> thread idle -> `stream.submit({ input: { project_id } })`。
5. `gen_script` 流式 token（`messages`）+ 里程碑（`custom`）-> timeline 显示运行中，脚本实时构建。
6. `script_review`（instructor -> `ReviewResult`）-> `interrupt()` -> `stream.interrupts` 填充 -> `ReviewPanel` 渲染。
7. 导演 approve/reject -> `stream.respond(decision)` -> run 恢复。
8. `split_segment` -> `batch_create_structure` HTTP -> `synthesis`（custom `N/M`）-> `END`。
9. `stream.isLoading === false` + `values.current_stage === "completed"` -> 完成态 -> "返回列表"。

### 5.6 视觉重构方向

当前工作流 CSS 与 app 设计语言脱节。重建对齐 `src/styles/variables.css` 与设计指南（`docs/design/stitch_narraforge_story_global_prj/DESIGN.md`）：

- **token**：`--color-primary`（`#c47a3a` 琥珀）用于运行/活跃强调，`--color-success` 完成节点，`--color-text-disabled` 待运行；复用 `--color-surface`、`--color-border`、`--radius-*`、`--spacing-*`。
- **卡片节奏**：`NodeStatusCard` 用与 `ProjectOverview`/`ProjectHub` 一致的面板处理（边框、阴影、内边距）。
- **timeline**：水平节点链 + 连接线（琥珀填充至运行节点），匹配分段编辑器现有 chapter-strip 视觉语言。
- **不引入新色板** - 严格用现有琥珀前置 token（按 CLAUDE.md：禁止紫色为主；暖琥珀为方案）。

### 5.7 Time-travel（会话内）

保留但基于 LangGraph 原生 checkpoint 模型：`WorkflowRunDetail` 调 `client.threads.getHistory({ thread_id })` 列 checkpoint；"从 X 阶段重放" 找 `next === [stage]` 的 checkpoint，经 `client.runs.create(thread_id, assistant_id, { checkpoint_id, command })` 重启。
Fork = 同上 + `update_state` 覆盖。
替代当前 `replay`/`fork` 端点。会话内有效（thread 存在时）；重启后无历史（持久化暂不处理）。
标记为后续子阶段 - 主流程先交付。

---

## 6. 实时进度数据流

### 6.1 流通道 -> UI 映射

| 通道 | useStream 访问 | 渲染位置 |
|---|---|---|
| `values` | `stream.values` | `PipelineTimeline`：节点状态（completed/running/pending via NODE_STATE_KEYS）、`current_stage`、结构化摘要（章节数、段落数、评分） |
| `messages` | `stream.messages` | `NodeStatusCard`（gen_script）：实时脚本文本，token 级 |
| `custom` | `onCustomEvent` 回调 | `NodeStatusCard` 里程碑流（按节点）：`llm_call`、`llm_response`、`auto_reject`、`progress`（synthesis `N/M`） |
| `interrupts` | `stream.interrupts[0].value` | `ReviewPanel`：审查维度 + 可编辑脚本 |
| `updates` | 吸收进 `values` | （无独立 UI） |

### 6.2 节点里程碑事件（agent 侧 get_stream_writer）

节点用 `get_stream_writer()` 发 `{ type, stage, message, data }`：

| type | 触发 | data 示例 |
|---|---|---|
| `llm_call` | 节点开始调 LLM | `{ doc_len }` |
| `llm_streaming` | 流式生成中（gen_script 每 10 chunk） | `{ streaming_text, total_length }` |
| `llm_response` | LLM 返回 | `{ chapters_count, script_length, script_preview }` |
| `auto_reject` | script_review 自动拒绝 | `{ review, dimensions_summary }` |
| `interrupt` | 等待人工审批 | `{ review, dimensions_summary, overall_comment }` |
| `progress` | synthesis 每段 | `{ completed, total }` |
| `error` | 软失败 | `{ message }` |

替代当前 `workflow_progress.py` 的 `emit_progress` 内存存储 + 订阅 - 整模块删除。

---

## 7. Project ↔ Run 关联与并发

### 7.1 thread metadata 关联

每个 workflow thread 创建时携带 metadata：

```typescript
metadata: {
  project_id: string,
  project_name: string,        // 创建时捕获，项目改名后列表仍正确
  kind: "narration_workflow",  // 区分未来其他 thread 类型
}
```

**列出项目的 run**（`useProjectRuns`）：

```typescript
const threads = await client.threads.search({
  metadata: { project_id, kind: "narration_workflow" },
  limit: 50,
});
// 每个 thread 自带: status, values（current_stage + outputs）, created_at, updated_at, metadata
```

thread 对象即完整 run 记录 - status、当前阶段、结构化输出、时间戳全部在 thread 上，无需后端表。

### 7.2 显示状态推断

LangGraph thread 有 4 种 `status`，前端映射为 5 种显示状态：

| thread `status` | + `values.current_stage` | 显示 |
|---|---|---|
| `busy` | 任意 | running |
| `interrupted` | 任意 | awaiting review（等待审批） |
| `error` | 任意 | failed（显示 `values.error`） |
| `idle` | `"completed"` | completed |
| `idle` | 其他 | cancelled（曾运行中被停止/放弃） |

会话内活跃 run 的实时状态来自 `stream.values`（比 thread 搜索结果更新）。

### 7.3 并发：一项目一活跃 run

**前端 thread 搜索检查**（dev 单用户可接受软检查，无 TOCTOU 强保证）：

```typescript
// Hub "新建运行"
const existing = await client.threads.search({
  metadata: { project_id, kind: "narration_workflow" }, limit: 50,
});
const active = existing.filter(t => t.status === "busy" || t.status === "interrupted");
if (active.length) {
  alert(t("workflow.hub.activeWorkflowExists"));   // 阻断
  return;
}
// ... client.threads.create(...)
```

`interrupted` 计为活跃（须先审批/取消）。单用户本地 dev 下软检查足够；若两 tab 同时启动有竞态，可接受。
注意：从 LangGraph Studio 直接启 run 会绕过此检查 - 可接受。

### 7.4 项目删除清理

`DELETE /api/segmented-projects/{pid}` 后端照常删项目（级联 chapters/segments）。
**前端编排 thread 清理**（best-effort，无后端->agent 调用）：

```typescript
// 删项目前/后：
const threads = await client.threads.search({ metadata: { project_id, kind: "narration_workflow" } });
await Promise.allSettled(threads.map(t => client.threads.delete(t.thread_id)));
await api.delete(`/segmented-projects/${project_id}`);
```

`Promise.allSettled` 不阻塞项目删除 - 即使 agent 不可达，项目仍可删；孤儿 thread 在 agent 内存中随重启消失，无害。
**无需 `agent_client.py`，无后端->agent 调用**，架构保持单向。

---

## 8. 持久化（暂不处理）

### 8.1 现状

`langgraph dev` 内存模式：thread、checkpoint、store、线程 metadata 重启即失。
本设计明确接受：dev 会话内 run 记录完整可用（列表、实时进度、interrupt、time-travel）；agent 重启后 run 列表清空。

### 8.2 后续路径（out of scope）

需持久化时切 `langgraph up`（Docker + Postgres + Redis）：
- thread/checkpoint/store 持久化，跨重启存活。
- thread metadata 即持久 run 记录，本设计架构无需改动。
- Windows 下需 WSL2 + Docker Desktop。
- 届时本设计的"暂不处理"项全部解决。

---

## 9. 错误处理

### 9.1 agent 节点

- **软失败**（LLM 空返回/垃圾输出）：instructor 耗尽 `max_retries` -> 节点发 `custom` `{type:"error", stage, message}`，返回 `{error}` 到 state。
  图继续到终态，`values.error` 置位，thread 结束为 idle（非 error），错误字段可见。匹配当前 LLM 内容失败行为。
- **硬失败**（后端 HTTP 不可达、未预期异常）：节点上抛。LangGraph 标 run 为 error，thread status=error。
  run 可经 checkpoint time-travel 重放（会话内）。前端读 run error 显示 + 重放选项。
- **instructor 重试**：自动处理瞬时校验失败（`max_retries=2` -> 3 次尝试）；全失败才上抛软失败。
- **HTTP 重试**：`backend_client.py` 用 `httpx.AsyncClient` 重试传输（2 次退避）处理瞬时后端失败；不可重试错误上抛硬失败。

### 9.2 前端

- `stream.error` / thread `status === "error"` -> `NodeStatusCard` 显示错误 + "从此阶段重放"（time-travel，会话内）。
- 连接断开（`useStream` disconnect）-> 连接指示器（保留当前 `LiveProgress` 的 connected/disconnected）显示断开；`useStream` 自动重连。
- `ReviewPanel`：`stream.respond` 失败 -> 内联错误 + 重试（interrupt 仍活跃，重试安全）。
- `values.error`（软失败）-> 活跃节点卡 + Hub run 卡显示。
- agent 不可达（`client.threads.search` 失败）-> Hub 显示连接错误 + 重试按钮。

---

## 10. 测试

### 10.1 双读验证（适配新架构）

工作流 *状态* 与 *持久输出* 分属不同存储，双读拆分：

| 内容 | 读源 | 校验器 |
|---|---|---|
| Run 状态（stage、review、segments 结构、status） | `/agent/threads/{id}/state`（agent checkpointer，会话内） | `validateThreadState()` |
| Run 持久输出（chapters、segments、audio） | 后端 `voice_clone.db`（现有 `readDbProject`） | 现有 `validateDbProjectRow()` |

新 E2E helper：`readAgentThread(page, threadId)` 经 `page.evaluate(fetch)` 调 `/agent/threads/{id}/state`。
`verifyAgentStateWithScreenshot()` 包装 agent 读 + 校验 + 截图，镜像现有 `verifyDbWithScreenshot()`。

### 10.2 E2E 用例（重写 tests/e2e/specs/workflow.spec.ts）

1. **启动 + 等待 interrupt** - 建 thread（metadata）+ `stream.submit`，等 `stream.interrupts`，断言 thread `status=interrupted` + `values.current_stage=script_review` + `values.review_feedback` 填充。截图。
2. **审批 + 完成** - `stream.respond(approve)`，等 `stream.isLoading=false` + `values.current_stage=completed`，断言 `values.synthesis_results` 填充。双读：agent thread state（completed）+ 后端 DB（chapters/segments/audio 创建）。
3. **拒绝 + 重生成** - `stream.respond(reject)`，断言回环（`values.current_stage=gen_script`、`review_retry_count` 递增），等下次 interrupt。
4. **取消** - 启动 run，`stream.stop()`，断言 thread `status=idle` + `values.current_stage≠completed`（cancelled 推断）。
5. **并发限制** - 有 busy thread 时点"新建"，断言"已有运行中工作流"阻断。
6. **列表显示** - 创建 3 个 thread（completed/interrupted/failed），断言 Hub 从 `client.threads.search` 渲染正确显示状态 + 阶段 + 时间戳。
7. **详情页** - 开 completed run，断言 `WorkflowRunDetail` 显示阶段卡 + timing（从 `client.threads.getHistory`）+ 输出摘要。

### 10.3 Playwright 配置

`playwright.config.ts` `webServer` 变 3 进程数组：

```ts
webServer: [
  { command: 'cd backend && uv run uvicorn main:app --port 8002 --reload', port: 8002, reuseExistingServer: !CI },
  { command: 'cd agent && uv run langgraph dev --port 2024 --no-browser', port: 2024, reuseExistingServer: !CI },
  { command: 'cd frontend && npm run dev', port: 5173, reuseExistingServer: !CI },
]
```

`--no-browser` 抑制测试时 Studio 自开（确认 flag 存在；否则设等价 env）。
agent `.env` 须有 `BACKEND_API_URL=http://127.0.0.1:8002` + LLM keys。
按 CLAUDE.md，webServer 管进程生命周期，不手动启服务。

### 10.4 后端测试

- **删除**：所有 `backend/tests/**/test_workflow*.py`（旧代码已删）。
- **新增**：`test_chapters_batch.py` - 集成测试：建项目，`POST /chapters:batch`，断言 DB 行 + voice 解析 + 二次调用替换不重复 + 返回 id。
- 确认现有 `segmented-projects` 删除测试在无 `workflow_runs` 表后仍绿（级联关系已移除）。

### 10.5 agent 测试（agent/tests/，`cd agent && uv run --extra test pytest`）

- **节点单测**：每节点 mock LLM（instructor）+ mock `BackendClient` + fake `Runtime`（内存 store）。断言 state 更新 + custom 事件发出。
- **图集成测试**：进程内编译图（无 server），端到端 mock，断言状态转移 + interrupt + `Command(resume=...)` 恢复 + auto-reject 回环。
- **`backend_client` 测试**：mock `httpx`，断言调用 + 瞬时重试 + 硬失败上抛。
- **`llm.py` 测试**：断言 instructor 客户端用正确 `Mode`（DashScope=JSON，MiMo=MD_JSON）+ MiMo 自定义 auth header。

### 10.6 前端测试

- `useProjectRuns` hook 测试（mock `Client.threads.search/create`）。
- 契约测试：`NODE_STATE_KEYS` + 样本 `values` -> 正确节点状态推断。
- `PipelineTimeline` 从 mock `stream.values` 渲染节点状态。
- `ReviewPanel` 读 `stream.interrupts[0].value` + approve/reject 调 `stream.respond` 正确 payload。

### 10.7 Studio 手动验证（前端之前）

`https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024`：
- 启 run `{project_id}`，看 gen_script -> script_review(interrupt) -> resume -> split_segment -> synthesis。
- 确认 custom 里程碑事件出现在流面板。
- 确认图拓扑渲染（4 节点 + reject 回环）。
- 确认 director feedback 跨第二次 run 持久（reject 后重生成读上次反馈）。

---

## 11. 切换计划

big-bang：构建按序进行，**旧后端工作流代码一次性原子删除**，无长期双系统并存。

### Phase A - agent + 后端批量端点（旧系统未动，仍服务）

1. `agent/`：`langgraph.json`、`state.py`、`schemas.py`、`prompts/narration.py`、`llm.py`（instructor）、`backend_client.py`、`nodes/*.py`、`graph.py`。
2. 后端：加 `POST /segmented-projects/{id}/chapters:batch` + service（voice 解析、替换不重复）。
3. agent 单测 + 图集成测试绿。后端批量端点测试绿。Studio 手动验证通过。

### Phase B - 前端重建（旧后端工作流代码成死代码，仍在）

4. `frontend/`：加 `@langchain/langgraph-sdk`，Vite `/agent` proxy，`services/langgraph/*`，重建 `components/Workflow/*` 对齐 warm-amber token。
5. `playwright.config.ts`：加 agent webServer。重写 `workflow.spec.ts`。按需更新 `global-setup.ts`。
6. E2E 绿（全部 spec）。视觉审查对齐设计 token。

### Phase C - 切换（原子删除）

7. 后端：删 `api/workflow.py`、`services/workflow_*.py`（5 文件）、`services/prompts/workflow_prompts.py`、`models/workflow_run.py`、`schemas/workflow.py`；从 `main.py` 去掉 `init_workflow_engine()` + `workflow.router`；从 `SegmentedProject` 去掉 `workflow_runs` relationship。
8. DB 迁移：drop `workflow_runs` 表。
9. 删旧后端工作流测试；确保剩余后端测试套件绿。
10. 全 E2E 跑（全部 spec）绿 + 最终视觉审查。
11. 更新文档：`feature-spec.md`、`api-reference.md`、`database-schema.md`、`AGENTs.md`（加 agent 服务 + `/agent` proxy + 3 进程拓扑）、`TEST_MAP.md`、`e2e-test-guide.md`。

---

## 12. 依赖

### 12.1 agent（agent/pyproject.toml）

```
langgraph>=1.2.9
langgraph-cli[inmem]      # langgraph dev
pydantic>=2.13.4
httpx>=0.27
instructor>=1.4
langchain-core>=0.3       # instructor 依赖
openai>=1.50              # instructor 底层客户端
```

### 12.2 后端

无新增（`langgraph`/`langgraph-checkpoint-sqlite`/`aiosqlite` 随工作流代码删除而移除）。

### 12.3 前端

```
@langchain/langgraph-sdk  # useStream + Client
```

---

## 13. 遗留与后续

| 项 | 状态 | 说明 |
|---|---|---|
| 持久化（run 跨重启） | **暂不处理** | dev 内存模式接受重启即失；后续切 `langgraph up`（Docker + Postgres + Redis），架构无需改 |
| 跨重启 time-travel | out of scope | 需持久 checkpointer；当前会话内有效 |
| 生产部署 | out of scope | `langgraph up` / LangGraph Platform；Windows 需 WSL2 + Docker Desktop |
| LangGraph Platform 认证 | out of scope | 生产部署时加 custom auth |
| 多 workflow 支持 | 架构预留 | `langgraph.json` 多 assistant + `NODE_STATE_KEYS`/`INPUT_FIELDS` 多 entry；仅实现 narration |
| 结构化节点实时构建 | 可选增强 | `create_partial` 流式部分对象；当前用里程碑 |
| synthesize 端点轻量响应 | 可选优化 | 当前返回全 `ProjectDetail`；加 `?fields=segment` 减负 |
| 项目删除 thread 清扫 | 前端 best-effort | `client.threads.delete`；agent 不可达时孤儿 thread 重启消失 |
