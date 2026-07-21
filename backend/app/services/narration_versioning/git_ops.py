"""Thin subprocess wrapper around `git`. Not thread-safe."""
from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path


class GitError(RuntimeError):
    pass


DEFAULT_GITIGNORE = (
    "# Audio files live under backend/uploads/, tracked by DB metadata only.\n"
    "projects/*/audio/\n"
)


def ensure_repo(repo: Path, *, author_name: str, author_email: str) -> None:
    repo.mkdir(parents=True, exist_ok=True)
    if not (repo / ".git").is_dir():
        _run(["git", "init", "-q", "-b", "main"], cwd=repo)
    _run(["git", "config", "user.name", author_name], cwd=repo)
    _run(["git", "config", "user.email", author_email], cwd=repo)
    gitignore = repo / ".gitignore"
    if not gitignore.exists() or "projects/*/audio/" not in gitignore.read_text():
        gitignore.write_text(DEFAULT_GITIGNORE)


def add_all(repo: Path) -> None:
    _run(["git", "add", "-A"], cwd=repo)


def has_staged_changes(repo: Path) -> bool:
    proc = _run_raw(["git", "diff", "--cached", "--quiet"], cwd=repo)
    if proc.returncode in (0, 1):
        return proc.returncode == 1
    raise GitError(f"git diff --cached failed: {proc.stderr}")


def commit(repo: Path, message: str) -> str | None:
    if not has_staged_changes(repo):
        return None
    _run(["git", "commit", "-q", "-m", message], cwd=repo)
    return _run(["git", "rev-parse", "HEAD"], cwd=repo).stdout.strip()


@dataclass
class GitLogEntry:
    sha: str
    timestamp: str
    subject: str


def git_log(repo: Path, *, path_filter: str | None = None, limit: int = 50) -> list[GitLogEntry]:
    cmd = ["git", "log", f"-{limit}", "--pretty=format:%H\x1f%cI\x1f%s"]
    if path_filter:
        cmd += ["--", path_filter]
    result = _run(cmd, cwd=repo)
    entries: list[GitLogEntry] = []
    for line in result.stdout.splitlines():
        parts = line.split("\x1f", 2)
        if len(parts) == 3:
            entries.append(GitLogEntry(sha=parts[0], timestamp=parts[1], subject=parts[2]))
    return entries


def _run(cmd: list[str], *, cwd: Path) -> subprocess.CompletedProcess:
    p = _run_raw(cmd, cwd=cwd)
    if p.returncode != 0:
        raise GitError(f"git failed ({p.returncode}): {' '.join(cmd)}\n{p.stderr}")
    return p


def _run_raw(cmd: list[str], *, cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
