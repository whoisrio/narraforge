"""E2E smoke: seed via API → snapshot → verify files + git log."""
import subprocess
from pathlib import Path

from app.services.narration_versioning.job import snapshot_all


def _seed(client, pid="e2e-project", name="端到端测试"):
    payload = {
        "id": pid, "name": name, "layout": "vertical",
        "source_document": "# 源文档\n正文。",
        "chapters": [
            {
                "id": "ch01", "position": 1, "name": "Prologue",
                "design_title": "序章",
                "voice": {"engine": "edge_tts"}, "split_config": {},
                "original_text": "原文。",
                "narration_script": "改写。",
                "segments": [
                    {"id": "s001", "position": 0, "text": "第一段。",
                     "segment_kind": "narration", "voice": {"source": "chapter"}},
                    {"id": "s002", "position": 1, "text": "第二段。",
                     "segment_kind": "dialogue", "role_id": "role_xm",
                     "emotion": "happy", "voice": {"source": "role", "role_id": "role_xm"}},
                ],
            }
        ],
    }
    r = client.post("/api/segmented-projects", json=payload)
    assert r.status_code in (200, 201), r.text


def test_snapshot_writes_expected_tree_and_commits(client, db_session, tmp_path):
    _seed(client)
    repo = tmp_path / "narration-repo"
    result = snapshot_all(repo=repo, session=db_session)
    assert result.commit_sha is not None
    assert result.projects_snapshotted == 1

    proj_dir = repo / "projects" / "e2e-project"
    assert (proj_dir / "project.yaml").exists()
    assert "正文。" in (proj_dir / "source.md").read_text()

    ch_dir = proj_dir / "chapters" / "ch01"
    assert "改写。" in (ch_dir / "script.md").read_text()
    segs = (ch_dir / "segments.md").read_text()
    assert "<!-- s001 kind=narration -->" in segs
    assert "第一段。" in segs
    assert "<!-- s002 kind=dialogue role=role_xm emotion=happy" in segs

    # verify committed to git
    log_out = subprocess.check_output(
        ["git", "log", "--oneline"], cwd=repo, text=True,
    )
    assert log_out.count("\n") == 1
    assert "snapshot:" in log_out


def test_edit_then_second_snapshot_produces_second_commit(client, db_session, tmp_path):
    _seed(client)
    repo = tmp_path / "narration-repo"
    snapshot_all(repo=repo, session=db_session)

    r = client.get("/api/segmented-projects/e2e-project")
    proj = r.json()
    proj["chapters"][0]["narration_script"] = "改写 v2。"
    r = client.put("/api/segmented-projects/e2e-project", json=proj)
    assert r.status_code in (200, 201)
    db_session.expire_all()

    result = snapshot_all(repo=repo, session=db_session)
    assert result.commit_sha is not None

    log_out = subprocess.check_output(
        ["git", "log", "--oneline"], cwd=repo, text=True,
    )
    assert log_out.count("\n") == 2

    diff = subprocess.check_output(
        ["git", "diff", "HEAD~1", "HEAD", "--", "projects/e2e-project/chapters/ch01/script.md"],
        cwd=repo, text=True,
    )
    assert "改写 v2。" in diff
    assert "改写。" in diff
