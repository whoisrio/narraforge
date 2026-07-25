"""API tests for project export/import endpoints."""
import io
import json
import zipfile

from app.core import config
from app.core.segmented_assets import segment_audio_path
from app.models.segmented_project import SegmentedProjectSegment
from app.schemas.segmented_project import ProjectIn
from app.services import segmented_project_service as svc


def _seed(pid: str = "p1") -> ProjectIn:
    return ProjectIn(
        id=pid, name="API项目", schema_version=2, layout="vertical", original_text="全文",
        chapters=[{
            "id": "c1", "position": 0, "name": "第一章", "engine": "edge_tts",
            "voice": {"engine": "edge_tts"},
            "split_config": {"delimiters": ["。"], "mode": "rule"},
            "segments": [{"id": "s1", "position": 0, "text": "hello", "voice": {"source": "chapter"}}],
        }],
    )


def _setup_project_with_audio(db, tmp_path, monkeypatch, pid="p1"):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    svc.save_project(db, _seed(pid))
    db.commit()
    seg = db.query(SegmentedProjectSegment).filter_by(id="s1").one()
    abs_path = segment_audio_path(pid, "c1", chapter_title="第一章", project_name="API项目",
                                  segment_id="s1", position=0, fmt="mp3")
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_bytes(b"MP3")
    rel = abs_path.relative_to(config.settings.segmented_dir).as_posix()
    seg.audio = {"format": "mp3", "current": {"id": None, "path": rel}, "duration_sec": 1.0}
    db.commit()


def test_export_endpoint_returns_zip(client, db_session, tmp_path, monkeypatch):
    _setup_project_with_audio(db_session, tmp_path, monkeypatch)
    resp = client.get("/api/segmented-projects/p1/export")
    assert resp.status_code == 200
    assert "zip" in resp.headers.get("content-type", "")
    assert "attachment" in resp.headers.get("content-disposition", "")
    z = zipfile.ZipFile(io.BytesIO(resp.content))
    manifest = json.loads(z.read("manifest.json"))
    assert manifest["project"]["name"] == "API项目"
    assert "assets/segments/s1.mp3" in z.namelist()


def test_export_endpoint_404_unknown(client):
    resp = client.get("/api/segmented-projects/nope/export")
    assert resp.status_code == 404


def test_export_endpoint_refuses_scratchpad(client):
    resp = client.get(f"/api/segmented-projects/__scratchpad__/export")
    assert resp.status_code == 403


def test_import_endpoint_creates_new_project(client, db_session, tmp_path, monkeypatch):
    _setup_project_with_audio(db_session, tmp_path, monkeypatch)
    zip_bytes = client.get("/api/segmented-projects/p1/export").content

    resp = client.post(
        "/api/segmented-projects/import",
        files={"file": ("api.narraforge.zip", zip_bytes, "application/zip")},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["id"] != "p1"
    assert body["name"] == "API项目"
    assert len(body["chapters"]) == 1
    assert body["chapters"][0]["segments"][0]["text"] == "hello"
    # new project fetchable
    assert client.get(f"/api/segmented-projects/{body['id']}").status_code == 200


def test_import_endpoint_rejects_bad_zip(client):
    resp = client.post(
        "/api/segmented-projects/import",
        files={"file": ("bad.zip", b"not a zip", "application/zip")},
    )
    assert resp.status_code == 422
