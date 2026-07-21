# 知识分享视频工作流（knowledge_video）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一条独立的 LangGraph 工作流 `knowledge_video`：源文档 → 忠于原文的旁白转写 → 基础质量审查（人工确认）→ 章节拆分 → edge-tts 合成 → 生成 Remotion 工程 → 生成动画分镜 brief。

**Architecture:** Agent 侧新增第二张 graph（`agent/app/graph_knowledge_video.py`，assistant id `knowledge_video`），与现有 narration 完全解耦；后端新增 `POST /api/segmented-projects/{pid}/scaffold-remotion`（npx create-video 脚手架 + 资产刷新，幂等）和 srt 生成工具；前端 drawer 支持工作流类型选择、确认型 interrupt（ConfirmPanel）和分镜视图（StoryboardPanel）。

**Tech Stack:** LangGraph + instructor + httpx（agent）、FastAPI + SQLAlchemy + subprocess npx（backend）、React 19 + @langchain/langgraph-sdk + vitest（frontend）、Playwright（E2E）。

**设计文档:** `docs/superpowers/specs/2026-07-21-knowledge-video-workflow-design.md`

---

## 文件结构

**Agent（新建 `agent/app/nodes/knowledge_video/` 子包）:**

| 文件 | 职责 |
|---|---|
| `agent/app/prompts/loader.py` | 新建：LangSmith 优先 / 代码兜底的 prompt loader 工厂（从 narration.py 抽取） |
| `agent/app/prompts/narration.py` | 改造：改用 loader 工厂，公开 API（`get_prompt`、常量）不变 |
| `agent/app/prompts/knowledge_video.py` | 新建：4 个 kv prompt 常量 + `get_prompt`（`narraforge-kv-*` 命名） |
| `agent/app/state.py` | 追加 `KnowledgeVideoState` |
| `agent/app/schemas.py` | 追加 `QualityReviewResult` / `SourceElement` / `AnimationBrief` 等 |
| `agent/app/source_elements.py` | 新建：从 markdown 确定性提取代码块/图片引用 |
| `agent/app/backend_client.py` | 追加 `scaffold_remotion` / `apply_animation_spec`；`synthesize_segment` 加 `params` 参数 |
| `agent/app/nodes/knowledge_video/{preflight,gen_narration,quality_review,split_chapters,synthesis,scaffold_remotion,gen_animation_brief}.py` | 7 个节点 |
| `agent/app/graph_knowledge_video.py` | 新 graph 定义 + 编译 |
| `agent/langgraph.json` | 注册第二个 assistant |

**Backend:**

| 文件 | 职责 |
|---|---|
| `backend/app/services/srt_service.py` | 新建：按 segment duration 生成 SRT 的纯函数 |
| `backend/app/services/remotion_scaffold_service.py` | 新建：Remotion 工程探测/创建/资产刷新 |
| `backend/app/services/segmented_project_service.py` | 改造 `apply_animation_spec`：合并任意传入字段（原白名单之外也保留） |
| `backend/app/api/segmented_projects.py` | 新增 `scaffold-remotion` 端点 |

**Frontend:**

| 文件 | 职责 |
|---|---|
| `frontend/src/services/langgraph/contracts.ts` | `WorkflowKind` / `WORKFLOW_KINDS` 映射 + kv 节点状态键 |
| `frontend/src/services/langgraph/types.ts` | `KnowledgeVideoState` + brief 类型 + `WorkflowState` 联合 |
| `frontend/src/components/ProjectLibrary/ProjectLibrary.tsx` | 两个工作流入口按钮 + kind 状态 + 传 `assistantId` 给 drawer |
| `frontend/src/components/Workflow/WorkflowDrawer.tsx` | `assistantId` prop + kv 摘要 + confirm/review interrupt 分支 |
| `frontend/src/components/Workflow/ConfirmPanel.tsx(+module.css)` | 新建：preflight 覆盖确认面板 |
| `frontend/src/components/Storyboard/StoryboardPanel.tsx(+module.css)` | 新建：分镜视图 + 「复制为文本」 |

**测试:** agent `tests/test_kv_*.py`、`tests/test_source_elements.py`、`tests/test_kv_graph.py`；backend `tests/test_srt_service.py`、`tests/test_remotion_scaffold.py`；frontend colocated `ConfirmPanel.test.tsx`、`StoryboardPanel.test.tsx`、`contracts.test.ts`；E2E `tests/e2e/specs/knowledge-video-workflow.spec.ts`。

---

## Task 1: Agent — prompt loader 工厂 + knowledge_video prompts

**Files:**
- Create: `agent/app/prompts/loader.py`
- Modify: `agent/app/prompts/narration.py`（替换尾部 loader 部分，171-220 行）
- Create: `agent/app/prompts/knowledge_video.py`
- Test: `agent/tests/test_kv_prompts.py`

- [ ] **Step 1: 写失败测试**

`agent/tests/test_kv_prompts.py`:

```python
import pytest

from app.prompts import knowledge_video
from app.prompts.knowledge_video import KV_GEN_NARRATION_SYSTEM_PROMPT, get_prompt


def test_kv_get_prompt_falls_back_to_default(monkeypatch):
    monkeypatch.delenv("LANGSMITH_API_KEY", raising=False)
    assert get_prompt("kv_gen_narration") == KV_GEN_NARRATION_SYSTEM_PROMPT


def test_kv_get_prompt_unknown_name_raises():
    with pytest.raises(KeyError):
        get_prompt("nope")


def test_narration_get_prompt_still_works_after_refactor(monkeypatch):
    """narration.get_prompt 公共 API 在 loader 抽取后保持不变。"""
    monkeypatch.delenv("LANGSMITH_API_KEY", raising=False)
    from app.prompts.narration import GEN_SCRIPT_SYSTEM_PROMPT
    from app.prompts import narration

    assert narration.get_prompt("gen_script") == GEN_SCRIPT_SYSTEM_PROMPT
    out = narration.get_prompt("preference_extract", feedback="fix intro")
    assert "fix intro" in out
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd agent && uv run --extra test pytest tests/test_kv_prompts.py -q`
Expected: FAIL（`ModuleNotFoundError: app.prompts.knowledge_video`）

- [ ] **Step 3: 实现 loader 工厂**

`agent/app/prompts/loader.py`:

```python
"""Shared LangSmith-first prompt loader factory.

Each prompt module builds its own ``get_prompt`` via ``make_get_prompt``:
LangSmith prompt hub is tried first (hot-reload); any failure (missing
``LANGSMITH_API_KEY``, unpublished prompt, network error) falls back to the
code-default constant.
"""
from __future__ import annotations

from langsmith import Client
from langsmith.client import convert_prompt_to_openai_format


def make_get_prompt(defaults: dict[str, str], langsmith_names: dict[str, str]):
    client = None

    def get_prompt(name: str, **vars) -> str:
        if name not in defaults:
            raise KeyError(name)
        default = defaults[name]
        ls_name = langsmith_names.get(name)
        if ls_name:
            try:
                nonlocal client
                if client is None:
                    client = Client()  # reads LANGSMITH_API_KEY; may raise if absent
                pt = client.pull_prompt(ls_name)
                msgs = convert_prompt_to_openai_format(pt.invoke(vars))
                for m in msgs:
                    if m.get("role") == "system" and m.get("content"):
                        return m["content"]
                if msgs and msgs[0].get("content"):
                    return msgs[0]["content"]
            except Exception:
                pass  # fall through to code default
        return default.format(**vars) if vars else default

    return get_prompt
```

- [ ] **Step 4: 改造 narration.py 使用工厂**

`agent/app/prompts/narration.py`：删除第 171-220 行（`# ---- LangSmith-first prompt loader ...` 注释起到文件末尾的全部内容），替换为：

```python
# ---------------------------------------------------------------------------
# LangSmith-first prompt loader (falls back to the code defaults above)
# ---------------------------------------------------------------------------
from app.prompts.loader import make_get_prompt

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

get_prompt = make_get_prompt(_DEFAULTS, _LANGSMITH_NAMES)
```

- [ ] **Step 5: 写 knowledge_video prompts**

`agent/app/prompts/knowledge_video.py`:

```python
"""knowledge_video workflow prompts: faithful narration rewrite + storyboard brief."""

KV_GEN_NARRATION_SYSTEM_PROMPT = """\
# 角色定义
你是一位严谨的知识分享视频旁白转写员。你的任务是把输入的 markdown 文档转写为可直接配音的纯文本旁白稿。

# 硬性规则
1. **严格忠于原文**：不得新增、删除或改写任何事实、数据、观点和结论；不得调整原文的论述顺序。
2. **移除 markdown 格式**：去掉所有标记符号（#, *, -, `, >, [](), 表格线等），只保留纯文本。
3. **代码块处理**：保留代码内容本身为纯文本段落（去掉 ``` 围栏和语言标记），不要逐字朗读式改写代码，保持原样即可。
4. **图片处理**：原文中的图片引用（![alt](url)）整行移除，不在旁白中提及。
5. **轻度口语化**：只允许把书面语调整为适合朗读的表达（如拆分过长的句子），不得改变含义。
6. **章节划分**：严格按原文的二级标题（##）划分章节。

# 输出格式
输出完整的 markdown 文档，使用 # 标记章节标题，段落之间用空行分隔。
不要输出任何元数据、说明或注释，只输出旁白稿正文。
"""

KV_QUALITY_REVIEW_SYSTEM_PROMPT = """\
你是一位严谨的质量审查员，负责审查「从 markdown 文档转写的旁白稿」的基础质量。

## 审查维度

1. **markdown_residue**：旁白稿中是否残留 markdown 标记符号（#, *, -, ```, []( 等）？
2. **fidelity**：旁白稿是否严格忠于原文？是否存在漏段、编造内容、改变原意、调整论述顺序？
3. **chapter_split**：章节划分是否与原文二级标题一一对应？
4. **readability**：是否适合朗读（无表格残留、无图片引用残留、代码段保留为纯文本）？

## 输出格式

严格输出以下 JSON 格式，不要输出其他内容：

{
  "passed": true,
  "dimensions": [
    {"name": "markdown_residue", "passed": true, "comment": "具体评价"},
    {"name": "fidelity", "passed": true, "comment": "具体评价"},
    {"name": "chapter_split", "passed": false, "comment": "具体评价"},
    {"name": "readability", "passed": true, "comment": "具体评价"}
  ],
  "issues": ["具体问题描述1", "具体问题描述2"]
}

字段说明：
- passed: 所有维度均通过才为 true，任一维度不通过则为 false
- issues: 不通过时列出具体问题（可定位到章节/段落），通过时为空数组
"""

KV_SPLIT_CHAPTERS_SYSTEM_PROMPT = """\
你是一位专业的旁白稿结构化分析师。

你的任务是将旁白稿拆分为结构化的章节和段落。

## 拆分规则

1. **章节**: 按 markdown 标题（# / ##）划分
2. **段落**: 每个自然段落为一个段落，每段 30-80 字
3. **过长段落**: 超过 80 字的段落，在语义自然的断点处拆分
4. **过短段落**: 少于 15 字的段落，考虑与相邻段落合并
5. **代码段落**: 代码内容保持完整，不要拆散到多个段落

## 标注规则

- 全部为知识分享旁白：role 一律为 "narration"，segment_kind 一律为 "narration"
- emotion 默认为 "neutral"，仅在内容明显激动/欢快时用 "excited"/"happy"

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
"""

KV_ANIMATION_BRIEF_SYSTEM_PROMPT = """\
你是一位知识分享视频的动画分镜设计师。

输入是按时间轴排列的章节与旁白段落（含每段起止秒数），以及原文档中的代码块/图片元素清单。
请为每个段落生成动画分镜 brief：这段旁白播放时，画面呈现什么内容、用什么动画效果。

## 设计原则

1. **代码段落**：visual_content.type 用 "code"，画面呈现代码（配合 source_ref 指向的原文代码），动画效果优先用 "typewriter"（逐行打出）或 "highlight_lines"（逐行高亮）。
2. **图片段落**：visual_content.type 用 "image"，source_ref 填原文图片引用路径/URL，动画效果用 "fade_in" 或 "scale_in"。
3. **要点段落**：visual_content.type 用 "key_points"，把段落提炼为 2-4 条要点，动画效果用 "slide_in" 逐条进入。
4. **普通叙述**：visual_content.type 用 "text"，呈现关键句（kinetic typography），动画效果用 "fade_in"。
5. 每个段落的 brief 必须与该段的旁白文本对应，不得张冠李戴。

## 输出格式

严格输出以下 JSON 格式，不要输出其他内容：

{
  "chapters": [
    {
      "chapter_position": 0,
      "title": "章节标题",
      "segments": [
        {
          "segment_position": 0,
          "narration_text": "该段旁白文本（与输入一致）",
          "visual_content": {
            "type": "code|image|key_points|text",
            "description": "画面呈现内容的具体描述",
            "source_ref": "原文元素引用（图片URL/代码出处），无则为 null"
          },
          "animation": {
            "effect": "typewriter|highlight_lines|fade_in|scale_in|slide_in",
            "notes": "动画细节说明（时长、顺序等）"
          }
        }
      ]
    }
  ]
}
"""

# ---------------------------------------------------------------------------
# LangSmith-first prompt loader (falls back to the code defaults above)
# ---------------------------------------------------------------------------
from app.prompts.loader import make_get_prompt

_DEFAULTS = {
    "kv_gen_narration": KV_GEN_NARRATION_SYSTEM_PROMPT,
    "kv_quality_review": KV_QUALITY_REVIEW_SYSTEM_PROMPT,
    "kv_split_chapters": KV_SPLIT_CHAPTERS_SYSTEM_PROMPT,
    "kv_animation_brief": KV_ANIMATION_BRIEF_SYSTEM_PROMPT,
}

_LANGSMITH_NAMES = {
    "kv_gen_narration": "narraforge-kv-gen-narration",
    "kv_quality_review": "narraforge-kv-quality-review",
    "kv_split_chapters": "narraforge-kv-split-chapters",
    "kv_animation_brief": "narraforge-kv-animation-brief",
}

get_prompt = make_get_prompt(_DEFAULTS, _LANGSMITH_NAMES)
```

- [ ] **Step 6: 运行测试确认通过 + 回归**

Run: `cd agent && uv run --extra test pytest tests/test_kv_prompts.py tests/test_prompts.py -q`
Expected: 全部 PASS（含 narration 旧测试回归）

- [ ] **Step 7: Commit**

```bash
git add agent/app/prompts/loader.py agent/app/prompts/narration.py agent/app/prompts/knowledge_video.py agent/tests/test_kv_prompts.py
git commit -m "feat(agent): shared prompt loader factory + knowledge_video prompts"
```

---

## Task 2: Agent — KnowledgeVideoState + schemas

**Files:**
- Modify: `agent/app/state.py`（文件末尾追加）
- Modify: `agent/app/schemas.py`（文件末尾追加）
- Test: `agent/tests/test_kv_schemas.py`

- [ ] **Step 1: 写失败测试**

`agent/tests/test_kv_schemas.py`:

```python
from app.schemas import (
    AnimationBrief,
    ChapterBrief,
    QualityReviewResult,
    SegmentBrief,
    SourceElement,
)
from app.state import KnowledgeVideoState


def test_quality_review_result_schema():
    r = QualityReviewResult(
        passed=False,
        dimensions=[{"name": "fidelity", "passed": False, "comment": "漏段"}],
        issues=["第二章缺失"],
    )
    assert r.passed is False
    assert r.dimensions[0].name == "fidelity"


def test_source_element_schema():
    e = SourceElement(kind="image", ref="docs/a.png", chapter_index=1, excerpt="示意图")
    assert e.kind == "image"


def test_animation_brief_schema():
    brief = AnimationBrief(
        chapters=[
            ChapterBrief(
                chapter_position=0,
                title=" intro",
                segments=[
                    SegmentBrief(
                        segment_position=0,
                        narration_text="你好",
                        visual_content={"type": "text", "description": "关键句", "source_ref": None},
                        animation={"effect": "fade_in", "notes": ""},
                    )
                ],
            )
        ]
    )
    dumped = brief.model_dump()
    assert dumped["chapters"][0]["segments"][0]["visual_content"]["type"] == "text"


def test_knowledge_video_state_is_typed_dict():
    state: KnowledgeVideoState = {"project_id": "p1", "current_stage": "preflight_check"}
    assert state["project_id"] == "p1"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd agent && uv run --extra test pytest tests/test_kv_schemas.py -q`
Expected: FAIL（`ImportError: cannot import name 'QualityReviewResult'`）

- [ ] **Step 3: 追加 schemas**

`agent/app/schemas.py` 文件末尾追加：

```python
# ---------------------------------------------------------------------------
# knowledge_video workflow
# ---------------------------------------------------------------------------


class QualityDimension(BaseModel):
    """One quality-check dimension for the kv quality_review node."""

    name: str
    passed: bool
    comment: str


class QualityReviewResult(BaseModel):
    """LLM auto quality-check output for the kv quality_review node."""

    passed: bool
    dimensions: list[QualityDimension]
    issues: list[str] = Field(default_factory=list)


class SourceElement(BaseModel):
    """A code block or image reference found in the source document."""

    kind: Literal["code", "image"]
    ref: str
    chapter_index: int
    excerpt: str


class VisualContent(BaseModel):
    """What to show on screen while a segment is narrated."""

    type: Literal["code", "image", "key_points", "text"]
    description: str
    source_ref: str | None = None


class AnimationSpec(BaseModel):
    """How to animate the visual content of a segment."""

    effect: str
    notes: str = ""


class SegmentBrief(BaseModel):
    """Storyboard brief for one narration segment."""

    segment_position: int
    narration_text: str
    visual_content: VisualContent
    animation: AnimationSpec


class ChapterBrief(BaseModel):
    """Storyboard briefs for one chapter."""

    chapter_position: int
    title: str
    segments: list[SegmentBrief]


class AnimationBrief(BaseModel):
    """Full storyboard brief for the project (top-level must be an object)."""

    chapters: list[ChapterBrief]
```

- [ ] **Step 4: 追加 state**

`agent/app/state.py` 文件末尾追加：

```python
class KnowledgeVideoState(TypedDict, total=False):
    """State for the knowledge_video workflow (see graph_knowledge_video.py)."""

    # -- inputs ---------------------------------------------------------------
    project_id: str
    target_dir: str | None          # optional override for the remotion project dir

    # -- preflight_check / gen_narration output --------------------------------
    source_document: str
    source_structure_map: list[dict[str, Any]]  # serialized SourceElement
    narration_script: str
    script_chapters: list[dict[str, Any]]

    # -- quality_review output --------------------------------------------------
    review_result: dict[str, Any]   # serialized QualityReviewResult
    edited_script: str
    review_status: Literal["approved", "rejected"]

    # -- split_chapters output --------------------------------------------------
    structured_segments: list[dict[str, Any]]   # carries _chapter_id / _segment_id

    # -- synthesis output -------------------------------------------------------
    synthesis_results: list[dict[str, Any]]

    # -- scaffold_remotion / gen_animation_brief output -------------------------
    remotion_project_dir: str
    animation_brief: dict[str, Any]  # serialized AnimationBrief (+ start/end sec per segment)

    # -- metadata ---------------------------------------------------------------
    current_stage: str
    review_retry_count: int
    error: str | None
```

- [ ] **Step 5: 运行测试确认通过 + 回归**

Run: `cd agent && uv run --extra test pytest tests/test_kv_schemas.py tests/test_schemas.py -q`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add agent/app/state.py agent/app/schemas.py agent/tests/test_kv_schemas.py
git commit -m "feat(agent): KnowledgeVideoState + kv schemas"
```

---

## Task 3: Agent — source_elements markdown 解析器

**Files:**
- Create: `agent/app/source_elements.py`
- Test: `agent/tests/test_source_elements.py`

- [ ] **Step 1: 写失败测试**

`agent/tests/test_source_elements.py`:

```python
from app.source_elements import extract_source_elements


DOC = """# 第一章

这是第一段。

```python
def hello():
    return 1
```

![架构图](images/arch.png)

## 第二章

![流程](https://example.com/flow.svg)

普通段落。
"""


def test_extracts_code_blocks_with_chapter_index():
    elements = extract_source_elements(DOC)
    codes = [e for e in elements if e["kind"] == "code"]
    assert len(codes) == 1
    assert codes[0]["chapter_index"] == 0
    assert "def hello():" in codes[0]["excerpt"]


def test_extracts_images_with_ref():
    elements = extract_source_elements(DOC)
    images = [e for e in elements if e["kind"] == "image"]
    assert [i["ref"] for i in images] == ["images/arch.png", "https://example.com/flow.svg"]
    assert images[0]["excerpt"] == "架构图"
    assert images[1]["chapter_index"] == 1


def test_empty_document_returns_empty():
    assert extract_source_elements("") == []


def test_images_inside_code_block_are_ignored():
    doc = "```\n![not an image](x.png)\n```\n"
    elements = extract_source_elements(doc)
    assert [e["kind"] for e in elements] == ["code"]
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd agent && uv run --extra test pytest tests/test_source_elements.py -q`
Expected: FAIL（`ModuleNotFoundError`）

- [ ] **Step 3: 实现解析器**

`agent/app/source_elements.py`:

```python
"""Deterministic extraction of code blocks and image refs from markdown.

The kv workflow needs to know which source-document chapters contain code
blocks or images so the animation-brief node can reference them. Parsing
markdown directly is more reliable than asking the LLM to recall them.
"""
from __future__ import annotations

import re

_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")


def extract_source_elements(source_document: str) -> list[dict]:
    """Return [{kind, ref, chapter_index, excerpt}] for code blocks and images.

    ``chapter_index`` counts markdown heading lines (``#`` / ``##`` ...) from 0;
    elements before the first heading get index 0.
    """
    elements: list[dict] = []
    chapter_index = -1
    in_code = False
    code_lines: list[str] = []
    for line in source_document.split("\n"):
        stripped = line.strip()
        if not in_code and stripped.startswith("#"):
            chapter_index += 1
        if stripped.startswith("```"):
            if in_code:
                elements.append(
                    {
                        "kind": "code",
                        "ref": "",
                        "chapter_index": max(chapter_index, 0),
                        "excerpt": "\n".join(code_lines)[:200],
                    }
                )
                code_lines = []
                in_code = False
            else:
                in_code = True
            continue
        if in_code:
            code_lines.append(line)
            continue
        for m in _IMAGE_RE.finditer(line):
            elements.append(
                {
                    "kind": "image",
                    "ref": m.group(2),
                    "chapter_index": max(chapter_index, 0),
                    "excerpt": m.group(1),
                }
            )
    return elements
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd agent && uv run --extra test pytest tests/test_source_elements.py -q`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add agent/app/source_elements.py agent/tests/test_source_elements.py
git commit -m "feat(agent): deterministic source element extractor for kv workflow"
```

---

## Task 4: Agent — BackendClient 扩展

**Files:**
- Modify: `agent/app/backend_client.py`（`synthesize_segment` 加参数；末尾追加两个方法）
- Test: `agent/tests/test_kv_backend_client.py`

- [ ] **Step 1: 写失败测试**

`agent/tests/test_kv_backend_client.py`:

```python
import httpx
import pytest

from app.backend_client import BackendClient


def _make_client(handler):
    transport = httpx.MockTransport(handler)
    return BackendClient(base_url="http://test", transport=transport)


@pytest.mark.asyncio
async def test_synthesize_segment_sends_params():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = httpx.QueryParams(request.url.path)  # placeholder, replaced below
        import json as _json

        seen["json"] = _json.loads(request.content)
        return httpx.Response(200, json={"id": "p1"})

    client = _make_client(handler)
    await client.synthesize_segment("p1", "c1", "s1", params={"engine": "edge_tts", "edge_voice": "zh-CN-XiaoxiaoNeural"})
    assert seen["json"]["params"] == {"engine": "edge_tts", "edge_voice": "zh-CN-XiaoxiaoNeural"}
    assert seen["json"]["keep_previous"] is True


@pytest.mark.asyncio
async def test_synthesize_segment_default_params_none():
    import json as _json

    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["json"] = _json.loads(request.content)
        return httpx.Response(200, json={"id": "p1"})

    client = _make_client(handler)
    await client.synthesize_segment("p1", "c1", "s1")
    assert seen["json"]["params"] is None


@pytest.mark.asyncio
async def test_scaffold_remotion_posts_body():
    import json as _json

    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = request.url.path
        seen["json"] = _json.loads(request.content)
        return httpx.Response(200, json={"project_dir": "/tmp/x", "created": True, "chapters": 2})

    client = _make_client(handler)
    result = await client.scaffold_remotion("p1", target_dir="/tmp/x")
    assert seen["url"] == "/api/segmented-projects/p1/scaffold-remotion"
    assert seen["json"] == {"target_dir": "/tmp/x"}
    assert result["created"] is True


@pytest.mark.asyncio
async def test_scaffold_remotion_with_animation_brief():
    import json as _json

    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["json"] = _json.loads(request.content)
        return httpx.Response(200, json={"project_dir": "/tmp/x", "created": False, "chapters": 1})

    client = _make_client(handler)
    brief = {"chapters": []}
    await client.scaffold_remotion("p1", animation_brief=brief)
    assert seen["json"] == {"animation_brief": brief}


@pytest.mark.asyncio
async def test_apply_animation_spec_posts_items():
    import json as _json

    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = request.url.path
        seen["json"] = _json.loads(request.content)
        return httpx.Response(200, json={
            "theme_updated": False, "segments_updated": 1,
            "segments_skipped": 0, "missing_segment_ids": [],
        })

    client = _make_client(handler)
    items = [{"segment_id": "s1", "narration_text": "t"}]
    result = await client.apply_animation_spec("p1", items)
    assert seen["url"] == "/api/segmented-projects/p1/apply-animation-spec"
    assert seen["json"] == {"theme": None, "segments": items}
    assert result["segments_updated"] == 1
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd agent && uv run --extra test pytest tests/test_kv_backend_client.py -q`
Expected: FAIL（`TypeError: synthesize_segment() got an unexpected keyword argument 'params'` / `AttributeError: scaffold_remotion`）

- [ ] **Step 3: 实现扩展**

`agent/app/backend_client.py`：把 `synthesize_segment` 方法（72-81 行）替换为：

```python
    async def synthesize_segment(
        self,
        project_id: str,
        chapter_id: str,
        segment_id: str,
        params: dict | None = None,
    ) -> None:
        """POST .../segments/{sid}/synthesize - run TTS for one segment.

        *params* overrides the chapter/role voice params (e.g. force a
        specific edge-tts voice for the kv workflow).
        """
        c = await self._ensure()
        r = await c.post(
            f"/api/segmented-projects/{project_id}/chapters/{chapter_id}/segments/{segment_id}/synthesize",
            json={"params": params, "text": None, "ssml": None, "keep_previous": True},
        )
        r.raise_for_status()
```

文件末尾追加：

```python
    async def scaffold_remotion(
        self,
        project_id: str,
        target_dir: str | None = None,
        animation_brief: dict | None = None,
    ) -> dict:
        """POST /api/segmented-projects/{pid}/scaffold-remotion.

        Creates (or refreshes) the Remotion project; when *animation_brief*
        is given, also writes ``animation_brief.json`` into the project root.
        """
        body: dict = {}
        if target_dir:
            body["target_dir"] = target_dir
        if animation_brief is not None:
            body["animation_brief"] = animation_brief
        c = await self._ensure()
        r = await c.post(
            f"/api/segmented-projects/{project_id}/scaffold-remotion",
            json=body,
        )
        r.raise_for_status()
        return r.json()

    async def apply_animation_spec(
        self, project_id: str, items: list[dict], theme: str | None = None
    ) -> dict:
        """POST /api/segmented-projects/{pid}/apply-animation-spec."""
        c = await self._ensure()
        r = await c.post(
            f"/api/segmented-projects/{project_id}/apply-animation-spec",
            json={"theme": theme, "segments": items},
        )
        r.raise_for_status()
        return r.json()
```

- [ ] **Step 4: 运行测试确认通过 + 回归**

Run: `cd agent && uv run --extra test pytest tests/test_kv_backend_client.py tests/test_backend_client.py -q`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add agent/app/backend_client.py agent/tests/test_kv_backend_client.py
git commit -m "feat(agent): BackendClient scaffold_remotion/apply_animation_spec + synth params"
```

---

## Task 5: Agent — preflight_check 节点

**Files:**
- Create: `agent/app/nodes/knowledge_video/__init__.py`（空文件）
- Create: `agent/app/nodes/knowledge_video/preflight.py`
- Test: `agent/tests/test_kv_preflight.py`

- [ ] **Step 1: 写失败测试**

`agent/tests/test_kv_preflight.py`:

```python
"""Tests for the kv preflight_check node."""
import pytest

from app.nodes.knowledge_video.preflight import preflight_check_node


class _FakeBackend:
    def __init__(self, project):
        self._project = project

    async def get_project(self, pid):
        return self._project


class _FakeRuntime:
    def __init__(self, backend):
        self.store = None
        self.backend = backend


def _patch_common(monkeypatch, decision=None):
    monkeypatch.setattr(
        "app.nodes.knowledge_video.preflight.get_stream_writer", lambda: (lambda p: None)
    )
    if decision is not None:
        monkeypatch.setattr(
            "app.nodes.knowledge_video.preflight.interrupt", lambda payload: decision
        )


EMPTY_PROJECT = {"source_document": "# 标题\n内容", "chapters": []}

EXISTING_PROJECT = {
    "source_document": "# 标题\n内容",
    "chapters": [
        {
            "id": "c1",
            "segments": [
                {"id": "s1", "audio": {"current": {"path": "a/b.mp3"}}, "animation_spec": {"x": 1}},
                {"id": "s2", "audio": {}},
            ],
        }
    ],
}


@pytest.mark.asyncio
async def test_empty_project_proceeds_without_interrupt(monkeypatch):
    _patch_common(monkeypatch)
    result = await preflight_check_node(
        {"project_id": "p1"}, _FakeRuntime(_FakeBackend(EMPTY_PROJECT))
    )
    assert result["current_stage"] == "gen_narration"
    assert result["source_document"] == "# 标题\n内容"
    assert result["error"] is None


@pytest.mark.asyncio
async def test_existing_content_confirm_continues(monkeypatch):
    _patch_common(monkeypatch, decision={"action": "confirm"})
    result = await preflight_check_node(
        {"project_id": "p1"}, _FakeRuntime(_FakeBackend(EXISTING_PROJECT))
    )
    assert result["current_stage"] == "gen_narration"
    assert result["error"] is None


@pytest.mark.asyncio
async def test_existing_content_cancel_stops(monkeypatch):
    _patch_common(monkeypatch, decision={"action": "cancel"})
    result = await preflight_check_node(
        {"project_id": "p1"}, _FakeRuntime(_FakeBackend(EXISTING_PROJECT))
    )
    assert result["error"] is not None
    assert result["current_stage"] == "preflight_check"


@pytest.mark.asyncio
async def test_missing_source_document_errors(monkeypatch):
    _patch_common(monkeypatch)
    project = {"source_document": "", "chapters": []}
    result = await preflight_check_node(
        {"project_id": "p1"}, _FakeRuntime(_FakeBackend(project))
    )
    assert "源文档" in result["error"]


@pytest.mark.asyncio
async def test_interrupt_payload_contains_stats(monkeypatch):
    seen = {}

    def fake_interrupt(payload):
        seen["payload"] = payload
        return {"action": "cancel"}

    _patch_common(monkeypatch)
    monkeypatch.setattr("app.nodes.knowledge_video.preflight.interrupt", fake_interrupt)
    await preflight_check_node({"project_id": "p1"}, _FakeRuntime(_FakeBackend(EXISTING_PROJECT)))
    payload = seen["payload"]
    assert payload["kind"] == "confirm_overwrite"
    assert payload["available_actions"] == ["confirm", "cancel"]
    assert payload["stats"]["chapters"] == 1
    assert payload["stats"]["segments"] == 2
    assert payload["stats"]["synthesized_segments"] == 1
    assert payload["stats"]["has_animation_brief"] is True
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd agent && uv run --extra test pytest tests/test_kv_preflight.py -q`
Expected: FAIL（`ModuleNotFoundError: app.nodes.knowledge_video`）

- [ ] **Step 3: 实现节点**

`agent/app/nodes/knowledge_video/__init__.py`：空文件。

`agent/app/nodes/knowledge_video/preflight.py`:

```python
"""PreflightCheck node (knowledge_video): confirm before overwriting content.

Fetches the project; if it already has chapters / synthesized audio /
animation briefs, interrupts with stats so the user can confirm the rebuild
or cancel without side effects.
"""
from __future__ import annotations

from langgraph.config import get_stream_writer
from langgraph.types import interrupt

from app import backend_client


async def preflight_check_node(state, runtime) -> dict:
    project_id = state["project_id"]
    writer = get_stream_writer()

    backend = getattr(runtime, "backend", None) or backend_client.BackendClient()
    try:
        project = await backend.get_project(project_id)
    except Exception as exc:
        writer({"type": "error", "stage": "preflight_check", "message": f"获取项目失败: {exc}"})
        return {"error": f"获取项目失败: {exc}", "current_stage": "preflight_check"}

    source_document = project.get("source_document") or ""
    if not source_document.strip():
        writer({"type": "error", "stage": "preflight_check", "message": "项目没有源文档"})
        return {
            "error": "项目没有源文档，请先在文本库添加源文档",
            "current_stage": "preflight_check",
        }

    chapters = project.get("chapters") or []
    total_segments = 0
    synthesized = 0
    has_brief = False
    for ch in chapters:
        for seg in ch.get("segments") or []:
            total_segments += 1
            audio = seg.get("audio") or {}
            if isinstance(audio, dict) and (audio.get("current") or {}).get("path"):
                synthesized += 1
            if seg.get("animation_spec"):
                has_brief = True

    if not chapters:
        writer(
            {"type": "stage_complete", "stage": "preflight_check", "message": "项目无已有内容，直接开始"}
        )
        return {
            "source_document": source_document,
            "current_stage": "gen_narration",
            "error": None,
        }

    stats = {
        "chapters": len(chapters),
        "segments": total_segments,
        "synthesized_segments": synthesized,
        "has_animation_brief": has_brief,
    }
    writer(
        {
            "type": "interrupt",
            "stage": "preflight_check",
            "message": f"项目已有 {stats['chapters']} 章节 / {synthesized} 段已合成音频，等待确认...",
            "data": stats,
        }
    )
    decision = interrupt(
        {
            "kind": "confirm_overwrite",
            "stats": stats,
            "available_actions": ["confirm", "cancel"],
        }
    )

    if decision.get("action") == "confirm":
        return {
            "source_document": source_document,
            "current_stage": "gen_narration",
            "error": None,
        }
    return {"error": "用户取消：保留已有内容", "current_stage": "preflight_check"}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd agent && uv run --extra test pytest tests/test_kv_preflight.py -q`
Expected: 5 PASS

- [ ] **Step 5: Commit**

```bash
git add agent/app/nodes/knowledge_video/__init__.py agent/app/nodes/knowledge_video/preflight.py agent/tests/test_kv_preflight.py
git commit -m "feat(agent): kv preflight_check node with overwrite confirm interrupt"
```

---

## Task 6: Agent — gen_narration 节点

**Files:**
- Create: `agent/app/nodes/knowledge_video/gen_narration.py`
- Test: `agent/tests/test_kv_gen_narration.py`

- [ ] **Step 1: 写失败测试**

`agent/tests/test_kv_gen_narration.py`:

```python
"""Tests for the kv gen_narration node."""
import pytest

from app.nodes.knowledge_video.gen_narration import gen_narration_node


class _FakeRuntime:
    store = None
    backend = None


def _patch(monkeypatch, script: str):
    monkeypatch.setattr(
        "app.nodes.knowledge_video.gen_narration.get_stream_writer", lambda: (lambda p: None)
    )

    async def fake_stream_llm(messages, on_chunk=None):
        return script

    monkeypatch.setattr("app.nodes.knowledge_video.gen_narration.stream_llm", fake_stream_llm)
    monkeypatch.setattr(
        "app.nodes.knowledge_video.gen_narration.knowledge_video.get_prompt",
        lambda name, **kw: "PROMPT",
    )


DOC = "# 第一章\n\n```\ncode here\n```\n\n![图](a.png)\n"
SCRIPT = "# 第一章\n\n转写后的旁白内容。\n"


@pytest.mark.asyncio
async def test_generates_script_and_source_map(monkeypatch):
    _patch(monkeypatch, SCRIPT)
    state = {"project_id": "p1", "source_document": DOC, "current_stage": "gen_narration"}
    result = await gen_narration_node(state, _FakeRuntime())

    assert result["narration_script"] == SCRIPT
    assert result["current_stage"] == "quality_review"
    assert result["error"] is None
    assert result["script_chapters"][0]["title"] == "第一章"
    kinds = {e["kind"] for e in result["source_structure_map"]}
    assert kinds == {"code", "image"}


@pytest.mark.asyncio
async def test_reject_feedback_is_included_in_prompt(monkeypatch):
    _patch(monkeypatch, SCRIPT)
    seen = {}

    async def fake_stream_llm(messages, on_chunk=None):
        seen["user"] = messages[1]["content"]
        return SCRIPT

    monkeypatch.setattr("app.nodes.knowledge_video.gen_narration.stream_llm", fake_stream_llm)
    state = {
        "project_id": "p1",
        "source_document": DOC,
        "review_status": "rejected",
        "review_result": {"passed": False, "dimensions": [], "issues": ["第二章缺失"]},
    }
    await gen_narration_node(state, _FakeRuntime())
    assert "第二章缺失" in seen["user"]


@pytest.mark.asyncio
async def test_empty_script_is_error(monkeypatch):
    _patch(monkeypatch, "  ")
    state = {"project_id": "p1", "source_document": DOC}
    result = await gen_narration_node(state, _FakeRuntime())
    assert result["error"] is not None
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd agent && uv run --extra test pytest tests/test_kv_gen_narration.py -q`
Expected: FAIL（`ModuleNotFoundError`）

- [ ] **Step 3: 实现节点**

`agent/app/nodes/knowledge_video/gen_narration.py`:

```python
"""GenNarration node (knowledge_video): faithful markdown-strip rewrite.

Unlike narration's gen_script (creative rewrite), this prompt demands strict
fidelity to the source document: strip markdown, keep facts/order untouched.
Also records a deterministic map of code blocks / image refs for the
animation-brief node downstream.
"""
from __future__ import annotations

from langgraph.config import get_stream_writer

from app import backend_client
from app.llm import stream_llm
from app.nodes.gen_script import parse_markdown_chapters
from app.prompts import knowledge_video
from app.source_elements import extract_source_elements


async def gen_narration_node(state, runtime) -> dict:
    project_id = state["project_id"]
    writer = get_stream_writer()

    async def emit(payload):
        writer(payload)

    await emit(
        {"type": "stage_start", "stage": "gen_narration", "message": "开始生成旁白稿..."}
    )

    source_document = state.get("source_document") or ""
    if not source_document:
        backend = getattr(runtime, "backend", None) or backend_client.BackendClient()
        try:
            project = await backend.get_project(project_id)
            source_document = project.get("source_document") or ""
        except Exception as exc:
            await emit(
                {"type": "error", "stage": "gen_narration", "message": f"获取源文档失败: {exc}"}
            )
            return {"error": f"获取源文档失败: {exc}", "current_stage": "quality_review"}

    source_structure_map = extract_source_elements(source_document)

    # On a reject-regenerate loop, feed the issues back into the prompt.
    feedback_context = ""
    review = state.get("review_result") or {}
    issues = review.get("issues") or []
    if issues and state.get("review_status") == "rejected":
        feedback_context = "\n\n## 上次审查未通过的问题（请修正）\n" + "\n".join(
            f"- {i}" for i in issues
        )

    await emit(
        {
            "type": "llm_call",
            "stage": "gen_narration",
            "message": f"正在调用 LLM 转写旁白 (文档长度: {len(source_document)} 字)...",
            "data": {"doc_len": len(source_document)},
        }
    )

    chunk_count = 0
    acc_len = 0

    async def on_chunk(chunk: str):
        nonlocal chunk_count, acc_len
        chunk_count += 1
        acc_len += len(chunk)
        if chunk_count % 10 == 0:
            await emit(
                {
                    "type": "llm_streaming",
                    "stage": "gen_narration",
                    "message": f"正在生成旁白稿... ({acc_len} 字)",
                    "data": {"total_length": acc_len},
                }
            )

    script = await stream_llm(
        [
            {"role": "system", "content": knowledge_video.get_prompt("kv_gen_narration")},
            {
                "role": "user",
                "content": f"请将以下文档转写为视频旁白稿：\n\n{source_document}{feedback_context}",
            },
        ],
        on_chunk=on_chunk,
    )

    if not script or not script.strip():
        await emit({"type": "error", "stage": "gen_narration", "message": "LLM 返回了空旁白稿"})
        return {"error": "LLM 返回了空旁白稿，请重试", "current_stage": "quality_review"}

    chapters = parse_markdown_chapters(script)
    await emit(
        {
            "type": "llm_response",
            "stage": "gen_narration",
            "message": f"旁白稿生成完成: {len(chapters)} 章节, {len(script)} 字",
            "data": {"chapters_count": len(chapters), "script_length": len(script)},
        }
    )
    await emit(
        {"type": "stage_complete", "stage": "gen_narration", "message": "旁白稿生成阶段完成"}
    )

    return {
        "source_document": source_document,
        "source_structure_map": source_structure_map,
        "narration_script": script,
        "script_chapters": chapters,
        "current_stage": "quality_review",
        "error": None,
    }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd agent && uv run --extra test pytest tests/test_kv_gen_narration.py -q`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add agent/app/nodes/knowledge_video/gen_narration.py agent/tests/test_kv_gen_narration.py
git commit -m "feat(agent): kv gen_narration node (faithful rewrite + source map)"
```

---

## Task 7: Agent — quality_review 节点

**Files:**
- Create: `agent/app/nodes/knowledge_video/quality_review.py`
- Test: `agent/tests/test_kv_quality_review.py`

- [ ] **Step 1: 写失败测试**

`agent/tests/test_kv_quality_review.py`:

```python
"""Tests for the kv quality_review node."""
import pytest

from app.nodes.knowledge_video.quality_review import quality_review_node
from app.schemas import QualityReviewResult


class _FakeRuntime:
    store = None
    backend = None


PASS_REVIEW = QualityReviewResult(
    passed=True,
    dimensions=[{"name": "fidelity", "passed": True, "comment": "ok"}],
    issues=[],
)
FAIL_REVIEW = QualityReviewResult(
    passed=False,
    dimensions=[{"name": "markdown_residue", "passed": False, "comment": "残留 ```"}],
    issues=["第二章残留代码围栏"],
)


def _patch(monkeypatch, review, decision):
    monkeypatch.setattr(
        "app.nodes.knowledge_video.quality_review.get_stream_writer", lambda: (lambda p: None)
    )
    client = type("C", (), {})

    async def fake_create(**kw):
        return review

    client.create = fake_create
    monkeypatch.setattr(
        "app.nodes.knowledge_video.quality_review.get_instructor_client",
        lambda: (client, "m"),
    )
    monkeypatch.setattr(
        "app.nodes.knowledge_video.quality_review.knowledge_video.get_prompt",
        lambda name, **kw: "PROMPT",
    )
    monkeypatch.setattr(
        "app.nodes.knowledge_video.quality_review.interrupt", lambda payload: decision
    )


STATE = {
    "project_id": "p1",
    "source_document": "原文",
    "narration_script": "旁白稿",
    "current_stage": "quality_review",
}


@pytest.mark.asyncio
async def test_passing_review_still_interrupts_and_approve_goes_to_split(monkeypatch):
    """审查通过也必须人工确认。"""
    _patch(monkeypatch, PASS_REVIEW, {"action": "approve"})
    result = await quality_review_node(STATE, _FakeRuntime())
    assert result["review_status"] == "approved"
    assert result["current_stage"] == "split_chapters"
    assert result["edited_script"] == "旁白稿"


@pytest.mark.asyncio
async def test_approve_with_edited_script(monkeypatch):
    _patch(monkeypatch, PASS_REVIEW, {"action": "approve", "edited_script": "改过的稿子"})
    result = await quality_review_node(STATE, _FakeRuntime())
    assert result["edited_script"] == "改过的稿子"


@pytest.mark.asyncio
async def test_failed_review_reject_loops_back_with_feedback(monkeypatch):
    _patch(monkeypatch, FAIL_REVIEW, {"action": "reject", "feedback": "请去掉所有残留标记"})
    result = await quality_review_node(STATE, _FakeRuntime())
    assert result["review_status"] == "rejected"
    assert result["current_stage"] == "gen_narration"
    assert "请去掉所有残留标记" in result["review_result"]["issues"]
    assert result["review_retry_count"] == 1


@pytest.mark.asyncio
async def test_interrupt_payload_has_script_review_actions(monkeypatch):
    seen = {}
    _patch(monkeypatch, FAIL_REVIEW, {"action": "approve"})
    monkeypatch.setattr(
        "app.nodes.knowledge_video.quality_review.interrupt",
        lambda payload: seen.setdefault("payload", payload) or {"action": "approve"},
    )
    await quality_review_node(STATE, _FakeRuntime())
    payload = seen["payload"]
    assert payload["script"] == "旁白稿"
    assert payload["review"]["passed"] is False
    assert payload["available_actions"] == ["approve", "reject"]
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd agent && uv run --extra test pytest tests/test_kv_quality_review.py -q`
Expected: FAIL（`ModuleNotFoundError`）

- [ ] **Step 3: 实现节点**

`agent/app/nodes/knowledge_video/quality_review.py`:

```python
"""QualityReview node (knowledge_video): auto check + always-interrupt gate.

The LLM checks markdown residue / fidelity / chapter split / readability,
then the node ALWAYS interrupts for human confirmation of the narration
script (the review result rides along in the payload). Reject loops back to
gen_narration with the issues as feedback.
"""
from __future__ import annotations

from langgraph.config import get_stream_writer
from langgraph.types import interrupt

from app.llm import get_instructor_client
from app.prompts import knowledge_video
from app.schemas import QualityReviewResult


async def quality_review_node(state, runtime) -> dict:
    writer = get_stream_writer()

    async def emit(p):
        writer(p)

    await emit(
        {"type": "stage_start", "stage": "quality_review", "message": "开始基础质量审查..."}
    )

    client, model = get_instructor_client()
    review: QualityReviewResult = await client.create(
        response_model=QualityReviewResult,
        model=model,
        max_retries=2,
        messages=[
            {"role": "system", "content": knowledge_video.get_prompt("kv_quality_review")},
            {
                "role": "user",
                "content": (
                    f"原始文档：\n\n{state['source_document']}\n\n---\n\n"
                    f"请审查以下旁白稿：\n\n{state['narration_script']}"
                ),
            },
        ],
    )

    status_msg = "审查通过" if review.passed else f"审查发现 {len(review.issues)} 个问题"
    await emit(
        {
            "type": "interrupt",
            "stage": "quality_review",
            "message": f"{status_msg}，等待人工确认旁白稿...",
            "data": {"review": review.model_dump()},
        }
    )

    decision = interrupt(
        {
            "script": state["narration_script"],
            "review": review.model_dump(),
            "available_actions": ["approve", "reject"],
        }
    )

    if decision.get("action") == "approve":
        return {
            "edited_script": decision.get("edited_script", state["narration_script"]),
            "review_result": review.model_dump(),
            "review_status": "approved",
            "current_stage": "split_chapters",
            "error": None,
        }

    dumped = review.model_dump()
    feedback = decision.get("feedback", "")
    if feedback:
        dumped["issues"] = (dumped.get("issues") or []) + [feedback]
    return {
        "review_result": dumped,
        "review_status": "rejected",
        "current_stage": "gen_narration",
        "review_retry_count": state.get("review_retry_count", 0) + 1,
        "error": None,
    }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd agent && uv run --extra test pytest tests/test_kv_quality_review.py -q`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add agent/app/nodes/knowledge_video/quality_review.py agent/tests/test_kv_quality_review.py
git commit -m "feat(agent): kv quality_review node (auto check + human gate)"
```

---

## Task 8: Agent — split_chapters 节点

**Files:**
- Create: `agent/app/nodes/knowledge_video/split_chapters.py`
- Test: `agent/tests/test_kv_split_chapters.py`

- [ ] **Step 1: 写失败测试**

`agent/tests/test_kv_split_chapters.py`:

```python
"""Tests for the kv split_chapters node."""
import pytest

from app.nodes.knowledge_video.split_chapters import split_chapters_node
from app.schemas import (
    ChapterStructure,
    ChapterWithSegmentIds,
    Segment,
    SegmentChapters,
    SegmentWithId,
)


class _FakeBackend:
    def __init__(self, ids):
        self._ids = ids
        self.calls = []

    async def batch_create_structure(self, pid, structure):
        self.calls.append((pid, structure))
        return self._ids


class _FakeRuntime:
    def __init__(self, backend):
        self.store = None
        self.backend = backend


def _patch(monkeypatch, structure):
    monkeypatch.setattr(
        "app.nodes.knowledge_video.split_chapters.get_stream_writer", lambda: (lambda p: None)
    )
    client = type("C", (), {})

    async def fake_create(**kw):
        return structure

    client.create = fake_create
    monkeypatch.setattr(
        "app.nodes.knowledge_video.split_chapters.get_instructor_client",
        lambda: (client, "m"),
    )
    monkeypatch.setattr(
        "app.nodes.knowledge_video.split_chapters.knowledge_video.get_prompt",
        lambda name, **kw: "PROMPT",
    )


@pytest.mark.asyncio
async def test_split_uses_edited_script_and_backfills_ids(monkeypatch):
    structure = SegmentChapters(
        chapters=[ChapterStructure(chapter_title="c", segments=[Segment(text="t")])]
    )
    _patch(monkeypatch, structure)
    backend = _FakeBackend([ChapterWithSegmentIds(id="ch1", segments=[SegmentWithId(id="s1")])])
    state = {
        "project_id": "p1",
        "narration_script": "原始稿",
        "edited_script": "确认稿",
        "current_stage": "split_chapters",
    }
    result = await split_chapters_node(state, _FakeRuntime(backend))

    assert result["current_stage"] == "synthesis"
    assert result["error"] is None
    assert result["structured_segments"][0]["_chapter_id"] == "ch1"
    assert result["structured_segments"][0]["segments"][0]["_segment_id"] == "s1"
    # LLM 收到的应该是 edited_script
    sent = backend.calls[0][1]
    assert sent.chapters[0].chapter_title == "c"


@pytest.mark.asyncio
async def test_backend_failure_is_soft_error(monkeypatch):
    structure = SegmentChapters(
        chapters=[ChapterStructure(chapter_title="c", segments=[Segment(text="t")])]
    )
    _patch(monkeypatch, structure)

    class _BadBackend:
        async def batch_create_structure(self, pid, structure):
            raise RuntimeError("backend down")

    state = {"project_id": "p1", "narration_script": "s", "current_stage": "split_chapters"}
    result = await split_chapters_node(state, _FakeRuntime(_BadBackend()))
    assert result["error"] is not None
    assert result["structured_segments"] == []
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd agent && uv run --extra test pytest tests/test_kv_split_chapters.py -q`
Expected: FAIL（`ModuleNotFoundError`）

- [ ] **Step 3: 实现节点**

`agent/app/nodes/knowledge_video/split_chapters.py`:

```python
"""SplitChapters node (knowledge_video): split confirmed script, persist.

Mirrors narration's split_segment node but uses the kv prompt (all segments
are plain narration) and no director-preference lookup.
"""
from __future__ import annotations

from langgraph.config import get_stream_writer

from app import backend_client
from app.llm import get_instructor_client
from app.prompts import knowledge_video
from app.schemas import SegmentChapters


async def split_chapters_node(state, runtime) -> dict:
    project_id = state["project_id"]
    writer = get_stream_writer()

    async def emit(p):
        writer(p)

    await emit(
        {"type": "stage_start", "stage": "split_chapters", "message": "开始章节拆分..."}
    )

    script = state.get("edited_script") or state["narration_script"]
    await emit(
        {
            "type": "llm_call",
            "stage": "split_chapters",
            "message": f"正在调用 LLM 拆分段落 (脚本长度: {len(script)} 字)...",
        }
    )

    client, model = get_instructor_client()
    structure: SegmentChapters = await client.create(
        response_model=SegmentChapters,
        model=model,
        max_retries=2,
        messages=[
            {"role": "system", "content": knowledge_video.get_prompt("kv_split_chapters")},
            {"role": "user", "content": f"请将以下旁白稿拆分为结构化段落：\n\n{script}"},
        ],
    )

    backend = getattr(runtime, "backend", None) or backend_client.BackendClient()
    try:
        ids = await backend.batch_create_structure(project_id, structure)
    except Exception as exc:
        await emit({"type": "error", "stage": "split_chapters", "message": f"持久化失败: {exc}"})
        return {
            "structured_segments": [],
            "current_stage": "synthesis",
            "error": f"持久化失败: {exc}",
        }

    structured = []
    for ch, ch_ids in zip(structure.chapters, ids):
        ch_dict = ch.model_dump()
        ch_dict["_chapter_id"] = ch_ids.id
        for seg, seg_id in zip(ch_dict["segments"], ch_ids.segments):
            seg["_segment_id"] = seg_id.id
        structured.append(ch_dict)

    total = sum(len(ch["segments"]) for ch in structured)
    await emit(
        {
            "type": "llm_response",
            "stage": "split_chapters",
            "message": f"拆分完成: {len(structured)} 章节, {total} 段落",
            "data": {"chapters_count": len(structured), "segments_count": total},
        }
    )
    await emit(
        {"type": "stage_complete", "stage": "split_chapters", "message": "章节拆分阶段完成"}
    )

    return {"structured_segments": structured, "current_stage": "synthesis", "error": None}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd agent && uv run --extra test pytest tests/test_kv_split_chapters.py -q`
Expected: 2 PASS

- [ ] **Step 5: Commit**

```bash
git add agent/app/nodes/knowledge_video/split_chapters.py agent/tests/test_kv_split_chapters.py
git commit -m "feat(agent): kv split_chapters node"
```

---

## Task 9: Agent — synthesis 节点（edge-tts 默认音色）

**Files:**
- Create: `agent/app/nodes/knowledge_video/synthesis.py`
- Test: `agent/tests/test_kv_synthesis.py`

- [ ] **Step 1: 写失败测试**

`agent/tests/test_kv_synthesis.py`:

```python
"""Tests for the kv synthesis node."""
import pytest

from app.nodes.knowledge_video.synthesis import DEFAULT_EDGE_VOICE, kv_synthesis_node


class _FakeBackend:
    def __init__(self):
        self.calls = []

    async def synthesize_segment(self, pid, cid, sid, params=None):
        self.calls.append({"pid": pid, "cid": cid, "sid": sid, "params": params})


class _FakeRuntime:
    def __init__(self, backend):
        self.store = None
        self.backend = backend


STRUCTURED = [
    {
        "chapter_title": "第一章",
        "_chapter_id": "c1",
        "segments": [
            {"text": "a", "_segment_id": "s1"},
            {"text": "b", "_segment_id": "s2"},
        ],
    }
]


def _patch_writer(monkeypatch):
    monkeypatch.setattr(
        "app.nodes.knowledge_video.synthesis.get_stream_writer", lambda: (lambda p: None)
    )


@pytest.mark.asyncio
async def test_synthesizes_each_segment_with_default_edge_voice(monkeypatch):
    _patch_writer(monkeypatch)
    backend = _FakeBackend()
    state = {"project_id": "p1", "structured_segments": STRUCTURED}
    result = await kv_synthesis_node(state, _FakeRuntime(backend))

    assert len(backend.calls) == 2
    for call in backend.calls:
        assert call["params"] == {"engine": "edge_tts", "edge_voice": DEFAULT_EDGE_VOICE}
    assert result["current_stage"] == "scaffold_remotion"
    assert len(result["synthesis_results"]) == 2
    assert result["error"] is None


@pytest.mark.asyncio
async def test_empty_structure_skips(monkeypatch):
    _patch_writer(monkeypatch)
    backend = _FakeBackend()
    result = await kv_synthesis_node(
        {"project_id": "p1", "structured_segments": []}, _FakeRuntime(backend)
    )
    assert backend.calls == []
    assert result["current_stage"] == "scaffold_remotion"


@pytest.mark.asyncio
async def test_segment_failure_continues_others(monkeypatch):
    _patch_writer(monkeypatch)

    class _FlakyBackend(_FakeBackend):
        async def synthesize_segment(self, pid, cid, sid, params=None):
            if sid == "s1":
                raise RuntimeError("tts boom")
            await super().synthesize_segment(pid, cid, sid, params=params)

    backend = _FlakyBackend()
    state = {"project_id": "p1", "structured_segments": STRUCTURED}
    result = await kv_synthesis_node(state, _FakeRuntime(backend))
    assert len(result["synthesis_results"]) == 1
    assert result["synthesis_results"][0]["segment_id"] == "s2"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd agent && uv run --extra test pytest tests/test_kv_synthesis.py -q`
Expected: FAIL（`ModuleNotFoundError`）

- [ ] **Step 3: 实现节点**

`agent/app/nodes/knowledge_video/synthesis.py`:

```python
"""Synthesis node (knowledge_video): edge-tts default voice per segment.

The kv workflow always uses the default edge-tts voice for now; a
project-level default voice setting is a later iteration (see spec §10).
"""
from __future__ import annotations

from langgraph.config import get_stream_writer

from app import backend_client

DEFAULT_EDGE_VOICE = "zh-CN-XiaoxiaoNeural"


async def kv_synthesis_node(state, runtime) -> dict:
    project_id = state["project_id"]
    structured = state.get("structured_segments", [])
    writer = get_stream_writer()

    async def emit(p):
        writer(p)

    if not structured:
        await emit(
            {
                "type": "stage_complete",
                "stage": "synthesis",
                "message": "无段落数据，跳过语音合成",
            }
        )
        return {"synthesis_results": [], "current_stage": "scaffold_remotion", "error": None}

    total = sum(len(ch.get("segments", [])) for ch in structured)
    await emit(
        {
            "type": "stage_start",
            "stage": "synthesis",
            "message": f"开始语音合成 (edge-tts {DEFAULT_EDGE_VOICE}): {total} 段落...",
        }
    )

    backend = getattr(runtime, "backend", None) or backend_client.BackendClient()
    params = {"engine": "edge_tts", "edge_voice": DEFAULT_EDGE_VOICE}
    results = []
    done = 0
    for ch in structured:
        cid = ch.get("_chapter_id")
        if not cid:
            continue
        for seg in ch.get("segments", []):
            sid = seg.get("_segment_id")
            if not sid:
                continue
            try:
                await backend.synthesize_segment(project_id, cid, sid, params=params)
                results.append(
                    {
                        "chapter_id": cid,
                        "segment_id": sid,
                        "audio_path": None,
                        "duration_sec": None,
                    }
                )
            except Exception as exc:
                await emit(
                    {
                        "type": "error",
                        "stage": "synthesis",
                        "message": f"段落 {sid} 合成失败: {exc}",
                    }
                )
            done += 1
            await emit(
                {
                    "type": "progress",
                    "stage": "synthesis",
                    "message": f"语音合成进度: {done}/{total}",
                    "data": {"completed": done, "total": total},
                }
            )

    await emit(
        {
            "type": "stage_complete",
            "stage": "synthesis",
            "message": f"语音合成完成: {len(results)} 段落",
            "data": {"total_segments": len(results)},
        }
    )
    return {
        "synthesis_results": results,
        "current_stage": "scaffold_remotion",
        "error": None,
    }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd agent && uv run --extra test pytest tests/test_kv_synthesis.py -q`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add agent/app/nodes/knowledge_video/synthesis.py agent/tests/test_kv_synthesis.py
git commit -m "feat(agent): kv synthesis node with default edge-tts voice"
```

---

## Task 10: Backend — srt_service 字幕生成

**Files:**
- Create: `backend/app/services/srt_service.py`
- Test: `backend/tests/test_srt_service.py`

- [ ] **Step 1: 写失败测试**

`backend/tests/test_srt_service.py`:

```python
from app.services.srt_service import build_srt


def test_build_srt_accumulates_timestamps():
    segments = [
        {"text": "第一段", "duration_sec": 2.5},
        {"text": "第二段", "duration_sec": 1.5},
    ]
    srt = build_srt(segments)
    blocks = srt.strip().split("\n\n")
    assert blocks[0] == "1\n00:00:00,000 --> 00:00:02,500\n第一段"
    assert blocks[1] == "2\n00:00:02,500 --> 00:00:04,000\n第二段"


def test_build_srt_with_offset():
    segments = [{"text": "x", "duration_sec": 1.0}]
    srt = build_srt(segments, offset_sec=3.0)
    assert "00:00:03,000 --> 00:00:04,000" in srt


def test_build_srt_missing_duration_treated_as_zero():
    segments = [{"text": "a"}, {"text": "b", "duration_sec": 1.0}]
    srt = build_srt(segments)
    assert "00:00:00,000 --> 00:00:00,000" in srt
    assert "00:00:00,000 --> 00:00:01,000" in srt


def test_build_srt_hours_and_millis():
    segments = [{"text": "x", "duration_sec": 3661.007}]
    srt = build_srt(segments)
    assert "00:00:00,000 --> 01:01:01,007" in srt
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && uv run --extra test pytest tests/test_srt_service.py -q`
Expected: FAIL（`ModuleNotFoundError: app.services.srt_service`）

- [ ] **Step 3: 实现 srt_service**

`backend/app/services/srt_service.py`:

```python
"""SRT subtitle generation from segment durations.

Timeline logic mirrors the frontend's ``buildSRTContent`` (audioConcat.ts):
timestamps are computed by accumulating each segment's ``duration_sec``.
"""
from __future__ import annotations


def _fmt_timestamp(seconds: float) -> str:
    ms_total = round(seconds * 1000)
    h, rem = divmod(ms_total, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def build_srt(segments: list[dict], *, offset_sec: float = 0.0) -> str:
    """Build SRT content from ordered ``[{text, duration_sec}]`` entries."""
    blocks: list[str] = []
    cursor = offset_sec
    for i, seg in enumerate(segments, start=1):
        duration = float(seg.get("duration_sec") or 0.0)
        start = cursor
        end = cursor + duration
        text = (seg.get("text") or "").strip()
        blocks.append(f"{i}\n{_fmt_timestamp(start)} --> {_fmt_timestamp(end)}\n{text}")
        cursor = end
    return "\n\n".join(blocks) + "\n"
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && uv run --extra test pytest tests/test_srt_service.py -q`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/srt_service.py backend/tests/test_srt_service.py
git commit -m "feat(backend): srt generation service from segment durations"
```

---

## Task 11: Backend — apply_animation_spec 支持任意字段合并

**Files:**
- Modify: `backend/app/services/segmented_project_service.py`（`apply_animation_spec` 的合并循环，423-436 行附近）
- Test: `backend/tests/test_animation_spec_api.py`（追加一个用例）

背景：kv 的 brief 字段（`narration_text` / `visual_content` / `animation` / `start_sec` 等）不在现有白名单（`visual_concept, layout, mood, phases, animations, elements, emphasis, asset_refs, notes`）内，现有合并逻辑会丢弃它们。改为合并除 `segment_id` 外的所有非 None 字段——对旧调用方完全兼容（旧字段仍会合并）。

- [ ] **Step 1: 写失败测试**

`backend/tests/test_animation_spec_api.py` 文件末尾追加：

```python
def test_apply_animation_spec_merges_arbitrary_brief_fields(client, db_session):
    """kv workflow brief fields (visual_content/animation/start_sec...) must be kept."""
    from app.models.segmented_project import (
        SegmentedProject,
        SegmentedProjectChapter,
        SegmentedProjectSegment,
    )

    project = SegmentedProject(id="kv-proj", name="kv", schema_version=2)
    chapter = SegmentedProjectChapter(id="kv-ch", project_id="kv-proj", position=0, name="c")
    segment = SegmentedProjectSegment(
        id="kv-seg", chapter_id="kv-ch", position=0, text="旁白", emotion="neutral"
    )
    db_session.add_all([project, chapter, segment])
    db_session.commit()

    resp = client.post(
        "/api/segmented-projects/kv-proj/apply-animation-spec",
        json={
            "theme": None,
            "segments": [
                {
                    "segment_id": "kv-seg",
                    "narration_text": "旁白",
                    "start_sec": 0.0,
                    "end_sec": 4.2,
                    "visual_content": {"type": "code", "description": "展示代码", "source_ref": None},
                    "animation": {"effect": "typewriter", "notes": "逐行"},
                }
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["segments_updated"] == 1

    detail = client.get("/api/segmented-projects/kv-proj").json()
    spec = detail["chapters"][0]["segments"][0]["animation_spec"]
    assert spec["visual_content"]["type"] == "code"
    assert spec["animation"]["effect"] == "typewriter"
    assert spec["start_sec"] == 0.0
    assert spec["narration_text"] == "旁白"
```

注意：该文件已有 `client` / `db_session` fixture（沿用文件内既有 fixture 名；若实际 fixture 名不同，以文件内现有测试使用的为准）。模型字段以 `backend/app/models/segmented_project.py` 为准。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && uv run --extra test pytest tests/test_animation_spec_api.py::test_apply_animation_spec_merges_arbitrary_brief_fields -q`
Expected: FAIL（`spec["visual_content"]` 为 KeyError/None——字段被白名单丢弃）

- [ ] **Step 3: 修改合并逻辑**

`backend/app/services/segmented_project_service.py` 的 `apply_animation_spec` 中，把：

```python
        # 合并: 只覆盖传入的非空字段, 保留未传的
        existing_raw = getattr(seg, "animation_spec_json", None)
        existing = _parse_animation_spec(existing_raw) or {}
        merged = dict(existing)
        for key in (
            "visual_concept", "layout", "mood",
            "phases", "animations", "elements",
            "emphasis", "asset_refs", "notes",
        ):
            v = it.get(key)
            if v is not None:
                merged[key] = v
```

改为：

```python
        # 合并: 覆盖传入的所有非 None 字段 (segment_id 除外), 保留未传的
        existing_raw = getattr(seg, "animation_spec_json", None)
        existing = _parse_animation_spec(existing_raw) or {}
        merged = dict(existing)
        for key, v in it.items():
            if key == "segment_id" or v is None:
                continue
            merged[key] = v
```

- [ ] **Step 4: 运行测试确认通过 + 回归**

Run: `cd backend && uv run --extra test pytest tests/test_animation_spec_api.py -q`
Expected: 全部 PASS（含既有用例回归）

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/segmented_project_service.py backend/tests/test_animation_spec_api.py
git commit -m "feat(backend): apply_animation_spec merges arbitrary brief fields"
```

---

## Task 12: Backend — remotion_scaffold_service + scaffold-remotion 端点

**Files:**
- Create: `backend/app/services/remotion_scaffold_service.py`
- Modify: `backend/app/api/segmented_projects.py`（追加端点）
- Test: `backend/tests/test_remotion_scaffold.py`

行为要点（对应规格 §3.5）：
- 目标目录已有 Remotion 工程（`package.json` 含 remotion 依赖）→ 跳过创建只刷新资产（幂等）；
- 否则执行 `npx create-video@latest --yes --blank .`（已验证非交互可用）；
- 每章节导出拼接 MP3 到 `public/audio/`（复用 `svc.export_chapter_audio_mp3`，文件名按章节标题）；
- 每章节生成 `public/subtitles/chapter_<position>.srt`；
- 写 `segment_manifest.json` + `AGENTS.md`；带 `animation_brief` 时写 `animation_brief.json`；
- `target_dir` 未传且项目未配置 `remotion_project_path` → 422。

- [ ] **Step 1: 写失败测试**

`backend/tests/test_remotion_scaffold.py`:

```python
"""Unit tests for remotion_scaffold_service (npx + audio export are mocked)."""
import json
from types import SimpleNamespace

import pytest

from app.services import remotion_scaffold_service as rss


class _Db:
    def commit(self):
        pass


def _project(remotion_path=None):
    seg = SimpleNamespace(
        id="s1",
        position=0,
        text="你好世界",
        audio={"current": {"path": "p/c1/s1.mp3", "duration_sec": 2.5}},
    )
    chapter = SimpleNamespace(
        id="c1", position=0, name="第一章", design_title=None, segments=[seg]
    )
    return SimpleNamespace(
        id="p1", name="demo", remotion_project_path=remotion_path, chapters=[chapter]
    )


def _patch_common(monkeypatch, project, exported_name="第一章.mp3"):
    monkeypatch.setattr(rss.svc, "get_project_row", lambda db, pid: project)
    monkeypatch.setattr(
        rss.svc,
        "export_chapter_audio_mp3",
        lambda db, pid, cid, export_directory: _FakePath(exported_name),
    )


class _FakePath:
    def __init__(self, name):
        self.name = name


def test_creates_project_when_missing(monkeypatch, tmp_path):
    project = _project()
    _patch_common(monkeypatch, project)
    calls = []

    class _Proc:
        returncode = 0
        stdout = ""
        stderr = ""

    def fake_run(cmd, **kw):
        calls.append(cmd)
        # simulate create-video writing package.json
        (tmp_path / "package.json").write_text(
            json.dumps({"dependencies": {"remotion": "^4.0.0"}})
        )
        return _Proc()

    monkeypatch.setattr(rss.subprocess, "run", fake_run)
    monkeypatch.setattr(rss.shutil, "which", lambda name: "/usr/bin/npx")

    result = rss.scaffold_remotion_project(_Db(), "p1", target_dir=str(tmp_path))

    assert result["created"] is True
    assert result["chapters"] == 1
    assert calls[0][:3] == ["npx", "create-video@latest", "--yes"]
    # assets refreshed
    manifest = json.loads((tmp_path / "segment_manifest.json").read_text())
    assert manifest["chapters"][0]["audio"] == "public/audio/第一章.mp3"
    assert manifest["chapters"][0]["subtitles"] == "public/subtitles/chapter_0.srt"
    assert manifest["chapters"][0]["duration_sec"] == 2.5
    srt = (tmp_path / "public/subtitles/chapter_0.srt").read_text()
    assert "00:00:00,000 --> 00:00:02,500" in srt
    assert (tmp_path / "AGENTS.md").exists()
    # path persisted on the project
    assert project.remotion_project_path == str(tmp_path)


def test_existing_project_skips_creation_and_refreshes(monkeypatch, tmp_path):
    (tmp_path / "package.json").write_text(
        json.dumps({"dependencies": {"remotion": "^4.0.0"}})
    )
    project = _project(remotion_path=str(tmp_path))
    _patch_common(monkeypatch, project)

    def boom(cmd, **kw):
        raise AssertionError("subprocess should not be called")

    monkeypatch.setattr(rss.subprocess, "run", boom)

    result = rss.scaffold_remotion_project(_Db(), "p1")
    assert result["created"] is False
    assert (tmp_path / "segment_manifest.json").exists()


def test_animation_brief_written(monkeypatch, tmp_path):
    (tmp_path / "package.json").write_text(
        json.dumps({"dependencies": {"remotion": "^4.0.0"}})
    )
    project = _project(remotion_path=str(tmp_path))
    _patch_common(monkeypatch, project)

    brief = {"chapters": [{"chapter_position": 0, "title": "第一章", "segments": []}]}
    rss.scaffold_remotion_project(_Db(), "p1", animation_brief=brief)
    written = json.loads((tmp_path / "animation_brief.json").read_text())
    assert written["chapters"][0]["title"] == "第一章"


def test_no_target_raises_value_error(monkeypatch):
    project = _project(remotion_path=None)
    monkeypatch.setattr(rss.svc, "get_project_row", lambda db, pid: project)
    with pytest.raises(ValueError, match="remotion_target_not_set"):
        rss.scaffold_remotion_project(_Db(), "p1")


def test_missing_npx_raises_runtime_error(monkeypatch, tmp_path):
    project = _project()
    _patch_common(monkeypatch, project)
    monkeypatch.setattr(rss.shutil, "which", lambda name: None)
    with pytest.raises(RuntimeError, match="npx_not_found"):
        rss.scaffold_remotion_project(_Db(), "p1", target_dir=str(tmp_path))


def test_create_video_failure_raises_with_stderr(monkeypatch, tmp_path):
    project = _project()
    _patch_common(monkeypatch, project)
    monkeypatch.setattr(rss.shutil, "which", lambda name: "/usr/bin/npx")

    class _Proc:
        returncode = 1
        stdout = ""
        stderr = "npm ERR! network timeout"

    monkeypatch.setattr(rss.subprocess, "run", lambda cmd, **kw: _Proc())
    with pytest.raises(RuntimeError, match="create_video_failed"):
        rss.scaffold_remotion_project(_Db(), "p1", target_dir=str(tmp_path))
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && uv run --extra test pytest tests/test_remotion_scaffold.py -q`
Expected: FAIL（`ModuleNotFoundError: app.services.remotion_scaffold_service`）

- [ ] **Step 3: 实现 service**

`backend/app/services/remotion_scaffold_service.py`:

```python
"""Remotion project scaffolding for the knowledge_video workflow.

Creates a blank Remotion project via ``npx create-video`` (skipped when the
target dir already holds one), then refreshes derived assets: per-chapter
concatenated audio, per-chapter SRT, ``segment_manifest.json`` and
``AGENTS.md``. Optionally writes ``animation_brief.json``. Idempotent.
"""
from __future__ import annotations

import json
import logging
import shutil
import subprocess
from pathlib import Path

from sqlalchemy.orm import Session

from app.services import segmented_project_service as svc
from app.services.srt_service import build_srt

logger = logging.getLogger(__name__)

CREATE_VIDEO_TIMEOUT_SEC = 600


def _is_remotion_project(root: Path) -> bool:
    pkg = root / "package.json"
    if not pkg.exists():
        return False
    try:
        data = json.loads(pkg.read_text(encoding="utf-8"))
    except Exception:
        return False
    deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
    return "remotion" in deps


def _create_remotion_project(root: Path) -> None:
    if shutil.which("npx") is None:
        raise RuntimeError("npx_not_found: 需要先在服务器上安装 Node.js")
    root.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        ["npx", "create-video@latest", "--yes", "--blank", "."],
        cwd=root,
        capture_output=True,
        text=True,
        timeout=CREATE_VIDEO_TIMEOUT_SEC,
    )
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "")[-500:]
        raise RuntimeError(f"create_video_failed: {tail}")


def _render_agents_md(project_name: str, chapters: list[dict]) -> str:
    lines = [
        f"# {project_name} — Remotion 工程",
        "",
        "本工程由 NarraForge knowledge_video 工作流生成。",
        "",
        "## 资产",
        "- `public/audio/` — 各章节旁白音频（MP3，按章节标题命名）",
        "- `public/subtitles/chapter_<position>.srt` — 各章节字幕",
        "- `segment_manifest.json` — 章节/资产清单（含时长）",
        "- `animation_brief.json` — 动画分镜 brief（每段旁白的呈现内容与动画效果）",
        "",
        "## 预览",
        "```bash",
        "npm install   # 首次",
        "npx remotion studio",
        "```",
        "",
        "## 章节",
    ]
    for ch in chapters:
        lines.append(f"- {ch['position']}. {ch['title']}（{ch['duration_sec']:.1f}s）")
    lines.append("")
    return "\n".join(lines)


def scaffold_remotion_project(
    db: Session,
    project_id: str,
    target_dir: str | None = None,
    animation_brief: dict | None = None,
) -> dict:
    project = svc.get_project_row(db, project_id)
    if project is None:
        raise LookupError("project_not_found")

    target = target_dir or getattr(project, "remotion_project_path", None)
    if not target:
        raise ValueError("remotion_target_not_set")
    root = Path(target).expanduser()

    created = False
    if _is_remotion_project(root):
        logger.info("remotion project exists at %s, refreshing assets only", root)
    else:
        _create_remotion_project(root)
        created = True

    if getattr(project, "remotion_project_path", None) != str(root):
        project.remotion_project_path = str(root)
        db.commit()

    chapters_manifest: list[dict] = []
    for ch in sorted(project.chapters, key=lambda c: c.position):
        segs = sorted(ch.segments, key=lambda s: s.position)
        seg_entries: list[dict] = []
        duration_total = 0.0
        for s in segs:
            audio = s.audio or {}
            dur = 0.0
            if isinstance(audio, dict):
                dur = float((audio.get("current") or {}).get("duration_sec") or 0.0)
            seg_entries.append({"text": s.text or "", "duration_sec": dur})
            duration_total += dur

        audio_rel = None
        if any(e["duration_sec"] > 0 for e in seg_entries):
            exported = svc.export_chapter_audio_mp3(db, project_id, ch.id, "public/audio")
            audio_rel = f"public/audio/{exported.name}"

        srt_rel = f"public/subtitles/chapter_{ch.position}.srt"
        srt_path = root / srt_rel
        srt_path.parent.mkdir(parents=True, exist_ok=True)
        srt_path.write_text(build_srt(seg_entries), encoding="utf-8")

        chapters_manifest.append(
            {
                "chapter_id": ch.id,
                "position": ch.position,
                "title": getattr(ch, "design_title", None) or ch.name,
                "audio": audio_rel,
                "subtitles": srt_rel,
                "duration_sec": round(duration_total, 3),
            }
        )

    manifest = {
        "project_id": project_id,
        "project_name": project.name,
        "chapters": chapters_manifest,
    }
    (root / "segment_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (root / "AGENTS.md").write_text(
        _render_agents_md(project.name, chapters_manifest), encoding="utf-8"
    )

    if animation_brief is not None:
        (root / "animation_brief.json").write_text(
            json.dumps(animation_brief, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    return {"project_dir": str(root), "created": created, "chapters": len(chapters_manifest)}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && uv run --extra test pytest tests/test_remotion_scaffold.py -q`
Expected: 6 PASS

- [ ] **Step 5: 加 API 端点**

`backend/app/api/segmented_projects.py`：在 `export_text_file_to_remotion` 端点（约 260-292 行）之后追加：

```python
class ScaffoldRemotionRequest(BaseModel):
    target_dir: str | None = None
    animation_brief: dict | None = None


@router.post("/segmented-projects/{project_id}/scaffold-remotion")
def scaffold_remotion(
    project_id: str,
    body: ScaffoldRemotionRequest,
    db: Session = Depends(get_db),
):
    """Create (or refresh) the Remotion project for the kv workflow.

    Idempotent: an existing Remotion project is kept, only derived assets
    (audio / subtitles / manifest / AGENTS.md / animation_brief.json) are
    refreshed.
    """
    from app.services import remotion_scaffold_service

    try:
        return remotion_scaffold_service.scaffold_remotion_project(
            db,
            project_id,
            target_dir=body.target_dir,
            animation_brief=body.animation_brief,
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="project_not_found")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
```

- [ ] **Step 6: 加一个端点层测试**

`backend/tests/test_remotion_scaffold.py` 文件末尾追加：

```python
def test_scaffold_endpoint_404_for_missing_project(client, monkeypatch):
    monkeypatch.setattr(
        rss.svc, "get_project_row", lambda db, pid: None
    )
    resp = client.post("/api/segmented-projects/nope/scaffold-remotion", json={})
    assert resp.status_code == 404


def test_scaffold_endpoint_422_without_target(client, monkeypatch):
    monkeypatch.setattr(
        rss.svc,
        "get_project_row",
        lambda db, pid: SimpleNamespace(
            id="p1", name="demo", remotion_project_path=None, chapters=[]
        ),
    )
    resp = client.post("/api/segmented-projects/p1/scaffold-remotion", json={})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "remotion_target_not_set"
```

注意：`client` fixture 名以 `backend/tests/conftest.py` 为准（若名为 `test_client` 等则相应调整）。

- [ ] **Step 7: 运行测试确认通过 + 回归**

Run: `cd backend && uv run --extra test pytest tests/test_remotion_scaffold.py tests/test_segmented_projects_api.py -q`
Expected: 全部 PASS

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/remotion_scaffold_service.py backend/app/api/segmented_projects.py backend/tests/test_remotion_scaffold.py
git commit -m "feat(backend): scaffold-remotion endpoint + remotion scaffold service"
```

---

## Task 13: Agent — scaffold_remotion 节点

**Files:**
- Create: `agent/app/nodes/knowledge_video/scaffold_remotion.py`
- Test: `agent/tests/test_kv_scaffold.py`

- [ ] **Step 1: 写失败测试**

`agent/tests/test_kv_scaffold.py`:

```python
"""Tests for the kv scaffold_remotion node."""
import pytest

from app.nodes.knowledge_video.scaffold_remotion import scaffold_remotion_node


class _FakeBackend:
    def __init__(self, result=None, exc=None):
        self._result = result
        self._exc = exc
        self.calls = []

    async def scaffold_remotion(self, pid, target_dir=None, animation_brief=None):
        self.calls.append(
            {"pid": pid, "target_dir": target_dir, "animation_brief": animation_brief}
        )
        if self._exc:
            raise self._exc
        return self._result


class _FakeRuntime:
    def __init__(self, backend):
        self.store = None
        self.backend = backend


def _patch_writer(monkeypatch):
    monkeypatch.setattr(
        "app.nodes.knowledge_video.scaffold_remotion.get_stream_writer",
        lambda: (lambda p: None),
    )


@pytest.mark.asyncio
async def test_scaffold_success(monkeypatch):
    _patch_writer(monkeypatch)
    backend = _FakeBackend(result={"project_dir": "/tmp/rv", "created": True, "chapters": 2})
    state = {"project_id": "p1", "target_dir": "/tmp/rv"}
    result = await scaffold_remotion_node(state, _FakeRuntime(backend))

    assert backend.calls[0]["target_dir"] == "/tmp/rv"
    assert backend.calls[0]["animation_brief"] is None
    assert result["remotion_project_dir"] == "/tmp/rv"
    assert result["current_stage"] == "gen_animation_brief"
    assert result["error"] is None


@pytest.mark.asyncio
async def test_scaffold_failure_sets_error(monkeypatch):
    _patch_writer(monkeypatch)
    backend = _FakeBackend(exc=RuntimeError("npx_not_found"))
    result = await scaffold_remotion_node(
        {"project_id": "p1"}, _FakeRuntime(backend)
    )
    assert "npx_not_found" in result["error"]
    assert result["current_stage"] == "scaffold_remotion"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd agent && uv run --extra test pytest tests/test_kv_scaffold.py -q`
Expected: FAIL（`ModuleNotFoundError`）

- [ ] **Step 3: 实现节点**

`agent/app/nodes/knowledge_video/scaffold_remotion.py`:

```python
"""ScaffoldRemotion node (knowledge_video): create/refresh the Remotion project.

Delegates to the backend's scaffold-remotion endpoint, which is idempotent:
existing projects are kept and only assets are refreshed. A failure here
does not lose prior work -- synthesis results stay in state and the run can
be retried after fixing the environment (Node.js, target dir, ...).
"""
from __future__ import annotations

from langgraph.config import get_stream_writer

from app import backend_client


async def scaffold_remotion_node(state, runtime) -> dict:
    project_id = state["project_id"]
    writer = get_stream_writer()

    async def emit(p):
        writer(p)

    await emit(
        {
            "type": "stage_start",
            "stage": "scaffold_remotion",
            "message": "开始生成 Remotion 工程...",
        }
    )

    backend = getattr(runtime, "backend", None) or backend_client.BackendClient()
    try:
        result = await backend.scaffold_remotion(
            project_id, target_dir=state.get("target_dir")
        )
    except Exception as exc:
        await emit(
            {
                "type": "error",
                "stage": "scaffold_remotion",
                "message": f"Remotion 工程生成失败: {exc}",
            }
        )
        return {
            "error": f"Remotion 工程生成失败: {exc}",
            "current_stage": "scaffold_remotion",
        }

    project_dir = result.get("project_dir", "")
    created = result.get("created", False)
    await emit(
        {
            "type": "stage_complete",
            "stage": "scaffold_remotion",
            "message": f"Remotion 工程{'已创建' if created else '已刷新'}: {project_dir}",
            "data": result,
        }
    )
    return {
        "remotion_project_dir": project_dir,
        "current_stage": "gen_animation_brief",
        "error": None,
    }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd agent && uv run --extra test pytest tests/test_kv_scaffold.py -q`
Expected: 2 PASS

- [ ] **Step 5: Commit**

```bash
git add agent/app/nodes/knowledge_video/scaffold_remotion.py agent/tests/test_kv_scaffold.py
git commit -m "feat(agent): kv scaffold_remotion node"
```

---

## Task 14: Agent — gen_animation_brief 节点

**Files:**
- Create: `agent/app/nodes/knowledge_video/gen_animation_brief.py`
- Test: `agent/tests/test_kv_gen_animation_brief.py`

- [ ] **Step 1: 写失败测试**

`agent/tests/test_kv_gen_animation_brief.py`:

```python
"""Tests for the kv gen_animation_brief node."""
import pytest

from app.nodes.knowledge_video.gen_animation_brief import (
    _build_timeline,
    gen_animation_brief_node,
)
from app.schemas import AnimationBrief


PROJECT = {
    "chapters": [
        {
            "id": "c1",
            "name": "第一章",
            "segments": [
                {"id": "s1", "text": "第一段", "audio": {"current": {"duration_sec": 2.0}}},
                {"id": "s2", "text": "第二段", "audio": {"current": {"duration_sec": 3.0}}},
            ],
        }
    ]
}

BRIEF = AnimationBrief(
    chapters=[
        {
            "chapter_position": 0,
            "title": "第一章",
            "segments": [
                {
                    "segment_position": 0,
                    "narration_text": "第一段",
                    "visual_content": {"type": "text", "description": "关键句", "source_ref": None},
                    "animation": {"effect": "fade_in", "notes": ""},
                },
                {
                    "segment_position": 1,
                    "narration_text": "第二段",
                    "visual_content": {"type": "code", "description": "展示代码", "source_ref": None},
                    "animation": {"effect": "typewriter", "notes": "逐行"},
                },
            ],
        }
    ]
)


def test_build_timeline_accumulates_durations():
    timeline = _build_timeline(PROJECT)
    segs = timeline[0]["segments"]
    assert segs[0]["start_sec"] == 0.0
    assert segs[0]["end_sec"] == 2.0
    assert segs[1]["start_sec"] == 2.0
    assert segs[1]["end_sec"] == 5.0
    assert timeline[0]["title"] == "第一章"


class _FakeBackend:
    def __init__(self, project):
        self._project = project
        self.spec_calls = []
        self.scaffold_calls = []

    async def get_project(self, pid):
        return self._project

    async def apply_animation_spec(self, pid, items, theme=None):
        self.spec_calls.append(items)
        return {"segments_updated": len(items)}

    async def scaffold_remotion(self, pid, target_dir=None, animation_brief=None):
        self.scaffold_calls.append({"target_dir": target_dir, "animation_brief": animation_brief})
        return {"project_dir": "/tmp/rv", "created": False, "chapters": 1}


class _FakeRuntime:
    def __init__(self, backend):
        self.store = None
        self.backend = backend


def _patch(monkeypatch, brief):
    monkeypatch.setattr(
        "app.nodes.knowledge_video.gen_animation_brief.get_stream_writer",
        lambda: (lambda p: None),
    )
    client = type("C", (), {})

    async def fake_create(**kw):
        return brief

    client.create = fake_create
    monkeypatch.setattr(
        "app.nodes.knowledge_video.gen_animation_brief.get_instructor_client",
        lambda: (client, "m"),
    )
    monkeypatch.setattr(
        "app.nodes.knowledge_video.gen_animation_brief.knowledge_video.get_prompt",
        lambda name, **kw: "PROMPT",
    )


@pytest.mark.asyncio
async def test_brief_persisted_to_segments_and_remotion(monkeypatch):
    _patch(monkeypatch, BRIEF)
    backend = _FakeBackend(PROJECT)
    state = {"project_id": "p1", "source_structure_map": []}
    result = await gen_animation_brief_node(state, _FakeRuntime(backend))

    items = backend.spec_calls[0]
    assert len(items) == 2
    assert items[0]["segment_id"] == "s1"
    assert items[0]["start_sec"] == 0.0
    assert items[0]["end_sec"] == 2.0
    assert items[1]["segment_id"] == "s2"
    assert items[1]["animation"]["effect"] == "typewriter"

    brief_sent = backend.scaffold_calls[0]["animation_brief"]
    assert brief_sent["chapters"][0]["segments"][0]["start_sec"] == 0.0

    assert result["current_stage"] == "completed"
    assert result["error"] is None
    assert result["animation_brief"]["chapters"][0]["title"] == "第一章"


@pytest.mark.asyncio
async def test_backend_failure_sets_error(monkeypatch):
    _patch(monkeypatch, BRIEF)

    class _BadBackend(_FakeBackend):
        async def apply_animation_spec(self, pid, items, theme=None):
            raise RuntimeError("db down")

    state = {"project_id": "p1", "source_structure_map": []}
    result = await gen_animation_brief_node(state, _FakeRuntime(_BadBackend(PROJECT)))
    assert result["error"] is not None
    assert result["current_stage"] == "gen_animation_brief"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd agent && uv run --extra test pytest tests/test_kv_gen_animation_brief.py -q`
Expected: FAIL（`ModuleNotFoundError`）

- [ ] **Step 3: 实现节点**

`agent/app/nodes/knowledge_video/gen_animation_brief.py`:

```python
"""GenAnimationBrief node (knowledge_video): per-segment storyboard brief.

Builds the narration timeline from synthesized segment durations, asks the
LLM for a per-segment visual/animation brief (grounded in the source
document's code/image element map), then double-writes the result: per
segment into ``animation_spec_json`` (apply-animation-spec) and as
``animation_brief.json`` into the Remotion project (scaffold endpoint).
"""
from __future__ import annotations

from langgraph.config import get_stream_writer

from app import backend_client
from app.llm import get_instructor_client
from app.prompts import knowledge_video
from app.schemas import AnimationBrief


def _build_timeline(project: dict) -> list[dict]:
    """Flatten chapters into a timeline with per-segment start/end seconds.

    Durations come from ``segment.audio.current.duration_sec`` (0 when
    missing); the cursor accumulates across the whole project.
    """
    timeline: list[dict] = []
    cursor = 0.0
    for ch_pos, ch in enumerate(project.get("chapters") or []):
        ch_entry = {
            "chapter_position": ch_pos,
            "title": ch.get("name") or f"章节 {ch_pos + 1}",
            "segments": [],
        }
        for seg_pos, seg in enumerate(ch.get("segments") or []):
            audio = seg.get("audio") or {}
            duration = 0.0
            if isinstance(audio, dict):
                duration = float((audio.get("current") or {}).get("duration_sec") or 0.0)
            ch_entry["segments"].append(
                {
                    "id": seg.get("id"),
                    "position": seg_pos,
                    "text": seg.get("text") or "",
                    "start_sec": round(cursor, 3),
                    "end_sec": round(cursor + duration, 3),
                }
            )
            cursor += duration
        timeline.append(ch_entry)
    return timeline


async def gen_animation_brief_node(state, runtime) -> dict:
    project_id = state["project_id"]
    writer = get_stream_writer()

    async def emit(p):
        writer(p)

    await emit(
        {
            "type": "stage_start",
            "stage": "gen_animation_brief",
            "message": "开始生成动画分镜 brief...",
        }
    )

    backend = getattr(runtime, "backend", None) or backend_client.BackendClient()
    try:
        project = await backend.get_project(project_id)
    except Exception as exc:
        await emit(
            {"type": "error", "stage": "gen_animation_brief", "message": f"获取项目失败: {exc}"}
        )
        return {"error": f"获取项目失败: {exc}", "current_stage": "gen_animation_brief"}

    timeline = _build_timeline(project)
    source_elements = state.get("source_structure_map") or []

    await emit(
        {
            "type": "llm_call",
            "stage": "gen_animation_brief",
            "message": "正在调用 LLM 生成分镜 brief...",
        }
    )
    client, model = get_instructor_client()
    brief: AnimationBrief = await client.create(
        response_model=AnimationBrief,
        model=model,
        max_retries=2,
        messages=[
            {"role": "system", "content": knowledge_video.get_prompt("kv_animation_brief")},
            {
                "role": "user",
                "content": (
                    "以下是按时间轴排列的章节与旁白段落（含每段起止秒数），"
                    "以及原文档中的代码块/图片元素清单。请为每个段落生成动画分镜 brief。\n\n"
                    f"## 时间轴\n{timeline}\n\n## 原文特殊元素\n{source_elements}"
                ),
            },
        ],
    )

    # Attach timeline timestamps + segment ids onto each brief entry.
    brief_payload = brief.model_dump()
    items: list[dict] = []
    for ch in brief_payload["chapters"]:
        ch_pos = ch["chapter_position"]
        if ch_pos >= len(timeline):
            continue
        ch_tl = timeline[ch_pos]
        for seg_brief in ch["segments"]:
            seg_pos = seg_brief["segment_position"]
            if seg_pos >= len(ch_tl["segments"]):
                continue
            seg_tl = ch_tl["segments"][seg_pos]
            seg_brief["start_sec"] = seg_tl["start_sec"]
            seg_brief["end_sec"] = seg_tl["end_sec"]
            items.append(
                {
                    "segment_id": seg_tl["id"],
                    "chapter_position": ch_pos,
                    **seg_brief,
                }
            )

    try:
        await backend.apply_animation_spec(project_id, items)
        await backend.scaffold_remotion(project_id, animation_brief=brief_payload)
    except Exception as exc:
        await emit(
            {"type": "error", "stage": "gen_animation_brief", "message": f"brief 持久化失败: {exc}"}
        )
        return {"error": f"brief 持久化失败: {exc}", "current_stage": "gen_animation_brief"}

    total = sum(len(ch["segments"]) for ch in brief_payload["chapters"])
    await emit(
        {
            "type": "stage_complete",
            "stage": "gen_animation_brief",
            "message": f"分镜 brief 生成完成: {total} 段",
            "data": {"segments_count": total},
        }
    )
    return {
        "animation_brief": brief_payload,
        "current_stage": "completed",
        "error": None,
    }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd agent && uv run --extra test pytest tests/test_kv_gen_animation_brief.py -q`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add agent/app/nodes/knowledge_video/gen_animation_brief.py agent/tests/test_kv_gen_animation_brief.py
git commit -m "feat(agent): kv gen_animation_brief node with timeline grounding"
```

---

## Task 15: Agent — graph 组装 + langgraph.json 注册

**Files:**
- Create: `agent/app/graph_knowledge_video.py`
- Modify: `agent/langgraph.json`
- Test: `agent/tests/test_kv_graph.py`

- [ ] **Step 1: 写失败测试**

`agent/tests/test_kv_graph.py`:

```python
"""Topology tests for the knowledge_video graph."""
from app.graph_knowledge_video import (
    STAGE_ORDER,
    build_graph,
    route_after_preflight,
    route_after_review,
)


def test_stage_order():
    assert STAGE_ORDER == [
        "preflight_check",
        "gen_narration",
        "quality_review",
        "split_chapters",
        "synthesis",
        "scaffold_remotion",
        "gen_animation_brief",
    ]


def test_route_after_review():
    assert route_after_review({"review_status": "approved"}) == "split_chapters"
    assert route_after_review({"review_status": "rejected"}) == "gen_narration"
    assert route_after_review({}) == "gen_narration"


def test_route_after_preflight():
    assert route_after_preflight({"error": None}) == "gen_narration"
    assert route_after_preflight({}) == "gen_narration"
    assert route_after_preflight({"error": "用户取消"}) == "__end__"


def test_graph_compiles_with_all_nodes():
    graph = build_graph(checkpointer=None, store=None)
    node_names = set(graph.get_graph().nodes.keys())
    for name in STAGE_ORDER:
        assert name in node_names
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd agent && uv run --extra test pytest tests/test_kv_graph.py -q`
Expected: FAIL（`ModuleNotFoundError: app.graph_knowledge_video`）

- [ ] **Step 3: 实现 graph**

`agent/app/graph_knowledge_video.py`:

```python
"""Knowledge-video workflow StateGraph definition and compile.

Pipeline: preflight_check -> gen_narration -> quality_review (interrupt)
-> split_chapters -> synthesis -> scaffold_remotion -> gen_animation_brief.

Exports ``build_graph`` (tests + runtime injection) and a module-level
``graph`` for langgraph.json (the server injects checkpointer/store).
"""
from __future__ import annotations

from typing import Any

from langgraph.graph import END, START, StateGraph

from app.nodes.knowledge_video.gen_animation_brief import gen_animation_brief_node
from app.nodes.knowledge_video.gen_narration import gen_narration_node
from app.nodes.knowledge_video.preflight import preflight_check_node
from app.nodes.knowledge_video.quality_review import quality_review_node
from app.nodes.knowledge_video.scaffold_remotion import scaffold_remotion_node
from app.nodes.knowledge_video.split_chapters import split_chapters_node
from app.nodes.knowledge_video.synthesis import kv_synthesis_node
from app.state import KnowledgeVideoState

STAGE_ORDER = [
    "preflight_check",
    "gen_narration",
    "quality_review",
    "split_chapters",
    "synthesis",
    "scaffold_remotion",
    "gen_animation_brief",
]


def route_after_review(state: KnowledgeVideoState) -> str:
    if state.get("review_status") == "approved":
        return "split_chapters"
    return "gen_narration"


def route_after_preflight(state: KnowledgeVideoState) -> str:
    if state.get("error"):
        return END
    return "gen_narration"


def build_graph(
    checkpointer: Any,
    store: Any,
    *,
    backend: Any = None,
) -> Any:
    """Compile the knowledge_video graph. See graph.py for the conventions."""
    builder = (
        StateGraph(KnowledgeVideoState)
        .add_node("preflight_check", preflight_check_node)
        .add_node("gen_narration", gen_narration_node)
        .add_node("quality_review", quality_review_node)
        .add_node("split_chapters", split_chapters_node)
        .add_node("synthesis", kv_synthesis_node)
        .add_node("scaffold_remotion", scaffold_remotion_node)
        .add_node("gen_animation_brief", gen_animation_brief_node)
        .add_edge(START, "preflight_check")
        .add_conditional_edges("preflight_check", route_after_preflight)
        .add_edge("gen_narration", "quality_review")
        .add_conditional_edges("quality_review", route_after_review)
        .add_edge("split_chapters", "synthesis")
        .add_edge("synthesis", "scaffold_remotion")
        .add_edge("scaffold_remotion", "gen_animation_brief")
        .add_edge("gen_animation_brief", END)
    )
    return builder.compile(checkpointer=checkpointer, store=store)


# Module-level graph for langgraph.json (same convention as graph.py).
graph = build_graph(checkpointer=None, store=None)
```

- [ ] **Step 4: 注册 assistant**

`agent/langgraph.json` 改为：

```json
{
  "dependencies": ["."],
  "graphs": {
    "narration": "./app/graph.py:graph",
    "knowledge_video": "./app/graph_knowledge_video.py:graph"
  },
  "env": ".env"
}
```

- [ ] **Step 5: 运行测试确认通过 + agent 全量回归**

Run: `cd agent && uv run --extra test pytest -q`
Expected: 全部 PASS（新旧测试）

- [ ] **Step 6: 冒烟验证（可选但推荐）**

启动 agent 确认两个 assistant 注册成功：

```bash
cd agent && uv run langgraph dev --port 2024 &
sleep 8
curl -s http://127.0.0.1:2024/assistants/search -X POST -H 'Content-Type: application/json' -d '{}' | python3 -c "import sys,json; print(sorted(a['graph_id'] for a in json.load(sys.stdin)))"
kill %1
```

Expected: 输出包含 `knowledge_video` 和 `narration`。

- [ ] **Step 7: Commit**

```bash
git add agent/app/graph_knowledge_video.py agent/langgraph.json agent/tests/test_kv_graph.py
git commit -m "feat(agent): knowledge_video graph + langgraph assistant registration"
```

---

## Task 16: Frontend — workflow 类型选择 + assistantId 贯通

**Files:**
- Modify: `frontend/src/services/langgraph/contracts.ts`
- Modify: `frontend/src/services/langgraph/types.ts`
- Modify: `frontend/src/components/ProjectLibrary/ProjectLibrary.tsx`（startWorkflow、触发区 UI、WorkflowDrawer 调用处）
- Modify: `frontend/src/components/Workflow/WorkflowDrawer.tsx`（assistantId prop + kv 摘要）
- Test: `frontend/src/services/langgraph/contracts.test.ts`

- [ ] **Step 1: 写失败测试**

`frontend/src/services/langgraph/contracts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { NODE_STATE_KEYS, WORKFLOW_KINDS } from './contracts';

describe('WORKFLOW_KINDS', () => {
  it('maps narration kind', () => {
    expect(WORKFLOW_KINDS.narration).toEqual({
      kind: 'narration_workflow',
      assistantId: 'narration',
      label: '旁白工作流',
    });
  });

  it('maps knowledge_video kind', () => {
    expect(WORKFLOW_KINDS.knowledge_video).toEqual({
      kind: 'knowledge_video_workflow',
      assistantId: 'knowledge_video',
      label: '知识视频工作流',
    });
  });
});

describe('NODE_STATE_KEYS', () => {
  it('keeps narration node keys', () => {
    expect(NODE_STATE_KEYS.gen_script).toEqual(['narration_script']);
    expect(NODE_STATE_KEYS.synthesis).toEqual(['synthesis_results']);
  });

  it('adds kv node keys', () => {
    expect(NODE_STATE_KEYS.preflight_check).toEqual(['source_document']);
    expect(NODE_STATE_KEYS.gen_narration).toEqual(['narration_script']);
    expect(NODE_STATE_KEYS.quality_review).toEqual(['review_result']);
    expect(NODE_STATE_KEYS.split_chapters).toEqual(['structured_segments']);
    expect(NODE_STATE_KEYS.scaffold_remotion).toEqual(['remotion_project_dir']);
    expect(NODE_STATE_KEYS.gen_animation_brief).toEqual(['animation_brief']);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/services/langgraph/contracts.test.ts`
Expected: FAIL（`WORKFLOW_KINDS` 未导出）

- [ ] **Step 3: 改 contracts.ts**

`frontend/src/services/langgraph/contracts.ts` 全量替换为：

```ts
/** Supported workflow kinds and their LangGraph bindings. */
export type WorkflowKind = 'narration' | 'knowledge_video';

export const WORKFLOW_KINDS: Record<
  WorkflowKind,
  { kind: string; assistantId: string; label: string }
> = {
  narration: {
    kind: 'narration_workflow',
    assistantId: 'narration',
    label: '旁白工作流',
  },
  knowledge_video: {
    kind: 'knowledge_video_workflow',
    assistantId: 'knowledge_video',
    label: '知识视频工作流',
  },
};

/** Node name -> state keys populated when the node completes. */
export const NODE_STATE_KEYS: Record<string, string[]> = {
  // narration
  gen_script: ['narration_script'],
  script_review: ['review_feedback'],
  split_segment: ['structured_segments'],
  synthesis: ['synthesis_results'],
  // knowledge_video
  preflight_check: ['source_document'],
  gen_narration: ['narration_script'],
  quality_review: ['review_result'],
  split_chapters: ['structured_segments'],
  scaffold_remotion: ['remotion_project_dir'],
  gen_animation_brief: ['animation_brief'],
};

/** Input fields the frontend renders when starting a run. */
export const INPUT_FIELDS: Record<string, Record<string, string>> = {
  narration: { project_id: 'Project' },
  knowledge_video: { project_id: 'Project' },
};
```

- [ ] **Step 4: 扩展 types.ts**

`frontend/src/services/langgraph/types.ts` 文件末尾追加：

```ts
/** TS mirror of agent/app/schemas.py kv additions + KnowledgeVideoState. */

export interface QualityDimension {
  name: string;
  passed: boolean;
  comment: string;
}

export interface QualityReviewResult {
  passed: boolean;
  dimensions: QualityDimension[];
  issues: string[];
}

export interface VisualContent {
  type: 'code' | 'image' | 'key_points' | 'text';
  description: string;
  source_ref: string | null;
}

export interface SegmentBrief {
  segment_position: number;
  narration_text: string;
  start_sec?: number;
  end_sec?: number;
  visual_content: VisualContent;
  animation: { effect: string; notes: string };
}

export interface ChapterBrief {
  chapter_position: number;
  title: string;
  segments: SegmentBrief[];
}

export interface AnimationBrief {
  chapters: ChapterBrief[];
}

export interface KnowledgeVideoState {
  target_dir?: string | null;
  source_structure_map?: Array<Record<string, unknown>>;
  review_result?: QualityReviewResult;
  remotion_project_dir?: string;
  animation_brief?: AnimationBrief;
}

/** Drawer state: narration fields + kv additions (overlapping keys are compatible). */
export type WorkflowState = NarraWorkflowState & KnowledgeVideoState;

/** Preflight overwrite-confirm interrupt payload. */
export interface ConfirmOverwriteInterrupt {
  kind: 'confirm_overwrite';
  stats: {
    chapters: number;
    segments: number;
    synthesized_segments: number;
    has_animation_brief: boolean;
  };
  available_actions: string[];
}
```

- [ ] **Step 5: ProjectLibrary 支持两种工作流**

`frontend/src/components/ProjectLibrary/ProjectLibrary.tsx`：

1. 顶部 import 区追加：

```ts
import { WORKFLOW_KINDS, type WorkflowKind } from '../../services/langgraph/contracts';
```

2. state 区（约 96 行 `const [drawerThreadId, ...]` 后）追加：

```ts
  const [drawerKind, setDrawerKind] = useState<WorkflowKind>('narration');
```

3. `startWorkflow`（99-126 行）替换为：

```ts
  const startWorkflow = async (workflowKind: WorkflowKind) => {
    try {
      const binding = WORKFLOW_KINDS[workflowKind];
      const existing = await agentClient.threads.search({
        metadata: { project_id: projectId, kind: binding.kind },
        limit: 50,
      });
      const active = existing.filter(
        (t: any) => t.status === 'busy' || t.status === 'interrupted',
      );
      setDrawerKind(workflowKind);
      if (active.length) {
        setDrawerThreadId(active[0].thread_id);
        setDrawerCollapsed(false);
        return;
      }
      const thread = await agentClient.threads.create({
        metadata: {
          project_id: projectId,
          project_name: projectName,
          kind: binding.kind,
        },
      });
      setDrawerThreadId(thread.thread_id);
      setDrawerCollapsed(false);
    } catch (e: any) {
      console.error('startWorkflow failed', e);
      alert('启动工作流失败: ' + (e.message || '未知错误'));
    }
  };
```

4. 触发区 UI（约 503-514 行的 `workflowTrigger` 块）替换为：

```tsx
            {projectId && (
              <div className={styles.workflowTrigger}>
                <div>
                  <strong>从源文档启动工作流</strong>
                  <span>旁白：改写 → 审查 → 拆分 → 合成；知识视频：转写 → 审查 → 拆分 → 合成 → Remotion 工程 → 分镜 brief</span>
                </div>
                <button className={styles.workflowBtn} onClick={() => startWorkflow('narration')}>
                  <span className="material-symbols-outlined">auto_awesome</span>
                  生成旁白
                </button>
                <button className={styles.workflowBtn} onClick={() => startWorkflow('knowledge_video')}>
                  <span className="material-symbols-outlined">movie</span>
                  知识视频
                </button>
              </div>
            )}
```

5. WorkflowDrawer 调用处（约 520-527 行）替换为：

```tsx
      {drawerThreadId && !drawerCollapsed && projectId && (
                  <WorkflowDrawer
            threadId={drawerThreadId}
            projectId={projectId}
            assistantId={WORKFLOW_KINDS[drawerKind].assistantId}
            onClose={() => setDrawerThreadId(null)}
            onCollapse={() => setDrawerCollapsed(true)}
          />
              )}
```

- [ ] **Step 6: WorkflowDrawer 接 assistantId + kv 摘要**

`frontend/src/components/Workflow/WorkflowDrawer.tsx`：

1. Props 接口（12-17 行）改为：

```ts
interface Props {
  threadId: string;
  projectId: string;
  assistantId?: string;
  onClose: () => void;
  onCollapse: () => void;
}
```

2. import 行 5 改为：

```ts
import type { MilestoneEvent, WorkflowState } from '../../services/langgraph/types';
```

3. `summaryFor`（31-50 行）替换为：

```ts
function summaryFor(nodeId: string, values: Partial<WorkflowState>): string | undefined {
  switch (nodeId) {
    case 'gen_script':
    case 'gen_narration':
      if (values.narration_script) return `${values.script_chapters?.length ?? 0} 章 · ${values.narration_script.length} 字`;
      return undefined;
    case 'script_review':
      if (values.review_feedback) return `评分 ${values.review_feedback.overall_score}/5`;
      return undefined;
    case 'quality_review':
      if (values.review_result) return values.review_result.passed ? '审查通过' : `审查发现 ${values.review_result.issues.length} 个问题`;
      return undefined;
    case 'split_segment':
    case 'split_chapters':
      if (values.structured_segments) {
        const total = values.structured_segments.reduce((s: number, c) => s + c.segments.length, 0);
        return `${values.structured_segments.length} 章 · ${total} 段`;
      }
      return undefined;
    case 'synthesis':
      if (values.synthesis_results) return `${values.synthesis_results.length} 段`;
      return undefined;
    case 'scaffold_remotion':
      if (values.remotion_project_dir) return values.remotion_project_dir;
      return undefined;
    case 'gen_animation_brief':
      if (values.animation_brief) return `${values.animation_brief.chapters.length} 章 brief`;
      return undefined;
  }
  return undefined;
}
```

4. 组件签名（52 行）改为：

```ts
export function WorkflowDrawer({ threadId, projectId, assistantId = 'narration', onClose, onCollapse }: Props) {
```

5. `useStream`（58-67 行）中 `assistantId: 'narration'` 改为 `assistantId`，泛型 `useStream<NarraWorkflowState>` 改为 `useStream<WorkflowState>`。

6. 拓扑拉取（69-80 行）中 `.getGraph('narration')` 改为 `.getGraph(assistantId)`，useEffect 依赖数组 `[]` 改为 `[assistantId]`。

7. gen_script 剧本预览（148 行）条件 `{n.id === 'gen_script' && values.narration_script && (` 改为 `{(n.id === 'gen_script' || n.id === 'gen_narration') && values.narration_script && (`；split_segment 章节摘要（154 行）与 fullscreen 区（187、190 行）同样把 `'split_segment'` 条件扩展为 `'split_segment' 或 'split_chapters'`。

- [ ] **Step 7: 运行测试 + lint + build**

Run: `cd frontend && npx vitest run src/services/langgraph/contracts.test.ts && npm run lint && npm run build`
Expected: 测试 PASS；lint 无新错误；build 成功

- [ ] **Step 8: Commit**

```bash
git add frontend/src/services/langgraph/contracts.ts frontend/src/services/langgraph/types.ts frontend/src/services/langgraph/contracts.test.ts frontend/src/components/ProjectLibrary/ProjectLibrary.tsx frontend/src/components/Workflow/WorkflowDrawer.tsx
git commit -m "feat(frontend): workflow kind selection + assistantId plumbing"
```

---

## Task 17: Frontend — ConfirmPanel（preflight 覆盖确认）

**Files:**
- Create: `frontend/src/components/Workflow/ConfirmPanel.tsx`
- Create: `frontend/src/components/Workflow/ConfirmPanel.module.css`
- Modify: `frontend/src/components/Workflow/WorkflowDrawer.tsx`（interrupt 分支）
- Test: `frontend/src/components/Workflow/ConfirmPanel.test.tsx`

- [ ] **Step 1: 写失败测试**

`frontend/src/components/Workflow/ConfirmPanel.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmPanel } from './ConfirmPanel';

const interrupt = {
  kind: 'confirm_overwrite' as const,
  stats: {
    chapters: 3,
    segments: 12,
    synthesized_segments: 8,
    has_animation_brief: true,
  },
  available_actions: ['confirm', 'cancel'],
};

describe('ConfirmPanel', () => {
  it('renders stats and warning', () => {
    render(<ConfirmPanel interrupt={interrupt} onRespond={() => {}} />);
    expect(screen.getByText(/3 个章节/)).toBeTruthy();
    expect(screen.getByText(/8 段已合成音频/)).toBeTruthy();
    expect(screen.getByText(/删除并重建/)).toBeTruthy();
  });

  it('confirm button responds with confirm action', () => {
    const onRespond = vi.fn();
    render(<ConfirmPanel interrupt={interrupt} onRespond={onRespond} />);
    fireEvent.click(screen.getByText('确认重建'));
    expect(onRespond).toHaveBeenCalledWith({ action: 'confirm' });
  });

  it('cancel button responds with cancel action', () => {
    const onRespond = vi.fn();
    render(<ConfirmPanel interrupt={interrupt} onRespond={onRespond} />);
    fireEvent.click(screen.getByText('取消'));
    expect(onRespond).toHaveBeenCalledWith({ action: 'cancel' });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/components/Workflow/ConfirmPanel.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 ConfirmPanel**

`frontend/src/components/Workflow/ConfirmPanel.tsx`:

```tsx
import type { ConfirmOverwriteInterrupt } from '../../services/langgraph/types';
import styles from './ConfirmPanel.module.css';

interface Props {
  interrupt: ConfirmOverwriteInterrupt;
  onRespond: (payload: { action: string }) => void;
}

export function ConfirmPanel({ interrupt, onRespond }: Props) {
  const { stats } = interrupt;
  return (
    <div className={styles.confirmPanel}>
      <div className={styles.titleRow}>
        <span className="material-symbols-outlined">warning</span>
        <strong>项目已有内容</strong>
      </div>
      <p className={styles.message}>
        当前项目已有 {stats.chapters} 个章节 / {stats.segments} 个段落
        {stats.synthesized_segments > 0 && `，其中 ${stats.synthesized_segments} 段已合成音频`}
        {stats.has_animation_brief && '，已有动画分镜 brief'}
        。继续将删除并重建这些内容。
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.confirmBtn}
          onClick={() => onRespond({ action: 'confirm' })}
        >
          确认重建
        </button>
        <button
          type="button"
          className={styles.cancelBtn}
          onClick={() => onRespond({ action: 'cancel' })}
        >
          取消
        </button>
      </div>
    </div>
  );
}
```

`frontend/src/components/Workflow/ConfirmPanel.module.css`:

```css
.confirmPanel {
  margin: 12px;
  padding: 16px;
  border: 1px solid var(--color-warning, #d97706);
  border-radius: 8px;
  background: var(--color-warning-bg, rgba(217, 119, 6, 0.08));
}

.titleRow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.message {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.6;
}

.actions {
  display: flex;
  gap: 8px;
}

.confirmBtn {
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  background: var(--color-danger, #dc2626);
  color: #fff;
  cursor: pointer;
}

.cancelBtn {
  padding: 6px 16px;
  border: 1px solid var(--color-border, #d1d5db);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}
```

- [ ] **Step 4: WorkflowDrawer 接入 interrupt 分支**

`frontend/src/components/Workflow/WorkflowDrawer.tsx`：

1. import 区追加：

```ts
import { ConfirmPanel } from './ConfirmPanel';
import type { ConfirmOverwriteInterrupt } from '../../services/langgraph/types';
```

2. interrupt 取值（92-94 行）替换为：

```ts
  const interrupt = stream.interrupts?.[0]?.value as
    | ({ script: string; review: any; available_actions: string[] } & Partial<ConfirmOverwriteInterrupt>)
    | undefined;
  const isConfirmInterrupt = interrupt?.kind === 'confirm_overwrite';
```

3. body 中 interrupt 渲染（121-126 行）替换为：

```tsx
        {interrupt && isConfirmInterrupt && (
          <ConfirmPanel
            interrupt={interrupt as ConfirmOverwriteInterrupt}
            onRespond={(p) => stream.respond(p as any)}
          />
        )}

        {interrupt && !isConfirmInterrupt && (
          <ReviewPanel
            interrupt={interrupt}
            onRespond={(p) => stream.respond(p as any)}
          />
        )}
```

4. StageCard 跳过条件（129 行）`if (interrupt && n.id === 'script_review') return null;` 改为：

```ts
          if (interrupt && (n.id === 'script_review' || n.id === 'quality_review' || n.id === 'preflight_check')) return null;
```

- [ ] **Step 5: 运行测试 + lint**

Run: `cd frontend && npx vitest run src/components/Workflow/ConfirmPanel.test.tsx && npm run lint`
Expected: 3 PASS；lint 无新错误

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Workflow/ConfirmPanel.tsx frontend/src/components/Workflow/ConfirmPanel.module.css frontend/src/components/Workflow/ConfirmPanel.test.tsx frontend/src/components/Workflow/WorkflowDrawer.tsx
git commit -m "feat(frontend): ConfirmPanel for kv preflight overwrite interrupt"
```

---

## Task 18: Frontend — StoryboardPanel 分镜视图

**Files:**
- Create: `frontend/src/components/Storyboard/StoryboardPanel.tsx`
- Create: `frontend/src/components/Storyboard/StoryboardPanel.module.css`
- Modify: `frontend/src/components/ProjectLibrary/ProjectLibrary.tsx`（新增「分镜」tab）
- Test: `frontend/src/components/Storyboard/StoryboardPanel.test.tsx`

- [ ] **Step 1: 写失败测试**

`frontend/src/components/Storyboard/StoryboardPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StoryboardPanel } from './StoryboardPanel';

const chapters = [
  {
    id: 'c1',
    name: '第一章',
    segments: [
      {
        id: 's1',
        position: 0,
        text: '旁白一',
        animation_spec: {
          start_sec: 0,
          end_sec: 4.2,
          narration_text: '旁白一',
          visual_content: { type: 'code', description: '展示初始化代码', source_ref: null },
          animation: { effect: 'typewriter', notes: '逐行打出' },
        },
      },
      {
        id: 's2',
        position: 1,
        text: '旁白二（无 brief）',
        animation_spec: null,
      },
    ],
  },
];

describe('StoryboardPanel', () => {
  it('renders a card per segment that has a brief', () => {
    render(<StoryboardPanel chapters={chapters} />);
    expect(screen.getByText('第一章')).toBeTruthy();
    expect(screen.getByText('00:00 – 00:04')).toBeTruthy();
    expect(screen.getByText('旁白一')).toBeTruthy();
    expect(screen.getByText('展示初始化代码')).toBeTruthy();
    expect(screen.getByText(/typewriter/)).toBeTruthy();
    // 无 brief 的段落不渲染
    expect(screen.queryByText('旁白二（无 brief）')).toBeNull();
  });

  it('shows visual content type label', () => {
    render(<StoryboardPanel chapters={chapters} />);
    expect(screen.getByText('代码')).toBeTruthy();
  });

  it('shows empty state when no briefs exist', () => {
    render(<StoryboardPanel chapters={[{ id: 'c', name: 'x', segments: [] }]} />);
    expect(screen.getByText(/暂无分镜数据/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/components/Storyboard/StoryboardPanel.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 StoryboardPanel**

`frontend/src/components/Storyboard/StoryboardPanel.tsx`:

```tsx
import styles from './StoryboardPanel.module.css';

interface StoryboardSpec {
  start_sec?: number;
  end_sec?: number;
  narration_text?: string;
  visual_content?: { type?: string; description?: string; source_ref?: string | null };
  animation?: { effect?: string; notes?: string };
}

interface StoryboardSegment {
  id: string;
  position?: number;
  text?: string;
  animation_spec?: StoryboardSpec | null;
}

interface StoryboardChapter {
  id: string;
  name: string;
  segments: StoryboardSegment[];
}

const TYPE_LABELS: Record<string, string> = {
  code: '代码',
  image: '图片',
  key_points: '要点',
  text: '文字',
};

function fmt(sec?: number): string {
  const s = Math.max(0, Math.round(sec ?? 0));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function StoryboardPanel({ chapters }: { chapters: StoryboardChapter[] }) {
  const withBrief = chapters
    .map((ch) => ({ ...ch, segments: ch.segments.filter((s) => s.animation_spec) }))
    .filter((ch) => ch.segments.length > 0);

  const copyAsText = () => {
    const lines: string[] = [];
    for (const ch of withBrief) {
      lines.push(`# ${ch.name}`);
      for (const seg of ch.segments) {
        const spec = seg.animation_spec!;
        lines.push(`[${fmt(spec.start_sec)}-${fmt(spec.end_sec)}] ${spec.narration_text || seg.text || ''}`);
        lines.push(`  画面: ${spec.visual_content?.type ?? 'text'} - ${spec.visual_content?.description ?? ''}`);
        lines.push(`  动画: ${spec.animation?.effect ?? ''}${spec.animation?.notes ? ` (${spec.animation.notes})` : ''}`);
      }
    }
    void navigator.clipboard.writeText(lines.join('\n'));
  };

  if (!withBrief.length) {
    return (
      <div className={styles.empty}>
        暂无分镜数据。运行知识视频工作流后，这里会展示每段旁白的动画分镜 brief。
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <button type="button" className={styles.copyBtn} onClick={copyAsText}>
          <span className="material-symbols-outlined">content_copy</span>
          复制为文本
        </button>
      </div>
      {withBrief.map((ch) => (
        <section key={ch.id} className={styles.chapter}>
          <h3 className={styles.chapterTitle}>{ch.name}</h3>
          {ch.segments.map((seg) => {
            const spec = seg.animation_spec!;
            return (
              <div key={seg.id} className={styles.storyboardCard}>
                <div className={styles.timeRange}>
                  {fmt(spec.start_sec)} – {fmt(spec.end_sec)}
                </div>
                <p className={styles.narration}>{spec.narration_text || seg.text}</p>
                <div className={styles.visual}>
                  <span className={styles.visualType}>
                    {TYPE_LABELS[spec.visual_content?.type ?? 'text'] ?? spec.visual_content?.type}
                  </span>
                  <span>{spec.visual_content?.description}</span>
                </div>
                <div className={styles.effect}>
                  <span className="material-symbols-outlined">animation</span>
                  {spec.animation?.effect}
                  {spec.animation?.notes ? ` · ${spec.animation.notes}` : ''}
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
```

`frontend/src/components/Storyboard/StoryboardPanel.module.css`:

```css
.panel {
  padding: 16px;
  overflow-y: auto;
}

.empty {
  padding: 48px 16px;
  text-align: center;
  color: var(--color-text-secondary, #6b7280);
  font-size: 14px;
}

.toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}

.copyBtn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid var(--color-border, #d1d5db);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
}

.chapter {
  margin-bottom: 24px;
}

.chapterTitle {
  margin: 0 0 8px;
  font-size: 15px;
}

.storyboardCard {
  border: 1px solid var(--color-border, #d1d5db);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 8px;
}

.timeRange {
  font-family: monospace;
  font-size: 12px;
  color: var(--color-text-secondary, #6b7280);
  margin-bottom: 4px;
}

.narration {
  margin: 0 0 8px;
  font-size: 14px;
  line-height: 1.6;
}

.visual {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 13px;
  margin-bottom: 4px;
}

.visualType {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--color-accent-bg, rgba(59, 130, 246, 0.12));
  font-size: 12px;
}

.effect {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text-secondary, #6b7280);
}
```

- [ ] **Step 4: ProjectLibrary 加「分镜」tab**

`frontend/src/components/ProjectLibrary/ProjectLibrary.tsx`：

1. import 区追加：

```ts
import { StoryboardPanel } from '../Storyboard/StoryboardPanel';
```

2. `type LibraryTab = 'source' | 'narration';`（31 行）改为：

```ts
type LibraryTab = 'source' | 'narration' | 'storyboard';
```

3. tabBar 中（453-457 行的 narration tab 按钮之后）追加：

```tsx
            <button
              type="button"
              className={`${styles.tab} ${activeTab === 'storyboard' ? styles.tabActive : ''}`}
              onClick={() => { setActiveTab('storyboard'); setComparing(false); }}
            >
              分镜
            </button>
```

4. 内容区三元（493-518 行 `) : activeTab === 'source' ? (` … `) : ( narrationContent )`）改为：

```tsx
        ) : activeTab === 'source' ? (
          <>
            <SourceDocumentView
              content={sourceDocument ?? ''}
              onChange={(text) => onUpdateSourceDocument?.(text)}
              onCompare={() => setComparing(true)}
              onBack={() => setActiveTab('narration')}
              viewMode={sourceViewMode}
              onViewModeChange={setSourceViewMode}
            />
            {projectId && (
              <div className={styles.workflowTrigger}>
                <div>
                  <strong>从源文档启动工作流</strong>
                  <span>旁白：改写 → 审查 → 拆分 → 合成；知识视频：转写 → 审查 → 拆分 → 合成 → Remotion 工程 → 分镜 brief</span>
                </div>
                <button className={styles.workflowBtn} onClick={() => startWorkflow('narration')}>
                  <span className="material-symbols-outlined">auto_awesome</span>
                  生成旁白
                </button>
                <button className={styles.workflowBtn} onClick={() => startWorkflow('knowledge_video')}>
                  <span className="material-symbols-outlined">movie</span>
                  知识视频
                </button>
              </div>
            )}
          </>
        ) : activeTab === 'storyboard' ? (
          <StoryboardPanel chapters={chapters} />
        ) : (
          narrationContent
        )}
```

注：若 Task 16 已改过触发区，此处只需把 `) : (` 前插入 `) : activeTab === 'storyboard' ? ( <StoryboardPanel chapters={chapters} /> )` 分支即可，不要重复改触发区。

- [ ] **Step 5: 运行测试 + lint + build**

Run: `cd frontend && npx vitest run src/components/Storyboard src/components/Workflow src/services/langgraph && npm run lint && npm run build`
Expected: 全部 PASS；build 成功

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Storyboard frontend/src/components/ProjectLibrary/ProjectLibrary.tsx
git commit -m "feat(frontend): storyboard panel with per-segment animation briefs"
```

---

## Task 19: E2E — knowledge-video-workflow.spec.ts

**Files:**
- Create: `tests/e2e/specs/knowledge-video-workflow.spec.ts`

范围（对应规格 §9.1）：不跑完整 agent 链路，覆盖 ① 源文档页两个工作流入口；② 分镜视图渲染（brief 通过 `apply-animation-spec` API 预置）+ API/DB 双层验证。遵循 `docs/e2e-test-guide.md`：中文 locale、serial、CSS module 部分选择器、`verifyDbWithScreenshot`、`collectErrors`。

- [ ] **Step 1: 写 E2E spec**

`tests/e2e/specs/knowledge-video-workflow.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import {
  collectErrors,
  enterWorkspace,
  openTestProject,
  readBackendProject,
  readBackendProjects,
  setLocaleToZhCN,
} from '../helpers';
import { readDbProject, validateDbProjectRow } from '../helpers/dbReader';
import { verifyDbWithScreenshot } from '../helpers/dualReadSnapshot';

const BACKEND = 'http://127.0.0.1:8002';

test.describe('知识视频工作流', () => {
  test.beforeEach(async ({ page }) => {
    await setLocaleToZhCN(page);
  });

  test('源文档页显示两种工作流入口', async ({ page }) => {
    const errors = collectErrors(page);
    await enterWorkspace(page);
    await openTestProject(page);

    // 打开 文本库 · 源文档 tab
    await page.getByRole('button', { name: /源文档|文本库/ }).first().click();

    await expect(page.getByRole('button', { name: '生成旁白' })).toBeVisible();
    await expect(page.getByRole('button', { name: '知识视频' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('分镜视图展示 animation_spec 并按双层契约验证', async ({ page }) => {
    const errors = collectErrors(page);
    await enterWorkspace(page);
    await openTestProject(page);

    // BEFORE: 读取种子项目
    const projects = await readBackendProjects(page);
    const testProject = projects.find((p: any) => p.name === 'test');
    expect(testProject).toBeTruthy();
    const before = await readBackendProject(page, testProject.id);
    const chapter = before.chapters[0];
    const segment = chapter.segments[0];
    expect(segment).toBeTruthy();

    // ACTION: 通过 API 预置 brief（模拟 gen_animation_brief 的写入）
    const brief = {
      segment_id: segment.id,
      start_sec: 0,
      end_sec: 4.2,
      narration_text: segment.text,
      visual_content: { type: 'code', description: '展示示例代码', source_ref: null },
      animation: { effect: 'typewriter', notes: '逐行打出' },
    };
    const resp = await page.request.post(
      `${BACKEND}/api/segmented-projects/${testProject.id}/apply-animation-spec`,
      { data: { theme: null, segments: [brief] } },
    );
    expect(resp.ok()).toBeTruthy();

    // AFTER-API: API 层验证 animation_spec 字段
    const after = await readBackendProject(page, testProject.id);
    const spec = after.chapters[0].segments[0].animation_spec;
    expect(spec.visual_content.type).toBe('code');
    expect(spec.animation.effect).toBe('typewriter');
    expect(spec.start_sec).toBe(0);

    // AFTER-DB: DB 层按 database-schema.md 契约验证
    const bundle = readDbProject(testProject.id);
    validateDbProjectRow(bundle);
    await verifyDbWithScreenshot(page, testProject.id, 'storyboard-spec-written');

    // AFTER-UI: 打开 分镜 tab，验证分镜卡渲染
    await page.reload();
    await page.getByRole('button', { name: '分镜' }).click();
    const card = page.locator('[class*="storyboardCard"]').first();
    await expect(card).toBeVisible();
    await expect(card).toContainText('00:00 – 00:04');
    await expect(card).toContainText('展示示例代码');
    await expect(card).toContainText('typewriter');
    expect(errors).toEqual([]);
  });
});
```

注意：
- helper 导入名以 `tests/e2e/helpers/index.ts` 的实际导出为准（`collectErrors` 若从 `helpers/errors.ts` 导出则改从该路径导入）。
- 若种子项目首个 segment 已有 `animation_spec`，`spec.start_sec` 断言可能受既有数据影响——以 API 返回的最新值为准即可（本用例刚覆写过）。

- [ ] **Step 2: 运行 E2E**

Run: `npx playwright test tests/e2e/specs/knowledge-video-workflow.spec.ts --workers=1`
Expected: 2 PASS。若 helper 名/种子数据假设不符，按 `tests/e2e/helpers/` 实际代码修正导入与断言后重跑。

- [ ] **Step 3: 全量 E2E 回归**

Run: `npm run e2e`
Expected: 全部 PASS（26 既有 + 2 新增）

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/specs/knowledge-video-workflow.spec.ts
git commit -m "test(e2e): knowledge video workflow entry points + storyboard view"
```

---

## Task 20: 文档更新

**Files:**
- Modify: `docs/api-reference.md`
- Modify: `docs/e2e-test-guide.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: api-reference.md**

在 segmented-projects 相关端点章节追加：

```markdown
### POST /api/segmented-projects/{project_id}/scaffold-remotion

为 knowledge_video 工作流创建（或刷新）Remotion 工程。幂等：目标目录已存在 Remotion 工程（package.json 含 remotion 依赖）时跳过创建，仅刷新资产。

**Request body:**

```json
{
  "target_dir": "/path/to/remotion-project",   // 可选；缺省用项目的 remotion_project_path
  "animation_brief": { "chapters": [] }         // 可选；提供时写入工程根 animation_brief.json
}
```

**行为：**
1. 工程不存在时执行 `npx create-video@latest --yes --blank .`（需服务端装有 Node.js，超时 600s）；
2. 每章节导出拼接 MP3 到 `public/audio/`（按章节标题命名）；
3. 每章节生成 `public/subtitles/chapter_<position>.srt`（按 segment 时长累加时间戳）；
4. 写 `segment_manifest.json`（章节/资产/时长清单）与 `AGENTS.md`；
5. 持久化 `remotion_project_path`。

**Response:** `{ "project_dir": "...", "created": true, "chapters": 2 }`

**Errors:** 404 `project_not_found`；422 `remotion_target_not_set`；500 `npx_not_found` / `create_video_failed`。
```

同时把 `apply-animation-spec` 的字段说明更新为：segments 数组元素除既有白名单字段外，**任意非 None 字段都会合并进 `animation_spec_json`**（kv 分镜 brief 的 `narration_text` / `visual_content` / `animation` / `start_sec` / `end_sec` 等）。

- [ ] **Step 2: e2e-test-guide.md**

- 「Running E2E Tests」中 `26 tests` 更新为 `28 tests`（两处）；
- Gap Analysis 表格追加一行：

```markdown
| G8 | **Knowledge video workflow entry + storyboard** | 工作流类型入口 + 分镜视图（brief API 预置 + 双层验证） | `knowledge-video-workflow.spec.ts` | Medium | ✅ Done |
```

- [ ] **Step 3: AGENTS.md**

`## Architecture` 的 Agent 小节追加一条：

```markdown
- `knowledge_video` 是第二个注册的 assistant（`agent/app/graph_knowledge_video.py`）：源文档 → 忠于原文的旁白转写 → 基础质量审查（人工确认）→ 章节拆分 → edge-tts 合成 → Remotion 工程脚手架 → 动画分镜 brief。前端 drawer 通过工作流类型选择 assistant（`WORKFLOW_KINDS` 映射）。
```

- [ ] **Step 4: Commit**

```bash
git add docs/api-reference.md docs/e2e-test-guide.md AGENTS.md
git commit -m "docs: scaffold-remotion API, e2e guide gap G8, knowledge_video architecture note"
```

---

## Task 21: 收尾全量验证

- [ ] **Step 1: agent 全量测试**

Run: `cd agent && uv run --extra test pytest -q`
Expected: 全部 PASS

- [ ] **Step 2: backend 全量测试**

Run: `cd backend && uv run --extra test pytest -q`
Expected: 全部 PASS

- [ ] **Step 3: frontend 测试 + lint + build**

Run: `cd frontend && npx vitest run && npm run lint && npm run build`
Expected: 全部 PASS；build 成功

- [ ] **Step 4: E2E 全量**

Run: `npm run e2e`
Expected: 28 PASS

- [ ] **Step 5: 手动冒烟（真机链路）**

1. `cd backend && uv run uvicorn main:app --host 127.0.0.1 --port 8002 --reload`
2. `cd agent && uv run langgraph dev --port 2024`
3. `cd frontend && npm run dev`
4. 打开一个带源文档的项目 → 文本库 · 源文档 → 点「知识视频」：
   - 有已有章节时应弹出 ConfirmPanel（确认重建 / 取消）；
   - 旁白稿生成后 quality_review 弹出 ReviewPanel，approve 后继续；
   - 合成完成后 scaffold_remotion 在目标目录生成工程（含 AGENTS.md / segment_manifest.json / public/audio / public/subtitles）；
   - gen_animation_brief 完成后，切到「分镜」tab 验证分镜卡；
   - `cd <remotion 目录> && npm install && npx remotion studio` 能打开工程。

---
