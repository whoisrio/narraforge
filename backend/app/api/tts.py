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
    engine: str = "cosyvoice"  # "cosyvoice" | "edge_tts"
    # CosyVoice params
    voice_id: str = ""
    instruction: str = "字正腔圆，播音腔"
    speed: float = 1.0
    volume: float = 80
    pitch: int = 0
    emotion: str = "neutral"
    language: str = "Chinese"
    format: str = "wav"
    # Edge-TTS params
    edge_voice: str = ""
    edge_rate: str = "+0%"
    edge_volume: str = "+0%"


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
    """合成语音 - 支持多引擎"""
    if request.engine == "edge_tts":
        return await _synthesize_edge_tts(request, db)
    else:
        return await _synthesize_cosyvoice(request, db)


async def _synthesize_cosyvoice(request: TTSRequest, db: Session = Depends(get_db)):
    """CosyVoice 引擎合成"""
    audio_fmt = request.format or "mp3"

    logger.info(f'request is: {request}')
    if not request.voice_id:
        raise HTTPException(status_code=400, detail="voice_id is required")

    try:
        tts_service = await get_tts_service()

        logger.info(f"Synthesizing with cloned voice: {request.voice_id}")
        # clone_voice 现在直接下载并落盘到 settings.clone_voices_dir，
        # 返回文件绝对路径，文件名形如 {voice_id}_{YYYYMMDDHHMMSS}.{ext}
        audio_path = await tts_service.clone_voice(
            voice_id=request.voice_id,
            text=request.text,
            speed=request.speed,
            volume=request.volume,
            pitch=request.pitch,
            format=audio_fmt,
            sample_rate=16000,
            instruction=request.instruction,
        )

        audio_id = Path(audio_path).stem

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
            audio_path=audio_path,
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


async def _synthesize_edge_tts(request: TTSRequest, db: Session = Depends(get_db)):
    """Edge-TTS 引擎合成"""
    if not request.edge_voice:
        raise HTTPException(status_code=400, detail="edge_voice is required for edge_tts engine")

    audio_id = str(uuid.uuid4())
    audio_path = settings.voices_dir / f"tts_{audio_id}.mp3"

    try:
        from app.services.edge_tts_service import get_edge_tts_service
        edge_service = get_edge_tts_service()

        logger.info(f"Synthesizing with edge-tts: voice={request.edge_voice}, text={request.text[:50]}...")
        audio_data, audio_format = await edge_service.synthesize(
            text=request.text,
            voice=request.edge_voice,
            rate=request.edge_rate,
            volume=request.edge_volume,
        )

        async with aiofiles.open(audio_path, "wb") as f:
            await f.write(audio_data)

        record = TTSResultRecord(
            id=audio_id,
            text=request.text,
            voice_id=request.edge_voice,
            voice_name=request.edge_voice,
            audio_path=str(audio_path),
            audio_format="mp3",
            speed=1.0,
            volume=80,
            pitch=0,
            emotion="neutral",
            language="Chinese",
        )
        db.add(record)
        db.commit()

        return {
            "audio_id": audio_id,
            "audio_url": f"/api/tts/audio/{audio_id}",
            "text": request.text,
            "params": {
                "engine": "edge_tts",
                "edge_voice": request.edge_voice,
                "edge_rate": request.edge_rate,
                "edge_volume": request.edge_volume,
            }
        }

    except Exception as e:
        logger.error(f"Edge-TTS synthesis failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Edge-TTS synthesis failed: {str(e)}")


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
            # clone_voice 现在返回落盘后的绝对路径
            audio_path = await tts_service.clone_voice(
                voice_id=request.voice_id,
                text=segment.text,
                speed=request.speed,
                volume=request.volume,
                pitch=request.pitch,
                format="wav",
                sample_rate=16000,
                instruction="字正腔圆，播音腔",
            )

            audio_id = Path(audio_path).stem
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
async def get_tts_audio(audio_id: str, db: Session = Depends(get_db)):
    """获取 TTS 生成的音频 - 优先按 DB 记录的 audio_path 返回，兼容历史 tts_{id}.{ext} 文件"""
    record = db.query(TTSResultRecord).filter(TTSResultRecord.id == audio_id).first()
    if record and os.path.exists(record.audio_path):
        ext = (record.audio_format or "mp3").lower()
        media_type = "audio/mpeg" if ext == "mp3" else f"audio/{ext}"
        return FileResponse(record.audio_path, media_type=media_type)

    # 兼容旧记录 / 旧 batch 临时文件命名：uploads/voices/tts_{id}.{ext}
    voices_dir = settings.voices_dir
    for ext in ["wav", "mp3", "ogg"]:
        legacy_path = voices_dir / f"tts_{audio_id}.{ext}"
        if os.path.exists(legacy_path):
            media_type = f"audio/{ext}" if ext != "mp3" else "audio/mpeg"
            return FileResponse(legacy_path, media_type=media_type)

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


@router.get("/edge-voices")
async def list_edge_voices(language: Optional[str] = None, gender: Optional[str] = None):
    """获取 Edge-TTS 可用音色列表"""
    try:
        from app.services.edge_tts_service import get_edge_tts_service
        edge_service = get_edge_tts_service()
        voices = await edge_service.list_voices(language=language, gender=gender)
        return {"voices": voices}
    except Exception as e:
        logger.error(f"Failed to list edge-tts voices: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to list edge-tts voices: {str(e)}")


@router.get("/edge-languages")
async def list_edge_languages():
    """获取 Edge-TTS 可用语言列表"""
    try:
        from app.services.edge_tts_service import get_edge_tts_service
        edge_service = get_edge_tts_service()
        languages = await edge_service.get_available_languages()
        return {"languages": languages}
    except Exception as e:
        logger.error(f"Failed to list edge-tts languages: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to list edge-tts languages: {str(e)}")
