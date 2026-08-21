"""count_chapters（free 用户章节配额 Phase 2）：Local / Supabase 双实现 + Protocol 一致性。"""
import httpx

from app.core import config
from app.core.repositories.segmented_projects import (
    LocalSegmentedProjectRepository,
    SegmentedProjectRepository,
    SupabaseSegmentedProjectRepository,
)
from app.core.supabase_client import SupabaseClient
from app.schemas.segmented_project import ProjectIn


def _project_in(pid: str = "p1", n_chapters: int = 2) -> ProjectIn:
    return ProjectIn(
        id=pid,
        name="测试",
        schema_version=2,
        chapters=[
            {"id": f"{pid}-c{i}", "position": i, "name": f"第{i}章", "segments": []}
            for i in range(n_chapters)
        ],
    )


def _supabase(handler) -> tuple[SupabaseSegmentedProjectRepository, list[httpx.Request]]:
    requests: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    client = SupabaseClient(
        "https://test.supabase.co", "k", transport=httpx.MockTransport(_handler)
    )
    return SupabaseSegmentedProjectRepository(client), requests


class TestProtocolConformance:
    def test_local(self, db_session):
        assert isinstance(
            LocalSegmentedProjectRepository(db_session), SegmentedProjectRepository
        )

    def test_supabase(self):
        repo, _ = _supabase(lambda req: httpx.Response(200, json=[]))
        assert isinstance(repo, SegmentedProjectRepository)


class TestCountChapters:
    def test_local_counts(self, db_session, tmp_path, monkeypatch):
        monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
        repo = LocalSegmentedProjectRepository(db_session)
        repo.save_project(_project_in("p1", 3))
        assert repo.count_chapters("p1") == 3

    def test_local_missing_project_is_zero(self, db_session):
        repo = LocalSegmentedProjectRepository(db_session)
        assert repo.count_chapters("missing") == 0

    def test_supabase_counts(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=[{"id": "c1"}, {"id": "c2"}, {"id": "c3"}])

        repo, requests = _supabase(handler)
        assert repo.count_chapters("p1") == 3
        url = str(requests[0].url)
        assert "segmented_project_chapters" in url
        assert "project_id=eq.p1" in url

    def test_supabase_missing_project_is_zero(self):
        repo, _ = _supabase(lambda req: httpx.Response(200, json=[]))
        assert repo.count_chapters("missing") == 0
