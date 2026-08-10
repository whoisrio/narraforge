"""步骤 3A：workers 模式 4 个简单域的端到端接线测试。

create_app("workers") + settings.deploy_target="workers" + 内存版 PostgREST，
验证：路由经仓储依赖走 Supabase REST，全程不触碰 SQLAlchemy（get_db yield None）。
local 模式零回退由既有测试（test_roles_api / test_sources_api / test_clone_api 等）锁定。
"""
import pytest
from fastapi.testclient import TestClient

import main as main_module
from app.core.config import settings
from app.core.repositories import deps
from app.core.repositories.roles import SupabaseRoleRepository
from app.core.repositories.segmented_projects import SupabaseSegmentedProjectRepository
from app.core.repositories.source_documents import SupabaseSourceDocumentRepository
from app.core.repositories.system_configs import SupabaseSystemConfigRepository
from app.core.repositories.voice_profiles import SupabaseVoiceProfileRepository
from tests.fixtures.postgrest_fake import make_fake_supabase_client


@pytest.fixture
def workers_client(monkeypatch):
    monkeypatch.setattr(settings, "deploy_target", "workers")
    client, store = make_fake_supabase_client()
    app = main_module.create_app("workers")
    app.dependency_overrides[deps.get_system_config_repo] = (
        lambda: SupabaseSystemConfigRepository(client)
    )
    app.dependency_overrides[deps.get_role_repo] = lambda: SupabaseRoleRepository(client)
    app.dependency_overrides[deps.get_voice_repo] = lambda: SupabaseVoiceProfileRepository(client)
    app.dependency_overrides[deps.get_source_document_repo] = (
        lambda: SupabaseSourceDocumentRepository(client)
    )
    app.dependency_overrides[deps.get_segmented_repo] = (
        lambda: SupabaseSegmentedProjectRepository(client)
    )
    # service 层快速路径（storage_mode / model_config）也要走同一个 fake
    monkeypatch.setattr(
        "app.core.system_config_service.get_supabase_client", lambda: client
    )
    with TestClient(app) as test_client:
        yield test_client, store
    app.dependency_overrides.clear()


class TestStorageMode:
    def test_get_always_frontend(self, workers_client):
        client, _ = workers_client
        resp = client.get("/api/config/storage-mode")
        assert resp.status_code == 200
        assert resp.json() == {"storage_mode": "frontend"}

    def test_put_ignored_and_still_frontend(self, workers_client):
        client, store = workers_client
        resp = client.put("/api/config/storage-mode", json={"storage_mode": "backend"})
        assert resp.status_code == 200
        assert resp.json() == {"storage_mode": "frontend"}
        # 忽略语义：不写库
        assert store.tables["system_configs"] == []

    def test_put_invalid_mode_rejected(self, workers_client):
        client, _ = workers_client
        resp = client.put("/api/config/storage-mode", json={"storage_mode": "bogus"})
        assert resp.status_code == 400


class TestAnimationRoot:
    def test_get_set_round_trip(self, workers_client, tmp_path):
        client, store = workers_client
        resp = client.get("/api/config/animation-root")
        assert resp.status_code == 200
        assert resp.json() == {"value": None}

        resp = client.put("/api/config/animation-root", json={"value": str(tmp_path / "anim")})
        assert resp.status_code == 200, resp.text
        assert resp.json()["value"] == str(tmp_path / "anim")
        assert store.tables["system_configs"][0]["key"] == "animation_root_folder"

        resp = client.get("/api/config/animation-root")
        assert resp.json()["value"] == str(tmp_path / "anim")


class TestRolesApi:
    def _payload(self, role_id="role-linxia"):
        return {
            "id": role_id,
            "name": "林夏",
            "role_kind": "cast",
            "voice": {"engine": "edge_tts", "params": {"edge_voice": "zh-CN-XiaoxiaoNeural"}},
            "favorite_styles": [],
        }

    def test_crud_round_trip(self, workers_client):
        client, store = workers_client
        created = client.post("/api/roles", json=self._payload())
        assert created.status_code == 201, created.text
        assert created.json()["id"] == "role-linxia"

        listed = client.get("/api/roles")
        assert [r["id"] for r in listed.json()["items"]] == ["role-linxia"]

        updated = client.put("/api/roles/role-linxia", json={"name": "林夏新版"})
        assert updated.status_code == 200
        assert updated.json()["name"] == "林夏新版"

        deleted = client.delete("/api/roles/role-linxia")
        assert deleted.status_code == 204
        assert client.get("/api/roles").json()["items"] == []
        assert store.tables["roles"] == []

    def test_duplicate_409(self, workers_client):
        client, _ = workers_client
        assert client.post("/api/roles", json=self._payload()).status_code == 201
        resp = client.post("/api/roles", json=self._payload())
        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "role_already_exists"

    def test_update_missing_404(self, workers_client):
        client, _ = workers_client
        resp = client.put("/api/roles/nope", json={"name": "x"})
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "role_not_found"

    def test_delete_missing_404(self, workers_client):
        client, _ = workers_client
        assert client.delete("/api/roles/nope").status_code == 404


class TestSourcesApi:
    def test_paste_source_round_trip(self, workers_client):
        client, store = workers_client
        # 3B 起 create_paste 对齐 local：项目必须存在
        created_project = client.post(
            "/api/segmented-projects",
            json={"id": "p1", "name": "项目一", "schema_version": 2, "chapters": []},
        )
        assert created_project.status_code == 201, created_project.text
        created = client.post(
            "/api/projects/p1/sources/paste",
            json={"source_type": "paste", "title": "第一章", "pasted_text": "这是正文。"},
        )
        assert created.status_code == 201, created.text
        src_id = created.json()["id"]
        assert src_id.startswith("src_")

        listed = client.get("/api/projects/p1/sources")
        assert [s["id"] for s in listed.json()] == [src_id]

        deleted = client.delete(f"/api/projects/p1/sources/{src_id}")
        assert deleted.status_code == 204
        assert store.tables["source_documents"] == []

    def test_audio_source_501_until_r2(self, workers_client):
        client, _ = workers_client
        resp = client.post(
            "/api/projects/p1/sources/audio",
            files={"file": ("a.mp3", b"fake-audio-bytes", "audio/mpeg")},
            data={"title": "录音"},
        )
        assert resp.status_code == 501

    def test_delete_missing_404(self, workers_client):
        client, _ = workers_client
        assert client.delete("/api/projects/p1/sources/nope").status_code == 404


class TestCloneApi:
    def _seed_voice(self, store, voice_id="v1", description="温柔女声"):
        store.tables["voice_profiles"].append(
            {
                "id": voice_id,
                "name": "测试音色",
                "description": description,
                "avatar": None,
                "project_id": None,
                "voice": {"model": "mimo_tts", "voice_type": "clone"},
                "voice_params": {"mimo_tts": {"params": {"voice_id": "mimo_voiceclone"}}},
                "preview": None,
                "created_at": "2026-08-10T01:00:00+00:00",
            }
        )

    def test_list_and_get(self, workers_client):
        client, store = workers_client
        self._seed_voice(store)
        listed = client.get("/api/clone/list")
        assert listed.status_code == 200
        items = listed.json()["items"]
        assert [v["id"] for v in items] == ["v1"]
        assert items[0]["voice"]["voice_type"] == "clone"

        got = client.get("/api/clone/v1")
        assert got.status_code == 200
        assert got.json()["name"] == "测试音色"

        assert client.get("/api/clone/nope").status_code == 404

    def test_update_description_and_duplicate_409(self, workers_client):
        client, store = workers_client
        self._seed_voice(store, "v1", "描述A")
        self._seed_voice(store, "v2", "描述B")

        resp = client.patch("/api/clone/v1/description", json={"description": "新描述"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["description"] == "新描述"

        resp = client.patch("/api/clone/v1/description", json={"description": "描述B"})
        assert resp.status_code == 409

    def test_delete(self, workers_client):
        client, store = workers_client
        self._seed_voice(store)
        resp = client.delete("/api/clone/v1")
        assert resp.status_code == 200
        assert store.tables["voice_profiles"] == []

    def test_tts_voices_lists_clone_voices(self, workers_client):
        client, store = workers_client
        self._seed_voice(store, "v1")
        store.tables["voice_profiles"].append(
            {
                "id": "v-design",
                "name": "设计音色",
                "description": None,
                "avatar": None,
                "project_id": None,
                "voice": {"model": "mimo_tts", "voice_type": "design"},
                "voice_params": {},
                "preview": None,
                "created_at": "2026-08-10T02:00:00+00:00",
            }
        )
        resp = client.get("/api/tts/voices")
        assert resp.status_code == 200
        # 只列 voice_type == clone 的音色
        assert [v["id"] for v in resp.json()["items"]] == ["v1"]
