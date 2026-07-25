"""CLI: migrate segmented assets to the unified data root (plan B).

Usage:
    uv run python -m scripts.migrate_to_data_root            # dry-run (default)
    uv run python -m scripts.migrate_to_data_root --apply    # execute
"""
from __future__ import annotations

import argparse
import logging
import sys

from app.core.database import SessionLocal, init_db
from app.services.data_root_migration import apply_migration, plan_migration


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--apply", action="store_true", help="execute (default: dry-run)")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    init_db()

    session = SessionLocal()
    try:
        plans = plan_migration(session)
        for plan in plans:
            if plan.skipped_reason:
                print(f"[skip] {plan.project_id}: {plan.skipped_reason}")
                continue
            print(f"[plan] {plan.project_id} -> {plan.slug_dir.name}")
            print(f"       dir_moves={len(plan.dir_moves)} file_moves={len(plan.file_moves)} "
                  f"audio_rewrites={len(plan.audio_rewrites)} doc_rewrites={len(plan.doc_rewrites)}")
            for note in plan.notes:
                print(f"       note: {note}")
        if not args.apply:
            print("\nDry-run only. Re-run with --apply to execute.")
            return 0
        apply_migration(session, plans)
        print("\nApplied.")
        return 0
    finally:
        session.close()


if __name__ == "__main__":
    sys.exit(main())
