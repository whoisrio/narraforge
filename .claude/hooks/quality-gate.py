#!/usr/bin/env python3
"""PostToolUse: run ruff check on edited Python files."""
import json
import subprocess
import sys

try:
    data = json.loads(sys.stdin.read())
except json.JSONDecodeError:
    print("{}")
    sys.exit(0)

tool = data.get("tool_name", "")
file_path = data.get("tool_input", {}).get("file_path", "")

if tool in ("Edit", "Write") and file_path.endswith(".py"):
    result = subprocess.run(
        ["uv", "run", "ruff", "check", file_path],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        print(f"ruff check failed for {file_path}:\n{result.stdout}", file=sys.stderr)

print("{}")
