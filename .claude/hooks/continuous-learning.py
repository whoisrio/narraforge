#!/usr/bin/env python3
"""PreToolUse + PostToolUse: record tool usage for pattern analysis."""
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    root = subprocess.check_output(
        ["git", "rev-parse", "--show-toplevel"], text=True, stderr=subprocess.DEVNULL
    ).strip()
except subprocess.CalledProcessError:
    root = "."

LOG_FILE = Path(root) / ".claude" / "learning-log.jsonl"
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

try:
    data = json.loads(sys.stdin.read())
except json.JSONDecodeError:
    print("{}")
    sys.exit(0)

entry = {
    "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "tool": data.get("tool_name", ""),
    "file": data.get("tool_input", {}).get("file_path", ""),
    "command": (data.get("tool_input", {}).get("command", "") or "")[:200],
}

with LOG_FILE.open("a", encoding="utf-8") as f:
    f.write(json.dumps(entry, ensure_ascii=False) + "\n")

print("{}")
