import io
import math
import struct
import wave
from unittest.mock import patch

from app.models.segmented_project import SegmentedProjectSegment
from app.schemas.segmented_project import ProjectIn
from app.services import segmented_project_service as svc


def _silent_wav_bytes(duration_ms: int = 500) -> bytes:
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


def test_mimo_internal_uses_real_service(monkeypatch):
    """MiMo segmented synthesis must use the MiMo service, not write a tiny placeholder wav."""
    from app.api import mimo_tts

    expected = _silent_wav_bytes(duration_ms=300)

    class FakeMiMoService:
        async def synthesize_preset(self, text, voice, instruction, format):
            assert text == "hello"
            assert voice == "白桦"
            assert instruction == "声音沙哑"
            assert format == "wav"
            return expected

    async def fake_get_mimo_tts_service(db=None):
        return FakeMiMoService()

    monkeypatch.setattr(mimo_tts, "get_mimo_tts_service", fake_get_mimo_tts_service)

    audio_bytes, audio_format = mimo_tts.synthesize_mimo_internal(
        text="hello",
        mimo_mode="preset",
        preset_voice="白桦",
        instruction="声音沙哑",
    )

    assert audio_format == "wav"
    assert audio_bytes == expected


def test_synthesize_segment_records_role_and_prosody_inputs(db_session, tmp_path, monkeypatch):
    from unittest.mock import patch

    from app.core import config
    from app.schemas.segmented_project import ProjectIn
    from app.services.segmented_project_service import get_project_detail, save_project, synthesize_segment

    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = ProjectIn(
        id="p-gen-role",
        name="Role Gen",
        schema_version=2,
        layout="vertical",
        chapters=[{
            "id": "c1",
            "position": 0,
            "name": "第一章",
            "engine": "edge_tts",
            "default_params": {"engine": "edge_tts", "edge_voice": "zh-CN-XiaoxiaoNeural"},
            "split_config": {"delimiters": ["。"], "mode": "rule"},
            "segments": [{
                "id": "s1",
                "position": 0,
                "text": "你好",
                "params": {"engine": "edge_tts"},
                "role_id": "role-linxia",
                "role_snapshot": {
                    "id": "role-linxia",
                    "name": "林夏",
                    "default_engine_params": {
                        "engine": "edge_tts",
                        "edge_voice": "zh-CN-XiaoxiaoNeural",
                    },
                },
                "segment_kind": "dialogue",
                "prosody_marks": [{"id": "mark-1", "start": 0, "end": 1, "style_tags": ["slow"]}],
            }],
        }],
    )
    save_project(db_session, payload)
    db_session.commit()

    wav_bytes = b"RIFF\x00\x00\x00\x00WAVEfmt "
    with patch("app.services.segmented_project_service.is_ffmpeg_available", return_value=False), patch(
        "app.services.segmented_project_service.synthesize_with_engine",
        return_value=(wav_bytes, "wav"),
    ):
        synthesize_segment(db_session, "p-gen-role", "c1", "s1")

    detail = get_project_detail(db_session, "p-gen-role")
    assert detail is not None
    generated = detail.chapters[0].segments[0].generated_params
    assert generated["role_id"] == "role-linxia"
    assert generated["role_snapshot"]["name"] == "林夏"
    assert generated["prosody_marks"][0]["id"] == "mark-1"


def test_synthesize_segment_uses_role_snapshot_voice_before_chapter_defaults(db_session, tmp_path, monkeypatch):
    from unittest.mock import patch

    from app.core import config
    from app.schemas.segmented_project import ProjectIn
    from app.services.segmented_project_service import save_project, synthesize_segment

    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    project = ProjectIn(
        id="p-priority",
        name="Priority",
        schema_version=2,
        layout="vertical",
        chapters=[{
            "id": "c1",
            "position": 0,
            "name": "第一章",
            "engine": "edge_tts",
            "default_params": {"engine": "edge_tts", "edge_voice": "zh-CN-YunjianNeural"},
            "split_config": {"delimiters": ["。"], "mode": "rule"},
            "segments": [{
                "id": "s1",
                "position": 0,
                "text": "你好",
                "params": {"engine": "edge_tts"},
                "role_snapshot": {
                    "id": "role-linxia",
                    "name": "林夏",
                    "default_engine_params": {"engine": "edge_tts", "edge_voice": "zh-CN-XiaoxiaoNeural"},
                },
            }],
        }],
    )
    save_project(db_session, project)
    db_session.commit()

    captured: dict[str, object] = {}

    def fake_synth(engine, text, params, db=None):
        captured["engine"] = engine
        captured["params"] = params
        return b"RIFF\x00\x00\x00\x00WAVEfmt ", "wav"

    with patch("app.services.segmented_project_service.is_ffmpeg_available", return_value=False), patch(
        "app.services.segmented_project_service.synthesize_with_engine",
        side_effect=fake_synth,
    ):
        synthesize_segment(db_session, "p-priority", "c1", "s1")

    assert captured["engine"] == "edge_tts"
    assert captured["params"]["edge_voice"] == "zh-CN-XiaoxiaoNeural"
