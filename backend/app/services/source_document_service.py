"""Source documents CRUD — 项目级原始素材 (P2 v2)."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.source_document import SourceDocument
from app.models.segmented_project import SegmentedProject
from app.schemas.segmented_project import SourceDocumentIn, SourceDocumentOut

logger = logging.getLogger(__name__)

# 上传文件存储目录: <segmented_dir>/<project_id>/sources/
def sources_dir(project_id: str) -> Path:
    return settings.segmented_dir / project_id / "sources"


def _to_iso(value: datetime | None) -> str:
    if value is None:
        return ""
    if value.tzinfo is None:
        return value.isoformat()
    return value.astimezone(timezone.utc).isoformat()


def source_to_out(src: SourceDocument) -> SourceDocumentOut:
    return SourceDocumentOut(
        id=src.id,
        project_id=src.project_id,
        source_type=src.source_type,
        title=src.title,
        file_path=src.file_path,
        pasted_text=src.pasted_text,
        audio_path=src.audio_path,
        file_size=src.file_size,
        duration_sec=src.duration_sec,
        created_at=_to_iso(src.created_at),
    )


def list_sources(db: Session, project_id: str) -> list[SourceDocumentOut]:
    rows = (
        db.query(SourceDocument)
        .filter_by(project_id=project_id)
        .order_by(SourceDocument.created_at.desc())
        .all()
    )
    return [source_to_out(s) for s in rows]


def get_source(db: Session, project_id: str, source_id: str) -> SourceDocument | None:
    return (
        db.query(SourceDocument)
        .filter_by(id=source_id, project_id=project_id)
        .first()
    )


def create_source_paste(
    db: Session,
    project_id: str,
    title: str,
    pasted_text: str,
) -> SourceDocumentOut:
    """创建粘贴文本源."""
    _ensure_project_exists(db, project_id)
    src = SourceDocument(
        id=f"src_{uuid.uuid4().hex[:12]}",
        project_id=project_id,
        source_type="paste",
        title=title or pasted_text[:30].replace("\n", " "),
        pasted_text=pasted_text,
        file_size=len(pasted_text.encode("utf-8")),
    )
    db.add(src)
    db.commit()
    db.refresh(src)
    logger.info(f"created paste source {src.id} for project {project_id}, {src.file_size} bytes")
    return source_to_out(src)


def create_source_audio(
    db: Session,
    project_id: str,
    title: str,
    audio_bytes: bytes,
    suffix: str,
    duration_sec: Optional[float] = None,
) -> SourceDocumentOut:
    """创建音频源 — 写入磁盘 + DB 记录."""
    _ensure_project_exists(db, project_id)
    src_id = f"src_{uuid.uuid4().hex[:12]}"
    sources_dir(project_id).mkdir(parents=True, exist_ok=True)
    # 文件命名: <src_id>.<ext>
    ext = suffix.lstrip(".").lower() or "mp3"
    if ext not in ("mp3", "wav", "m4a", "ogg"):
        ext = "mp3"  # 兜底
    file_path = sources_dir(project_id) / f"{src_id}.{ext}"
    file_path.write_bytes(audio_bytes)

    # 探测时长 (best-effort)
    if duration_sec is None:
        try:
            from app.core.audio_encoder import probe_audio_duration
            duration_sec = probe_audio_duration(file_path)
        except Exception as e:
            logger.warning(f"failed to probe duration for {file_path}: {e}")
            duration_sec = None

    src = SourceDocument(
        id=src_id,
        project_id=project_id,
        source_type="audio",
        title=title,
        audio_path=str(file_path),
        file_size=len(audio_bytes),
        duration_sec=duration_sec,
    )
    db.add(src)
    db.commit()
    db.refresh(src)
    logger.info(f"created audio source {src.id} for project {project_id}, {src.file_size} bytes, {duration_sec}s")
    return source_to_out(src)


def delete_source(db: Session, project_id: str, source_id: str) -> bool:
    src = get_source(db, project_id, source_id)
    if src is None:
        return False
    # 如果是 audio, 删磁盘文件
    if src.source_type == "audio" and src.audio_path:
        try:
            p = Path(src.audio_path)
            if p.exists():
                p.unlink()
        except Exception as e:
            logger.warning(f"failed to delete audio file {src.audio_path}: {e}")
    db.delete(src)
    db.commit()
    logger.info(f"deleted source {source_id} from project {project_id}")
    return True


def _ensure_project_exists(db: Session, project_id: str) -> SegmentedProject:
    p = db.query(SegmentedProject).filter_by(id=project_id).first()
    if p is None:
        raise LookupError(f"project_not_found: {project_id}")
    return p
