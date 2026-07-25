import subprocess
from pathlib import Path

import pytest

from app.services.narration_versioning.git_ops import (
    GitError, ensure_repo, add_all, has_staged_changes, commit, git_log, push,
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


# ── push ──

def _bare_remote(tmp_path: Path) -> Path:
    remote = tmp_path / "remote.git"
    subprocess.check_call(["git", "init", "--bare", "-q", str(remote)])
    return remote


def _seed_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "r"
    ensure_repo(repo, author_name="a", author_email="a@a")
    (repo / "x.md").write_text("hi")
    add_all(repo)
    commit(repo, "seed")
    return repo


def test_push_creates_origin_and_pushes_to_bare_remote(tmp_path):
    remote = _bare_remote(tmp_path)
    repo = _seed_repo(tmp_path)
    push(repo, str(remote), branch="main")
    # origin now points at remote
    assert subprocess.check_output(
        ["git", "remote", "get-url", "origin"], cwd=repo, text=True
    ).strip() == str(remote)
    # remote received the commit
    log = subprocess.check_output(
        ["git", "log", "--all", "--pretty=%s"], cwd=remote, text=True
    )
    assert "seed" in log


def test_push_updates_existing_origin_url(tmp_path):
    remote = _bare_remote(tmp_path)
    repo = _seed_repo(tmp_path)
    subprocess.check_call(["git", "remote", "add", "origin", "/dummy/old"], cwd=repo)
    push(repo, str(remote), branch="main")
    assert subprocess.check_output(
        ["git", "remote", "get-url", "origin"], cwd=repo, text=True
    ).strip() == str(remote)


def test_push_failure_raises_git_error(tmp_path):
    repo = _seed_repo(tmp_path)
    with pytest.raises(GitError):
        push(repo, "/nonexistent/path/remote.git", branch="main")
