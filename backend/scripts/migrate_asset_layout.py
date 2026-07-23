"""CLI wrapper for the segmented-asset layout migration.

Usage:
    cd backend
    uv run python -m scripts.migrate_asset_layout

Idempotent: rescans on every run and only touches what still needs moving.
"""
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

from app.core.database import SessionLocal  # noqa: E402
from app.services.migrate_asset_layout import migrate_all_projects  # noqa: E402


def main() -> int:
    db = SessionLocal()
    try:
        result = migrate_all_projects(db)
    finally:
        db.close()

    print("=" * 60)
    print("Segmented asset layout migration — results")
    print("=" * 60)
    print(f"  projects scanned : {result['projects_scanned']}")
    print(f"  projects migrated: {result['projects_migrated']}")
    print(f"  errors           : {len(result['errors'])}")
    for err in result["errors"]:
        print(f"    - {err}")
    print("=" * 60)
    return 0 if not result["errors"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
