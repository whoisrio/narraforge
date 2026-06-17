import io
import wave
import pytest
from pathlib import Path
from app.core.audio_encoder import (
    is_ffmpeg_available,
    transcode_to_mp3,
    probe_audio_duration,
    AudioEncoderError,
)


def _silent_wav_bytes(duration_ms: int = 50) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setparams((1, 2, 16000, 0, "NONE", "NONE"))
        frames = int(16000 * duration_ms / 1000)
        w.writeframes(b"\x00\x00" * frames)
    return buf.getvalue()


def test_transcode_to_mp3_writes_file(tmp_path: Path):
    if not is_ffmpeg_available():
        pytest.skip("ffmpeg not installed")
    out = tmp_path / "seg.mp3"
    transcode_to_mp3(_silent_wav_bytes(), out, bitrate="64k")
    assert out.exists()
    assert out.stat().st_size > 0


def test_transcode_to_mp3_raises_on_invalid_input(tmp_path: Path):
    if not is_ffmpeg_available():
        pytest.skip("ffmpeg not installed")
    with pytest.raises(AudioEncoderError):
        transcode_to_mp3(b"not a wav", tmp_path / "seg.mp3")


def test_probe_audio_duration_returns_none_for_missing_file(tmp_path: Path):
    """Missing files must yield None, not raise — callers depend on it."""
    assert probe_audio_duration(tmp_path / "nope.mp3") is None


def test_probe_audio_duration_returns_none_for_empty_file(tmp_path: Path):
    """An empty file is not a valid audio container — return None, don't crash."""
    empty = tmp_path / "empty.mp3"
    empty.write_bytes(b"")
    assert probe_audio_duration(empty) is None


def test_probe_audio_duration_for_real_mp3(tmp_path: Path):
    """End-to-end: transcode a known-duration WAV, probe it back."""
    if not is_ffmpeg_available():
        pytest.skip("ffmpeg not installed")
    out = tmp_path / "seg.mp3"
    expected_ms = 200
    transcode_to_mp3(_silent_wav_bytes(expected_ms), out, bitrate="64k")
    duration = probe_audio_duration(out)
    assert duration is not None
    # Allow 60ms slack — MP3 frame boundaries can shift things slightly
    assert abs(duration - expected_ms / 1000) < 0.06, (
        f"expected ~{expected_ms/1000:.2f}s, got {duration:.2f}s"
    )
