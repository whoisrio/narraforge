"""步骤 3A/3B：Role 仓储（Protocol + Local + Supabase）。

方法签名从 role_service + roles.py 路由的实际调用提取：
list / create / update / delete。Local 薄封装 role_service（含删除前引用清理）；
Supabase 走 PostgREST，删除前清理 segments/project 三处引用（3B 补齐，
对齐 local 的 _clean_role_references）。
"""
import json

import httpx
import pytest

from app.core.repositories.roles import (
    LocalRoleRepository,
    RoleRepository,
    SupabaseRoleRepository,
)
from app.schemas.role import RoleIn, RoleUpdate


def _role_in(role_id: str = "role-linxia", **overrides) -> RoleIn:
    data = {
        "id": role_id,
        "name": "林夏",
        "avatar": "avatar://linxia",
        "description": "温柔但紧张的女主角",
        "role_kind": "cast",
        "project_id": None,
        "voice": {"engine": "edge_tts", "params": {"edge_voice": "zh-CN-XiaoxiaoNeural"}},
        "favorite_styles": [{"id": "soft", "name": "低声", "style_tags": ["low_voice"]}],
    }
    data.update(overrides)
    return RoleIn(**data)


def _role_row(**overrides) -> dict:
    row = {
        "id": "role-linxia",
        "name": "林夏",
        "avatar": "avatar://linxia",
        "description": "温柔但紧张的女主角",
        "role_kind": "cast",
        "project_id": None,
        "voice": {"engine": "edge_tts", "params": {"edge_voice": "zh-CN-XiaoxiaoNeural"}},
        "favorite_styles": [{"id": "soft", "name": "低声", "style_tags": ["low_voice"]}],
        "created_at": "2026-08-10T01:00:00+00:00",
        "updated_at": "2026-08-10T01:00:00+00:00",
    }
    row.update(overrides)
    return row


def _supabase(handler) -> tuple[SupabaseRoleRepository, list[httpx.Request]]:
    from app.core.supabase_client import SupabaseClient

    requests: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    client = SupabaseClient("https://test.supabase.co", "k", transport=httpx.MockTransport(_handler))
    return SupabaseRoleRepository(client), requests


class TestProtocolConformance:
    def test_local(self, db_session):
        assert isinstance(LocalRoleRepository(db_session), RoleRepository)

    def test_supabase(self):
        repo, _ = _supabase(lambda req: httpx.Response(200, json=[]))
        assert isinstance(repo, RoleRepository)


class TestSupabaseRoleRepository:
    def test_list_global_filters_null_project(self):
        repo, requests = _supabase(lambda req: httpx.Response(200, json=[_role_row()]))
        items = repo.list()
        assert [r.id for r in items] == ["role-linxia"]
        params = requests[0].url.params
        assert params["project_id"] == "is.null"
        assert params["order"] == "updated_at.desc"

    def test_list_with_project_includes_global(self):
        repo, requests = _supabase(lambda req: httpx.Response(200, json=[_role_row()]))
        repo.list(project_id="p1")
        assert requests[0].url.params["or"] == "(project_id.is.null,project_id.eq.p1)"

    def test_list_maps_row_to_role_out(self):
        repo, _ = _supabase(lambda req: httpx.Response(200, json=[_role_row()]))
        role = repo.list()[0]
        assert role.name == "林夏"
        assert role.voice["engine"] == "edge_tts"
        assert role.favorite_styles[0]["name"] == "低声"
        assert role.created_at and role.updated_at

    def test_create_posts_row(self):
        def handler(req: httpx.Request) -> httpx.Response:
            if req.method == "GET":
                return httpx.Response(200, json=[])  # 重复检查：不存在
            body = json.loads(req.content)
            assert body[0]["id"] == "role-linxia"
            assert body[0]["project_id"] is None
            return httpx.Response(201, json=[_role_row()])

        repo, _ = _supabase(handler)
        role = repo.create(_role_in())
        assert role.id == "role-linxia"
        assert role.created_at

    def test_create_normalizes_scratchpad_project(self):
        """前端 __scratchpad__ 占位符必须归一化为 NULL（对齐 local 行为）。"""
        seen = {}

        def handler(req: httpx.Request) -> httpx.Response:
            if req.method == "GET":
                return httpx.Response(200, json=[])
            seen["body"] = json.loads(req.content)
            return httpx.Response(201, json=[_role_row()])

        repo, _ = _supabase(handler)
        repo.create(_role_in(project_id="__scratchpad__"))
        assert seen["body"][0]["project_id"] is None

    def test_create_duplicate_raises_value_error(self):
        repo, _ = _supabase(lambda req: httpx.Response(200, json=[_role_row()]))
        with pytest.raises(ValueError, match="role_already_exists"):
            repo.create(_role_in())

    def test_update_patches_changed_fields_and_bumps_updated_at(self):
        seen = {}

        def handler(req: httpx.Request) -> httpx.Response:
            seen["body"] = json.loads(req.content)
            return httpx.Response(200, json=[_role_row(name="林夏新版")])

        repo, requests = _supabase(handler)
        role = repo.update("role-linxia", RoleUpdate(name="林夏新版"))
        assert requests[0].method == "PATCH"
        assert requests[0].url.params["id"] == "eq.role-linxia"
        assert seen["body"]["name"] == "林夏新版"
        assert seen["body"]["updated_at"]  # 对齐 local 的 onupdate 语义
        assert role.name == "林夏新版"

    def test_update_missing_returns_none(self):
        repo, _ = _supabase(lambda req: httpx.Response(200, json=[]))
        assert repo.update("missing", RoleUpdate(name="x")) is None

    def test_delete_returns_true_when_row_deleted(self):
        """删除前先清理 segments/project 引用（3B 补齐），最后 DELETE 角色行。"""

        def handler(req: httpx.Request) -> httpx.Response:
            if req.method == "DELETE":
                return httpx.Response(200, json=[{"id": "role-linxia"}])
            return httpx.Response(200, json=[])

        repo, requests = _supabase(handler)
        assert repo.delete("role-linxia") is True
        # 顺序：PATCH segments.role_id → PATCH projects.default_narrator_role_id
        # → GET segments(voice 扫描) → DELETE roles
        assert [r.method for r in requests] == ["PATCH", "PATCH", "GET", "DELETE"]
        assert requests[0].url.path.endswith("segmented_project_segments")
        assert requests[0].url.params["role_id"] == "eq.role-linxia"
        assert requests[1].url.path.endswith("segmented_projects")
        assert requests[1].url.params["default_narrator_role_id"] == "eq.role-linxia"
        assert requests[3].url.params["id"] == "eq.role-linxia"

    def test_delete_cleans_voice_json_references(self):
        """voice JSON 里 {"source": "role", "role_id": ...} 无 FK 可管，必须重置回 chapter。"""
        patched: list[tuple[str, dict]] = []

        def handler(req: httpx.Request) -> httpx.Response:
            if req.method == "GET" and req.url.path.endswith("segmented_project_segments"):
                return httpx.Response(200, json=[
                    {"id": "seg-1", "voice": {"source": "role", "role_id": "role-linxia"}},
                    {"id": "seg-2", "voice": {"source": "chapter"}},
                    {"id": "seg-3", "voice": {"source": "role", "role_id": "other-role"}},
                ])
            if req.method == "PATCH" and req.url.path.endswith("segmented_project_segments") \
                    and "role_id" not in req.url.params:
                patched.append((req.url.params["id"], json.loads(req.content)))
                return httpx.Response(200, json=[])
            if req.method == "DELETE":
                return httpx.Response(200, json=[{"id": "role-linxia"}])
            return httpx.Response(200, json=[])

        repo, _ = _supabase(handler)
        assert repo.delete("role-linxia") is True
        assert patched == [("eq.seg-1", {"voice": {"source": "chapter"}})]

    def test_delete_missing_returns_false(self):
        repo, _ = _supabase(lambda req: httpx.Response(200, json=[]))
        assert repo.delete("missing") is False


class TestLocalRoleRepository:
    def test_create_list_update_delete_round_trip(self, db_session):
        repo = LocalRoleRepository(db_session)
        created = repo.create(_role_in())
        assert created.id == "role-linxia"
        assert created.created_at and created.updated_at

        assert [r.id for r in repo.list()] == ["role-linxia"]

        updated = repo.update("role-linxia", RoleUpdate(name="林夏新版", role_kind="narrator"))
        assert updated.name == "林夏新版"
        assert updated.role_kind == "narrator"

        assert repo.delete("role-linxia") is True
        assert repo.list() == []

    def test_create_duplicate_raises_and_rolls_back(self, db_session):
        repo = LocalRoleRepository(db_session)
        repo.create(_role_in())
        with pytest.raises(ValueError, match="role_already_exists"):
            repo.create(_role_in())
        # rollback 后原记录仍在
        assert [r.id for r in repo.list()] == ["role-linxia"]

    def test_update_missing_returns_none(self, db_session):
        assert LocalRoleRepository(db_session).update("nope", RoleUpdate(name="x")) is None

    def test_delete_missing_returns_false(self, db_session):
        assert LocalRoleRepository(db_session).delete("nope") is False

    def test_list_project_filter(self, db_session):
        repo = LocalRoleRepository(db_session)
        repo.create(_role_in("r-global"))
        repo.create(_role_in("r-proj", project_id="p1", name="项目角色"))
        assert [r.id for r in repo.list()] == ["r-global"]
        assert sorted(r.id for r in repo.list(project_id="p1")) == ["r-global", "r-proj"]
