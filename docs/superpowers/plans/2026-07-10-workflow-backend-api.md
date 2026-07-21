# Workflow Backend API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现工作流的后端服务层和 REST API，包括 8 个端点（启动、列表、详情、SSE 流、审批恢复、重放、分支、取消）。

**Architecture:** `workflow_service.py` 封装业务逻辑（启动工作流、状态管理、checkpoint 操作），`workflow.py` API 路由处理 HTTP 请求和 SSE 响应。

**Tech Stack:** Python 3.12+, FastAPI, SQLAlchemy, LangGraph, SSE

**Spec:** `docs/superpowers/specs/2026-07-10-narration-workflow-design.md` 第 7、9、10、12 章

**Depends on:**
- `2026-07-10-workflow-backend-foundation.md` (WorkflowRun 模型、Graph 工厂)
- `2026-07-10-workflow-backend-nodes.md` (4 个节点实现)

## Global Constraints

- API 路由使用 `router = APIRouter()`
- 数据库注入使用 `db: Session = Depends(get_db)`
- 错误使用 `HTTPException` with string detail
- SSE 使用 `StreamingResponse` with `text/event-stream`
- 工作流执行使用 `asyncio.create_task()` 后台运行

---

### Task 1: 实现 workflow_service 业务逻辑

**Files:**
- Create: `backend/app/services/workflow_service.py`

**Interfaces:**
- Produces: `start_workflow(db, project_id, source_document?) -> WorkflowRun`
- Produces: `get_workflow_runs(db, project_id) -> list[WorkflowRun]`
- Produces: `get_workflow_run(db, run_id) -> WorkflowRun`
- Produces: `resume_workflow(db, run_id, stage, action, ...) -> WorkflowRun`
- Produces: `replay_workflow(db, run_id, from_stage) -> WorkflowRun`
- Produces: `fork_workflow(db, run_id, from_stage, state_override) -> WorkflowRun`
- Produces: `cancel_workflow(db, run_id) -> WorkflowRun`
- Produces: `get_stage_durations(thread_id) -> list[dict]`

- [ ] **Step 1: 创建 workflow_service.py**

```python
# backend/app/services/workflow_service.py
import asyncio
import json
from uuid import uuid4
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import and_
from langgraph.types import Command
from langgraph.checkpoint.sqlite import SqliteSaver

from app.models.workflow_run import WorkflowRun
from app.models.segmented_project import SegmentedProject
from app.services.workflow_store import AsyncSqliteStore
from app.services.workflow_graph import create_narration_graph, STAGE_ORDER


# 全局单例 — 在应用启动时初始化
_checkpointer = None
_store = None
_graph = None
_running_tasks: dict[str, asyncio.Task] = {}


def init_workflow_engine(checkpoint_path: str, store_path: str):
    """初始化工作流引擎（应用启动时调用）"""
    global _checkpointer, _store, _graph
    import sqlite3
    conn = sqlite3.connect(checkpoint_path)
    _checkpointer = SqliteSaver(conn)
    _store = AsyncSqliteStore(store_path)
    _graph = create_narration_graph(_checkpointer, _store)


def get_graph():
    return _graph


def _ensure_engine():
    if _graph is None:
        raise RuntimeError("Workflow engine not initialized. Call init_workflow_engine() first.")


async def start_workflow(db: Session, project_id: str, source_document: str = None) -> WorkflowRun:
    """启动新工作流"""
    _ensure_engine()

    # 检查是否有活跃工作流
    active = db.query(WorkflowRun).filter(
        and_(
            WorkflowRun.project_id == project_id,
            WorkflowRun.status.in_(["running", "interrupted"])
        )
    ).first()

    if active:
        raise ConflictError(f"项目已有运行中的工作流 (run_id={active.id})，当前阶段: {active.current_stage}")

    # 获取源文档
    if not source_document:
        project = db.query(SegmentedProject).get(project_id)
        if not project:
            raise NotFoundError(f"项目不存在: {project_id}")
        source_document = project.source_document or ""

    # 创建 WorkflowRun
    run_id = str(uuid4())
    thread_id = str(uuid4())

    run = WorkflowRun(
        id=run_id,
        project_id=project_id,
        thread_id=thread_id,
        status="running",
        current_stage="gen_script"
    )
    db.add(run)
    db.commit()

    # 后台启动 LangGraph 执行
    task = asyncio.create_task(_execute_workflow(run_id, thread_id, project_id, source_document))
    _running_tasks[run_id] = task

    return run


async def _execute_workflow(run_id: str, thread_id: str, project_id: str, source_document: str):
    """后台执行工作流"""
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        state = {
            "project_id": project_id,
            "run_id": run_id,
            "source_document": source_document,
            "current_stage": "gen_script",
            "error": None,
        }
        config = {"configurable": {"thread_id": thread_id}}

        await _graph.ainvoke(state, config)

        # 更新状态为 completed
        run = db.query(WorkflowRun).get(run_id)
        if run and run.status != "cancelled":
            run.status = "completed"
            run.current_stage = "synthesis"
            db.commit()

    except asyncio.CancelledError:
        run = db.query(WorkflowRun).get(run_id)
        if run:
            run.status = "cancelled"
            db.commit()

    except Exception as e:
        run = db.query(WorkflowRun).get(run_id)
        if run:
            run.status = "failed"
            run.error = str(e)
            db.commit()

    finally:
        _running_tasks.pop(run_id, None)
        db.close()


async def resume_workflow(db: Session, run_id: str, stage: str, action: str,
                          edited_script: str = None, comment: str = None,
                          feedback: str = None) -> WorkflowRun:
    """审批后恢复工作流"""
    _ensure_engine()

    run = db.query(WorkflowRun).get(run_id)
    if not run:
        raise NotFoundError(f"工作流不存在: {run_id}")

    if run.status != "interrupted":
        raise ConflictError(f"工作流状态为 {run.status}，无法恢复")

    if run.current_stage != stage:
        raise ConflictError(f"当前阶段为 {run.current_stage}，请求的 stage 为 {stage}")

    # 构建 decision
    if action == "approve":
        decision = {
            "action": "approve",
            "edited_script": edited_script or "",
            "comment": comment or ""
        }
    else:
        if not feedback:
            raise ValidationError("拒绝时必须填写 feedback")
        decision = {
            "action": "reject",
            "feedback": feedback
        }

    # 恢复执行
    config = {"configurable": {"thread_id": run.thread_id}}
    task = asyncio.create_task(_resume_workflow(run_id, config, decision))
    _running_tasks[run_id] = task

    run.status = "running"
    db.commit()

    return run


async def _resume_workflow(run_id: str, config: dict, decision: dict):
    """后台恢复工作流"""
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        await _graph.ainvoke(Command(resume=decision), config)

        run = db.query(WorkflowRun).get(run_id)
        if run and run.status != "cancelled":
            # 根据 checkpoint 判断最终状态
            snapshot = await _graph.aget_state(config)
            if snapshot.next:
                run.status = "interrupted"
                run.current_stage = snapshot.values.get("current_stage", run.current_stage)
            else:
                run.status = "completed"
                run.current_stage = "completed"
            db.commit()

    except Exception as e:
        run = db.query(WorkflowRun).get(run_id)
        if run:
            run.status = "failed"
            run.error = str(e)
            db.commit()

    finally:
        _running_tasks.pop(run_id, None)
        db.close()


async def replay_workflow(db: Session, run_id: str, from_stage: str) -> WorkflowRun:
    """从指定阶段重放"""
    _ensure_engine()

    run = db.query(WorkflowRun).get(run_id)
    if not run:
        raise NotFoundError(f"工作流不存在: {run_id}")

    if run.status not in ["completed", "failed"]:
        raise ConflictError(f"工作流状态为 {run.status}，无法重放")

    if from_stage not in STAGE_ORDER:
        raise ValidationError(f"无效的阶段: {from_stage}")

    # 获取 checkpoint 历史
    config = {"configurable": {"thread_id": run.thread_id}}
    history = list(_graph.get_state_history(config))

    # 找到目标阶段的 checkpoint
    target = None
    for snapshot in history:
        if snapshot.next and snapshot.next[0] == from_stage:
            target = snapshot
            break

    if not target:
        raise NotFoundError(f"未找到阶段 {from_stage} 的 checkpoint")

    # 后台执行重放
    run.status = "running"
    run.current_stage = from_stage
    db.commit()

    task = asyncio.create_task(_replay_workflow(run_id, target.config))
    _running_tasks[run_id] = task

    return run


async def _replay_workflow(run_id: str, checkpoint_config: dict):
    """后台执行重放"""
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        await _graph.ainvoke(None, checkpoint_config)

        run = db.query(WorkflowRun).get(run_id)
        if run and run.status != "cancelled":
            run.status = "completed"
            db.commit()

    except Exception as e:
        run = db.query(WorkflowRun).get(run_id)
        if run:
            run.status = "failed"
            run.error = str(e)
            db.commit()

    finally:
        _running_tasks.pop(run_id, None)
        db.close()


async def fork_workflow(db: Session, run_id: str, from_stage: str, state_override: dict) -> WorkflowRun:
    """从指定阶段分支（修改状态后重跑）"""
    _ensure_engine()

    run = db.query(WorkflowRun).get(run_id)
    if not run:
        raise NotFoundError(f"工作流不存在: {run_id}")

    if run.status not in ["completed", "failed"]:
        raise ConflictError(f"工作流状态为 {run.status}，无法分支")

    # 获取 checkpoint 历史
    config = {"configurable": {"thread_id": run.thread_id}}
    history = list(_graph.get_state_history(config))

    target = None
    for snapshot in history:
        if snapshot.next and snapshot.next[0] == from_stage:
            target = snapshot
            break

    if not target:
        raise NotFoundError(f"未找到阶段 {from_stage} 的 checkpoint")

    # fork: 修改状态
    fork_config = _graph.update_state(target.config, values=state_override)

    # 后台执行
    run.status = "running"
    run.current_stage = from_stage
    db.commit()

    task = asyncio.create_task(_replay_workflow(run_id, fork_config))
    _running_tasks[run_id] = task

    return run


async def cancel_workflow(db: Session, run_id: str) -> WorkflowRun:
    """取消工作流"""
    run = db.query(WorkflowRun).get(run_id)
    if not run:
        raise NotFoundError(f"工作流不存在: {run_id}")

    if run.status not in ["running", "interrupted"]:
        raise ConflictError(f"工作流状态为 {run.status}，无法取消")

    # 取消 asyncio task
    task = _running_tasks.get(run_id)
    if task:
        task.cancel()

    run.status = "cancelled"
    db.commit()

    return run


def get_stage_durations(thread_id: str) -> list[dict]:
    """从 checkpoint 历史计算每个阶段的耗时"""
    _ensure_engine()

    config = {"configurable": {"thread_id": thread_id}}
    history = list(_graph.get_state_history(config))
    history.reverse()

    stages = {}
    for snapshot in history:
        stage = snapshot.values.get("current_stage")
        ts = snapshot.created_at
        if stage and stage not in stages:
            stages[stage] = {"start": ts, "status": "completed"}
        elif stage and "end" not in stages[stage]:
            stages[stage]["end"] = ts

    result = []
    for name in STAGE_ORDER:
        if name in stages:
            times = stages[name]
            duration = None
            if "end" in times and "start" in times:
                duration = (times["end"] - times["start"]).total_seconds()
            result.append({"name": name, "status": times.get("status", "completed"), "duration_sec": duration})

    return result


# 自定义异常
class ConflictError(Exception):
    pass

class NotFoundError(Exception):
    pass

class ValidationError(Exception):
    pass
```

- [ ] **Step 2: 验证可 import**

Run: `cd backend && uv run python -c "from app.services.workflow_service import start_workflow; print('OK')"`

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/workflow_service.py
git commit -m "feat(workflow): implement workflow service with start/resume/replay/fork/cancel"
```

---

### Task 2: 初始化工作流引擎

**Files:**
- Modify: `backend/main.py`

**Interfaces:**
- Produces: `init_workflow_engine()` called on startup

- [ ] **Step 1: 在 main.py 中初始化工作流引擎**

在 `backend/main.py` 的 startup 事件中添加：

```python
from app.services.workflow_service import init_workflow_engine
import os

@app.on_event("startup")
async def startup_event():
    # ... existing init ...
    
    # 初始化工作流引擎
    db_dir = os.path.dirname(os.path.abspath("voice_clone.db"))
    checkpoint_path = os.path.join(db_dir, "workflow_checkpoints.db")
    store_path = os.path.join(db_dir, "workflow_store.db")
    init_workflow_engine(checkpoint_path, store_path)
```

- [ ] **Step 2: Commit**

```bash
git add backend/main.py
git commit -m "feat(workflow): initialize workflow engine on startup"
```

---

### Task 3: 实现 workflow API 路由

**Files:**
- Create: `backend/app/api/workflow.py`

**Interfaces:**
- Produces: 8 个 REST 端点

- [ ] **Step 1: 创建 workflow.py API 路由**

```python
# backend/app/api/workflow.py
import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.workflow import (
    WorkflowRunOut, WorkflowStageOut,
    WorkflowStartRequest, WorkflowResumeRequest,
    WorkflowReplayRequest, WorkflowForkRequest,
)
from app.services import workflow_service
from app.services.workflow_service import ConflictError, NotFoundError, ValidationError

router = APIRouter()


def _run_to_out(run) -> WorkflowRunOut:
    stages = workflow_service.get_stage_durations(run.thread_id) if run.status in ["completed", "failed"] else []
    return WorkflowRunOut(
        id=run.id,
        project_id=run.project_id,
        thread_id=run.thread_id,
        status=run.status,
        current_stage=run.current_stage,
        stages=[WorkflowStageOut(**s) for s in stages],
        error=run.error,
        created_at=run.created_at,
        updated_at=run.updated_at,
    )


@router.post("/projects/{project_id}/workflow", response_model=WorkflowRunOut, status_code=201)
async def start_workflow(project_id: str, body: WorkflowStartRequest = None, db: Session = Depends(get_db)):
    try:
        run = await workflow_service.start_workflow(
            db, project_id,
            source_document=body.source_document if body else None
        )
        return _run_to_out(run)
    except ConflictError as e:
        raise HTTPException(409, str(e))
    except NotFoundError as e:
        raise HTTPException(404, str(e))


@router.get("/projects/{project_id}/workflow", response_model=list[WorkflowRunOut])
async def list_workflows(project_id: str, db: Session = Depends(get_db)):
    runs = db.query(WorkflowRun).filter(WorkflowRun.project_id == project_id).order_by(WorkflowRun.created_at.desc()).all()
    return [_run_to_out(r) for r in runs]


@router.get("/projects/{project_id}/workflow/{run_id}", response_model=WorkflowRunOut)
async def get_workflow(project_id: str, run_id: str, db: Session = Depends(get_db)):
    run = db.query(WorkflowRun).get(run_id)
    if not run or run.project_id != project_id:
        raise HTTPException(404, "工作流不存在")

    out = _run_to_out(run)

    # 如果是 interrupted 状态，附加 interrupt payload
    if run.status == "interrupted":
        graph = workflow_service.get_graph()
        config = {"configurable": {"thread_id": run.thread_id}}
        snapshot = graph.get_state(config)
        if snapshot.tasks:
            task = snapshot.tasks[0]
            if task.interrupts:
                out.interrupt_payload = task.interrupts[0].value

    return out


@router.get("/projects/{project_id}/workflow/{run_id}/stream")
async def stream_workflow(project_id: str, run_id: str, db: Session = Depends(get_db)):
    run = db.query(WorkflowRun).get(run_id)
    if not run or run.project_id != project_id:
        raise HTTPException(404, "工作流不存在")

    graph = workflow_service.get_graph()

    async def event_generator():
        config = {"configurable": {"thread_id": run.thread_id}}

        async for event in graph.astream_events(None, config, version="v3"):
            kind = event["event"]

            if kind == "on_chain_start":
                yield sse_event("stage_start", {
                    "stage": event["name"],
                    "run_id": run_id
                })

            elif kind == "on_chain_end":
                output = event["data"].get("output", {})
                yield sse_event("stage_complete", {
                    "stage": event["name"],
                    "output": _summarize_output(output)
                })

            elif kind == "on_chain_stream":
                yield sse_event("stage_progress", {
                    "stage": event["name"],
                    "chunk": event["data"].get("chunk", "")
                })

            elif kind == "on_interrupt":
                yield sse_event("interrupt", {
                    "stage": event["name"],
                    "payload": event["data"]["value"]
                })

            elif kind == "on_error":
                yield sse_event("error", {
                    "stage": event["name"],
                    "error": str(event["data"].get("error", ""))
                })

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


@router.post("/projects/{project_id}/workflow/{run_id}/resume", response_model=WorkflowRunOut)
async def resume_workflow(project_id: str, run_id: str, body: WorkflowResumeRequest, db: Session = Depends(get_db)):
    try:
        run = await workflow_service.resume_workflow(
            db, run_id, body.stage, body.action,
            edited_script=body.edited_script,
            comment=body.comment,
            feedback=body.feedback
        )
        return _run_to_out(run)
    except (ConflictError, ValidationError) as e:
        raise HTTPException(409, str(e))
    except NotFoundError as e:
        raise HTTPException(404, str(e))


@router.post("/projects/{project_id}/workflow/{run_id}/replay", response_model=WorkflowRunOut)
async def replay_workflow(project_id: str, run_id: str, body: WorkflowReplayRequest, db: Session = Depends(get_db)):
    try:
        run = await workflow_service.replay_workflow(db, run_id, body.from_stage)
        return _run_to_out(run)
    except ConflictError as e:
        raise HTTPException(409, str(e))
    except NotFoundError as e:
        raise HTTPException(404, str(e))


@router.post("/projects/{project_id}/workflow/{run_id}/fork", response_model=WorkflowRunOut)
async def fork_workflow(project_id: str, run_id: str, body: WorkflowForkRequest, db: Session = Depends(get_db)):
    try:
        run = await workflow_service.fork_workflow(db, run_id, body.from_stage, body.state_override)
        return _run_to_out(run)
    except ConflictError as e:
        raise HTTPException(409, str(e))
    except NotFoundError as e:
        raise HTTPException(404, str(e))


@router.delete("/projects/{project_id}/workflow/{run_id}", response_model=WorkflowRunOut)
async def cancel_workflow(project_id: str, run_id: str, db: Session = Depends(get_db)):
    try:
        run = await workflow_service.cancel_workflow(db, run_id)
        return _run_to_out(run)
    except ConflictError as e:
        raise HTTPException(409, str(e))
    except NotFoundError as e:
        raise HTTPException(404, str(e))


def sse_event(event_type: str, data: dict) -> str:
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _summarize_output(output: dict) -> dict:
    """提取输出摘要用于 SSE 事件"""
    if "narration_script" in output:
        return {"chapters_count": len(output.get("script_chapters", []))}
    if "review_feedback" in output:
        review = output["review_feedback"]
        if isinstance(review, dict):
            return {"overall_score": review.get("overall_score"), "has_critical_issue": review.get("has_critical_issue")}
        return {}
    if "structured_segments" in output:
        total = sum(len(ch.get("segments", [])) for ch in output["structured_segments"])
        return {"segments_count": total}
    if "synthesis_results" in output:
        total_duration = sum(r.get("duration_sec", 0) for r in output["synthesis_results"])
        return {"total_segments": len(output["synthesis_results"]), "total_duration_sec": total_duration}
    return {}


# 导入 WorkflowRun 用于查询
from app.models.workflow_run import WorkflowRun
```

- [ ] **Step 2: 注册路由到 main.py**

在 `backend/main.py` 中添加：

```python
from app.api import workflow
app.include_router(workflow.router, prefix="/api", tags=["workflow"])
```

- [ ] **Step 3: 验证路由注册**

Run: `cd backend && uv run python -c "from main import app; routes = [r.path for r in app.routes]; print('/api/projects/{project_id}/workflow' in routes)"`

Expected: `True`

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/workflow.py backend/main.py
git commit -m "feat(workflow): add workflow REST API with 8 endpoints and SSE streaming"
```

---

### Task 4: 添加 API 集成测试

**Files:**
- Create: `backend/tests/integration/test_workflow_api.py`

- [ ] **Step 1: 创建测试文件**

```python
# backend/tests/integration/test_workflow_api.py
import pytest
from app.models.segmented_project import SegmentedProject


@pytest.fixture
def sample_project(db_session):
    project = SegmentedProject(
        id="test-project-1",
        name="Test Project",
        source_document="# 测试标题\n这是一个测试文档。"
    )
    db_session.add(project)
    db_session.commit()
    return project


def test_start_workflow(client, sample_project):
    response = client.post(f"/api/projects/{sample_project.id}/workflow")
    assert response.status_code == 201
    data = response.json()
    assert data["status"] == "running"
    assert data["current_stage"] == "gen_script"
    assert "id" in data
    assert "thread_id" in data


def test_start_workflow_conflict(client, sample_project):
    # 启动第一个
    client.post(f"/api/projects/{sample_project.id}/workflow")
    # 第二个应该返回 409
    response = client.post(f"/api/projects/{sample_project.id}/workflow")
    assert response.status_code == 409


def test_list_workflows(client, sample_project):
    response = client.get(f"/api/projects/{sample_project.id}/workflow")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_get_workflow_not_found(client, sample_project):
    response = client.get(f"/api/projects/{sample_project.id}/workflow/nonexistent")
    assert response.status_code == 404


def test_cancel_workflow_not_found(client, sample_project):
    response = client.delete(f"/api/projects/{sample_project.id}/workflow/nonexistent")
    assert response.status_code == 404
```

- [ ] **Step 2: 运行测试**

Run: `cd backend && uv run --extra test pytest tests/integration/test_workflow_api.py -v`

Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add backend/tests/integration/test_workflow_api.py
git commit -m "test(workflow): add integration tests for workflow API"
```
