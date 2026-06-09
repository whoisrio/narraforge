import io
import wave
import pytest
from pathlib import Path
from app.core.audio_encoder import (
    is_ffmpeg_available,
    transcode_to_mp3,
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
