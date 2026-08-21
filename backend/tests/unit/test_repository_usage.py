"""usage_events 仓储测试（Phase 3 用量计量）。

Local：SQLAlchemy（内存 SQLite，db_session fixture）；
Supabase：内存版 PostgREST（postgrest_fake），验证 user_id 归属标记与作用域过滤。
"""
import pytest

from app.core.repositories.usage import LocalUsageRepository, SupabaseUsageRepository
from tests.fixtures.postgrest_fake import make_fake_supabase_client


class TestLocalUsageRepository:
    def test_record_and_usage_for_project(self, db_session):
        repo = LocalUsageRepository(db_session)
        repo.record_event(kind="tts", chars=10, project_id="p1")
        repo.record_event(kind="tts", chars=5, project_id="p1")
        repo.record_event(
            kind="llm", chars=100, input_tokens=50, output_tokens=20, project_id="p1",
        )
        repo.record_event(kind="tts", chars=7, project_id="p2")

        u = repo.usage_for_project("p1")
        assert u == {
            "project_id": "p1",
            "tts_count": 2,
            "chars": 115,  # tts 文本 + llm 输入文本合计
            "input_tokens": 50,
            "output_tokens": 20,
        }

    def test_usage_for_project_empty(self, db_session):
        repo = LocalUsageRepository(db_session)
        assert repo.usage_for_project("nope") == {
            "project_id": "nope",
            "tts_count": 0,
            "chars": 0,
            "input_tokens": 0,
            "output_tokens": 0,
        }

    def test_usage_for_user_groups_by_project_with_none_bucket(self, db_session):
        repo = LocalUsageRepository(db_session)
        repo.record_event(kind="tts", chars=10, project_id="p1")
        repo.record_event(kind="llm", chars=3, input_tokens=2, output_tokens=1, project_id=None)
        repo.record_event(kind="tts", chars=4, project_id="p2")

        buckets = {b["project_id"]: b for b in repo.usage_for_user()}
        assert set(buckets) == {"p1", "p2", None}
        assert buckets["p1"] == {
            "project_id": "p1", "tts_count": 1, "chars": 10,
            "input_tokens": 0, "output_tokens": 0,
        }
        assert buckets[None] == {
            "project_id": None, "tts_count": 0, "chars": 3,
            "input_tokens": 2, "output_tokens": 1,
        }
        assert buckets["p2"]["tts_count"] == 1

    def test_record_event_is_best_effort(self, db_session, monkeypatch):
        """写入失败不抛出，只记日志；仓储随后仍可用（会话已恢复）。

        用 mock 让 commit 抛错（而非真实 NOT NULL 冲突）：真实失败会破坏
        测试的 join-transaction 隔离（失败 commit 使后续 commit 穿透外层
        事务），mock 失败则保持会话干净。
        """
        from unittest.mock import Mock

        repo = LocalUsageRepository(db_session)
        monkeypatch.setattr(
            db_session, "commit", Mock(side_effect=RuntimeError("boom"))
        )
        repo.record_event(kind="tts", chars=1)  # 不应 raise
        monkeypatch.undo()
        # 仓储仍可用（会话已 rollback 恢复）
        repo.record_event(kind="tts", chars=2, project_id="p1")
        assert repo.usage_for_project("p1")["chars"] == 2


class TestSupabaseUsageRepository:
    def test_record_stamps_user_id(self):
        client, store = make_fake_supabase_client()
        repo = SupabaseUsageRepository(client, owner_id="u1")
        repo.record_event(kind="tts", chars=10, project_id="p1", estimated=False)

        row = store.tables["usage_events"][0]
        assert row["user_id"] == "u1"
        assert row["kind"] == "tts"
        assert row["chars"] == 10

    def test_scoped_aggregation_excludes_other_users(self):
        client, store = make_fake_supabase_client()
        repo = SupabaseUsageRepository(client, owner_id="u1")
        repo.record_event(kind="tts", chars=10, project_id="p1")
        store.tables["usage_events"].append({
            "id": "x", "user_id": "u2", "project_id": "p1", "kind": "tts",
            "chars": 999, "input_tokens": 0, "output_tokens": 0, "estimated": False,
        })

        u = repo.usage_for_project("p1")
        assert u["chars"] == 10
        assert u["tts_count"] == 1

        buckets = {b["project_id"]: b for b in repo.usage_for_user()}
        assert buckets["p1"]["chars"] == 10

    def test_usage_for_user_includes_none_bucket(self):
        client, store = make_fake_supabase_client()
        repo = SupabaseUsageRepository(client, owner_id="u1")
        repo.record_event(kind="llm", chars=5, input_tokens=3, output_tokens=2, project_id=None)

        buckets = {b["project_id"]: b for b in repo.usage_for_user()}
        assert buckets[None] == {
            "project_id": None, "tts_count": 0, "chars": 5,
            "input_tokens": 3, "output_tokens": 2,
        }
