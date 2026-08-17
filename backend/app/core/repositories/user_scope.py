"""M4：Supabase 仓储的用户归属作用域（workers 模式多用户隔离）。

service key 走 PostgREST 绕过 RLS，隔离在仓储层实现：
- 已认证用户：select/update/delete 追加 ``user_id=eq.<id>``，insert 写入
  ``user_id``——跨用户访问在查询层自然落空（路由映射 404，不泄露存在性）；
- legacy admin（旧凭证通道）：``see_all=True``，不加过滤，看全部行；
- 匿名兜底：``user_id IS NULL`` 作用域（只见未归属的旧数据），匿名正常只
  能到达无状态 allowlist 端点、不会触达这些仓储，这是纵深防御。

chapters/segments 无 user_id 列：归属经 project 传递，由
SupabaseSegmentedProjectRepository 在操作前校验 project 归属。
"""
from __future__ import annotations


class UserScope:
    """归属作用域基类：提供过滤参数与插入行标记两个钩子。"""

    def __init__(self, owner_id: str | None = None, see_all: bool = False):
        self._owner_id = owner_id
        self._see_all = see_all

    def _scope_params(self, params: dict | None = None) -> dict:
        """select/update/delete 过滤参数追加 user_id 条件（see_all 原样返回）。"""
        params = dict(params or {})
        if not self._see_all:
            params["user_id"] = f"eq.{self._owner_id}" if self._owner_id else "is.null"
        return params

    def _stamp_row(self, row: dict) -> dict:
        """insert 行写入归属（legacy admin/匿名 → None，保持未归属）。"""
        row["user_id"] = self._owner_id
        return row
