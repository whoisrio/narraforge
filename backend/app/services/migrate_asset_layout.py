"""One-shot migration: rename segmented-asset files to the human-readable layout.

Legacy layout (id-only):
    {project_id}/source.md
    {project_id}/narration.md
    {project_id}/chapters/{chapter_id}/original.txt
    {project_id}/chapters/{chapter_id}/segments/{segment_id}.{ext}

New layout (name + short id suffix):
    {project_id}/source-{project-name}-{project-id-short}.md
    {project_id}/narration-{project-name}-{project-id-short}.md
    {project_id}/chapters/chapter-{chapter-title}-{project-name}-{chapter-id-short}/
        original.txt
        segments/segment-{position:03d}-{segment-id-short}.{ext}

Rewrites in the DB:
- ``SegmentedProject.source_document_path`` / ``narration_document_path``
- ``SegmentedProjectSegment.audio["current"|"previous"]["path"]``
  (paths there are relative to ``settings.segmented_dir``)

Idempotent: safe to re-run — skips projects whose legacy artifacts are gone.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core import segmented_assets as assets
from app.core.config import settings
from app.models.segmented_project import SegmentedProject

logger = logging.getLogger(__name__)


@dataclass
class MigrationPlan:
    project_id: str
    # legacy file path -> new file path
    file_renames: dict[Path, Path] = field(default_factory=dict)
    # legacy chapter dir -> new chapter dir
    dir_renames: dict[Path, Path] = field(default_factory=dict)
    # segment audio DB path rewrites (relative to segmented_dir): old -> new
    audio_path_rewrites: dict[str, str] = field(default_factory=dict)
    # project-level DB document path rewrites (absolute): old -> new
    document_path_rewrites: dict[str, str] = field(default_factory=dict)

    @property
    def is_empty(self) -> bool:
        return not (
            self.file_renames
            or self.dir_renames
            or self.audio_path_rewrites
            or self.document_path_rewrites
        )


def plan_project_migration(db: Session, project_id: str) -> MigrationPlan:
    """Compute (without applying) the rename plan for a single project."""
    plan = MigrationPlan(project_id=project_id)
    p = db.query(SegmentedProject).filter_by(id=project_id).first()
    if p is None:
        return plan

    proj_dir = assets.project_dir(project_id)
    if not proj_dir.exists():
        return plan

    project_name = p.name or ""

    # ---- project-level source.md / narration.md ---------------------------
    legacy_src = proj_dir / "source.md"
    canonical_src = assets.source_document_path(project_id, project_name)
    if legacy_src.exists() and legacy_src != canonical_src:
        plan.file_renames[legacy_src] = canonical_src
    if p.source_document_path and Path(p.source_document_path) != canonical_src:
        plan.document_path_rewrites[p.source_document_path] = str(canonical_src)

    legacy_nar = proj_dir / "narration.md"
    canonical_nar = assets.narration_document_path(project_id, project_name)
    if legacy_nar.exists() and legacy_nar != canonical_nar:
        plan.file_renames[legacy_nar] = canonical_nar
    if p.narration_document_path and Path(p.narration_document_path) != canonical_nar:
        plan.document_path_rewrites[p.narration_document_path] = str(canonical_nar)

    # ---- chapter dirs + segment files -------------------------------------
    root = settings.segmented_dir
    for ch in p.chapters:
        chapter_title = ch.name or ""
        legacy_ch = proj_dir / "chapters" / ch.id
        new_ch = assets.chapter_dir(
            project_id, ch.id,
            chapter_title=chapter_title, project_name=project_name,
        )
        if legacy_ch.exists() and legacy_ch != new_ch:
            plan.dir_renames[legacy_ch] = new_ch

        # After (potential) chapter rename, compute segment file renames
        # against the *new* chapter dir so audio DB paths point at final home.
        for seg in ch.segments:
            position = seg.position or 0
            for ext in ("mp3", "wav", "txt", "ssml"):
                # legacy: within the still-existing legacy chapter dir
                legacy_seg = legacy_ch / "segments" / f"{seg.id}.{ext}"
                new_seg = new_ch / "segments" / (
                    assets.segment_basename(position=position, segment_id=seg.id) + f".{ext}"
                )
                if legacy_seg.exists() and legacy_seg != new_seg:
                    plan.file_renames[legacy_seg] = new_seg

            # DB audio path rewrites — check current + previous
            audio = seg.audio or {}
            if isinstance(audio, dict):
                for slot in ("current", "previous"):
                    entry = audio.get(slot)
                    if not (entry and isinstance(entry, dict)):
                        continue
                    old_rel = entry.get("path")
                    if not isinstance(old_rel, str) or not old_rel:
                        continue
                    fmt = entry.get("format") or Path(old_rel).suffix.lstrip(".") or "mp3"
                    new_abs = new_ch / "segments" / (
                        assets.segment_basename(position=position, segment_id=seg.id) + f".{fmt}"
                    )
                    try:
                        new_rel = new_abs.relative_to(root).as_posix()
                    except ValueError:
                        continue
                    if old_rel != new_rel:
                        plan.audio_path_rewrites[old_rel] = new_rel

    return plan


def _apply_plan(plan: MigrationPlan, db: Session) -> None:
    """Apply a plan: move dirs first, then residual files, then rewrite DB.

    Dirs are renamed before files so that files carried inside a renamed dir
    are already in place and don't collide with the explicit file-rename list.
    """
    # 1) Directory renames (parent-first ordering doesn't matter — each dir
    #    move is atomic at its own level; ``chapters/`` parent is never moved).
    for old, new in plan.dir_renames.items():
        if not old.exists():
            continue
        new.parent.mkdir(parents=True, exist_ok=True)
        if new.exists():
            # Another run beat us here; nothing to do.
            logger.warning("skip dir rename %s -> %s (target exists)", old, new)
            continue
        old.rename(new)
        logger.info("renamed dir %s -> %s", old, new)

    # 2) File renames — but many entries in ``file_renames`` were computed
    #    against legacy chapter paths that step 1 already moved. Fix up the
    #    source path by walking any parent dir rename that applies.
    dir_rename_pairs = list(plan.dir_renames.items())
    for old, new in plan.file_renames.items():
        src = old
        for old_dir, new_dir in dir_rename_pairs:
            try:
                rel = old.relative_to(old_dir)
            except ValueError:
                continue
            src = new_dir / rel
            break
        if not src.exists():
            continue
        new.parent.mkdir(parents=True, exist_ok=True)
        if new.exists():
            logger.warning("skip file rename %s -> %s (target exists)", src, new)
            continue
        src.rename(new)
        logger.info("renamed file %s -> %s", src, new)

    # 3) DB rewrites
    project = db.query(SegmentedProject).filter_by(id=plan.project_id).one()
    if project.source_document_path in plan.document_path_rewrites:
        project.source_document_path = plan.document_path_rewrites[project.source_document_path]
    if project.narration_document_path in plan.document_path_rewrites:
        project.narration_document_path = plan.document_path_rewrites[project.narration_document_path]

    for ch in project.chapters:
        for seg in ch.segments:
            audio = seg.audio
            if not isinstance(audio, dict):
                continue
            changed = False
            for slot in ("current", "previous"):
                entry = audio.get(slot)
                if not (entry and isinstance(entry, dict)):
                    continue
                old_rel = entry.get("path")
                if isinstance(old_rel, str) and old_rel in plan.audio_path_rewrites:
                    entry["path"] = plan.audio_path_rewrites[old_rel]
                    changed = True
            if changed:
                seg.audio = dict(audio)  # trigger SQLAlchemy JSON change detection
                flag_modified(seg, "audio")
    db.flush()


def migrate_all_projects(db: Session) -> dict:
    """Walk every project in the DB, plan+apply the rename. Idempotent."""
    projects = db.query(SegmentedProject).all()
    migrated = 0
    errors: list[str] = []
    for p in projects:
        try:
            plan = plan_project_migration(db, p.id)
            if plan.is_empty:
                continue
            _apply_plan(plan, db)
            migrated += 1
        except Exception as exc:  # noqa: BLE001 - report and continue
            logger.exception("migration failed for project %s", p.id)
            errors.append(f"{p.id}: {exc!r}")
    db.commit()
    return {"projects_scanned": len(projects), "projects_migrated": migrated, "errors": errors}
