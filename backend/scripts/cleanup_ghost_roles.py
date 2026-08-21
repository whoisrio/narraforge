"""CLI: 清理 dev 库角色垃圾数据（一次性，用户 2026-08-21 确认范围）。

清理：e2e 漏入的 test-role-* 角色、__scratchpad__ 孤儿角色、
segment 悬空 role_id（置 NULL）。
不动：project_id IS NULL 的全局角色（用户决定保留）、正常项目角色。

dry-run 默认；--apply 前用 SQLite 在线备份 API 落副本（WAL 安全，无需停服）。

Usage:
    uv run python -m scripts.cleanup_ghost_roles            # dry-run（默认）
    uv run python -m scripts.cleanup_ghost_roles --apply    # 备份 + 执行
"""
from __future__ import annotations

import argparse
import logging

from app.core.config import settings
from scripts.backfill_usage_events import _backup, _db_path

logger = logging.getLogger(__name__)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--apply", action="store_true", help="execute (default: dry-run)")
    args = p.parse_args(argv)

    if settings.deploy_target == "workers":
        raise SystemExit("workers 模式的存量在 Supabase，本脚本只处理本地 SQLite。")

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    from app.core.database import SessionLocal
    from app.services import role_cleanup_service as cleanup

    db = SessionLocal()
    try:
        plan = cleanup.plan_local(db)
        print(f"待删 e2e test-role：{len(plan['test_role_ids'])} {plan['test_role_ids']}")
        print(f"待删 __scratchpad__ 孤儿角色：{len(plan['scratchpad_role_ids'])}")
        print(f"待置 NULL 的悬空 segment role_id：{len(plan['dangling_segment_role_ids'])} {plan['dangling_segment_role_ids']}")

        if not args.apply:
            print("\nDry-run only. Re-run with --apply to execute.")
            return 0

        backup_path = _backup(_db_path())
        print(f"已备份：{backup_path}")

        stats = cleanup.apply_local(db)
        db.commit()
        print(
            f"清理完成：test_roles_deleted={stats['test_roles_deleted']}，"
            f"scratchpad_roles_deleted={stats['scratchpad_roles_deleted']}，"
            f"dangling_role_refs_nulled={stats['dangling_role_refs_nulled']}"
        )
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
