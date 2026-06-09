"""Business logic for segmented project CRUD and asset mirroring."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.core import segmented_assets as assets
from app.models.segmented_project import (
    SegmentedProject,
    SegmentedProjectChapter,
    SegmentedProjectSegment,
)
from app.schemas.segmented_project import (
    ChapterIn,
    ProjectDetail,
    ProjectIn,
    ProjectSummary,
    SegmentIn,
)

logger = logging.getLogger(__name__)


# ----- helpers -----

def _to_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.isoformat()
    return value.astimezone(timezone.utc).isoformat()


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


# ----- serialization -----

def project_to_summary(p: SegmentedProject) -> ProjectSummary:
    return ProjectSummary(
        id=p.id,
        name=p.name,
        schema_version=p.schema_version,
        layout=p.layout,
        active_chapter_id=p.active_chapter_id,
        created_at=_to_iso(p.created_at) or "",
        updated_at=_to_iso(p.updated_at) or "",
    )


def project_to_detail(p: SegmentedProject) -> ProjectDetail:
    chapters = []
    for ch in p.chapters:
        segs = [
            SegmentIn(
                id=s.id, position=s.position, text=s.text, ssml=s.ssml,
                emotion=s.emotion, params=s.params or {},
                locked_params=s.locked_params or [],
                generated_params=s.generated_params,
                current_audio_path=s.current_audio_path,
                previous_audio_path=s.previous_audio_path,
                audio_format=s.audio_format or "mp3",
                duration_sec=s.duration_sec,
                audio_missing=bool(s.audio_missing),
                generated_at=_to_iso(s.generated_at),
                ssml_annotated_by_llm=bool(s.ssml_annotated_by_llm),
                created_at=_to_iso(s.created_at),
                updated_at=_to_iso(s.updated_at),
            )
            for s in ch.segments
        ]
        chapters.append(
            ChapterIn(
                id=ch.id, position=ch.position, name=ch.name,
                engine=ch.engine,
                default_params=ch.default_params or {},
                split_config=ch.split_config or {},
                original_text=ch.original_text,
                created_at=_to_iso(ch.created_at),
                updated_at=_to_iso(ch.updated_at),
                segments=segs,
            )
        )
    return ProjectDetail(
        id=p.id, name=p.name, schema_version=p.schema_version,
        layout=p.layout, active_chapter_id=p.active_chapter_id,
        original_text=p.original_text,
        created_at=_to_iso(p.created_at),
        updated_at=_to_iso(p.updated_at),
        chapters=chapters,
    )


# ----- CRUD -----

def list_projects(db: Session) -> list[ProjectSummary]:
    rows = (
        db.query(SegmentedProject)
        .order_by(SegmentedProject.updated_at.desc())
        .all()
    )
    return [project_to_summary(p) for p in rows]


def get_project_detail(db: Session, project_id: str) -> ProjectDetail | None:
    p = db.query(SegmentedProject).filter_by(id=project_id).first()
    if p is None:
        return None
    return project_to_detail(p)


def get_project_row(db: Session, project_id: str) -> SegmentedProject | None:
    return db.query(SegmentedProject).filter_by(id=project_id).first()


def get_chapter_row(
    db: Session, project_id: str, chapter_id: str
) -> SegmentedProjectChapter | None:
    ch = (
        db.query(SegmentedProjectChapter)
        .filter_by(id=chapter_id, project_id=project_id)
        .first()
    )
    return ch


def get_segment_row(
    db: Session, project_id: str, chapter_id: str, segment_id: str
) -> SegmentedProjectSegment | None:
    seg = (
        db.query(SegmentedProjectSegment)
        .filter_by(id=segment_id, chapter_id=chapter_id, project_id=project_id)
        .first()
    )
    return seg


def save_project(db: Session, project: ProjectIn) -> ProjectDetail:
    """Full-state save: reconcile chapters/segments with DB. Filesystem mirrored after flush."""
    p = db.query(SegmentedProject).filter_by(id=project.id).first()
    if p is None:
        p = SegmentedProject(id=project.id)
        db.add(p)

    p.name = project.name
    p.schema_version = project.schema_version
    p.layout = project.layout
    p.active_chapter_id = project.active_chapter_id
    p.original_text = project.original_text
    if project.created_at:
        p.created_at = _parse_iso(project.created_at)
    p.updated_at = datetime.utcnow()

    # Chapters
    existing_chapters = {c.id: c for c in p.chapters}
    keep_chapter_ids: set[str] = set()
    for ch_in in project.chapters:
        ch = existing_chapters.get(ch_in.id)
        if ch is None:
            ch = SegmentedProjectChapter(id=ch_in.id, project_id=p.id)
            db.add(ch)
        ch.position = ch_in.position
        ch.name = ch_in.name
        ch.engine = ch_in.engine
        ch.default_params = ch_in.default_params or {}
        ch.split_config = ch_in.split_config or {}
        ch.original_text = ch_in.original_text
        if ch_in.created_at:
            ch.created_at = _parse_iso(ch_in.created_at)
        ch.updated_at = datetime.utcnow()
        keep_chapter_ids.add(ch_in.id)

        # Segments
        existing_segments = {s.id: s for s in ch.segments}
        keep_segment_ids: set[str] = set()
        for s_in in ch_in.segments:
            seg = existing_segments.get(s_in.id)
            if seg is None:
                seg = SegmentedProjectSegment(
                    id=s_in.id, chapter_id=ch.id, project_id=p.id,
                )
                db.add(seg)
            seg.position = s_in.position
            seg.text = s_in.text or ""
            seg.ssml = s_in.ssml
            seg.emotion = s_in.emotion
            seg.params = s_in.params or {}
            seg.locked_params = s_in.locked_params or []
            seg.generated_params = s_in.generated_params
            seg.current_audio_path = s_in.current_audio_path
            seg.previous_audio_path = s_in.previous_audio_path
            seg.audio_format = s_in.audio_format or "mp3"
            seg.duration_sec = s_in.duration_sec
            seg.audio_missing = bool(s_in.audio_missing)
            seg.generated_at = _parse_iso(s_in.generated_at)
            seg.ssml_annotated_by_llm = bool(s_in.ssml_annotated_by_llm)
            if s_in.created_at:
                seg.created_at = _parse_iso(s_in.created_at)
            seg.updated_at = datetime.utcnow()
            keep_segment_ids.add(s_in.id)

        # Remove orphan segments
        for seg in list(ch.segments):
            if seg.id not in keep_segment_ids:
                db.delete(seg)

    # Remove orphan chapters
    for ch in list(p.chapters):
        if ch.id not in keep_chapter_ids:
            db.delete(ch)

    db.flush()
    db.refresh(p)
    _mirror_to_filesystem(p, project)
    db.commit()
    return project_to_detail(p)


def _mirror_to_filesystem(p: SegmentedProject, project: ProjectIn) -> None:
    assets.write_original_text(p.id, p.original_text or "")
    for ch_in, ch in zip(project.chapters, p.chapters):
        assets.write_chapter_original_text(p.id, ch.id, ch.original_text or "")
        assets.ensure_project_layout(p.id, ch.id)
        for s_in in ch_in.segments:
            assets.write_segment_text(p.id, ch.id, s_in.id, s_in.text or "")
            if s_in.ssml is not None:
                assets.write_segment_ssml(p.id, ch.id, s_in.id, s_in.ssml)
    assets.write_manifest(p.id, project_to_detail(p).model_dump(mode="json"))


def delete_project(db: Session, project_id: str) -> bool:
    p = db.query(SegmentedProject).filter_by(id=project_id).first()
    if p is None:
        return False
    db.delete(p)
    db.commit()
    assets.remove_project_dir(project_id)
    return True


def update_segment_after_synth(
    db: Session,
    seg: SegmentedProjectSegment,
    *,
    current_audio_path: str,
    previous_audio_path: str | None,
    audio_format: str,
    duration_sec: float | None,
    generated_params: dict[str, Any],
) -> None:
    seg.current_audio_path = current_audio_path
    seg.previous_audio_path = previous_audio_path
    seg.audio_format = audio_format
    seg.duration_sec = duration_sec
    seg.generated_params = generated_params
    seg.generated_at = datetime.utcnow()
    seg.audio_missing = False
    seg.updated_at = datetime.utcnow()
    seg.chapter.updated_at = datetime.utcnow()
    seg.chapter.project.updated_at = datetime.utcnow()
    db.flush()
    assets.write_segment_text(seg.project_id, seg.chapter_id, seg.id, seg.text or "")
    if seg.ssml is not None:
        assets.write_segment_ssml(seg.project_id, seg.chapter_id, seg.id, seg.ssml)
    db.commit()
