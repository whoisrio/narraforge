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
import logging

from app.core.database import get_db
from app.core.config import settings
from app.models import VoiceProfile
from app.services.qwen_tts_service import get_tts_service
from app.services.qiniu_service import is_qiniu_configured, upload_to_qiniu

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


class UploadFromUrlRequest(BaseModel):
    audio_url: str
    name: str = None
    role: str = "custom"
    prompt_text: Optional[str] = None


class UpdateDescriptionRequest(BaseModel):
    description: str = ""
    prompt_text: Optional[str] = None


# ============ Routes ============

@router.post("/upload")
async def upload_voice(
    file: UploadFile = File(...),
    prompt_text: str = Form(None),
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
    
    # 如果是 WebM 格式，先保存到临时文件，然后转换为 MP3
    if file_ext == "webm":
        # 保存原始 webm 到临时文件
        temp_dir = tempfile.gettempdir()
        temp_webm_path = os.path.join(temp_dir, f"{file_id}.webm")
        final_mp3_path = settings.voices_dir / f"{file_id}.mp3"
        
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
        file_path = settings.voices_dir / f"{file_id}.{file_extension}"
        
        async with aiofiles.open(file_path, "wb") as f:
            content = await file.read()
            await f.write(content)

    voice = VoiceProfile(
        id=file_id,
        name=file.filename or "Unnamed Voice",
        audio_path=str(file_path),
        role="custom",
        prompt_text=prompt_text or None,
    )
    db.add(voice)
    db.commit()
    db.refresh(voice)

    return {
        "id": voice.id,
        "name": voice.name,
        "audio_url": f"/api/clone/audio/{voice.id}",
        "is_cloned": voice.is_cloned,
        "prompt_text": voice.prompt_text,
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
    temp_dir = tempfile.gettempdir()
    temp_audio_path = os.path.join(temp_dir, f"{file_id}.mp3")
    final_audio_path = settings.voices_dir / f"{file_id}.mp3"
    
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
        audio_path=str(final_audio_path),
        role="custom",
        external_audio_url=audio_url,  # 保存原始 URL
        prompt_text=request.prompt_text or None,
    )
    db.add(voice)
    db.commit()
    db.refresh(voice)
    
    return {
        "id": voice.id,
        "name": voice.name,
        "audio_url": f"/api/clone/audio/{voice.id}",
        "external_audio_url": audio_url,
        "is_cloned": voice.is_cloned,
    }


@router.post("/create-clone")
async def create_clone(request: RegisterRequest, db: Session = Depends(get_db)):
    """注册克隆声音 - 调用千问 API"""
    voice = db.query(VoiceProfile).filter(VoiceProfile.id == request.voice_id).first()
    if not voice:
        raise HTTPException(status_code=404, detail="Voice not found")

    # 优先使用外部音频 URL（如果有），否则上传本地文件到七牛云
    if not voice.external_audio_url:
        if not os.path.exists(voice.audio_path):
            raise HTTPException(status_code=404, detail="Audio file not found")
        if not is_qiniu_configured(db):
            raise HTTPException(
                status_code=500,
                detail="Qiniu not configured; cannot generate public URL for cloning",
            )
        try:
            key = os.path.basename(voice.audio_path)
            qiniu_url = upload_to_qiniu(voice.audio_path, key, db=db)
            voice.external_audio_url = qiniu_url
            db.commit()
            db.refresh(voice)
        except RuntimeError as e:
            raise HTTPException(status_code=500, detail=f"Qiniu upload failed: {e}")

    audio_path_for_clone = voice.external_audio_url
    logger.info(f"Using external audio URL for cloning: {audio_path_for_clone}")

    try:
        tts_service = await get_tts_service(db)

        # 调用千问声音克隆 API 进行注册
        # register_cloned_voice 会自动检测 audio_path 是否为 URL
        result = await tts_service.register_cloned_voice(
            reference_audio_path=audio_path_for_clone,
            voice_name=request.name or voice.name,
        )

        # 更新数据库
        voice.qwen_voice_id = result["voice_id"]
        voice.role = result.get("role", request.role)
        voice.is_cloned = True
        voice.cloned_at = datetime.utcnow()
        voice.clone_engine = "qwen"

        if request.name:
            voice.name = request.name

        db.commit()
        db.refresh(voice)

        return {
            "id": voice.id,
            "name": voice.name,
            "qwen_voice_id": voice.qwen_voice_id,
            "role": voice.role,
            "is_cloned": voice.is_cloned,
            "cloned_at": voice.cloned_at.isoformat() if voice.cloned_at else None,
            "audio_url": f"/api/clone/audio/{voice.id}",
        }

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

    if not voice.audio_path or not os.path.exists(voice.audio_path):
        raise HTTPException(status_code=404, detail="Audio file not found")

    try:
        voice.is_cloned = True
        voice.cloned_at = datetime.utcnow()
        voice.clone_engine = "mimo"
        voice.mimo_voice_id = "mimo_voiceclone"  # 标记使用 MiMo voiceclone

        if request.name:
            voice.name = request.name

        db.commit()
        db.refresh(voice)

        return {
            "id": voice.id,
            "name": voice.name,
            "clone_engine": "mimo",
            "is_cloned": voice.is_cloned,
            "cloned_at": voice.cloned_at.isoformat() if voice.cloned_at else None,
            "audio_url": f"/api/clone/audio/{voice.id}",
        }

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

    if not voice.audio_path or not os.path.exists(voice.audio_path):
        raise HTTPException(status_code=404, detail="Audio file not found")

    try:
        voice.is_cloned = True
        voice.cloned_at = datetime.utcnow()
        voice.clone_engine = "voxcpm"

        if request.name:
            voice.name = request.name

        db.commit()
        db.refresh(voice)

        return {
            "id": voice.id,
            "name": voice.name,
            "clone_engine": "voxcpm",
            "is_cloned": voice.is_cloned,
            "cloned_at": voice.cloned_at.isoformat() if voice.cloned_at else None,
            "audio_url": f"/api/clone/audio/{voice.id}",
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"VoxCPM voice clone failed: {str(e)}")


@router.get("/list")
def list_voices(db: Session = Depends(get_db)):
    """获取声音列表"""
    voices = db.query(VoiceProfile).order_by(VoiceProfile.created_at.desc()).all()
    return [
        {
            "id": v.id,
            "description": v.description,
            "name": v.name,
            "audio_url": f"/api/clone/audio/{v.id}",
            "qwen_voice_id": v.qwen_voice_id,
            "role": v.role,
            "clone_engine": v.clone_engine,
            "is_cloned": v.is_cloned,
            "cloned_at": v.cloned_at.isoformat() if v.cloned_at else None,
            "created_at": v.created_at.isoformat(),
            "prompt_text": v.prompt_text,
        }
        for v in voices
    ]


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

            # 检查是否已存在
            existing = db.query(VoiceProfile).filter(
                VoiceProfile.qwen_voice_id == voice_id
            ).first()

            if existing:
                existing_count += 1
                # 更新已有记录
                existing.name = name
                existing.role = qwen_voice.get("role", "custom")
                db.commit()
                db.refresh(existing)
                results.append({
                    "id": existing.id,
                    "name": existing.name,
                    "qwen_voice_id": existing.qwen_voice_id,
                    "action": "updated"
                })
            else:
                # 创建新记录
                new_voice = VoiceProfile(
                    id=str(uuid.uuid4()),
                    name=name,
                    qwen_voice_id=voice_id,
                    role=qwen_voice.get("role", "custom"),
                    is_cloned=True,
                    cloned_at=datetime.utcnow(),
                    clone_engine="qwen",
                    audio_path="",  # 从 Qwen 同步的没有本地音频文件
                )
                db.add(new_voice)
                db.commit()
                db.refresh(new_voice)
                synced_count += 1
                results.append({
                    "id": new_voice.id,
                    "name": new_voice.name,
                    "qwen_voice_id": new_voice.qwen_voice_id,
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
        voice.prompt_text = request.prompt_text.strip() or None

    db.commit()
    db.refresh(voice)

    return {
        "id": voice.id,
        "description": voice.description,
        "prompt_text": voice.prompt_text,
    }


@router.get("/audio/{voice_id}")
async def get_voice_audio(voice_id: str, db: Session = Depends(get_db)):
    """获取声音音频文件"""
    voice = db.query(VoiceProfile).filter(VoiceProfile.id == voice_id).first()
    if not voice or not os.path.exists(voice.audio_path):
        raise HTTPException(status_code=404, detail="Audio not found")

    from fastapi.responses import FileResponse
    return FileResponse(voice.audio_path, media_type="audio/wav")


@router.get("/{voice_id}")
def get_voice(voice_id: str, db: Session = Depends(get_db)):
    """获取单个声音详情"""
    voice = db.query(VoiceProfile).filter(VoiceProfile.id == voice_id).first()
    if not voice:
        raise HTTPException(status_code=404, detail="Voice not found")

    return {
        "id": voice.id,
        "name": voice.name,
        "audio_url": f"/api/clone/audio/{voice.id}",
        "qwen_voice_id": voice.qwen_voice_id,
        "role": voice.role,
        "clone_engine": voice.clone_engine,
        "is_cloned": voice.is_cloned,
        "cloned_at": voice.cloned_at.isoformat() if voice.cloned_at else None,
        "created_at": voice.created_at.isoformat(),
    }


@router.delete("/{voice_id}")
async def delete_voice(voice_id: str, db: Session = Depends(get_db)):
    """删除声音 - 同时删除 Qwen 云端音色（如有）、本地音频文件和数据库记录"""
    voice = db.query(VoiceProfile).filter(VoiceProfile.id == voice_id).first()
    if not voice:
        raise HTTPException(status_code=404, detail="Voice not found")

    # Qwen 声音需要删除云端音色；MiMo 声音无云端数据，跳过
    if voice.clone_engine != "mimo" and voice.qwen_voice_id:
        try:
            tts_service = await get_tts_service(db)
            await tts_service.delete_cloned_voice(voice.qwen_voice_id)
        except Exception as e:
            logger.error(f"Failed to delete voice from Qwen: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to delete cloned voice on Qwen: {str(e)}",
            )

    if voice.audio_path and os.path.exists(voice.audio_path):
        os.remove(voice.audio_path)

    db.delete(voice)
    db.commit()

    return {"message": "Voice deleted"}
