"""步骤 3A：SourceDocument 仓储（Protocol + Local + Supabase）。

方法签名提取自 source_document_service + sources.py 路由：
list / get / create_paste / create_audio / delete。
Supabase 实现：paste 全链路；audio 源依赖 R2 资产存储（步骤 4），
本步 create_audio 抛 NotImplementedError。
"""
import json

import httpx
import pytest

from app.core.repositories.source_documents import (
    LocalSourceDocumentRepository,
    SourceDocumentRepository,
    SupabaseSourceDocumentRepository,
)


def _src_row(**overrides) -> dict:
    row = {
        "id": "src_abc123def456",
        "project_id": "p1",
        "source_type": "paste",
        "title": "第一章原文",
        "file_path": None,
        "pasted_text": "这是一个测试文本。",
        "audio_path": None,
        "file_size": 24,
        "duration_sec": None,
        "created_at": "2026-08-10T01:00:00+00:00",
    }
    row.update(overrides)
    return row


def _supabase(handler) -> tuple[SupabaseSourceDocumentRepository, list[httpx.Request]]:
    from app.core.supabase_client import SupabaseClient

    requests: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    client = SupabaseClient("https://test.supabase.co", "k", transport=httpx.MockTransport(_handler))
    return SupabaseSourceDocumentRepository(client), requests


def _make_project(db_session, project_id: str = "p1"):
    from app.models.segmented_project import SegmentedProject

    db_session.add(SegmentedProject(id=project_id, name="测试项目"))
    db_session.commit()


class TestProtocolConformance:
    def test_local(self, db_session):
        assert isinstance(LocalSourceDocumentRepository(db_session), SourceDocumentRepository)

    def test_supabase(self):
        repo, _ = _supabase(lambda req: httpx.Response(200, json=[]))
        assert isinstance(repo, SourceDocumentRepository)


class TestSupabaseSourceDocumentRepository:
    def test_list_filters_project_and_orders(self):
        repo, requests = _supabase(lambda req: httpx.Response(200, json=[_src_row()]))
        items = repo.list("p1")
        params = requests[0].url.params
        assert params["project_id"] == "eq.p1"
        assert params["order"] == "created_at.desc"
        assert items[0].id == "src_abc123def456"
        assert items[0].pasted_text == "这是一个测试文本。"
        assert items[0].created_at

    def test_get_filters_id_and_project(self):
        repo, requests = _supabase(lambda req: httpx.Response(200, json=[_src_row()]))
        src = repo.get("p1", "src_abc123def456")
        params = requests[0].url.params
        assert params["id"] == "eq.src_abc123def456"
        assert params["project_id"] == "eq.p1"
        assert src.source_type == "paste"

    def test_get_miss_returns_none(self):
        repo, _ = _supabase(lambda req: httpx.Response(200, json=[]))
        assert repo.get("p1", "nope") is None

    def test_create_paste_generates_id_and_defaults(self):
        seen = {}

        def handler(req: httpx.Request) -> httpx.Response:
            seen["body"] = json.loads(req.content)
            return httpx.Response(201, json=[_src_row(**seen["body"][0])])

        repo, _ = _supabase(handler)
        out = repo.create_paste("p1", title="", pasted_text="这是一个测试文本。")
        body = seen["body"][0]
        assert body["id"].startswith("src_")
        assert body["project_id"] == "p1"
        assert body["source_type"] == "paste"
        # title 为空时取正文前 30 字（对齐 local 行为）
        assert body["title"] == "这是一个测试文本。"
        assert body["file_size"] == len("这是一个测试文本。".encode("utf-8"))
        assert out.id == body["id"]

    def test_create_audio_not_implemented_until_r2(self):
        repo, _ = _supabase(lambda req: httpx.Response(200, json=[]))
        with pytest.raises(NotImplementedError):
            repo.create_audio("p1", title="a", audio_bytes=b"1234", suffix=".mp3")

    def test_delete(self):
        repo, requests = _supabase(lambda req: httpx.Response(200, json=[{"id": "src_abc123def456"}]))
        assert repo.delete("p1", "src_abc123def456") is True
        params = requests[0].url.params
        assert params["id"] == "eq.src_abc123def456"
        assert params["project_id"] == "eq.p1"

    def test_delete_missing(self):
        repo, _ = _supabase(lambda req: httpx.Response(200, json=[]))
        assert repo.delete("p1", "nope") is False


class TestLocalSourceDocumentRepository:
    def test_create_list_get_delete_round_trip(self, db_session):
        _make_project(db_session)
        repo = LocalSourceDocumentRepository(db_session)
        created = repo.create_paste("p1", title="", pasted_text="这是一个测试文本。")
        assert created.id.startswith("src_")
        assert created.title == "这是一个测试文本。"
        assert created.file_size == len("这是一个测试文本。".encode("utf-8"))

        assert [s.id for s in repo.list("p1")] == [created.id]
        assert repo.get("p1", created.id).pasted_text == "这是一个测试文本。"

        assert repo.delete("p1", created.id) is True
        assert repo.list("p1") == []

    def test_create_paste_missing_project_raises_lookup_error(self, db_session):
        repo = LocalSourceDocumentRepository(db_session)
        with pytest.raises(LookupError, match="project_not_found"):
            repo.create_paste("no-project", title="t", pasted_text="x")

    def test_delete_missing_returns_false(self, db_session):
        _make_project(db_session)
        assert LocalSourceDocumentRepository(db_session).delete("p1", "nope") is False
