"""测试夹具：内存版 PostgREST，供 workers 模式集成测试使用。

实现 PostgREST 语义的常用子集：
- GET：eq / neq / is.null / in.(...) 过滤、or=(...) 组合、order=x.desc、select
- POST：普通插入；Prefer 含 resolution=merge-duplicates 时按主键 upsert
- PATCH / DELETE：过滤后更新/删除；均返回表示（return=representation）

只覆盖仓储层用到的语义，不是完整 PostgREST。
"""
from __future__ import annotations

import json
from urllib.parse import parse_qs

import httpx

from app.core.supabase_client import SupabaseClient

# 各表主键（upsert 冲突判定）；复合主键用 tuple
_PRIMARY_KEYS = {
    "voice_profiles": "id",
    "system_configs": "key",
    "roles": "id",
    "source_documents": "id",
    "segmented_projects": "id",
    "segmented_project_chapters": "id",
    "segmented_project_segments": "id",
    "tts_results": "id",
    "profiles": "id",
    "daily_stats": ("date", "metric"),
    "daily_active_users": ("date", "user_id"),
    "operation_logs": "id",
    "usage_events": "id",
}


class FakePostgrestStore:
    """tables: {table: [row, ...]}，测试可直接播种/断言。

    requests: 按序记录 (method, table, params, body)，供 M4 隔离测试断言
    user_id=eq.<id> 过滤与插入行归属。
    """

    def __init__(self):
        self.tables: dict[str, list[dict]] = {t: [] for t in _PRIMARY_KEYS}
        self.requests: list[dict] = []

    # ---- 过滤 ----
    def _matches(self, row: dict, params: dict) -> bool:
        for key, raw in params.items():
            if key in ("order", "select", "or"):
                continue
            op, _, value = raw.partition(".")
            cell = row.get(key)
            if op == "eq" and str(cell) != value:
                return False
            if op == "neq" and str(cell) == value:
                return False
            if op == "is" and value == "null" and cell is not None:
                return False
            if op == "gte" and not (cell is not None and str(cell) >= value):
                return False
            if op == "lt" and not (cell is not None and str(cell) < value):
                return False
            if op == "in":
                # 形如 in.(a,b,c)
                candidates = [v.strip().strip('"') for v in value.strip("()").split(",")]
                if str(cell) not in candidates:
                    return False
        or_clause = params.get("or")
        if or_clause:
            # 形如 (project_id.is.null,project_id.eq.p1)
            inner = or_clause.strip().strip("()")
            for alt in inner.split(","):
                field, _, cond = alt.partition(".")
                op, _, value = cond.partition(".")
                cell = row.get(field)
                if op == "is" and value == "null" and cell is None:
                    return True
                if op == "eq" and str(cell) == value:
                    return True
            return False
        return True

    def _sort(self, rows: list[dict], order: str | None) -> list[dict]:
        if not order:
            return rows
        field, _, direction = order.partition(".")
        return sorted(
            rows,
            key=lambda r: (r.get(field) is not None, r.get(field)),
            reverse=direction == "desc",
        )

    def handle(self, request: httpx.Request) -> httpx.Response:
        # RPC：post /rpc/increment_metric（daily_stats 原子 +1）
        if request.method == "POST" and request.url.path.endswith("/rpc/increment_metric"):
            body = json.loads(request.content)
            rows = self.tables.setdefault("daily_stats", [])
            for row in rows:
                if row.get("date") == body["p_date"] and row.get("metric") == body["p_metric"]:
                    row["count"] = int(row.get("count") or 0) + 1
                    break
            else:
                rows.append({"date": body["p_date"], "metric": body["p_metric"], "count": 1})
            return httpx.Response(200, content=b"")

        # RPC：post /rpc/hit_rate_limit（rate_limit_counters 原子 +1，返回新计数）
        if request.method == "POST" and request.url.path.endswith("/rpc/hit_rate_limit"):
            body = json.loads(request.content)
            rows = self.tables.setdefault("rate_limit_counters", [])
            for row in rows:
                if row.get("key") == body["p_key"] and row.get("day") == body["p_day"]:
                    row["count"] = int(row.get("count") or 0) + 1
                    return httpx.Response(200, json=row["count"])
            rows.append({"key": body["p_key"], "day": body["p_day"], "count": 1})
            return httpx.Response(200, json=1)

        table = request.url.path.rsplit("/", 1)[-1]
        params = dict(request.url.params)
        rows = self.tables.setdefault(table, [])
        prefer = request.headers.get("Prefer", "")
        body = json.loads(request.content) if request.content else None
        self.requests.append(
            {"method": request.method, "table": table, "params": params, "body": body}
        )

        if request.method == "GET":
            matched = self._sort([r for r in rows if self._matches(r, params)], params.get("order"))
            return httpx.Response(200, json=matched)

        if request.method == "POST":
            body = json.loads(request.content)
            if "merge-duplicates" in prefer:
                pk = _PRIMARY_KEYS[table]
                pk_fields = (pk,) if isinstance(pk, str) else pk
                for new_row in body:
                    for i, row in enumerate(rows):
                        if all(row.get(f) == new_row.get(f) for f in pk_fields):
                            rows[i] = {**row, **new_row}
                            break
                    else:
                        rows.append(dict(new_row))
            else:
                rows.extend(dict(r) for r in body)
            return httpx.Response(201, json=body)

        if request.method == "PATCH":
            values = json.loads(request.content)
            updated = []
            for row in rows:
                if self._matches(row, params):
                    row.update(values)
                    updated.append(dict(row))
            return httpx.Response(200, json=updated)

        if request.method == "DELETE":
            deleted = [r for r in rows if self._matches(r, params)]
            self.tables[table] = [r for r in rows if not self._matches(r, params)]
            return httpx.Response(200, json=deleted)

        return httpx.Response(405, json={"message": "method not allowed"})


def make_fake_supabase_client() -> tuple[SupabaseClient, FakePostgrestStore]:
    store = FakePostgrestStore()
    client = SupabaseClient(
        "https://fake.supabase.co",
        "service-key",
        transport=httpx.MockTransport(store.handle),
    )
    return client, store
