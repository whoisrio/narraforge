"""CLI: 回填存量数据的 usage_events（kind='tts'，按字数折算）。

覆盖两类存量：
- 已合成 segment（audio.current 存在且非 recorded）→ 每段 1 次 TTS，chars=len(text)
- tts_results 历史行 → 每行 1 次 TTS，chars=len(text)，created_at 保留

LLM 调用无历史记录，无法回填。

幂等：事件 id 为 uuid5 确定性主键，重复执行是 no-op。
备份：--apply 前用 SQLite 在线备份 API 复制当前 DB（WAL 安全，无需停服；
但批量写入期间建议避免同时使用系统）。

Usage:
    uv run python -m scripts.backfill_usage_events            # dry-run（默认）
    uv run python -m scripts.backfill_usage_events --apply    # 备份 + 执行
"""
from __future__ import annotations

import argparse
import logging
import sqlite3
import time
from pathlib import Path

from app.core.config import settings

logger = logging.getLogger(__name__)


def _db_path() -> Path:
    url = settings.database_url
    if not url.startswith("sqlite:///"):
        raise SystemExit(f"仅支持 sqlite，当前 database_url={url}")
    return Path(url.removeprefix("sqlite:///")).resolve()


def _backup(db_path: Path) -> Path:
    """SQLite 在线备份 API：对 live WAL 库也能拿到一致性快照（不停服）。"""
    backup_path = db_path.with_name(f"{db_path.stem}_backup_{int(time.time())}{db_path.suffix}")
    src = sqlite3.connect(str(db_path))
    try:
        dst = sqlite3.connect(str(backup_path))
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    return backup_path


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--apply", action="store_true", help="execute (default: dry-run)")
    args = p.parse_args(argv)

    if settings.deploy_target == "workers":
        raise SystemExit("workers 模式的存量在 Supabase，本脚本只处理本地 SQLite。")

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    from app.core.database import SessionLocal
    from app.services import usage_backfill_service as backfill

    db = SessionLocal()
    try:
        events = backfill.collect_local(db)
        seg_events = [e for e in events if e.project_id is not None]
        hist_events = [e for e in events if e.project_id is None]
        print(f"待回填：segment 合成 {len(seg_events)} 条，tts_results 历史 {len(hist_events)} 条")
        print(f"合计字数：segments {sum(e.chars for e in seg_events)}，历史 {sum(e.chars for e in hist_events)}")

        if not args.apply:
            print("\nDry-run only. Re-run with --apply to execute.")
            return 0

        db_path = _db_path()
        backup_path = _backup(db_path)
        print(f"已备份：{backup_path}")

        stats = backfill.apply_local(db)
        db.commit()
        print(
            f"写入完成：segment_events={stats['segment_events']}，"
            f"history_events={stats['history_events']}，"
            f"skipped_existing={stats['skipped_existing']}"
        )
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
