"""Output helpers: JSON payload to stdout in --json mode, progress to stderr."""
from __future__ import annotations

import json
import sys

_json_mode = False


def set_json_mode(enabled: bool) -> None:
    global _json_mode
    _json_mode = enabled


def json_mode() -> bool:
    return _json_mode


def emit_json(data: object) -> None:
    """Print the command's machine-readable payload to stdout."""
    json.dump(data, sys.stdout, ensure_ascii=False, indent=2, default=str)
    sys.stdout.write("\n")


def info(message: str) -> None:
    """Print a progress/status line to stderr (never pollutes stdout JSON)."""
    print(message, file=sys.stderr)
