"""Supabase PostgREST 客户端（步骤 3A）。

workers 运行时（Cloudflare Pyodide）没有原生 socket，psycopg/asyncpg 不可用，
持久化只能经 httpx 走 Supabase PostgREST REST。本地 CPython 同样可跑同一份代码。

- base_url / service key 来自 settings（supabase_url / supabase_service_key）。
- 同步 httpx.Client；transport 可注入（测试用 httpx.MockTransport）。
- PostgREST 语义：REST 过滤（?id=eq.x）、Prefer: return=representation、
  单条取数组首元素（不用 vnd.pgrst.object+json，避免 0 行时 406 分支）。
"""
from __future__ import annotations

import httpx

from app.core.config import settings

_PREFER_RETURN = "return=representation"


class SupabaseError(RuntimeError):
    """PostgREST 非 2xx 响应。status_code 供仓储层映射领域错误（如 409 唯一冲突）。"""

    def __init__(self, status_code: int, message: str):
        super().__init__(f"Supabase request failed ({status_code}): {message}")
        self.status_code = status_code


class SupabaseClient:
    """PostgREST 薄封装：select / insert / update / delete，返回解析后的 JSON。"""

    def __init__(
        self,
        base_url: str,
        service_key: str,
        *,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 30.0,
    ):
        if not base_url or not service_key:
            raise ValueError("SupabaseClient requires base_url and service_key")
        self._http = httpx.Client(
            base_url=base_url.rstrip("/") + "/rest/v1/",
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
            },
            transport=transport,
            timeout=timeout,
        )

    def _request(
        self,
        method: str,
        table: str,
        *,
        params: dict | None = None,
        json_body: object = None,
        prefer: str | None = None,
    ):
        headers = {"Prefer": prefer} if prefer else None
        resp = self._http.request(method, table, params=params, json=json_body, headers=headers)
        if resp.status_code >= 400:
            try:
                detail = resp.json()
                message = detail.get("message") or detail.get("hint") or str(detail)
            except ValueError:
                message = resp.text
            raise SupabaseError(resp.status_code, message)
        if not resp.content:
            return None
        return resp.json()

    def select(self, table: str, *, params: dict | None = None) -> list:
        return self._request("GET", table, params=params) or []

    def select_one(self, table: str, *, params: dict | None = None) -> dict | None:
        rows = self.select(table, params=params)
        return rows[0] if rows else None

    def insert(self, table: str, rows: list[dict], *, upsert: bool = False) -> list:
        prefer = _PREFER_RETURN
        if upsert:
            prefer = f"resolution=merge-duplicates,{_PREFER_RETURN}"
        return self._request("POST", table, json_body=rows, prefer=prefer) or []

    def update(self, table: str, values: dict, *, params: dict) -> list:
        return self._request("PATCH", table, params=params, json_body=values, prefer=_PREFER_RETURN) or []

    def delete(self, table: str, *, params: dict) -> list:
        return self._request("DELETE", table, params=params, prefer=_PREFER_RETURN) or []


def get_supabase_client(*, transport: httpx.BaseTransport | None = None) -> SupabaseClient:
    """按 settings 构建客户端。未配置时 RuntimeError（workers 部署必须配置 secrets）。"""
    if not settings.supabase_url or not settings.supabase_service_key:
        raise RuntimeError(
            "Supabase is not configured: set SUPABASE_URL and SUPABASE_SERVICE_KEY"
        )
    return SupabaseClient(settings.supabase_url, settings.supabase_service_key, transport=transport)
