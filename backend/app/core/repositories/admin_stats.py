"""管理后台统计仓储（M5，Supabase-only）。

数据来自 M2 的统计表（profiles / daily_stats / operation_logs /
daily_active_users），由 stats_middleware 写入。local 模式无用户体系，
本仓储只在 workers 模式经 deps.get_admin_stats_repo 注入。

规模假设：单实例小团队量级，分页/聚合在 Python 侧做（PostgREST 聚合
能力有限，行数可控时全量 select + 内存聚合最简单可靠）。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.core.supabase_client import SupabaseClient

PROFILES = "profiles"
DAILY_STATS = "daily_stats"
OPERATION_LOGS = "operation_logs"
DAILY_ACTIVE_USERS = "daily_active_users"

_SERIES_DAYS = 30
_VISIT_METRICS = ("visit_authed", "visit_anon")


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _date_range(days: int) -> list[str]:
    today = datetime.now(timezone.utc).date()
    return [(today - timedelta(days=offset)).isoformat() for offset in range(days - 1, -1, -1)]


class SupabaseAdminStatsRepository:
    def __init__(self, client: SupabaseClient):
        self._client = client

    # ----- 总览 -----

    def overview(self) -> dict:
        today = _today()
        since = _date_range(_SERIES_DAYS)[0]

        total_users = len(self._client.select(PROFILES, params={"select": "id"}))

        dau_rows = self._client.select(
            DAILY_ACTIVE_USERS, params={"date": f"gte.{since}", "select": "date,user_id"}
        )
        dau_by_date: dict[str, int] = {}
        for row in dau_rows:
            dau_by_date[row["date"]] = dau_by_date.get(row["date"], 0) + 1

        stat_rows = self._client.select(
            DAILY_STATS,
            params={
                "date": f"gte.{since}",
                "metric": f"in.({','.join(_VISIT_METRICS)})",
            },
        )
        visits_by_date: dict[str, dict[str, int]] = {}
        for row in stat_rows:
            bucket = visits_by_date.setdefault(row["date"], {"authed": 0, "anon": 0})
            if row["metric"] == "visit_authed":
                bucket["authed"] += int(row.get("count") or 0)
            elif row["metric"] == "visit_anon":
                bucket["anon"] += int(row.get("count") or 0)

        return {
            "total_users": total_users,
            "today_dau": dau_by_date.get(today, 0),
            "dau_series": [
                {"date": d, "count": dau_by_date.get(d, 0)} for d in _date_range(_SERIES_DAYS)
            ],
            "visit_series": [
                {
                    "date": d,
                    "authed": visits_by_date.get(d, {}).get("authed", 0),
                    "anon": visits_by_date.get(d, {}).get("anon", 0),
                }
                for d in _date_range(_SERIES_DAYS)
            ],
        }

    # ----- 用户列表 -----

    def list_users(self, page: int = 1, page_size: int = 20) -> dict:
        rows = self._client.select(PROFILES, params={"order": "created_at.desc"})
        # 操作次数统计（全量 select user_id 列，小数据量可接受）
        op_counts: dict[str, int] = {}
        for log in self._client.select(OPERATION_LOGS, params={"select": "user_id"}):
            uid = log.get("user_id")
            if uid:
                op_counts[uid] = op_counts.get(uid, 0) + 1

        items = [
            {
                "id": row["id"],
                "email": row.get("email"),
                "created_at": row.get("created_at"),
                "last_seen_at": row.get("last_seen_at"),
                "is_admin": bool(row.get("is_admin")),
                "operation_count": op_counts.get(row["id"], 0),
            }
            for row in rows
        ]
        return _paginate(items, page, page_size)

    # ----- 操作日志 -----

    def list_logs(
        self,
        page: int = 1,
        page_size: int = 50,
        *,
        user_id: str | None = None,
        action: str | None = None,
        date: str | None = None,
    ) -> dict:
        params: dict[str, str] = {"order": "created_at.desc"}
        if user_id:
            params["user_id"] = f"eq.{user_id}"
        if action:
            params["action"] = f"eq.{action}"
        rows = self._client.select(OPERATION_LOGS, params=params)
        if date:
            # created_at 为 ISO 时间戳，日期前缀匹配即可
            rows = [r for r in rows if str(r.get("created_at") or "").startswith(date)]
        return _paginate(rows, page, page_size)


def _paginate(items: list, page: int, page_size: int) -> dict:
    page = max(1, page)
    page_size = max(1, min(page_size, 200))
    start = (page - 1) * page_size
    return {
        "items": items[start:start + page_size],
        "total": len(items),
        "page": page,
        "page_size": page_size,
    }
