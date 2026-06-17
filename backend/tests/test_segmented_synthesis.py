import io
import wave
from unittest.mock import patch

from app.core import segmented_assets as assets
from app.models.segmented_project import SegmentedProjectSegment
from app.schemas.segmented_project import ProjectIn
from app.services import segmented_project_service as svc


def _silent_wav_bytes(duration_ms: int = 50) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setparams((1, 2, 16000, 0, "NONE", "NONE"))
        frames = int(16000 * duration_ms / 1000)
        w.writeframes(b"\x00\x00" * frames)
    return buf.getvalue()


def _seed(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    project = ProjectIn(
        id="p1", name="T", schema_version=2,
        chapters=[{
            "id": "c1", "position": 0, "name": "第一章", "engine": "edge_tts",
            "default_params": {"engine": "edge_tts", "voice_id": "v1"},
            "split_config": {"delimiters": ["。"], "mode": "rule"},
            "segments": [{
                "id": "s1", "position": 0, "text": "hello",
                "params": {"engine": "edge_tts"},
                "locked_params": [],
            }],
        }],
    )
    svc.save_project(db_session, project)
    db_session.commit()


def test_synthesize_segment_with_edge_tts(db_session, tmp_path, monkeypatch):
    from app.core.audio_encoder import is_ffmpeg_available
    if not is_ffmpeg_available():
        import pytest
        pytest.skip("ffmpeg not installed")
    _seed(db_session, tmp_path, monkeypatch)
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    seg.chapter.default_params = {"engine": "edge_tts", "voice_id": "v1"}
    db_session.commit()

    fake_audio = _silent_wav_bytes()
    with patch("app.services.segmented_project_service.synthesize_with_engine",
               return_value=(fake_audio, "wav")):
        result_seg = svc.synthesize_segment(
            db_session, project_id="p1", chapter_id="c1", segment_id="s1",
            request_params={"engine": "edge_tts", "voice_id": "v1", "speed": 1.0},
        )

    assert result_seg.current_audio_path is not None
    assert result_seg.current_audio_path.endswith(".mp3")
    full = tmp_path / result_seg.current_audio_path
    assert full.exists()
    assert result_seg.generated_params["engine"] == "edge_tts"
    seg_row = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    assert seg_row.audio_format == "mp3"
    # Regression: duration_sec must be probed from the actual file, not hardcoded None.
    # Frontend uses it to compute total project length and validate "ready" segments.
    assert seg_row.duration_sec is not None
    assert seg_row.duration_sec > 0


def test_synthesize_segment_keeps_previous(db_session, tmp_path, monkeypatch):
    from app.core.audio_encoder import is_ffmpeg_available
    if not is_ffmpeg_available():
        import pytest
        pytest.skip("ffmpeg not installed")
    _seed(db_session, tmp_path, monkeypatch)

    fake_audio = _silent_wav_bytes()
    with patch("app.services.segmented_project_service.synthesize_with_engine",
               return_value=(fake_audio, "wav")):
        svc.synthesize_segment(db_session, "p1", "c1", "s1", {"engine": "edge_tts", "voice_id": "v1"})
        svc.synthesize_segment(db_session, "p1", "c1", "s1", {"engine": "edge_tts", "voice_id": "v1"})

    seg_row = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    assert seg_row.current_audio_path is not None
    assert seg_row.previous_audio_path is not None
    assert (tmp_path / seg_row.previous_audio_path).exists()
