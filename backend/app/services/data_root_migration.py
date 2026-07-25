"""One-shot migration: unified data root + plan-B asset naming.

Moves per-project asset directories from the legacy root
(``uploads/segmented/{project-id}``) to the new root
(``settings.segmented_dir`` = ``data/projects/{project-slug}``), renames
chapter dirs to raw chapter ids, renames segment files to raw segment ids,
and rewrites the DB-stored paths accordingly.

Two-phase: :func:`plan_migration` computes everything without touching
disk or DB; :func:`apply_migration` executes. Idempotent: projects whose
legacy dir is gone (or already migrated) are skipped.
"""
from __future__ import annotations

import copy
import logging
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy.orm import Session

from app.core import segmented_assets as assets
from app.core.config import settings
from app.models.segmented_project import SegmentedProject

log = logging.getLogger(__name__)

LEGACY_ROOT = Path(__file__).parent.parent.parent / "uploads" / "segmented"


@dataclass
class ProjectPlan:
    project_id: str
    slug_dir: Path
    dir_moves: dict[Path, Path] = field(default_factory=dict)   # abs -> abs
    file_moves: dict[Path, Path] = field(default_factory=dict)  # abs -> abs
    audio_rewrites: dict[str, str] = field(default_factory=dict)  # rel old -> rel new
    doc_rewrites: dict[str, str] = field(default_factory=dict)    # abs old -> abs new
    skipped_reason: str | None = None
    notes: list[str] = field(default_factory=list)


def _chapter_dirs_by_suffix(project_dir: Path, suffix: str) -> list[Path]:
    chapters_root = project_dir / "chapters"
    if not chapters_root.exists():
        return []
    return [d for d in chapters_root.iterdir() if d.is_dir() and d.name.endswith(suffix)]


def plan_project(project: SegmentedProject, legacy_root: Path | None = None) -> ProjectPlan:
    legacy_root = legacy_root or LEGACY_ROOT
    new_dir = assets.project_dir(project.id, project.name)
    plan = ProjectPlan(project_id=project.id, slug_dir=new_dir)

    old_dir = legacy_root / project.id
    if not old_dir.exists():
        plan.skipped_reason = "no legacy dir"
        return plan
    if old_dir == new_dir:
        plan.skipped_reason = "already migrated"
        return plan
    if new_dir.exists():
        plan.notes.append(f"target exists, merging into {new_dir}")

    plan.dir_moves[old_dir] = new_dir

    for ch in project.chapters:
        suffix = f"-{assets.short_id(ch.id)}"
        new_ch_dir = new_dir / "chapters" / ch.id
        for seg in ch.segments:
            audio = seg.audio if isinstance(seg.audio, dict) else None
            if not audio:
                continue
            for slot in ("current", "previous"):
                entry = audio.get(slot)
                if not isinstance(entry, dict):
                    continue
                rel = entry.get("path")
                if not isinstance(rel, str) or not rel:
                    continue
                old_abs = legacy_root / rel
                fmt = entry.get("format") or Path(rel).suffix.lstrip(".") or "mp3"
                new_abs = new_ch_dir / "segments" / f"{seg.id}.{fmt}"
                new_rel = f"{new_dir.name}/chapters/{ch.id}/segments/{seg.id}.{fmt}"
                if old_abs != new_abs:
                    plan.file_moves[old_abs] = new_abs
                    plan.audio_rewrites[rel] = new_rel

        # legacy chapter dirs for this chapter (rename history may create several)
        for d in _chapter_dirs_by_suffix(old_dir, suffix):
            if not d.is_dir():
                continue
            for f in d.rglob("*"):
                if f.is_file():
                    rel_target = new_ch_dir / f.relative_to(d)
                    if f not in plan.file_moves:
                        plan.file_moves[f] = rel_target

    for attr in ("source_document_path", "narration_document_path"):
        stored = getattr(project, attr, None)
        if isinstance(stored, str) and stored.startswith(str(old_dir)):
            plan.doc_rewrites[stored] = str(new_dir) + stored[len(str(old_dir)):]

    return plan


def plan_migration(session: Session, legacy_root: Path | None = None) -> list[ProjectPlan]:
    projects = session.query(SegmentedProject).order_by(SegmentedProject.created_at).all()
    return [plan_project(p, legacy_root) for p in projects]


def apply_project(db: Session, project: SegmentedProject, plan: ProjectPlan) -> None:
    if plan.skipped_reason:
        return

    # 1) file moves (most specific first; skip missing sources)
    for src, dst in sorted(plan.file_moves.items(), key=lambda kv: len(str(kv[0]))):
        if not src.exists():
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        if not dst.exists():
            shutil.move(str(src), str(dst))

    # 2) dir move for anything left (manifest, original.txt, etc.)
    for src, dst in plan.dir_moves.items():
        if not src.exists():
            continue
        if not dst.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))
        else:
            # merge leftovers, then drop the legacy dir
            for f in sorted(src.rglob("*")):
                if f.is_file():
                    target = dst / f.relative_to(src)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    if not target.exists():
                        shutil.move(str(f), str(target))
            shutil.rmtree(src, ignore_errors=True)

    # 3) DB rewrites (deepcopy — plain dict() shallow copies are silently dropped)
    for ch in project.chapters:
        for seg in ch.segments:
            audio = seg.audio if isinstance(seg.audio, dict) else None
            if not audio:
                continue
            updated = copy.deepcopy(audio)
            changed = False
            for slot in ("current", "previous"):
                entry = updated.get(slot)
                if isinstance(entry, dict) and entry.get("path") in plan.audio_rewrites:
                    entry["path"] = plan.audio_rewrites[entry["path"]]
                    changed = True
            if changed:
                seg.audio = updated
    for attr in ("source_document_path", "narration_document_path"):
        stored = getattr(project, attr, None)
        if isinstance(stored, str) and stored in plan.doc_rewrites:
            setattr(project, attr, plan.doc_rewrites[stored])


def apply_migration(db: Session, plans: list[ProjectPlan] | None = None) -> list[ProjectPlan]:
    plans = plans if plans is not None else plan_migration(db)
    projects = {p.id: p for p in db.query(SegmentedProject).all()}
    for plan in plans:
        project = projects.get(plan.project_id)
        if project is not None:
            apply_project(db, project, plan)
    db.commit()
    return plans
