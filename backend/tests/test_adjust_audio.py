"""Endpoint tests for POST /segmented-projects/{pid}/chapters/{cid}/adjust-audio."""
import io
import wave

import pytest

from app.core import config
from app.core.audio_encoder import (
    is_ffmpeg_available, probe_audio_duration, transcode_to_mp3,
)
from app.core import segmented_assets as assets
from app.models.segmented_project import SegmentedProjectSegment
from app.schemas.segmented_project import ProjectIn
from app.services import segmented_project_service as svc

pytestmark = pytest.mark.skipif(not is_ffmpeg_available(), reason="ffmpeg not installed")


def _wav_bytes(duration_ms: int = 400) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setparams((1, 2, 16000, 0, "NONE", "NONE"))
        w.writeframes(b"\x00\x00" * int(16000 * duration_ms / 1000))
    return buf.getvalue()


def _seed_with_audio(db, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    svc.save_project(db, ProjectIn(
        id="p1", name="测试项目", schema_version=2, layout="vertical",
        chapters=[{
            "id": "c1", "position": 0, "name": "第一章",
            "voice": {"engine": "edge_tts"}, "split_config": {},
            "segments": [
                {"id": "s1", "position": 0, "text": "第一段。", "voice": {"source": "chapter"}},
                {"id": "s2", "position": 1, "text": "第二段。", "voice": {"source": "chapter"}},
                {"id": "s3", "position": 2, "text": "无音频段。", "voice": {"source": "chapter"}},
            ],
        }],
    ))
    db.commit()
    durations = {}
    for sid in ("s1", "s2"):
        seg = db.query(SegmentedProjectSegment).filter_by(id=sid).one()
        abs_path = assets.segment_audio_path("p1", "c1", project_name="测试项目", segment_id=sid, fmt="mp3")
        transcode_to_mp3(_wav_bytes(), abs_path)
        rel = abs_path.relative_to(tmp_path).as_posix()
        seg.audio = {"format": "mp3", "current": {"path": rel, "duration_sec": 0.4}}
        seg.status = "ready" if hasattr(seg, "status") else None
        durations[sid] = probe_audio_duration(abs_path)
    db.commit()
    return durations


def test_adjust_audio_speed_and_volume(client, db_session, tmp_path, monkeypatch):
    old_durations = _seed_with_audio(db_session, tmp_path, monkeypatch)

    resp = client.post(
        "/api/segmented-projects/p1/chapters/c1/adjust-audio",
        json={"tempo": 2.0, "volume_db": 3.0},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["adjusted"] == 2

    for sid in ("s1", "s2"):
        seg = db_session.query(SegmentedProjectSegment).filter_by(id=sid).one()
        audio = seg.audio
        cur = audio["current"]
        prev = audio["previous"]
        # previous preserved: real file, old duration
        prev_abs = config.settings.segmented_dir / prev["path"]
        assert prev_abs.exists()
        assert prev["path"] != cur["path"]
        assert abs((prev.get("duration_sec") or 0) - 0.4) < 0.01
        # current re-probed: roughly halved
        cur_abs = config.settings.segmented_dir / cur["path"]
        assert cur_abs.exists()
        new_d = probe_audio_duration(cur_abs)
        assert new_d is not None and new_d < old_durations[sid] * 0.75
        assert abs((cur.get("duration_sec") or 0) - new_d) < 0.01

    # untouched segment stays without audio
    seg3 = db_session.query(SegmentedProjectSegment).filter_by(id="s3").one()
    assert not (seg3.audio or {}).get("current")


def test_adjust_audio_validation(client, db_session, tmp_path, monkeypatch):
    _seed_with_audio(db_session, tmp_path, monkeypatch)
    assert client.post("/api/segmented-projects/p1/chapters/c1/adjust-audio", json={}).status_code == 422
    assert client.post("/api/segmented-projects/p1/chapters/c1/adjust-audio", json={"tempo": 3.0}).status_code == 422
    assert client.post("/api/segmented-projects/p1/chapters/c1/adjust-audio", json={"volume_db": 20}).status_code == 422
    assert client.post("/api/segmented-projects/p1/chapters/nope/adjust-audio", json={"tempo": 1.5}).status_code == 404
