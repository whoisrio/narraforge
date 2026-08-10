"""Cloudflare Workers Python 入口（步骤 4A，wrangler.toml 的 main）。

FastAPI（create_app("workers")）经 asgi.fetch 挂载，写法参照 spike/cf-workers。

本地 CPython 兼容：workers/asgi 模块只在 Pyodide 运行时存在，顶层导入带
ImportError 降级（Default=None），保证本地 `import workers_entry`（测试
env→settings 桥）不炸。

env→settings 桥：workers 没有 .env，settings 在 app.core.config import 时
一次性读取 os.environ；因此入口在首个 fetch 时先把 env（[vars] + secrets）
注入 os.environ，再 import main，settings 随之生效。R2 binding 是对象不是
字符串，不能经环境变量传递，由 _get_app 单独经 set_r2_binding 注入。
"""
from __future__ import annotations

import logging
import os

try:  # 仅 Pyodide 运行时存在
    import asgi
    from workers import WorkerEntrypoint
except ImportError:  # 本地 CPython（测试/工具）：入口类降级为 None
    asgi = None
    WorkerEntrypoint = None

logger = logging.getLogger(__name__)

# env（[vars]/secrets，全大写）→ os.environ 同名键；settings 字段名即小写形式。
# 只列字符串配置；R2 binding（ASSETS）单独注入 asset_store。
WORKERS_ENV_KEYS = (
    "DEPLOY_TARGET",
    "APP_ENV",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
    "MIMO_API_KEY",
    "MIMO_BASE_URL",
    "LLM_API_KEY",
    "LLM_BASE_URL",
    "LLM_MODEL",
    "CORS_ORIGINS",
    "ACCESS_ENFORCEMENT",
    "LOG_TO_FILE",
)


def apply_workers_env(env) -> list[str]:
    """把 Workers env 绑定中的字符串值注入 os.environ，返回注入的键名。

    env 为 JsProxy（duck-typed getattr）；缺失属性跳过；JS 字符串经 str() 转
    Python str。幂等（重复注入同值无害）。
    """
    applied = []
    for key in WORKERS_ENV_KEYS:
        value = getattr(env, key, None)
        if value is None:
            continue
        os.environ[key] = str(value)
        applied.append(key)
    return applied


_app = None


def _get_app(env):
    """首个 fetch 构建并缓存 FastAPI app：先注入 env，再 import main。

    缓存到模块级：同一 isolate 内后续请求复用（Pyodide 冷启动只在首次发生）。
    """
    global _app
    if _app is None:
        applied = apply_workers_env(env)
        import main as main_module

        from app.core.asset_store import set_r2_binding

        set_r2_binding(getattr(env, "ASSETS", None))
        _app = main_module.create_app("workers")
        logger.info("workers app created; env keys injected: %s", applied)
    return _app


def _reset_cached_app() -> None:
    """测试辅助：清空缓存的 app（避免模块级缓存跨用例污染）。"""
    global _app
    _app = None


if WorkerEntrypoint is not None:

    class Default(WorkerEntrypoint):
        async def fetch(self, request):
            app = _get_app(self.env)
            return await asgi.fetch(app, request, self.env)

else:
    Default = None
