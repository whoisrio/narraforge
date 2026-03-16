from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime
from pydantic import BaseModel
import uuid
import aiofiles
import os
import subprocess
import tempfile

from app.core.database import get_db
from app.core.config import settings
from app.models import VoiceProfile
from app.services.qwen_tts_service import get_tts_service

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


class CloneSynthesizeRequest(BaseModel):
    voice_id: str
    text: str
    speed: float = 1.0
    volume: float = 80
    pitch: int = 0


# ============ Routes ============

@router.post("/upload")
async def upload_voice(file: UploadFile = File(...), db: Session = Depends(get_db)):
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
    )
    db.add(voice)
    db.commit()
    db.refresh(voice)

    return {
        "id": voice.id,
        "name": voice.name,
        "audio_url": f"/api/clone/audio/{voice.id}",
        "is_cloned": voice.is_cloned,
    }


@router.post("/create-clone")
async def create_clone(request: RegisterRequest, db: Session = Depends(get_db)):
    """注册克隆声音 - 调用千问 API"""
    voice = db.query(VoiceProfile).filter(VoiceProfile.id == request.voice_id).first()
    if not voice:
        raise HTTPException(status_code=404, detail="Voice not found")

    if not os.path.exists(voice.audio_path):
        raise HTTPException(status_code=404, detail="Audio file not found")

    try:
        tts_service = await get_tts_service()

        # 调用千问声音克隆 API 进行注册
        result = await tts_service.register_cloned_voice(
            reference_audio_path=voice.audio_path,
            voice_name=request.name or voice.name,
        )

        # 更新数据库
        voice.qwen_voice_id = result["voice_id"]
        voice.role = result.get("role", request.role)
        voice.is_cloned = True
        voice.cloned_at = datetime.utcnow()

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


@router.get("/list")
def list_voices(db: Session = Depends(get_db)):
    """获取声音列表"""
    voices = db.query(VoiceProfile).order_by(VoiceProfile.created_at.desc()).all()
    return [
        {
            "id": v.id,
            "name": v.name,
            "audio_url": f"/api/clone/audio/{v.id}",
            "qwen_voice_id": v.qwen_voice_id,
            "role": v.role,
            "is_cloned": v.is_cloned,
            "cloned_at": v.cloned_at.isoformat() if v.cloned_at else None,
            "created_at": v.created_at.isoformat(),
        }
        for v in voices
    ]


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
        "is_cloned": voice.is_cloned,
        "cloned_at": voice.cloned_at.isoformat() if voice.cloned_at else None,
        "created_at": voice.created_at.isoformat(),
    }


@router.delete("/{voice_id}")
def delete_voice(voice_id: str, db: Session = Depends(get_db)):
    """删除声音"""
    voice = db.query(VoiceProfile).filter(VoiceProfile.id == voice_id).first()
    if not voice:
        raise HTTPException(status_code=404, detail="Voice not found")

    if os.path.exists(voice.audio_path):
        os.remove(voice.audio_path)

    db.delete(voice)
    db.commit()

    return {"message": "Voice deleted"}


@router.post("/synthesize")
async def clone_synthesize(request: CloneSynthesizeRequest, db: Session = Depends(get_db)):
    """使用克隆的声音合成文本"""
    voice = db.query(VoiceProfile).filter(VoiceProfile.id == request.voice_id).first()
    if not voice:
        raise HTTPException(status_code=404, detail="Voice profile not found")

    if not voice.is_cloned or not voice.qwen_voice_id:
        raise HTTPException(status_code=400, detail="Voice not registered. Please call /create-clone first.")

    audio_id = str(uuid.uuid4())
    output_path = settings.voices_dir / f"cloned_{audio_id}.wav"

    try:
        tts_service = await get_tts_service()

        # 使用已注册的 voice_id 进行合成
        audio_data = await tts_service.clone_voice(
            voice_id=voice.qwen_voice_id,
            text=request.text,
            speed=request.speed,
            volume=request.volume,
            pitch=request.pitch,
            format="wav",
            sample_rate=16000,
        )

        async with aiofiles.open(output_path, "wb") as f:
            await f.write(audio_data)

        return {
            "audio_id": audio_id,
            "audio_url": f"/api/clone/cloned_audio/{audio_id}",
            "text": request.text,
            "voice_id": voice.qwen_voice_id,
            "params": {
                "speed": request.speed,
                "volume": request.volume,
                "pitch": request.pitch,
            }
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Voice cloning failed: {str(e)}")


@router.get("/cloned_audio/{audio_id}")
async def get_cloned_audio(audio_id: str):
    """获取克隆合成的音频"""
    audio_path = settings.voices_dir / f"cloned_{audio_id}.wav"

    from fastapi.responses import FileResponse
    if os.path.exists(audio_path):
        return FileResponse(audio_path, media_type="audio/wav")
    else:
        raise HTTPException(status_code=404, detail="Cloned audio not found")