"""Workflow service — orchestrates narration workflow lifecycle.

Provides start, resume, replay, fork, cancel, and duration queries for
LangGraph-backed narration workflows.  Each workflow is tracked by a
``WorkflowRun`` row in the database and executed as a background
``asyncio.Task``.

Usage::

    # At application startup
    init_workflow_engine(checkpoint_path="checkpoints.db", store_path="store.db")

    # Start a workflow
    run = await start_workflow(db, project_id="abc")

    # Resume after human review
    run = await resume_workflow(db, run_id=run.id, stage="script_review",
                                action="approve", edited_script="...")
"""

from __future__ import annotations

import asyncio
import logging
import sqlite3
from datetime import datetime
from typing import Any
from uuid import uuid4

from langgraph.types import Command
from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.models.segmented_project import SegmentedProject
from app.models.workflow_run import WorkflowRun
from app.services.workflow_graph import STAGE_ORDER, create_narration_graph
from app.services.workflow_store import AsyncSqliteStore

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Custom exceptions
# ---------------------------------------------------------------------------


class ConflictError(Exception):
    """Raised when the workflow state conflicts with the requested action."""


class NotFoundError(Exception):
    """Raised when a workflow run or checkpoint cannot be found."""


class ValidationError(Exception):
    """Raised when input validation fails."""


# ---------------------------------------------------------------------------
# Module-level singletons — initialized by ``init_workflow_engine``.
# ---------------------------------------------------------------------------

_checkpointer: Any = None
_store: AsyncSqliteStore | None = None
_graph: Any = None
_running_tasks: dict[str, asyncio.Task] = {}


# ---------------------------------------------------------------------------
# Engine initialization
# ---------------------------------------------------------------------------


def init_workflow_engine(checkpoint_path: str, store_path: str) -> None:
    """Initialize the workflow engine (call once at application startup).

    Args:
        checkpoint_path: Filesystem path for the LangGraph checkpoint SQLite DB.
        store_path: Filesystem path for the AsyncSqliteStore SQLite DB.
    """
    global _checkpointer, _store, _graph

    import aiosqlite
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

    conn = aiosqlite.connect(checkpoint_path)
    _checkpointer = AsyncSqliteSaver(conn)
    _store = AsyncSqliteStore(store_path)
    _graph = create_narration_graph(_checkpointer, _store)

    logger.info(
        "Workflow engine initialized (checkpoint=%s, store=%s)",
        checkpoint_path,
        store_path,
    )


def get_graph() -> Any:
    """Return the compiled narration graph (or ``None`` if not initialized)."""
    return _graph


def _ensure_engine() -> None:
    """Guard that raises if the engine has not been initialized."""
    if _graph is None:
        raise RuntimeError(
            "Workflow engine not initialized. Call init_workflow_engine() first."
        )


# ---------------------------------------------------------------------------
# Public service functions
# ---------------------------------------------------------------------------


async def start_workflow(
    db: Session,
    project_id: str,
    source_document: str | None = None,
) -> WorkflowRun:
    """Start a new narration workflow for *project_id*.

    Raises ``ConflictError`` if the project already has an active (running or
    interrupted) workflow.  Raises ``NotFoundError`` if the project does not
    exist and no explicit *source_document* is provided.
    """
    _ensure_engine()

    # Reject if there is already an active workflow for this project.
    active = (
        db.query(WorkflowRun)
        .filter(
            and_(
                WorkflowRun.project_id == project_id,
                WorkflowRun.status.in_(["running", "interrupted"]),
            )
        )
        .first()
    )
    if active:
        raise ConflictError(
            f"项目已有运行中的工作流 (run_id={active.id})，"
            f"当前阶段: {active.current_stage}"
        )

    # Resolve source document.
    if not source_document:
        project = db.query(SegmentedProject).get(project_id)
        if not project:
            raise NotFoundError(f"项目不存在: {project_id}")
        source_document = project.source_document or ""

    # Create the WorkflowRun row.
    run_id = str(uuid4())
    thread_id = str(uuid4())

    run = WorkflowRun(
        id=run_id,
        project_id=project_id,
        thread_id=thread_id,
        status="running",
        current_stage="gen_script",
    )
    db.add(run)
    db.commit()

    # Kick off the background execution task.
    task = asyncio.create_task(
        _execute_workflow(run_id, thread_id, project_id, source_document)
    )
    _running_tasks[run_id] = task

    logger.info("Started workflow run %s for project %s", run_id, project_id)
    return run


async def get_workflow_runs(db: Session, project_id: str) -> list[WorkflowRun]:
    """Return all workflow runs for *project_id*, newest first."""
    return (
        db.query(WorkflowRun)
        .filter(WorkflowRun.project_id == project_id)
        .order_by(WorkflowRun.created_at.desc())
        .all()
    )


async def get_workflow_run(db: Session, run_id: str) -> WorkflowRun:
    """Return a single workflow run by *run_id*.

    Raises ``NotFoundError`` if the run does not exist.
    """
    run = db.query(WorkflowRun).get(run_id)
    if not run:
        raise NotFoundError(f"工作流不存在: {run_id}")
    return run


async def resume_workflow(
    db: Session,
    run_id: str,
    stage: str,
    action: str,
    edited_script: str | None = None,
    comment: str | None = None,
    feedback: str | None = None,
) -> WorkflowRun:
    """Resume an interrupted workflow after human review.

    Args:
        db: Database session.
        run_id: The workflow run to resume.
        stage: The stage being reviewed (must match ``current_stage``).
        action: ``"approve"`` or ``"reject"``.
        edited_script: Optional edited script (on approve).
        comment: Optional reviewer comment (on approve).
        feedback: Required rejection feedback (on reject).

    Raises:
        NotFoundError: If the run does not exist.
        ConflictError: If the run is not in ``interrupted`` status or the
            requested *stage* does not match ``current_stage``.
        ValidationError: If rejecting without providing *feedback*.
    """
    _ensure_engine()

    run = db.query(WorkflowRun).get(run_id)
    if not run:
        raise NotFoundError(f"工作流不存在: {run_id}")
    if run.status != "interrupted":
        raise ConflictError(f"工作流状态为 {run.status}，无法恢复")
    if run.current_stage != stage:
        raise ConflictError(
            f"当前阶段为 {run.current_stage}，请求的 stage 为 {stage}"
        )

    # Build the decision payload.
    if action == "approve":
        decision: dict[str, Any] = {
            "action": "approve",
            "edited_script": edited_script or "",
            "comment": comment or "",
        }
    else:
        if not feedback:
            raise ValidationError("拒绝时必须填写 feedback")
        decision = {"action": "reject", "feedback": feedback}

    # Mark as running and kick off background resume.
    config = {"configurable": {"thread_id": run.thread_id}}
    task = asyncio.create_task(_resume_workflow(run_id, config, decision))
    _running_tasks[run_id] = task

    run.status = "running"
    db.commit()

    logger.info("Resumed workflow run %s (stage=%s, action=%s)", run_id, stage, action)
    return run


async def replay_workflow(
    db: Session, run_id: str, from_stage: str
) -> WorkflowRun:
    """Replay a completed or failed workflow from *from_stage*.

    Finds the checkpoint snapshot just before *from_stage* and re-invokes the
    graph from that point.

    Raises:
        NotFoundError: If the run or target checkpoint does not exist.
        ConflictError: If the run is not in a replayable state.
        ValidationError: If *from_stage* is not a valid stage name.
    """
    _ensure_engine()

    run = db.query(WorkflowRun).get(run_id)
    if not run:
        raise NotFoundError(f"工作流不存在: {run_id}")
    if run.status not in ("completed", "failed"):
        raise ConflictError(f"工作流状态为 {run.status}，无法重放")
    if from_stage not in STAGE_ORDER:
        raise ValidationError(f"无效的阶段: {from_stage}")

    # Walk the checkpoint history to find the snapshot whose ``next`` matches
    # from_stage (i.e. the checkpoint *just before* that stage would execute).
    config = {"configurable": {"thread_id": run.thread_id}}
    history = list(_graph.get_state_history(config))

    target = None
    for snapshot in history:
        if snapshot.next and snapshot.next[0] == from_stage:
            target = snapshot
            break

    if not target:
        raise NotFoundError(f"未找到阶段 {from_stage} 的 checkpoint")

    # Update run status and launch background replay.
    run.status = "running"
    run.current_stage = from_stage
    db.commit()

    task = asyncio.create_task(_replay_workflow(run_id, target.config))
    _running_tasks[run_id] = task

    logger.info("Replaying workflow run %s from stage %s", run_id, from_stage)
    return run


async def fork_workflow(
    db: Session,
    run_id: str,
    from_stage: str,
    state_override: dict[str, Any],
) -> WorkflowRun:
    """Fork a completed/failed workflow: overwrite state and re-run from *from_stage*.

    Similar to ``replay_workflow`` but applies *state_override* to the target
    checkpoint before re-invoking, allowing the user to modify script text,
    segment data, etc.

    Raises:
        NotFoundError: If the run or target checkpoint does not exist.
        ConflictError: If the run is not in a forkable state.
    """
    _ensure_engine()

    run = db.query(WorkflowRun).get(run_id)
    if not run:
        raise NotFoundError(f"工作流不存在: {run_id}")
    if run.status not in ("completed", "failed"):
        raise ConflictError(f"工作流状态为 {run.status}，无法分支")

    # Find the target checkpoint.
    config = {"configurable": {"thread_id": run.thread_id}}
    history = list(_graph.get_state_history(config))

    target = None
    for snapshot in history:
        if snapshot.next and snapshot.next[0] == from_stage:
            target = snapshot
            break

    if not target:
        raise NotFoundError(f"未找到阶段 {from_stage} 的 checkpoint")

    # Fork: apply the state override to create a new checkpoint branch.
    fork_config = _graph.update_state(target.config, values=state_override)

    # Update run status and launch background replay from the forked state.
    run.status = "running"
    run.current_stage = from_stage
    db.commit()

    task = asyncio.create_task(_replay_workflow(run_id, fork_config))
    _running_tasks[run_id] = task

    logger.info(
        "Forked workflow run %s from stage %s with state override", run_id, from_stage
    )
    return run


async def cancel_workflow(db: Session, run_id: str) -> WorkflowRun:
    """Cancel a running or interrupted workflow.

    Raises:
        NotFoundError: If the run does not exist.
        ConflictError: If the run is not in a cancellable state.
    """
    run = db.query(WorkflowRun).get(run_id)
    if not run:
        raise NotFoundError(f"工作流不存在: {run_id}")
    if run.status not in ("running", "interrupted"):
        raise ConflictError(f"工作流状态为 {run.status}，无法取消")

    # Cancel the background asyncio task if it is still running.
    task = _running_tasks.get(run_id)
    if task:
        task.cancel()

    run.status = "cancelled"
    db.commit()

    logger.info("Cancelled workflow run %s", run_id)
    return run


async def delete_workflow(db: Session, run_id: str) -> None:
    """Delete a workflow run (any status).

    Raises:
        NotFoundError: If the run does not exist.
    """
    run = db.query(WorkflowRun).get(run_id)
    if not run:
        raise NotFoundError(f"工作流不存在: {run_id}")

    # Cancel the background asyncio task if it is still running.
    task = _running_tasks.get(run_id)
    if task:
        task.cancel()

    db.delete(run)
    db.commit()

    logger.info("Deleted workflow run %s", run_id)


async def get_stage_durations(thread_id: str) -> list[dict[str, Any]]:
    """Compute per-stage wall-clock durations from the checkpoint history.

    Args:
        thread_id: The LangGraph thread ID associated with a workflow run.

    Returns:
        A list of dicts ordered by ``STAGE_ORDER``, each containing:
        ``name`` (str), ``status`` (str), ``duration_sec`` (float | None).
    """
    _ensure_engine()

    config = {"configurable": {"thread_id": thread_id}}
    history = [s async for s in _graph.aget_state_history(config)]
    history.reverse()

    # Collect first-seen start and end timestamps per stage.
    stages: dict[str, dict[str, Any]] = {}
    for snapshot in history:
        stage = snapshot.values.get("current_stage")
        ts = snapshot.created_at
        if stage and stage not in stages:
            stages[stage] = {"start": ts, "status": "completed"}
        elif stage and "end" not in stages[stage]:
            stages[stage]["end"] = ts

    result: list[dict[str, Any]] = []
    for name in STAGE_ORDER:
        if name in stages:
            times = stages[name]
            duration: float | None = None
            if "end" in times and "start" in times:
                duration = (times["end"] - times["start"]).total_seconds()
            result.append(
                {
                    "name": name,
                    "status": times.get("status", "completed"),
                    "duration_sec": duration,
                }
            )

    return result


# ---------------------------------------------------------------------------
# Internal background task helpers
# ---------------------------------------------------------------------------


async def _execute_workflow(
    run_id: str,
    thread_id: str,
    project_id: str,
    source_document: str,
) -> None:
    """Background task: invoke the full narration graph from the start."""
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        state: dict[str, Any] = {
            "project_id": project_id,
            "run_id": run_id,
            "source_document": source_document,
            "current_stage": "gen_script",
            "error": None,
        }
        config = {"configurable": {"thread_id": thread_id}}

        logger.info("Workflow run %s: starting ainvoke", run_id)
        result = await _graph.ainvoke(state, config)
        logger.info("Workflow run %s: ainvoke returned, result keys: %s", run_id, list(result.keys()) if isinstance(result, dict) else type(result))

        # Check if the graph was interrupted (human-in-the-loop)
        if isinstance(result, dict) and "__interrupt__" in result:
            logger.info("Workflow run %s interrupted at stage %s", run_id, state.get("current_stage"))
            run = db.query(WorkflowRun).get(run_id)
            if run:
                run.status = "interrupted"
                db.commit()
        else:
            # If we reach here the graph completed without interruption.
            run = db.query(WorkflowRun).get(run_id)
            if run and run.status != "cancelled":
                run.status = "completed"
                run.current_stage = "completed"
                db.commit()

    except asyncio.CancelledError:
        run = db.query(WorkflowRun).get(run_id)
        if run:
            run.status = "cancelled"
            db.commit()

    except Exception as exc:
        # Check if this is a GraphInterrupt (expected for human-in-the-loop)
        from langgraph.errors import GraphInterrupt
        if isinstance(exc, GraphInterrupt):
            logger.info("Workflow run %s interrupted at stage %s", run_id, state.get("current_stage"))
            run = db.query(WorkflowRun).get(run_id)
            if run:
                run.status = "interrupted"
                db.commit()
        else:
            logger.exception("Workflow run %s failed", run_id)
            run = db.query(WorkflowRun).get(run_id)
            if run:
                run.status = "failed"
                run.error = str(exc)
                db.commit()

    finally:
        _running_tasks.pop(run_id, None)
        db.close()


async def _resume_workflow(
    run_id: str, config: dict[str, Any], decision: dict[str, Any]
) -> None:
    """Background task: resume an interrupted graph with a human decision."""
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        await _graph.ainvoke(Command(resume=decision), config)

        # Determine the new state after resumption.
        run = db.query(WorkflowRun).get(run_id)
        if run and run.status != "cancelled":
            snapshot = await _graph.aget_state(config)
            if snapshot.next:
                # Another interrupt ahead — mark as interrupted.
                run.status = "interrupted"
                run.current_stage = snapshot.values.get(
                    "current_stage", run.current_stage
                )
            else:
                run.status = "completed"
                run.current_stage = "completed"
            db.commit()

    except asyncio.CancelledError:
        run = db.query(WorkflowRun).get(run_id)
        if run:
            run.status = "cancelled"
            db.commit()

    except Exception as exc:
        logger.exception("Workflow resume %s failed", run_id)
        run = db.query(WorkflowRun).get(run_id)
        if run:
            run.status = "failed"
            run.error = str(exc)
            db.commit()

    finally:
        _running_tasks.pop(run_id, None)
        db.close()


async def _replay_workflow(
    run_id: str, checkpoint_config: dict[str, Any]
) -> None:
    """Background task: replay a graph from a specific checkpoint."""
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        await _graph.ainvoke(None, checkpoint_config)

        run = db.query(WorkflowRun).get(run_id)
        if run and run.status != "cancelled":
            run.status = "completed"
            db.commit()

    except asyncio.CancelledError:
        run = db.query(WorkflowRun).get(run_id)
        if run:
            run.status = "cancelled"
            db.commit()

    except Exception as exc:
        logger.exception("Workflow replay %s failed", run_id)
        run = db.query(WorkflowRun).get(run_id)
        if run:
            run.status = "failed"
            run.error = str(exc)
            db.commit()

    finally:
        _running_tasks.pop(run_id, None)
        db.close()
