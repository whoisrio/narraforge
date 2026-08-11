"""步骤 4A：Workers 入口 env→settings 桥 + 本地可导入性。

`workers_entry` 是 Cloudflare Workers 的 Python entrypoint（wrangler.toml 的
main）。workers/asgi 模块只在 Pyodide 运行时存在，顶层导入有降级，
本地 CPython `import workers_entry` 不炸（Default=None）。

env→settings 桥：workers 没有 .env，settings 在 import 时读 os.environ；
入口首 fetch 时把 env（[vars] + secrets）经 apply_workers_env 注入
os.environ 后再 import main，settings 随之生效。R2 binding 不能经环境变量
传递，由 _get_app 单独经 set_r2_binding 注入。
"""
import os
from types import SimpleNamespace

import pytest
from fastapi import FastAPI

import workers_entry
from app.core.config import Settings


class TestLocalImportability:
    def test_importable_without_workers_module(self):
        """本地 CPython 可导入；Default 入口类降级为 None。"""
        assert workers_entry.Default is None

    def test_exposes_env_keys(self):
        assert "DEPLOY_TARGET" in workers_entry.WORKERS_ENV_KEYS
        assert "SUPABASE_SERVICE_KEY" in workers_entry.WORKERS_ENV_KEYS


class TestApplyWorkersEnv:
    def test_injects_known_keys(self, monkeypatch):
        for key in workers_entry.WORKERS_ENV_KEYS:
            monkeypatch.delenv(key, raising=False)
        env = SimpleNamespace(
            DEPLOY_TARGET="workers",
            SUPABASE_URL="https://ref.supabase.co",
            SUPABASE_SERVICE_KEY="svc-key",
            CORS_ORIGINS="https://a.pages.dev",
        )
        applied = workers_entry.apply_workers_env(env)
        assert os.environ["DEPLOY_TARGET"] == "workers"
        assert os.environ["SUPABASE_URL"] == "https://ref.supabase.co"
        assert os.environ["SUPABASE_SERVICE_KEY"] == "svc-key"
        assert os.environ["CORS_ORIGINS"] == "https://a.pages.dev"
        assert set(applied) == {
            "DEPLOY_TARGET",
            "SUPABASE_URL",
            "SUPABASE_SERVICE_KEY",
            "CORS_ORIGINS",
        }

    def test_missing_keys_skipped(self, monkeypatch):
        for key in workers_entry.WORKERS_ENV_KEYS:
            monkeypatch.delenv(key, raising=False)
        env = SimpleNamespace(DEPLOY_TARGET="workers")
        assert workers_entry.apply_workers_env(env) == ["DEPLOY_TARGET"]

    def test_settings_pick_up_injected_values(self, monkeypatch):
        for key in workers_entry.WORKERS_ENV_KEYS:
            monkeypatch.delenv(key, raising=False)
        env = SimpleNamespace(
            DEPLOY_TARGET="workers",
            SUPABASE_URL="https://ref.supabase.co",
            CORS_ORIGINS="https://a.pages.dev,https://b.pages.dev",
        )
        workers_entry.apply_workers_env(env)
        s = Settings()
        assert s.deploy_target == "workers"
        assert s.supabase_url == "https://ref.supabase.co"
        assert s.cors_origins == ["https://a.pages.dev", "https://b.pages.dev"]


class TestGetApp:
    @pytest.mark.asyncio
    async def test_creates_workers_app_and_injects_r2_binding(self, monkeypatch):
        import app.core.asset_store as asset_store_module
        from app.core.config import settings

        monkeypatch.setattr(settings, "deploy_target", "workers")
        fake_bucket = object()
        env = SimpleNamespace(ASSETS=fake_bucket, DEPLOY_TARGET="workers")
        workers_entry._reset_cached_app()
        try:
            app = workers_entry._get_app(env)
            assert isinstance(app, FastAPI)
            # R2 binding 已注入 asset_store
            monkeypatch.setattr(settings, "deploy_target", "workers")
            store = await asset_store_module.get_asset_store()
            assert store.bucket is fake_bucket
            # app 被缓存（同一 isolate 内复用）
            assert workers_entry._get_app(env) is app
        finally:
            workers_entry._reset_cached_app()
            asset_store_module.set_r2_binding(None)
