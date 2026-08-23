"""
IndexTTS API 路由

通过 HTTP 调用本机 sidecar 服务（IndexTTS-2.5，独立进程）：
- GET  /status  — sidecar/模型加载状态与显存信息
- POST /load    — 加载模型
- POST /unload  — 释放显存
- POST /tts     — 克隆音色 TTS 合成（情绪走 emo_vector，不走文本 tag）

注意：本模块只 import httpx / 标准库与 app 内模块，严禁 import torch，
保持 workers 模式 import 安全（见 app/api/__init__.py 的注释约定）。
"""

import logging
from typing import Optional

import aiofiles
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.time_utils import utcnow
from app.core.system_config_service import is_frontend_storage
from app.models.tts_result import TTSResultRecord
from app.schemas.tts import TTSResultOut
from app.services.indextts_service import IndexTTSServiceError, get_indextts_service
# 复用 voxcpm 的声音音频路径解析（两者同为 local-only 路由，workers 不会 import）
from app.api.voxcpm import _resolve_voice_audio_path

logger = logging.getLogger(__name__)

router = APIRouter()


# ============ 请求模型 ============


class IndexTTSTTSRequest(BaseModel):
    """IndexTTS TTS 请求"""
    text: str = Field(..., min_length=1, description="待合成的文本")
    lang: str = Field(default="ZH", description="语言：ZH/EN/JA/ES/AR")
    voice_id: str = Field(..., description="本地数据库中已上传的声音ID（克隆参考音频）")
    emo_vector: Optional[list[float]] = Field(
        default=None,
        description="8 维情绪向量 [happy, angry, sad, afraid, disgusted, melancholic, surprised, calm]，留空用默认情绪",
    )
    emo_alpha: float = Field(default=1.0, ge=0.0, le=1.0, description="情绪强度")
    duration_factor: float = Field(default=1.0, ge=0.5, le=2.0, description="时长因子")


# ============ 辅助函数 ============


async def _save_and_respond(
    wav_bytes: bytes,
    text: str,
    voice_id: str,
    voice_name: str,
    db: Session,
    lang: str,
    emo_alpha: float,
    duration_factor: float,
) -> dict:
    """保存合成结果并返回响应（仿 voxcpm._save_and_respond）"""
    from app.core.config import settings
    import base64
    import uuid

    params = {
        "engine": "indextts",
        "lang": lang,
        "emo_alpha": emo_alpha,
        "duration_factor": duration_factor,
    }

    if is_frontend_storage(db):
        # 前端存储模式：返回 base64
        audio_base64 = base64.b64encode(wav_bytes).decode("utf-8")
        return {
            "audio_id": str(uuid.uuid4()),
            "audio_base64": audio_base64,
            "audio_format": "wav",
            "engine": "indextts",
            "text": text,
            "voice_id": voice_id,
            "voice_name": voice_name,
            "params": params,
        }

    # 后端存储模式：保存文件并记录到数据库
    audio_id = str(uuid.uuid4())
    audio_path = settings.tts_history_dir / f"{audio_id}.wav"
    audio_path.parent.mkdir(parents=True, exist_ok=True)

    async with aiofiles.open(audio_path, "wb") as f:
        await f.write(wav_bytes)

    record = TTSResultRecord(
        id=audio_id,
        text=text,
        voice_id=voice_id or "",
        voice_name=voice_name or "",
        audio_path=str(audio_path),
        audio_format="wav",
        speed=1.0,
        volume=80,
        pitch=1.0,
        instruction="indextts",
        language=lang,
        created_at=utcnow(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return {
        "audio_id": record.id,
        "audio_url": f"/api/tts/audio/{record.id}",
        "audio_format": "wav",
        "engine": "indextts",
        "text": text,
        "voice_id": voice_id,
        "voice_name": voice_name,
        "params": params,
    }


def synthesize_indextts_internal(
    text: str,
    voice_id: str = "",
    lang: str = "ZH",
    emo_vector: Optional[list[float]] = None,
    emo_alpha: float = 1.0,
    duration_factor: float = 1.0,
    db: Session | None = None,
) -> tuple[bytes, str]:
    """同步桥接：分段项目合成链路调用（仿 synthesize_voxcpm_internal）。"""
    from app.core.database import SessionLocal

    async def _run(session: Session) -> bytes:
        if not voice_id:
            raise ValueError("indextts 引擎需要 voice_id（克隆参考音频）")
        audio_path = _resolve_voice_audio_path(voice_id, session, prefer="source")
        service = get_indextts_service()
        return await service.synthesize(
            text=text,
            lang=lang,
            prompt_wav_path=audio_path,
            emo_vector=emo_vector,
            emo_alpha=emo_alpha,
            duration_factor=duration_factor,
        )

    # 与 voxcpm 相同：调用链可能处于 running event loop 中，走 _run_async 线程桥接
    from app.api.tts import _run_async

    if db is not None:
        return _run_async(_run(db)), "wav"

    session = SessionLocal()
    try:
        return _run_async(_run(session)), "wav"
    finally:
        session.close()


# ============ 端点 ============


@router.get("/status")
async def get_status():
    """获取 IndexTTS sidecar 模型状态"""
    service = get_indextts_service()
    try:
        return await service.status()
    except IndexTTSServiceError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/load")
async def load_model():
    """加载 IndexTTS 模型到 GPU"""
    service = get_indextts_service()
    try:
        return await service.load()
    except IndexTTSServiceError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/unload")
async def unload_model():
    """释放 IndexTTS 模型的 GPU 显存"""
    service = get_indextts_service()
    try:
        return await service.unload()
    except IndexTTSServiceError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/tts", response_model=TTSResultOut)
async def tts(request: IndexTTSTTSRequest, db: Session = Depends(get_db)):
    """IndexTTS 克隆音色 TTS 合成"""
    from app.models.voice_profile import VoiceProfile

    audio_path = _resolve_voice_audio_path(request.voice_id, db, prefer="source")
    voice = db.query(VoiceProfile).filter(VoiceProfile.id == request.voice_id).first()

    service = get_indextts_service()
    try:
        wav_bytes = await service.synthesize(
            text=request.text,
            lang=request.lang,
            prompt_wav_path=audio_path,
            emo_vector=request.emo_vector,
            emo_alpha=request.emo_alpha,
            duration_factor=request.duration_factor,
        )
        return await _save_and_respond(
            wav_bytes=wav_bytes,
            text=request.text,
            voice_id=request.voice_id,
            voice_name=voice.name if voice else "",
            db=db,
            lang=request.lang,
            emo_alpha=request.emo_alpha,
            duration_factor=request.duration_factor,
        )
    except IndexTTSServiceError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"IndexTTS 合成失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"合成失败: {e}")
