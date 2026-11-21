"""Chapter voice JSON construction (mirrors backend _flatten_voice_for_synthesis)."""
from __future__ import annotations

ENGINE_VOICE_KEYS: dict[str, tuple[str, ...]] = {
    "edge_tts": ("voice", "rate", "volume"),
    "qwen": ("voice_id", "speed", "volume", "pitch", "language", "instruction"),
    "mimo_tts": ("mode", "voice_id", "instruction", "voice_description"),
    "voxcpm": ("mode", "voice_id", "style_control", "cfg_value", "inference_timesteps"),
    "indextts": ("voice_id", "lang", "emo_alpha", "duration_factor"),
}

ENGINE_DEFAULT_VOICE: dict[str, dict[str, object]] = {
    "edge_tts": {},
    "qwen": {},
    "mimo_tts": {"mode": "preset"},
    "voxcpm": {"mode": "clone"},
    "indextts": {},
}

# Backend applies this key for any engine (cross-engine mute tag list).
UNIVERSAL_KEYS = ("mute_tags",)


def _coerce(value: str) -> object:
    """Coerce CLI strings into JSON scalars: int > float > bool > str."""
    for cast in (int, float):
        try:
            return cast(value)
        except ValueError:
            continue
    lowered = value.lower()
    if lowered in ("true", "false"):
        return lowered == "true"
    return value


def build_voice(engine: str, params: list[str]) -> dict[str, object]:
    """Build a chapter voice JSON from an engine name and key=value params.

    The engine key is always written: the backend reads `voice.engine` to pick
    the synthesis path, and an omitted engine would wipe a chapter's existing
    engine selection when PATCHing the voice dict wholesale.
    """
    if engine not in ENGINE_VOICE_KEYS:
        raise ValueError(f"unknown engine {engine!r}; supported: {', '.join(ENGINE_VOICE_KEYS)}")
    voice: dict[str, object] = {"engine": engine}
    voice.update(ENGINE_DEFAULT_VOICE[engine])
    allowed = ENGINE_VOICE_KEYS[engine] + UNIVERSAL_KEYS
    for item in params:
        key, sep, value = item.partition("=")
        if not sep:
            raise ValueError(f"--param expects key=value, got {item!r}")
        if key not in allowed:
            raise ValueError(
                f"--param {key!r} is not valid for engine {engine!r}; allowed: {', '.join(allowed)}"
            )
        voice[key] = _coerce(value)
    return voice
