#!/usr/bin/env python3
"""PreToolUse: suggest compaction after many edits in this session."""
import json
import sys
import tempfile
from pathlib import Path

THRESHOLD = 15
COUNTER_FILE = Path(tempfile.gettempdir()) / "traceflow-edit-count"

try:
    data = json.loads(sys.stdin.read())
except json.JSONDecodeError:
    print("{}")
    sys.exit(0)

tool = data.get("tool_name", "")
if tool in ("Edit", "Write"):
    count = 0
    if COUNTER_FILE.exists():
        try:
            count = int(COUNTER_FILE.read_text().strip())
        except ValueError:
            pass
    count += 1
    COUNTER_FILE.write_text(str(count))
    if count == THRESHOLD:
        print(f"INFO: {count} edits in this session. Consider summarizing context.", file=sys.stderr)

print("{}")
