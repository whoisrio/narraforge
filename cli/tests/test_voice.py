"""Engine voice param building (mirrors backend _flatten_voice_for_synthesis)."""
import pytest

from narraforge_cli.voice import build_voice


def test_mimo_defaults_to_preset_mode() -> None:
    assert build_voice("mimo_tts", []) == {"engine": "mimo_tts", "mode": "preset"}


def test_voxcpm_defaults_to_clone_mode() -> None:
    assert build_voice("voxcpm", []) == {"engine": "voxcpm", "mode": "clone"}


def test_edge_tts_params() -> None:
    voice = build_voice("edge_tts", ["voice=zh-CN-YunxiNeural", "rate=+10%"])
    assert voice == {"engine": "edge_tts", "voice": "zh-CN-YunxiNeural", "rate": "+10%"}


def test_numeric_coercion() -> None:
    voice = build_voice("voxcpm", ["cfg_value=2.0", "inference_timesteps=10"])
    assert voice["cfg_value"] == 2.0 and isinstance(voice["cfg_value"], float)
    assert voice["inference_timesteps"] == 10 and isinstance(voice["inference_timesteps"], int)


def test_bool_coercion() -> None:
    assert build_voice("edge_tts", ["mute_tags=true"])["mute_tags"] is True


def test_unknown_engine_rejected() -> None:
    with pytest.raises(ValueError, match="unknown engine"):
        build_voice("cosyvoice", [])


def test_unknown_param_rejected() -> None:
    with pytest.raises(ValueError, match="not valid for engine"):
        build_voice("edge_tts", ["cfg_value=2"])


def test_param_without_equals_rejected() -> None:
    with pytest.raises(ValueError, match="key=value"):
        build_voice("edge_tts", ["voice"])
