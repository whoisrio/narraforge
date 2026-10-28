"""Regression tests for TTS synthesis concurrency and take preservation.

The local synthesis endpoint used to run the synchronous TTS engine call
inside ``async def``. That blocks the event loop, so a GET for an already
synthesized segment's audio could not be served until the unrelated synthesis
finished. These tests pin the concurrent behavior at the ASGI layer.
"""

import asyncio
import io
import threading
import time
import wave
from unittest.mock import patch

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api import segmented_projects as segmented_projects_api
from app.core import config
from app.core import segmented_assets as assets
from app.core.audio_encoder import is_ffmpeg_available, transcode_to_mp3
from app.core.database import Base, get_db
from app.models.segmented_project import SegmentedProjectSegment
from app.schemas.segmented_project import ProjectIn
from app.services import segmented_project_service as svc
from main import app


def _wav_bytes(duration_ms: int = 300) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setparams((1, 2, 16000, 0, "NONE", "NONE"))
        w.writeframes(b"\x00\x00" * int(16000 * duration_ms / 1000))
    return buf.getvalue()


def _seed_project(session, *, with_audio: tuple[str, ...] = ()) -> None:
    svc.save_project(
        session,
        ProjectIn(
            id="p1",
            name="Test",
            schema_version=2,
            layout="vertical",
            chapters=[
                {
                    "id": "c1",
                    "position": 0,
                    "name": "第一章",
                    "voice": {"engine": "edge_tts"},
                    "split_config": {"delimiters": ["。"], "mode": "rule"},
                    "segments": [
                        {
                            "id": sid,
                            "position": i,
                            "text": f"segment {sid}",
                            "voice": {"source": "chapter"},
                        }
                        for i, sid in enumerate(("s1", "s2"))
                    ],
                }
            ],
        ),
    )
    session.commit()

    for sid in with_audio:
        abs_path = assets.segment_audio_path(
            "p1", "c1", project_name="Test", segment_id=sid, fmt="mp3"
        )
        transcode_to_mp3(_wav_bytes(), abs_path)
        rel = abs_path.relative_to(config.settings.segmented_dir).as_posix()
        seg = session.query(SegmentedProjectSegment).filter_by(id=sid).one()
        seg.audio = {
            "format": "mp3",
            "current": {"path": rel, "format": "mp3", "duration_sec": 0.3},
            "duration_sec": 0.3,
        }
    session.commit()


@pytest.mark.asyncio
async def test_synthesis_does_not_block_audio_reads(tmp_path, monkeypatch):
    """Audio for a finished segment must be served while another segment synthesizes."""
    if not is_ffmpeg_available():
        pytest.skip("ffmpeg not installed")

    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path / "projects")
    engine = create_engine(
        f"sqlite:///{tmp_path / 'concurrency.db'}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    seed = Session()
    try:
        _seed_project(seed, with_audio=("s1",))
    finally:
        seed.close()

    async def override_get_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    started = threading.Event()

    def slow_synthesize(*args, **kwargs):
        started.set()
        time.sleep(1.5)

    monkeypatch.setattr(
        segmented_projects_api.svc, "synthesize_segment", slow_synthesize
    )

    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            t0 = time.perf_counter()
            synth_task = asyncio.create_task(
                client.post(
                    "/api/segmented-projects/p1/chapters/c1/segments/s2/synthesize",
                    json={"params": {"engine": "edge_tts"}},
                )
            )
            # Yield once so the synthesis request reaches the endpoint before
            # the audio GET starts. If synthesis blocks the loop, this sleep
            # cannot resume until the fake TTS call returns.
            await asyncio.sleep(0)
            try:
                audio = await asyncio.wait_for(
                    client.get("/api/segmented-projects/p1/audio/c1/s1"),
                    timeout=0.8,
                )
            finally:
                synth_task.cancel()
                try:
                    await synth_task
                except (asyncio.CancelledError, Exception):
                    pass
            elapsed = time.perf_counter() - t0

            assert started.is_set()
            assert audio.status_code == 200
            assert elapsed < 0.8, (
                "audio GET was blocked by in-flight synthesis "
                f"(elapsed {elapsed:.2f}s)"
            )
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def test_resynthesis_preserves_old_take_as_previous(db_session, tmp_path, monkeypatch):
    """The previous take must be a distinct file, not the overwritten canonical path."""
    if not is_ffmpeg_available():
        pytest.skip("ffmpeg not installed")

    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path / "projects")
    _seed_project(db_session, with_audio=("s1", "s2"))
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    old_path = tmp_path / "projects" / seg.audio["current"]["path"]
    old_bytes = old_path.read_bytes()

    with patch(
        "app.services.segmented_project_service.synthesize_with_engine",
        return_value=(_wav_bytes(500), "wav"),
    ):
        svc.synthesize_segment(
            db_session,
            "p1",
            "c1",
            "s1",
            request_params={"engine": "edge_tts", "voice_id": "v1"},
        )

    db_session.expire_all()
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    current = seg.audio["current"]
    previous = seg.audio["previous"]

    assert previous["path"] != current["path"]
    previous_path = tmp_path / "projects" / previous["path"]
    assert previous_path.is_file()
    assert previous_path.read_bytes() == old_bytes
    assert (tmp_path / "projects" / current["path"]).is_file()
