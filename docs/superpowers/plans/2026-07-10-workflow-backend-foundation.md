# Workflow Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立旁白脚本工作流的后端基础设施：依赖安装、WorkflowRun 数据模型、AsyncSqliteStore 自定义实现、LangGraph StateGraph 定义。

**Architecture:** 新增 LangGraph 依赖，创建 WorkflowRun SQLAlchemy 模型，实现基于 SQLite 的异步 LangGraph Store，定义包含 4 个节点的工作流 StateGraph。

**Tech Stack:** Python 3.12+, FastAPI, SQLAlchemy, LangGraph, aiosqlite, langgraph-checkpoint-sqlite

**Spec:** `docs/superpowers/specs/2026-07-10-narration-workflow-design.md` 第 1-6 章

## Global Constraints

- 依赖管理使用 `uv`，不用 pip
- 模型继承 `app.core.database.Base`
- ID 使用字符串 UUID，不用自增整数
- 时间戳使用 `utcnow()` from `app.core.time_utils`
- 新模型需注册到 `app/models/__init__.py`
- 数据库迁移在 `backend/app/core/database.py` 的 `init_db()` 中处理

---

### Task 1: 添加 LangGraph 依赖

**Files:**
- Modify: `backend/pyproject.toml`

**Interfaces:**
- Produces: `langgraph>=1.0`, `langgraph-checkpoint-sqlite`, `aiosqlite` 可 import

- [ ] **Step 1: 添加依赖到 pyproject.toml**

在 `backend/pyproject.toml` 的 `dependencies` 中添加：

```toml
dependencies = [
    # ... existing deps ...
    "langgraph>=1.0",
    "langgraph-checkpoint-sqlite",
    "aiosqlite",
]
```

- [ ] **Step 2: 安装依赖**

Run: `cd backend && uv sync`

Expected: 依赖安装成功，无报错

- [ ] **Step 3: 验证 import**

Run: `cd backend && uv run python -c "from langgraph.graph import StateGraph; from langgraph.checkpoint.sqlite import SqliteSaver; import aiosqlite; print('OK')"`

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/pyproject.toml backend/uv.lock
git commit -m "deps: add langgraph, langgraph-checkpoint-sqlite, aiosqlite"
```

---

### Task 2: 创建 WorkflowRun 数据模型

**Files:**
- Create: `backend/app/models/workflow_run.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/models/segmented_project.py`
- Modify: `backend/app/core/database.py`

**Interfaces:**
- Produces: `WorkflowRun` ORM model (id, project_id, thread_id, status, current_stage, error, created_at, updated_at)
- Produces: `SegmentedProject.workflow_runs` relationship

- [ ] **Step 1: 创建 WorkflowRun 模型**

```python
# backend/app/models/workflow_run.py
from sqlalchemy import Column, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.core.time_utils import utcnow


class WorkflowRun(Base):
    __tablename__ = "workflow_runs"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("segmented_projects.id", ondelete="CASCADE"), nullable=False)
    thread_id = Column(String, unique=True, nullable=False)
    status = Column(String, nullable=False, default="running")
    current_stage = Column(String, nullable=False)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    project = relationship("SegmentedProject", back_populates="workflow_runs")
```

- [ ] **Step 2: 注册模型到 __init__.py**

在 `backend/app/models/__init__.py` 中添加：

```python
from app.models.workflow_run import WorkflowRun
```

- [ ] **Step 3: 添加反向关系到 SegmentedProject**

在 `backend/app/models/segmented_project.py` 的 `SegmentedProject` 类中添加：

```python
workflow_runs = relationship("WorkflowRun", back_populates="project", order_by="WorkflowRun.created_at.desc()")
```

- [ ] **Step 4: 添加数据库迁移**

在 `backend/app/core/database.py` 的 `init_db()` 中，`Base.metadata.create_all(bind=engine)` 会自动创建新表。验证 workflow_runs 表被创建。

- [ ] **Step 5: 添加唯一索引（并发控制）**

在 `backend/app/core/database.py` 的 `init_db()` 中添加：

```python
# WorkflowRun: 同一项目最多一个活跃工作流
engine.execute("""
    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_workflow_per_project
    ON workflow_runs(project_id)
    WHERE status IN ('running', 'interrupted')
""")
```

注意：SQLite 的部分索引需要直接执行 SQL，不能通过 SQLAlchemy ORM。

- [ ] **Step 6: 验证模型**

Run: `cd backend && uv run python -c "from app.models import WorkflowRun; print(WorkflowRun.__tablename__)"`

Expected: `workflow_runs`

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/workflow_run.py backend/app/models/__init__.py backend/app/models/segmented_project.py backend/app/core/database.py
git commit -m "feat(workflow): add WorkflowRun model with project relationship"
```

---

### Task 3: 创建 WorkflowRun Pydantic Schema

**Files:**
- Create: `backend/app/schemas/workflow.py`

**Interfaces:**
- Produces: `WorkflowRunOut`, `WorkflowStartRequest`, `WorkflowResumeRequest`, `WorkflowReplayRequest`, `WorkflowForkRequest`

- [ ] **Step 1: 创建 Schema 文件**

```python
# backend/app/schemas/workflow.py
from pydantic import BaseModel, Field
from typing import Optional, Any
from datetime import datetime


class WorkflowStageOut(BaseModel):
    name: str
    status: str
    duration_sec: Optional[float] = None


class WorkflowRunOut(BaseModel):
    id: str
    project_id: str
    thread_id: str
    status: str
    current_stage: str
    stages: list[WorkflowStageOut] = Field(default_factory=list)
    interrupt_payload: Optional[dict[str, Any]] = None
    error: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class WorkflowStartRequest(BaseModel):
    source_document: Optional[str] = None


class WorkflowResumeRequest(BaseModel):
    stage: str
    action: str  # "approve" | "reject"
    edited_script: Optional[str] = None
    comment: Optional[str] = None
    feedback: Optional[str] = None


class WorkflowReplayRequest(BaseModel):
    from_stage: str


class WorkflowForkRequest(BaseModel):
    from_stage: str
    state_override: dict[str, Any] = Field(default_factory=dict)
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/schemas/workflow.py
git commit -m "feat(workflow): add Pydantic schemas for workflow API"
```

---

### Task 4: 实现 AsyncSqliteStore

**Files:**
- Create: `backend/app/services/workflow_store.py`

**Interfaces:**
- Produces: `AsyncSqliteStore` class with `aput()`, `aget()`, `asearch()`, `adelete()` methods
- Produces: `create_workflow_store(db_path: str) -> AsyncSqliteStore` factory

- [ ] **Step 1: 实现 AsyncSqliteStore**

```python
# backend/app/services/workflow_store.py
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


def create_workflow_store(db_path: str) -> AsyncSqliteStore:
    return AsyncSqliteStore(db_path)
```

- [ ] **Step 2: 验证 Store 可 import**

Run: `cd backend && uv run python -c "from app.services.workflow_store import AsyncSqliteStore; print('OK')"`

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/workflow_store.py
git commit -m "feat(workflow): implement AsyncSqliteStore for LangGraph"
```

---

### Task 5: 定义 LangGraph State 和 Graph

**Files:**
- Create: `backend/app/services/workflow_graph.py`

**Interfaces:**
- Produces: `NarrationWorkflowState` TypedDict
- Produces: `create_narration_graph(checkpointer, store) -> CompiledGraph` factory
- Produces: `STAGE_ORDER` constant

- [ ] **Step 1: 定义 State**

```python
# backend/app/services/workflow_graph.py
from typing import TypedDict, Any
from langgraph.graph import StateGraph, START, END


STAGE_ORDER = ["gen_script", "script_review", "split_segment", "synthesis"]


class NarrationWorkflowState(TypedDict):
    # 输入
    project_id: str
    run_id: str
    source_document: str

    # GenScript 输出
    narration_script: str
    script_chapters: list[dict[str, Any]]

    # ScriptReview 输出
    review_feedback: Any  # JSON dict or str
    edited_script: str
    review_status: str  # "approved" | "rejected"

    # SplitSegment 输出
    structured_segments: list[dict[str, Any]]

    # Synthesis 输出
    synthesis_results: list[dict[str, Any]]

    # 元数据
    current_stage: str
    error: str | None
```

- [ ] **Step 2: 定义路由函数和占位节点**

```python
def route_after_review(state: NarrationWorkflowState) -> str:
    if state.get("review_status") == "approved":
        return "split_segment"
    return "gen_script"


# 占位节点 — 后续 Task 替换为真实实现
async def gen_script_placeholder(state: NarrationWorkflowState) -> dict:
    return {"narration_script": "", "script_chapters": [], "current_stage": "script_review"}


async def script_review_placeholder(state: NarrationWorkflowState) -> dict:
    return {"review_status": "approved", "review_feedback": {}, "current_stage": "split_segment"}


async def split_segment_placeholder(state: NarrationWorkflowState) -> dict:
    return {"structured_segments": [], "current_stage": "synthesis"}


async def synthesis_placeholder(state: NarrationWorkflowState) -> dict:
    return {"synthesis_results": [], "current_stage": "completed"}
```

- [ ] **Step 3: 定义 Graph 工厂**

```python
def create_narration_graph(checkpointer, store):
    graph = (
        StateGraph(NarrationWorkflowState)
        .add_node("gen_script", gen_script_placeholder)
        .add_node("script_review", script_review_placeholder)
        .add_node("split_segment", split_segment_placeholder)
        .add_node("synthesis", synthesis_placeholder)
        .add_edge(START, "gen_script")
        .add_edge("gen_script", "script_review")
        .add_conditional_edges("script_review", route_after_review)
        .add_edge("split_segment", "synthesis")
        .add_edge("synthesis", END)
        .compile(checkpointer=checkpointer, store=store)
    )
    return graph
```

- [ ] **Step 4: 验证 Graph 可创建**

Run: `cd backend && uv run python -c "
from langgraph.checkpoint.sqlite import SqliteSaver
from app.services.workflow_store import AsyncSqliteStore
from app.services.workflow_graph import create_narration_graph
import sqlite3
conn = sqlite3.connect(':memory:')
checkpointer = SqliteSaver(conn)
store = AsyncSqliteStore(':memory:')
g = create_narration_graph(checkpointer, store)
print('Graph created:', type(g).__name__)
"`

Expected: `Graph created: CompiledGraph` (or similar)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/workflow_graph.py
git commit -m "feat(workflow): define NarrationWorkflowState and graph factory with placeholder nodes"
```

---

### Task 6: 添加单元测试

**Files:**
- Create: `backend/tests/unit/test_workflow_store.py`
- Create: `backend/tests/unit/test_workflow_graph.py`

- [ ] **Step 1: 测试 AsyncSqliteStore**

```python
# backend/tests/unit/test_workflow_store.py
import pytest
import asyncio
from app.services.workflow_store import AsyncSqliteStore


@pytest.fixture
def store():
    return AsyncSqliteStore(":memory:")


@pytest.mark.asyncio
async def test_aput_and_aget(store):
    await store.aput(("ns", "sub"), "k1", {"text": "hello"})
    item = await store.aget(("ns", "sub"), "k1")
    assert item is not None
    assert item.value["text"] == "hello"


@pytest.mark.asyncio
async def test_aget_missing(store):
    item = await store.aget(("ns",), "missing")
    assert item is None


@pytest.mark.asyncio
async def test_asearch_prefix(store):
    await store.aput(("feedback", "proj1"), "k1", {"comment": "good"})
    await store.aput(("feedback", "proj1"), "k2", {"comment": "bad"})
    await store.aput(("feedback", "proj2"), "k3", {"comment": "other"})
    results = await store.asearch(("feedback", "proj1"))
    assert len(results) == 2


@pytest.mark.asyncio
async def test_adelete(store):
    await store.aput(("ns",), "k1", {"text": "hello"})
    await store.adelete(("ns",), "k1")
    item = await store.aget(("ns",), "k1")
    assert item is None
```

- [ ] **Step 2: 测试 Graph 创建**

```python
# backend/tests/unit/test_workflow_graph.py
import pytest
from langgraph.checkpoint.sqlite import SqliteSaver
from app.services.workflow_store import AsyncSqliteStore
from app.services.workflow_graph import create_narration_graph, NarrationWorkflowState, STAGE_ORDER
import sqlite3


def test_graph_creation():
    conn = sqlite3.connect(":memory:")
    checkpointer = SqliteSaver(conn)
    store = AsyncSqliteStore(":memory:")
    g = create_narration_graph(checkpointer, store)
    assert g is not None


def test_stage_order():
    assert STAGE_ORDER == ["gen_script", "script_review", "split_segment", "synthesis"]
```

- [ ] **Step 3: 运行测试**

Run: `cd backend && uv run --extra test pytest tests/unit/test_workflow_store.py tests/unit/test_workflow_graph.py -v`

Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add backend/tests/unit/test_workflow_store.py backend/tests/unit/test_workflow_graph.py
git commit -m "test(workflow): add unit tests for AsyncSqliteStore and graph factory"
```
