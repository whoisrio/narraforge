from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
import uuid
import os
import aiofiles

from app.core.database import get_db
from app.core.config import settings
from app.services.qwen_tts_service import get_tts_service, QwenTTSService

router = APIRouter()


class TTSRequest(BaseModel):
    text: str
    speed: float = 1.0
    volume: float = 80
    pitch: int = 0
    emotion: str = "neutral"
    voice_id: Optional[str] = None


class SegmentRequest(BaseModel):
    text: str
    start_time: float
    end_time: float


class BatchTTSRequest(BaseModel):
    segments: List[SegmentRequest]
    speed: float = 1.0
    volume: float = 80
    pitch: int = 0
    emotion: str = "neutral"


@router.post("/synthesize")
async def synthesize_speech(request: TTSRequest, db: Session = Depends(get_db)):
    """合成语音 - 使用千问 TTS API"""
    audio_id = str(uuid.uuid4())
    audio_path = settings.voices_dir / f"tts_{audio_id}.wav"

    # 使用声音 ID (如果有) 或默认
    voice_id = request.voice_id or "xiaoyun"

    try:
        tts_service = await get_tts_service()

        # 调用千问 TTS API
        audio_data = await tts_service.synthesize_speech(
            text=request.text,
            voice_id=voice_id,
            speed=request.speed,
            volume=request.volume,
            pitch=request.pitch,
            format="wav",
            sample_rate=16000,
        )

        # 保存音频文件
        async with aiofiles.open(audio_path, "wb") as f:
            await f.write(audio_data)

        return {
            "audio_id": audio_id,
            "audio_url": f"/api/tts/audio/{audio_id}",
            "text": request.text,
            "params": {
                "speed": request.speed,
                "volume": request.volume,
                "pitch": request.pitch,
                "emotion": request.emotion,
                "voice_id": voice_id,
            }
        }

    except Exception as e:
        # 如果 API 调用失败，返回错误
        raise HTTPException(status_code=500, detail=f"TTS synthesis failed: {str(e)}")


@router.post("/batch")
async def batch_synthesize(request: BatchTTSRequest, db: Session = Depends(get_db)):
    """批量合成语音 (用于时间轴)"""
    results = []

    try:
        tts_service = await get_tts_service()

        for segment in request.segments:
            audio_id = str(uuid.uuid4())
            audio_path = settings.voices_dir / f"tts_{audio_id}.wav"

            # 调用千问 TTS API
            audio_data = await tts_service.synthesize_speech(
                text=segment.text,
                voice_id="xiaoyun",  # 批量合成使用默认声音
                speed=request.speed,
                volume=request.volume,
                pitch=request.pitch,
                format="wav",
                sample_rate=16000,
            )

            # 保存音频文件
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
    audio_path = settings.voices_dir / f"tts_{audio_id}.wav"

    from fastapi.responses import FileResponse
    if os.path.exists(audio_path):
        return FileResponse(audio_path, media_type="audio/wav")
    else:
        raise HTTPException(status_code=404, detail="Audio not found")


@router.get("/voices")
def list_available_voices():
    """获取可用的声音列表"""
    return {
        "voices": [
            {"id": "xiaoyun", "name": "云溪", "gender": "female"},
            {"id": "xiaoyuan", "name": "晓晓", "gender": "female"},
            {"id": "ruoxi", "name": "若曦", "gender": "female"},
            {"id": "xiaogang", "name": "小刚", "gender": "male"},
            {"id": "yunjian", "name": "云健", "gender": "male"},
        ]
    }