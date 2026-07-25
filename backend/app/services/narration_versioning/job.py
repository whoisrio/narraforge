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
from .git_ops import add_all, commit, ensure_repo, push as git_push, GitError
from .serializer import write_project

log = logging.getLogger(__name__)


def _sweep_stale_project_dirs(repo: Path, current_ids: set[str], written: set[str]) -> None:
    """Remove project dirs that belong to projects in THIS database but were
    written under an outdated name (legacy DB-id dirs, pre-rename slugs).

    Dirs whose project.yaml id is NOT in ``current_ids`` belong to other
    databases sharing the repo (e.g. the e2e seed project) and are kept.
    """
    import shutil

    import yaml

    projects_root = repo / "projects"
    if not projects_root.exists():
        return
    for d in projects_root.iterdir():
        if not d.is_dir() or d.name in written:
            continue
        meta = d / "project.yaml"
        if not meta.exists():
            continue
        try:
            pid = (yaml.safe_load(meta.read_text(encoding="utf-8")) or {}).get("id")
        except yaml.YAMLError:
            continue
        if pid in current_ids:
            shutil.rmtree(d, ignore_errors=True)


@dataclass
class SnapshotResult:
    commit_sha: str | None
    projects_snapshotted: int
    repo_path: Path
    pushed: bool = False
    push_error: str | None = None


def snapshot_all(
    *,
    repo: Path | None = None,
    session: Session | None = None,
    remote_url: str | None = None,
) -> SnapshotResult:
    """Run the full snapshot pipeline. Returns a result summary.

    Serializes every project, commits if changed, and (when *remote_url* is
    non-empty) pushes to ``origin``. A push failure is recorded in
    ``push_error`` but does not undo the local commit.
    """
    repo_dir = repo or config.repo_path()
    ensure_repo(
        repo_dir,
        author_name=config.author_name(),
        author_email=config.author_email(),
    )

    own_session = session is None
    session = session or SessionLocal()
    try:
        projects = (
            session.query(SegmentedProject)
            .order_by(SegmentedProject.created_at)
            .all()
        )
        taken: set[str] = set()
        written: set[str] = set()
        for p in projects:
            d = write_project(p, repo_dir, taken)
            written.add(d.name)
        _sweep_stale_project_dirs(repo_dir, {p.id for p in projects}, written)

        add_all(repo_dir)
        message = _commit_message(projects)
        sha = commit(repo_dir, message)
        if sha:
            log.info("narration snapshot: %s (%d projects)", sha[:8], len(projects))
        else:
            log.info("narration snapshot: no changes")

        pushed = False
        push_error: str | None = None
        if remote_url:
            try:
                git_push(repo_dir, remote_url, branch="main")
                pushed = True
                log.info("narration snapshot pushed to %s", remote_url)
            except GitError as exc:
                push_error = str(exc)
                log.warning("narration snapshot push failed: %s", exc)

        return SnapshotResult(
            commit_sha=sha,
            projects_snapshotted=len(projects),
            repo_path=repo_dir,
            pushed=pushed,
            push_error=push_error,
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
