"""APScheduler wiring for the daily snapshot job.

Uses BackgroundScheduler so it runs in-process without external services.
The job is idempotent and short-lived (seconds), so pause/resume across
restarts is unnecessary.
"""
from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from . import config
from .job import snapshot_all

log = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def start() -> None:
    global _scheduler
    if _scheduler is not None:
        log.debug("narration scheduler already running")
        return
    if not config.snapshot_enabled():
        log.info("narration snapshot disabled by env NARRATION_SNAPSHOT_ENABLED=0")
        return

    cron_expr = config.snapshot_cron()
    trigger = CronTrigger.from_crontab(cron_expr)
    sched = BackgroundScheduler(daemon=True)
    sched.add_job(
        _safe_snapshot,
        trigger=trigger,
        id="narration_snapshot",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    sched.start()
    _scheduler = sched
    log.info("narration snapshot scheduler started (cron=%r)", cron_expr)


def shutdown() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None


def _safe_snapshot() -> None:
    try:
        from app.core.database import SessionLocal
        from app.core.system_config_service import get_narration_git_remote
        session = SessionLocal()
        try:
            remote = get_narration_git_remote(session)
        finally:
            session.close()
        result = snapshot_all(remote_url=remote)
        log.info(
            "narration snapshot done: sha=%s, projects=%d, pushed=%s",
            (result.commit_sha or "no-op")[:8],
            result.projects_snapshotted,
            result.pushed,
        )
    except Exception:  # noqa: BLE001
        log.exception("narration snapshot failed")
