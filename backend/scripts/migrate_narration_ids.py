"""CLI: migrate legacy project/chapter/segment IDs to semantic form.

Usage:
    uv run python -m scripts.migrate_narration_ids            # apply
    uv run python -m scripts.migrate_narration_ids --dry-run  # preview
"""
from __future__ import annotations

import argparse
import logging
import sys

from app.core.database import SessionLocal, init_db
from app.services.narration_versioning.id_migration import migrate_ids


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dry-run", action="store_true", help="Preview without writing")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    init_db()

    session = SessionLocal()
    try:
        result = migrate_ids(session=session, dry_run=args.dry_run)
    finally:
        session.close()

    prefix = "[dry-run] " if args.dry_run else ""
    print(f"{prefix}Projects renamed:  {result.projects_migrated}")
    print(f"{prefix}Chapters renamed:  {result.chapters_migrated}")
    print(f"{prefix}Segments renamed:  {result.segments_migrated}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
