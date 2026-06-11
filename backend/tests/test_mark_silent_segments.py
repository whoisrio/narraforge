"""Regression tests for mark_silent_segments_as_missing."""
import io
import wave
from pathlib import Path

import pytest

from app.services.segmented_project_service import mark_silent_segments_as_missing
from app.models.segmented_project import SegmentedProjectSegment


def _wav_bytes(duration_ms: int = 50) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setparams((1, 2, 16000, 0, "NONE", "NONE"))
        frames = int(16000 * duration_ms / 1000)
        w.writeframes(b"\x00\x00" * frames)
    return buf.getvalue()


def _seed_project(db_session, base_dir: Path) -> str:
    """Insert one project with three segments, each pointing to a different
    backend file. Returns the project id."""
    from app.core import config
    from app.models.segmented_project import (
        SegmentedProject, SegmentedProjectChapter,
    )

    p = SegmentedProject(id="p-silent", name="T", schema_version=2, layout="list")
    db_session.add(p)
    ch = SegmentedProjectChapter(
        id="c-silent", project_id="p-silent", name="C1", position=0,
        default_params={"engine": "edge_tts", "voice_id": "v1"},
    )
    db_session.add(ch)
    db_session.flush()

    # Segment 1: 2205-byte silent stub (the production breakage signature)
    p1 = base_dir / "proj1.mp3"
    p1.write_bytes(b"\x00" * 2205)
    # Segment 2: 8KB of "real audio" (a real Edge TTS clip is way bigger)
    p2 = base_dir / "proj2.mp3"
    p2.write_bytes(b"REAL_MP3" * 1000)
    # Segment 3: file exists, normal size, but already audio_missing
    p3 = base_dir / "proj3.mp3"
    p3.write_bytes(b"REAL_MP3" * 1000)

    s1 = SegmentedProjectSegment(
        id="s1", chapter_id="c-silent", project_id="p-silent", position=0,
        text="a", current_audio_path="proj1.mp3",
    )
    s2 = SegmentedProjectSegment(
        id="s2", chapter_id="c-silent", project_id="p-silent", position=1,
        text="b", current_audio_path="proj2.mp3",
    )
    s3 = SegmentedProjectSegment(
        id="s3", chapter_id="c-silent", project_id="p-silent", position=2,
        text="c", current_audio_path="proj3.mp3", audio_missing=True,
    )
    db_session.add_all([s1, s2, s3])
    db_session.commit()
    return "p-silent"


def test_marks_silent_files_as_missing(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    _seed_project(db_session, tmp_path)

    result = mark_silent_segments_as_missing(db_session)

    assert result["scanned"] == 3
    assert result["marked"] == 1
    assert result["already_missing"] == 1

    segs = {
        s.id: s for s in
        db_session.query(SegmentedProjectSegment).all()
    }
    assert segs["s1"].audio_missing is True
    assert segs["s2"].audio_missing is False  # real file, not touched
    assert segs["s3"].audio_missing is True   # was already True


def test_marks_when_file_missing_from_disk(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    _seed_project(db_session, tmp_path)

    # Delete segment 1's file
    (tmp_path / "proj1.mp3").unlink()

    result = mark_silent_segments_as_missing(db_session)

    segs = {s.id: s for s in db_session.query(SegmentedProjectSegment).all()}
    assert segs["s1"].audio_missing is True
    assert result["file_missing"] == 1


def test_idempotent(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    _seed_project(db_session, tmp_path)

    mark_silent_segments_as_missing(db_session)
    # Second run: nothing new to mark
    result2 = mark_silent_segments_as_missing(db_session)
    assert result2["scanned"] == 3
    assert result2["marked"] == 0
    assert result2["already_missing"] == 2  # s1 + s3


def test_does_not_delete_files(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    _seed_project(db_session, tmp_path)

    mark_silent_segments_as_missing(db_session)

    # The 2205-byte stub should still exist on disk — the function
    # only flips the audio_missing flag, never deletes files.
    assert (tmp_path / "proj1.mp3").exists()
