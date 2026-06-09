"""FastAPI routes for the segmented project editor (backend storage mode)."""
from __future__ import annotations

import base64
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core import segmented_assets as assets
from app.core.config import settings
from app.core.database import get_db
from app.core.segmented_assets import project_dir
from app.schemas.segmented_project import (
    MigrateAudioItem,
    MigrateRequest,
    MigrateResponse,
    MigrateResultItem,
    ProjectDetail,
    ProjectIn,
    ProjectSummary,
    SplitItem,
    SplitRequest,
    SplitResponse,
    SynthesizeSegmentRequest,
)
from app.services import segmented_project_service as svc

logger = logging.getLogger(__name__)
router = APIRouter()


# ----- project CRUD -----

@router.get("/segmented-projects", response_model=list[ProjectSummary])
def list_projects(db: Session = Depends(get_db)):
    return svc.list_projects(db)


@router.post("/segmented-projects", response_model=ProjectDetail, status_code=201)
def create_project(project: ProjectIn, db: Session = Depends(get_db)):
    existing = svc.get_project_row(db, project.id)
    if existing is not None:
        raise HTTPException(status_code=409, detail="project_already_exists")
    return svc.save_project(db, project)


@router.get("/segmented-projects/{project_id}", response_model=ProjectDetail)
def get_project(project_id: str, db: Session = Depends(get_db)):
    detail = svc.get_project_detail(db, project_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="project_not_found")
    return detail


@router.put("/segmented-projects/{project_id}", response_model=ProjectDetail)
def put_project(project_id: str, project: ProjectIn, db: Session = Depends(get_db)):
    if project.id != project_id:
        raise HTTPException(status_code=400, detail="id_mismatch")
    return svc.save_project(db, project)


@router.delete("/segmented-projects/{project_id}", status_code=204)
def delete_project(project_id: str, db: Session = Depends(get_db)):
    ok = svc.delete_project(db, project_id)
    if not ok:
        raise HTTPException(status_code=404, detail="project_not_found")
    return None


# ----- segment audio -----

@router.post(
    "/segmented-projects/{project_id}/chapters/{chapter_id}/segments/{segment_id}/synthesize",
    response_model=ProjectDetail,
)
def synthesize_segment(
    project_id: str,
    chapter_id: str,
    segment_id: str,
    body: SynthesizeSegmentRequest,
    db: Session = Depends(get_db),
):
    try:
        svc.synthesize_segment(
            db,
            project_id=project_id,
            chapter_id=chapter_id,
            segment_id=segment_id,
            request_params=body.params,
            text_override=body.text,
            ssml_override=body.ssml,
            keep_previous=body.keep_previous,
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="segment_not_found")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    detail = svc.get_project_detail(db, project_id)
    assert detail is not None
    return detail


@router.get(
    "/segmented-projects/{project_id}/audio/{chapter_id}/{segment_id}"
)
def get_segment_audio(
    project_id: str,
    chapter_id: str,
    segment_id: str,
    db: Session = Depends(get_db),
):
    seg = svc.get_segment_row(db, project_id, chapter_id, segment_id)
    if seg is None or not seg.current_audio_path:
        raise HTTPException(status_code=404, detail="audio_not_found")
    # Note: current_audio_path is stored relative to settings.segmented_dir (root),
    # not project_dir, per the convention established in Task 7.
    abs_path = settings.segmented_dir / seg.current_audio_path
    if not abs_path.exists():
        seg.audio_missing = True
        db.commit()
        raise HTTPException(status_code=409, detail="audio_missing")
    media_type = "audio/mpeg" if seg.audio_format == "mp3" else f"audio/{seg.audio_format}"
    return FileResponse(abs_path, media_type=media_type)


# ----- split -----

@router.post(
    "/segmented-projects/{project_id}/chapters/{chapter_id}/split",
    response_model=SplitResponse,
)
def split_chapter(
    project_id: str,
    chapter_id: str,
    body: SplitRequest,
    db: Session = Depends(get_db),
):
    chapter = svc.get_chapter_row(db, project_id, chapter_id)
    if chapter is None:
        raise HTTPException(status_code=404, detail="chapter_not_found")
    if body.mode not in ("rule", "llm"):
        raise HTTPException(status_code=422, detail="invalid_mode")
    if body.replace_strategy not in ("preview_only", "replace_chapter_segments"):
        raise HTTPException(status_code=422, detail="invalid_replace_strategy")

    from app.services.text_split_service import rule_split, llm_split
    if body.mode == "rule":
        items = rule_split(
            body.text,
            body.delimiters or chapter.split_config.get("delimiters", ["，", "。"]),
        )
    else:
        items_raw = llm_split(body.text)
        items = [it["text"] for it in items_raw]

    if body.replace_strategy == "preview_only":
        return SplitResponse(items=[SplitItem(text=t) for t in items])

    proj = svc.get_project_row(db, project_id)
    assert proj is not None
    payload = ProjectIn(
        id=proj.id, name=proj.name, schema_version=proj.schema_version,
        layout=proj.layout, active_chapter_id=proj.active_chapter_id,
        original_text=proj.original_text,
        chapters=[
            {
                "id": c.id, "position": c.position, "name": c.name,
                "engine": c.engine, "default_params": c.default_params or {},
                "split_config": c.split_config or {},
                "original_text": c.original_text,
                "segments": (
                    [
                        {
                            "id": f"{c.id}-seg-{idx}",
                            "position": idx, "text": t,
                            "params": c.default_params or {},
                            "locked_params": [],
                        }
                        for idx, t in enumerate(items)
                    ]
                    if c.id == chapter_id else
                    [
                        {
                            "id": s.id, "position": s.position, "text": s.text,
                            "ssml": s.ssml, "emotion": s.emotion,
                            "params": s.params or {},
                            "locked_params": s.locked_params or [],
                            "generated_params": s.generated_params,
                            "current_audio_path": s.current_audio_path,
                            "previous_audio_path": s.previous_audio_path,
                            "audio_format": s.audio_format or "mp3",
                            "duration_sec": s.duration_sec,
                            "audio_missing": bool(s.audio_missing),
                            "ssml_annotated_by_llm": bool(s.ssml_annotated_by_llm),
                        }
                        for s in c.segments
                    ]
                ),
            }
            for c in proj.chapters
        ],
    )
    detail = svc.save_project(db, payload)
    return SplitResponse(
        items=[SplitItem(text=t) for t in items],
        project=detail,
    )


# ----- migration -----

@router.post("/segmented-projects/migrate", response_model=MigrateResponse)
def migrate(request: MigrateRequest, db: Session = Depends(get_db)):
    results: list[MigrateResultItem] = []
    for proj in request.projects:
        try:
            svc.save_project(db, proj)
            db.commit()
            uploaded = 0
            failed = 0
            for aud in [a for a in request.audios if a.project_id == proj.id]:
                try:
                    _write_audio_blob(db, proj.id, aud)
                    uploaded += 1
                except Exception as e:  # noqa: BLE001
                    logger.warning("audio upload failed for %s/%s: %s", proj.id, aud.segment_id, e)
                    failed += 1
            results.append(MigrateResultItem(
                project_id=proj.id, status="ok",
                audio_uploaded=uploaded, audio_failed=failed,
            ))
        except Exception as e:  # noqa: BLE001
            logger.exception("migrate failed for project %s", proj.id)
            db.rollback()
            results.append(MigrateResultItem(
                project_id=proj.id, status="error", message=str(e),
            ))
    return MigrateResponse(results=results)


def _write_audio_blob(
    db: Session, project_id: str, aud: MigrateAudioItem
) -> None:
    seg = svc.get_segment_row(db, project_id, aud.chapter_id, aud.segment_id)
    if seg is None:
        raise LookupError("segment_not_found")
    data = base64.b64decode(aud.data_base64)
    assets.ensure_project_layout(project_id, aud.chapter_id)
    target = assets.segment_audio_path(project_id, aud.chapter_id, seg.id, "mp3")
    target.write_bytes(data)
    # Store path relative to settings.segmented_dir (root) for consistency with synth
    rel = target.relative_to(settings.segmented_dir).as_posix()
    seg.current_audio_path = rel
    seg.audio_format = "mp3"
    seg.updated_at = datetime.utcnow()
    seg.chapter.updated_at = datetime.utcnow()
    seg.chapter.project.updated_at = datetime.utcnow()
    db.commit()
