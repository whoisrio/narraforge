# Workflow 迁移到 LangGraph Agent 架构设计

## 目录

| 章节 | 内容 |
|---|---|
| [1. 概述](#1-概述) | 目标、核心决策、范围 |
| [2. 架构与拓扑](#2-架构与拓扑) | 三服务拓扑、通信方向、保留/删除清单 |
| [3. Agent 设计](#3-agent-设计) | langgraph.json、图定义、状态、节点、instructor、backend_client |
| [4. 后端变更](#4-后端变更) | chapters:batch 端点、删除清单 |
| [5. 前端重建](#5-前端重建) | 触发位置、侧边抽屉、三级阶段呈现、流通道映射、视觉 |
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
工作流是临时性（内存态），触发点在源文档处，不单独占用一个工作区。

### 1.2 核心决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| Agent -> 后端 | HTTP | agent 是纯 LangGraph 服务，不持有 project/chapter/segment 表；后端保持单一数据源 |
| 前端 -> 服务 | 直连两个源 (`/api` + `/agent`) | SSE 流端到端，`useStream` 原生可用 |
| Run 关联 | thread metadata（`{project_id, project_name, kind}`） | LangGraph thread 原生可按 metadata 搜索；无需后端索引表 |
| 触发位置 | 「文本库 · 源文档」tab 内 | 工作流临时性，不应是独立工作区；从源文档触发最自然 |
| 工作流容器 | 非阻塞侧边抽屉（可折叠指示条） | 长任务不锁用户；跨 section 持续可见；大体量内容可全屏升级 |
| 阶段内容呈现 | 三级（L1 折叠 / L2 内联展开 / L3 全屏模态） | 每阶段内容量大，按需升级，抽屉不臃肿 |
| 实时进度 | LangGraph 流通道（values/messages/custom/interrupts） | 消除 `workflow_progress.py`；节点用 `get_stream_writer()` 发里程碑 |
| 结构化 LLM 输出 | instructor | 消除 `extract_json_object`/`extract_json_array` 脆弱解析 + 手写重试 |
| 图标 | Material Symbols Outlined | 与代码库现有 `material-symbols-outlined` 一致 |
| 迁移方式 | big-bang 整体切换 | 一次性删除旧后端工作流代码，无长期双系统并存 |
| 持久化 | **暂不处理** | dev 用 `langgraph dev` 内存模式，重启即失；持久化后续再决策 |

### 1.3 范围

**本设计覆盖**：agent 服务搭建、后端工作流代码删除、前端 `useStream` + 抽屉重建、E2E 适配、big-bang 切换序列。
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

- agent `.env`：`BACKEND_API_URL=http://127.0.0.1:8002` + `AGENT_LLM_API_KEY` / `AGENT_LLM_BASE_URL` / `AGENT_LLM_MODEL`（**仅此一组**，缺失即抛异常，无 `LLM_*`/`MIMO_*` 多层兜底）+ `LANGSMITH_API_KEY`（可选；缺失则 prompt 用代码默认值）。
- 后端无需 agent URL（不调用 agent）。
- 开发态 agent 无认证；生产认证后续按 LangGraph Platform custom auth 处理（out of scope）。
- prompts 读取策略：运行时先 `langsmith.Client().pull_prompt(name)` 从 LangSmith 拉；失败（无 key / 未发布 / 网络错）则用 `agent/app/prompts/narration.py` 里的代码默认值。LangSmith 仅为可选的 prompt 热更新通道。

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

provider 感知客户端，**仅读 `AGENT_LLM_*`**（缺失抛异常，无多层兜底），用 instructor 的 `Mode`：

```python
import instructor
from openai import AsyncOpenAI
from instructor import Mode
from app.config import get_agent_llm_config

def get_instructor_client() -> tuple[instructor.AsyncInstructor, str]:
    api_key, base_url, model = get_agent_llm_config()  # AGENT_LLM_* only, raises if missing
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

### 3.3b Prompt 加载（agent/app/prompts/narration.py）

代码默认 prompt 常量保留（与现有 `workflow_prompts.py` 一致），作为兜底。`get_prompt(name, **vars) -> str` 运行时先从 LangSmith 拉，失败回退默认值：

```python
from langsmith import Client
from langsmith.client import convert_prompt_to_openai_format

_DEFAULTS = {
    "gen_script": GEN_SCRIPT_SYSTEM_PROMPT,
    "script_review": SCRIPT_REVIEW_SYSTEM_PROMPT,
    "split_segment": SPLIT_SEGMENT_SYSTEM_PROMPT,
    "preference_extract": PREFERENCE_EXTRACT_PROMPT,
}
_LANGSMITH_NAMES = {
    "gen_script": "narraforge-gen-script",
    "script_review": "narraforge-script-review",
    "split_segment": "narraforge-split-segment",
    "preference_extract": "narraforge-preference-extract",
}
_client: Client | None = None

def get_prompt(name: str, **vars) -> str:
    default = _DEFAULTS[name]
    ls_name = _LANGSMITH_NAMES.get(name)
    if ls_name:
        try:
            global _client
            if _client is None:
                _client = Client()  # reads LANGSMITH_API_KEY; raises if absent -> caught below
            pt = _client.pull_prompt(ls_name)
            msgs = convert_prompt_to_openai_format(pt.invoke(vars))
            for m in msgs:
                if m.get("role") == "system" and m.get("content"):
                    return m["content"]
            if msgs and msgs[0].get("content"):
                return msgs[0]["content"]
        except Exception:
            pass  # fall through to default
    return default.format(**vars) if vars else default
```

节点用 `get_prompt("gen_script")` / `get_prompt("script_review")` / `get_prompt("split_segment")` / `get_prompt("preference_extract", feedback=...)` 取 prompt。
未配置 `LANGSMITH_API_KEY` 或 prompt 未发布时，自动用代码默认值，agent 正常工作。

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

### 5.1 触发位置与容器

工作流不再是独立工作区。「工作流」nav 项从 `ProjectShell` 导航移除。
触发动作并入「文本库 · 源文档」tab -- 源文档面板下方加「▶ 生成旁白」触发区。
点击后从右侧滑入**非阻塞侧边抽屉**（`WorkflowDrawer`），覆盖 workspace 右侧约 56%，左侧源文档仍可见可编辑。

抽屉是 **workspace 级**（非 section 级）：切到工作室/角色等 section 时抽屉仍可见。
抽屉可折叠成右下常驻指示条（`DrawerIndicator`），点击重新展开。
interrupt（等待审批）时指示条琥珀脉冲 `notifications_active` 高亮提醒。

### 5.2 组件结构

```
src/services/langgraph/
├── client.ts          # Client 单例: new Client({ apiUrl: "/agent" })
├── contracts.ts       # NODE_STATE_KEYS, INPUT_FIELDS
└── types.ts           # NarraWorkflowState TS 镜像（镜像 agent schemas）

src/components/Workflow/
├── WorkflowDrawer.tsx       # 侧边抽屉容器，持有 useStream + 折叠/展开
├── DrawerIndicator.tsx      # 折叠态常驻指示条（运行中/等待审批）
├── PipelineTimeline.tsx     # 4 阶段横向 timeline（来自 GET /assistants/narration/graph）
├── StageCard.tsx            # 单阶段卡片，L1 折叠 / L2 内联展开
├── ReviewPanel.tsx          # HITL 审批（stream.interrupts + stream.respond），L2 内联 + L3 全屏
├── StageDetailModal.tsx     # L3 全屏模态：脚本全文 / 段落结构树 / 完整审批
└── *.module.css             # NarraForge warm-amber token + Material Symbols
```

`useWorkflowStream.ts`（自定义 SSE hook）、`WorkflowPage.tsx`、`WorkflowHub.tsx`、`LiveProgress.tsx`、`WorkflowRunDetail.tsx`、`ReviewEditor.tsx` **全部删除**。
`ProjectShell` 的 `projectNavItems` 移除 `workflow` 项；`SECTION_ICONS` 去掉 `workflow`。
`ProjectLibrary`（文本库）源文档 tab 下方加「生成旁白」触发区，调用 `WorkflowDrawer` 打开。

### 5.3 useStream 接线（WorkflowDrawer）

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

`PipelineTimeline` 读 `stream.values` + 拉取的图拓扑 + `NODE_STATE_KEYS` 渲染阶段状态。
`StageCard`（gen_script）额外读 `stream.messages`（按 `metadata.langgraph_node === "gen_script"` 过滤）显示实时 token。

### 5.4 三级阶段呈现

每阶段内容量差异大（gen_script 完整脚本、split_segment 章节×段落树、script_review 6 维度+脚本），采用按需升级的三级呈现：

| 级别 | 触发 | 内容 | 占位 |
|---|---|---|---|
| **L1 折叠**（默认） | 初始 | 状态图标 + 阶段名 + 一行摘要（字数/段数/评分/耗时） | 小，所有阶段始终可见 |
| **L2 内联展开** | 点击卡片 | 章节摘要列表 + 内容预览（截断 + 渐隐）+ 「全屏查看」按钮 | 中，抽屉内滚动 |
| **L3 全屏模态** | 点「全屏」 | 完整内容：脚本全文阅读/编辑、段落结构树、完整审批面板 | 遮罩 + 居中，ESC/✕ 关闭 |

- 活跃阶段默认 L2 展开；多阶段可同时 L2（非互斥），抽屉内滚动。
- 大体量内容才升 L3，避免频繁跳层。
- L1/L2/L3 同数据源（`stream.values` 全量字段），仅呈现层级不同。

### 5.5 ReviewPanel（HITL 领域组件）

读 `stream.interrupts[0].value = { script, review: ReviewResult, available_actions }`。
L2 内联：LLM 维度卡（pass 绿/warn 琥珀/fail 红，Material Symbols `check_circle`/`warning`/`cancel`）+ 总评星级（`star` 填充/轮廓）+ 可编辑脚本 textarea + 导演备注 + 三按钮（拒绝 `close` / 批准 `check` / 批准并编辑 `edit`）。
L3「全屏审批」：维度卡 + 完整可编辑脚本 + 导演备注 + 批准/拒绝，全屏操作更从容。

```tsx
stream.respond({ action: "approve", edited_script, comment });
stream.respond({ action: "reject", feedback });
```

agent 侧 `interrupt()` payload 形状不变，ReviewPanel 契约与今天一致 - 只换传输（SSE -> `stream.interrupts`，resume 端点 -> `stream.respond`）。

### 5.6 Reject 回环呈现

reject 不是终态。两种 reject 路径，抽屉持续呈现回环：

- **人工拒绝**：导演反馈写入 Store（`director_feedback` namespace）-> timeline 回到 ① 生成脚本（重生成，旋转 `progress_activity`）-> 红色 banner 显示拒绝反馈（`block` 图标，「反馈已带入重新生成」）-> gen_script 流式输出新脚本 -> 上一轮审查折叠可回看（`cancel` 图标 + 评分）。
- **自动拒绝**：LLM 评分 <3 或 `has_critical_issue` -> 节点自动 reject（不 interrupt）-> 琥珀 banner（`autorenew` 图标，区别于人工拒绝的红色）+ 评分 + 一票否决项 + 自动重试计数（2/3 次）。
- 抽屉头显示「第 N/4 次」徽标（3 次自动重试 + 当前）。3 次自动拒绝后强制人工审批（防死循环）。
- 反馈经 `_extract_preference` 提取偏好存 Store（`director_preference`），后续 split_segment 也参考。
- 数据来自 `stream.values`（current_stage / review_retry_count）+ `custom` 通道（`auto_reject` 事件）。

### 5.7 启动 + 中断流程

1. 「文本库 · 源文档」tab 下「▶ 生成旁白」-> 并发检查（`client.threads.search` 按 `metadata.project_id` 过滤活跃 thread；若有 busy/interrupted 则阻断）。
2. `client.threads.create({ metadata: { project_id, project_name, kind: "narration_workflow" } })` -> `thread_id`。
3. `WorkflowDrawer` 打开，`useStream` 连接 -> thread idle -> `stream.submit({ input: { project_id } })`。
4. `gen_script` 流式 token（`messages`）+ 里程碑（`custom`）-> timeline 显示运行中，脚本实时构建（L2 内联展开，流式光标）。
5. `script_review`（instructor -> `ReviewResult`）-> `interrupt()` -> `stream.interrupts` 填充 -> `ReviewPanel` 渲染（L2）。
6. 导演 approve/reject -> `stream.respond(decision)` -> run 恢复（reject 则回环 5.6）。
7. `split_segment` -> `batch_create_structure` HTTP -> `synthesis`（custom `N/M`，L2 显示进度条 + 每章段状态）-> `END`。
8. `stream.isLoading === false` + `values.current_stage === "completed"` -> 抽屉转完成态 + 「前往工作室查看」-> 收起。

### 5.8 视觉与图标

对齐 `src/styles/variables.css`（暖琥珀浅色：背景 `#fff8f1`、surface `#fff`、primary `#c47a3a`、success `#2a9d8f`、warning `#d4944e`、error `#c0392b`）与设计指南（`docs/design/stitch_narraforge_story_global_prj/DESIGN.md`）。
图标用 **Material Symbols Outlined**（与代码库 `WorkflowHub.tsx`/`LiveProgress.tsx` 已用的 `material-symbols-outlined` 一致）：

- 导航：`dashboard` 总览 · `menu_book` 文本库 · `graphic_eq` 工作室 · `record_voice_over` 角色 · `settings` 项目设置
- 阶段：`edit_note` 生成脚本 · `rate_review` 脚本审查 · `content_cut` 段落拆分 · `mic` 语音合成
- 状态：`check_circle`(填充绿) 完成/pass · `progress_activity`(旋转琥珀) 运行中 · `warning`(填充琥珀) warn · `cancel`(填充红) fail
- 操作：`auto_awesome` 生成旁白 · `close` 拒绝/关闭 · `check` 批准 · `edit` 批准并编辑 · `unfold_less` 折叠 · `expand_more` 展开 · `fullscreen` 全屏 · `account_tree` 工作流标识
- 评分：`star`(填充)/`star`(轮廓)
- 指示条：运行中 `progress_activity`(旋转)；interrupt `notifications_active`(脉冲)

填充态（`FILL=1`）用于完成/评分/warn，轮廓态用于导航与操作，视觉层次清晰。
不引入新色板 - 严格用现有琥珀前置 token（按 CLAUDE.md：禁止紫色为主；暖琥珀为方案）。

### 5.9 Time-travel（会话内）

保留但基于 LangGraph 原生 checkpoint 模型：L3 全屏详情或完成态抽屉调 `client.threads.getHistory({ thread_id })` 列 checkpoint；"从 X 阶段重放" 找 `next === [stage]` 的 checkpoint，经 `client.runs.create(thread_id, assistant_id, { checkpoint_id, command })` 重启。
Fork = 同上 + `update_state` 覆盖。
替代当前 `replay`/`fork` 端点。会话内有效（thread 存在时）；重启后无历史（持久化暂不处理）。
标记为后续子阶段 - 主流程先交付。

---

## 6. 实时进度数据流

### 6.1 流通道 -> UI 映射

| 通道 | useStream 访问 | 渲染位置 |
|---|---|---|
| `values` | `stream.values` | `PipelineTimeline`：阶段状态（completed/running/pending via NODE_STATE_KEYS）、`current_stage`、结构化摘要（章节数、段落数、评分） |
| `messages` | `stream.messages` | `StageCard`（gen_script）：实时脚本文本，token 级 |
| `custom` | `onCustomEvent` 回调 | `StageCard` 里程碑流（按阶段）：`llm_call`、`llm_response`、`auto_reject`、`progress`（synthesis `N/M`） |
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

thread 对象即完整 run 记录 - status、当前阶段、结构化输出、时间戳全部在 thread 上，无需后端表。
因内存态不持久，不单独做 run 历史列表；会话内一项目一活跃 run（见 7.3），抽屉即该 run 的唯一呈现。

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

**前端 thread 搜索检查**（在「生成旁白」触发按钮 handler 内，dev 单用户可接受软检查）：

```typescript
const existing = await client.threads.search({
  metadata: { project_id, kind: "narration_workflow" }, limit: 50,
});
const active = existing.filter(t => t.status === "busy" || t.status === "interrupted");
if (active.length) {
  alert(t("workflow.hub.activeWorkflowExists"));   // 阻断 + 引导打开已有抽屉
  return;
}
// ... client.threads.create(...)
```

`interrupted` 计为活跃（须先审批/取消）。单用户本地 dev 下软检查足够。
从 LangGraph Studio 直接启 run 会绕过此检查 - 可接受。

### 7.4 项目删除清理

`DELETE /api/segmented-projects/{pid}` 后端照常删项目（级联 chapters/segments）。
**前端编排 thread 清理**（best-effort，无后端->agent 调用）：

```typescript
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
本设计明确接受：dev 会话内 run 记录完整可用（抽屉实时进度、interrupt、time-travel）；agent 重启后 run 清空。

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

- `stream.error` / thread `status === "error"` -> `StageCard` 显示错误 + "从此阶段重放"（time-travel，会话内）。
- 连接断开（`useStream` disconnect）-> 抽屉头连接指示器显示断开；`useStream` 自动重连。
- `ReviewPanel`：`stream.respond` 失败 -> 内联错误 + 重试（interrupt 仍活跃，重试安全）。
- `values.error`（软失败）-> 活跃阶段卡显示。
- agent 不可达（`client.threads.search` 失败）-> 触发按钮显示连接错误 + 重试。

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

1. **启动 + 等待 interrupt** - 在「文本库 · 源文档」tab 点「生成旁白」，建 thread + `stream.submit`，等 `stream.interrupts`，断言 thread `status=interrupted` + `values.current_stage=script_review` + `values.review_feedback` 填充。截图（抽屉展开态）。
2. **审批 + 完成** - `stream.respond(approve)`，等 `stream.isLoading=false` + `values.current_stage=completed`，断言 `values.synthesis_results` 填充。双读：agent thread state（completed）+ 后端 DB（chapters/segments/audio 创建）。
3. **拒绝 + 重生成** - `stream.respond(reject)`，断言回环（`values.current_stage=gen_script`、`review_retry_count` 递增），红色反馈 banner 显示，等下次 interrupt。
4. **自动拒绝** - 构造低分 review，断言 `auto_reject` custom 事件 + 琥珀 banner + 自动回环（不 interrupt），3 次后强制 interrupt。
5. **取消** - 启动 run，`stream.stop()`，断言 thread `status=idle` + `values.current_stage≠completed`（cancelled 推断）。
6. **并发限制** - 有 busy thread 时点「生成旁白」，断言"已有运行中工作流"阻断。
7. **三级呈现** - 完成后点阶段卡片 L2 展开，点「全屏」L3 模态，断言完整脚本/段落树渲染。
8. **折叠/跨 section** - 抽屉折叠成指示条，切到工作室，断言指示条仍在；点指示条重新展开。

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

- `WorkflowDrawer` hook 测试（mock `useStream` + `Client.threads.search/create`）。
- 契约测试：`NODE_STATE_KEYS` + 样本 `values` -> 正确阶段状态推断。
- `PipelineTimeline` 从 mock `stream.values` 渲染阶段状态。
- `StageCard` L1/L2 切换 + `StageDetailModal` L3 打开。
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

4. `frontend/`：加 `@langchain/langgraph-sdk`，Vite `/agent` proxy，`services/langgraph/*`，建 `WorkflowDrawer`/`StageCard`/`ReviewPanel`/`StageDetailModal`/`DrawerIndicator`/`PipelineTimeline` 对齐 warm-amber + Material Symbols。
5. `ProjectShell` 移除 `workflow` nav 项；`ProjectLibrary` 源文档 tab 加「生成旁白」触发区。
6. 删旧 `WorkflowPage`/`WorkflowHub`/`LiveProgress`/`WorkflowRunDetail`/`ReviewEditor`/`useWorkflowStream`。
7. `playwright.config.ts`：加 agent webServer。重写 `workflow.spec.ts`。按需更新 `global-setup.ts`。
8. E2E 绿（全部 spec）。视觉审查对齐设计 token。

### Phase C - 切换（原子删除）

9. 后端：删 `api/workflow.py`、`services/workflow_*.py`（5 文件）、`services/prompts/workflow_prompts.py`、`models/workflow_run.py`、`schemas/workflow.py`；从 `main.py` 去掉 `init_workflow_engine()` + `workflow.router`；从 `SegmentedProject` 去掉 `workflow_runs` relationship。
10. DB 迁移：drop `workflow_runs` 表。
11. 删旧后端工作流测试；确保剩余后端测试套件绿。
12. 全 E2E 跑（全部 spec）绿 + 最终视觉审查。
13. 更新文档：`feature-spec.md`、`api-reference.md`、`database-schema.md`、`AGENTs.md`（加 agent 服务 + `/agent` proxy + 3 进程拓扑 + 工作流触发位置变更）、`TEST_MAP.md`、`e2e-test-guide.md`。

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
langsmith>=0.3            # prompt 拉取（可选，缺失回退代码默认）
```

### 12.2 后端

无新增（`langgraph`/`langgraph-checkpoint-sqlite`/`aiosqlite` 随工作流代码删除而移除）。

### 12.3 前端

```
@langchain/langgraph-sdk  # useStream + Client
```

Material Symbols Outlined 字体已在代码库使用，无新增。

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
