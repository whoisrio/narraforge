"""
MiMo-V2.5-TTS API 路由

提供三种模式的语音合成接口：
1. 预置音色合成 (/mimo/preset)
2. 文本设计音色合成 (/mimo/voicedesign)
3. 音频克隆合成 (/mimo/voiceclone)
"""

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from pydantic import BaseModel, Field, field_validator
from typing import Any, Optional

# workers bundle 不含 sqlalchemy：Session 仅作注解（Depends 注入不看它）。
try:
    from sqlalchemy.orm import Session
except ImportError:  # workers bundle
    Session = Any  # type: ignore[assignment,misc]
import uuid
import os
import base64
import logging
import tempfile
from pathlib import Path

from app.core.database import get_db
from app.core.config import settings
from app.core.asset_store import AssetStore, get_asset_store
from app.core.auth_deps import is_workers_anonymous
from app.core.repositories.deps import get_tts_results_repo, get_usage_repo, get_voice_repo
from app.core.repositories.tts_results import TTSResultRepository
from app.core.repositories.usage import UsageRepository
from app.core.repositories.voice_profiles import VoiceProfileRepository
from app.schemas.common import ItemsOut, validate_base64_field
from app.schemas.tts import TTSResultOut
from app.core.system_config_service import is_frontend_storage
from app.services.mimo_tts_service import get_mimo_tts_service

logger = logging.getLogger(__name__)

router = APIRouter()


def _extract_context(ctx: list[dict] | None) -> str | None:
    """[{role: "user", content: "..."}] → 纯文本，用于拼接到 MiMo user message"""
    if not ctx:
        return None
    texts = [m.get("content", "") for m in ctx if m.get("role") == "user"]
    return "\n".join(t for t in texts if t) or None


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
    optimize_text_preview: bool = Field(default=False, description="是否智能润色目标播报文本（默认 False，严格使用传入文本）")
    format: str = Field(default="wav", description="输出格式: wav / mp3")
    context: list[dict] | None = None  # [{role: "user", content: "..."}] 上下文对话

class MiMoVoiceCloneRequest(BaseModel):
    """音频克隆合成请求 - 使用已上传的音频文件ID"""
    text: str = Field(..., min_length=1, description="待合成的文本")
    profile_id: str = Field(..., description="本地数据库中已上传的声音ID")
    instruction: str = Field(default="", description="风格指令")
    format: str = Field(default="wav", description="输出格式: wav / mp3")
    context: list[dict] | None = None  # [{role: "user", content: "..."}] 上下文对话

class MiMoVoiceCloneDirectRequest(BaseModel):
    _validate = field_validator("audio_base64", mode="before")(validate_base64_field)
    """音频克隆合成请求 - 直接上传 Base64 编码音频"""
    text: str = Field(..., min_length=1, description="待合成的文本")
    audio_base64: str = Field(..., description="音频文件的 Base64 编码（不含前缀），最大 1MB")
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
    repo: TTSResultRepository,
    store: AssetStore,
    *,
    force_frontend: bool = False,
    usage_repo: UsageRepository | None = None,
):
    """根据存储模式保存音频并返回响应

    后端存储分支与 edge-tts 路径同一套（tts.py._synthesize_edge_tts）：音频
    经 asset store（local 写盘 / workers 写 Supabase Storage），记录经仓储
    持久化——workers 只读 FS 不能直接 open() 写盘，db 在 workers 为 None。
    force_frontend（workers 匿名请求）：无论 storage_mode 都走前端存储分支。
    """
    audio_id = str(uuid.uuid4())

    # 存储模式必须在写盘之前判定：workers（Vercel/CF）FS 只读（见 tts.py 同名注释）。
    frontend_storage = force_frontend or is_frontend_storage(db)
    if frontend_storage:
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

    # 后端存储模式：音频进 asset store（local 写盘 / workers 写 Supabase Storage）
    ext = audio_fmt if audio_fmt in ("wav", "mp3") else "wav"
    ref = await store.put(f"data/tts-history/mimo_{audio_id}.{ext}", audio_bytes)
    repo.create({
        "id": audio_id,
        "text": text,
        "voice_id": voice_label,
        "voice_name": voice_label,
        "audio_path": ref,
        "audio_format": ext,
        "speed": 1.0,
        "volume": 80,
        "pitch": 1.0,
        "instruction": instruction,
        "language": "Chinese",
        "source": None,
    })
    # Phase 3 用量计量：workers 匿名走 force_frontend 到不了这里（best-effort）
    if usage_repo is not None:
        usage_repo.record_event(kind="tts", chars=len(text))

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
    return {"items": MIMO_PRESET_VOICES}


@router.post("/preset", response_model=TTSResultOut)
async def synthesize_preset(
    request: MiMoPresetRequest,
    http_request: Request,
    db: Session = Depends(get_db),
    tts_repo: TTSResultRepository = Depends(get_tts_results_repo),
    store: AssetStore = Depends(get_asset_store),
    usage_repo: UsageRepository = Depends(get_usage_repo),
):
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
            repo=tts_repo,
            store=store,
            force_frontend=is_workers_anonymous(http_request),
            usage_repo=usage_repo,
        )
    except RuntimeError as e:
        logger.error(f"MiMo preset TTS failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"MiMo preset TTS unexpected error: {e}")
        raise HTTPException(status_code=500, detail=f"语音合成失败: {str(e)}")


@router.post("/voicedesign", response_model=TTSResultOut)
async def synthesize_voice_design(
    request: MiMoVoiceDesignRequest,
    http_request: Request,
    db: Session = Depends(get_db),
    tts_repo: TTSResultRepository = Depends(get_tts_results_repo),
    store: AssetStore = Depends(get_asset_store),
    usage_repo: UsageRepository = Depends(get_usage_repo),
):
    """使用文本描述设计音色进行语音合成"""
    try:
        service = await get_mimo_tts_service(db)
        # Extract context text from [{role: "user", content: "..."}]
        ctx = _extract_context(request.context)
        audio_bytes = await service.synthesize_voice_design(
            text=request.text,
            voice_description=request.voice_description,
            optimize_text_preview=request.optimize_text_preview,
            format=request.format,
            context=ctx,
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
            repo=tts_repo,
            store=store,
            force_frontend=is_workers_anonymous(http_request),
            usage_repo=usage_repo,
        )
    except RuntimeError as e:
        logger.error(f"MiMo voice design TTS failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"MiMo voice design TTS unexpected error: {e}")
        raise HTTPException(status_code=500, detail=f"语音合成失败: {str(e)}")


@router.post("/voiceclone", response_model=TTSResultOut)
async def synthesize_voice_clone(
    request: MiMoVoiceCloneRequest,
    http_request: Request,
    db: Session = Depends(get_db),
    repo: VoiceProfileRepository = Depends(get_voice_repo),
    tts_repo: TTSResultRepository = Depends(get_tts_results_repo),
    store: AssetStore = Depends(get_asset_store),
    usage_repo: UsageRepository = Depends(get_usage_repo),
):
    """使用已上传的音频文件进行音色复刻合成"""
    # 查找本地声音记录
    voice = repo.get(request.profile_id)
    if not voice:
        raise HTTPException(status_code=404, detail="声音记录不存在")

    model = (voice["voice"] or {}).get("model", "")
    source_path = (voice["voice_params"] or {}).get(model, {}).get("source_audio_path", "")
    resolved_src = str(settings.resolve_path(source_path)) if source_path else None
    if not resolved_src or not os.path.exists(resolved_src):
        # 尝试外部 URL
        vp = (voice["voice_params"] or {}).get(model, {}) or {}
        ext_url = vp.get("params", {}).get("external_audio_url")
        if ext_url:
            tmp_path = None
            try:
                service = await get_mimo_tts_service(db)
                # 下载外部音频
                import urllib.request as req
                import tempfile
                with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
                    req.urlretrieve(ext_url, tmp.name)
                    tmp_path = tmp.name

                audio_bytes = await service.clone_from_file(
                    text=request.text,
                    audio_path=tmp_path,
                    instruction=request.instruction,
                    format=request.format,
                    context=_extract_context(request.context),
                )
                os.unlink(tmp_path)

                return await _save_and_respond(
                    audio_bytes=audio_bytes,
                    audio_fmt=request.format,
                    text=request.text,
                    voice_label=voice["name"],
                    instruction=request.instruction,
                    db=db,
                    repo=tts_repo,
                    store=store,
                    force_frontend=is_workers_anonymous(http_request),
                    usage_repo=usage_repo,
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
            audio_path=resolved_src,
            instruction=request.instruction,
            format=request.format,
            context=_extract_context(request.context),
        )
        return await _save_and_respond(
            audio_bytes=audio_bytes,
            audio_fmt=request.format,
            text=request.text,
            voice_label=voice["name"],
            instruction=request.instruction,
            db=db,
            repo=tts_repo,
            store=store,
            force_frontend=is_workers_anonymous(http_request),
            usage_repo=usage_repo,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        logger.error(f"MiMo voice clone TTS failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"MiMo voice clone TTS unexpected error: {e}")
        raise HTTPException(status_code=500, detail=f"语音合成失败: {str(e)}")


@router.post("/voiceclone-direct", response_model=TTSResultOut)
async def synthesize_voice_clone_direct(
    request: MiMoVoiceCloneDirectRequest,
    http_request: Request,
    db: Session = Depends(get_db),
    tts_repo: TTSResultRepository = Depends(get_tts_results_repo),
    store: AssetStore = Depends(get_asset_store),
    usage_repo: UsageRepository = Depends(get_usage_repo),
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
            repo=tts_repo,
            store=store,
            force_frontend=is_workers_anonymous(http_request),
            usage_repo=usage_repo,
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
    voice_description: str | None = None,
    instruction: str = "",
    db: Session | None = None,
    context: list[dict] | None = None,
) -> tuple[bytes, str]:
    """Synthesize for the segmented editor. Returns (audio_bytes, native_format)."""
    import asyncio

    async def _run() -> bytes:
        service = await get_mimo_tts_service(db)
        ctx = _extract_context(context)

        if mimo_mode == "voicedesign":
            # 文本描述设计音色（mimo-v2.5-tts-voicedesign）
            desc = voice_description or instruction or "默认音色"
            return await service.synthesize_voice_design(
                text=text,
                voice_description=desc,
                format="wav",
                context=ctx,
            )

        if mimo_mode == "voiceclone":
            if not clone_voice_id:
                raise ValueError("MiMo voiceclone mode requires clone_voice_id")
            from app.models.voice_profile import VoiceProfile

            if db is None:
                raise ValueError("MiMo voiceclone mode requires db session")
            voice = db.query(VoiceProfile).filter(VoiceProfile.id == clone_voice_id).first()
            if not voice:
                raise ValueError(f"声音记录不存在 (clone_voice_id={clone_voice_id})")

            # 优先读试听音频（preview），回退到源音频（voice_params）
            model = (voice.voice or {}).get("model", "")
            preview_path = (voice.preview or {}).get("preview_audio_path", "")
            source_path = (voice.voice_params or {}).get(model, {}).get("source_audio_path", "")
            raw_path = preview_path or source_path
            audio_path = str(settings.resolve_path(raw_path)) if raw_path else None
            if not audio_path or not os.path.exists(audio_path):
                vp = (voice.voice_params or {}).get(model, {}) or {}
                ext_url = vp.get("params", {}).get("external_audio_url")
                if ext_url:
                    import urllib.request as url_req
                    tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
                    try:
                        url_req.urlretrieve(ext_url, tmp.name)
                        return await service.clone_from_file(
                            text=text,
                            audio_path=tmp.name,
                            instruction=instruction,
                            format="wav",
                            context=ctx,
                        )
                    finally:
                        try:
                            os.unlink(tmp.name)
                        except OSError:
                            pass
                raise ValueError(f"音频文件不存在 (path={audio_path})")

            return await service.clone_from_file(
                text=text,
                audio_path=str(audio_path),
                instruction=instruction,
                format="wav",
                context=ctx,
            )

        # 预置音色模式
        return await service.synthesize_preset(
            text=text,
            voice=preset_voice or "冰糖",
            instruction=instruction,
            format="wav",
        )

    return asyncio.run(_run()), "wav"
