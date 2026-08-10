"""workers 运行时（Pyodide）不支持线程：依赖注入链上的 sync callable 都会被
FastAPI 包进 anyio.to_thread（can't start new thread，冒烟实测）。

因此 workers 可达路由用到的 Depends 函数必须是 async（直接在事件循环上 await）。
"""
import inspect

import pytest

from app.core import asset_store
from app.core.repositories import deps


class TestAsyncDependencies:
    @pytest.mark.parametrize(
        "name",
        [
            "get_system_config_repo",
            "get_role_repo",
            "get_voice_repo",
            "get_source_document_repo",
            "get_segmented_repo",
        ],
    )
    def test_repo_deps_are_async(self, name: str):
        assert inspect.iscoroutinefunction(getattr(deps, name))

    def test_get_asset_store_is_async(self):
        assert inspect.iscoroutinefunction(asset_store.get_asset_store)
