"""Tests for unified_storage_migration (PR-B)."""
from pathlib import Path

from app.core.config import settings
from app.models.tts_result import TTSResultRecord as TTSResult
from app.models.transcription_record import TranscriptionRecord
from app.models.voice_profile import VoiceProfile
from app.services.unified_storage_migration import apply_storage, plan_storage


def _mkdirs(tmp_path: Path, monkeypatch) -> dict[str, Path]:
    dirs = {
        "profiles": tmp_path / "data" / "voices" / "profiles",
        "previews": tmp_path / "data" / "voices" / "previews",
        "history": tmp_path / "data" / "tts-history",
        "srt": tmp_path / "data" / "srt",
        "temp": tmp_path / "data" / "temp",
        "legacy_voices": tmp_path / "uploads" / "voices",
        "legacy_clone": tmp_path / "output" / "clone_voices",
        "legacy_tts_results": tmp_path / "uploads" / "tts_results",
        "legacy_srt1": tmp_path / "uploads" / "srt",
        "legacy_srt2": tmp_path / "output" / "srt",
    }
    monkeypatch.setattr(settings, "voices_profiles_dir", dirs["profiles"])
    monkeypatch.setattr(settings, "voices_previews_dir", dirs["previews"])
    monkeypatch.setattr(settings, "tts_history_dir", dirs["history"])
    monkeypatch.setattr(settings, "srt_output_dir", dirs["srt"])
    monkeypatch.setattr(settings, "temp_dir", dirs["temp"])
    monkeypatch.setattr(settings, "voices_dir", dirs["legacy_voices"])
    monkeypatch.setattr(settings, "clone_voices_dir", dirs["legacy_clone"])
    monkeypatch.setattr(settings, "uploads_dir", tmp_path / "uploads")
    monkeypatch.setattr(settings, "output_dir", tmp_path / "output")
    monkeypatch.setattr(settings, "base_dir", tmp_path)
    return dirs


def _touch(p: Path, content: bytes = b"x") -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(content)
    return p


def test_plan_and_apply_end_to_end(db_session, tmp_path, monkeypatch):
    dirs = _mkdirs(tmp_path, monkeypatch)

    # voice profile with sample + preview (base_dir-relative paths)
    sample = _touch(dirs["legacy_voices"] / "小明_20260630_191454.mp3")
    preview = _touch(dirs["legacy_clone"] / "小明_prev.mp3")
    vp = VoiceProfile(
        id="vp1", name="小明",
        voice_params={"": {"source_audio_path": settings.to_relative(sample), "params": {}}},
        preview={"preview_audio_path": settings.to_relative(preview)},
    )
    db_session.add(vp)

    # tts history (absolute path)
    tts_file = _touch(dirs["legacy_voices"] / "tts_abc123.mp3")
    db_session.add(TTSResult(id="abc123", text="hi", voice_id="v1", audio_path=str(tts_file), audio_format="mp3"))

    # transcription (absolute path)
    srt_audio = _touch(dirs["legacy_srt1"] / "f1_original.wav")
    db_session.add(TranscriptionRecord(id="t1", original_filename="a.wav", audio_path=str(srt_audio), srt_file_id="s1"))

    # orphans
    _touch(dirs["legacy_clone"] / "mimo_orphan.mp3")
    _touch(dirs["legacy_tts_results"] / "tts_extra.mp3")
    _touch(dirs["legacy_voices"] / "temp_audio_20260725_102607.mp3")
    db_session.commit()

    # ── plan: dry-run, nothing moves ──
    plan = plan_storage(db_session)
    assert sample.exists()
    assert len(plan.file_moves) >= 7

    # ── apply ──
    apply_storage(db_session, plan)

    assert (dirs["profiles"] / sample.name).exists()
    assert (dirs["previews"] / preview.name).exists()
    assert (dirs["previews"] / "mimo_orphan.mp3").exists()
    assert (dirs["history"] / "tts_abc123.mp3").exists()
    assert (dirs["history"] / "tts_extra.mp3").exists()
    assert (dirs["srt"] / "f1_original.wav").exists()
    assert (dirs["temp"] / "temp_audio_20260725_102607.mp3").exists()

    db_session.expire_all()
    vp2 = db_session.query(VoiceProfile).filter_by(id="vp1").one()
    assert vp2.voice_params[""]["source_audio_path"] == \
        settings.to_relative(dirs["profiles"] / sample.name)
    assert vp2.preview["preview_audio_path"] == \
        settings.to_relative(dirs["previews"] / preview.name)
    assert db_session.query(TTSResult).filter_by(id="abc123").one().audio_path == \
        str(dirs["history"] / "tts_abc123.mp3")
    assert db_session.query(TranscriptionRecord).filter_by(id="t1").one().audio_path == \
        str(dirs["srt"] / "f1_original.wav")


def test_apply_is_idempotent(db_session, tmp_path, monkeypatch):
    dirs = _mkdirs(tmp_path, monkeypatch)
    f = _touch(dirs["legacy_clone"] / "a.mp3")
    db_session.commit()

    apply_storage(db_session, plan_storage(db_session))
    plan2 = plan_storage(db_session)
    assert all(src.exists() is False or dst.exists() for src, dst in plan2.file_moves.items())
    # second apply: no crash, files stay
    apply_storage(db_session, plan2)
    assert (dirs["previews"] / "a.mp3").exists()
