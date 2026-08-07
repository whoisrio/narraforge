"""Tests for ``audio.current.file_exists`` in get_project_detail serialization.

The flag lets the frontend tell apart 'ready' segments whose mp3 is still on
disk from desynced ones whose file was lost (DB has a path, file is gone) -
the root cause of the 'export-all always reports incomplete' symptom.
"""
import io
import math
import struct
import wave

from app.core import config
from app.schemas.segmented_project import ProjectIn
from app.services import segmented_project_service as svc


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
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path / "assets")
    project = ProjectIn(
        id="p1", name="T", schema_version=2,
        chapters=[
            {
                "id": "c1", "position": 0, "name": "ch1", "engine": "edge_tts",
                "voice": {"engine": "edge_tts", "voice_id": "v1"},
                "split_config": {"delimiters": ["。"], "mode": "rule"},
                "segments": [
                    {"id": "s1", "position": 0, "text": "一句话。", "voice": {"source": "chapter"}},
                ],
            },
        ],
    )
    svc.save_project(db_session, project)
    db_session.commit()
    svc.save_recorded_segment_audio(
        db_session, "p1", "c1", "s1",
        audio_bytes=_wav_bytes(500), filename="s1.wav",
    )


def test_file_exists_true_when_audio_on_disk(db_session, tmp_path, monkeypatch):
    _seed(db_session, tmp_path, monkeypatch)
    detail = svc.get_project_detail(db_session, "p1")
    current = detail.chapters[0].segments[0].audio["current"]
    assert current.get("path")
    assert current.get("file_exists") is True


def test_file_exists_false_when_audio_missing_from_disk(db_session, tmp_path, monkeypatch):
    _seed(db_session, tmp_path, monkeypatch)
    detail = svc.get_project_detail(db_session, "p1")
    rel = detail.chapters[0].segments[0].audio["current"]["path"]
    assert detail.chapters[0].segments[0].audio["current"].get("file_exists") is True

    # delete the file on disk -> flag must reflect the loss
    (tmp_path / "assets" / rel).unlink()

    detail2 = svc.get_project_detail(db_session, "p1")
    assert detail2.chapters[0].segments[0].audio["current"].get("file_exists") is False
