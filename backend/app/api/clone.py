from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel
import uuid
import aiofiles
import os
import subprocess
import tempfile

from app.api._voice_helpers import voice_to_dict
import logging

from app.core.database import get_db
from app.core.config import settings
from app.models import VoiceProfile
from app.services.qwen_tts_service import get_tts_service
from app.services.qiniu_service import is_qiniu_configured, upload_to_qiniu
from app.core.time_utils import utcnow


def _resolve(db_path: str | None) -> str | None:
    """将 DB 中的路径（相对或绝对）解析为绝对路径。不存在则返回 None。"""
    if not db_path:
        return None
    p = settings.resolve_path(db_path)
    return str(p) if p.exists() else None

logger = logging.getLogger(__name__)

router = APIRouter()


def convert_audio_to_mp3(input_path: str, output_path: str) -> bool:
    """
    使用 ffmpeg 将音频文件转换为 MP3 格式

    为什么需要转换：
    - 浏览器 MediaRecorder 录制的是 WebM 格式
    - Qwen API 只支持 MP3/WAV/OGG 格式
    - 后端自动转换提供最佳用户体验
    """
    try:
        # 检查 ffmpeg 是否可用
        result = subprocess.run(
            ["ffmpeg", "-version"],
            capture_output=True,
            text=True,
            check=False
        )
        if result.returncode != 0:
            raise RuntimeError("ffmpeg not found. Please install ffmpeg.")

        # 执行转换
        cmd = [
            "ffmpeg",
            "-i", input_path,
            "-acodec", "libmp3lame",
            "-ab", "192k",
            "-ar", "16000",
            "-y",  # 覆盖输出文件
            output_path
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False
        )

        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg conversion failed: {result.stderr}")

        return True
    except FileNotFoundError:
        raise RuntimeError(
            "ffmpeg not found. Please install ffmpeg from https://ffmpeg.org/download.html"
        )


# ============ Request Models ============

class RegisterRequest(BaseModel):
    voice_id: str
    name: str = None
    role: str = "custom"
    avatar: str | None = None
    project_id: str | None = None
    engine_params: dict | None = None


class UploadFromUrlRequest(BaseModel):
    audio_url: str
    name: str = None
    role: str = "custom"
    prompt_text: Optional[str] = None
    project_id: str | None = None


class UpdateDescriptionRequest(BaseModel):
    description: str = ""
    prompt_text: Optional[str] = None


class DesignVoiceRequest(BaseModel):
    """从音色设计的预览音频创建 VoiceProfile"""
    audio_base64: str
    engine: str  # 'mimo' | 'voxcpm'
    name: str
    description: str = ""
    avatar: str | None = None  # data URL 或外部 URL
    project_id: str | None = None  # 项目专属声音 (NULL = 全局)
    voice_description: str | None = None  # 音色设计描述
    instruction: str | None = None  # 合成指令
    preview_text: str | None = None  # 试听文本（存为 audition_text）
    original_prompt_text: str | None = None  # 原始语音转录（ultimate clone 的 prompt_text）


# ============ Routes ============

@router.post("/upload")
async def upload_voice(
    file: UploadFile = File(...),
    prompt_text: str = Form(None),
    project_id: str = Form(None),
    db: Session = Depends(get_db),
):
    """上传音频文件 - 支持 WebM/MP3/WAV/OGG，WebM 会自动转换为 MP3"""
    # 支持的输入格式
    allowed_extensions = ["mp3", "wav", "ogg", "webm"]
    file_ext = file.filename.split(".")[-1].lower() if "." in file.filename else ""

    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format: {file_ext}. Please upload MP3, WAV, OGG, or WebM files."
        )

    file_id = str(uuid.uuid4())
    # 文件名：角色名_时间戳（可读性好）
    base_name = os.path.splitext(file.filename or "voice")[0]
    safe_name = base_name.replace("/", "_").replace("\\", "_").replace(" ", "_")[:30]
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    # 如果是 WebM 格式，先保存到临时文件，然后转换为 MP3
    if file_ext == "webm":
        # 保存原始 webm 到临时文件
        temp_dir = tempfile.gettempdir()
        temp_webm_path = os.path.join(temp_dir, f"{file_id}.webm")
        final_mp3_path = settings.voices_dir / f"{safe_name}_{ts}.mp3"

        try:
            # 保存上传的文件
            async with aiofiles.open(temp_webm_path, "wb") as f:
                content = await file.read()
                await f.write(content)

            # 转换为 MP3
            convert_audio_to_mp3(temp_webm_path, str(final_mp3_path))

            # 删除临时文件
            os.remove(temp_webm_path)

            file_path = str(final_mp3_path)
            file_extension = "mp3"

        except Exception as e:
            # 清理临时文件
            if os.path.exists(temp_webm_path):
                os.remove(temp_webm_path)
            raise HTTPException(
                status_code=500,
                detail=f"Failed to convert audio: {str(e)}"
            )
    else:
        # 直接保存其他格式
        file_extension = file_ext
        file_path = settings.voices_dir / f"{safe_name}_{ts}.{file_extension}"

        async with aiofiles.open(file_path, "wb") as f:
            content = await file.read()
            await f.write(content)

    voice = VoiceProfile(
        id=file_id,
        name=file.filename or "Unnamed Voice",
        voice={"model": "", "voice_type": "upload"},
        voice_params={"": {"source_audio_path": settings.to_relative(file_path), "params": {"prompt_text": prompt_text or None}}},
        project_id=project_id or None,
    )
    db.add(voice)
    db.commit()
    db.refresh(voice)

    return {
        "id": voice.id,
        "name": voice.name,
        "audio_url": f"/api/clone/audio/{voice.id}",
        "is_cloned": (voice.voice or {}).get("voice_type") == "clone",
        "prompt_text": (voice.voice_params or {}).get("", {}).get("params", {}).get("prompt_text"),
    }


@router.post("/upload-from-url")
async def upload_voice_from_url(request: UploadFromUrlRequest, db: Session = Depends(get_db)):
    """
    从外部 URL 上传音频文件 - 支持直接传入七牛云、AWS S3 等外部存储的音频 URL

    为什么需要这个接口：
    - CosyVoice API 需要公网可访问的音频 URL
    - 用户可以直接传入云存储的 URL，无需通过 ngrok 暴露本地服务
    - 简化了声音克隆流程
    """
    import requests as req

    audio_url = request.audio_url

    # 验证 URL 是否可访问（禁用代理）
    try:
        head_resp = req.head(audio_url, timeout=30, allow_redirects=True, proxies={'http': None, 'https': None})
        if head_resp.status_code != 200:
            raise HTTPException(
                status_code=400,
                detail=f"Audio URL is not accessible. Status code: {head_resp.status_code}"
            )

        # 检查 Content-Type 是否为音频
        content_type = head_resp.headers.get('Content-Type', '')
        if not content_type.startswith('audio/'):
            logger.warning(f"URL may not be an audio file. Content-Type: {content_type}")

    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to access audio URL: {str(e)}"
        )

    # 下载音频文件（禁用代理）
    file_id = str(uuid.uuid4())
    safe_name = (request.name or "voice").replace("/", "_").replace("\\", "_").replace(" ", "_")[:30]
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    temp_dir = tempfile.gettempdir()
    temp_audio_path = os.path.join(temp_dir, f"{file_id}.mp3")
    final_audio_path = settings.voices_dir / f"{safe_name}_{ts}.mp3"

    try:
        # 下载音频（禁用代理）
        download_resp = req.get(audio_url, timeout=60, stream=True, proxies={'http': None, 'https': None})
        if download_resp.status_code != 200:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to download audio. Status code: {download_resp.status_code}"
            )

        # 保存到临时文件
        with open(temp_audio_path, "wb") as f:
            for chunk in download_resp.iter_content(chunk_size=8192):
                f.write(chunk)

        # 转换为 MP3（如果不是 MP3 格式）
        file_ext = audio_url.split('?')[0].split('.')[-1].lower() if '.' in audio_url else 'mp3'
        if file_ext != 'mp3':
            convert_audio_to_mp3(temp_audio_path, str(final_audio_path))
            os.remove(temp_audio_path)
        else:
            # 移动文件到 voices 目录
            import shutil
            shutil.move(temp_audio_path, str(final_audio_path))

    except Exception as e:
        if os.path.exists(temp_audio_path):
            os.remove(temp_audio_path)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to download or process audio: {str(e)}"
        )

    # 创建数据库记录
    voice = VoiceProfile(
        id=file_id,
        name=request.name or f"Voice_{file_id[:8]}",
        voice={"model": "", "voice_type": "upload"},
        voice_params={"": {"source_audio_path": settings.to_relative(final_audio_path), "params": {"external_audio_url": audio_url, "prompt_text": request.prompt_text or None}}},
        project_id=request.project_id or None,
    )
    db.add(voice)
    db.commit()
    db.refresh(voice)

    return {
        "id": voice.id,
        "name": voice.name,
        "audio_url": f"/api/clone/audio/{voice.id}",
        "external_audio_url": audio_url,
        "is_cloned": (voice.voice or {}).get("voice_type") == "clone",
    }


@router.post("/create-clone")
async def create_clone(request: RegisterRequest, db: Session = Depends(get_db)):
    """注册克隆声音 - 调用千问 API"""
    voice = db.query(VoiceProfile).filter(VoiceProfile.id == request.voice_id).first()
    if not voice:
        raise HTTPException(status_code=404, detail="Voice not found")

    # 优先使用外部音频 URL（如果有），否则上传本地文件到七牛云
    vp = dict(voice.voice_params or {})
    model = (voice.voice or {}).get("model", "")
    model_vp = dict(vp.get(model, {}) or {})
    ext_audio_url = model_vp.get("params", {}).get("external_audio_url")
    if not ext_audio_url:
        resolved_src = _resolve(model_vp.get("source_audio_path", ""))
        if not resolved_src:
            raise HTTPException(status_code=404, detail="Audio file not found")
        if not is_qiniu_configured(db):
            raise HTTPException(
                status_code=500,
                detail="Qiniu not configured; cannot generate public URL for cloning",
            )
        try:
            key = os.path.basename(resolved_src)
            qiniu_url = upload_to_qiniu(resolved_src, key, db=db)
            model_vp.setdefault("params", {})["external_audio_url"] = qiniu_url
            audio_path_for_clone = qiniu_url
        except RuntimeError as e:
            raise HTTPException(status_code=500, detail=f"Qiniu upload failed: {e}")
    else:
        audio_path_for_clone = ext_audio_url

    logger.info(f"Using external audio URL for cloning: {audio_path_for_clone}")

    try:
        tts_service = await get_tts_service(db)

        # 调用千问声音克隆 API 进行注册
        result = await tts_service.register_cloned_voice(
            reference_audio_path=audio_path_for_clone,
            voice_name=request.name or voice.name,
        )

        # 更新数据库
        new_vp = {}
        new_model_vp = dict(model_vp)
        new_model_vp.setdefault("params", {})
        new_model_vp["params"]["voice_id"] = result["voice_id"]
        if audio_path_for_clone and audio_path_for_clone != ext_audio_url:
            new_model_vp["params"]["external_audio_url"] = audio_path_for_clone
        if request.engine_params:
            new_model_vp["params"].update(request.engine_params)
        new_vp["cosyvoice"] = new_model_vp
        voice.voice = {"model": "cosyvoice", "voice_type": "clone"}
        voice.voice_params = new_vp

        if request.name:
            voice.name = request.name
        if request.avatar:
            voice.avatar = request.avatar
        if request.project_id and not voice.project_id:
            voice.project_id = request.project_id

        db.commit()
        db.refresh(voice)

        return voice_to_dict(voice)

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Voice registration failed: {str(e)}")


@router.post("/create-clone-mimo")
async def create_clone_mimo(request: RegisterRequest, db: Session = Depends(get_db)):
    """
    MiMo 声音复刻 - 仅保存音频并标记为 MiMo 复刻，无需注册到云端。

    MiMo 的 voiceclone 是无状态的：每次合成都需要传音频样本（base64），
    没有持久化 voice_id。此接口只是将上传的音频标记为「MiMo 复刻」，
    后续在 TTS 合成时自动读取音频文件转 base64 发给 MiMo API。
    """
    voice = db.query(VoiceProfile).filter(VoiceProfile.id == request.voice_id).first()
    if not voice:
        raise HTTPException(status_code=404, detail="Voice not found")

    model = (voice.voice or {}).get("model", "")
    source_path = (voice.voice_params or {}).get(model, {}).get("source_audio_path", "")
    resolved_src = _resolve(source_path)
    if not resolved_src:
        raise HTTPException(status_code=404, detail="Audio file not found")

    try:
        voice.voice = {"model": "mimo_tts", "voice_type": "clone"}
        vp = dict(voice.voice_params or {})
        if "" in vp and "mimo_tts" not in vp:
            vp["mimo_tts"] = vp.pop("")
        model_vp = dict(vp.get("mimo_tts", {}) or {})
        model_vp.setdefault("params", {})["voice_id"] = "mimo_voiceclone"
        if request.engine_params:
            model_vp["params"].update(request.engine_params)
        vp["mimo_tts"] = model_vp
        voice.voice_params = vp

        if request.name:
            voice.name = request.name
        if request.avatar:
            voice.avatar = request.avatar
        if request.project_id and not voice.project_id:
            voice.project_id = request.project_id

        db.commit()
        db.refresh(voice)

        return voice_to_dict(voice)

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"MiMo voice clone failed: {str(e)}")


@router.post("/create-clone-voxcpm")
async def create_clone_voxcpm(request: RegisterRequest, db: Session = Depends(get_db)):
    """
    VoxCPM 声音复刻 - 仅保存音频并标记为 VoxCPM 复刻，无需云端注册。

    VoxCPM 是本地 GPU 推理模型，克隆时直接读取本地参考音频文件路径，
    不需要注册到云端。此接口只是将上传的音频标记为「VoxCPM 复刻」，
    后续在 TTS 合成时自动读取音频文件路径传给 VoxCPM 模型。
    """
    voice = db.query(VoiceProfile).filter(VoiceProfile.id == request.voice_id).first()
    if not voice:
        raise HTTPException(status_code=404, detail="Voice not found")

    model = (voice.voice or {}).get("model", "")
    source_path = (voice.voice_params or {}).get(model, {}).get("source_audio_path", "")
    resolved_src = _resolve(source_path)
    if not resolved_src:
        raise HTTPException(status_code=404, detail="Audio file not found")

    try:
        engine_params = request.engine_params or {}
        voxcpm_mode = engine_params.get("voxcpm_mode", "clone")
        voice.voice = {"model": "voxcpm", "voice_type": "clone"}
        vp = dict(voice.voice_params or {})
        if "" in vp and "voxcpm" not in vp:
            vp["voxcpm"] = vp.pop("")
        model_vp = dict(vp.get("voxcpm", {}) or {})
        model_vp["mode"] = voxcpm_mode
        if engine_params:
            model_vp.setdefault("params", {})
            model_vp["params"].update(engine_params)
        vp["voxcpm"] = model_vp
        voice.voice_params = vp

        if request.name:
            voice.name = request.name
        if request.avatar:
            voice.avatar = request.avatar
        if request.project_id and not voice.project_id:
            voice.project_id = request.project_id

        db.commit()
        db.refresh(voice)

        return voice_to_dict(voice)

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"VoxCPM voice clone failed: {str(e)}")


@router.post("/create-from-design")
async def create_voice_from_design(request: DesignVoiceRequest, db: Session = Depends(get_db)):
    """
    从音色设计的预览音频创建 VoiceProfile。

    用于 MiMo voicedesign、VoxCPM design 和预置音色流程：
    用户描述音色 → 试听 → 满意后调用此接口持久化音频为 VoiceProfile。
    之后可通过 voiceclone 模式使用该声音。
    """
    import base64
    from datetime import datetime

    try:
        audio_bytes = base64.b64decode(request.audio_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 audio data")

    if len(audio_bytes) < 100:
        raise HTTPException(status_code=400, detail="Audio data too small")

    # 根据引擎选择格式
    audio_ext = "wav" if request.engine == "voxcpm" else "mp3"
    voice_id = str(uuid.uuid4())
    # 文件名：角色名_时间戳（可读性好）
    safe_name = (request.name or "voice").replace("/", "_").replace("\\", "_").replace(" ", "_")[:30]
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    audio_path = settings.clone_voices_dir / f"{safe_name}_{ts}.{audio_ext}"

    # 保存音频文件
    settings.clone_voices_dir.mkdir(parents=True, exist_ok=True)
    with open(audio_path, "wb") as f:
        f.write(audio_bytes)

    # 创建 VoiceProfile 记录
    if request.engine == "preset":
        model = "mimo_tts"
        voice_type = "clone"
    elif request.engine == "mimo":
        model = "mimo_tts"
        voice_type = "design"
    else:
        model = "voxcpm"
        voice_type = "design"

    vp_params: dict = {}
    if request.voice_description:
        vp_params["voice_description"] = request.voice_description
    if request.instruction:
        vp_params["instruction"] = request.instruction
    if request.preview_text:
        vp_params["audition_text"] = request.preview_text
    if request.original_prompt_text:
        vp_params["original_prompt_text"] = request.original_prompt_text

    voice = VoiceProfile(
        id=voice_id,
        name=request.name,
        description=request.description,
        avatar=request.avatar,
        project_id=request.project_id,
        voice={"model": model, "voice_type": voice_type},
        voice_params={model: {"source_audio_path": settings.to_relative(audio_path), "params": vp_params}},
        preview={
            "audition_text": request.preview_text,
            "preview_audio_path": settings.to_relative(audio_path),
        },
    )
    db.add(voice)
    db.commit()
    db.refresh(voice)

    logger.info(f"Created VoiceProfile from design: id={voice_id}, engine={request.engine}, name={request.name}, project_id={request.project_id}")

    return voice_to_dict(voice)


class PreviewAudioRequest(BaseModel):
    audio_base64: str
    audio_format: str = "wav"


@router.patch("/{voice_id}/preview-audio")
async def save_preview_audio(voice_id: str, request: PreviewAudioRequest, db: Session = Depends(get_db)):
    """
    保存克隆音色的试听音频。

    用于克隆流程：用户录制/上传原始音频 → 克隆 → 试听合成 → 保存试听音频。
    """
    import base64

    voice = db.query(VoiceProfile).filter(VoiceProfile.id == voice_id).first()
    if not voice:
        raise HTTPException(status_code=404, detail="Voice not found")

    try:
        audio_bytes = base64.b64decode(request.audio_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 audio data")

    if len(audio_bytes) < 100:
        raise HTTPException(status_code=400, detail="Audio data too small")

    audio_ext = request.audio_format or "wav"
    safe_name = (voice.name or "voice").replace("/", "_").replace("\\", "_").replace(" ", "_")[:30]
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    preview_path = settings.clone_voices_dir / f"{safe_name}_{ts}.{audio_ext}"

    settings.clone_voices_dir.mkdir(parents=True, exist_ok=True)
    with open(preview_path, "wb") as f:
        f.write(audio_bytes)

    preview_data = dict(voice.preview or {})
    preview_data["preview_audio_path"] = settings.to_relative(preview_path)
    voice.preview = preview_data
    db.commit()
    db.refresh(voice)

    logger.info(f"Saved preview audio for voice {voice_id}: {preview_path}")

    return {
        "id": voice.id,
        "cloned_preview_path": (voice.preview or {}).get("preview_audio_path"),
    }



@router.get("/list")
def list_voices(project_id: str | None = None, db: Session = Depends(get_db)):
    """获取声音列表。无 project_id 时返回全局声音；有 project_id 时返回全局 + 该项目的声音。"""
    from sqlalchemy import or_
    query = db.query(VoiceProfile)
    if project_id:
        query = query.filter(or_(VoiceProfile.project_id == None, VoiceProfile.project_id == project_id))
    else:
        query = query.filter(VoiceProfile.project_id == None)
    voices = query.order_by(VoiceProfile.created_at.desc()).all()
    return [voice_to_dict(v) for v in voices]


@router.get("/list-from-qwen")
async def list_voices_from_qwen():
    """从千问 API 获取已克隆的声音列表"""
    tts_service = await get_tts_service(db)
    voices = await tts_service.list_cloned_voices()
    return {"voices": voices}


@router.post("/sync-from-qwen")
async def sync_voices_from_qwen(db: Session = Depends(get_db)):
    """从千问 API 同步已克隆的声音到本地数据库"""
    tts_service = await get_tts_service(db)

    try:
        # 获取 Qwen 上的所有已克隆声音
        qwen_voices = await tts_service.list_cloned_voices()
        logger.info(f"Processing voice {qwen_voices}")
        synced_count = 0
        existing_count = 0
        results = []

        for qwen_voice in qwen_voices:
            voice_id = qwen_voice.get("voice_id")
            name = qwen_voice.get("name", f"voice_{voice_id}")
            status = qwen_voice.get("status", "UNKNOWN")

            # 只同步状态为 OK 的音色
            if status != "OK":
                continue

            # 检查是否已存在 (use Python filter since JSON column)
            all_voices = db.query(VoiceProfile).all()
            existing = None
            for v in all_voices:
                vp = v.voice_params or {}
                cosy_vp = (vp.get("cosyvoice") or {})
                if cosy_vp.get("params", {}).get("voice_id") == voice_id:
                    existing = v
                    break

            if existing:
                existing_count += 1
                # 更新已有记录
                existing.name = name
                voice_data = existing.voice or {}
                voice_data["role"] = qwen_voice.get("role", "custom")
                existing.voice = voice_data
                db.commit()
                db.refresh(existing)
                results.append({
                    "id": existing.id,
                    "name": existing.name,
                    "qwen_voice_id": ((existing.voice_params or {}).get("cosyvoice", {}) or {}).get("params", {}).get("voice_id"),
                    "action": "updated"
                })
            else:
                # 创建新记录
                new_voice = VoiceProfile(
                    id=str(uuid.uuid4()),
                    name=name,
                    voice={"model": "cosyvoice", "voice_type": "clone"},
                    voice_params={"cosyvoice": {"params": {"voice_id": voice_id}}},
                )
                db.add(new_voice)
                db.commit()
                db.refresh(new_voice)
                synced_count += 1
                results.append({
                    "id": new_voice.id,
                    "name": new_voice.name,
                    "qwen_voice_id": voice_id,
                    "action": "created"
                })

        return {
            "message": f"Synced {synced_count} new voices, updated {existing_count} existing",
            "synced": synced_count,
            "updated": existing_count,
            "total_qwen_voices": len(qwen_voices),
            "results": results
        }

    except Exception as e:
        logger.error(f"Failed to sync voices from Qwen: {e}")
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")


@router.patch("/{voice_id}/description")
def update_voice_description(voice_id: str, request: UpdateDescriptionRequest, db: Session = Depends(get_db)):
    """
    更新声音的描述信息和/或 prompt_text

    为什么需要专用接口而不是通用 PATCH：
    - 当前只有 description 和 prompt_text 两个可编辑字段，专用接口职责单一
    - 避免通用 PATCH 引入修改 voice_id/name 等敏感字段的安全隐患
    """
    voice = db.query(VoiceProfile).filter(VoiceProfile.id == voice_id).first()
    if not voice:
        raise HTTPException(status_code=404, detail="Voice not found")

    # 空字符串视为清除描述，统一存为 NULL 以简化前端判断逻辑
    new_description = request.description.strip() or None

    # 描述不得与其他声音重复，避免混淆
    if new_description is not None:
        duplicate = db.query(VoiceProfile).filter(
            VoiceProfile.description == new_description,
            VoiceProfile.id != voice_id,  # 排除自身
        ).first()
        if duplicate:
            raise HTTPException(status_code=409, detail="该描述已用于其他声音，请使用不同的描述")

    voice.description = new_description

    # 更新 prompt_text（如果提供了的话）
    if request.prompt_text is not None:
        voice_data = dict(voice.voice or {})
        model = voice_data.get("model", "")
        vp = dict(voice.voice_params or {})
        model_vp = dict(vp.get(model, {}) or {})
        model_vp.setdefault("params", {})["prompt_text"] = request.prompt_text.strip() or None
        vp[model] = model_vp
        voice.voice_params = vp

    db.commit()
    db.refresh(voice)

    return {
        "id": voice.id,
        "description": voice.description,
        "prompt_text": ((voice.voice_params or {}).get((voice.voice or {}).get("model", ""), {}) or {}).get("params", {}).get("prompt_text"),
    }


@router.get("/audio/{voice_id}")
async def get_voice_audio(voice_id: str, field: str = None, db: Session = Depends(get_db)):
    """获取声音音频文件。field='source' 返回源音频，field='preview' 返回克隆/设计试听音频。"""
    voice = db.query(VoiceProfile).filter(VoiceProfile.id == voice_id).first()
    if not voice:
        raise HTTPException(status_code=404, detail="Voice not found")

    from fastapi.responses import FileResponse

    model = (voice.voice or {}).get("model", "")
    source_path = (voice.voice_params or {}).get(model, {}).get("source_audio_path", "")
    preview_path = (voice.preview or {}).get("preview_audio_path", "")
    resolved_src = _resolve(source_path)
    resolved_preview = _resolve(preview_path)

    if field == "source" and resolved_src:
        return FileResponse(resolved_src, media_type="audio/wav")
    if field == "preview" and resolved_preview:
        return FileResponse(resolved_preview, media_type="audio/wav")

    # Fallback: preview 优先，否则 source
    if resolved_preview:
        return FileResponse(resolved_preview, media_type="audio/wav")
    if resolved_src:
        return FileResponse(resolved_src, media_type="audio/wav")
    raise HTTPException(status_code=404, detail="Audio not found")


@router.get("/{voice_id}")
def get_voice(voice_id: str, db: Session = Depends(get_db)):
    """获取单个声音详情"""
    from app.api._voice_helpers import voice_to_dict
    voice = db.query(VoiceProfile).filter(VoiceProfile.id == voice_id).first()
    if not voice:
        raise HTTPException(status_code=404, detail="Voice not found")

    return voice_to_dict(voice)


@router.delete("/{voice_id}")
async def delete_voice(voice_id: str, db: Session = Depends(get_db)):
    """删除声音 - 同时删除 Qwen 云端音色（如有）、本地音频文件和数据库记录"""
    voice = db.query(VoiceProfile).filter(VoiceProfile.id == voice_id).first()
    if not voice:
        raise HTTPException(status_code=404, detail="Voice not found")

    # Qwen 声音需要删除云端音色；MiMo/VoxCPM 声音无云端数据，跳过
    voice_data = voice.voice or {}
    cosy_vp = (voice.voice_params or {}).get("cosyvoice", {}) or {}
    if voice_data.get("model") == "cosyvoice" and cosy_vp.get("params", {}).get("voice_id"):
        try:
            tts_service = await get_tts_service(db)
            await tts_service.delete_cloned_voice(cosy_vp["params"]["voice_id"])
        except Exception as e:
            logger.error(f"Failed to delete voice from Qwen: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to delete cloned voice on Qwen: {str(e)}",
            )

    model = voice_data.get("model", "")
    source_path = (voice.voice_params or {}).get(model, {}).get("source_audio_path", "")
    preview_path = (voice.preview or {}).get("preview_audio_path", "")
    resolved_src = _resolve(source_path)
    resolved_preview = _resolve(preview_path)
    if resolved_src:
        os.remove(resolved_src)
    if resolved_preview:
        os.remove(resolved_preview)

    db.delete(voice)
    db.commit()

    return {"message": "Voice deleted"}
