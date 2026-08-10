"""步骤 5A（Cloudflare 部署）：GET /api/config/capabilities。

workers / local 两种部署目标返回不同的引擎/克隆引擎/功能开关清单，
前端据此隐藏或禁用本地专属能力（见 spec 第 4 节）。
"""
from fastapi.testclient import TestClient

import main as main_module

# Cloudflare Access 中间件要求 workers 请求带邮箱头（见 access_middleware）
_ACCESS_HEADERS = {"cf-access-authenticated-user-email": "tester@example.com"}

LOCAL_ENGINES = ["edge_tts", "mimo_tts", "cosyvoice", "voxcpm"]
LOCAL_CLONE_ENGINES = ["qwen", "mimo", "voxcpm"]

WORKERS_ENGINES = ["edge_tts", "mimo_tts"]
WORKERS_CLONE_ENGINES = ["mimo"]


def _get(client: TestClient) -> dict:
    resp = client.get("/api/config/capabilities", headers=_ACCESS_HEADERS)
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestCapabilitiesLocal:
    def test_local_full_capabilities(self):
        client = TestClient(main_module.create_app("local"))
        data = _get(client)
        assert data["deploy_target"] == "local"
        assert data["engines"] == LOCAL_ENGINES
        assert data["clone_engines"] == LOCAL_CLONE_ENGINES
        assert data["features"] == {
            "speech_to_text": True,
            "agent_workflow": True,
            "backend_storage": True,
        }


class TestCapabilitiesWorkers:
    def test_workers_restricted_capabilities(self):
        client = TestClient(main_module.create_app("workers"))
        data = _get(client)
        assert data["deploy_target"] == "workers"
        assert data["engines"] == WORKERS_ENGINES
        assert data["clone_engines"] == WORKERS_CLONE_ENGINES
        assert data["features"] == {
            "speech_to_text": False,
            "agent_workflow": False,
            "backend_storage": False,
        }

    def test_workers_capabilities_is_subset_of_local(self):
        """workers 清单必须是 local 清单的子集（防拼写漂移）。"""
        local = _get(TestClient(main_module.create_app("local")))
        workers = _get(TestClient(main_module.create_app("workers")))
        assert set(workers["engines"]) <= set(local["engines"])
        assert set(workers["clone_engines"]) <= set(local["clone_engines"])
