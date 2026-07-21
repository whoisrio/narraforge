"""One-shot migration: assign semantic IDs to legacy projects/chapters/segments.

Idempotent — rows already conforming are skipped. Slug collisions resolved
by suffixing a short blake2s hash of the original id.

Runs inside a single transaction. On SQLite, temporarily disables FK
enforcement so PK updates can propagate before we rewrite child FKs.
"""
from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.segmented_project import SegmentedProject
from .ids import (
    project_slug, chapter_id,
    is_valid_slug, is_valid_segment_id,
)

log = logging.getLogger(__name__)


@dataclass
class MigrationResult:
    projects_migrated: int
    chapters_migrated: int
    segments_migrated: int


def _short_hash(s: str) -> str:
    return hashlib.blake2s(s.encode("utf-8"), digest_size=2).hexdigest()


def _unique(base: str, taken: set[str], legacy_id: str) -> str:
    if base not in taken:
        return base
    candidate = f"{base}-{_short_hash(legacy_id)}"
    n = 1
    while candidate in taken:
        candidate = f"{base}-{_short_hash(legacy_id)}-{n}"
        n += 1
    return candidate


def migrate_ids(*, session: Session, dry_run: bool = False) -> MigrationResult:
    projects = session.query(SegmentedProject).order_by(SegmentedProject.created_at).all()
    taken_project_ids = {p.id for p in projects}

    project_rename: dict[str, str] = {}
    for p in projects:
        base = project_slug(p.name)
        if is_valid_slug(p.id) and p.id == base:
            continue
        new_id = _unique(base, taken_project_ids - {p.id}, p.id)
        if new_id != p.id:
            project_rename[p.id] = new_id
            taken_project_ids.discard(p.id)
            taken_project_ids.add(new_id)

    chapter_rename: dict[str, str] = {}
    segment_rename: dict[str, str] = {}
    for p in projects:
        chapters = sorted(p.chapters, key=lambda c: (c.position, c.created_at or ""))
        taken_ch = {c.id for c in chapters}
        for pos_1based, ch in enumerate(chapters, start=1):
            wanted = chapter_id(pos_1based, ch.design_title or ch.name)
            if not (is_valid_slug(ch.id) and ch.id == wanted):
                new_ch_id = _unique(wanted, taken_ch - {ch.id}, ch.id)
                if new_ch_id != ch.id:
                    chapter_rename[ch.id] = new_ch_id
                    taken_ch.discard(ch.id); taken_ch.add(new_ch_id)

            segs = sorted(ch.segments, key=lambda s: s.position)
            existing_ids = [s.id for s in segs]
            wanted_ids = [f"s{i:03d}" for i in range(1, len(segs) + 1)]
            if existing_ids != wanted_ids:
                for old_id, new_id in zip(existing_ids, wanted_ids):
                    if old_id != new_id:
                        segment_rename[old_id] = new_id

    result = MigrationResult(
        projects_migrated=len(project_rename),
        chapters_migrated=len(chapter_rename),
        segments_migrated=len(segment_rename),
    )

    if dry_run or not (project_rename or chapter_rename or segment_rename):
        return result

    _apply(session, project_rename, chapter_rename, segment_rename)
    session.commit()
    return result


def _apply(session: Session, project_rename, chapter_rename, segment_rename) -> None:
    is_sqlite = session.bind.dialect.name == "sqlite"
    if is_sqlite:
        session.execute(text("PRAGMA foreign_keys = OFF"))
    try:
        for old, new in project_rename.items():
            session.execute(text("UPDATE segmented_projects SET id = :new WHERE id = :old"),
                            {"new": new, "old": old})
            session.execute(text("UPDATE segmented_project_chapters SET project_id = :new WHERE project_id = :old"),
                            {"new": new, "old": old})
        for old, new in chapter_rename.items():
            session.execute(text("UPDATE segmented_project_chapters SET id = :new WHERE id = :old"),
                            {"new": new, "old": old})
            session.execute(text("UPDATE segmented_project_segments SET chapter_id = :new WHERE chapter_id = :old"),
                            {"new": new, "old": old})
        for old, new in segment_rename.items():
            session.execute(text("UPDATE segmented_project_segments SET id = :new WHERE id = :old"),
                            {"new": new, "old": old})
    finally:
        if is_sqlite:
            session.execute(text("PRAGMA foreign_keys = ON"))
