"""Top-level snapshot pipeline.

Reads every SegmentedProject from the DB, serializes to the meta repo,
and commits if anything changed.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.segmented_project import SegmentedProject

from . import config
from .git_ops import add_all, commit, ensure_repo
from .serializer import write_project

log = logging.getLogger(__name__)


@dataclass
class SnapshotResult:
    commit_sha: str | None
    projects_snapshotted: int
    repo_path: Path


def snapshot_all(*, repo: Path | None = None, session: Session | None = None) -> SnapshotResult:
    """Run the full snapshot pipeline. Returns a result summary."""
    repo_dir = repo or config.repo_path()
    ensure_repo(
        repo_dir,
        author_name=config.author_name(),
        author_email=config.author_email(),
    )

    own_session = session is None
    session = session or SessionLocal()
    try:
        projects = session.query(SegmentedProject).all()
        for p in projects:
            write_project(p, repo_dir)

        add_all(repo_dir)
        message = _commit_message(projects)
        sha = commit(repo_dir, message)
        if sha:
            log.info("narration snapshot: %s (%d projects)", sha[:8], len(projects))
        else:
            log.info("narration snapshot: no changes")
        return SnapshotResult(
            commit_sha=sha,
            projects_snapshotted=len(projects),
            repo_path=repo_dir,
        )
    finally:
        if own_session:
            session.close()


def _commit_message(projects) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    lines = [f"snapshot: {len(projects)} project(s) ({ts})", "", "Projects:"]
    for p in projects:
        chapters = list(p.chapters or [])
        segments_total = sum(len(ch.segments or []) for ch in chapters)
        lines.append(f"- {p.id}: {len(chapters)} chapter(s), {segments_total} segment(s)")
    return "\n".join(lines) + "\n"
