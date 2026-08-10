"""步骤 3A：Settings 新增 Supabase 连接配置（workers 模式 PostgREST 访问）。"""
from app.core.config import Settings, settings


class TestSupabaseSettings:
    def test_defaults_are_empty(self):
        assert settings.supabase_url == ""
        assert settings.supabase_service_key == ""

    def test_env_override(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_URL", "https://xyz.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_KEY", "service-role-key")
        s = Settings()
        assert s.supabase_url == "https://xyz.supabase.co"
        assert s.supabase_service_key == "service-role-key"
