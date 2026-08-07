"""FastAPI routes for the segmented project editor (backend storage mode)."""
from __future__ import annotations

import base64
import copy
import io
import json
import logging
import zipfile
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from app.core import segmented_assets as assets
from app.core.audio_encoder import AudioEncoderError
from app.core.config import settings
from app.core.database import get_db
from app.core.segmented_assets import project_dir
from app.schemas.common import ItemsOut
from app.schemas.segmented_project import (
    AnimationSpecItem,
    ApplyAnimationSpecRequest,
    ApplyAnimationSpecResult,
    ExportTextFileRequest,
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
from app.core.time_utils import utcnow

logger = logging.getLogger(__name__)
router = APIRouter()

SCRATCHPAD_PROJECT_ID = "__scratchpad__"

def _reject_scratchpad(project_id: str, detail: str = "forbidden_internal_project_id"):
    """防止草稿项目污染后端数据库."""
    if project_id == SCRATCHPAD_PROJECT_ID:
        raise HTTPException(status_code=403, detail=detail)


# ----- project CRUD -----

@router.get("/segmented-projects", response_model=ItemsOut[ProjectSummary])
def list_projects(db: Session = Depends(get_db)):
    projects = svc.list_projects(db)
    return {"items": [p for p in projects if p.id != SCRATCHPAD_PROJECT_ID]}


@router.post("/segmented-projects", response_model=ProjectDetail, status_code=201)
def create_project(project: ProjectIn, db: Session = Depends(get_db)):
    _reject_scratchpad(project.id)
    existing = svc.get_project_row(db, project.id)
    if existing is not None:
        raise HTTPException(status_code=409, detail="project_already_exists")
    return svc.save_project(db, project)


@router.get("/segmented-projects/{project_id}", response_model=ProjectDetail)
def get_project(project_id: str, db: Session = Depends(get_db)):
    _reject_scratchpad(project_id)
    detail = svc.get_project_detail(db, project_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="project_not_found")
    return detail


@router.put("/segmented-projects/{project_id}", response_model=ProjectDetail)
def put_project(project_id: str, project: ProjectIn, db: Session = Depends(get_db)):
    _reject_scratchpad(project_id)
    if project.id != project_id:
        raise HTTPException(status_code=400, detail="id_mismatch")
    return svc.save_project(db, project)


@router.delete("/segmented-projects/{project_id}", status_code=204)
def delete_project(project_id: str, db: Session = Depends(get_db)):
    _reject_scratchpad(project_id)
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
            force=body.force,
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="segment_not_found")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    detail = svc.get_project_detail(db, project_id)
    assert detail is not None
    return detail


@router.post(
    "/segmented-projects/{project_id}/chapters/{chapter_id}/segments/{segment_id}/audio",
    response_model=ProjectDetail,
)
async def upload_segment_audio(
    project_id: str,
    chapter_id: str,
    segment_id: str,
    file: UploadFile = File(...),
    duration_sec: float | None = Form(None),
    db: Session = Depends(get_db),
):
    """Upload a user-recorded audio file for a segment (self-recording).

    The audio becomes the segment's `current` audio with `origin: 'recorded'`
    (locked against batch/agent synthesis); any existing audio is demoted to
    `previous` for undo.
    """
    _reject_scratchpad(project_id)
    content = await file.read()
    try:
        svc.save_recorded_segment_audio(
            db,
            project_id,
            chapter_id,
            segment_id,
            audio_bytes=content,
            filename=file.filename or "",
            duration_sec=duration_sec,
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="segment_not_found")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    detail = svc.get_project_detail(db, project_id)
    assert detail is not None
    return detail


# ----- chapters:batch (agent split_segment node) -----

from pydantic import BaseModel


class BatchSegmentIn(BaseModel):
    text: str
    emotion: str | None = None
    role: str | None = "narration"
    segment_kind: str | None = "narration"


class BatchChapterIn(BaseModel):
    chapter_title: str
    narration_script: str | None = None
    original_text: str | None = None
    engine: str | None = None
    segments: list[BatchSegmentIn] = []


class BatchRequest(BaseModel):
    chapters: list[BatchChapterIn]
    narration_script: str | None = None


class BatchSegmentOut(BaseModel):
    id: str


class BatchChapterOut(BaseModel):
    id: str
    segments: list[BatchSegmentOut]


class BatchResponse(BaseModel):
    chapters: list[BatchChapterOut]


@router.post(
    "/segmented-projects/{project_id}/chapters:batch",
    response_model=BatchResponse,
)
def batch_create_chapters(project_id: str, body: BatchRequest, db: Session = Depends(get_db)):
    try:
        result = svc.batch_create_structure(
            db,
            project_id,
            [c.model_dump() for c in body.chapters],
            narration_script=body.narration_script,
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="project_not_found")
    return BatchResponse(
        chapters=[
            BatchChapterOut(id=c["id"], segments=[BatchSegmentOut(id=s["id"]) for s in c["segments"]])
            for c in result
        ]
    )


# ----- P2 v3: Animation spec 批量应用 -----

@router.post(
    "/segmented-projects/{project_id}/apply-animation-spec",
    response_model=ApplyAnimationSpecResult,
)
def apply_animation_spec_endpoint(
    project_id: str,
    body: ApplyAnimationSpecRequest,
    db: Session = Depends(get_db),
):
    """skill 一次性 POST 全部 segment spec, 后端原子更新.

    字段合并: 传什么覆盖什么, 未传保留旧值. 缺失 segment_id 报告在 missing_segment_ids.
    """
    items = [it.model_dump() for it in body.segments]
    try:
        result = svc.apply_animation_spec(
            db,
            project_id=project_id,
            theme=body.theme,
            items=items,
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return ApplyAnimationSpecResult(**result)


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
    if seg is None:
        raise HTTPException(status_code=404, detail="audio_not_found")
    audio = seg.audio or {}
    current = audio.get("current", {}) if isinstance(audio, dict) else {}
    current_path = current.get("path")
    if not current_path:
        raise HTTPException(status_code=404, detail="audio_not_found")
    # Note: audio path is stored relative to settings.segmented_dir (root),
    # not project_dir, per the convention established in Task 7.
    abs_path = (settings.segmented_dir / current_path).resolve()
    if not abs_path.is_relative_to(settings.segmented_dir.resolve()):
        raise HTTPException(status_code=400, detail="invalid_audio_path")
    if not abs_path.exists():
        if isinstance(audio, dict):
            audio = copy.deepcopy(audio)
            audio["missing"] = True
            seg.audio = audio
        db.commit()
        raise HTTPException(status_code=409, detail="audio_missing")
    current_format = current.get("format", "mp3")
    media_type = "audio/mpeg" if current_format == "mp3" else f"audio/{current_format}"
    response = FileResponse(abs_path, media_type=media_type)
    response.headers["Cache-Control"] = "no-store"
    return response


@router.get(
    "/segmented-projects/{project_id}/chapters/{chapter_id}/export-audio"
)
def export_chapter_audio(
    project_id: str,
    chapter_id: str,
    export_directory: str | None = None,
    db: Session = Depends(get_db),
):
    try:
        audio_path = svc.export_chapter_audio_mp3(db, project_id, chapter_id, export_directory)
    except LookupError:
        raise HTTPException(status_code=404, detail="chapter_not_found")
    except AudioEncoderError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ValueError as e:
        detail = str(e) or "export_failed"
        status = 400 if detail == "invalid_audio_path" else 409
        raise HTTPException(status_code=status, detail=detail)
    filename = audio_path.name
    return FileResponse(audio_path, media_type="audio/mpeg", filename=filename)


@router.post("/segmented-projects/{project_id}/export-all-chapters")
def export_all_chapters_endpoint(
    project_id: str,
    db: Session = Depends(get_db),
):
    """One-click export: every chapter's mp3 + chapter-local SRT to the
    project's export directory. Aborts (nothing written) when any chapter is
    missing segment audio."""
    _reject_scratchpad(project_id)
    try:
        return svc.export_all_chapters(db, project_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="project_not_found")
    except svc.ChaptersIncompleteError as e:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "chapters_incomplete",
                "message": "存在未合成完成的章节，已全部中止",
                "chapters": e.chapters,
                "missing_counts": e.missing_counts,
            },
        )
    except AudioEncoderError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ValueError as e:
        detail = str(e) or "export_failed"
        status = 409 if detail == "export_directory_not_configured" else 422
        raise HTTPException(status_code=status, detail=detail)


@router.post(
    "/segmented-projects/{project_id}/export-text-file-to-remotion"
)
def export_text_file_to_remotion(
    project_id: str,
    body: ExportTextFileRequest,
    db: Session = Depends(get_db),
):
    import tempfile
    suffix = Path(body.filename).suffix or ".txt"
    with tempfile.NamedTemporaryFile("w", suffix=suffix, encoding="utf-8", delete=False) as f:
        tmp_path = Path(f.name)
        f.write(body.content)
    try:
        target = svc.copy_file_to_remotion_export_target(
            db,
            project_id=project_id,
            source_path=tmp_path,
            filename=body.filename,
            export_directory=body.export_directory,
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="project_not_found")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"copy_failed: {e}")
    finally:
        try:
            tmp_path.unlink()
        except FileNotFoundError:
            pass
    return {"path": str(target)}


class ScaffoldRemotionRequest(BaseModel):
    target_dir: str | None = None


@router.post("/segmented-projects/{project_id}/scaffold-remotion")
def scaffold_remotion(
    project_id: str,
    body: ScaffoldRemotionRequest,
    db: Session = Depends(get_db),
):
    """Create (or refresh) the Remotion project for the kv workflow.

    Idempotent: an existing Remotion project is kept, only derived assets
    (audio / subtitles / manifest / AGENTS.md) are refreshed.
    """
    from app.services import remotion_scaffold_service

    try:
        return remotion_scaffold_service.scaffold_remotion_project(
            db,
            project_id,
            target_dir=body.target_dir,
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="project_not_found")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


# ----- split -----

@router.get("/segmented-projects/{project_id}/chapters/{chapter_id}/sync-status")
def get_sync_status(project_id: str, chapter_id: str, db: Session = Depends(get_db)):
    """Layer-sync Phase A: L1/L2/L3 staleness flags for a chapter."""
    chapter = svc.get_chapter_row(db, project_id, chapter_id)
    if chapter is None:
        raise HTTPException(status_code=404, detail="chapter_not_found")
    from app.services.layer_sync_service import sync_status
    return sync_status(chapter)


class AdjustAudioRequest(BaseModel):
    tempo: float | None = None
    volume_db: float | None = None


@router.post("/segmented-projects/{project_id}/chapters/{chapter_id}/adjust-audio")
def adjust_audio_endpoint(project_id: str, chapter_id: str, body: AdjustAudioRequest, db: Session = Depends(get_db)):
    """Post-synthesis audio adjustment (atempo / volume) for a chapter's ready segments.

    Previous audio is preserved as audio.previous; duration is re-probed.
    Segments with user-recorded current audio (origin=recorded) are exempt —
    never re-rendered or overwritten; the response reports `skipped_recorded`.
    """
    try:
        return svc.adjust_chapter_audio(
            db, project_id, chapter_id,
            tempo=body.tempo if body.tempo is not None else 1.0,
            volume_db=body.volume_db if body.volume_db is not None else 0.0,
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="chapter_not_found")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.post("/segmented-projects/{project_id}/chapters/{chapter_id}/resplit-from-script")
def resplit_from_script_endpoint(project_id: str, chapter_id: str, db: Session = Depends(get_db)):
    """Layer-sync Phase B: re-split segments from the chapter's L2 (narration_script).

    Discards existing segment role/emotion/voice config. Frontend MUST confirm.
    """
    try:
        return svc.resplit_from_script(db, project_id, chapter_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="chapter_not_found")


@router.post("/segmented-projects/{project_id}/chapters/{chapter_id}/rewrite-script-from-segments")
def rewrite_script_from_segments_endpoint(project_id: str, chapter_id: str, db: Session = Depends(get_db)):
    """Layer-sync Phase B: write edited segment texts back into L2 (localisation merge).

    Returns 409 when L2 itself has changed since the last split.
    """
    chapter = svc.get_chapter_row(db, project_id, chapter_id)
    if chapter is None:
        raise HTTPException(status_code=404, detail="chapter_not_found")
    from app.services.layer_sync_service import rewrite_script_from_segments
    try:
        new_script = rewrite_script_from_segments(chapter)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    db.commit()
    return {"narration_script": new_script}


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
            body.delimiters or chapter.split_config.get("delimiters", ["，", "。", "！", "？", "；"]),
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
        animation_theme=getattr(proj, "animation_theme", None),
        remotion_project_path=getattr(proj, "remotion_project_path", None),
        chapters=[
            {
                "id": c.id, "position": c.position, "name": c.name,
                "voice": c.voice or {},
                "split_config": c.split_config or {},
                "original_text": c.original_text,
                "narration_script": c.narration_script,
                "design_title": getattr(c, "design_title", None),
                "segments": (
                    [
                        {
                            "id": f"{c.id}-seg-{idx}",
                            "position": idx, "text": t,
                            "params": c.voice or {},
                            "locked_params": [],
                        }
                        for idx, t in enumerate(items)
                    ]
                    if c.id == chapter_id else
                    [
                        {
                            "id": s.id, "position": s.position, "text": s.text,
                            "emotion": s.emotion,
                            "voice": getattr(s, "voice", {"source": "chapter"}),
                            "generated_params": s.generated_params,
                            "audio": getattr(s, "audio", None),
                        }
                        for s in c.segments
                    ]
                ),
            }
            for c in proj.chapters
        ],
    )
    detail = svc.save_project(db, payload)
    # layer-sync: split just regenerated segments from L2 -> re-baseline L2/L3.
    from app.services.layer_sync_service import mark_split
    ch_row = svc.get_chapter_row(db, project_id, chapter_id)
    if ch_row is not None:
        mark_split(ch_row)
        db.commit()
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
    chapter_title = seg.chapter.name or ""
    project_name = seg.chapter.project.name
    assets.ensure_chapter_layout(
        project_id, aud.chapter_id,
        chapter_title=chapter_title, project_name=project_name,
    )
    target = assets.segment_audio_path(
        project_id, aud.chapter_id,
        chapter_title=chapter_title, project_name=project_name,
        segment_id=seg.id, position=seg.position or 0, fmt="mp3",
    )
    target.write_bytes(data)
    # Store path relative to settings.segmented_dir (root) for consistency with synth
    rel = target.relative_to(settings.segmented_dir).as_posix()
    audio_data = {"current": {"path": rel, "format": "mp3"}}
    seg.audio = audio_data
    seg.updated_at = utcnow()
    seg.chapter.updated_at = utcnow()
    seg.chapter.project.updated_at = utcnow()
    db.commit()


# ----- project export / import -----

@router.get("/segmented-projects/{project_id}/export")
def export_project_endpoint(project_id: str, db: Session = Depends(get_db)):
    """Export a project as a self-contained ZIP bundle. Non-destructive."""
    _reject_scratchpad(project_id, "cannot_export_scratchpad")
    from urllib.parse import quote

    from app.services.project_export_service import export_project

    try:
        data, filename = export_project(db, project_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="project_not_found")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    ascii_name = filename.encode("ascii", "ignore").decode("ascii") or "project.narraforge.zip"
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/zip",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{ascii_name}"; '
                f"filename*=UTF-8''{quote(filename)}"
            )
        },
    )


@router.post(
    "/segmented-projects/import",
    response_model=ProjectDetail,
    status_code=201,
)
def import_project_endpoint(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Import a project from a ZIP bundle. Creates a NEW project (never overwrites)."""
    from app.services.project_import_service import import_project

    zip_bytes = file.file.read()
    try:
        detail = import_project(db, zip_bytes)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except (KeyError, zipfile.BadZipFile, json.JSONDecodeError):
        raise HTTPException(status_code=422, detail="invalid_bundle")
    return detail
