import os
import uuid
import tempfile
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse

from app.core.config import settings
from app.services.voice_to_srt_service import VoiceToSrt

router = APIRouter()

ALLOWED_EXTENSIONS = {"wav", "mp3"}
WHISPER_MODEL_SIZES = {"tiny", "base", "small", "medium", "large-v3"}


def _find_srt_by_file_id(file_id: str) -> Path | None:
    """Scan the SRT output directory for a file starting with the given file_id."""
    srt_dir = settings.srt_output_dir
    if not srt_dir.exists():
        return None
    for f in srt_dir.iterdir():
        if f.name.startswith(f"{file_id}_") and f.suffix == ".srt":
            return f
    return None


@router.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    model_size: str = Form("large-v3"),
    beam_size: int = Form(5),
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
