"""用量计量端点测试（Phase 3，local 模式）。

- GET /api/segmented-projects/{project_id}/usage：项目级用量合计（tts 次数、
  字符、LLM token），项目不存在 404；
- GET /api/me/usage：单租户全量用量，按项目分桶 + 项目名解析 + totals。
"""
import pytest

from app.core.repositories.usage import LocalUsageRepository


def _create_project(client, project_id="p1", name="测试项目"):
    resp = client.post(
        "/api/segmented-projects",
        json={"id": project_id, "name": name, "schema_version": 2, "chapters": []},
    )
    assert resp.status_code == 201, resp.text


class TestProjectUsageEndpoint:
    def test_usage_after_recorded_events(self, client, db_session):
        _create_project(client, "p1")
        repo = LocalUsageRepository(db_session)
        repo.record_event(kind="tts", chars=10, project_id="p1")
        repo.record_event(kind="tts", chars=6, project_id="p1")
        repo.record_event(
            kind="llm", chars=100, input_tokens=40, output_tokens=15,
            project_id="p1", estimated=True,
        )
        repo.record_event(kind="tts", chars=999, project_id="p2")  # 其他项目不计入

        resp = client.get("/api/segmented-projects/p1/usage")
        assert resp.status_code == 200, resp.text
        assert resp.json() == {
            "project_id": "p1",
            "tts_count": 2,
            "chars": 116,
            "input_tokens": 40,
            "output_tokens": 15,
        }

    def test_usage_project_not_found(self, client):
        resp = client.get("/api/segmented-projects/nope/usage")
        assert resp.status_code == 404


class TestMeUsageEndpoint:
    def test_me_usage_local_single_tenant(self, client, db_session):
        _create_project(client, "p1", name="项目甲")
        repo = LocalUsageRepository(db_session)
        repo.record_event(kind="tts", chars=10, project_id="p1")
        repo.record_event(kind="llm", chars=20, input_tokens=8, output_tokens=4, project_id="p1")
        repo.record_event(kind="llm", chars=5, input_tokens=2, output_tokens=1, project_id=None)

        resp = client.get("/api/me/usage")
        assert resp.status_code == 200, resp.text
        body = resp.json()

        projects = {p["project_id"]: p for p in body["projects"]}
        assert projects["p1"] == {
            "project_id": "p1", "project_name": "项目甲",
            "tts_count": 1, "chars": 30, "input_tokens": 8, "output_tokens": 4,
        }
        # 无项目归属的 LLM 调用归入 None 桶
        assert projects[None]["project_name"] is None
        assert projects[None]["chars"] == 5

        assert body["totals"] == {
            "tts_count": 1, "chars": 35, "input_tokens": 10, "output_tokens": 5,
        }

    def test_me_usage_empty(self, client):
        resp = client.get("/api/me/usage")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["projects"] == []
        assert body["totals"] == {
            "tts_count": 0, "chars": 0, "input_tokens": 0, "output_tokens": 0,
        }
