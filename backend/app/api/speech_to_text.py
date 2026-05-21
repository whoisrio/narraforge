import os
import uuid
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.transcription_record import TranscriptionRecord
from app.services.voice_to_srt_service import VoiceToSrt

router = APIRouter()

ALLOWED_EXTENSIONS = {"wav", "mp3"}
WHISPER_MODEL_SIZES = {"tiny", "base", "small", "medium", "large-v3"}
HISTORY_LIMIT = 10


def _find_srt_by_file_id(file_id: str) -> Path | None:
    """Scan the SRT output directory for a file starting with the given file_id."""
    srt_dir = settings.srt_output_dir
    if not srt_dir.exists():
        return None
    for f in srt_dir.iterdir():
        if f.name.startswith(f"{file_id}_") and f.suffix == ".srt":
            return f
    return None


def _record_to_dict(r: TranscriptionRecord) -> dict:
    return {
        "id": r.id,
        "original_filename": r.original_filename,
        "audio_url": f"/api/speech-to-text/audio/{r.id}",
        "srt_download_url": f"/api/speech-to-text/download/{r.srt_file_id}",
        "language": r.language,
        "language_probability": r.language_probability,
        "model_size": r.model_size,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _cleanup_record(record: TranscriptionRecord, db: Session):
    """Delete associated files and the DB record. Caller handles commit."""
    if record.audio_path and os.path.exists(record.audio_path):
        os.remove(record.audio_path)
    srt_path = _find_srt_by_file_id(record.srt_file_id)
    if srt_path and srt_path.exists():
        os.remove(str(srt_path))
    db.delete(record)


def _enforce_history_limit(user_id: str, db: Session):
    """Keep only the most recent HISTORY_LIMIT records for the given user."""
    records = (
        db.query(TranscriptionRecord)
        .filter(TranscriptionRecord.user_id == user_id)
        .order_by(TranscriptionRecord.created_at.asc())
        .all()
    )
    excess = len(records) - HISTORY_LIMIT
    if excess > 0:
        for record in records[:excess]:
            _cleanup_record(record, db)
        db.commit()


@router.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    model_size: str = Form("large-v3"),
    beam_size: int = Form(5),
    db: Session = Depends(get_db),
):
    file_ext = file.filename.split(".")[-1].lower() if "." in file.filename else ""
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format: {file_ext}. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    if model_size not in WHISPER_MODEL_SIZES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model_size: {model_size}. Allowed: {', '.join(sorted(WHISPER_MODEL_SIZES))}",
        )

    # Save uploaded file to temp location
    file_id = str(uuid.uuid4())
    with tempfile.NamedTemporaryFile(suffix=f".{file_ext}", delete=False) as tmp:
        content = await file.read()
        if not content:
            os.unlink(tmp.name)
            raise HTTPException(status_code=400, detail="Empty file")
        tmp.write(content)
        tmp_path = tmp.name

    try:
        service = VoiceToSrt()
        result = service.voicetosrt(
            input_file=tmp_path,
            file_id=file_id,
            model_size=model_size,
            beam_size=beam_size,
        )

        # Persist audio file
        audio_dest = str(settings.srt_output_dir / f"{file_id}_original.{file_ext}")
        shutil.copy2(tmp_path, audio_dest)

        # Save transcription record
        record = TranscriptionRecord(
            original_filename=file.filename,
            audio_path=audio_dest,
            srt_file_id=file_id,
            language=result.language,
            language_probability=result.language_probability,
            model_size=model_size,
        )
        db.add(record)
        db.commit()

        _enforce_history_limit("default_user", db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
    finally:
        os.unlink(tmp_path)

    return {
        "file_id": file_id,
        "filename": result.filename,
        "content": result.content,
        "language": result.language,
        "language_probability": result.language_probability,
        "download_url": f"/api/speech-to-text/download/{file_id}",
    }


@router.get("/download/{file_id}")
async def download_srt(file_id: str):
    srt_path = _find_srt_by_file_id(file_id)
    if not srt_path or not srt_path.exists():
        raise HTTPException(status_code=404, detail="SRT file not found")
    return FileResponse(
        path=str(srt_path),
        media_type="text/plain",
        filename=srt_path.name,
    )


@router.get("/history")
def get_history(db: Session = Depends(get_db)):
    records = (
        db.query(TranscriptionRecord)
        .filter(TranscriptionRecord.user_id == "default_user")
        .order_by(TranscriptionRecord.created_at.desc())
        .all()
    )
    return {"results": [_record_to_dict(r) for r in records]}


@router.delete("/history/{record_id}")
def delete_history_record(record_id: str, db: Session = Depends(get_db)):
    record = db.query(TranscriptionRecord).filter(TranscriptionRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    _cleanup_record(record, db)
    db.commit()
    return {"message": "Record deleted"}


@router.get("/audio/{record_id}")
def get_audio(record_id: str, db: Session = Depends(get_db)):
    record = db.query(TranscriptionRecord).filter(TranscriptionRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    if not record.audio_path or not os.path.exists(record.audio_path):
        raise HTTPException(status_code=404, detail="Audio file not found")
    media_type = "audio/wav" if record.audio_path.endswith(".wav") else "audio/mpeg"
    return FileResponse(
        path=record.audio_path,
        media_type=media_type,
        filename=os.path.basename(record.audio_path),
    )
