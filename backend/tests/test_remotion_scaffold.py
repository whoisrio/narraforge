"""Unit tests for remotion_scaffold_service (npx + audio export are mocked)."""
import json
from types import SimpleNamespace

import pytest

from app.services import remotion_scaffold_service as rss


class _Db:
    def commit(self):
        pass


def _project(remotion_path=None):
    seg = SimpleNamespace(
        id="s1",
        position=0,
        text="你好世界",
        audio={"current": {"path": "p/c1/s1.mp3", "duration_sec": 2.5}},
    )
    chapter = SimpleNamespace(
        id="c1", position=0, name="第一章", design_title=None, segments=[seg]
    )
    return SimpleNamespace(
        id="p1", name="demo", remotion_project_path=remotion_path, chapters=[chapter]
    )


def _patch_common(monkeypatch, project, exported_name="第一章.mp3"):
    monkeypatch.setattr(rss.svc, "get_project_row", lambda db, pid: project)
    monkeypatch.setattr(
        rss.svc,
        "export_chapter_audio_mp3",
        lambda db, pid, cid, export_directory: _FakePath(exported_name),
    )


class _FakePath:
    def __init__(self, name):
        self.name = name


def test_creates_project_when_missing(monkeypatch, tmp_path):
    project = _project()
    _patch_common(monkeypatch, project)
    calls = []

    class _Proc:
        returncode = 0
        stdout = ""
        stderr = ""

    def fake_run(cmd, **kw):
        calls.append(cmd)
        # simulate create-video writing package.json
        (tmp_path / "package.json").write_text(
            json.dumps({"dependencies": {"remotion": "^4.0.0"}})
        )
        return _Proc()

    monkeypatch.setattr(rss.subprocess, "run", fake_run)
    monkeypatch.setattr(rss.shutil, "which", lambda name: "/usr/bin/npx")

    result = rss.scaffold_remotion_project(_Db(), "p1", target_dir=str(tmp_path))

    assert result["created"] is True
    assert result["chapters"] == 1
    assert calls[0][:3] == ["npx", "create-video@latest", "--yes"]
    # assets refreshed
    manifest = json.loads((tmp_path / "segment_manifest.json").read_text())
    assert manifest["chapters"][0]["audio"] == "public/audio/第一章.mp3"
    assert manifest["chapters"][0]["subtitles"] == "public/subtitles/chapter_0.srt"
    assert manifest["chapters"][0]["duration_sec"] == 2.5
    srt = (tmp_path / "public/subtitles/chapter_0.srt").read_text()
    assert "00:00:00,000 --> 00:00:02,500" in srt
    assert (tmp_path / "AGENTS.md").exists()
    # path persisted on the project
    assert project.remotion_project_path == str(tmp_path)


def test_existing_project_skips_creation_and_refreshes(monkeypatch, tmp_path):
    (tmp_path / "package.json").write_text(
        json.dumps({"dependencies": {"remotion": "^4.0.0"}})
    )
    project = _project(remotion_path=str(tmp_path))
    _patch_common(monkeypatch, project)

    def boom(cmd, **kw):
        raise AssertionError("subprocess should not be called")

    monkeypatch.setattr(rss.subprocess, "run", boom)

    result = rss.scaffold_remotion_project(_Db(), "p1")
    assert result["created"] is False
    assert (tmp_path / "segment_manifest.json").exists()


def test_animation_brief_written(monkeypatch, tmp_path):
    (tmp_path / "package.json").write_text(
        json.dumps({"dependencies": {"remotion": "^4.0.0"}})
    )
    project = _project(remotion_path=str(tmp_path))
    _patch_common(monkeypatch, project)

    brief = {"chapters": [{"chapter_position": 0, "title": "第一章", "segments": []}]}
    rss.scaffold_remotion_project(_Db(), "p1", animation_brief=brief)
    written = json.loads((tmp_path / "animation_brief.json").read_text())
    assert written["chapters"][0]["title"] == "第一章"


def test_no_target_raises_value_error(monkeypatch):
    project = _project(remotion_path=None)
    monkeypatch.setattr(rss.svc, "get_project_row", lambda db, pid: project)
    with pytest.raises(ValueError, match="remotion_target_not_set"):
        rss.scaffold_remotion_project(_Db(), "p1")


def test_missing_npx_raises_runtime_error(monkeypatch, tmp_path):
    project = _project()
    _patch_common(monkeypatch, project)
    monkeypatch.setattr(rss.shutil, "which", lambda name: None)
    with pytest.raises(RuntimeError, match="npx_not_found"):
        rss.scaffold_remotion_project(_Db(), "p1", target_dir=str(tmp_path))


def test_create_video_failure_raises_with_stderr(monkeypatch, tmp_path):
    project = _project()
    _patch_common(monkeypatch, project)
    monkeypatch.setattr(rss.shutil, "which", lambda name: "/usr/bin/npx")

    class _Proc:
        returncode = 1
        stdout = ""
        stderr = "npm ERR! network timeout"

    monkeypatch.setattr(rss.subprocess, "run", lambda cmd, **kw: _Proc())
    with pytest.raises(RuntimeError, match="create_video_failed"):
        rss.scaffold_remotion_project(_Db(), "p1", target_dir=str(tmp_path))


def test_scaffold_endpoint_404_for_missing_project(client, monkeypatch):
    monkeypatch.setattr(
        rss.svc, "get_project_row", lambda db, pid: None
    )
    resp = client.post("/api/segmented-projects/nope/scaffold-remotion", json={})
    assert resp.status_code == 404


def test_scaffold_endpoint_422_without_target(client, monkeypatch):
    monkeypatch.setattr(
        rss.svc,
        "get_project_row",
        lambda db, pid: SimpleNamespace(
            id="p1", name="demo", remotion_project_path=None, chapters=[]
        ),
    )
    resp = client.post("/api/segmented-projects/p1/scaffold-remotion", json={})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "remotion_target_not_set"
