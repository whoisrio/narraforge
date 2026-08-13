"""步骤 3A：workers 模式下 system_config / model_config 的行为契约。

- storage_mode 在 workers 模式同样生效（读/写 Supabase system_configs），
  使 Vercel 部署下"后端存储"可用（音频进 Supabase Storage）。
- get_config / set_config 在 workers 模式委托 Supabase 仓储（db 形参为 None 也可用），
  使 model_config_service 的所有下游（llm_client、mimo_tts_service）无需改签名。
"""
import json

import httpx
import pytest

from app.core import model_config_service, system_config_service
from app.core.config import settings


@pytest.fixture
def workers(monkeypatch):
    monkeypatch.setattr(settings, "deploy_target", "workers")
    return monkeypatch


def _mock_supabase(monkeypatch, handler):
    from app.core.supabase_client import SupabaseClient

    requests: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    client = SupabaseClient("https://test.supabase.co", "k", transport=httpx.MockTransport(_handler))
    monkeypatch.setattr(
        "app.core.system_config_service.get_supabase_client", lambda: client
    )
    return requests


class TestStorageModeWorkers:
    def test_get_storage_mode_default_frontend(self, workers):
        _mock_supabase(workers, lambda req: httpx.Response(200, json=[]))
        assert system_config_service.get_storage_mode(None) == "frontend"

    def test_get_storage_mode_backend_via_supabase(self, workers):
        _mock_supabase(workers, lambda req: httpx.Response(200, json=[{"value": "backend"}]))
        assert system_config_service.get_storage_mode(None) == "backend"
        assert system_config_service.is_frontend_storage(None) is False

    def test_set_storage_mode_writes_via_supabase(self, workers):
        seen: dict = {}
        store: dict[str, str] = {}

        def handler(req: httpx.Request) -> httpx.Response:
            if req.method == "GET":
                return httpx.Response(200, json=[])
            body = json.loads(req.content)
            store[body[0]["key"]] = body[0]["value"]
            seen["body"] = body[0]
            return httpx.Response(201, json=body)

        _mock_supabase(workers, handler)
        # db=None：workers 模式不触碰 Session，写入经 Supabase 仓储提交
        system_config_service.set_storage_mode(None, "backend")
        assert store["storage_mode"] == "backend"
        assert seen["body"]["key"] == "storage_mode"

    def test_set_storage_mode_still_validates(self, workers):
        with pytest.raises(ValueError):
            system_config_service.set_storage_mode(None, "bogus")

    def test_local_mode_unchanged(self, db_session, monkeypatch):
        monkeypatch.setattr(settings, "deploy_target", "local")
        system_config_service.set_storage_mode(db_session, "backend")
        db_session.commit()
        assert system_config_service.get_storage_mode(db_session) == "backend"
        assert system_config_service.is_frontend_storage(db_session) is False


class TestWorkersConfigDelegation:
    def test_get_config_reads_via_supabase(self, workers):
        requests = _mock_supabase(
            workers, lambda req: httpx.Response(200, json=[{"value": "backend"}])
        )
        assert system_config_service.get_config(None, "storage_mode") == "backend"
        assert requests[0].url.params["key"] == "eq.storage_mode"

    def test_get_config_default_when_missing(self, workers):
        _mock_supabase(workers, lambda req: httpx.Response(200, json=[]))
        assert system_config_service.get_config(None, "missing", "d") == "d"

    def test_set_config_writes_via_supabase(self, workers):
        seen = {}

        def handler(req: httpx.Request) -> httpx.Response:
            seen["body"] = json.loads(req.content)
            return httpx.Response(201, json=seen["body"])

        _mock_supabase(workers, handler)
        system_config_service.set_config(None, "k", "v")
        assert seen["body"][0] == {"key": "k", "value": "v", "updated_at": seen["body"][0]["updated_at"]}

    def test_local_get_set_config_untouched_by_delegation(self, db_session, monkeypatch):
        monkeypatch.setattr(settings, "deploy_target", "local")
        system_config_service.set_config(db_session, "k", "v")
        db_session.commit()
        assert system_config_service.get_config(db_session, "k") == "v"


class TestModelConfigServiceWorkers:
    def test_effective_config_reads_via_supabase(self, workers):
        stored = json.dumps({"api_key": "sk-ui", "base_url": "https://ui.example"})

        def handler(req: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=[{"value": stored}])

        _mock_supabase(workers, handler)
        config = model_config_service.get_effective_config(None, "mimo_tts")
        assert config["api_key"] == "sk-ui"
        assert config["base_url"] == "https://ui.example"

    def test_update_provider_config_works_with_none_db(self, workers):
        store: dict[str, str] = {}

        def handler(req: httpx.Request) -> httpx.Response:
            if req.method == "GET":
                return httpx.Response(200, json=[])
            body = json.loads(req.content)
            store[body[0]["key"]] = body[0]["value"]
            return httpx.Response(201, json=body)

        _mock_supabase(workers, handler)
        # db=None 不得因 db.commit() 崩溃
        result = model_config_service.update_provider_config(None, "mimo_tts", {"base_url": "https://new"})
        assert result["base_url"] == "https://new"
        saved = json.loads(store["model_config.mimo_tts"])
        assert saved["base_url"] == "https://new"


class TestRepoDeps:
    """依赖注入按 deploy_target 选择 Local/Supabase 实现。"""

    @pytest.mark.asyncio
    async def test_local_mode_returns_local_repos(self, db_session, monkeypatch):
        monkeypatch.setattr(settings, "deploy_target", "local")
        from app.core.repositories import deps
        from app.core.repositories.roles import LocalRoleRepository
        from app.core.repositories.source_documents import LocalSourceDocumentRepository
        from app.core.repositories.system_configs import LocalSystemConfigRepository
        from app.core.repositories.tts_results import LocalTTSResultRepository
        from app.core.repositories.voice_profiles import LocalVoiceProfileRepository

        assert isinstance(await deps.get_system_config_repo(db_session), LocalSystemConfigRepository)
        assert isinstance(await deps.get_role_repo(db_session), LocalRoleRepository)
        assert isinstance(await deps.get_voice_repo(db_session), LocalVoiceProfileRepository)
        assert isinstance(await deps.get_source_document_repo(db_session), LocalSourceDocumentRepository)
        assert isinstance(await deps.get_tts_results_repo(db_session), LocalTTSResultRepository)

    @pytest.mark.asyncio
    async def test_workers_mode_returns_supabase_repos(self, workers):
        from app.core.repositories import deps
        from app.core.repositories.roles import SupabaseRoleRepository
        from app.core.repositories.source_documents import SupabaseSourceDocumentRepository
        from app.core.repositories.system_configs import SupabaseSystemConfigRepository
        from app.core.repositories.tts_results import SupabaseTTSResultRepository
        from app.core.repositories.voice_profiles import SupabaseVoiceProfileRepository
        from app.core.supabase_client import SupabaseClient

        client = SupabaseClient(
            "https://test.supabase.co", "k",
            transport=httpx.MockTransport(lambda req: httpx.Response(200, json=[])),
        )
        workers.setattr(deps, "get_supabase_client", lambda: client)

        # db=None：workers 模式不得触碰 Session
        assert isinstance(await deps.get_system_config_repo(None), SupabaseSystemConfigRepository)
        assert isinstance(await deps.get_role_repo(None), SupabaseRoleRepository)
        assert isinstance(await deps.get_voice_repo(None), SupabaseVoiceProfileRepository)
        assert isinstance(await deps.get_source_document_repo(None), SupabaseSourceDocumentRepository)
        assert isinstance(await deps.get_tts_results_repo(None), SupabaseTTSResultRepository)
