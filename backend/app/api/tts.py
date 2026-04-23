from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
import uuid
import os
import logging
from pathlib import Path
import aiofiles

from app.core.database import get_db
from app.core.config import settings
from app.models.voice_profile import VoiceProfile
from app.models.tts_result import TTSResultRecord
from app.services.qwen_tts_service import get_tts_service, QwenTTSService

logger = logging.getLogger(__name__)

router = APIRouter()


class TTSRequest(BaseModel):
    text: str
    voice_id: str
    speed: float = 1.0
    volume: float = 80
    pitch: int = 0
    emotion: str = "neutral"
    language: str = "Chinese"
    format: str = "wav"


class SegmentRequest(BaseModel):
    text: str
    start_time: float
    end_time: float


class BatchTTSRequest(BaseModel):
    segments: List[SegmentRequest]
    voice_id: str
    speed: float = 1.0
    volume: float = 80
    pitch: int = 0
    emotion: str = "neutral"


def _result_to_dict(r: TTSResultRecord) -> dict:
    return {
        "id": r.id,
        "text": r.text,
        "voice_id": r.voice_id,
        "voice_name": r.voice_name,
        "audio_url": f"/api/tts/audio/{r.id}",
        "audio_format": r.audio_format,
        "speed": r.speed,
        "volume": r.volume,
        "pitch": r.pitch,
        "emotion": r.emotion,
        "language": r.language,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


@router.post("/synthesize")
async def synthesize_speech(request: TTSRequest, db: Session = Depends(get_db)):
    """合成语音 - 使用克隆声音"""
    audio_fmt = request.format or "wav"
    audio_id = str(uuid.uuid4())
    audio_path = settings.voices_dir / f"tts_{audio_id}.{audio_fmt}"

    if not request.voice_id:
        raise HTTPException(status_code=400, detail="voice_id is required")

    try:
        tts_service = await get_tts_service()

        logger.info(f"Synthesizing with cloned voice: {request.voice_id}")
        audio_data = await tts_service.clone_voice(
            voice_id=request.voice_id,
            text=request.text,
            speed=request.speed,
            volume=request.volume,
            pitch=request.pitch,
            format=audio_fmt,
            sample_rate=16000,
        )

        async with aiofiles.open(audio_path, "wb") as f:
            await f.write(audio_data)

        # 查询声音名称用于历史记录展示
        voice = (
            db.query(VoiceProfile)
            .filter(VoiceProfile.qwen_voice_id == request.voice_id)
            .first()
        )
        voice_name = voice.name if voice else request.voice_id

        # 保存合成记录
        record = TTSResultRecord(
            id=audio_id,
            text=request.text,
            voice_id=request.voice_id,
            voice_name=voice_name,
            audio_path=str(audio_path),
            audio_format=audio_fmt,
            speed=request.speed,
            volume=request.volume,
            pitch=request.pitch,
            emotion=request.emotion,
            language=request.language,
        )
        db.add(record)
        db.commit()

        return {
            "audio_id": audio_id,
            "audio_url": f"/api/tts/audio/{audio_id}",
            "text": request.text,
            "params": {
                "speed": request.speed,
                "volume": request.volume,
                "pitch": request.pitch,
                "emotion": request.emotion,
                "voice_id": request.voice_id,
            }
        }

    except Exception as e:
        logger.error(f"TTS synthesis failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"TTS synthesis failed: {str(e)}")


@router.get("/history")
def get_synthesis_history(db: Session = Depends(get_db)):
    """获取合成历史列表"""
    records = (
        db.query(TTSResultRecord)
        .order_by(TTSResultRecord.created_at.desc())
        .all()
    )
    return {"results": [_result_to_dict(r) for r in records]}


@router.delete("/history/{result_id}")
def delete_synthesis_result(result_id: str, db: Session = Depends(get_db)):
    """删除合成记录及音频文件"""
    record = db.query(TTSResultRecord).filter(TTSResultRecord.id == result_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Result not found")

    if os.path.exists(record.audio_path):
        os.remove(record.audio_path)

    db.delete(record)
    db.commit()

    return {"message": "Result deleted"}


@router.post("/batch")
async def batch_synthesize(request: BatchTTSRequest, db: Session = Depends(get_db)):
    """批量合成语音"""
    results = []

    try:
        tts_service = await get_tts_service()

        for segment in request.segments:
            audio_id = str(uuid.uuid4())
            audio_path = settings.voices_dir / f"tts_{audio_id}.wav"

            audio_data = await tts_service.clone_voice(
                voice_id=request.voice_id,
                text=segment.text,
                speed=request.speed,
                volume=request.volume,
                pitch=request.pitch,
                format="wav",
                sample_rate=16000,
            )

            async with aiofiles.open(audio_path, "wb") as f:
                await f.write(audio_data)

            results.append({
                "audio_id": audio_id,
                "audio_url": f"/api/tts/audio/{audio_id}",
                "text": segment.text,
                "start_time": segment.start_time,
                "end_time": segment.end_time
            })

        return {"segments": results}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Batch TTS synthesis failed: {str(e)}")


@router.get("/audio/{audio_id}")
async def get_tts_audio(audio_id: str):
    """获取 TTS 生成的音频"""
    voices_dir = settings.voices_dir
    for ext in ["wav", "mp3", "ogg"]:
        audio_path = voices_dir / f"tts_{audio_id}.{ext}"
        if os.path.exists(audio_path):
            media_type = f"audio/{ext}" if ext != "mp3" else "audio/mpeg"
            return FileResponse(audio_path, media_type=media_type)

    raise HTTPException(status_code=404, detail="Audio not found")


@router.get("/voices")
async def list_available_voices(db: Session = Depends(get_db)):
    """获取可用的克隆声音列表"""
    cloned = (
        db.query(VoiceProfile)
        .filter(VoiceProfile.is_cloned == True, VoiceProfile.qwen_voice_id.isnot(None))
        .all()
    )
    voices = [
        {
            "id": str(v.id),
            "name": v.name,
            "audio_url": v.external_audio_url or v.audio_path,
            "qwen_voice_id": v.qwen_voice_id,
            "is_cloned": v.is_cloned,
            "created_at": v.created_at.isoformat() if v.created_at else None,
        }
        for v in cloned
    ]

    return {"voices": voices}
