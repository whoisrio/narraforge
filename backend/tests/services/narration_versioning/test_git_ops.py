import subprocess
from pathlib import Path

from app.services.narration_versioning.git_ops import (
    ensure_repo, add_all, has_staged_changes, commit, git_log,
)


def _sh(cmd: list[str], cwd: Path) -> str:
    return subprocess.check_output(cmd, cwd=cwd, text=True)


def test_ensure_repo_initializes(tmp_path):
    repo = tmp_path / "r"
    ensure_repo(repo, author_name="NarraForge Bot", author_email="bot@narraforge.local")
    assert (repo / ".git").is_dir()
    assert _sh(["git", "config", "user.name"], repo).strip() == "NarraForge Bot"


def test_ensure_repo_writes_gitignore(tmp_path):
    repo = tmp_path / "r"
    ensure_repo(repo, author_name="a", author_email="a@a")
    assert "projects/*/audio/" in (repo / ".gitignore").read_text()


def test_ensure_repo_is_idempotent(tmp_path):
    repo = tmp_path / "r"
    ensure_repo(repo, author_name="a", author_email="a@a")
    (repo / "marker.txt").write_text("keep me")
    subprocess.check_call(["git", "add", "marker.txt"], cwd=repo)
    subprocess.check_call(
        ["git", "-c", "user.name=x", "-c", "user.email=x@x", "commit", "-m", "seed"],
        cwd=repo,
    )
    ensure_repo(repo, author_name="a", author_email="a@a")
    assert (repo / "marker.txt").exists()


def test_has_staged_changes(tmp_path):
    repo = tmp_path / "r"
    ensure_repo(repo, author_name="a", author_email="a@a")
    (repo / "x.md").write_text("hi")
    add_all(repo)
    assert has_staged_changes(repo) is True
    commit(repo, "seed")
    assert has_staged_changes(repo) is False


def test_commit_returns_sha(tmp_path):
    repo = tmp_path / "r"
    ensure_repo(repo, author_name="a", author_email="a@a")
    (repo / "x.md").write_text("hi")
    add_all(repo)
    sha = commit(repo, "seed")
    assert sha is not None and len(sha) == 40


def test_commit_no_staged_returns_none(tmp_path):
    repo = tmp_path / "r"
    ensure_repo(repo, author_name="a", author_email="a@a")
    (repo / "x.md").write_text("hi")
    add_all(repo)
    commit(repo, "seed")
    assert commit(repo, "empty") is None


def test_git_log_filtered_by_path(tmp_path):
    repo = tmp_path / "r"
    ensure_repo(repo, author_name="a", author_email="a@a")
    (repo / "projects").mkdir()
    (repo / "projects" / "a").mkdir()
    (repo / "projects" / "b").mkdir()
    (repo / "projects" / "a" / "x.md").write_text("1")
    (repo / "projects" / "b" / "y.md").write_text("1")
    add_all(repo); commit(repo, "both")

    (repo / "projects" / "a" / "x.md").write_text("2")
    add_all(repo); commit(repo, "only a")

    log_a = git_log(repo, path_filter="projects/a", limit=10)
    log_b = git_log(repo, path_filter="projects/b", limit=10)
    assert len(log_a) == 2
    assert len(log_b) == 1
