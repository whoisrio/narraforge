"""Regression tests for the segmented editor's TTS bridge.

Background: a stub version of ``synthesize_speech_internal`` lived in
``app.api.tts`` for a long time and silently produced 50 ms of silence for
every call. That broken state was only discovered when DB rows with valid
``current_audio_path`` pointers turned out to be 2 KB silent MP3s and
nothing would play. These tests guard against that regression and pin the
bridge to the real engine services.
"""
import io
import wave
from unittest.mock import patch, AsyncMock, MagicMock

import pytest


def _wav_bytes(duration_ms: int = 300) -> bytes:
    """Return a tiny but non-silent WAV — distinguishable from the old stub."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setparams((1, 2, 16000, 0, "NONE", "NONE"))
        frames = int(16000 * duration_ms / 1000)
        # Sawtooth-like waveform so the duration probe can't be confused
        # with the 50ms silence the old stub produced.
        w.writeframes(bytes((i % 256) & 0xFF for i in range(frames * 2)))
    return buf.getvalue()


def _mp3_bytes() -> bytes:
    """A trivially-sized placeholder for fake mp3 output."""
    return b"\x00\x00\x00\x20ftypmp42" + b"FAKE_MP3" * 200


def test_edge_tts_bridge_invokes_real_service():
    """Must call edge_tts_service.synthesize — NOT return 50ms silence."""
    from app.api.tts import synthesize_speech_internal

    fake_mp3 = _mp3_bytes()
    with patch("app.services.edge_tts_service.get_edge_tts_service") as get_svc:
        svc = MagicMock()
        svc.synthesize = AsyncMock(return_value=(fake_mp3, "mp3"))
        get_svc.return_value = svc

        result_bytes, result_fmt = synthesize_speech_internal(
            text="hello world",
            edge_voice="zh-CN-YunjianNeural",
            edge_rate="+10%",
            edge_volume="+0%",
        )

    # Real engine was actually called
    svc.synthesize.assert_called_once_with(
        text="hello world",
        voice="zh-CN-YunjianNeural",
        rate="+10%",
        volume="+0%",
    )
    # Returned the real engine's bytes, not a synthetic silence placeholder
    assert result_bytes == fake_mp3
    assert result_fmt == "mp3"
    assert len(result_bytes) > 50, "must not be the old 50ms silence stub"


def test_cosyvoice_bridge_invokes_tts_service():
    """voice_id path must call the CosyVoice/Qwen TTS service."""
    from app.api.tts import synthesize_speech_internal

    fake_wav = _wav_bytes(duration_ms=500)
    with patch("app.services.qwen_tts_service.get_tts_service") as get_svc:
        svc = MagicMock()
        svc.synthesize_speech = AsyncMock(return_value=fake_wav)
        # Build a coroutine that get_tts_service returns
        async def fake_get_tts_service(db=None):
            return svc
        get_svc.side_effect = fake_get_tts_service

        result_bytes, result_fmt = synthesize_speech_internal(
            text="a long test sentence",
            voice_id="my-cloned-voice-123",
            speed=1.1,
            volume=85.0,
        )

    svc.synthesize_speech.assert_called_once()
    call = svc.synthesize_speech.call_args
    assert call.kwargs["voice_id"] == "my-cloned-voice-123"
    assert call.kwargs["text"] == "a long test sentence"
    assert call.kwargs["format"] == "wav"
    assert result_bytes == fake_wav
    assert result_fmt == "wav"
    assert len(result_bytes) > 50, "must not be the old 50ms silence stub"


def test_cosyvoice_bridge_reads_path_returned_by_service(tmp_path):
    """CosyVoice service returns a downloaded audio file path; the segmented bridge must return bytes."""
    from app.api.tts import synthesize_speech_internal

    fake_wav = _wav_bytes(duration_ms=500)
    audio_path = tmp_path / "cosyvoice.wav"
    audio_path.write_bytes(fake_wav)

    with patch("app.services.qwen_tts_service.get_tts_service") as get_svc:
        svc = MagicMock()
        svc.synthesize_speech = AsyncMock(return_value=str(audio_path))

        async def fake_get_tts_service(db=None):
            return svc
        get_svc.side_effect = fake_get_tts_service

        result_bytes, result_fmt = synthesize_speech_internal(
            text="a long test sentence",
            voice_id="my-cloned-voice-123",
            instruction="clear narration",
        )

    assert result_bytes == fake_wav
    assert result_fmt == "wav"


def test_bridge_raises_when_no_voice_provided():
    """Sanity: we never want a silent fallback. Either engine must run."""
    from app.api.tts import synthesize_speech_internal

    with pytest.raises(ValueError, match="edge_voice or voice_id"):
        synthesize_speech_internal(text="orphan segment")


def test_bridge_propagates_engine_errors():
    """If Edge TTS fails, the failure must surface — never get swallowed
    into a silent placeholder like the old stub did."""
    from app.api.tts import synthesize_speech_internal

    with patch("app.services.edge_tts_service.get_edge_tts_service") as get_svc:
        svc = MagicMock()
        svc.synthesize = AsyncMock(
            side_effect=RuntimeError("edge-tts network error")
        )
        get_svc.return_value = svc

        with pytest.raises(RuntimeError, match="edge-tts network error"):
            synthesize_speech_internal(
                text="x", edge_voice="zh-CN-YunjianNeural"
            )
