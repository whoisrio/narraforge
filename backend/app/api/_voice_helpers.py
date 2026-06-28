from __future__ import annotations

from app.models.voice_profile import VoiceProfile


def _build_voices_engine(v: VoiceProfile) -> dict | None:
    """Build the voices_engine nested structure from VoiceProfile columns."""
    if not v.voice_engine_type:
        # Legacy records without engine metadata — infer from clone_engine
        if v.clone_engine:
            engine_map = {"qwen": "CosyVoice", "mimo": "Mimo", "voxcpm": "VoxCpm"}
            return {
                "type": "clone",
                "engine": {
                    "type": engine_map.get(v.clone_engine, v.clone_engine),
                    "sub_type": None,
                },
                "prompt_text": v.prompt_text,
                "parameters": v.engine_params or {},
            }
        return None

    return {
        "type": v.voice_engine_type,
        "engine": {
            "type": v.engine_type,
            "sub_type": v.engine_sub_type,
        },
        "prompt_text": v.prompt_text,
        "parameters": v.engine_params or {},
    }


def voice_to_dict(v: VoiceProfile) -> dict:
    """Serialize a VoiceProfile to the standard API response dict."""
    voices_engine = _build_voices_engine(v)
    # 主音频：克隆/设计试听优先，否则源音频
    has_preview = bool(v.cloned_preview_path)
    has_source = bool(v.source_audio_path)
    if has_preview:
        audio_url = f"/api/clone/audio/{v.id}?field=preview"
    elif has_source:
        audio_url = f"/api/clone/audio/{v.id}?field=source"
    else:
        audio_url = f"/api/clone/audio/{v.id}"
    return {
        "id": str(v.id),
        "name": v.name,
        "description": v.description,
        "audio_url": audio_url,
        "source_audio_url": f"/api/clone/audio/{v.id}?field=source" if has_source else None,
        "cloned_preview_url": f"/api/clone/audio/{v.id}?field=preview" if has_preview else None,
        "qwen_voice_id": v.qwen_voice_id,
        "role": v.role,
        "clone_engine": v.clone_engine,
        "is_cloned": v.is_cloned,
        "cloned_at": v.cloned_at.isoformat() if v.cloned_at else None,
        "created_at": v.created_at.isoformat() if v.created_at else None,
        "prompt_text": v.prompt_text,
        "avatar": v.avatar,
        "voices_engine": voices_engine,
        "project_id": v.project_id,
    }
