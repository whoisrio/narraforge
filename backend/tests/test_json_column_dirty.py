"""D3 regression tests: JSON-column mutate-then-reassign must persist.

Each test targets one site from docs/backend-data-audit.md D3:
1. api/segmented_projects.py audio endpoint 409 branch (missing flag)
2. services/segmented_project_service.py export_chapter_audio_mp3 (missing flag)
3. api/clone.py sync-from-qwen (voice role update on existing record)
4. api/clone.py PATCH description (nested prompt_text update)

(The former api/tts.py synthesize segmented-branch test was removed together
with that dead branch — segmented synthesis goes through
`/segmented-projects/.../synthesize` only.)
"""
from unittest.mock import AsyncMock

import pytest

from app.models.segmented_project import SegmentedProjectSegment
from app.models.voice_profile import VoiceProfile
from app.services import segmented_project_service as svc

from tests.test_segmented_synthesis import _seed


def _get_seg(db_session, seg_id="s1"):
    db_session.expire_all()
    return db_session.query(SegmentedProjectSegment).filter_by(id=seg_id).one()


def test_audio_endpoint_marks_missing_and_persists(client, db_session, tmp_path, monkeypatch):
    _seed(db_session, tmp_path, monkeypatch)
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    seg.audio = {"format": "mp3", "current": {"path": "ghost/s1.mp3", "format": "mp3"}}
    db_session.commit()

    resp = client.get("/api/segmented-projects/p1/audio/c1/s1")
    assert resp.status_code == 409
    assert (_get_seg(db_session).audio or {}).get("missing") is True


def test_audio_endpoint_unknown_segment_returns_404(client, db_session, tmp_path, monkeypatch):
    _seed(db_session, tmp_path, monkeypatch)
    resp = client.get("/api/segmented-projects/p1/audio/c1/nope")
    assert resp.status_code == 404


def test_export_chapter_audio_marks_missing(db_session, tmp_path, monkeypatch):
    _seed(db_session, tmp_path, monkeypatch)
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    seg.audio = {"format": "mp3", "current": {"path": "ghost/s1.mp3", "format": "mp3"}}
    db_session.commit()

    with pytest.raises(ValueError, match="no_ready_audio"):
        svc.export_chapter_audio_mp3(db_session, "p1", "c1")
    assert (_get_seg(db_session).audio or {}).get("missing") is True


def test_sync_from_qwen_updates_role_on_existing_voice(client, db_session, monkeypatch):
    voice = VoiceProfile(
        name="n",
        voice={"engine": "cosyvoice", "role": "custom"},
        voice_params={"cosyvoice": {"params": {"voice_id": "qv1"}}},
    )
    db_session.add(voice)
    db_session.commit()

    class FakeService:
        async def list_cloned_voices(self):
            return [{"voice_id": "qv1", "name": "n", "status": "OK", "role": "premium"}]

    monkeypatch.setattr("app.api.clone.get_tts_service", AsyncMock(return_value=FakeService()))
    resp = client.post("/api/clone/sync-from-qwen")
    assert resp.status_code == 200

    db_session.expire_all()
    v = db_session.query(VoiceProfile).filter_by(id=voice.id).one()
    assert (v.voice or {}).get("role") == "premium"


def test_update_description_persists_prompt_text(client, db_session):
    voice = VoiceProfile(
        name="n",
        voice={"model": "cosyvoice"},
        voice_params={"cosyvoice": {"params": {"prompt_text": "old"}}},
    )
    db_session.add(voice)
    db_session.commit()

    resp = client.patch(
        f"/api/clone/{voice.id}/description",
        json={"description": "d1", "prompt_text": "new"},
    )
    assert resp.status_code == 200

    db_session.expire_all()
    v = db_session.query(VoiceProfile).filter_by(id=voice.id).one()
    assert v.voice_params["cosyvoice"]["params"]["prompt_text"] == "new"
