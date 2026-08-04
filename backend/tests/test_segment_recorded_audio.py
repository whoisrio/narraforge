"""Tests for user-recorded segment audio (self-recording feature).

Covers:
- svc.save_recorded_segment_audio: write file, origin='recorded', duration, previous handling
- synthesize_segment guard: recorded segments are skipped unless force=True
- API: POST .../segments/{sid}/audio upload endpoint
"""
import io
import math
import struct
import wave
from unittest.mock import patch

import pytest

from app.core import config
from app.core.audio_encoder import is_ffmpeg_available
from app.models.segmented_project import SegmentedProjectSegment
from app.schemas.segmented_project import ProjectIn
from app.services import segmented_project_service as svc

pytestmark = pytest.mark.skipif(not is_ffmpeg_available(), reason="ffmpeg not installed")


def _wav_bytes(duration_ms: int = 500) -> bytes:
    buf = io.BytesIO()
    sample_rate = 16000
    with wave.open(buf, "wb") as w:
        w.setparams((1, 2, sample_rate, 0, "NONE", "NONE"))
        frames = int(sample_rate * duration_ms / 1000)
        samples = [
            struct.pack("<h", int(12000 * math.sin(2 * math.pi * 440 * i / sample_rate)))
            for i in range(frames)
        ]
        w.writeframes(b"".join(samples))
    return buf.getvalue()


def _seed(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    project = ProjectIn(
        id="p1", name="T", schema_version=2,
        chapters=[{
            "id": "c1", "position": 0, "name": "第一章", "engine": "edge_tts",
            "voice": {"engine": "edge_tts", "voice_id": "v1"},
            "split_config": {"delimiters": ["。"], "mode": "rule"},
            "segments": [{
                "id": "s1", "position": 0, "text": "hello",
                "voice": {"source": "chapter"},
            }],
        }],
    )
    svc.save_project(db_session, project)
    db_session.commit()


def _seg(db_session):
    return db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()


def _synthesize(db_session, force: bool = False):
    with patch("app.services.segmented_project_service.synthesize_with_engine",
               return_value=(_wav_bytes(), "wav")):
        return svc.synthesize_segment(
            db_session, "p1", "c1", "s1",
            {"engine": "edge_tts", "voice_id": "v1"}, force=force)


def test_save_recorded_audio_writes_file_and_marks_origin(db_session, tmp_path, monkeypatch):
    _seed(db_session, tmp_path, monkeypatch)

    seg = svc.save_recorded_segment_audio(
        db_session, "p1", "c1", "s1",
        audio_bytes=_wav_bytes(), filename="take1.wav",
    )

    audio = seg.audio or {}
    current = audio.get("current", {})
    assert current.get("origin") == "recorded"
    assert current.get("path", "").endswith(".mp3")
    assert current.get("duration_sec") is not None and current["duration_sec"] > 0
    assert (tmp_path / current["path"]).exists()


def test_recorded_audio_demotes_existing_tts_to_previous(db_session, tmp_path, monkeypatch):
    _seed(db_session, tmp_path, monkeypatch)
    tts_seg = _synthesize(db_session)
    tts_path = tts_seg.audio["current"]["path"]

    seg = svc.save_recorded_segment_audio(
        db_session, "p1", "c1", "s1",
        audio_bytes=_wav_bytes(), filename="take1.wav",
    )

    audio = seg.audio
    assert audio["current"]["origin"] == "recorded"
    assert audio["previous"]["path"] == tts_path
    assert audio["previous"].get("origin") == "tts"
    assert (tmp_path / tts_path).exists()  # kept for undo


def test_synthesize_skips_recorded_segment(db_session, tmp_path, monkeypatch):
    _seed(db_session, tmp_path, monkeypatch)
    svc.save_recorded_segment_audio(
        db_session, "p1", "c1", "s1",
        audio_bytes=_wav_bytes(), filename="take1.wav",
    )
    recorded_path = _seg(db_session).audio["current"]["path"]

    with patch("app.services.segmented_project_service.synthesize_with_engine") as mock_synth:
        seg = svc.synthesize_segment(
            db_session, "p1", "c1", "s1", {"engine": "edge_tts", "voice_id": "v1"})

    mock_synth.assert_not_called()
    assert seg.audio["current"]["path"] == recorded_path
    assert seg.audio["current"]["origin"] == "recorded"


def test_synthesize_force_overwrites_recorded_and_keeps_undo(db_session, tmp_path, monkeypatch):
    _seed(db_session, tmp_path, monkeypatch)
    svc.save_recorded_segment_audio(
        db_session, "p1", "c1", "s1",
        audio_bytes=_wav_bytes(), filename="take1.wav",
    )
    recorded_path = _seg(db_session).audio["current"]["path"]

    seg = _synthesize(db_session, force=True)

    assert seg.audio["current"]["origin"] == "tts"
    assert seg.audio["current"]["path"] != recorded_path
    assert seg.audio["previous"]["path"] == recorded_path
    assert seg.audio["previous"].get("origin") == "recorded"
    assert (tmp_path / recorded_path).exists()  # undo still possible


def test_rerecord_replaces_and_cleans_orphaned_file(db_session, tmp_path, monkeypatch):
    _seed(db_session, tmp_path, monkeypatch)
    svc.save_recorded_segment_audio(db_session, "p1", "c1", "s1",
                                    audio_bytes=_wav_bytes(), filename="a.wav")
    first = _seg(db_session).audio["current"]["path"]
    svc.save_recorded_segment_audio(db_session, "p1", "c1", "s1",
                                    audio_bytes=_wav_bytes(), filename="b.wav")
    second = _seg(db_session).audio["current"]["path"]
    assert second != first
    assert (tmp_path / first).exists()  # now referenced by previous
    svc.save_recorded_segment_audio(db_session, "p1", "c1", "s1",
                                    audio_bytes=_wav_bytes(), filename="c.wav")
    # third recording: `first` is no longer referenced anywhere -> cleaned up
    assert not (tmp_path / first).exists()
    assert _seg(db_session).audio["previous"]["path"] == second


def test_save_recorded_audio_rejects_bad_input(db_session, tmp_path, monkeypatch):
    _seed(db_session, tmp_path, monkeypatch)
    with pytest.raises(ValueError, match="^unsupported_audio_format$"):
        svc.save_recorded_segment_audio(db_session, "p1", "c1", "s1",
                                        audio_bytes=b"x", filename="notes.txt")
    with pytest.raises(ValueError):
        svc.save_recorded_segment_audio(db_session, "p1", "c1", "s1",
                                        audio_bytes=b"", filename="a.wav")
    with pytest.raises(LookupError):
        svc.save_recorded_segment_audio(db_session, "p1", "c1", "nope",
                                        audio_bytes=_wav_bytes(), filename="a.wav")


# ----- API level -----


def _api_seed(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = {
        "id": "p1", "name": "Test", "schema_version": 2,
        "chapters": [{
            "id": "c1", "position": 0, "name": "第一章", "engine": "edge_tts",
            "voice": {"engine": "edge_tts", "voice_id": "v1"},
            "split_config": {"delimiters": ["。"], "mode": "rule"},
            "segments": [{"id": "s1", "position": 0, "text": "hello",
                          "voice": {"source": "chapter"}}],
        }],
    }
    r = client.post("/api/segmented-projects", json=payload)
    assert r.status_code == 201, r.text


def test_upload_segment_audio_endpoint(client, tmp_path, monkeypatch):
    _api_seed(client, tmp_path, monkeypatch)

    r = client.post(
        "/api/segmented-projects/p1/chapters/c1/segments/s1/audio",
        files={"file": ("take1.wav", _wav_bytes(), "audio/wav")},
    )
    assert r.status_code == 200, r.text
    seg = r.json()["chapters"][0]["segments"][0]
    current = seg["audio"]["current"]
    assert current["origin"] == "recorded"
    assert current["path"].endswith(".mp3")
    assert (tmp_path / current["path"]).exists()

    # audio is served back through the normal segment-audio endpoint
    r = client.get("/api/segmented-projects/p1/audio/c1/s1")
    assert r.status_code == 200
    assert len(r.content) > 0


def test_upload_segment_audio_rejects_bad_extension(client, tmp_path, monkeypatch):
    _api_seed(client, tmp_path, monkeypatch)
    r = client.post(
        "/api/segmented-projects/p1/chapters/c1/segments/s1/audio",
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )
    assert r.status_code == 422


def test_upload_segment_audio_404(client, tmp_path, monkeypatch):
    _api_seed(client, tmp_path, monkeypatch)
    r = client.post(
        "/api/segmented-projects/p1/chapters/c1/segments/nope/audio",
        files={"file": ("take1.wav", _wav_bytes(), "audio/wav")},
    )
    assert r.status_code == 404


def test_synthesize_endpoint_skips_recorded_without_force(client, tmp_path, monkeypatch):
    _api_seed(client, tmp_path, monkeypatch)
    r = client.post(
        "/api/segmented-projects/p1/chapters/c1/segments/s1/audio",
        files={"file": ("take1.wav", _wav_bytes(), "audio/wav")},
    )
    assert r.status_code == 200, r.text
    recorded_path = r.json()["chapters"][0]["segments"][0]["audio"]["current"]["path"]

    with patch("app.services.segmented_project_service.synthesize_with_engine") as mock_synth:
        r = client.post(
            "/api/segmented-projects/p1/chapters/c1/segments/s1/synthesize",
            json={"params": {"engine": "edge_tts", "voice_id": "v1"}},
        )
    assert r.status_code == 200, r.text
    mock_synth.assert_not_called()
    seg = r.json()["chapters"][0]["segments"][0]
    assert seg["audio"]["current"]["path"] == recorded_path
    assert seg["audio"]["current"]["origin"] == "recorded"
