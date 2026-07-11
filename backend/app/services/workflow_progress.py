"""Workflow progress tracking for real-time SSE updates.

Provides a shared progress store that workflow nodes can write to,
and the SSE endpoint can read from for real-time updates.
"""
from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class ProgressEvent:
    """A single progress event from a workflow node."""
    run_id: str
    stage: str
    event_type: str  # 'stage_start', 'llm_call', 'llm_response', 'node_output', 'stage_complete', 'error'
    message: str
    data: dict[str, Any] = field(default_factory=dict)
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# In-memory progress store: run_id -> list of events
_progress_store: dict[str, list[ProgressEvent]] = defaultdict(list)

# Event queues for SSE subscribers: run_id -> set of asyncio.Queues
_subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)

# Lock for thread-safe access
_lock = asyncio.Lock()


async def emit_progress(
    run_id: str,
    stage: str,
    event_type: str,
    message: str,
    data: dict[str, Any] | None = None,
) -> None:
    """Emit a progress event for a workflow run.

    Called by workflow nodes to report progress.
    Notifies all SSE subscribers for this run.
    """
    event = ProgressEvent(
        run_id=run_id,
        stage=stage,
        event_type=event_type,
        message=message,
        data=data or {},
    )

    async with _lock:
        _progress_store[run_id].append(event)

        # Notify all subscribers
        for queue in _subscribers.get(run_id, set()):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning("Progress queue full for run %s, dropping event", run_id)

    logger.debug("Progress[%s] %s/%s: %s", run_id[:8], stage, event_type, message)


def get_progress_history(run_id: str) -> list[ProgressEvent]:
    """Get all progress events for a run (for initial state)."""
    return list(_progress_store.get(run_id, []))


async def subscribe_progress(run_id: str) -> asyncio.Queue:
    """Subscribe to progress events for a run.

    Returns an asyncio.Queue that will receive ProgressEvent objects.
    Call unsubscribe_progress when done.
    """
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)

    async with _lock:
        _subscribers[run_id].add(queue)

    return queue


async def unsubscribe_progress(run_id: str, queue: asyncio.Queue) -> None:
    """Unsubscribe from progress events."""
    async with _lock:
        subscribers = _subscribers.get(run_id, set())
        subscribers.discard(queue)
        if not subscribers:
            _subscribers.pop(run_id, None)


async def cleanup_progress(run_id: str) -> None:
    """Clean up progress data for a run (call after completion)."""
    async with _lock:
        _progress_store.pop(run_id, None)
        _subscribers.pop(run_id, None)


def get_active_runs() -> list[str]:
    """Get list of run IDs with active subscribers."""
    return list(_subscribers.keys())
