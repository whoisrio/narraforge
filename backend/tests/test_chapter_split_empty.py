"""Characterization: /chapters/{cid}/split on a chapter with NO segments.

The "一键制作全本" flow relies on splitting empty chapters without disturbing
other chapters' existing audio. This locks down that existing endpoint behavior
via the real POST endpoint (not a reconstruction).
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
        configs={"export_directory": str(tmp_path / "out"), "split_voice_mode": "narration"},
        chapters=[
            {
                "id": "c1", "position": 0, "name": "ch1", "engine": "edge_tts",
                "voice": {"engine": "edge_tts", "voice_id": "v1"},
                "split_config": {"delimiters": ["。"], "mode": "rule"},
                "narration_script": "句一。",
                "segments": [
                    {"id": "s1", "position": 0, "text": "句一。", "voice": {"source": "chapter"}},
                ],
            },
            {
                "id": "c2", "position": 1, "name": "ch2", "engine": "edge_tts",
                "voice": {"engine": "edge_tts", "voice_id": "v2"},
                "split_config": {"delimiters": ["。"], "mode": "rule"},
                "narration_script": "这是第一句比较长的话。这是第二句也比较长的话。",
                "segments": [],
            },
        ],
    )
    svc.save_project(db_session, project)
    db_session.commit()
    svc.save_recorded_segment_audio(
        db_session, "p1", "c1", "s1",
        audio_bytes=_wav_bytes(500), filename="s1.wav",
    )


def test_split_empty_chapter_creates_segments_and_preserves_other_audio(
    client, db_session, tmp_path, monkeypatch,
):
    _seed(db_session, tmp_path, monkeypatch)
    c1_audio_path_before = svc.get_segment_row(db_session, "p1", "c1", "s1").audio["current"]["path"]

    r = client.post(
        "/api/segmented-projects/p1/chapters/c2/split",
        json={"text": "这是第一句比较长的话。这是第二句也比较长的话。", "mode": "rule", "replace_strategy": "replace_chapter_segments"},
    )
    assert r.status_code == 200, r.text

    detail = svc.get_project_detail(db_session, "p1")
    c1 = next(c for c in detail.chapters if c.id == "c1")
    c2 = next(c for c in detail.chapters if c.id == "c2")

    # c2 got two segments inheriting chapter voice
    assert len(c2.segments) == 2
    assert all(s.voice.get("source") == "chapter" for s in c2.segments)

    # c1's recorded audio survived the full-project reconcile
    assert c1.segments[0].audio["current"]["path"] == c1_audio_path_before
    assert c1.segments[0].audio["current"].get("file_exists") is True

    # project-level configs survived the reconcile (split must not drop export_directory etc.)
    assert detail.configs == {"export_directory": str(tmp_path / "out"), "split_voice_mode": "narration"}
