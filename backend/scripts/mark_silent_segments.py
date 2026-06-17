"""One-shot script: scan the segmented audio directory and mark segments
whose files are too small to be real TTS output as audio_missing.

Background: a stub version of synthesize_speech_internal produced 50ms of
silence for every synth call, written as 2205-byte MP3s to the segmented
directory. The stub has been replaced; this script cleans up the bad rows
the stub left behind so the UI can show a clear "audio missing" indicator
instead of pretending the segments are playable.

Idempotent — safe to re-run.

Usage:
  cd backend
  uv run python -m scripts.mark_silent_segments
"""
import sys
from pathlib import Path

# Make `app` importable when running as a module.
BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

from app.core.database import SessionLocal  # noqa: E402
from app.services.segmented_project_service import (  # noqa: E402
    mark_silent_segments_as_missing,
)


def main() -> int:
    db = SessionLocal()
    try:
        result = mark_silent_segments_as_missing(db)
    finally:
        db.close()

    print("=" * 60)
    print("Silent segment cleanup — results")
    print("=" * 60)
    for k, v in result.items():
        print(f"  {k:18s}: {v}")
    print("=" * 60)
    if result["marked"] == 0:
        print("Nothing to do — DB is clean (or already cleaned).")
    else:
        print(
            f"\nMarked {result['marked']} segment(s) as audio_missing=True."
            "\nThe original files were left on disk for inspection."
            "\nRe-synthesize affected segments in the UI to get real audio."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
