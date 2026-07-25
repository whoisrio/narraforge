import subprocess

from app.services.narration_versioning.job import snapshot_all
from app.services.narration_versioning.git_ops import git_log


def _seed_project(client, pid="deepseek-strategy", name="DeepSeek 策略"):
    payload = {
        "id": pid,
        "name": name,
        "layout": "vertical",
        "source_document": "# 源",
        "chapters": [
            {
                "id": "ch01-opening",
                "position": 1,
                "name": "Opening",
                "design_title": "开场白",
                "voice": {"engine": "edge_tts"},
                "split_config": {},
                "original_text": "原文。",
                "narration_script": "改写。",
                "segments": [
                    {"id": "s001", "position": 0, "text": "第一段。",
                     "segment_kind": "narration", "voice": {"source": "chapter"}},
                    {"id": "s002", "position": 1, "text": "第二段。",
                     "segment_kind": "narration", "voice": {"source": "chapter"}},
                ],
            }
        ],
    }
    r = client.post("/api/segmented-projects", json=payload)
    assert r.status_code in (200, 201), r.text


def test_snapshot_creates_initial_commit(client, db_session, tmp_path):
    _seed_project(client)
    repo = tmp_path / "repo"
    result = snapshot_all(repo=repo, session=db_session)
    assert result.commit_sha is not None
    assert result.projects_snapshotted == 1
    log = git_log(repo, limit=10)
    assert len(log) == 1
    assert log[0].subject.startswith("snapshot:")


def test_snapshot_noop_when_nothing_changed(client, db_session, tmp_path):
    _seed_project(client)
    repo = tmp_path / "repo"
    snapshot_all(repo=repo, session=db_session)
    result2 = snapshot_all(repo=repo, session=db_session)
    assert result2.commit_sha is None
    assert len(git_log(repo, limit=10)) == 1


def test_snapshot_records_second_commit_after_edit(client, db_session, tmp_path):
    _seed_project(client)
    repo = tmp_path / "repo"
    snapshot_all(repo=repo, session=db_session)

    r = client.get("/api/segmented-projects/deepseek-strategy")
    proj = r.json()
    proj["chapters"][0]["narration_script"] = "改写 v2"
    r = client.put("/api/segmented-projects/deepseek-strategy", json=proj)
    assert r.status_code in (200, 201)

    # Ensure the API's write is visible to our db_session for the next snapshot query.
    db_session.expire_all()

    result = snapshot_all(repo=repo, session=db_session)
    assert result.commit_sha is not None
    assert len(git_log(repo, limit=10)) == 2


def test_snapshot_message_contains_project_slug(client, db_session, tmp_path):
    _seed_project(client)
    repo = tmp_path / "repo"
    snapshot_all(repo=repo, session=db_session)
    log_out = subprocess.check_output(
        ["git", "log", "-1", "--format=%B"], cwd=repo, text=True,
    )
    assert "deepseek-strategy" in log_out


# ── push integration ──

def _bare_remote(tmp_path):
    remote = tmp_path / "remote.git"
    subprocess.check_call(["git", "init", "--bare", "-q", str(remote)])
    return remote


def test_snapshot_pushes_when_remote_given(client, db_session, tmp_path):
    _seed_project(client)
    repo = tmp_path / "repo"
    remote = _bare_remote(tmp_path)
    result = snapshot_all(repo=repo, session=db_session, remote_url=str(remote))
    assert result.commit_sha is not None
    assert result.pushed is True
    assert result.push_error is None
    # remote received the commit
    log = subprocess.check_output(
        ["git", "log", "--all", "--pretty=%s"], cwd=remote, text=True
    )
    assert "snapshot:" in log


def test_snapshot_no_push_when_no_remote(client, db_session, tmp_path):
    _seed_project(client)
    repo = tmp_path / "repo"
    result = snapshot_all(repo=repo, session=db_session, remote_url=None)
    assert result.pushed is False
    assert result.push_error is None
    assert result.commit_sha is not None  # local commit still happened


def test_snapshot_push_failure_records_error_but_commit_succeeds(client, db_session, tmp_path):
    _seed_project(client)
    repo = tmp_path / "repo"
    result = snapshot_all(
        repo=repo, session=db_session, remote_url="/nonexistent/remote.git"
    )
    assert result.commit_sha is not None  # local commit succeeded
    assert result.pushed is False
    assert result.push_error  # error captured
