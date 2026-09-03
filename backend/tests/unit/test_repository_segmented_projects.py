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


class TestSaveProjectOrphanDelete:
    """孤儿删除必须用 PostgREST 当前语法 not.in.，而非已废弃的 notin.

    老写法 notin.(...) 在新版 PostgREST 直接 400（failed to parse filter），
    导致保存接口返回 storage_error。此测试锁定请求 URL 形态，防止回退。
    """

    def test_orphan_delete_uses_not_in_not_notin(self):
        captured: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            captured.append(request)
            url = str(request.url)
            if "segmented_project_chapters" in url and request.method == "DELETE":
                return httpx.Response(200, json=[])
            if "segmented_project_segments" in url and request.method == "DELETE":
                return httpx.Response(200, json=[])
            if "segmented_projects" in url and request.method == "GET":
                return httpx.Response(200, json=[{"id": "p1", "name": "测试"}])
            return httpx.Response(200, json=[])

        repo = SupabaseSegmentedProjectRepository(
            SupabaseClient(
                "https://test.supabase.co", "k",
                transport=httpx.MockTransport(handler),
            )
        )
        project = ProjectIn(
            id="p1", name="测试", schema_version=2,
            chapters=[{
                "id": "p1-c1", "position": 0, "name": "第1章",
                "segments": [{"id": "p1-c1-s1", "position": 0, "text": "hi"}],
            }],
        )
        repo.save_project(project)

        chapter_delete = [
            r for r in captured
            if r.method == "DELETE" and "segmented_project_chapters" in str(r.url)
        ]
        assert chapter_delete, "应发出章节孤儿删除请求"
        chapter_url = str(chapter_delete[0].url)
        assert "not.in." in chapter_url, f"章节孤儿删除应使用 not.in.，实际: {chapter_url}"
        assert "notin." not in chapter_url, f"不应使用已废弃的 notin.，实际: {chapter_url}"

        seg_delete = [
            r for r in captured
            if r.method == "DELETE" and "segmented_project_segments" in str(r.url)
        ]
        assert seg_delete, "应发出段落孤儿删除请求"
        assert "not.in." in str(seg_delete[0].url), f"段落孤儿删除应使用 not.in.，实际: {str(seg_delete[0].url)}"
