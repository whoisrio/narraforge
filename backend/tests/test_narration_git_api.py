"""API tests for narration git remote setting + manual snapshot endpoint."""
import subprocess


def test_get_git_remote_unset_returns_null(client):
    resp = client.get("/api/config/narration-git-remote")
    assert resp.status_code == 200
    assert resp.json() == {"value": None}


def test_put_git_remote_sets_value(client):
    resp = client.put(
        "/api/config/narration-git-remote",
        json={"value": "https://github.com/me/narraforge.git"},
    )
    assert resp.status_code == 200
    assert resp.json()["value"] == "https://github.com/me/narraforge.git"
    assert client.get("/api/config/narration-git-remote").json()["value"] == \
        "https://github.com/me/narraforge.git"


def test_put_git_remote_empty_clears(client):
    client.put("/api/config/narration-git-remote", json={"value": "x"})
    resp = client.put("/api/config/narration-git-remote", json={"value": "   "})
    assert resp.status_code == 200
    assert resp.json()["value"] is None


def test_snapshot_endpoint_no_remote_local_commit_only(client, db_session, monkeypatch, tmp_path):
    # seed a project so there's something to snapshot
    client.post("/api/segmented-projects", json={
        "id": "snap-test", "name": "Snap", "layout": "vertical",
        "source_document": "# s", "chapters": [],
    })
    # point the repo at a tmp dir
    from app.services.narration_versioning import config as nv_config
    monkeypatch.setattr(nv_config, "repo_path", lambda: tmp_path / "repo")

    resp = client.post("/api/config/narration-git/snapshot")
    assert resp.status_code == 200
    body = resp.json()
    assert body["remote_configured"] is False
    assert body["pushed"] is False
    assert body["push_error"] is None
    assert body["projects"] >= 1
    assert body["commit_sha"] is not None  # local commit happened


def test_snapshot_endpoint_with_remote_pushes(client, db_session, monkeypatch, tmp_path):
    client.post("/api/segmented-projects", json={
        "id": "snap-test2", "name": "Snap2", "layout": "vertical",
        "source_document": "# s", "chapters": [],
    })
    from app.services.narration_versioning import config as nv_config
    monkeypatch.setattr(nv_config, "repo_path", lambda: tmp_path / "repo")
    remote = tmp_path / "remote.git"
    subprocess.check_call(["git", "init", "--bare", "-q", str(remote)])
    client.put("/api/config/narration-git-remote", json={"value": str(remote)})

    resp = client.post("/api/config/narration-git/snapshot")
    assert resp.status_code == 200
    body = resp.json()
    assert body["remote_configured"] is True
    assert body["pushed"] is True
    assert body["push_error"] is None
    # remote received a commit
    log = subprocess.check_output(
        ["git", "log", "--all", "--pretty=%s"], cwd=remote, text=True
    )
    assert "snapshot:" in log
