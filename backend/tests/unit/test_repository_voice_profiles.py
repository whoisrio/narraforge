"""步骤 3A：VoiceProfile 仓储（Protocol + Local + Supabase）。

方法签名提取自 clone.py / tts.py / mimo_tts.py 的实际调用：
list / get / create / update / delete / find_by_description。
返回值统一为 voice_to_dict 形状（A5 契约：含 has_preview/has_source）。
"""
import json

import httpx
import pytest

from app.core.repositories.voice_profiles import (
    LocalVoiceProfileRepository,
    SupabaseVoiceProfileRepository,
    VoiceProfileRepository,
)

VOICE_FIELDS = {
    "id": "v1",
    "name": "测试音色",
    "description": "温柔女声",
    "avatar": None,
    "project_id": None,
    "voice": {"model": "mimo_tts", "voice_type": "clone"},
    "voice_params": {
        "mimo_tts": {
            "source_audio_path": "data/voices/profiles/x.mp3",
            "params": {"voice_id": "mimo_voiceclone"},
        }
    },
    "preview": {"preview_audio_path": "data/voices/previews/x.mp3"},
}


def _voice_row(**overrides) -> dict:
    row = dict(VOICE_FIELDS)
    row["created_at"] = "2026-08-10T01:00:00+00:00"
    row.update(overrides)
    return row


def _supabase(handler) -> tuple[SupabaseVoiceProfileRepository, list[httpx.Request]]:
    from app.core.supabase_client import SupabaseClient

    requests: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    client = SupabaseClient("https://test.supabase.co", "k", transport=httpx.MockTransport(_handler))
    return SupabaseVoiceProfileRepository(client), requests


def _assert_voice_dict_shape(d: dict):
    assert set(d.keys()) == {
        "id", "name", "description", "avatar", "project_id",
        "voice", "voice_params", "preview",
        "has_preview", "has_source", "created_at",
    }


class TestProtocolConformance:
    def test_local(self, db_session):
        assert isinstance(LocalVoiceProfileRepository(db_session), VoiceProfileRepository)

    def test_supabase(self):
        repo, _ = _supabase(lambda req: httpx.Response(200, json=[]))
        assert isinstance(repo, VoiceProfileRepository)


class TestSupabaseVoiceProfileRepository:
    def test_list_global(self):
        repo, requests = _supabase(lambda req: httpx.Response(200, json=[_voice_row()]))
        items = repo.list()
        assert [v["id"] for v in items] == ["v1"]
        params = requests[0].url.params
        assert params["project_id"] == "is.null"
        assert params["order"] == "created_at.desc"

    def test_list_with_project(self):
        repo, requests = _supabase(lambda req: httpx.Response(200, json=[_voice_row()]))
        repo.list(project_id="p1")
        assert requests[0].url.params["or"] == "(project_id.is.null,project_id.eq.p1)"

    def test_list_row_mapped_to_voice_dict_shape(self):
        repo, _ = _supabase(lambda req: httpx.Response(200, json=[_voice_row()]))
        d = repo.list()[0]
        _assert_voice_dict_shape(d)
        assert d["has_preview"] is True
        assert d["has_source"] is True
        assert d["voice"]["model"] == "mimo_tts"

    def test_get_hit(self):
        repo, requests = _supabase(lambda req: httpx.Response(200, json=[_voice_row()]))
        d = repo.get("v1")
        assert requests[0].url.params["id"] == "eq.v1"
        assert d["name"] == "测试音色"

    def test_get_miss_returns_none(self):
        repo, _ = _supabase(lambda req: httpx.Response(200, json=[]))
        assert repo.get("nope") is None

    def test_create_posts_fields(self):
        def handler(req: httpx.Request) -> httpx.Response:
            body = json.loads(req.content)
            assert body[0]["id"] == "v1"
            assert body[0]["voice"]["voice_type"] == "clone"
            return httpx.Response(201, json=[_voice_row()])

        repo, _ = _supabase(handler)
        d = repo.create(dict(VOICE_FIELDS))
        _assert_voice_dict_shape(d)

    def test_update_patches_fields(self):
        seen = {}

        def handler(req: httpx.Request) -> httpx.Response:
            seen["body"] = json.loads(req.content)
            return httpx.Response(200, json=[_voice_row(name="新名字")])

        repo, requests = _supabase(handler)
        d = repo.update("v1", {"name": "新名字"})
        assert requests[0].method == "PATCH"
        assert requests[0].url.params["id"] == "eq.v1"
        assert seen["body"] == {"name": "新名字"}
        assert d["name"] == "新名字"

    def test_update_missing_returns_none(self):
        repo, _ = _supabase(lambda req: httpx.Response(200, json=[]))
        assert repo.update("nope", {"name": "x"}) is None

    def test_delete(self):
        repo, requests = _supabase(lambda req: httpx.Response(200, json=[{"id": "v1"}]))
        assert repo.delete("v1") is True
        assert requests[0].method == "DELETE"

    def test_delete_missing(self):
        repo, _ = _supabase(lambda req: httpx.Response(200, json=[]))
        assert repo.delete("nope") is False

    def test_find_by_description_excludes_self(self):
        repo, requests = _supabase(lambda req: httpx.Response(200, json=[_voice_row(id="v2")]))
        d = repo.find_by_description("温柔女声", exclude_id="v1")
        params = requests[0].url.params
        assert params["description"] == "eq.温柔女声"
        assert params["id"] == "neq.v1"
        assert d["id"] == "v2"

    def test_find_by_description_no_duplicate(self):
        repo, _ = _supabase(lambda req: httpx.Response(200, json=[]))
        assert repo.find_by_description("x", exclude_id="v1") is None


class TestLocalVoiceProfileRepository:
    def test_create_get_list_round_trip(self, db_session):
        repo = LocalVoiceProfileRepository(db_session)
        created = repo.create(dict(VOICE_FIELDS))
        _assert_voice_dict_shape(created)
        assert created["created_at"]

        got = repo.get("v1")
        assert got["name"] == "测试音色"
        assert got["has_preview"] is True

        assert [v["id"] for v in repo.list()] == ["v1"]

    def test_list_project_filter(self, db_session):
        repo = LocalVoiceProfileRepository(db_session)
        repo.create(dict(VOICE_FIELDS))
        repo.create({**VOICE_FIELDS, "id": "v2", "project_id": "p1"})
        assert [v["id"] for v in repo.list()] == ["v1"]
        assert sorted(v["id"] for v in repo.list(project_id="p1")) == ["v1", "v2"]

    def test_update_mutates_json_fields(self, db_session):
        repo = LocalVoiceProfileRepository(db_session)
        repo.create(dict(VOICE_FIELDS))
        new_vp = {"mimo_tts": {"params": {"voice_id": "mimo_voiceclone", "prompt_text": "你好"}}}
        updated = repo.update("v1", {"voice_params": new_vp, "name": "新名字"})
        assert updated["name"] == "新名字"
        assert updated["voice_params"] == new_vp
        # 重新读取确认真正落库（防止 JSON 浅比较不标脏导致静默丢失）
        assert repo.get("v1")["voice_params"] == new_vp

    def test_update_missing_returns_none(self, db_session):
        assert LocalVoiceProfileRepository(db_session).update("nope", {"name": "x"}) is None

    def test_update_ignores_unknown_and_id_fields(self, db_session):
        repo = LocalVoiceProfileRepository(db_session)
        repo.create(dict(VOICE_FIELDS))
        updated = repo.update("v1", {"id": "hacked", "created_at": "x", "bogus": 1})
        assert updated["id"] == "v1"

    def test_delete(self, db_session):
        repo = LocalVoiceProfileRepository(db_session)
        repo.create(dict(VOICE_FIELDS))
        assert repo.delete("v1") is True
        assert repo.get("v1") is None
        assert repo.delete("v1") is False

    def test_find_by_description(self, db_session):
        repo = LocalVoiceProfileRepository(db_session)
        repo.create(dict(VOICE_FIELDS))
        repo.create({**VOICE_FIELDS, "id": "v2", "description": "另一个描述"})
        assert repo.find_by_description("另一个描述", exclude_id="v1")["id"] == "v2"
        assert repo.find_by_description("温柔女声", exclude_id="v1") is None
