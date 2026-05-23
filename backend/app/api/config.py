from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import List, Optional

from app.core.database import get_db
from app.core.system_config_service import get_storage_mode, set_storage_mode, STORAGE_MODE_BACKEND, STORAGE_MODE_FRONTEND
from app.models import TTSConfig, ModelProvider, Emotion

router = APIRouter()


class ConfigCreate(BaseModel):
    name: str
    provider: str = "qwen"
    model_name: str = "qwen-tts"
    speed: float = Field(default=1.0, ge=0.5, le=2.0, description="语速比率，0.5-2.0")
    volume: float = 80
    pitch: float = Field(default=1.0, ge=0.5, le=2.0, description="音调比率，0.5-2.0")
    emotion: str = "neutral"


class ConfigUpdate(BaseModel):
    name: Optional[str] = None
    provider: Optional[str] = None
    model_name: Optional[str] = None
    speed: Optional[float] = Field(default=None, ge=0.5, le=2.0, description="语速比率，0.5-2.0")
    volume: Optional[float] = None
    pitch: Optional[float] = Field(default=None, ge=0.5, le=2.0, description="音调比率，0.5-2.0")
    emotion: Optional[str] = None


@router.get("/models")
def list_configs(db: Session = Depends(get_db)):
    """获取模型配置列表"""
    configs = db.query(TTSConfig).all()
    return [
        {
            "id": c.id,
            "name": c.name,
            "provider": c.provider.value if c.provider else "qwen",
            "model_name": c.model_name,
            "speed": c.speed,
            "volume": c.volume,
            "pitch": c.pitch,
            "emotion": c.emotion.value if c.emotion else "neutral",
            "is_default": c.is_default
        }
        for c in configs
    ]


@router.post("/models")
def create_config(data: ConfigCreate, db: Session = Depends(get_db)):
    """创建模型配置"""
    config = TTSConfig(
        name=data.name,
        provider=ModelProvider(data.provider),
        model_name=data.model_name,
        speed=data.speed,
        volume=data.volume,
        pitch=data.pitch,
        emotion=Emotion(data.emotion),
        is_default=False
    )
    db.add(config)
    db.commit()
    db.refresh(config)

    return {
        "id": config.id,
        "name": config.name,
        "provider": config.provider.value,
        "model_name": config.model_name,
        "speed": config.speed,
        "volume": config.volume,
        "pitch": config.pitch,
        "emotion": config.emotion.value
    }


@router.put("/models/{config_id}")
def update_config(config_id: str, data: ConfigUpdate, db: Session = Depends(get_db)):
    """更新模型配置"""
    config = db.query(TTSConfig).filter(TTSConfig.id == config_id).first()
    if not config:
        return {"error": "Config not found"}, 404

    if data.name is not None:
        config.name = data.name
    if data.provider is not None:
        config.provider = ModelProvider(data.provider)
    if data.model_name is not None:
        config.model_name = data.model_name
    if data.speed is not None:
        config.speed = data.speed
    if data.volume is not None:
        config.volume = data.volume
    if data.pitch is not None:
        config.pitch = data.pitch
    if data.emotion is not None:
        config.emotion = Emotion(data.emotion)

    db.commit()
    db.refresh(config)

    return {
        "id": config.id,
        "name": config.name,
        "provider": config.provider.value,
        "model_name": config.model_name,
        "speed": config.speed,
        "volume": config.volume,
        "pitch": config.pitch,
        "emotion": config.emotion.value
    }


@router.delete("/models/{config_id}")
def delete_config(config_id: str, db: Session = Depends(get_db)):
    """删除模型配置"""
    config = db.query(TTSConfig).filter(TTSConfig.id == config_id).first()
    if not config:
        return {"error": "Config not found"}, 404

    db.delete(config)
    db.commit()

    return {"message": "Config deleted"}


@router.post("/models/{config_id}/set-default")
def set_default_config(config_id: str, db: Session = Depends(get_db)):
    """设为默认配置"""
    # 取消其他默认
    db.query(TTSConfig).update({"is_default": False})

    config = db.query(TTSConfig).filter(TTSConfig.id == config_id).first()
    if not config:
        return {"error": "Config not found"}, 404

    config.is_default = True
    db.commit()

    return {"message": "Default config set"}


# ---------------------------------------------------------------------------
# 存储模式配置
# ---------------------------------------------------------------------------

class StorageModeRequest(BaseModel):
    storage_mode: str  # "backend" | "frontend"


@router.get("/storage-mode")
def get_storage_mode_endpoint(db: Session = Depends(get_db)):
    """获取当前存储模式"""
    mode = get_storage_mode(db)
    return {"storage_mode": mode}


@router.put("/storage-mode")
def set_storage_mode_endpoint(data: StorageModeRequest, db: Session = Depends(get_db)):
    """设置存储模式"""
    if data.storage_mode not in (STORAGE_MODE_BACKEND, STORAGE_MODE_FRONTEND):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid storage_mode: {data.storage_mode}. Must be 'backend' or 'frontend'"
        )
    set_storage_mode(db, data.storage_mode)
    db.commit()
    return {"storage_mode": data.storage_mode}