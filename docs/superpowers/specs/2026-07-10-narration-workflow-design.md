# 旁白脚本自动化工作流设计

## 目录

| 章节 | 内容 |
|---|---|
| [1. 概述](#1-概述) | 目标、核心需求、技术选型 |
| [2. 架构](#2-架构) | 系统架构图、存储布局 |
| [3. LangGraph 图定义](#3-langgraph-图定义) | State、Graph 结构、可视化 |
| [4. 节点实现](#4-节点实现) | 4 个节点的 system prompt + 代码 |
| [5. 状态机](#5-状态机) | Status 定义、操作矩阵、转换图 |
| [6. 数据模型](#6-数据模型) | WorkflowRun 表、Store namespace、AsyncSqliteStore、耗时计算 |
| [7. API 设计](#7-api-设计) | 8 个端点、Request/Response、SSE 流 |
| [8. 前端 UI 设计](#8-前端-ui-设计) | WorkflowHub、ReviewEditor、RunDetail 三页面 |
| [9. Streaming 实现](#9-streaming-实现) | 后端 SSE、前端消费、事件类型 |
| [10. Time Travel](#10-time-travel) | Replay/Fork 实现和前端交互 |
| [11. 错误处理](#11-错误处理) | 节点异常、前端展示、重试策略 |
| [12. 并发控制](#12-并发控制) | 一项目一工作流、Cancel 实现 |
| [13. 国际化 (i18n)](#13-国际化-i18n) | 翻译结构、Key 命名规范、完整 Key 列表 |
| [14. 依赖](#14-依赖) | 新增 Python 包 |

---

## 1. 概述

### 1.1 目标

为 NarraForge 引入基于 LangGraph 的多阶段旁白脚本工作流，将源文档自动转化为可合成的分段旁白项目。

核心流程：

```
源文档 → GenScript → ScriptReview → SplitSegment → Synthesis → 完成
                     (人工审批门)
```

### 1.2 核心需求

| 需求 | 说明 |
|---|---|
| 自动化脚本生成 | LLM 将源文档转化为视频旁白脚本 |
| 人工审批门 | ScriptReview 阶段暂停，等待导演审批 |
| 结构化拆分 | LLM 输出章节 + 段落 + 情绪 + 角色 |
| 导演偏好学习 | 审批反馈存入长期记忆，供后续生成参考 |
| Time Travel | 支持从任意阶段 replay / fork |
| 实时流式反馈 | 前端实时显示每个阶段的执行进度 |

### 1.3 技术选型

| 组件 | 选型 | 理由 |
|---|---|---|
| 工作流引擎 | LangGraph (StateGraph) | 原生支持 interrupt、checkpoint、time travel、store |
| Checkpoint | `SqliteSaver` (langgraph-checkpoint-sqlite) | 复用现有 SQLite，零新依赖 |
| Store | `AsyncSqliteStore` (自定义实现) | LangGraph 无内置 SQLite Store，接口简单（4 个方法） |
| Streaming | FastAPI SSE + `graph.astream_events()` | 复用现有 FastAPI 架构 |
| 前端 SDK | 标准 `fetch` + `ReadableStream` | 不依赖 LangGraph Server |

---

## 2. 架构

### 2.1 系统架构图

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React)                      │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ WorkflowHub  │  │ RunDetail    │  │ ReviewEditor  │  │
│  │ (Run 列表)   │  │ (阶段进度)    │  │ (脚本审批)     │  │
│  └──────┬──────┘  └──────┬───────┘  └───────┬───────┘  │
└─────────┼────────────────┼──────────────────┼───────────┘
          │                │                  │
          ▼                ▼                  ▼
┌─────────────────────────────────────────────────────────┐
│                  FastAPI Backend (:8002)                 │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  /api/workflow/*  (工作流 REST API + SSE)          │  │
│  └───────────────────────┬───────────────────────────┘  │
│                          │                              │
│  ┌───────────────────────▼───────────────────────────┐  │
│  │  LangGraph StateGraph (in-process)                │  │
│  │                                                   │  │
│  │  gen_script ──→ script_review ──→ split_segment   │  │
│  │                     │                    │        │  │
│  │                     │ reject             ▼        │  │
│  │                     └──→ gen_script   synthesis   │  │
│  └───────────────────────┬───────────────────────────┘  │
│                          │                              │
│  ┌───────────┐  ┌───────▼───────┐  ┌───────────────┐  │
│  │ SQLite DB │  │ Checkpoint    │  │ Store         │  │
│  │ (ORM)     │  │ (SqliteSaver) │  │ (AsyncSqlite) │  │
│  └───────────┘  └───────────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 2.2 存储布局

```
backend/
  voice_clone.db            ← 现有 SQLite（ORM 表 + workflow_runs 表）
  workflow_checkpoints.db   ← LangGraph Checkpoint (SqliteSaver)
  workflow_store.db         ← LangGraph Store (AsyncSqliteStore)
```

---

## 3. LangGraph 图定义

### 3.1 State

```python
class NarrationWorkflowState(TypedDict):
    # ── 输入 ──
    project_id: str
    run_id: str
    source_document: str

    # ── GenScript 输出 ──
    narration_script: str           # 完整旁白文档（markdown）
    script_chapters: list[dict]     # [{title, content}]

    # ── ScriptReview 输出 ──
    review_feedback: str            # LLM Review 反馈
    edited_script: str              # 人工编辑后的脚本
    review_status: str              # "approved" | "rejected"

    # ── SplitSegment 输出 ──
    structured_segments: list[dict] # [{chapter_title, segments: [{text, emotion, role, segment_kind}]}]

    # ── Synthesis 输出 ──
    synthesis_results: list[dict]   # [{chapter_index, segment_index, segment_id, audio_path, duration_sec}]

    # ── 元数据 ──
    current_stage: str
    error: str | None
```

### 3.2 Graph 结构

```python
def route_after_review(state: NarrationWorkflowState) -> str:
    if state["review_status"] == "approved":
        return "split_segment"
    return "gen_script"


graph = (
    StateGraph(NarrationWorkflowState)
    .add_node("gen_script", gen_script_node)
    .add_node("script_review", script_review_node)
    .add_node("split_segment", split_segment_node)
    .add_node("synthesis", synthesis_node)
    .add_edge(START, "gen_script")
    .add_edge("gen_script", "script_review")
    .add_conditional_edges("script_review", route_after_review)
    .add_edge("split_segment", "synthesis")
    .add_edge("synthesis", END)
    .compile(checkpointer=SqliteSaver(conn), store=AsyncSqliteStore(db_path))
)
```

### 3.3 图结构可视化

```
        ┌──────────────────────────────────────────┐
        │                                          │
        ▼                                          │
  ┌───────────┐                                    │
  │gen_script │                                    │
  └─────┬─────┘                                    │
        │                                          │
        ▼                                          │
  ┌─────────────┐                                  │
  │script_review│                                  │
  │ (interrupt) │                                  │
  └──┬───────┬──┘                                  │
     │       │                                     │
reject│   approve                                  │
     │       │                                     │
     │       ▼                                     │
     │ ┌───────────┐                               │
     │ │split_seg- │                               │
     │ │  ment     │                               │
     │ └─────┬─────┘                               │
     │       │                                     │
     │       ▼                                     │
     │ ┌───────────┐                               │
     │ │ synthesis │                               │
     │ └─────┬─────┘                               │
     │       │                                     │
     │       ▼                                     │
     │     ┌────┐                                  │
     │     │END │                                  │
     │     └────┘                                  │
     │                                             │
     └─────────────────────────────────────────────┘
           reject 回到 gen_script
           feedback 写入 Store 供下次参考
```

---

## 4. 节点实现

### 4.1 gen_script — 旁白脚本生成

**职责**: 将源文档转化为适合视频旁白的脚本文档。

**输入**: `source_document`（项目源文档 markdown）

**输出**: `narration_script`（完整旁白文档）, `script_chapters`（章节结构）

**System Prompt**:

```python
GEN_SCRIPT_SYSTEM_PROMPT = """
# 角色定义
你是一位顶尖的AI科普旁白脚本作家。你的任务是将输入的AI科普原始文档，转化为一份可以直接用于视频配音的纯文本旁白脚本。听众是有一定技术背景的大众。

# 硬性写作规则
1. **章节划分**：严格按照原始文档的「二级标题」来划分旁白的章节。将所有 Markdown 格式的标题（如 ## 标题）转换为纯文本章节标记，格式为“【章节：原标题】”。每个章节构成一个独立的旁白段落。
2. **结论先行**：每个章节段落，都必须先用1-2句话提炼出该部分最核心的关键结论，再展开具体描述和通俗解释。
3. **数据保真**：严禁编纂任何数据或事实。旁白脚本的含义必须与原始文档严格一致。所有关键数据说明必须原样保留，但可以用更口语化的方式重新表达。
4. **移除标记**：最终输出的旁白脚本必须是纯文本，不得包含任何 Markdown 标记符号（如 #, *, -, ` 等）。

# 口语化与听觉设计规则
1. **绝对口语化**：完全打散书面语结构，每句话不超过25个字。大量使用“你想想看”、“咱们”、“其实吧”、“说白了就是”等口语词。
2. **术语快解释**：遇到专业术语，必须立即用一句话的生活比喻或通俗说法带过，绝不展开讲大故事。
   - 示例：“这就用到了‘自注意力机制’——说白了，就是让模型在海量信息中，一眼盯住最关键的部分。”
3. **听觉牵引感**：频繁使用设问（“这是怎么做到的呢？”）、感叹（“没错！”）、转折（“但问题来了……”）来牵引听众注意力，营造一对一的对话感。
4. **结构完整**：脚本必须具备“凤头-猪肚-豹尾”。
   - **开场**：用生活痛点、惊人事实或假设性提问瞬间抓住听众。
   - **结尾**：用金句总结升华，并包含互动引导（如“如果你觉得有意思，请分享给更多人”）。

# 输出格式

输出完整的 markdown 文档，使用 # 标记章节标题，段落之间用空行分隔。

不要输出任何元数据、说明或注释，只输出旁白脚本正文。
"""
```

**节点代码**:

```python
def gen_script_node(state: NarrationWorkflowState, runtime: Runtime):
    project_id = state["project_id"]
    run_id = state["run_id"]

    # 更新 WorkflowRun 状态
    update_workflow_run(run_id, status="running", current_stage="gen_script")

    # 查询历史 reject feedback（如有）
    namespace = ("director_feedback", project_id)
    past_feedback = await runtime.store.asearch(namespace, query="reject feedback", limit=3)
    feedback_context = ""
    if past_feedback:
        feedback_context = "\n\n## 导演历史反馈（请参考）\n" + "\n".join(
            f"- {item.value['feedback']}" for item in past_feedback
        )

    # 调用 LLM
    script = llm_client.generate(
        system=GEN_SCRIPT_SYSTEM_PROMPT,
        user=f"请将以下源文档转化为视频旁白脚本：\n\n{state['source_document']}{feedback_context}"
    )

    # 解析章节结构
    chapters = parse_markdown_chapters(script)

    return {
        "narration_script": script,
        "script_chapters": chapters,
        "current_stage": "script_review"
    }
```

---

### 4.2 script_review — 脚本审查（含 interrupt）

**职责**: LLM 自动审查 + 人工审批门。

**输入**: `narration_script`

**输出**: `edited_script`, `review_feedback`, `review_status`

**LLM Review System Prompt**:

```python
SCRIPT_REVIEW_SYSTEM_PROMPT = """你是一位资深的视频导演助理，负责审查旁白脚本质量。

请从以下维度审查旁白脚本，并给出具体的改进建议：

## 审查维度

1.  **内容忠实度（一票否决项）**
    - 旁白含义是否与原始文档完全一致？是否存在编造数据、曲解原意的情况？
    - 原始文档中的关键数据说明是否被完整保留？
2.  **口语化与可讲度**
    - 每一句话是否都像“人话”？朗读起来是否顺口，没有任何生硬的书袋感？
    - 句子长度是否都控制在25字以内？长句是否已有效拆分？
3.  **结构清晰度与节奏**
    - 章节划分是否与原始文档的二级标题严格对应？
    - 每个章节是否做到了“结论先行”？逻辑是否由浅入深、流畅不跳跃？
    - 开场是否在3秒内抓住注意力？结尾是否有清晰的互动引导？
4.  **术语与比喻的恰当性**
    - 专业术语是否都做了一句话的快解释？比喻是否通俗准确，没有误导或引起歧义？
5. **吸引力**: 开头是否引人？结尾是否有力？
6. **时长**: 预估总时长是否合理？（假设每分钟 150-180 字）

## 输出格式

严格输出以下 JSON 格式，不要输出其他内容：

{
  "dimensions": [
    {
      "name": "内容忠实度",
      "status": "pass" | "warn" | "fail",
      "comment": "具体评价",
      "suggestion": "改进建例（仅 warn/fail 时填写）"
    },
    {
      "name": "口语化与可讲度",
      "status": "pass" | "warn" | "fail",
      "comment": "具体评价",
      "suggestion": null
    },
    {
      "name": "结构清晰度与节奏",
      "status": "pass" | "warn" | "fail",
      "comment": "具体评价",
      "suggestion": "改进建例"
    },
    {
      "name": "术语与比喻的恰当性",
      "status": "pass" | "warn" | "fail",
      "comment": "具体评价",
      "suggestion": null
    },
    {
      "name": "吸引力",
      "status": "pass" | "warn" | "fail",
      "comment": "具体评价",
      "suggestion": null
    },
    {
      "name": "时长",
      "status": "pass" | "warn" | "fail",
      "comment": "预估总时长 X 分钟",
      "suggestion": null
    }
  ],
  "overall_score": 4,
  "overall_comment": "总体评价，一句话概括主要优缺点",
  "has_critical_issue": false
}

字段说明：
- status: "pass" = 通过, "warn" = 建议改进, "fail" = 必须修改
- has_critical_issue: 若"内容忠实度"为 fail，则为 true（一票否决）
- overall_score: 1-5 分，3 分及以上视为可接受
"""
```

**节点代码**:

```python
def script_review_node(state: NarrationWorkflowState, runtime: Runtime):
    run_id = state["run_id"]
    project_id = state["project_id"]

    update_workflow_run(run_id, current_stage="script_review")

    # LLM 自动 Review
    review_raw = llm_client.generate(
        system=SCRIPT_REVIEW_SYSTEM_PROMPT,
        user=f"请审查以下旁白脚本：\n\n{state['narration_script']}"
    )
    review = json.loads(review_raw)

    # 存储 review 到 Store
    await runtime.store.aput(
        ("director_feedback", project_id),
        key=f"review_{run_id}",
        value={
            "type": "llm_review",
            "review": review,
            "run_id": run_id,
            "created_at": datetime.utcnow().isoformat()
        }
    )

    # interrupt 等待人工审批
    decision = interrupt({
        "script": state["narration_script"],
        "review": review,  # JSON 格式：{dimensions, overall_score, overall_comment, has_critical_issue}
        "available_actions": ["approve", "reject"]
    })

    if decision["action"] == "approve":
        edited_script = decision.get("edited_script", state["narration_script"])

        # 存储导演 comment 到 Store
        if decision.get("comment"):
            await runtime.store.aput(
                ("director_feedback", project_id),
                key=f"comment_{run_id}",
                value={
                    "type": "director_comment",
                    "comment": decision["comment"],
                    "action": "approve",
                    "run_id": run_id,
                    "created_at": datetime.utcnow().isoformat()
                }
            )
            # LLM 提取结构化偏好
            await _extract_preference(runtime, project_id, decision["comment"])

        return {
            "edited_script": edited_script,
            "review_feedback": review,
            "review_status": "approved",
            "current_stage": "split_segment"
        }
    else:
        # reject: 存储反馈供 gen_script 参考
        feedback = decision.get("feedback", "")
        await runtime.store.aput(
            ("director_feedback", project_id),
            key=f"reject_{run_id}",
            value={
                "type": "reject_feedback",
                "feedback": feedback,
                "run_id": run_id,
                "created_at": datetime.utcnow().isoformat()
            }
        )
        if feedback:
            await _extract_preference(runtime, project_id, feedback)

        return {
            "review_feedback": feedback,
            "review_status": "rejected",
            "current_stage": "gen_script"
        }


PREFERENCE_EXTRACT_PROMPT = """分析以下导演反馈，提取一条具体的创作偏好。

反馈内容：{feedback}

输出格式（JSON）：
{{
    "preference": "一句话描述偏好",
    "category": "pacing" | "style" | "length" | "tone" | "structure" | "other"
}}

只输出 JSON，不要其他内容。
"""

async def _extract_preference(runtime: Runtime, project_id: str, feedback: str):
    """从导演反馈中提取结构化偏好，存入 Store"""
    try:
        result = llm_client.generate(
            system="你是一个偏好提取器，从用户的反馈中提取具体的创作偏好。",
            user=PREFERENCE_EXTRACT_PROMPT.format(feedback=feedback)
        )
        pref = json.loads(result)
        await runtime.store.aput(
            ("director_preference", "global"),
            key=str(uuid4()),
            value={
                "preference": pref["preference"],
                "category": pref["category"],
                "extracted_from": feedback[:100],
                "created_at": datetime.utcnow().isoformat()
            }
        )
    except Exception:
        pass  # 偏好提取失败不影响主流程
```

---

### 4.3 split_segment — 结构化拆分

**职责**: 将旁白文档拆分为章节 + 段落，标注情绪和角色。

**输入**: `edited_script`（或 `narration_script`）

**输出**: `structured_segments`

**System Prompt**:

```python
SPLIT_SEGMENT_SYSTEM_PROMPT = """你是一位专业的旁白脚本结构化分析师。

你的任务是将旁白脚本文档拆分为结构化的章节和段落，并为每个段落标注情绪和角色。

## 拆分规则

1. **章节**: 按 markdown 标题（# / ##）划分
2. **段落**: 每个自然段落为一个段落，每段 30-80 字
3. **过长段落**: 超过 80 字的段落，在语义自然的断点处拆分
4. **过短段落**: 少于 15 字的段落，考虑与相邻段落合并

## 情绪标注

为每个段落标注一种情绪，使用以下枚举值：
- neutral: 中性叙述
- happy: 积极、欢快
- sad: 沉重、感伤
- angry: 愤怒、激烈
- calm: 平静、舒缓
- excited: 兴奋、激动

## 角色标注

- narration: 旁白叙述（默认）
- 对话角色: 如果段落中包含角色对话，标注角色名称

## 输出格式

严格输出以下 JSON 格式，不要输出其他内容：

[
  {
    "chapter_title": "章节标题",
    "segments": [
      {
        "text": "段落文本",
        "emotion": "neutral",
        "role": "narration",
        "segment_kind": "narration"
      }
    ]
  }
]

## 注意

- segment_kind 只能是 "narration" 或 "dialogue"
- role 为 "narration" 时，segment_kind 必须为 "narration"
- role 为具体角色名时，segment_kind 为 "dialogue"
- 情绪标注要结合上下文语境，不是简单的关键词匹配
"""
```

**节点代码**:

```python
def split_segment_node(state: NarrationWorkflowState, runtime: Runtime):
    run_id = state["run_id"]

    update_workflow_run(run_id, status="running", current_stage="split_segment")

    # 查询导演偏好（可选增强）
    preferences = await runtime.store.asearch(
        ("director_preference", "global"),
        query="段落长度 拆分 风格",
        limit=3
    )
    pref_context = ""
    if preferences:
        pref_context = "\n\n## 导演偏好参考\n" + "\n".join(
            f"- {item.value['preference']}" for item in preferences
        )

    script = state.get("edited_script") or state["narration_script"]

    result = llm_client.generate(
        system=SPLIT_SEGMENT_SYSTEM_PROMPT,
        user=f"请将以下旁白脚本拆分为结构化段落：\n\n{script}{pref_context}"
    )

    structured = json.loads(result)

    return {
        "structured_segments": structured,
        "current_stage": "synthesis"
    }
```

---

### 4.4 synthesis — 语音合成

**职责**: 将结构化段落写入 Project/Chapter/Segment，调用 TTS 合成音频。

**输入**: `structured_segments`, `project_id`

**输出**: `synthesis_results`

**节点代码**:

```python
def synthesis_node(state: NarrationWorkflowState, runtime: Runtime):
    run_id = state["run_id"]
    project_id = state["project_id"]

    update_workflow_run(run_id, status="running", current_stage="synthesis")

    db = next(get_db())
    results = []

    for chapter_index, chapter_data in enumerate(state["structured_segments"]):
        # 创建 Chapter
        chapter = create_chapter(db, project_id, chapter_index, chapter_data["chapter_title"])

        for seg_index, seg_data in enumerate(chapter_data["segments"]):
            # 创建 Segment
            segment = create_segment(db, chapter.id, seg_index, seg_data)

            # 调用现有 TTS 合成
            audio_result = synthesize_with_engine(
                db=db,
                project_id=project_id,
                chapter_id=chapter.id,
                segment_id=segment.id,
                text=seg_data["text"],
                params=get_chapter_voice_params(db, chapter.id)
            )

            results.append({
                "chapter_index": chapter_index,
                "segment_index": seg_index,
                "segment_id": segment.id,
                "audio_path": audio_result.path,
                "duration_sec": audio_result.duration
            })

    return {
        "synthesis_results": results,
        "current_stage": "completed"
    }
```

---

## 5. 状态机

### 5.1 Status 定义

| Status | 含义 | 进入条件 |
|---|---|---|
| `running` | 正在执行某节点 | 创建时 / Resume 时 / Fork 时 |
| `interrupted` | 在 script_review 暂停 | `interrupt()` 触发 |
| `completed` | synthesis 节点完成 | 最后一个节点正常结束 |
| `failed` | 节点执行异常 | 捕获异常，记录失败节点和错误信息 |

### 5.2 Status × 操作矩阵

| | **Resume** | **Resume with Edit** | **Replay** | **Fork with Edit** | **Start New Run** |
|---|:---:|:---:|:---:|:---:|:---:|
| **running** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **interrupted** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **completed** | ❌ | ❌ | ✅ | ✅ | ✅ |
| **failed** | ❌ | ❌ | ✅ | ✅ | ✅ |

### 5.3 状态转换

```
创建 ──→ running ──→ interrupted ──→ running ──→ completed
                  │                 (resume)
                  │
                  ├──→ running (gen_script loop on reject)
                  │
                  └──→ failed (异常)
                        │
                        └──→ running (replay/fork/start new)
```

---

## 6. 数据模型

### 6.1 WorkflowRun 表

```python
class WorkflowRun(Base):
    __tablename__ = "workflow_runs"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("segmented_projects.id", ondelete="CASCADE"), nullable=False)
    thread_id = Column(String, unique=True, nullable=False)
    status = Column(String, nullable=False, default="running")
    current_stage = Column(String, nullable=False)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    project = relationship("SegmentedProject", back_populates="workflow_runs")
```

### 6.2 Store Namespace 设计

```
("director_feedback", "{project_id}")     ← 项目级原始 comment + feedback
("director_preference", "global")         ← 跨项目通用偏好（LLM 提取）
("director_preference", "{project_id}")   ← 项目特定偏好（LLM 提取）
```

**Store Value 结构**:

```python
# director_feedback — 导演原始反馈
{
    "type": "director_comment" | "reject_feedback" | "llm_review",
    "comment": "这段太长了，拆成两段",
    "action": "approve" | "reject",
    "run_id": "run-uuid",
    "created_at": "2026-07-10T..."
}

# director_preference — LLM 提取的结构化偏好
{
    "preference": "偏好短段落，每段30-50字",
    "category": "pacing" | "style" | "length" | "tone" | "structure" | "other",
    "extracted_from": "原始反馈摘要",
    "created_at": "2026-07-10T..."
}
```

### 6.3 自定义 AsyncSqliteStore

LangGraph 节点通过 `runtime.store` 调用异步方法（`aput`/`aget`/`asearch`/`adelete`），因此需要实现异步版本。

```python
import json
from langgraph.store.base import BaseStore, Item
import aiosqlite


class AsyncSqliteStore(BaseStore):
    """基于 SQLite 的异步 LangGraph Store 实现"""

    def __init__(self, db_path: str):
        self.db_path = db_path
        self._conn = None

    async def _get_conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            self._conn = await aiosqlite.connect(self.db_path)
            await self._setup()
        return self._conn

    async def _setup(self):
        conn = await self._get_conn()
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS store (
                namespace TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (namespace, key)
            )
        """)
        await conn.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS store_fts
            USING fts5(namespace, key, value)
        """)
        await conn.commit()

    async def aput(self, namespace: tuple[str, ...], key: str, value: dict):
        conn = await self._get_conn()
        ns = "/".join(namespace)
        value_json = json.dumps(value, ensure_ascii=False)
        await conn.execute(
            "INSERT OR REPLACE INTO store (namespace, key, value) VALUES (?, ?, ?)",
            (ns, key, value_json)
        )
        await conn.execute(
            "INSERT OR REPLACE INTO store_fts (namespace, key, value) VALUES (?, ?, ?)",
            (ns, key, value_json)
        )
        await conn.commit()

    async def aget(self, namespace: tuple[str, ...], key: str) -> Item | None:
        conn = await self._get_conn()
        ns = "/".join(namespace)
        async with conn.execute(
            "SELECT value FROM store WHERE namespace = ? AND key = ?",
            (ns, key)
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                return Item(key=key, value=json.loads(row[0]))
            return None

    async def asearch(self, namespace: tuple[str, ...], query: str = None, limit: int = 10) -> list[Item]:
        conn = await self._get_conn()
        ns = "/".join(namespace)
        if query:
            async with conn.execute(
                "SELECT key, value FROM store_fts WHERE namespace = ? AND value MATCH ? LIMIT ?",
                (ns, query, limit)
            ) as cursor:
                rows = await cursor.fetchall()
        else:
            async with conn.execute(
                "SELECT key, value FROM store WHERE namespace LIKE ? LIMIT ?",
                (ns + "%", limit)
            ) as cursor:
                rows = await cursor.fetchall()
        return [Item(key=r[0], value=json.loads(r[1])) for r in rows]

    async def adelete(self, namespace: tuple[str, ...], key: str):
        conn = await self._get_conn()
        ns = "/".join(namespace)
        await conn.execute("DELETE FROM store WHERE namespace = ? AND key = ?", (ns, key))
        await conn.execute("DELETE FROM store_fts WHERE namespace = ? AND key = ?", (ns, key))
        await conn.commit()
```

### 6.4 Stage 耗时计算

每个阶段的耗时从 LangGraph Checkpoint 的时间戳差值计算：

```python
def get_stage_durations(thread_id: str) -> list[dict]:
    """从 checkpoint 历史计算每个阶段的耗时"""
    history = list(graph.get_state_history(
        {"configurable": {"thread_id": thread_id}}
    ))
    # history 是逆序的（最新在前），需要反转
    history.reverse()

    stages = {}
    for snapshot in history:
        stage = snapshot.values.get("current_stage")
        ts = snapshot.created_at  # checkpoint 创建时间
        if stage and stage not in stages:
            stages[stage] = {"start": ts}
        elif stage and "end" not in stages[stage]:
            stages[stage]["end"] = ts

    result = []
    for name, times in stages.items():
        duration = None
        if "end" in times and "start" in times:
            duration = (times["end"] - times["start"]).total_seconds()
        result.append({"name": name, "duration_sec": duration})
    return result
```

---

## 7. API 设计

### 7.1 端点总览

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/projects/{pid}/workflow` | 启动新工作流 |
| `GET` | `/projects/{pid}/workflow` | 获取项目所有工作流历史 |
| `GET` | `/projects/{pid}/workflow/{rid}` | 获取单个工作流状态 |
| `GET` | `/projects/{pid}/workflow/{rid}/stream` | SSE 流 |
| `POST` | `/projects/{pid}/workflow/{rid}/resume` | 审批恢复 |
| `POST` | `/projects/{pid}/workflow/{rid}/replay` | 从指定阶段重放 |
| `POST` | `/projects/{pid}/workflow/{rid}/fork` | 从指定阶段分支 |
| `DELETE` | `/projects/{pid}/workflow/{rid}` | 取消工作流 |

### 7.2 Request / Response 定义

#### POST /projects/{pid}/workflow — 启动工作流

```json
// Request
{
    "source_document": "..."   // 可选，默认用项目的 source_document
}

// Response 201
{
    "run_id": "uuid",
    "thread_id": "uuid",
    "status": "running",
    "current_stage": "gen_script"
}

// Response 409 — 已有活跃工作流
{
    "detail": "项目已有运行中的工作流 (run_id=xxx)，当前阶段: script_review"
}
```

#### GET /projects/{pid}/workflow — 工作流列表

```json
// Response 200
{
    "runs": [
        {
            "id": "uuid",
            "status": "completed",
            "current_stage": "synthesis",
            "stages": [
                {"name": "gen_script", "status": "completed", "duration_sec": 45},
                {"name": "script_review", "status": "completed", "duration_sec": 120},
                {"name": "split_segment", "status": "completed", "duration_sec": 30},
                {"name": "synthesis", "status": "completed", "duration_sec": 180}
            ],
            "created_at": "2026-07-10T14:30:00Z",
            "updated_at": "2026-07-10T14:37:15Z"
        }
    ]
}
```

#### GET /projects/{pid}/workflow/{rid} — 单个工作流状态

```json
// Response 200 — interrupted 状态
{
    "id": "uuid",
    "project_id": "uuid",
    "thread_id": "uuid",
    "status": "interrupted",
    "current_stage": "script_review",
    "stages": [
        {"name": "gen_script", "status": "completed", "duration_sec": 45},
        {"name": "script_review", "status": "interrupted", "duration_sec": null}
    ],
    "interrupt_payload": {
        "script": "完整旁白脚本...",
        "review": "LLM Review 反馈...",
        "available_actions": ["approve", "reject"]
    },
    "error": null,
    "created_at": "2026-07-10T14:30:00Z",
    "updated_at": "2026-07-10T14:31:00Z"
}
```

#### POST /projects/{pid}/workflow/{rid}/resume — 审批恢复

```json
// Request — approve
{
    "stage": "script_review",
    "action": "approve",
    "edited_script": "...",      // 可选，编辑后的脚本
    "comment": "节奏不错"         // 可选，导演备注
}

// Request — reject
{
    "stage": "script_review",
    "action": "reject",
    "feedback": "第三段太长了，需要拆分"  // 必填
}

// Response 200
{
    "status": "running",
    "current_stage": "split_segment"     // approve 后
    // 或 "current_stage": "gen_script"  // reject 后
}

// Response 409 — 阶段不匹配
{
    "detail": "当前阶段为 gen_script，请求的 stage 为 script_review"
}
```

#### POST /projects/{pid}/workflow/{rid}/replay — 重放

```json
// Request
{
    "from_stage": "split_segment"
}

// Response 200
{
    "status": "running",
    "current_stage": "split_segment"
}

// Response 400 — 阶段未完成
{
    "detail": "阶段 synthesis 未完成，无法从该阶段重放"
}
```

#### POST /projects/{pid}/workflow/{rid}/fork — 分支

```json
// Request
{
    "from_stage": "script_review",
    "state_override": {
        "edited_script": "修改后的脚本内容..."
    }
}

// Response 200
{
    "status": "running",
    "current_stage": "script_review"
}
```

#### DELETE /projects/{pid}/workflow/{rid} — 取消

```json
// Response 200
{
    "status": "cancelled"
}

// Response 409
{
    "detail": "工作流状态为 completed，无法取消"
}
```

### 7.3 SSE 流

```
GET /projects/{pid}/workflow/{rid}/stream
Accept: text/event-stream

event: stage_start
data: {"stage": "gen_script", "run_id": "uuid"}

event: stage_progress
data: {"stage": "gen_script", "chunk": "在这个视频中..."}

event: stage_progress
data: {"stage": "gen_script", "chunk": "我们将探索..."}

event: stage_complete
data: {"stage": "gen_script", "output": {"chapters_count": 3, "paragraphs_count": 12}}

event: stage_start
data: {"stage": "script_review", "run_id": "uuid"}

event: stage_complete
data: {"stage": "script_review", "output": {"overall_score": 4, "has_critical_issue": false, "warn_count": 2}}

event: interrupt
data: {"stage": "script_review", "payload": {"script": "...", "review": {"dimensions": [{"name": "内容忠实度", "status": "pass", "comment": "...", "suggestion": null}, {"name": "口语化与可讲度", "status": "pass", "comment": "...", "suggestion": null}, {"name": "结构清晰度与节奏", "status": "warn", "comment": "...", "suggestion": "..."}, {"name": "术语与比喻的恰当性", "status": "pass", "comment": "...", "suggestion": null}, {"name": "吸引力", "status": "warn", "comment": "...", "suggestion": "..."}, {"name": "时长", "status": "pass", "comment": "预估 3 分钟", "suggestion": null}], "overall_score": 4, "overall_comment": "整体质量良好，口语化和开头可优化", "has_critical_issue": false}, "available_actions": ["approve", "reject"]}}

// --- 审批后 ---

event: stage_start
data: {"stage": "split_segment", "run_id": "uuid"}

event: stage_complete
data: {"stage": "split_segment", "output": {"segments_count": 12}}

event: stage_start
data: {"stage": "synthesis", "run_id": "uuid"}

event: stage_progress
data: {"stage": "synthesis", "chunk": {"segment_id": "xxx", "progress": "3/12"}}

event: stage_complete
data: {"stage": "synthesis", "output": {"total_segments": 12, "total_duration_sec": 510}}

event: workflow_complete
data: {"run_id": "uuid", "results": [...]}
```

---

## 8. 前端 UI 设计

### 8.1 页面结构

```
ProjectShell
    └── TTSSynthesis
         ├── Overview (现有)
         ├── Library (现有)
         ├── Studio (现有)
         ├── Voices (现有)
         ├── Settings (现有)
         └── Workflow (新增)
              ├── WorkflowHub           — Run 列表 + 启动入口
              ├── WorkflowRunDetail     — 阶段详情 + 操作按钮
              └── ReviewEditor          — 脚本审批编辑器
```

### 8.2 WorkflowHub — Run 列表页

```
┌─────────────────────────────────────────────────────────────────┐
│  🎬 工作流                                        [▶ 新建运行]  │
│                                                                 │
│  ┌─ Run #3 ───────────────────────────────────────────────────┐ │
│  │  ● running                                                  │ │
│  │                                                             │ │
│  │  gen_script     script_review     split_segment   synthesis │ │
│  │  ┌──────────┐  ┌──────────────┐  ┌────────────┐ ┌────────┐ │ │
│  │  │  ✅ 45s  │  │  ✅ 2min     │  │  ✅ 30s    │ │ 🔄 ... │ │ │
│  │  └──────────┘  └──────────────┘  └────────────┘ └────────┘ │ │
│  │                                                             │ │
│  │  启动于 2026-07-10 14:30                          [取消]    │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ Run #2 ───────────────────────────────────────────────────┐ │
│  │  ● interrupted @ script_review                              │ │
│  │                                                             │ │
│  │  gen_script     script_review                               │ │
│  │  ┌──────────┐  ┌──────────────┐                            │ │
│  │  │  ✅ 45s  │  │  ⏸️ 等待审批  │                            │ │
│  │  └──────────┘  └──────────────┘                            │ │
│  │                                                             │ │
│  │  LLM Review: "评分 4/5，第3段建议拆分"                       │ │
│  │                                                             │ │
│  │  [查看审批]  [取消]                                          │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ Run #1 ───────────────────────────────────────────────────┐ │
│  │  ● completed                                                │ │
│  │                                                             │ │
│  │  gen_script     script_review     split_segment   synthesis │ │
│  │  ┌──────────┐  ┌──────────────┐  ┌────────────┐ ┌────────┐ │ │
│  │  │  ✅ 45s  │  │  ✅ 2min     │  │  ✅ 30s    │ │ ✅ 3min │ │ │
│  │  └──────────┘  └──────────────┘  └────────────┘ └────────┘ │ │
│  │                                                             │ │
│  │  [从 split_segment 重放]  [从 split_segment 分支编辑]        │ │
│  │  [从 gen_script 重放]     [全新运行]                         │ │
│  │  [导出音频]                                                  │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**交互说明：**

- **新建运行**: 检查是否有活跃工作流（running/interrupted），有则提示
- **查看审批**: 跳转到 ReviewEditor 页面
- **重放/分支**: 点击具体阶段卡片上的操作按钮
- **导出音频**: 仅 completed 状态可用，复用现有导出逻辑
- **实时更新**: SSE 连接自动更新阶段状态和进度

### 8.3 ReviewEditor — 脚本审批编辑器

```
┌─────────────────────────────────────────────────────────────────┐
│  ← 返回 Run 列表                                                │
│                                                                 │
│  📝 脚本审批 — Run #2 @ script_review                           │
│                                                                 │
│  ┌─ LLM Review 反馈 ─────────────────────────────────────────┐ │
│  │                                                             │ │
│  │  总评: ⭐⭐⭐⭐ (4/5)                                        │ │
│  │  整体质量良好，口语化和开头可优化                              │ │
│  │                                                             │ │
│  │  ───────────────────────────────────────────────────────── │ │
│  │                                                             │ │
│  │  ✅ 内容忠实度                                               │ │
│  │     数据保真，无编造                                         │ │
│  │                                                             │ │
│  │  ✅ 口语化与可讲度                                           │ │
│  │     句子长度控制得当，朗读顺口                                │ │
│  │                                                             │ │
│  │  ⚠️ 结构清晰度与节奏                                         │ │
│  │     第3段"鉴于上述论点"建议改为"所以说"                       │ │
│  │     → 具体建议: 使用更口语化的过渡词                          │ │
│  │                                                             │ │
│  │  ✅ 术语与比喻的恰当性                                       │ │
│  │     专业术语均有一句话解释                                    │ │
│  │                                                             │ │
│  │  ⚠️ 吸引力                                                  │ │
│  │     开头缺少 hook，建议以问题引入                              │ │
│  │     → 具体建议: 用"你有没有想过..."开场                       │ │
│  │                                                             │ │
│  │  ✅ 时长                                                     │ │
│  │     预估 3 分钟，合理                                         │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ 旁白脚本（可编辑）────────────────────────────────────────┐ │
│  │                                                             │ │
│  │  【章节：引言】                                              │ │
│  │  你有没有想过，为什么...                                      │ │
│  │                                                             │ │
│  │  【章节：核心内容】                                          │ │
│  │  首先，让我们了解...                                         │ │
│  │  其实吧，我们可以发现...                                      │ │
│  │                                                             │ │
│  │  【章节：总结】                                              │ │
│  │  综上所述...                                                │ │
│  │                                                             │ │
│  │  ┌─────────────────────────────────────────────────────────┐│ │
│  │  │ 字数: 456  预估时长: 2分30秒  章节: 3  段落: 8           ││ │
│  │  └─────────────────────────────────────────────────────────┘│ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ 导演备注（可选，存入记忆供下次参考）───────────────────────┐ │
│  │  ┌─────────────────────────────────────────────────────────┐│ │
│  │  │ 开头确实需要个 hook，用个问题引入效果更好                  ││ │
│  │  └─────────────────────────────────────────────────────────┘│ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│    [❌ 拒绝并反馈]                        [✅ 批准]  [✅ 批准并编辑] │
│                                                                 │
│  点击"拒绝并反馈"时弹出输入框填写拒绝原因                         │
└─────────────────────────────────────────────────────────────────┘
```

**交互说明：**

- **LLM Review 反馈**: 结构化展示每个维度的评审结果
  - ✅ pass: 绿色，通过
  - ⚠️ warn: 黄色，建议改进（显示具体建议）
  - ❌ fail: 红色，必须修改（显示修改方案）
  - 总评分数和整体评论
  - 若"内容忠实度"为 fail，显示红色警告标记
- **旁白脚本编辑器**: 可直接编辑文本，支持 markdown
- **实时统计**: 字数、预估时长、章节数、段落数
- **导演备注**: 可选填写，存入 Store 长期记忆
- **三个操作按钮**:
  - `拒绝并反馈`: 弹出输入框填写原因 → 调用 resume API (action=reject)
  - `批准`: 原样通过 → 调用 resume API (action=approve)
  - `批准并编辑`: 保存编辑后的内容再通过 → 调用 resume API (action=approve, edited_script=...)

### 8.4 WorkflowRunDetail — 阶段详情页

```
┌─────────────────────────────────────────────────────────────────┐
│  ← 返回 Run 列表                                                │
│                                                                 │
│  Run #1 — ● completed                                           │
│  项目: 我的视频旁白项目  启动: 2026-07-10 14:30  耗时: 7分15秒   │
│                                                                 │
│  ┌─ ① gen_script ─────────────────────────────────────────────┐ │
│  │  ✅ 完成 · 45秒                                             │ │
│  │                                                             │ │
│  │  输出摘要: 3 章节, 12 段落, 总字数 1,200                      │ │
│  │                                                             │ │
│  │  [查看完整脚本]  [🔄 从这里重放]  [✏️ 从这里分支编辑]         │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ ② script_review ─────────────────────────────────────────┐ │
│  │  ✅ 完成 · 2分钟                                            │ │
│  │                                                             │ │
│  │  审批结果: ✅ approved                                       │ │
│  │  LLM 评分: ⭐⭐⭐⭐ (4/5)                                    │ │
│  │  维度: ✅×4  ⚠️×2  ❌×0                                      │ │
│  │  导演备注: "节奏不错，继续保持"                               │ │
│  │                                                             │ │
│  │  [查看 Review 详情]  [🔄 从这里重放]  [✏️ 从这里分支编辑]     │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ ③ split_segment ─────────────────────────────────────────┐ │
│  │  ✅ 完成 · 30秒                                             │ │
│  │                                                             │ │
│  │  输出: 12 个段落                                            │ │
│  │  情绪分布: neutral ×6  happy ×3  calm ×2  excited ×1        │ │
│  │  角色: narration ×10  章节角色 ×2                            │ │
│  │                                                             │ │
│  │  [查看段落详情]  [🔄 从这里重放]  [✏️ 从这里分支编辑]         │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ ④ synthesis ─────────────────────────────────────────────┐ │
│  │  ✅ 完成 · 3分钟                                            │ │
│  │                                                             │ │
│  │  合成: 12 个音频, 总时长 8分30秒                              │ │
│  │  引擎: Edge-TTS (zh-CN-XiaoxiaoNeural)                     │ │
│  │                                                             │ │
│  │  [播放全部]  [导出音频]  [🔄 从这里重放]                      │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ─────────────────────────────────────────────────────────────── │
│  操作:                                                          │
│  [▶ 从 gen_script 重放]  [▶ 全新运行]                            │
└─────────────────────────────────────────────────────────────────┘
```

**交互说明：**

- **阶段卡片**: 每个阶段一个卡片，显示状态、耗时、输出摘要
- **查看输出**: 展开查看该阶段的详细输出
- **重放/分支**: 每个已完成/失败的阶段都有重放和分支按钮
- **分支编辑**: 点击后弹出编辑器，修改该阶段输出后 fork 执行
- **导出音频**: 复用现有的 chapter 音频导出逻辑

---

## 9. Streaming 实现

### 9.1 后端 SSE 端点

```python
@router.get("/projects/{project_id}/workflow/{run_id}/stream")
async def stream_workflow(project_id: str, run_id: str):
    run = workflow_service.get_run(run_id)
    if not run:
        raise HTTPException(404, "工作流不存在")

    async def event_generator():
        async for event in graph.astream_events(
            None,
            config={"configurable": {"thread_id": run.thread_id}},
            version="v3"
        ):
            kind = event["event"]

            if kind == "on_chain_start":
                yield sse_event("stage_start", {
                    "stage": event["name"],
                    "run_id": run_id
                })

            elif kind == "on_chain_end":
                yield sse_event("stage_complete", {
                    "stage": event["name"],
                    "output": summarize_output(event["data"]["output"])
                })

            elif kind == "on_chain_stream":
                yield sse_event("stage_progress", {
                    "stage": event["name"],
                    "chunk": event["data"]["chunk"]
                })

            elif kind == "on_interrupt":
                yield sse_event("interrupt", {
                    "stage": event["name"],
                    "payload": event["data"]["value"]
                })

            elif kind == "on_error":
                yield sse_event("error", {
                    "stage": event["name"],
                    "error": str(event["data"]["error"])
                })

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


def sse_event(event_type: str, data: dict) -> str:
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
```

### 9.2 前端消费

```typescript
// useWorkflowStream.ts
export function useWorkflowStream(runId: string, callbacks: WorkflowCallbacks) {
  useEffect(() => {
    const controller = new AbortController();

    async function subscribe() {
      const response = await fetch(
        `/api/projects/${projectId}/workflow/${runId}/stream`,
        { signal: controller.signal }
      );
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const events = parseSSE(decoder.decode(value));
        for (const event of events) {
          switch (event.type) {
            case "stage_start":
              callbacks.onStageStart(event.data.stage);
              break;
            case "stage_progress":
              callbacks.onProgress(event.data.stage, event.data.chunk);
              break;
            case "stage_complete":
              callbacks.onStageComplete(event.data.stage, event.data.output);
              break;
            case "interrupt":
              callbacks.onInterrupt(event.data.payload);
              break;
            case "error":
              callbacks.onError(event.data.stage, event.data.error);
              break;
          }
        }
      }
    }

    subscribe();
    return () => controller.abort();
  }, [runId]);
}
```

### 9.3 SSE 事件类型

| 事件 | 触发时机 | data |
|---|---|---|
| `stage_start` | 节点开始执行 | `{stage, run_id}` |
| `stage_progress` | LLM 流式输出 | `{stage, chunk}` |
| `stage_complete` | 节点执行完成 | `{stage, output}` |
| `interrupt` | script_review 触发 interrupt | `{stage, payload}` |
| `error` | 节点执行异常 | `{stage, error}` |
| `workflow_complete` | synthesis 完成 | `{run_id, results}` |

---

## 10. Time Travel

### 10.1 Replay（重放）

从某个 checkpoint 重新执行，状态不变，下游节点全部重跑。

```python
# 1. 获取目标阶段的 checkpoint
history = list(graph.get_state_history(config))
target = next(s for s in history if s.next == (target_stage,))

# 2. replay
result = graph.invoke(None, target.config)
```

**适用场景**: "脚本没问题，但 split 结果不理想，从 split 重跑"

### 10.2 Fork（分支）

从某个 checkpoint 创建分支，修改状态后继续执行。

```python
# 1. 获取目标阶段的 checkpoint
history = list(graph.get_state_history(config))
target = next(s for s in history if s.next == (target_stage,))

# 2. fork: 修改状态
fork_config = graph.update_state(target.config, values=state_override)

# 3. 从 fork 点执行
result = graph.invoke(None, fork_config)
```

**适用场景**: "脚本需要修改，用新版本重跑后续所有阶段"

### 10.3 前端交互

```
┌─ RunDetail 阶段卡片 ─────────────────────────────────────┐
│  ✅ gen_script · 45秒                                     │
│                                                           │
│  [🔄 重放]  →  确认后直接调用 replay API                   │
│  [✏️ 分支编辑]  →  弹出编辑器 → 修改后调用 fork API        │
└───────────────────────────────────────────────────────────┘
```

---

## 11. 错误处理

### 11.1 节点异常

```python
def gen_script_node(state, runtime):
    try:
        script = llm_client.generate(...)
        return {"narration_script": script, ...}
    except Exception as e:
        # 更新 WorkflowRun 状态
        update_workflow_run(state["run_id"], status="failed", error=str(e))
        # 抛出让 LangGraph 记录到 checkpoint
        raise
```

### 11.2 前端错误展示

```
┌─ 阶段卡片 ────────────────────────────────────────────────┐
│  ❌ gen_script · 失败                                      │
│                                                           │
│  错误: LLM API 超时 (30s)                                  │
│                                                           │
│  [🔄 重试]  [✏️ 修改输入后重试]                             │
└───────────────────────────────────────────────────────────┘
```

### 11.3 LLM 重试策略

```python
# 在 LangGraph 节点上配置 retry policy
graph = (
    StateGraph(NarrationWorkflowState)
    .add_node("gen_script", gen_script_node, retry_policy=RetryPolicy(max_attempts=3))
    .add_node("split_segment", split_segment_node, retry_policy=RetryPolicy(max_attempts=3))
    .add_node("synthesis", synthesis_node)  # TTS 不自动重试，由用户手动重试
    ...
)
```

---

## 12. 并发控制

### 12.1 一项目一工作流

```python
async def start_workflow(db: Session, project_id: str) -> WorkflowRun:
    # 检查是否有活跃工作流
    active = db.query(WorkflowRun).filter(
        WorkflowRun.project_id == project_id,
        WorkflowRun.status.in_(["running", "interrupted"])
    ).first()

    if active:
        raise ConflictError(f"项目已有运行中的工作流 (run_id={active.id})")

    # SQLite 唯一索引兜底
    run = WorkflowRun(id=str(uuid4()), project_id=project_id, ...)
    db.add(run)
    db.commit()
    return run
```

```sql
CREATE UNIQUE INDEX idx_one_active_workflow_per_project
ON workflow_runs(project_id)
WHERE status IN ('running', 'interrupted');
```

### 12.2 Cancel 实现

```python
# running 状态：取消 asyncio task
running_tasks: dict[str, asyncio.Task] = {}

async def cancel_workflow(run_id: str):
    task = running_tasks.get(run_id)
    if task:
        task.cancel()
    update_workflow_run(run_id, status="cancelled")
```

---

## 13. 国际化 (i18n)

### 13.1 翻译结构

所有新增 UI 文本必须使用 `useTranslation()` hook 的 `t(key)` 函数，并在 `zh-CN.ts` 和 `en-US.ts` 中添加对应翻译。

```typescript
// 使用方式
const { t } = useTranslation();
return <h1>{t('workflow.title')}</h1>;
```

### 13.2 翻译 Key 命名规范

```
workflow.{page}.{element}
```

| 前缀 | 说明 |
|---|---|
| `workflow.hub.*` | WorkflowHub 页面 |
| `workflow.review.*` | ReviewEditor 页面 |
| `workflow.detail.*` | WorkflowRunDetail 页面 |
| `workflow.common.*` | 公共文本 |
| `workflow.stage.*` | 阶段名称 |
| `workflow.status.*` | 状态文本 |
| `workflow.action.*` | 操作按钮 |

### 13.3 翻译 Key 列表

```typescript
// zh-CN.ts
const zhCN = {
  workflow: {
    // 公共
    common: {
      title: '工作流',
      newRun: '新建运行',
      cancel: '取消',
      confirm: '确认',
      back: '返回',
    },

    // 阶段名称
    stage: {
      gen_script: '生成脚本',
      script_review: '脚本审查',
      split_segment: '段落拆分',
      synthesis: '语音合成',
    },

    // 状态
    status: {
      running: '运行中',
      interrupted: '等待审批',
      completed: '已完成',
      failed: '失败',
      cancelled: '已取消',
    },

    // WorkflowHub
    hub: {
      title: '工作流',
      noRuns: '暂无工作流记录',
      startedAt: '启动于 {time}',
      duration: '耗时 {duration}',
      viewReview: '查看审批',
      viewDetail: '查看详情',
      replayFrom: '从 {stage} 重放',
      forkFrom: '从 {stage} 分支编辑',
      startNewRun: '全新运行',
      exportAudio: '导出音频',
      confirmCancel: '确认取消此工作流？',
      activeWorkflowExists: '项目已有运行中的工作流',
    },

    // ReviewEditor
    review: {
      title: '脚本审批',
      llmReview: 'LLM Review 反馈',
      overallScore: '总评',
      scriptEditor: '旁白脚本（可编辑）',
      wordCount: '字数',
      estimatedDuration: '预估时长',
      chapterCount: '章节',
      segmentCount: '段落',
      directorNote: '导演备注（可选，存入记忆供下次参考）',
      directorNotePlaceholder: '输入导演备注...',
      reject: '拒绝并反馈',
      approve: '批准',
      approveAndEdit: '批准并编辑',
      rejectFeedbackTitle: '请输入拒绝原因',
      rejectFeedbackPlaceholder: '描述需要改进的地方...',
      rejectFeedbackRequired: '拒绝时必须填写反馈原因',
      dimension: {
        contentFidelity: '内容忠实度',
        colloquialism: '口语化与可讲度',
        structure: '结构清晰度与节奏',
        terminology: '术语与比喻的恰当性',
        attraction: '吸引力',
        duration: '时长',
      },
      dimensionStatus: {
        pass: '通过',
        warn: '建议改进',
        fail: '必须修改',
      },
      criticalIssueWarning: '⚠️ 内容忠实度存在严重问题，请务必修正后再通过',
    },

    // WorkflowRunDetail
    detail: {
      title: '工作流详情',
      runId: 'Run #{id}',
      project: '项目',
      startedAt: '启动',
      totalDuration: '总耗时',
      outputSummary: '输出摘要',
      viewOutput: '查看输出',
      replayFromHere: '从这里重放',
      forkFromHere: '从这里分支编辑',
      reviewResult: '审批结果',
      reviewScore: 'LLM 评分',
      reviewDimensions: '维度',
      directorNote: '导演备注',
      segments: '个段落',
      emotionDistribution: '情绪分布',
      roleDistribution: '角色',
      audioFiles: '个音频',
      totalAudioDuration: '总时长',
      engine: '引擎',
      playAll: '播放全部',
      confirmReplay: '确认从 {stage} 重放？将覆盖后续阶段的输出',
      confirmFork: '确认从 {stage} 分支编辑？',
    },

    // 操作
    action: {
      replay: '重放',
      fork: '分支编辑',
      startNewRun: '全新运行',
      exportAudio: '导出音频',
    },
  },
};

// en-US.ts
const enUS = {
  workflow: {
    common: {
      title: 'Workflow',
      newRun: 'New Run',
      cancel: 'Cancel',
      confirm: 'Confirm',
      back: 'Back',
    },
    stage: {
      gen_script: 'Generate Script',
      script_review: 'Script Review',
      split_segment: 'Split Segments',
      synthesis: 'Synthesis',
    },
    status: {
      running: 'Running',
      interrupted: 'Awaiting Review',
      completed: 'Completed',
      failed: 'Failed',
      cancelled: 'Cancelled',
    },
    hub: {
      title: 'Workflow',
      noRuns: 'No workflow runs yet',
      startedAt: 'Started at {time}',
      duration: 'Duration: {duration}',
      viewReview: 'View Review',
      viewDetail: 'View Details',
      replayFrom: 'Replay from {stage}',
      forkFrom: 'Fork from {stage}',
      startNewRun: 'New Run',
      exportAudio: 'Export Audio',
      confirmCancel: 'Cancel this workflow?',
      activeWorkflowExists: 'An active workflow already exists',
    },
    review: {
      title: 'Script Review',
      llmReview: 'LLM Review Feedback',
      overallScore: 'Overall Score',
      scriptEditor: 'Narration Script (Editable)',
      wordCount: 'Words',
      estimatedDuration: 'Est. Duration',
      chapterCount: 'Chapters',
      segmentCount: 'Segments',
      directorNote: 'Director Note (optional, saved to memory)',
      directorNotePlaceholder: 'Enter director note...',
      reject: 'Reject with Feedback',
      approve: 'Approve',
      approveAndEdit: 'Approve & Edit',
      rejectFeedbackTitle: 'Please provide rejection reason',
      rejectFeedbackPlaceholder: 'Describe what needs improvement...',
      rejectFeedbackRequired: 'Feedback is required when rejecting',
      dimension: {
        contentFidelity: 'Content Fidelity',
        colloquialism: 'Colloquialism & Speakability',
        structure: 'Structure & Pacing',
        terminology: 'Terminology & Metaphors',
        attraction: 'Attraction',
        duration: 'Duration',
      },
      dimensionStatus: {
        pass: 'Pass',
        warn: 'Needs Improvement',
        fail: 'Must Fix',
      },
      criticalIssueWarning: '⚠️ Critical content fidelity issue detected. Must be fixed before approval.',
    },
    detail: {
      title: 'Workflow Details',
      runId: 'Run #{id}',
      project: 'Project',
      startedAt: 'Started',
      totalDuration: 'Total Duration',
      outputSummary: 'Output Summary',
      viewOutput: 'View Output',
      replayFromHere: 'Replay from here',
      forkFromHere: 'Fork from here',
      reviewResult: 'Review Result',
      reviewScore: 'LLM Score',
      reviewDimensions: 'Dimensions',
      directorNote: 'Director Note',
      segments: 'segments',
      emotionDistribution: 'Emotion Distribution',
      roleDistribution: 'Roles',
      audioFiles: 'audio files',
      totalAudioDuration: 'Total Duration',
      engine: 'Engine',
      playAll: 'Play All',
      confirmReplay: 'Replay from {stage}? This will overwrite downstream outputs.',
      confirmFork: 'Fork from {stage}?',
    },
    action: {
      replay: 'Replay',
      fork: 'Fork & Edit',
      startNewRun: 'New Run',
      exportAudio: 'Export Audio',
    },
  },
};
```

### 13.4 动态文本处理

| 场景 | 处理方式 |
|---|---|
| 阶段名称 | `t('workflow.stage.gen_script')` |
| 状态文本 | `t('workflow.status.running')` |
| 带变量的文本 | `t('workflow.hub.startedAt', { time: '2026-07-10 14:30' })` |
| Review 维度名 | `t('workflow.review.dimension.contentFidelity')` |
| Review 状态 | `t('workflow.review.dimensionStatus.pass')` |

### 13.5 从后端返回的文本

以下文本由后端/SSE 返回，前端直接展示，无需翻译：
- LLM Review 的 `comment` 和 `suggestion`（LLM 生成的自然语言）
- 错误信息（后端返回的 `error` 字段）
- 导演备注（用户输入的原始文本）

---

## 14. 依赖

### 14.1 新增 Python 依赖

```
langgraph>=1.0
langgraph-checkpoint-sqlite
langchain-core
aiosqlite
```

### 14.2 新增前端依赖

无。使用标准 `fetch` + `ReadableStream`，不依赖 LangGraph JS SDK。
