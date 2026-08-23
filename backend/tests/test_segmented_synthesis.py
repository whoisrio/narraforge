import io
import math
import struct
import wave
from unittest.mock import patch

from app.models.segmented_project import SegmentedProjectSegment
from app.models.role import Role
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


def test_synthesize_segment_with_edge_tts(db_session, tmp_path, monkeypatch):
    from app.core.audio_encoder import is_ffmpeg_available
    if not is_ffmpeg_available():
        import pytest
        pytest.skip("ffmpeg not installed")
    _seed(db_session, tmp_path, monkeypatch)
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    seg.chapter.voice = {"engine": "edge_tts", "voice_id": "v1"}
    db_session.commit()

    fake_audio = _silent_wav_bytes()
    with patch("app.services.segmented_project_service.synthesize_with_engine",
               return_value=(fake_audio, "wav")):
        result_seg = svc.synthesize_segment(
            db_session, project_id="p1", chapter_id="c1", segment_id="s1",
            request_params={"engine": "edge_tts", "voice_id": "v1", "speed": 1.0},
        )

    audio = result_seg.audio or {}
    current = audio.get("current", {}) if isinstance(audio, dict) else {}
    assert current.get("path") is not None
    assert current.get("path", "").endswith(".mp3")
    full = tmp_path / current["path"]
    assert full.exists()
    assert result_seg.generated_params["engine"] == "edge_tts"
    seg_row = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    seg_audio = seg_row.audio or {}
    assert (seg_audio.get("current", {}) if isinstance(seg_audio, dict) else {}).get("format") == "mp3"
    duration = (seg_audio.get("current", {}) if isinstance(seg_audio, dict) else {}).get("duration_sec")
    assert duration is not None
    assert duration > 0


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
    audio = seg_row.audio or {}
    assert audio.get("current", {}).get("path") is not None
    assert audio.get("previous", {}).get("path") is not None
    assert (tmp_path / audio["previous"]["path"]).exists()


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


import pytest


@pytest.mark.asyncio
async def test_mimo_internal_inside_running_event_loop(monkeypatch):
    """回归：FastAPI async 端点直接调同步 service 链时，当前线程已有 running
    event loop，synthesize_mimo_internal 内部 asyncio.run 必炸（生产 500）。

    修复后应复用 tts._run_async 的线程桥接，在 running loop 下也能跑通。
    """
    from app.api import mimo_tts

    expected = _silent_wav_bytes(duration_ms=300)

    class FakeMiMoService:
        async def synthesize_preset(self, text, voice, instruction, format):
            return expected

    async def fake_get_mimo_tts_service(db=None):
        return FakeMiMoService()

    monkeypatch.setattr(mimo_tts, "get_mimo_tts_service", fake_get_mimo_tts_service)

    audio_bytes, audio_format = mimo_tts.synthesize_mimo_internal(
        text="hello",
        mimo_mode="preset",
        preset_voice="冰糖",
    )

    assert audio_format == "wav"
    assert audio_bytes == expected


def test_synthesize_segment_uses_role_voice_from_db(db_session, tmp_path, monkeypatch):
    """Role.voice from DB query is used when segment references a role."""
    from unittest.mock import patch

    from app.core import config
    from app.schemas.segmented_project import ProjectIn
    from app.services.segmented_project_service import save_project, synthesize_segment

    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)

    # Create a Role with voice
    role = Role(
        id="role-linxia",
        name="林夏",
        voice={"engine": "edge_tts", "params": {"engine": "edge_tts", "edge_voice": "zh-CN-XiaoxiaoNeural"}},
    )
    db_session.add(role)
    db_session.commit()

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
            "voice": {"engine": "edge_tts", "edge_voice": "zh-CN-YunjianNeural"},
            "split_config": {"delimiters": ["。"], "mode": "rule"},
            "segments": [{
                "id": "s1",
                "position": 0,
                "text": "你好",
                "voice": {"source": "chapter"},
                "role_id": "role-linxia",
            }],
        }],
    )
    save_project(db_session, project)
    db_session.commit()

    captured: dict[str, object] = {}

    def fake_synth(text, p, db=None):
        captured["engine"] = p.engine
        captured["params"] = p
        return b"RIFF\x00\x00\x00\x00WAVEfmt ", "wav"

    with patch("app.services.segmented_project_service.is_ffmpeg_available", return_value=False), patch(
        "app.services.segmented_project_service.synthesize_with_engine",
        side_effect=fake_synth,
    ):
        synthesize_segment(db_session, "p-priority", "c1", "s1")

    assert captured["engine"] == "edge_tts"
    # Role voice params (zh-CN-XiaoxiaoNeural) should override chapter defaults (zh-CN-YunjianNeural)
    assert captured["params"].edge_voice == "zh-CN-XiaoxiaoNeural"


# ----- style tag engine adaptation (prepare_text_for_engine) -----


def _run_synth_capture_text(db_session, tmp_path, monkeypatch, *,
                            chapter_voice, seg_text, seg_emotion,
                            request_params=None, text_override=None,
                            project_configs=None):
    """Seed p1/c1/s1, patch engine, return the text actually passed to the engine."""
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    _seed(db_session, tmp_path, monkeypatch)
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    seg.chapter.voice = chapter_voice
    seg.text = seg_text
    seg.emotion = seg_emotion
    if project_configs is not None:
        seg.chapter.project.configs = project_configs
    db_session.commit()

    captured: dict[str, object] = {}

    def fake_synth(text, p, db=None):
        captured["text"] = text
        captured["params"] = p
        return b"RIFF\x00\x00\x00\x00WAVEfmt ", "wav"

    with patch("app.services.segmented_project_service.is_ffmpeg_available", return_value=False), patch(
        "app.services.segmented_project_service.synthesize_with_engine",
        side_effect=fake_synth,
    ):
        svc.synthesize_segment(
            db_session, "p1", "c1", "s1",
            request_params=request_params, text_override=text_override,
        )
    return captured


def test_synth_voxcpm_clone_keeps_inline_and_adds_leading(db_session, tmp_path, monkeypatch):
    captured = _run_synth_capture_text(
        db_session, tmp_path, monkeypatch,
        chapter_voice={"engine": "voxcpm", "mode": "clone", "voice_id": "v1", "style_control": "磁性"},
        seg_text="(旧风格)你好[笑]世界", seg_emotion="happy",
    )
    assert captured["text"] == "(开心,磁性)你好[笑]世界"


def test_synth_voxcpm_ultimate_strips_all_tags(db_session, tmp_path, monkeypatch):
    captured = _run_synth_capture_text(
        db_session, tmp_path, monkeypatch,
        chapter_voice={"engine": "voxcpm", "mode": "ultimate", "voice_id": "v1", "style_control": "磁性"},
        seg_text="(旧风格)你好[笑]世界", seg_emotion="happy",
    )
    assert captured["text"] == "你好世界"


def test_synth_mimo_strips_inline_and_adds_leading(db_session, tmp_path, monkeypatch):
    captured = _run_synth_capture_text(
        db_session, tmp_path, monkeypatch,
        chapter_voice={"engine": "mimo_tts", "mode": "preset", "voice_id": "白桦", "instruction": "声音沙哑"},
        seg_text="你好[笑]世界", seg_emotion="happy",
    )
    assert captured["text"] == "(开心,声音沙哑)你好世界"


def test_synth_cosyvoice_strips_all_tags(db_session, tmp_path, monkeypatch):
    captured = _run_synth_capture_text(
        db_session, tmp_path, monkeypatch,
        chapter_voice={"engine": "cosyvoice", "voice_id": "v1", "instruction": "温柔"},
        seg_text="(旧风格)你好[笑]世界", seg_emotion="happy",
    )
    assert captured["text"] == "你好世界"


def test_synth_edge_tts_strips_all_tags(db_session, tmp_path, monkeypatch):
    captured = _run_synth_capture_text(
        db_session, tmp_path, monkeypatch,
        chapter_voice={"engine": "edge_tts", "voice_id": "v1"},
        seg_text="(旧风格)你好[笑]世界", seg_emotion="happy",
    )
    assert captured["text"] == "你好世界"


def test_synth_mute_tags_via_request_params(db_session, tmp_path, monkeypatch):
    captured = _run_synth_capture_text(
        db_session, tmp_path, monkeypatch,
        chapter_voice={"engine": "voxcpm", "mode": "clone", "voice_id": "v1", "style_control": "磁性"},
        seg_text="(旧风格)你好[笑]世界", seg_emotion="happy",
        request_params={"mute_tags": True},
    )
    assert captured["text"] == "你好世界"
    assert captured["params"].mute_tags is True


def test_synth_underscore_to_space_via_request_params(db_session, tmp_path, monkeypatch):
    captured = _run_synth_capture_text(
        db_session, tmp_path, monkeypatch,
        chapter_voice={"engine": "edge_tts", "voice_id": "v1"},
        seg_text="你好_世界", seg_emotion=None,
        request_params={"underscore_to_space": True},
    )
    assert captured["text"] == "你好 世界"
    assert captured["params"].underscore_to_space is True


def test_synth_underscore_kept_when_flag_off(db_session, tmp_path, monkeypatch):
    captured = _run_synth_capture_text(
        db_session, tmp_path, monkeypatch,
        chapter_voice={"engine": "edge_tts", "voice_id": "v1"},
        seg_text="你好_世界", seg_emotion=None,
    )
    assert captured["text"] == "你好_世界"


def test_synth_underscore_to_space_via_project_configs(db_session, tmp_path, monkeypatch):
    # 项目级全局开关（项目设置）：configs.underscore_to_space=True 时，
    # 即使 request params 不带该开关也生效
    captured = _run_synth_capture_text(
        db_session, tmp_path, monkeypatch,
        chapter_voice={"engine": "edge_tts", "voice_id": "v1"},
        seg_text="你好_世界", seg_emotion=None,
        project_configs={"underscore_to_space": True},
    )
    assert captured["text"] == "你好 世界"


def test_synth_skip_parenthesized_via_request_params(db_session, tmp_path, monkeypatch):
    captured = _run_synth_capture_text(
        db_session, tmp_path, monkeypatch,
        chapter_voice={"engine": "edge_tts", "voice_id": "v1"},
        seg_text="你好(注释)世界（再注）", seg_emotion=None,
        request_params={"skip_parenthesized": True},
    )
    assert captured["text"] == "你好世界"
    assert captured["params"].skip_parenthesized is True


def test_synth_parenthesized_kept_when_flag_off(db_session, tmp_path, monkeypatch):
    captured = _run_synth_capture_text(
        db_session, tmp_path, monkeypatch,
        chapter_voice={"engine": "edge_tts", "voice_id": "v1"},
        seg_text="你好(注释)世界", seg_emotion=None,
    )
    assert captured["text"] == "你好(注释)世界"


def test_synth_skip_parenthesized_via_project_configs(db_session, tmp_path, monkeypatch):
    # 项目级全局开关（项目设置）：configs.skip_parenthesized=True 时，
    # 即使 request params 不带该开关也生效
    captured = _run_synth_capture_text(
        db_session, tmp_path, monkeypatch,
        chapter_voice={"engine": "edge_tts", "voice_id": "v1"},
        seg_text="你好（注释）世界", seg_emotion=None,
        project_configs={"skip_parenthesized": True},
    )
    assert captured["text"] == "你好世界"


def test_synth_text_override_also_cleaned(db_session, tmp_path, monkeypatch):
    captured = _run_synth_capture_text(
        db_session, tmp_path, monkeypatch,
        chapter_voice={"engine": "mimo_tts", "mode": "preset", "voice_id": "白桦", "instruction": ""},
        seg_text="原文", seg_emotion="sad",
        text_override="(旧)临时改的[笑]文本",
    )
    assert captured["text"] == "(悲伤)临时改的文本"


# ----- indextts 引擎接入 -----


def test_flatten_voice_indextts():
    flat = svc._flatten_voice_for_synthesis({
        "engine": "indextts",
        "voice_id": "v1",
        "lang": "EN",
        "emo_alpha": 0.5,
        "duration_factor": 1.5,
    })
    assert flat == {
        "engine": "indextts",
        "voice_id": "v1",
        "indextts_lang": "EN",
        "indextts_emo_alpha": 0.5,
        "indextts_duration_factor": 1.5,
    }


def test_flatten_voice_indextts_defaults():
    flat = svc._flatten_voice_for_synthesis({"engine": "indextts", "voice_id": "v1"})
    assert flat["indextts_lang"] == "ZH"
    assert flat["indextts_emo_alpha"] == 1.0
    assert flat["indextts_duration_factor"] == 1.0


def test_synthesize_with_engine_indextts_dispatch(monkeypatch):
    """indextts 分发到 synthesize_indextts_internal，参数逐个透传。"""
    from app.api import indextts as indextts_api
    from app.schemas.segmented_project import SynthesizeParams

    captured: dict[str, object] = {}

    def fake_internal(**kwargs):
        captured.update(kwargs)
        return b"wav-bytes", "wav"

    monkeypatch.setattr(indextts_api, "synthesize_indextts_internal", fake_internal)

    p = SynthesizeParams(
        engine="indextts",
        voice_id="v1",
        indextts_lang="JA",
        indextts_emo_alpha=0.8,
        indextts_duration_factor=1.2,
    )
    out = svc.synthesize_with_engine(
        "你好", p, db=None, indextts_emo_vector=[1, 0, 0, 0, 0, 0, 0, 0]
    )

    assert out == (b"wav-bytes", "wav")
    assert captured["text"] == "你好"
    assert captured["voice_id"] == "v1"
    assert captured["lang"] == "JA"
    assert captured["emo_vector"] == [1, 0, 0, 0, 0, 0, 0, 0]
    assert captured["emo_alpha"] == 0.8
    assert captured["duration_factor"] == 1.2


def test_synth_indextts_emotion_maps_to_emo_vector(db_session, tmp_path, monkeypatch):
    """indextts 段落 emotion 经 emo_vector_for_emotion 映射后传给引擎，文本 tag 全部清洗。"""
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    _seed(db_session, tmp_path, monkeypatch)
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    seg.chapter.voice = {"engine": "indextts", "voice_id": "v1", "lang": "ZH"}
    seg.text = "(旧风格)你好[笑]世界"
    seg.emotion = "happy"
    db_session.commit()

    captured: dict[str, object] = {}

    def fake_synth(text, p, db=None, indextts_emo_vector=None):
        captured["text"] = text
        captured["params"] = p
        captured["indextts_emo_vector"] = indextts_emo_vector
        return b"RIFF\x00\x00\x00\x00WAVEfmt ", "wav"

    with patch("app.services.segmented_project_service.is_ffmpeg_available", return_value=False), patch(
        "app.services.segmented_project_service.synthesize_with_engine",
        side_effect=fake_synth,
    ):
        svc.synthesize_segment(db_session, "p1", "c1", "s1")

    # 能力全 False：文本 tag 全部清洗
    assert captured["text"] == "你好世界"
    # happy → [1,0,0,0,0,0,0,0]
    assert captured["indextts_emo_vector"] == [1, 0, 0, 0, 0, 0, 0, 0]
    assert captured["params"].engine == "indextts"
    assert captured["params"].voice_id == "v1"


def test_synth_indextts_neutral_emotion_passes_none(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    _seed(db_session, tmp_path, monkeypatch)
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    seg.chapter.voice = {"engine": "indextts", "voice_id": "v1"}
    seg.text = "你好"
    seg.emotion = "neutral"
    db_session.commit()

    captured: dict[str, object] = {}

    def fake_synth(text, p, db=None, indextts_emo_vector=None):
        captured["indextts_emo_vector"] = indextts_emo_vector
        return b"RIFF\x00\x00\x00\x00WAVEfmt ", "wav"

    with patch("app.services.segmented_project_service.is_ffmpeg_available", return_value=False), patch(
        "app.services.segmented_project_service.synthesize_with_engine",
        side_effect=fake_synth,
    ):
        svc.synthesize_segment(db_session, "p1", "c1", "s1")

    assert captured["indextts_emo_vector"] is None
