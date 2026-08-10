"""workers 运行时（Pyodide）不支持线程：依赖注入链上的 sync callable 都会被
FastAPI 包进 anyio.to_thread（can't start new thread，冒烟实测）。

因此 workers 可达路由用到的 Depends 函数必须是 async（直接在事件循环上 await）。
"""
import inspect

import pytest

from app.core import asset_store
from app.core.repositories import deps
from main import create_app


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


class TestWorkersRoutesStaticScan:
    """静态扫描 create_app("workers") 全路由表：

    - endpoint 必须是 coroutine function；
    - 依赖（递归）必须是 coroutine function 或 async generator
      （FastAPI 对 async generator 依赖也在事件循环上迭代，无线程）。
    一次锁死回归，比逐端点写测试划算。
    """

    @staticmethod
    def _workers_app():
        return create_app("workers")

    def test_all_endpoints_are_coroutine_functions(self):
        bad = []
        for route in self._workers_app().routes:
            endpoint = getattr(route, "endpoint", None)
            if endpoint is None:
                continue
            if not inspect.iscoroutinefunction(endpoint):
                bad.append(
                    f"{getattr(route, 'path', '?')} -> "
                    f"{endpoint.__module__}.{endpoint.__qualname__}"
                )
        assert not bad, (
            "workers 路由的 sync 端点会在 Pyodide 下经 anyio.to_thread 崩溃：\n"
            + "\n".join(sorted(bad))
        )

    def test_all_dependencies_are_async(self):
        bad: dict[int, str] = {}

        def walk(dependant, path: str) -> None:
            for dep in dependant.dependencies:
                call = dep.call
                if not (
                    inspect.iscoroutinefunction(call)
                    or inspect.isasyncgenfunction(call)
                ):
                    bad[id(call)] = (
                        f"{path} -> {getattr(call, '__module__', '?')}."
                        f"{getattr(call, '__qualname__', repr(call))}"
                    )
                walk(dep, path)

        for route in self._workers_app().routes:
            dependant = getattr(route, "dependant", None)
            if dependant is not None:
                walk(dependant, getattr(route, "path", "?"))
        assert not bad, (
            "workers 路由的 sync 依赖会在 Pyodide 下经 anyio.to_thread 崩溃：\n"
            + "\n".join(sorted(bad.values()))
        )
