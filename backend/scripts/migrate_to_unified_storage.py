"""CLI: consolidate voices / tts-history / srt under backend/data (PR-B).

Usage:
    uv run python -m scripts.migrate_to_unified_storage            # dry-run (default)
    uv run python -m scripts.migrate_to_unified_storage --apply    # execute
"""
from __future__ import annotations

import argparse
import logging
import sys

from app.core.database import SessionLocal, init_db
from app.services.unified_storage_migration import apply_storage, plan_storage


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--apply", action="store_true", help="execute (default: dry-run)")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    init_db()

    session = SessionLocal()
    try:
        plan = plan_storage(session)
        by_dst: dict[str, int] = {}
        for dst in plan.file_moves.values():
            key = str(dst.parent)
            by_dst[key] = by_dst.get(key, 0) + 1
        for dst_dir, count in sorted(by_dst.items()):
            print(f"[plan] {count:4d} file(s) -> {dst_dir}")
        if not args.apply:
            print("\nDry-run only. Re-run with --apply to execute.")
            return 0
        apply_storage(session, plan)
        print("\nApplied.")
        return 0
    finally:
        session.close()


if __name__ == "__main__":
    sys.exit(main())
