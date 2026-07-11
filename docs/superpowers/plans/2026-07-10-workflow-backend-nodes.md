# Workflow Backend Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 LangGraph 工作流的 4 个节点：gen_script（旁白生成）、script_review（LLM Review + interrupt 人工审批）、split_segment（结构化拆分）、synthesis（语音合成）。

**Architecture:** 每个节点是一个 async 函数，接收 `NarrationWorkflowState` 和 `Runtime`，返回 state 更新。script_review 使用 `interrupt()` 实现人工审批门。所有节点调用 LLM 服务生成内容。

**Tech Stack:** Python 3.12+, LangGraph, LLM Client (复用现有 `app.services.llm_client`)

**Spec:** `docs/superpowers/specs/2026-07-10-narration-workflow-design.md` 第 4 章

**Depends on:** `2026-07-10-workflow-backend-foundation.md` (State 定义、Graph 工厂)

## Global Constraints

- LLM 调用复用现有的 `llm_client.generate()` 或 `llm_client.chat()`
- 节点函数签名: `async def node(state: NarrationWorkflowState, runtime: Runtime) -> dict`
- 节点通过 `runtime.store` 访问 LangGraph Store（导演反馈记忆）
- 节点内更新 `WorkflowRun` 状态（通过 `workflow_service`）

---

### Task 1: 实现 gen_script 节点

**Files:**
- Create: `backend/app/services/workflow_nodes.py`
- Modify: `backend/app/services/workflow_graph.py`

**Interfaces:**
- Produces: `gen_script_node(state, runtime) -> dict`
- Produces: `GEN_SCRIPT_SYSTEM_PROMPT` constant

- [ ] **Step 1: 创建 workflow_nodes.py 并实现 gen_script**

```python
# backend/app/services/workflow_nodes.py
import json
from datetime import datetime
from uuid import uuid4
from langgraph.runtime import Runtime
from langgraph.types import interrupt
from app.services.workflow_graph import NarrationWorkflowState


GEN_SCRIPT_SYSTEM_PROMPT = """
# 角色定义
你是一位顶尖的AI科普旁白脚本作家。你的任务是将输入的AI科普原始文档，转化为一份可以直接用于视频配音的纯文本旁白脚本。听众是有一定技术背景的大众。

# 硬性写作规则
1. **章节划分**：严格按照原始文档的「二级标题」来划分旁白的章节。将所有 Markdown 格式的标题（如 ## 标题）转换为纯文本章节标记，格式为"【章节：原标题】"。每个章节构成一个独立的旁白段落。
2. **结论先行**：每个章节段落，都必须先用1-2句话提炼出该部分最核心的关键结论，再展开具体描述和通俗解释。
3. **数据保真**：严禁编纂任何数据或事实。旁白脚本的含义必须与原始文档严格一致。所有关键数据说明必须原样保留，但可以用更口语化的方式重新表达。
4. **移除标记**：最终输出的旁白脚本必须是纯文本，不得包含任何 Markdown 标记符号（如 #, *, -, ` 等）。

# 口语化与听觉设计规则
1. **绝对口语化**：完全打散书面语结构，每句话不超过25个字。大量使用"你想想看"、"咱们"、"其实吧"、"说白了就是"等口语词。
2. **术语快解释**：遇到专业术语，必须立即用一句话的生活比喻或通俗说法带过，绝不展开讲大故事。
   - 示例："这就用到了'自注意力机制'——说白了，就是让模型在海量信息中，一眼盯住最关键的部分。"
3. **听觉牵引感**：频繁使用设问（"这是怎么做到的呢？"）、感叹（"没错！"）、转折（"但问题来了……"）来牵引听众注意力，营造一对一的对话感。
4. **结构完整**：脚本必须具备"凤头-猪肚-豹尾"。
   - **开场**：用生活痛点、惊人事实或假设性提问瞬间抓住听众。
   - **结尾**：用金句总结升华，并包含互动引导（如"如果你觉得有意思，请分享给更多人"）。

# 输出格式

输出完整的 markdown 文档，使用 # 标记章节标题，段落之间用空行分隔。

不要输出任何元数据、说明或注释，只输出旁白脚本正文。
"""


def parse_markdown_chapters(script: str) -> list[dict]:
    """解析 markdown 脚本为章节结构"""
    chapters = []
    current_title = None
    current_lines = []

    for line in script.split("\n"):
        if line.startswith("# ") or line.startswith("## "):
            if current_title is not None:
                chapters.append({"title": current_title, "content": "\n".join(current_lines).strip()})
            current_title = line.lstrip("#").strip()
            current_lines = []
        else:
            current_lines.append(line)

    if current_title is not None:
        chapters.append({"title": current_title, "content": "\n".join(current_lines).strip()})

    return chapters


async def gen_script_node(state: NarrationWorkflowState, runtime: Runtime) -> dict:
    """GenScript 节点：将源文档转化为旁白脚本"""
    from app.services.llm_client import generate  # 延迟导入避免循环

    project_id = state["project_id"]

    # 查询历史 reject feedback
    namespace = ("director_feedback", project_id)
    past_feedback = await runtime.store.asearch(namespace, query="reject feedback", limit=3)
    feedback_context = ""
    if past_feedback:
        feedback_context = "\n\n## 导演历史反馈（请参考）\n" + "\n".join(
            f"- {item.value.get('feedback', '')}" for item in past_feedback if item.value.get('feedback')
        )

    # 调用 LLM
    script = await generate(
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

- [ ] **Step 2: 更新 workflow_graph.py 使用真实节点**

在 `workflow_graph.py` 中导入并替换占位节点：

```python
# 在文件顶部添加
from app.services.workflow_nodes import gen_script_node

# 在 create_narration_graph 中替换
.add_node("gen_script", gen_script_node)
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/workflow_nodes.py backend/app/services/workflow_graph.py
git commit -m "feat(workflow): implement gen_script node with LLM narration generation"
```

---

### Task 2: 实现 script_review 节点（含 interrupt）

**Files:**
- Modify: `backend/app/services/workflow_nodes.py`
- Modify: `backend/app/services/workflow_graph.py`

**Interfaces:**
- Produces: `script_review_node(state, runtime) -> dict`
- Produces: `SCRIPT_REVIEW_SYSTEM_PROMPT` constant
- Produces: `_extract_preference(runtime, project_id, feedback)` helper

- [ ] **Step 1: 实现 script_review 节点**

在 `workflow_nodes.py` 中添加：

```python
SCRIPT_REVIEW_SYSTEM_PROMPT = """你是一位资深的视频导演助理，负责审查旁白脚本质量。

请从以下维度审查旁白脚本，并给出具体的改进建议：

## 审查维度

1.  **内容忠实度（一票否决项）**
    - 旁白含义是否与原始文档完全一致？是否存在编造数据、曲解原意的情况？
    - 原始文档中的关键数据说明是否被完整保留？
2.  **口语化与可讲度**
    - 每一句话是否都像"人话"？朗读起来是否顺口，没有任何生硬的书袋感？
    - 句子长度是否都控制在25字以内？长句是否已有效拆分？
3.  **结构清晰度与节奏**
    - 章节划分是否与原始文档的二级标题严格对应？
    - 每个章节是否做到了"结论先行"？逻辑是否由浅入深、流畅不跳跃？
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
    from app.services.llm_client import generate
    try:
        result = await generate(
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


async def script_review_node(state: NarrationWorkflowState, runtime: Runtime) -> dict:
    """ScriptReview 节点：LLM Review + interrupt 人工审批"""
    from app.services.llm_client import generate

    project_id = state["project_id"]
    run_id = state["run_id"]

    # LLM 自动 Review
    review_raw = await generate(
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
        "review": review,
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
            await _extract_preference(runtime, project_id, decision["comment"])

        return {
            "edited_script": edited_script,
            "review_feedback": review,
            "review_status": "approved",
            "current_stage": "split_segment"
        }
    else:
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
```

- [ ] **Step 2: 更新 workflow_graph.py**

```python
from app.services.workflow_nodes import gen_script_node, script_review_node

# 替换占位节点
.add_node("script_review", script_review_node)
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/workflow_nodes.py backend/app/services/workflow_graph.py
git commit -m "feat(workflow): implement script_review node with LLM review and interrupt"
```

---

### Task 3: 实现 split_segment 节点

**Files:**
- Modify: `backend/app/services/workflow_nodes.py`
- Modify: `backend/app/services/workflow_graph.py`

**Interfaces:**
- Produces: `split_segment_node(state, runtime) -> dict`
- Produces: `SPLIT_SEGMENT_SYSTEM_PROMPT` constant

- [ ] **Step 1: 实现 split_segment 节点**

在 `workflow_nodes.py` 中添加：

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


async def split_segment_node(state: NarrationWorkflowState, runtime: Runtime) -> dict:
    """SplitSegment 节点：将旁白脚本拆分为结构化段落"""
    from app.services.llm_client import generate

    project_id = state["project_id"]

    # 查询导演偏好
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

    result = await generate(
        system=SPLIT_SEGMENT_SYSTEM_PROMPT,
        user=f"请将以下旁白脚本拆分为结构化段落：\n\n{script}{pref_context}"
    )

    structured = json.loads(result)

    return {
        "structured_segments": structured,
        "current_stage": "synthesis"
    }
```

- [ ] **Step 2: 更新 workflow_graph.py**

```python
from app.services.workflow_nodes import gen_script_node, script_review_node, split_segment_node

.add_node("split_segment", split_segment_node)
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/workflow_nodes.py backend/app/services/workflow_graph.py
git commit -m "feat(workflow): implement split_segment node with LLM structured output"
```

---

### Task 4: 实现 synthesis 节点

**Files:**
- Modify: `backend/app/services/workflow_nodes.py`
- Modify: `backend/app/services/workflow_graph.py`

**Interfaces:**
- Produces: `synthesis_node(state, runtime) -> dict`
- Consumes: `synthesize_with_engine()` from `segmented_project_service`

- [ ] **Step 1: 实现 synthesis 节点**

在 `workflow_nodes.py` 中添加：

```python
async def synthesis_node(state: NarrationWorkflowState, runtime: Runtime) -> dict:
    """Synthesis 节点：将结构化段落写入 Project/Chapter/Segment，调用 TTS 合成"""
    from app.core.database import SessionLocal
    from app.services.segmented_project_service import (
        create_chapter_for_project,
        create_segment_for_chapter,
        synthesize_with_engine,
    )

    project_id = state["project_id"]
    results = []

    db = SessionLocal()
    try:
        for chapter_index, chapter_data in enumerate(state["structured_segments"]):
            # 创建 Chapter
            chapter = create_chapter_for_project(
                db, project_id, chapter_data["chapter_title"], chapter_index
            )

            for seg_index, seg_data in enumerate(chapter_data["segments"]):
                # 创建 Segment
                segment = create_segment_for_chapter(
                    db, chapter.id, seg_data["text"], seg_index,
                    emotion=seg_data.get("emotion"),
                    role=seg_data.get("role"),
                    segment_kind=seg_data.get("segment_kind", "narration")
                )

                # 调用现有 TTS 合成
                audio_result = await synthesize_with_engine(
                    db=db,
                    project_id=project_id,
                    chapter_id=chapter.id,
                    segment_id=segment.id,
                    text=seg_data["text"],
                    params={}  # 使用项目默认音色
                )

                results.append({
                    "chapter_index": chapter_index,
                    "segment_index": seg_index,
                    "segment_id": segment.id,
                    "audio_path": audio_result.get("path"),
                    "duration_sec": audio_result.get("duration")
                })

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    return {
        "synthesis_results": results,
        "current_stage": "completed"
    }
```

- [ ] **Step 2: 更新 workflow_graph.py**

```python
from app.services.workflow_nodes import gen_script_node, script_review_node, split_segment_node, synthesis_node

.add_node("synthesis", synthesis_node)
```

- [ ] **Step 3: 验证所有节点已替换占位**

检查 `workflow_graph.py` 中不再有 placeholder 节点引用。

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/workflow_nodes.py backend/app/services/workflow_graph.py
git commit -m "feat(workflow): implement synthesis node with TTS integration"
```

---

### Task 5: 添加节点单元测试

**Files:**
- Create: `backend/tests/unit/test_workflow_nodes.py`

- [ ] **Step 1: 测试 parse_markdown_chapters**

```python
# backend/tests/unit/test_workflow_nodes.py
import pytest
from app.services.workflow_nodes import parse_markdown_chapters


def test_parse_single_chapter():
    script = "# 第一章\n这是内容"
    chapters = parse_markdown_chapters(script)
    assert len(chapters) == 1
    assert chapters[0]["title"] == "第一章"
    assert chapters[0]["content"] == "这是内容"


def test_parse_multiple_chapters():
    script = "# 引言\n开场白\n# 核心\n主要论点\n# 总结\n结束语"
    chapters = parse_markdown_chapters(script)
    assert len(chapters) == 3
    assert chapters[0]["title"] == "引言"
    assert chapters[1]["title"] == "核心"
    assert chapters[2]["title"] == "总结"


def test_parse_empty():
    chapters = parse_markdown_chapters("")
    assert chapters == []


def test_parse_no_chapters():
    script = "没有标题的内容"
    chapters = parse_markdown_chapters(script)
    assert chapters == []
```

- [ ] **Step 2: 运行测试**

Run: `cd backend && uv run --extra test pytest tests/unit/test_workflow_nodes.py -v`

Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add backend/tests/unit/test_workflow_nodes.py
git commit -m "test(workflow): add unit tests for workflow nodes"
```
