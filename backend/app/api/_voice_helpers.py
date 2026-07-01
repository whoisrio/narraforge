from __future__ import annotations

from app.models.voice_profile import VoiceProfile


def voice_to_dict(v: VoiceProfile) -> dict:
    """Serialize a VoiceProfile to the standard API response dict (V3 format)."""
    engine = v.engine or {}
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
        "engine": {
            "type": engine.get("type", ""),
            "qwen_voice_id": engine.get("qwen_voice_id"),
            "mimo_voice_id": engine.get("mimo_voice_id"),
            "external_audio_url": engine.get("external_audio_url"),
            "prompt_text": engine.get("prompt_text"),
            "is_cloned": engine.get("is_cloned", False),
            "cloned_at": engine.get("cloned_at"),
        },
        "engine_params": v.engine_params or {},
        "avatar": v.avatar,
        "project_id": v.project_id,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }
