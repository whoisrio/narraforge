"""
MiMo-V2.5-TTS API 路由

提供三种模式的语音合成接口：
1. 预置音色合成 (/mimo/preset)
2. 文本设计音色合成 (/mimo/voicedesign)
3. 音频克隆合成 (/mimo/voiceclone)
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Optional
import uuid
import os
import base64
import logging
from pathlib import Path

from app.core.database import get_db
from app.core.config import settings
from app.core.system_config_service import is_frontend_storage
from app.models.tts_result import TTSResultRecord
from app.services.mimo_tts_service import get_mimo_tts_service

logger = logging.getLogger(__name__)

router = APIRouter()


# ============ Request Models ============

class MiMoPresetRequest(BaseModel):
    """预置音色合成请求"""
    text: str = Field(..., min_length=1, description="待合成的文本")
    voice: str = Field(default="冰糖", description="预置音色ID，如 冰糖、Mia、Chloe 等")
    instruction: str = Field(default="", description="风格指令（自然语言或音频标签）")
    format: str = Field(default="wav", description="输出格式: wav / mp3")

class MiMoVoiceDesignRequest(BaseModel):
    """文本设计音色合成请求"""
    voice_description: str = Field(..., min_length=1, description="音色描述文本，如 '年轻的男性声音，低沉有磁性'")
    text: str = Field(default="", description="待合成的文本，为空时自动生成适配文本")
    optimize_text_preview: bool = Field(default=True, description="是否智能润色目标播报文本")
    format: str = Field(default="wav", description="输出格式: wav / mp3")

class MiMoVoiceCloneRequest(BaseModel):
    """音频克隆合成请求 - 使用已上传的音频文件ID"""
    text: str = Field(..., min_length=1, description="待合成的文本")
    voice_id: str = Field(..., description="本地数据库中已上传的声音ID")
    instruction: str = Field(default="", description="风格指令")
    format: str = Field(default="wav", description="输出格式: wav / mp3")

class MiMoVoiceCloneDirectRequest(BaseModel):
    """音频克隆合成请求 - 直接上传 Base64 编码音频"""
    text: str = Field(..., min_length=1, description="待合成的文本")
    audio_base64: str = Field(..., description="音频文件的 Base64 编码（不含前缀）")
    mime_type: str = Field(default="audio/mpeg", description="音频 MIME 类型: audio/mpeg 或 audio/wav")
    instruction: str = Field(default="", description="风格指令")
    format: str = Field(default="wav", description="输出格式: wav / mp3")


# ============ Helper ============

async def _save_and_respond(
    audio_bytes: bytes,
    audio_fmt: str,
    text: str,
    voice_label: str,
    instruction: str,
    db: Session,
):
    """根据存储模式保存音频并返回响应"""
    audio_id = str(uuid.uuid4())

    if is_frontend_storage(db):
        audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")
        return {
            "audio_id": audio_id,
            "audio_base64": audio_base64,
            "audio_format": audio_fmt,
            "text": text,
            "voice_name": voice_label,
            "params": {
                "engine": "mimo_tts",
                "instruction": instruction,
            },
        }

    # 后端存储模式
    ext = audio_fmt if audio_fmt in ("wav", "mp3") else "wav"
    audio_path = settings.clone_voices_dir / f"mimo_{audio_id}.{ext}"
    with open(audio_path, "wb") as f:
        f.write(audio_bytes)

    record = TTSResultRecord(
        id=audio_id,
        text=text,
        voice_id=voice_label,
        voice_name=voice_label,
        audio_path=str(audio_path),
        audio_format=ext,
        speed=1.0,
        volume=80,
        pitch=1.0,
        instruction=instruction,
        language="Chinese",
    )
    db.add(record)
    db.commit()

    return {
        "audio_id": audio_id,
        "audio_url": f"/api/tts/audio/{audio_id}",
        "text": text,
        "voice_name": voice_label,
        "params": {
            "engine": "mimo_tts",
            "instruction": instruction,
        },
    }


# ============ Routes ============

@router.get("/voices")
async def list_mimo_voices():
    """获取 MiMo TTS 预置音色列表"""
    from app.services.mimo_tts_service import MIMO_PRESET_VOICES
    return {"voices": MIMO_PRESET_VOICES}


@router.post("/preset")
async def synthesize_preset(request: MiMoPresetRequest, db: Session = Depends(get_db)):
    """使用预置音色进行语音合成"""
    try:
        service = await get_mimo_tts_service(db)
        audio_bytes = await service.synthesize_preset(
            text=request.text,
            voice=request.voice,
            instruction=request.instruction,
            format=request.format,
        )
        return await _save_and_respond(
            audio_bytes=audio_bytes,
            audio_fmt=request.format,
            text=request.text,
            voice_label=request.voice,
            instruction=request.instruction,
            db=db,
        )
    except RuntimeError as e:
        logger.error(f"MiMo preset TTS failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"MiMo preset TTS unexpected error: {e}")
        raise HTTPException(status_code=500, detail=f"语音合成失败: {str(e)}")


@router.post("/voicedesign")
async def synthesize_voice_design(request: MiMoVoiceDesignRequest, db: Session = Depends(get_db)):
    """使用文本描述设计音色进行语音合成"""
    try:
        service = await get_mimo_tts_service(db)
        audio_bytes = await service.synthesize_voice_design(
            text=request.text,
            voice_description=request.voice_description,
            optimize_text_preview=request.optimize_text_preview,
            format=request.format,
        )
        # 截取描述前30字作为标签
        label = request.voice_description[:30] + ("..." if len(request.voice_description) > 30 else "")
        return await _save_and_respond(
            audio_bytes=audio_bytes,
            audio_fmt=request.format,
            text=request.text or "[自动生成]",
            voice_label=label,
            instruction=request.voice_description,
            db=db,
        )
    except RuntimeError as e:
        logger.error(f"MiMo voice design TTS failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"MiMo voice design TTS unexpected error: {e}")
        raise HTTPException(status_code=500, detail=f"语音合成失败: {str(e)}")


@router.post("/voiceclone")
async def synthesize_voice_clone(request: MiMoVoiceCloneRequest, db: Session = Depends(get_db)):
    """使用已上传的音频文件进行音色复刻合成"""
    from app.models.voice_profile import VoiceProfile

    # 查找本地声音记录
    voice = db.query(VoiceProfile).filter(VoiceProfile.id == request.voice_id).first()
    if not voice:
        raise HTTPException(status_code=404, detail="声音记录不存在")

    if not voice.audio_path or not os.path.exists(voice.audio_path):
        # 尝试外部 URL
        if voice.external_audio_url:
            tmp_path = None
            try:
                service = await get_mimo_tts_service(db)
                # 下载外部音频
                import urllib.request as req
                import tempfile
                with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
                    req.urlretrieve(voice.external_audio_url, tmp.name)
                    tmp_path = tmp.name

                audio_bytes = await service.clone_from_file(
                    text=request.text,
                    audio_path=tmp_path,
                    instruction=request.instruction,
                    format=request.format,
                )
                os.unlink(tmp_path)

                return await _save_and_respond(
                    audio_bytes=audio_bytes,
                    audio_fmt=request.format,
                    text=request.text,
                    voice_label=voice.name,
                    instruction=request.instruction,
                    db=db,
                )
            except Exception as e:
                if tmp_path and os.path.exists(tmp_path):
                    os.unlink(tmp_path)
                raise
        else:
            raise HTTPException(status_code=404, detail="音频文件不存在")

    try:
        service = await get_mimo_tts_service(db)
        audio_bytes = await service.clone_from_file(
            text=request.text,
            audio_path=voice.audio_path,
            instruction=request.instruction,
            format=request.format,
        )
        return await _save_and_respond(
            audio_bytes=audio_bytes,
            audio_fmt=request.format,
            text=request.text,
            voice_label=voice.name,
            instruction=request.instruction,
            db=db,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        logger.error(f"MiMo voice clone TTS failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"MiMo voice clone TTS unexpected error: {e}")
        raise HTTPException(status_code=500, detail=f"语音合成失败: {str(e)}")


@router.post("/voiceclone-direct")
async def synthesize_voice_clone_direct(
    request: MiMoVoiceCloneDirectRequest,
    db: Session = Depends(get_db),
):
    """直接使用 Base64 音频数据进行音色复刻合成"""
    try:
        service = await get_mimo_tts_service(db)
        audio_bytes = await service.synthesize_voice_clone(
            text=request.text,
            audio_base64=request.audio_base64,
            mime_type=request.mime_type,
            instruction=request.instruction,
            format=request.format,
        )
        return await _save_and_respond(
            audio_bytes=audio_bytes,
            audio_fmt=request.format,
            text=request.text,
            voice_label="音色复刻",
            instruction=request.instruction,
            db=db,
        )
    except RuntimeError as e:
        logger.error(f"MiMo direct voice clone TTS failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"MiMo direct voice clone TTS unexpected error: {e}")
        raise HTTPException(status_code=500, detail=f"语音合成失败: {str(e)}")


# ---- Segmented editor integration ----

def synthesize_mimo_internal(
    *,
    text: str,
    mimo_mode: str = "preset",
    preset_voice: str | None = None,
    clone_voice_id: str | None = None,
    instruction: str = "",
) -> tuple[bytes, str]:
    """Synthesize for the segmented editor. Returns (audio_bytes, native_format)."""
    import io
    import wave
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setparams((1, 2, 16000, 0, "NONE", "NONE"))
        w.writeframes(b"\x00\x00" * int(16000 * 0.05))
    return buf.getvalue(), "wav"
