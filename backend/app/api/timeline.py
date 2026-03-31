from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
import uuid
import aiofiles
import os

from app.core.database import get_db
from app.core.config import settings
from app.models import TimelineProject, TimelineSegment

router = APIRouter()


class SegmentCreate(BaseModel):
    text: str
    start_time: float
    end_time: float


class ProjectCreate(BaseModel):
    name: str


@router.post("/project")
def create_project(data: ProjectCreate, db: Session = Depends(get_db)):
    """创建时间轴项目"""
    project = TimelineProject(id=str(uuid.uuid4()), name=data.name)
    db.add(project)
    db.commit()
    db.refresh(project)

    return {"id": project.id, "name": project.name, "created_at": project.created_at.isoformat()}


@router.get("/project")
def list_projects(db: Session = Depends(get_db)):
    """获取时间轴项目列表"""
    projects = db.query(TimelineProject).order_by(TimelineProject.created_at.desc()).all()
    return [
        {
            "id": p.id,
            "name": p.name,
            "video_url": f"/api/timeline/video/{p.id}" if p.video_path else None,
            "created_at": p.created_at.isoformat()
        }
        for p in projects
    ]


@router.get("/project/{project_id}")
def get_project(project_id: str, db: Session = Depends(get_db)):
    """获取时间轴项目详情"""
    project = db.query(TimelineProject).filter(TimelineProject.id == project_id).first()
    if not project:
        return {"error": "Project not found"}, 404

    segments = db.query(TimelineSegment).filter(
        TimelineSegment.project_id == project_id
    ).order_by(TimelineSegment.start_time).all()

    return {
        "id": project.id,
        "name": project.name,
        "video_url": f"/api/timeline/video/{project.id}" if project.video_path else None,
        "segments": [
            {
                "id": s.id,
                "text": s.text,
                "start_time": s.start_time,
                "end_time": s.end_time,
                "audio_url": f"/api/tts/audio/{s.audio_path.split('/')[-1].replace('.wav', '')}" if s.audio_path else None
            }
            for s in segments
        ]
    }


@router.post("/project/{project_id}/video")
async def upload_video(project_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    """上传视频"""
    project = db.query(TimelineProject).filter(TimelineProject.id == project_id).first()
    if not project:
        return {"error": "Project not found"}, 404

    file_id = str(uuid.uuid4())
    ext = file.filename.split(".")[-1] if "." in file.filename else "mp4"
    file_path = settings.videos_dir / f"{project_id}.{ext}"

    async with aiofiles.open(file_path, "wb") as f:
        content = await file.read()
        await f.write(content)

    project.video_path = str(file_path)
    db.commit()

    return {"video_url": f"/api/timeline/video/{project_id}"}


@router.get("/video/{project_id}")
def get_video(project_id: str, db: Session = Depends(get_db)):
    """获取视频文件"""
    project = db.query(TimelineProject).filter(TimelineProject.id == project_id).first()
    if not project or not project.video_path or not os.path.exists(project.video_path):
        return {"error": "Video not found"}, 404

    from fastapi.responses import FileResponse
    return FileResponse(project.video_path)


@router.post("/project/{project_id}/segment")
def add_segment(project_id: str, data: SegmentCreate, db: Session = Depends(get_db)):
    """添加时间段"""
    project = db.query(TimelineProject).filter(TimelineProject.id == project_id).first()
    if not project:
        return {"error": "Project not found"}, 404

    segment = TimelineSegment(
        id=str(uuid.uuid4()),
        project_id=project_id,
        text=data.text,
        start_time=data.start_time,
        end_time=data.end_time
    )
    db.add(segment)
    db.commit()
    db.refresh(segment)

    return {
        "id": segment.id,
        "text": segment.text,
        "start_time": segment.start_time,
        "end_time": segment.end_time
    }


@router.delete("/segment/{segment_id}")
def delete_segment(segment_id: str, db: Session = Depends(get_db)):
    """删除时间段"""
    segment = db.query(TimelineSegment).filter(TimelineSegment.id == segment_id).first()
    if not segment:
        return {"error": "Segment not found"}, 404

    db.delete(segment)
    db.commit()

    return {"message": "Segment deleted"}


@router.post("/project/{project_id}/synthesize")
async def synthesize_project(project_id: str, db: Session = Depends(get_db)):
    """批量生成项目所有段落的配音"""
    from app.services.qwen_tts_service import get_tts_service

    project = db.query(TimelineProject).filter(TimelineProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    segments = db.query(TimelineSegment).filter(
        TimelineSegment.project_id == project_id
    ).order_by(TimelineSegment.start_time).all()

    if not segments:
        raise HTTPException(status_code=400, detail="No segments found")

    results = []
    tts_service = await get_tts_service()

    for segment in segments:
        audio_id = str(uuid.uuid4())
        audio_path = settings.voices_dir / f"tts_{audio_id}.wav"

        try:
            audio_data = await tts_service.synthesize_speech(
                text=segment.text,
                voice_id="xiaoyun",
                speed=1.0,
                volume=80,
                pitch=0,
                format="wav",
                sample_rate=16000,
            )

            async with aiofiles.open(audio_path, "wb") as f:
                await f.write(audio_data)

            segment.audio_path = str(audio_path)
            db.commit()

            results.append({
                "segment_id": segment.id,
                "audio_id": audio_id,
                "audio_url": f"/api/tts/audio/{audio_id}",
                "text": segment.text,
                "start_time": segment.start_time,
                "end_time": segment.end_time
            })
        except Exception as e:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Failed to synthesize segment {segment.id}: {str(e)}")

    return {"segments": results}


class VoiceAssignmentRequest(BaseModel):
    voice_id: str


@router.post("/segment/{segment_id}/voice")
def assign_voice_to_segment(segment_id: str, request: VoiceAssignmentRequest, db: Session = Depends(get_db)):
    """为时间段分配声音"""
    from app.models import VoiceProfile

    segment = db.query(TimelineSegment).filter(TimelineSegment.id == segment_id).first()
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")

    voice = db.query(VoiceProfile).filter(VoiceProfile.id == request.voice_id).first()
    if not voice:
        raise HTTPException(status_code=404, detail="Voice not found")

    segment.voice_id = request.voice_id
    db.commit()
    db.refresh(segment)

    return {
        "id": segment.id,
        "text": segment.text,
        "voice_id": segment.voice_id,
        "voice": {
            "id": voice.id,
            "name": voice.name,
            "qwen_voice_id": voice.qwen_voice_id,
            "role": voice.role
        } if voice else None
    }


@router.delete("/segment/{segment_id}/voice")
def remove_voice_from_segment(segment_id: str, db: Session = Depends(get_db)):
    """移除时间段的声嘶分配"""
    segment = db.query(TimelineSegment).filter(TimelineSegment.id == segment_id).first()
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")

    segment.voice_id = None
    db.commit()
    db.refresh(segment)

    return {
        "id": segment.id,
        "text": segment.text,
        "voice_id": None,
        "message": "Voice assignment removed"
    }