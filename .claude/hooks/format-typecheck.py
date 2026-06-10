#!/usr/bin/env python3
"""Stop: batch format all modified Python and TypeScript files."""
import subprocess
import sys
from pathlib import Path

try:
    root = subprocess.check_output(
        ["git", "rev-parse", "--show-toplevel"], text=True, stderr=subprocess.DEVNULL
    ).strip()
except subprocess.CalledProcessError:
    print("{}")
    sys.exit(0)

root = Path(root)

# Get modified files
try:
    modified = subprocess.check_output(
        ["git", "diff", "--name-only", "HEAD"], text=True, cwd=root, stderr=subprocess.DEVNULL
    ).strip().splitlines()
except subprocess.CalledProcessError:
    modified = []

try:
    untracked = subprocess.check_output(
        ["git", "ls-files", "--others", "--exclude-standard"], text=True, cwd=root, stderr=subprocess.DEVNULL
    ).strip().splitlines()
except subprocess.CalledProcessError:
    untracked = []

all_files = sorted(set(modified + untracked))
py_files = [f for f in all_files if f.endswith(".py")]
ts_files = [f for f in all_files if f.endswith((".ts", ".tsx"))]

if py_files:
    subprocess.run(["uv", "run", "ruff", "format"] + py_files, cwd=root,
                    capture_output=True, timeout=60)
    subprocess.run(["uv", "run", "ruff", "check", "--fix"] + py_files, cwd=root,
                    capture_output=True, timeout=60)

if ts_files:
    try:
        subprocess.run(["npx", "prettier", "--write"] + ts_files, cwd=root,
                        capture_output=True, timeout=60)
    except FileNotFoundError:
        pass  # npx not available

print("{}")
