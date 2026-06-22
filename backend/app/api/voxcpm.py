"""
VoxCPM API 路由

提供本地 GPU 推理的语音合成接口：
- GET  /status          — 模型加载状态和 GPU 信息
- POST /load            — 加载模型到 GPU
- POST /unload          — 释放 GPU 显存
- POST /tts             — 纯文本 TTS 合成
- POST /design          — Voice Design（文本描述生成音色）
- POST /clone           — Controllable Clone（参考音频克隆）
- POST /ultimate-clone  — Ultimate Clone（最高保真克隆）
"""

import logging
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

import aiofiles
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.system_config_service import is_frontend_storage
from app.models.tts_result import TTSResultRecord
from app.models.voice_profile import VoiceProfile
from app.services.voxcpm_service import get_voxcpm_service
from app.core.time_utils import utcnow

logger = logging.getLogger(__name__)

router = APIRouter()


# ============ 请求模型 ============


class VoxCPMLoadRequest(BaseModel):
    """加载模型请求"""
    model_path: str = Field(default="", description="模型路径（留空使用配置默认值）")
    device: str = Field(default="", description="推理设备（留空使用配置默认值）")


class VoxCPMTTSRequest(BaseModel):
    """纯文本 TTS 请求"""
    text: str = Field(..., min_length=1, description="待合成的文本")
    cfg_value: float = Field(default=2.0, ge=1.0, le=5.0, description="CFG 强度")
    inference_timesteps: int = Field(default=10, ge=1, le=50, description="去噪步数")
    format: str = Field(default="wav", description="输出格式")


class VoxCPMDesignRequest(BaseModel):
    """Voice Design 请求 — 文本描述生成音色"""
    voice_description: str = Field(..., min_length=1, description="音色描述文本")
    text: str = Field(default="", description="合成文本（为空时自动生成适配文本）")
    cfg_value: float = Field(default=2.0, ge=1.0, le=5.0)
    inference_timesteps: int = Field(default=10, ge=1, le=50)
    format: str = Field(default="wav")


class VoxCPMCloneRequest(BaseModel):
    """Controllable Clone 请求"""
    text: str = Field(..., min_length=1, description="待合成的文本")
    voice_id: str = Field(..., description="本地数据库中已上传的声音ID")
    style_control: str = Field(default="", description="风格控制描述（如：语速稍快，欢快语气）")
    cfg_value: float = Field(default=2.0, ge=1.0, le=5.0)
    inference_timesteps: int = Field(default=10, ge=1, le=50)
    format: str = Field(default="wav")


class VoxCPMUltimateCloneRequest(BaseModel):
    """Ultimate Clone 请求 — 最高保真克隆"""
    text: str = Field(..., min_length=1, description="待合成的文本")
    voice_id: str = Field(..., description="本地数据库中已上传的声音ID")
    prompt_text: Optional[str] = Field(None, description="参考音频的完整转录文本（可选，未提供时自动从 VoiceProfile 读取）")
    style_control: str = Field(default="", description="风格控制描述（如：语速稍快，欢快语气）")
    cfg_value: float = Field(default=2.0, ge=1.0, le=5.0)
    inference_timesteps: int = Field(default=10, ge=1, le=50)
    format: str = Field(default="wav")


# ============ 辅助函数 ============


def _resolve_voice_audio_path(voice_id: str, db: Session) -> str:
    """
    根据 voice_id 查找本地音频文件路径。
    优先使用 external_audio_url（云存储），否则使用 audio_path（本地文件）。
    """
    voice = db.query(VoiceProfile).filter(VoiceProfile.id == voice_id).first()
    if not voice:
        raise HTTPException(status_code=404, detail=f"声音不存在: {voice_id}")

    # 优先本地路径
    if voice.audio_path and os.path.isfile(voice.audio_path):
        return voice.audio_path

    # uploads/voices/ 目录下查找
    from app.core.config import settings

    voices_dir = settings.voices_dir
    for ext in [".wav", ".mp3", ".ogg", ".webm", ".m4a"]:
        candidate = voices_dir / f"{voice_id}{ext}"
        if candidate.is_file():
            return str(candidate)

    raise HTTPException(
        status_code=404,
        detail=f"声音 {voice_id} 的音频文件不存在: audio_path={voice.audio_path}",
    )


async def _save_and_respond(
    wav_bytes: bytes,
    text: str,
    voice_id: str,
    voice_name: str,
    format: str,
    db: Session,
    engine_mode: str,
    cfg_value: float = 2.0,
    inference_timesteps: int = 10,
) -> dict:
    """保存合成结果并返回响应"""
    from app.core.config import settings
    import base64

    if is_frontend_storage(db):
        # 前端存储模式：返回 base64
        audio_base64 = base64.b64encode(wav_bytes).decode("utf-8")
        return {
            "audio_base64": audio_base64,
            "audio_format": format,
            "engine": f"voxcpm_{engine_mode}",
            "text": text,
            "voice_id": voice_id,
        }

    # 后端存储模式：保存文件并记录到数据库
    audio_id = str(uuid.uuid4())
    audio_filename = f"{audio_id}.{format}"
    audio_path = settings.uploads_dir / "tts_results" / audio_filename
    audio_path.parent.mkdir(parents=True, exist_ok=True)

    async with aiofiles.open(audio_path, "wb") as f:
        await f.write(wav_bytes)

    # 记录到数据库（字段匹配现有 TTSResultRecord 模型）
    record = TTSResultRecord(
        id=audio_id,
        text=text,
        voice_id=voice_id or "",
        voice_name=voice_name or "",
        audio_path=str(audio_path),
        audio_format=format,
        speed=1.0,
        volume=80,
        pitch=1.0,
        instruction=f"voxcpm_{engine_mode}",
        language="",
        created_at=utcnow(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return {
        "id": record.id,
        "audio_url": f"/api/tts/audio/{record.id}",
        "audio_format": format,
        "engine": f"voxcpm_{engine_mode}",
        "text": text,
        "voice_id": voice_id,
        "voice_name": voice_name,
    }


# ============ 端点 ============


def synthesize_voxcpm_internal(
    text: str,
    mode: str = "tts",
    voice_id: str = "",
    voice_description: str = "",
    style_control: str = "",
    prompt_text: Optional[str] = None,
    cfg_value: float = 2.0,
    inference_timesteps: int = 10,
    db: Session | None = None,
) -> tuple[bytes, str]:
    """Synchronous bridge used by segmented-project synthesis."""
    import asyncio
    from app.core.database import SessionLocal

    async def _run(session: Session) -> bytes:
        service = await get_voxcpm_service()
        if not service.loaded:
            load_result = await service.load_model()
            if not load_result.get("success"):
                raise RuntimeError(f"模型加载失败: {load_result.get('error')}")

        if mode == "design":
            if not voice_description:
                raise ValueError("design 模式需要 voice_description")
            return await service.synthesize(
                text=f"({voice_description}){text}",
                mode="design",
                cfg_value=cfg_value,
                inference_timesteps=inference_timesteps,
            )

        if mode == "clone":
            audio_path = _resolve_voice_audio_path(voice_id, session)
            return await service.synthesize(
                text=text,
                mode="clone",
                reference_audio_path=audio_path,
                style_control=style_control or None,
                cfg_value=cfg_value,
                inference_timesteps=inference_timesteps,
            )

        if mode == "ultimate":
            audio_path = _resolve_voice_audio_path(voice_id, session)
            voice = session.query(VoiceProfile).filter(VoiceProfile.id == voice_id).first()
            stored_prompt = getattr(voice, "prompt_text", None) if voice else None
            effective_prompt = prompt_text or (stored_prompt if isinstance(stored_prompt, str) else None)
            if not effective_prompt:
                raise ValueError("ultimate 模式需要 prompt_text")
            return await service.synthesize(
                text=text,
                mode="ultimate",
                reference_audio_path=audio_path,
                prompt_text=effective_prompt,
                style_control=style_control or None,
                cfg_value=cfg_value,
                inference_timesteps=inference_timesteps,
            )

        return await service.synthesize(
            text=text,
            mode="tts",
            cfg_value=cfg_value,
            inference_timesteps=inference_timesteps,
        )

    if db is not None:
        return asyncio.run(_run(db)), "wav"

    session = SessionLocal()
    try:
        return asyncio.run(_run(session)), "wav"
    finally:
        session.close()


@router.get("/status")
async def get_status():
    """获取 VoxCPM 模型状态"""
    service = await get_voxcpm_service()
    return service.get_status()


@router.post("/load")
async def load_model(request: VoxCPMLoadRequest):
    """加载 VoxCPM 模型到 GPU（首次约 10-30 秒）"""
    service = await get_voxcpm_service()
    result = await service.load_model(
        model_path=request.model_path or None,
        device=request.device or None,
    )
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "加载失败"))
    return result


@router.post("/unload")
async def unload_model():
    """释放 VoxCPM 模型的 GPU 显存"""
    service = await get_voxcpm_service()
    result = await service.unload_model()
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "释放失败"))
    return result


@router.post("/tts")
async def tts(request: VoxCPMTTSRequest, db: Session = Depends(get_db)):
    """纯文本 TTS 合成（无参考音频）"""
    service = await get_voxcpm_service()
    if not service.loaded:
        logger.info("VoxCPM 模型未加载，自动加载中...")
        load_result = await service.load_model()
        if not load_result.get("success"):
            raise HTTPException(status_code=500, detail=f"模型加载失败: {load_result.get('error')}")

    try:
        wav_bytes = await service.synthesize(
            text=request.text,
            mode="tts",
            cfg_value=request.cfg_value,
            inference_timesteps=request.inference_timesteps,
        )
        return await _save_and_respond(
            wav_bytes=wav_bytes,
            text=request.text,
            voice_id="",
            voice_name="VoxCPM TTS",
            format=request.format,
            db=db,
            engine_mode="tts",
            cfg_value=request.cfg_value,
            inference_timesteps=request.inference_timesteps,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"VoxCPM TTS 合成失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"合成失败: {e}")


@router.post("/design")
async def voice_design(request: VoxCPMDesignRequest, db: Session = Depends(get_db)):
    """Voice Design — 纯文本描述生成全新音色"""
    service = await get_voxcpm_service()
    if not service.loaded:
        logger.info("VoxCPM 模型未加载，自动加载中...")
        load_result = await service.load_model()
        if not load_result.get("success"):
            raise HTTPException(status_code=500, detail=f"模型加载失败: {load_result.get('error')}")

    try:
        # Voice Design 格式: (音色描述)合成文本
        text = request.text or "你好，欢迎使用 VoxCPM2 语音合成系统。"
        design_text = f"({request.voice_description}){text}"

        wav_bytes = await service.synthesize(
            text=design_text,
            mode="design",
            cfg_value=request.cfg_value,
            inference_timesteps=request.inference_timesteps,
        )
        return await _save_and_respond(
            wav_bytes=wav_bytes,
            text=design_text,
            voice_id="",
            voice_name=f"VoiceDesign: {request.voice_description[:30]}",
            format=request.format,
            db=db,
            engine_mode="design",
            cfg_value=request.cfg_value,
            inference_timesteps=request.inference_timesteps,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"VoxCPM Voice Design 失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Voice Design 失败: {e}")


@router.post("/clone")
async def clone(request: VoxCPMCloneRequest, db: Session = Depends(get_db)):
    """Controllable Clone — 参考音频克隆 + 可选风格控制"""
    logger.info(f"VoxCPM clone request: voice_id={request.voice_id}, text={request.text[:50]}")
    service = await get_voxcpm_service()
    if not service.loaded:
        logger.info("VoxCPM 模型未加载，自动加载中...")
        load_result = await service.load_model()
        if not load_result.get("success"):
            raise HTTPException(status_code=500, detail=f"模型加载失败: {load_result.get('error')}")

    # 查找参考音频
    audio_path = _resolve_voice_audio_path(request.voice_id, db)
    voice = db.query(VoiceProfile).filter(VoiceProfile.id == request.voice_id).first()

    try:
        wav_bytes = await service.synthesize(
            text=request.text,
            mode="clone",
            reference_audio_path=audio_path,
            style_control=request.style_control or None,
            cfg_value=request.cfg_value,
            inference_timesteps=request.inference_timesteps,
        )
        return await _save_and_respond(
            wav_bytes=wav_bytes,
            text=request.text,
            voice_id=request.voice_id,
            voice_name=voice.name if voice else "",
            format=request.format,
            db=db,
            engine_mode="clone",
            cfg_value=request.cfg_value,
            inference_timesteps=request.inference_timesteps,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"VoxCPM Clone 失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Clone 失败: {e}")


@router.post("/ultimate-clone")
async def ultimate_clone(
    request: VoxCPMUltimateCloneRequest, db: Session = Depends(get_db)
):
    """Ultimate Clone — 参考音频 + 转录文本，最高保真克隆"""
    service = await get_voxcpm_service()
    if not service.loaded:
        logger.info("VoxCPM 模型未加载，自动加载中...")
        load_result = await service.load_model()
        if not load_result.get("success"):
            raise HTTPException(status_code=500, detail=f"模型加载失败: {load_result.get('error')}")

    # 查找参考音频
    audio_path = _resolve_voice_audio_path(request.voice_id, db)
    voice = db.query(VoiceProfile).filter(VoiceProfile.id == request.voice_id).first()

    # prompt_text 优先使用请求中提供的，否则从 VoiceProfile 读取
    prompt_text = request.prompt_text
    if not prompt_text and voice:
        prompt_text = voice.prompt_text
    if not prompt_text:
        raise HTTPException(
            status_code=400,
            detail="ultimate 模式需要 prompt_text，请在请求中提供或在声音录入时填写"
        )

    try:
        wav_bytes = await service.synthesize(
            text=request.text,
            mode="ultimate",
            reference_audio_path=audio_path,
            prompt_text=prompt_text,
            style_control=request.style_control or None,
            cfg_value=request.cfg_value,
            inference_timesteps=request.inference_timesteps,
        )
        return await _save_and_respond(
            wav_bytes=wav_bytes,
            text=request.text,
            voice_id=request.voice_id,
            voice_name=voice.name if voice else "",
            format=request.format,
            db=db,
            engine_mode="ultimate",
            cfg_value=request.cfg_value,
            inference_timesteps=request.inference_timesteps,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"VoxCPM Ultimate Clone 失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Ultimate Clone 失败: {e}")
