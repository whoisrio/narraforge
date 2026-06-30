from __future__ import annotations

from app.models.voice_profile import VoiceProfile


def _build_voices_engine(v: VoiceProfile) -> dict | None:
    """Build the voices_engine nested structure from engine JSON."""
    engine = v.engine or {}
    if not engine:
        return None

    return {
        "type": engine.get("type", "clone"),
        "engine": {
            "type": engine.get("engine_type", ""),
            "sub_type": engine.get("engine_sub_type"),
        },
        "prompt_text": engine.get("prompt_text"),
        "parameters": v.engine_params or {},
    }


def voice_to_dict(v: VoiceProfile) -> dict:
    """Serialize a VoiceProfile to the standard API response dict."""
    engine = v.engine or {}
    voices_engine = _build_voices_engine(v)
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
        "qwen_voice_id": engine.get("qwen_voice_id"),
        "role": "custom",
        "clone_engine": engine.get("clone_engine"),
        "is_cloned": engine.get("is_cloned", False),
        "cloned_at": engine.get("cloned_at"),
        "created_at": v.created_at.isoformat() if v.created_at else None,
        "prompt_text": engine.get("prompt_text"),
        "avatar": v.avatar,
        "voices_engine": voices_engine,
        "project_id": v.project_id,
    }
