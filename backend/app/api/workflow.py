"""FastAPI routes for narration workflow lifecycle.

Provides 8 endpoints:
- POST   /projects/{pid}/workflow           — start a new run
- GET    /projects/{pid}/workflow            — list runs
- GET    /projects/{pid}/workflow/{rid}      — get single run (with interrupt payload)
- GET    /projects/{pid}/workflow/{rid}/stream — SSE event stream
- POST   /projects/{pid}/workflow/{rid}/resume  — resume after human review
- POST   /projects/{pid}/workflow/{rid}/replay  — replay from a stage
- POST   /projects/{pid}/workflow/{rid}/fork    — fork with state override
- DELETE /projects/{pid}/workflow/{rid}      — cancel
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.workflow_run import WorkflowRun
from app.schemas.workflow import (
    WorkflowForkRequest,
    WorkflowReplayRequest,
    WorkflowResumeRequest,
    WorkflowRunOut,
    WorkflowStageOut,
    WorkflowStartRequest,
)
from app.services import workflow_service
from app.services.workflow_service import ConflictError, NotFoundError, ValidationError

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _run_to_out(run: WorkflowRun) -> WorkflowRunOut:
    """Convert a ``WorkflowRun`` ORM instance to the Pydantic output schema."""
    stages = []
    # Only compute stage durations for completed runs; failed runs may have
    # no usable checkpoint history (e.g. from prior SqliteSaver errors).
    if run.status == "completed":
        try:
            stages = await workflow_service.get_stage_durations(run.thread_id)
        except Exception:
            logger.warning("Failed to get stage durations for run %s", run.id, exc_info=True)
        # Fallback: if checkpoint history is empty, return all stages as completed
        if not stages:
            stages = [{"name": name, "status": "completed", "duration_sec": None}
                      for name in workflow_service.STAGE_ORDER]
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


def _sse_event(event_type: str, data: dict[str, Any]) -> str:
    """Format a Server-Sent Event string."""
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _summarize_output(output: dict[str, Any]) -> dict[str, Any]:
    """Extract a lightweight summary from graph stage output for SSE events."""
    if "narration_script" in output:
        return {"chapters_count": len(output.get("script_chapters", []))}
    if "review_feedback" in output:
        review = output["review_feedback"]
        if isinstance(review, dict):
            return {
                "overall_score": review.get("overall_score"),
                "has_critical_issue": review.get("has_critical_issue"),
            }
        return {}
    if "structured_segments" in output:
        total = sum(
            len(ch.get("segments", [])) for ch in output["structured_segments"]
        )
        return {"segments_count": total}
    if "synthesis_results" in output:
        results = output["synthesis_results"]
        total_duration = sum(r.get("duration_sec", 0) for r in results)
        return {
            "total_segments": len(results),
            "total_duration_sec": total_duration,
        }
    return {}


def _get_run_scoped(db: Session, project_id: str, run_id: str) -> WorkflowRun:
    """Fetch a WorkflowRun and verify it belongs to *project_id*.

    Raises HTTPException(404) if not found or project mismatch.
    """
    run = db.get(WorkflowRun, run_id)
    if not run or run.project_id != project_id:
        raise HTTPException(status_code=404, detail="工作流不存在")
    return run


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/projects/{project_id}/workflow",
    response_model=WorkflowRunOut,
    status_code=201,
)
async def start_workflow(
    project_id: str,
    body: WorkflowStartRequest | None = None,
    db: Session = Depends(get_db),
):
    """Start a new narration workflow for *project_id*."""
    try:
        run = await workflow_service.start_workflow(
            db,
            project_id,
            source_document=body.source_document if body else None,
        )
        return await _run_to_out(run)
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get(
    "/projects/{project_id}/workflow",
    response_model=list[WorkflowRunOut],
)
async def list_workflows(
    project_id: str,
    db: Session = Depends(get_db),
):
    """List all workflow runs for *project_id*, newest first."""
    runs = (
        db.query(WorkflowRun)
        .filter(WorkflowRun.project_id == project_id)
        .order_by(WorkflowRun.created_at.desc())
        .all()
    )
    return [await _run_to_out(r) for r in runs]


@router.get(
    "/projects/{project_id}/workflow/{run_id}",
    response_model=WorkflowRunOut,
)
async def get_workflow(
    project_id: str,
    run_id: str,
    db: Session = Depends(get_db),
):
    """Get a single workflow run.

    When the run is in ``interrupted`` status the interrupt payload is
    attached so the frontend can present the human-review dialog.
    """
    run = _get_run_scoped(db, project_id, run_id)
    out = await _run_to_out(run)

    # Attach interrupt payload for interrupted runs.
    if run.status == "interrupted":
        graph = workflow_service.get_graph()
        if graph is not None:
            config = {"configurable": {"thread_id": run.thread_id}}
            snapshot = await graph.aget_state(config)
            if snapshot.tasks:
                task = snapshot.tasks[0]
                if task.interrupts:
                    out.interrupt_payload = task.interrupts[0].value

    return out


@router.get("/projects/{project_id}/workflow/{run_id}/stream")
async def stream_workflow(
    project_id: str,
    run_id: str,
    db: Session = Depends(get_db),
):
    """SSE stream of real-time workflow execution events.

    Combines database polling (for status changes) with real-time progress
    events from workflow nodes (via workflow_progress module).

    Events emitted:
    - ``progress``       — node-level progress update (llm_call, llm_response, etc.)
    - ``stage_start``    — a new stage has begun
    - ``stage_complete`` — a stage finished
    - ``interrupt``      — human review required (with payload)
    - ``workflow_complete`` — entire workflow completed
    - ``error``          — an error occurred
    """
    from app.services.workflow_progress import subscribe_progress, unsubscribe_progress, get_progress_history

    run = _get_run_scoped(db, project_id, run_id)

    async def event_generator():
        # Send any existing progress history
        for event in get_progress_history(run_id):
            yield _sse_event("progress", {
                "stage": event.stage,
                "event_type": event.event_type,
                "message": event.message,
                "data": event.data,
                "timestamp": event.timestamp,
            })

        # If already in a terminal state, emit final event and close
        if run.status in ("completed", "failed", "cancelled"):
            yield _sse_event("stage_complete", {
                "stage": run.current_stage,
                "output": {"status": run.status},
            })
            if run.status == "completed":
                yield _sse_event("workflow_complete", {
                    "run_id": run_id,
                    "status": run.status,
                })
            return

        # If interrupted, emit interrupt event with payload
        if run.status == "interrupted":
            graph = workflow_service.get_graph()
            if graph is not None:
                config = {"configurable": {"thread_id": run.thread_id}}
                try:
                    snapshot = await graph.aget_state(config)
                    if snapshot.tasks:
                        task = snapshot.tasks[0]
                        if task.interrupts:
                            yield _sse_event("interrupt", {
                                "stage": run.current_stage,
                                "payload": task.interrupts[0].value,
                            })
                except Exception:
                    logger.warning("Failed to get interrupt payload for SSE", exc_info=True)
            return

        # Subscribe to real-time progress events
        queue = await subscribe_progress(run_id)

        try:
            # Emit initial stage_start
            yield _sse_event("stage_start", {
                "stage": run.current_stage,
                "run_id": run_id,
            })

            last_status = run.status
            last_stage = run.current_stage

            # Main event loop: mix progress events with DB polling
            while True:
                try:
                    # Wait for progress event with timeout for DB polling
                    event = await asyncio.wait_for(queue.get(), timeout=2.0)
                    yield _sse_event("progress", {
                        "stage": event.stage,
                        "event_type": event.event_type,
                        "message": event.message,
                        "data": event.data,
                        "timestamp": event.timestamp,
                    })
                except asyncio.TimeoutError:
                    pass  # No progress event, do DB poll below

                # Poll DB for status changes
                db.refresh(run)

                # Stage changed
                if run.current_stage != last_stage:
                    yield _sse_event("stage_complete", {
                        "stage": last_stage,
                        "output": {},
                    })
                    yield _sse_event("stage_start", {
                        "stage": run.current_stage,
                        "run_id": run_id,
                    })
                    last_stage = run.current_stage

                # Terminal states
                if run.status in ("completed", "failed", "cancelled"):
                    yield _sse_event("stage_complete", {
                        "stage": run.current_stage,
                        "output": {"status": run.status},
                    })
                    if run.status == "completed":
                        yield _sse_event("workflow_complete", {
                            "run_id": run_id,
                            "status": run.status,
                        })
                    elif run.status == "failed" and run.error:
                        yield _sse_event("error", {
                            "stage": run.current_stage,
                            "error": run.error,
                        })
                    break

                # Interrupted
                if run.status == "interrupted":
                    graph = workflow_service.get_graph()
                    if graph is not None:
                        config = {"configurable": {"thread_id": run.thread_id}}
                        try:
                            snapshot = await graph.aget_state(config)
                            if snapshot.tasks:
                                task = snapshot.tasks[0]
                                if task.interrupts:
                                    yield _sse_event("interrupt", {
                                        "stage": run.current_stage,
                                        "payload": task.interrupts[0].value,
                                    })
                        except Exception:
                            logger.warning("Failed to get interrupt payload for SSE", exc_info=True)
                    break

                last_status = run.status
        finally:
            await unsubscribe_progress(run_id, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/projects/{project_id}/workflow/{run_id}/resume",
    response_model=WorkflowRunOut,
)
async def resume_workflow(
    project_id: str,
    run_id: str,
    body: WorkflowResumeRequest,
    db: Session = Depends(get_db),
):
    """Resume an interrupted workflow after human review."""
    # Validate project scope before delegating to service.
    _get_run_scoped(db, project_id, run_id)

    try:
        run = await workflow_service.resume_workflow(
            db,
            run_id,
            body.stage,
            body.action,
            edited_script=body.edited_script,
            comment=body.comment,
            feedback=body.feedback,
        )
        return await _run_to_out(run)
    except (ConflictError, ValidationError) as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post(
    "/projects/{project_id}/workflow/{run_id}/replay",
    response_model=WorkflowRunOut,
)
async def replay_workflow(
    project_id: str,
    run_id: str,
    body: WorkflowReplayRequest,
    db: Session = Depends(get_db),
):
    """Replay a completed or failed workflow from a specific stage."""
    _get_run_scoped(db, project_id, run_id)

    try:
        run = await workflow_service.replay_workflow(db, run_id, body.from_stage)
        return await _run_to_out(run)
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post(
    "/projects/{project_id}/workflow/{run_id}/fork",
    response_model=WorkflowRunOut,
)
async def fork_workflow(
    project_id: str,
    run_id: str,
    body: WorkflowForkRequest,
    db: Session = Depends(get_db),
):
    """Fork a workflow: overwrite state and re-run from a specific stage."""
    _get_run_scoped(db, project_id, run_id)

    try:
        run = await workflow_service.fork_workflow(
            db, run_id, body.from_stage, body.state_override
        )
        return await _run_to_out(run)
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete(
    "/projects/{project_id}/workflow/{run_id}",
    response_model=WorkflowRunOut,
)
async def cancel_workflow(
    project_id: str,
    run_id: str,
    db: Session = Depends(get_db),
):
    """Cancel a running or interrupted workflow."""
    _get_run_scoped(db, project_id, run_id)

    try:
        run = await workflow_service.cancel_workflow(db, run_id)
        return await _run_to_out(run)
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete(
    "/projects/{project_id}/workflow/{run_id}/delete",
    status_code=204,
)
async def delete_workflow(
    project_id: str,
    run_id: str,
    db: Session = Depends(get_db),
):
    """Delete a workflow run (any status)."""
    _get_run_scoped(db, project_id, run_id)

    try:
        await workflow_service.delete_workflow(db, run_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
