import os
import uuid
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.system_config_service import is_frontend_storage
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

        if is_frontend_storage(db):
            # 前端存储模式：不持久化音频和记录，直接返回 SRT 内容
            pass
        else:
            # 后端存储模式：持久化音频文件和识别记录
            audio_dest = str(settings.srt_output_dir / f"{file_id}_original.{file_ext}")
            shutil.copy2(tmp_path, audio_dest)

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
        "download_url": f"/api/speech-to-text/download/{file_id}" if not is_frontend_storage(db) else None,
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


def _merge_audio_files(input_paths: List[str], output_path: str) -> None:
    """
    使用 ffmpeg concat filter 合并多个音频文件。
    不要求格式统一，ffmpeg 会自动重编码为一致的输出格式。
    输出格式根据扩展名自动推断，这里统一输出为 .mp3。
    """
    cmd = ['ffmpeg', '-y']
    for p in input_paths:
        cmd.extend(['-i', p])

    # 构建 concat filter： [0:a][1:a][2:a]concat=n=3:v=0:a=1[out]
    filter_parts = ''.join(f'[{i}:a]' for i in range(len(input_paths)))
    filter_str = f'{filter_parts}concat=n={len(input_paths)}:v=0:a=1[out]'
    cmd.extend(['-filter_complex', filter_str, '-map', '[out]', '-ac', '1', output_path])

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg merge failed: {result.stderr.strip()}")


@router.post("/multi-transcribe")
async def multi_transcribe(
    files: List[UploadFile] = File(...),
    model_size: str = Form("large-v3"),
    beam_size: int = Form(5),
    db: Session = Depends(get_db),
):
    """
    多音频合并 + 字幕识别。
    接收多个音频文件，按上传顺序用 ffmpeg 合并后统一转写。
    """
    if not files:
        raise HTTPException(status_code=400, detail="At least one audio file is required")
    if model_size not in WHISPER_MODEL_SIZES:
        raise HTTPException(status_code=400, detail=f"Invalid model size: {model_size}")

    tmp_dir = Path(tempfile.mkdtemp(prefix="multi_stt_"))
    try:
        # 保存所有上传文件到临时目录
        temp_paths: List[str] = []
        for f in files:
            ext = f.filename.split(".")[-1].lower() if f.filename else "mp3"
            if ext not in ALLOWED_EXTENSIONS:
                ext = "mp3"
            tmp_path = tmp_dir / f"{uuid.uuid4().hex[:8]}.{ext}"
            content = await f.read()
            with open(tmp_path, "wb") as fh:
                fh.write(content)
            temp_paths.append(str(tmp_path))

        # ffmpeg 合并
        merged_path = str(tmp_dir / "merged.mp3")
        _merge_audio_files(temp_paths, merged_path)

        # 转写合并后的音频
        file_id = str(uuid.uuid4())
        service = VoiceToSrt()
        result = service.voicetosrt(
            input_file=merged_path,
            file_id=file_id,
            model_size=model_size,
            beam_size=beam_size,
        )

        if is_frontend_storage(db):
            # 前端存储模式：不持久化
            pass
        else:
            # 后端存储模式：持久化合并音频和识别记录
            audio_dest = str(settings.srt_output_dir / f"{file_id}_merged.mp3")
            shutil.copy2(merged_path, audio_dest)

            record = TranscriptionRecord(
                original_filename="merged_audio.mp3",
                audio_path=audio_dest,
                srt_file_id=file_id,
                language=result.language,
                language_probability=result.language_probability,
                model_size=model_size,
            )
            db.add(record)
            db.commit()

        return {
            "file_id": file_id,
            "filename": "merged_audio",
            "content": result.content,
            "language": result.language,
            "language_probability": result.language_probability,
            "download_url": f"/api/speech-to-text/download/{file_id}" if not is_frontend_storage(db) else None,
        }
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
