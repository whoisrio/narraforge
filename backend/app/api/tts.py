from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from typing import Any, List, Optional

# workers bundle 不含 sqlalchemy：Session 仅作注解（Depends 注入不看它）。
try:
    from sqlalchemy.orm import Session
except ImportError:  # workers bundle
    Session = Any  # type: ignore[assignment,misc]
import uuid
import os
import base64
import logging
from pathlib import Path
import aiofiles

from app.core.database import get_db
from app.core.config import settings
from app.core.asset_store import AssetStore, get_asset_store
from app.core.repositories.deps import get_tts_results_repo, get_voice_repo
from app.core.repositories.tts_results import TTSResultRepository
from app.core.repositories.voice_profiles import VoiceProfileRepository
from app.schemas.common import ItemsOut
from app.schemas.tts import TTSResultOut, TTSResultRecordOut
from app.core.system_config_service import is_frontend_storage
from app.api._voice_helpers import voice_to_dict

# workers bundle 不含 app.models（依赖 sqlalchemy）：仅 local 端点运行时引用。
try:
    from app.models.voice_profile import VoiceProfile
    from app.models.tts_result import TTSResultRecord
except ImportError:  # workers bundle
    VoiceProfile = None  # type: ignore[assignment,misc]
    TTSResultRecord = None  # type: ignore[assignment,misc]

logger = logging.getLogger(__name__)

router = APIRouter()

# qwen/dashscope 专属端点（batch 合成），workers 模式不挂载（main.py 按 deploy_target 注册）
local_router = APIRouter()


async def get_tts_service(db=None):
    """延迟 import qwen_tts_service：workers 构建不含 dashscope SDK（local-services extra）。

    保留模块级同名属性是为了不破坏既有测试的 patch 点
    （tests patch "app.api.tts.get_tts_service"）。
    """
    from app.services.qwen_tts_service import get_tts_service as _get_tts_service

    return await _get_tts_service(db)


class TTSRequest(BaseModel):
    text: str
    engine: str = "cosyvoice"  # "cosyvoice" | "edge_tts"
    # CosyVoice params
    voice_id: str = ""
    instruction: str = "音调偏高，语速中等，充满活力和感染力，适合广告配音"
    speed: float = Field(default=1.0, ge=0.5, le=2.0, description="语速比率，0.5-2.0")
    volume: float = 80
    pitch: float = Field(default=1.0, ge=0.5, le=2.0, description="音调比率，0.5-2.0")
    language: str = "Chinese"
    format: str = "wav"
    enable_ssml: bool = False
    enable_markdown_filter: bool = False
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
    speed: float = Field(default=1.0, ge=0.5, le=2.0, description="语速比率，0.5-2.0")
    volume: float = 80
    pitch: float = Field(default=1.0, ge=0.5, le=2.0, description="音调比率，0.5-2.0")


def _result_to_dict(r: dict) -> dict:
    # Shape must match `TTSResultRecordOut` (app/schemas/tts.py); the
    # `/history` endpoint validates against it via response_model.
    # 兼容 ORM 对象与仓储 dict 两种输入（Local 仓储返回 dict）。
    if isinstance(r, dict):
        rid = r["id"]
        created_at = r.get("created_at")
    else:
        rid = r.id
        created_at = r.created_at
    return {
        "id": rid,
        "text": r["text"] if isinstance(r, dict) else r.text,
        "voice_id": r["voice_id"] if isinstance(r, dict) else r.voice_id,
        "voice_name": r.get("voice_name") if isinstance(r, dict) else r.voice_name,
        "audio_url": f"/api/tts/audio/{rid}",
        "audio_format": r.get("audio_format") if isinstance(r, dict) else r.audio_format,
        "speed": r.get("speed") if isinstance(r, dict) else r.speed,
        "volume": r.get("volume") if isinstance(r, dict) else r.volume,
        "pitch": r.get("pitch") if isinstance(r, dict) else r.pitch,
        "instruction": r.get("instruction") if isinstance(r, dict) else r.instruction,
        "language": r.get("language") if isinstance(r, dict) else r.language,
        "created_at": created_at.isoformat() if hasattr(created_at, "isoformat") else created_at,
    }


@router.post("/synthesize", response_model=TTSResultOut)
async def synthesize_speech(
    request: TTSRequest,
    db: Session = Depends(get_db),
    repo: TTSResultRepository = Depends(get_tts_results_repo),
    store: AssetStore = Depends(get_asset_store),
):
    """合成语音 - 支持多引擎"""
    if request.engine == "edge_tts":
        return await _synthesize_edge_tts(request, db, repo, store)
    else:
        # cosyvoice 依赖 dashscope/qwen SDK，workers 模式不挂载/不支持，保持原逻辑
        return await _synthesize_cosyvoice(request, db)


async def _synthesize_cosyvoice(request: TTSRequest, db: Session = Depends(get_db)):
    """CosyVoice 引擎合成 - 根据存储模式决定是否持久化到后端"""
    audio_fmt = request.format or "mp3"

    logger.info(f'request is: {request}')
    if not request.voice_id:
        raise HTTPException(status_code=400, detail="voice_id is required")

    try:
        tts_service = await get_tts_service(db)

        logger.info(f"Synthesizing with cloned voice: {request.voice_id}")
        # clone_voice 现在直接下载并落盘到 settings.clone_voices_dir，
        # 返回文件绝对路径，文件名形如 {voice_id}_{YYYYMMDDHHMMSS}.{ext}
        audio_path = await tts_service.synthesize_speech(
            voice_id=request.voice_id,
            text=request.text,
            speed=request.speed,
            volume=request.volume,
            pitch=request.pitch,
            format=audio_fmt,
            sample_rate=16000,
            instruction=request.instruction,
            enable_ssml=request.enable_ssml,
            enable_markdown_filter=request.enable_markdown_filter,
        )

        audio_id = Path(audio_path).stem

        # 查询声音名称用于历史记录展示
        all_voices = db.query(VoiceProfile).all()
        voice = next(
            (v for v in all_voices
             if (v.voice_params or {}).get("cosyvoice", {}).get("params", {}).get("voice_id") == request.voice_id),
            None,
        )
        voice_name = voice.description or voice.name if voice else request.voice_id

        if is_frontend_storage(db):
            # 前端存储模式：读取音频返回 base64，不落盘到后端持久目录
            with open(audio_path, "rb") as f:
                audio_base64 = base64.b64encode(f.read()).decode("utf-8")
            # 清理 clone_voices_dir 中的临时落盘文件
            try:
                os.remove(audio_path)
            except OSError:
                pass
            return {
                "audio_id": audio_id,
                "audio_base64": audio_base64,
                "audio_format": audio_fmt,
                "text": request.text,
                "voice_id": request.voice_id,
                "voice_name": voice_name,
                "params": {
                    "speed": request.speed,
                    "volume": request.volume,
                    "pitch": request.pitch,
                    "instruction": request.instruction,
                    "enable_ssml": request.enable_ssml,
                    "enable_markdown_filter": request.enable_markdown_filter,
                    "voice_id": request.voice_id,
                }
            }
        else:
            # 后端存储模式：保持现状，持久化记录
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
                instruction=request.instruction,
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
                    "instruction": request.instruction,
                    "enable_ssml": request.enable_ssml,
                    "enable_markdown_filter": request.enable_markdown_filter,
                    "voice_id": request.voice_id,
                }
            }

    except Exception as e:
        logger.error(f"TTS synthesis failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"TTS synthesis failed: {str(e)}")


async def _synthesize_edge_tts(
    request: TTSRequest,
    db: Session,
    repo: TTSResultRepository,
    store: AssetStore,
):
    """Edge-TTS 引擎合成

    后端存储分支：音频经 asset store 落盘（local→data/tts-history/；
    workers→Supabase Storage/R2），记录经仓储持久化（workers→Supabase tts_results）。
    """
    if not request.edge_voice:
        raise HTTPException(status_code=400, detail="edge_voice is required for edge_tts engine")

    audio_id = str(uuid.uuid4())
    # 存储模式必须在写盘之前判定：workers 模式（Vercel/CF）FS 只读且无持久性，
    # 一旦先写 data/tts-history/ 再判存储模式，会在写盘处直接崩（Errno 2/EROFS），
    # 根本走不到 base64 分支。前端存储（含 workers 恒 True）不落盘、不建 DB 记录。
    frontend_storage = is_frontend_storage(db)

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

        if frontend_storage:
            # 前端存储模式（含 workers 只读 FS）：不落盘，直接返回 base64
            return {
                "audio_id": audio_id,
                "audio_base64": base64.b64encode(audio_data).decode("utf-8"),
                "audio_format": "mp3",
                "text": request.text,
                "voice_id": request.edge_voice,
                "voice_name": request.edge_voice,
                "params": {
                    "engine": "edge_tts",
                    "edge_voice": request.edge_voice,
                    "edge_rate": request.edge_rate,
                    "edge_volume": request.edge_volume,
                }
            }

        # 后端存储模式：音频进 asset store（local 写盘 / workers 写 Supabase Storage）
        ref = await store.put(f"data/tts-history/tts_{audio_id}.mp3", audio_data)
        repo.create({
            "id": audio_id,
            "text": request.text,
            "voice_id": request.edge_voice,
            "voice_name": request.edge_voice,
            "audio_path": ref,
            "audio_format": "mp3",
            "speed": 1.0,
            "volume": 80,
            "pitch": 1.0,
            "instruction": "",
            "language": "Chinese",
            "source": None,
        })

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


@router.get("/history", response_model=ItemsOut[TTSResultRecordOut])
async def get_synthesis_history(repo: TTSResultRepository = Depends(get_tts_results_repo)):
    """获取合成历史列表（local→SQLite；workers→Supabase tts_results）"""
    records = repo.list()
    return {"items": [_result_to_dict(r) for r in records]}


@router.delete("/history/{result_id}")
async def delete_synthesis_result(
    result_id: str,
    repo: TTSResultRepository = Depends(get_tts_results_repo),
    store: AssetStore = Depends(get_asset_store),
):
    """删除合成记录及音频文件"""
    record = repo.get(result_id)
    if not record:
        raise HTTPException(status_code=404, detail="Result not found")

    ref = record.get("audio_path")
    if ref:
        try:
            await store.delete(ref)
        except Exception as e:
            logger.warning(f"Failed to delete tts audio asset {ref}: {e}")

    repo.delete(result_id)

    return {"message": "Result deleted"}


@local_router.post("/batch")
async def batch_synthesize(request: BatchTTSRequest, db: Session = Depends(get_db)):
    """批量合成语音（仅 qwen/cosyvoice，workers 模式不挂载）"""
    results = []

    try:
        tts_service = await get_tts_service(db)

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
async def get_tts_audio(
    audio_id: str,
    repo: TTSResultRepository = Depends(get_tts_results_repo),
    store: AssetStore = Depends(get_asset_store),
):
    """获取 TTS 生成的音频。

    优先按 DB 记录的 audio_path（asset store ref）读取：local→磁盘文件，
    workers→Supabase Storage/R2。兼容历史绝对路径记录与旧 tts_{id}.{ext} 命名。
    """
    record = repo.get(audio_id)
    if record and record.get("audio_path"):
        data = await store.get(record["audio_path"])
        if data is not None:
            ext = (record.get("audio_format") or "mp3").lower()
            media_type = "audio/mpeg" if ext == "mp3" else f"audio/{ext}"
            return Response(content=data, media_type=media_type)

    # 兼容旧记录：audio_path 为本地绝对路径（历史数据）
    if record and record.get("audio_path") and os.path.exists(record["audio_path"]):
        ext = (record.get("audio_format") or "mp3").lower()
        media_type = "audio/mpeg" if ext == "mp3" else f"audio/{ext}"
        return FileResponse(record["audio_path"], media_type=media_type)

    # 兼容旧记录 / 旧 batch 临时文件命名：tts_{id}.{ext}（新根优先，旧目录回退）
    for base in (settings.tts_history_dir, settings.voices_dir):
        for ext in ["wav", "mp3", "ogg"]:
            legacy_path = base / f"tts_{audio_id}.{ext}"
            if os.path.exists(legacy_path):
                media_type = f"audio/{ext}" if ext != "mp3" else "audio/mpeg"
                return FileResponse(legacy_path, media_type=media_type)

    raise HTTPException(status_code=404, detail="Audio not found")


@router.get("/voices")
async def list_available_voices(
    voice_id: Optional[str] = None,
    project_id: Optional[str] = None,
    repo: VoiceProfileRepository = Depends(get_voice_repo),
):
    """查询已克隆声音。

    - 无参数: 返回全局声音 (project_id IS NULL)
    - voice_id: 返回指定单个声音
    - project_id: 返回全局声音 + 该项目专属声音
    """
    if voice_id:
        voice = repo.get(voice_id)
        if not voice:
            raise HTTPException(status_code=404, detail="Voice not found")
        return {"items": [voice]}

    # voice_type 在 voice JSON 列里，仓储按 project 过滤后在 Python 里筛 clone
    voices = [
        v for v in repo.list(project_id=project_id)
        if (v.get("voice") or {}).get("voice_type") == "clone"
    ]

    return {"items": voices}


@router.get("/edge-voices")
async def list_edge_voices(language: Optional[str] = None, gender: Optional[str] = None):
    """获取 Edge-TTS 可用音色列表"""
    try:
        from app.services.edge_tts_service import get_edge_tts_service
        edge_service = get_edge_tts_service()
        voices = await edge_service.list_voices(language=language, gender=gender)
        return {"items": voices}
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
        return {"items": languages}
    except Exception as e:
        logger.error(f"Failed to list edge-tts languages: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to list edge-tts languages: {str(e)}")


# ---- Segmented editor integration ----

def synthesize_speech_internal(
    *,
    text: str,
    voice_id: str = "",
    speed: float = 1.0,
    volume: float = 80.0,
    pitch: float = 1.0,
    instruction: str = "",
    enable_ssml: bool = False,
    enable_markdown_filter: bool = False,
    language: str = "Chinese",
    edge_voice: str | None = None,
    edge_rate: str | None = None,
    edge_volume: str | None = None,
    db: Session | None = None,
) -> tuple[bytes, str]:
    """Synthesize for the segmented editor. Returns (audio_bytes, native_format).

    Bridges the async TTS services into the segmented editor's sync path.
    Real engine implementations — NOT placeholders. The previous version of
    this function returned 50ms of silence for every call, which silently
    produced 2KB empty MP3s and stored them as "audio" in the DB. That's why
    segments saved to the backend "couldn't be played" — there was never any
    real speech content in the file in the first place.
    """
    import asyncio

    if edge_voice:
        # Edge TTS (no auth, online) — returns (mp3_bytes, "mp3") directly.
        from app.services.edge_tts_service import get_edge_tts_service
        edge_service = get_edge_tts_service()
        coro = edge_service.synthesize(
            text=text,
            voice=edge_voice,
            rate=edge_rate or "+0%",
            volume=edge_volume or "+0%",
        )
        return _run_async(coro)  # already (bytes, "mp3")

    if voice_id:
        # CosyVoice / Qwen TTS — needs QWEN_API_KEY, returns wav bytes.
        from app.services.qwen_tts_service import get_tts_service

        async def _synthesize() -> bytes:
            tts_service = await get_tts_service(db=db)
            result = await tts_service.synthesize_speech(
                voice_id=voice_id,
                text=text,
                instruction=instruction,
                speed=speed,
                volume=volume,
                pitch=pitch,
                format="wav",
                sample_rate=16000,
                enable_ssml=enable_ssml,
                enable_markdown_filter=enable_markdown_filter,
            )
            if isinstance(result, (str, os.PathLike)):
                return Path(result).read_bytes()
            return result

        return _run_async(_synthesize()), "wav"

    raise ValueError(
        "synthesize_speech_internal: must supply edge_voice or voice_id"
    )


def _run_async(coro):
    """Run an awaitable to completion from a sync context, handling the case
    where a FastAPI worker is already inside an event loop (in which case
    asyncio.run would raise RuntimeError)."""
    import asyncio
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop is None:
        # No running loop — use asyncio.run
        return asyncio.run(coro)
    else:
        # Already in a loop — create an isolated one in a new thread
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(asyncio.run, coro)
            return future.result()
