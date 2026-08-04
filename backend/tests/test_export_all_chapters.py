"""Tests for one-click export of ALL chapters' audio + SRT (export-all-chapters).

Covers:
- resolve_export_target_dir: absolute export_directory wins / remotion-relative / unconfigured error
- export_all_chapters: pre-check aborts with incomplete chapter list (writes nothing);
  success path writes {title}.mp3 + {title}.srt per chapter, SRT starts at 0
- API: POST /segmented-projects/{pid}/export-all-chapters contracts (200/404/409)
"""
import io
import math
import struct
import wave

import pytest

from app.core import config
from app.core.audio_encoder import is_ffmpeg_available, probe_audio_duration
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


def _seed(db_session, tmp_path, monkeypatch, *, with_audio: bool = True, configs=None):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path / "assets")
    project = ProjectIn(
        id="p1", name="T", schema_version=2, configs=configs,
        chapters=[
            {
                "id": "c1", "position": 0, "name": "第一章 夜路", "engine": "edge_tts",
                "voice": {"engine": "edge_tts", "voice_id": "v1"},
                "split_config": {"delimiters": ["。"], "mode": "rule"},
                "segments": [
                    {"id": "s1", "position": 0, "text": "夜色渐浓。", "voice": {"source": "chapter"}},
                    {"id": "s2", "position": 1, "text": "犬吠几声。", "voice": {"source": "chapter"}},
                ],
            },
            {
                "id": "c2", "position": 1, "name": "第二章 破庙", "engine": "edge_tts",
                "voice": {"engine": "edge_tts", "voice_id": "v1"},
                "split_config": {"delimiters": ["。"], "mode": "rule"},
                "segments": [
                    {"id": "s3", "position": 0, "text": "木门虚掩。", "voice": {"source": "chapter"}},
                ],
            },
        ],
    )
    svc.save_project(db_session, project)
    db_session.commit()
    if with_audio:
        for sid in ("s1", "s2", "s3"):
            cid = "c1" if sid in ("s1", "s2") else "c2"
            svc.save_recorded_segment_audio(
                db_session, "p1", cid, sid,
                audio_bytes=_wav_bytes(500), filename=f"{sid}.wav",
            )


# ----- directory resolution -----


def test_resolve_export_dir_absolute_wins(db_session, tmp_path, monkeypatch):
    out = tmp_path / "out-abs"
    _seed(db_session, tmp_path, monkeypatch, with_audio=False,
          configs={"export_directory": str(out)})
    project = svc.get_project_row(db_session, "p1")
    project.remotion_project_path = str(tmp_path / "remotion")  # absolute still wins
    db_session.commit()

    assert svc.resolve_export_target_dir(project) == out
    assert out.is_dir()


def test_resolve_export_dir_remotion_relative(db_session, tmp_path, monkeypatch):
    _seed(db_session, tmp_path, monkeypatch, with_audio=False,
          configs={"export_directory": "public/audio"})
    project = svc.get_project_row(db_session, "p1")
    project.remotion_project_path = str(tmp_path / "remotion")
    db_session.commit()

    assert svc.resolve_export_target_dir(project) == tmp_path / "remotion" / "public" / "audio"


def test_resolve_export_dir_unconfigured_raises(db_session, tmp_path, monkeypatch):
    _seed(db_session, tmp_path, monkeypatch, with_audio=False,
          configs={"export_directory": "public/audio"})
    project = svc.get_project_row(db_session, "p1")
    project.remotion_project_path = None
    db_session.commit()

    with pytest.raises(ValueError, match="^export_directory_not_configured$"):
        svc.resolve_export_target_dir(project)


# ----- service: pre-check and success path -----


def test_export_all_aborts_on_incomplete_chapter(db_session, tmp_path, monkeypatch):
    out = tmp_path / "out"
    _seed(db_session, tmp_path, monkeypatch, with_audio=False,
          configs={"export_directory": str(out)})
    # only chapter 1 has audio; chapter 2 segment s3 has none
    for sid in ("s1", "s2"):
        svc.save_recorded_segment_audio(db_session, "p1", "c1", sid,
                                        audio_bytes=_wav_bytes(), filename=f"{sid}.wav")

    with pytest.raises(svc.ChaptersIncompleteError) as exc_info:
        svc.export_all_chapters(db_session, "p1")

    assert exc_info.value.chapters == ["第二章 破庙"]
    # nothing was written
    assert not out.exists() or list(out.iterdir()) == []


def test_export_all_writes_mp3_and_srt_per_chapter(db_session, tmp_path, monkeypatch):
    out = tmp_path / "out"
    _seed(db_session, tmp_path, monkeypatch, configs={"export_directory": str(out)})

    result = svc.export_all_chapters(db_session, "p1")

    assert result["count"] == 2
    titles = [e["title"] for e in result["exported"]]
    assert titles == ["第一章 夜路", "第二章 破庙"]

    mp3_1 = out / "第一章_夜路.mp3"
    srt_1 = out / "第一章_夜路.srt"
    mp3_2 = out / "第二章_破庙.mp3"
    srt_2 = out / "第二章_破庙.srt"
    for f in (mp3_1, srt_1, mp3_2, srt_2):
        assert f.exists(), f"missing {f}"

    # chapter 1: two 0.5s segments -> ~1.0s mp3, SRT 0.0 -> 0.5 -> 1.0
    d = probe_audio_duration(mp3_1)
    assert d is not None and 0.8 < d < 1.3
    srt = srt_1.read_text(encoding="utf-8")
    assert "00:00:00,000 --> 00:00:00,500" in srt
    assert "00:00:00,500 --> 00:00:01,000" in srt
    assert "夜色渐浓。" in srt and "犬吠几声。" in srt

    # chapter 2 SRT restarts from 0 (chapter-local timeline)
    srt2 = srt_2.read_text(encoding="utf-8")
    assert "00:00:00,000 --> 00:00:00,500" in srt2


# ----- API -----


def _api_seed(client, tmp_path, monkeypatch, *, with_audio=True, configs=None):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path / "assets")
    payload = {
        "id": "p1", "name": "Test", "schema_version": 2, "configs": configs,
        "chapters": [
            {"id": "c1", "position": 0, "name": "第一章", "engine": "edge_tts",
             "voice": {"engine": "edge_tts", "voice_id": "v1"},
             "split_config": {"delimiters": ["。"], "mode": "rule"},
             "segments": [{"id": "s1", "position": 0, "text": "hello",
                           "voice": {"source": "chapter"}}]},
            {"id": "c2", "position": 1, "name": "第二章", "engine": "edge_tts",
             "voice": {"engine": "edge_tts", "voice_id": "v1"},
             "split_config": {"delimiters": ["。"], "mode": "rule"},
             "segments": [{"id": "s2", "position": 0, "text": "world",
                           "voice": {"source": "chapter"}}]},
        ],
    }
    r = client.post("/api/segmented-projects", json=payload)
    assert r.status_code == 201, r.text
    if with_audio:
        for cid, sid in (("c1", "s1"), ("c2", "s2")):
            r = client.post(
                f"/api/segmented-projects/p1/chapters/{cid}/segments/{sid}/audio",
                files={"file": (f"{sid}.wav", _wav_bytes(), "audio/wav")},
            )
            assert r.status_code == 200, r.text


def test_export_all_endpoint_success(client, tmp_path, monkeypatch):
    out = tmp_path / "out"
    _api_seed(client, tmp_path, monkeypatch, configs={"export_directory": str(out)})

    r = client.post("/api/segmented-projects/p1/export-all-chapters")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["count"] == 2
    assert (out / "第一章.mp3").exists()
    assert (out / "第一章.srt").exists()
    assert (out / "第二章.mp3").exists()
    assert (out / "第二章.srt").exists()


def test_export_all_endpoint_409_incomplete(client, tmp_path, monkeypatch):
    out = tmp_path / "out"
    _api_seed(client, tmp_path, monkeypatch, with_audio=False,
              configs={"export_directory": str(out)})
    # only chapter 1 gets audio
    r = client.post(
        "/api/segmented-projects/p1/chapters/c1/segments/s1/audio",
        files={"file": ("s1.wav", _wav_bytes(), "audio/wav")},
    )
    assert r.status_code == 200, r.text

    r = client.post("/api/segmented-projects/p1/export-all-chapters")
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert detail["code"] == "chapters_incomplete"
    assert detail["chapters"] == ["第二章"]
    assert not out.exists() or list(out.iterdir()) == []


def test_export_all_endpoint_409_dir_not_configured(client, tmp_path, monkeypatch):
    _api_seed(client, tmp_path, monkeypatch)  # no export_directory, no remotion path
    r = client.post("/api/segmented-projects/p1/export-all-chapters")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "export_directory_not_configured"


def test_export_all_endpoint_404(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path / "assets")
    r = client.post("/api/segmented-projects/nope/export-all-chapters")
    assert r.status_code == 404
