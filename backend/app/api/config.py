from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Any, List, Optional
import json

# workers bundle 不含 sqlalchemy：Session 仅作注解（Depends 注入不看它）。
try:
    from sqlalchemy.orm import Session
except ImportError:  # workers bundle
    Session = Any  # type: ignore[assignment,misc]
from pathlib import Path
import tempfile

from app.core.database import get_db
from app.core.config import settings
from app.core.deploy_capabilities import get_capabilities
from app.core.repositories.deps import get_system_config_repo
from app.core.repositories.system_configs import SystemConfigRepository
from app.core.system_config_service import (
    get_storage_mode,
    set_storage_mode,
    STORAGE_MODE_BACKEND,
    STORAGE_MODE_FRONTEND,
    ANIMATION_ROOT_FOLDER_KEY,
    NARRATION_GIT_REMOTE_KEY,
    PRONUNCIATION_MAP_GLOBAL_KEY,
    normalize_animation_root_folder,
    get_narration_git_remote,
)
# workers bundle 不含 app.models（依赖 sqlalchemy）：仅 local 端点运行时引用。
try:
    from app.models import TTSConfig, ModelProvider, Emotion
except ImportError:  # workers bundle
    TTSConfig = ModelProvider = Emotion = None  # type: ignore[assignment,misc]

router = APIRouter()


@router.get("/capabilities")
async def get_capabilities_endpoint(request: Request):
    """部署目标能力清单（spec 第 4 节）：前端据此隐藏/禁用本地专属能力。
    无需 DB，workers 模式同样可用（config 路由两种模式都挂载）。"""
    target = getattr(request.app.state, "deploy_target", None) or settings.deploy_target
    return get_capabilities(target)


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
async def list_configs(db: Session = Depends(get_db)):
    """获取模型配置列表"""
    configs = db.query(TTSConfig).all()
    items = [
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
    return {"items": items}


@router.post("/models")
async def create_config(data: ConfigCreate, db: Session = Depends(get_db)):
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
async def update_config(config_id: str, data: ConfigUpdate, db: Session = Depends(get_db)):
    """更新模型配置"""
    config = db.query(TTSConfig).filter(TTSConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="config_not_found")

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
async def delete_config(config_id: str, db: Session = Depends(get_db)):
    """删除模型配置"""
    config = db.query(TTSConfig).filter(TTSConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="config_not_found")

    db.delete(config)
    db.commit()

    return {"message": "Config deleted"}


@router.post("/models/{config_id}/set-default")
async def set_default_config(config_id: str, db: Session = Depends(get_db)):
    """设为默认配置"""
    # 取消其他默认
    db.query(TTSConfig).update({"is_default": False})

    config = db.query(TTSConfig).filter(TTSConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="config_not_found")

    config.is_default = True
    db.commit()

    return {"message": "Default config set"}


# ---------------------------------------------------------------------------
# 存储模式配置
# ---------------------------------------------------------------------------

class StorageModeRequest(BaseModel):
    storage_mode: str  # "backend" | "frontend"


@router.get("/storage-mode")
async def get_storage_mode_endpoint(db: Session = Depends(get_db)):
    """获取当前存储模式"""
    mode = get_storage_mode(db)
    return {"storage_mode": mode}


@router.put("/storage-mode")
async def set_storage_mode_endpoint(data: StorageModeRequest, db: Session = Depends(get_db)):
    """设置存储模式。workers 模式忽略写入，始终返回 frontend。"""
    if data.storage_mode not in (STORAGE_MODE_BACKEND, STORAGE_MODE_FRONTEND):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid storage_mode: {data.storage_mode}. Must be 'backend' or 'frontend'"
        )
    set_storage_mode(db, data.storage_mode)
    if db is not None:
        db.commit()
    return {"storage_mode": get_storage_mode(db)}


# ---------------------------------------------------------------------------
# Remotion 脚手架根目录（全局设置）
# ---------------------------------------------------------------------------

class AnimationRootRequest(BaseModel):
    value: str


def _probe_animation_root(value: str) -> tuple[bool, str | None]:
    """探测路径是否可创建且可写。返回 (ok, error_code_or_None)。"""
    stripped = value.strip()
    if not stripped:
        return False, "path_empty"
    path = Path(stripped).expanduser()
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        return False, f"cannot_create_directory: {exc}"
    try:
        with tempfile.NamedTemporaryFile(dir=path, delete=True):
            pass
    except OSError as exc:
        return False, f"directory_not_writable: {exc}"
    return True, None


@router.get("/animation-root")
async def get_animation_root_endpoint(repo: SystemConfigRepository = Depends(get_system_config_repo)):
    """获取全局 Remotion 脚手架根目录。"""
    return {"value": repo.get(ANIMATION_ROOT_FOLDER_KEY).strip() or None}


@router.put("/animation-root")
async def set_animation_root_endpoint(
    data: AnimationRootRequest,
    repo: SystemConfigRepository = Depends(get_system_config_repo),
):
    """设置全局 Remotion 脚手架根目录（校验可创建且可写）。"""
    ok, error = _probe_animation_root(data.value)
    if not ok:
        raise HTTPException(status_code=422, detail=error)
    repo.set(ANIMATION_ROOT_FOLDER_KEY, normalize_animation_root_folder(data.value))
    return {"value": repo.get(ANIMATION_ROOT_FOLDER_KEY).strip() or None}


@router.post("/animation-root/test")
async def test_animation_root_endpoint(data: AnimationRootRequest):
    """探测路径可用性但不保存。"""
    ok, error = _probe_animation_root(data.value)
    return {"ok": ok, "error": error}


# ---------------------------------------------------------------------------
# Narration git remote + 手动快照
# ---------------------------------------------------------------------------


class GitRemoteRequest(BaseModel):
    value: str


@router.get("/narration-git-remote")
async def get_git_remote_endpoint(repo: SystemConfigRepository = Depends(get_system_config_repo)):
    """获取 narration git 远端地址。"""
    return {"value": repo.get(NARRATION_GIT_REMOTE_KEY).strip() or None}


@router.put("/narration-git-remote")
async def set_git_remote_endpoint(
    data: GitRemoteRequest,
    repo: SystemConfigRepository = Depends(get_system_config_repo),
):
    """设置 narration git 远端地址（空字符串 = 清除，只本地 commit）。"""
    repo.set(NARRATION_GIT_REMOTE_KEY, data.value.strip())
    return {"value": repo.get(NARRATION_GIT_REMOTE_KEY).strip() or None}


@router.post("/narration-git/snapshot")
async def narration_git_snapshot_endpoint(db: Session = Depends(get_db)):
    """手动触发一次 narration 快照（序列化 + commit），remote 已配则 push。
    narration 版本化是本地能力（git + 文件系统），workers 模式不可用。"""
    if settings.deploy_target == "workers":
        raise HTTPException(status_code=501, detail="narration_versioning_local_only")
    from app.services.narration_versioning.job import snapshot_all

    remote = get_narration_git_remote(db)
    # Pass the request-scoped session: tests override get_db to an isolated
    # in-memory DB, and opening a fresh SessionLocal() here would bypass that
    # isolation and read the real dev database instead.
    result = snapshot_all(remote_url=remote, session=db)
    return {
        "commit_sha": result.commit_sha,
        "projects": result.projects_snapshotted,
        "pushed": result.pushed,
        "push_error": result.push_error,
        "remote_configured": bool(remote),
    }


# ---------------------------------------------------------------------------
# 全局发音映射字典（合成时文本替换，所有项目共享；项目字典存 project.configs）
# ---------------------------------------------------------------------------

class PronunciationMapEntryIn(BaseModel):
    id: str           # 全局条目 gpm_ 前缀（项目条目 pm_ 前缀，两层 id 不冲突）
    source: str
    target: str
    note: Optional[str] = None


class PronunciationMapGlobalRequest(BaseModel):
    entries: List[PronunciationMapEntryIn]


def _validate_pronunciation_entries(entries: List[PronunciationMapEntryIn]) -> str | None:
    """校验：source 去空白后非空，且同一字典内唯一。返回错误码或 None。"""
    seen: set[str] = set()
    for e in entries:
        source = e.source.strip()
        if not source:
            return "pronunciation_source_empty"
        if source in seen:
            return "pronunciation_source_duplicate"
        seen.add(source)
    return None


@router.get("/pronunciation-map-global")
async def get_pronunciation_map_global_endpoint(
    repo: SystemConfigRepository = Depends(get_system_config_repo),
):
    """读取全局发音映射字典（system_configs 里 JSON 数组字符串）。"""
    raw = repo.get(PRONUNCIATION_MAP_GLOBAL_KEY).strip()
    entries = json.loads(raw) if raw else []
    return {"entries": entries}


@router.put("/pronunciation-map-global")
async def set_pronunciation_map_global_endpoint(
    data: PronunciationMapGlobalRequest,
    repo: SystemConfigRepository = Depends(get_system_config_repo),
):
    """全量替换全局发音映射字典。改动对所有项目生效（前端保存前提示）。"""
    error = _validate_pronunciation_entries(data.entries)
    if error:
        raise HTTPException(status_code=400, detail=error)
    entries = [e.model_dump(exclude_none=True) for e in data.entries]
    repo.set(PRONUNCIATION_MAP_GLOBAL_KEY, json.dumps(entries, ensure_ascii=False))
    return {"entries": entries}