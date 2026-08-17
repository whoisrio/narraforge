"""CLI: 回填存量行的 user_id 归属（M2，workers/Supabase 多用户迁移）。

把五张归属表（segmented_projects / voice_profiles / roles / source_documents /
tts_results）中 user_id IS NULL 的存量行指派给指定用户（Supabase Auth user id）。
chapters/segments 无 user_id 列（归属经 project 传递），无需处理。

幂等：只动 user_id IS NULL 的行，重复执行是 no-op。
执行前建议先在 Supabase 控制台备份（或确认有 PITR）。

Usage:
    uv run python -m scripts.backfill_user_ownership --user-id <uuid>            # dry-run（默认）
    uv run python -m scripts.backfill_user_ownership --user-id <uuid> --apply    # 执行
"""
from __future__ import annotations

import argparse
import logging
import uuid as uuid_mod

from app.core.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)

# 归属表（schema.sql M2 节加了 user_id 的五张；system_configs 全局共享不在内）
OWNED_TABLES = (
    "segmented_projects",
    "voice_profiles",
    "roles",
    "source_documents",
    "tts_results",
)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--user-id", required=True, help="接收存量行的 Supabase Auth user id (uuid)")
    p.add_argument("--apply", action="store_true", help="execute (default: dry-run)")
    args = p.parse_args(argv)

    try:
        user_id = str(uuid_mod.UUID(args.user_id))
    except ValueError:
        p.error(f"--user-id 不是合法 uuid: {args.user_id}")

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    client = get_supabase_client()

    for table in OWNED_TABLES:
        orphans = client.select(table, params={"user_id": "is.null", "select": "id"})
        print(f"[{table}] user_id IS NULL rows: {len(orphans)}")
        if not args.apply or not orphans:
            continue
        updated = client.update(table, {"user_id": user_id}, params={"user_id": "is.null"})
        print(f"[{table}] backfilled {len(updated)} rows -> user_id={user_id}")

    if not args.apply:
        print("\nDry-run only. Re-run with --apply to execute.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
