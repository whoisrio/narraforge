"""步骤 3B：workers 模式 segmented_projects 域端到端接线测试。

create_app("workers") + settings.deploy_target="workers" + 内存版 PostgREST，
验证：项目/章节/分段元数据全链路走 Supabase REST（不碰 SQLAlchemy / 本地 FS），
ffmpeg/本地文件系统依赖端点在 workers 模式未挂载（404）。
local 模式零回退由既有测试（test_segmented_projects_api 等）锁定。
"""
import pytest
from fastapi.testclient import TestClient

import main as main_module
from app.core.config import settings
from app.core.repositories import deps
from app.core.repositories.roles import SupabaseRoleRepository
from app.core.repositories.segmented_projects import SupabaseSegmentedProjectRepository
from app.core.repositories.source_documents import SupabaseSourceDocumentRepository
from app.core.repositories.usage import SupabaseUsageRepository
from tests.fixtures.postgrest_fake import make_fake_supabase_client


@pytest.fixture
def workers_client(monkeypatch):
    monkeypatch.setattr(settings, "deploy_target", "workers")
    # 本文件测仓储接线，不测 Access 头校验（见 tests/unit/test_workers_access_cors.py）
    monkeypatch.setattr(settings, "access_enforcement", False)
    client, store = make_fake_supabase_client()
    app = main_module.create_app("workers")
    app.dependency_overrides[deps.get_segmented_repo] = (
        lambda: SupabaseSegmentedProjectRepository(client)
    )
    app.dependency_overrides[deps.get_role_repo] = lambda: SupabaseRoleRepository(client)
    app.dependency_overrides[deps.get_source_document_repo] = (
        lambda: SupabaseSourceDocumentRepository(client)
    )
    app.dependency_overrides[deps.get_usage_repo] = lambda: SupabaseUsageRepository(client)
    with TestClient(app) as test_client:
        yield test_client, store
    app.dependency_overrides.clear()


def _segment(sid="seg-1", position=0, text="第一段。", **kw):
    return {"id": sid, "position": position, "text": text, **kw}


def _chapter(cid="ch-1", position=0, name="第一章", segments=None, **kw):
    return {
        "id": cid,
        "position": position,
        "name": name,
        "voice": {"engine": "edge_tts", "voice": "zh-CN-YunxiNeural"},
        "split_config": {"delimiters": ["，", "。"], "mode": "rule"},
        "segments": segments if segments is not None else [_segment()],
        **kw,
    }


def _project(pid="proj-1", name="测试项目", chapters=None):
    return {
        "id": pid,
        "name": name,
        "schema_version": 2,
        "layout": "vertical",
        "chapters": chapters if chapters is not None else [_chapter()],
    }


def _create_project(client, pid="proj-1", **kw):
    resp = client.post("/api/segmented-projects", json=_project(pid, **kw))
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestProjectCrud:
    def test_full_crud_chain(self, workers_client):
        client, store = workers_client
        created = _create_project(client)
        assert created["id"] == "proj-1"
        assert created["chapters"][0]["segments"][0]["text"] == "第一段。"

        # 重复创建 → 409
        conflict = client.post("/api/segmented-projects", json=_project())
        assert conflict.status_code == 409

        # PUT 全量保存：改名 + 改分段文本/情绪/音色
        payload = _project(name="改名项目")
        payload["chapters"][0]["segments"][0].update(
            {"text": "改过的第一段。", "emotion": "happy", "role_id": None,
             "voice": {"source": "chapter"}}
        )
        updated = client.put("/api/segmented-projects/proj-1", json=payload)
        assert updated.status_code == 200, updated.text

        got = client.get("/api/segmented-projects/proj-1")
        assert got.status_code == 200
        detail = got.json()
        assert detail["name"] == "改名项目"
        seg = detail["chapters"][0]["segments"][0]
        assert seg["text"] == "改过的第一段。"
        assert seg["emotion"] == "happy"
        assert seg["voice"] == {"source": "chapter"}

        # 列表摘要
        listed = client.get("/api/segmented-projects")
        assert listed.status_code == 200
        items = listed.json()["items"]
        assert [p["id"] for p in items] == ["proj-1"]
        assert items[0]["summary_stats"]["chapter_count"] == 1
        assert items[0]["summary_stats"]["segment_count"] == 1

        # 删除 → 级联清空三张表
        deleted = client.delete("/api/segmented-projects/proj-1")
        assert deleted.status_code == 204
        assert client.get("/api/segmented-projects/proj-1").status_code == 404
        assert store.tables["segmented_projects"] == []
        assert store.tables["segmented_project_chapters"] == []
        assert store.tables["segmented_project_segments"] == []

    def test_get_missing_404(self, workers_client):
        client, _ = workers_client
        assert client.get("/api/segmented-projects/nope").status_code == 404

    def test_text_transforms_round_trip(self, workers_client):
        """text_transforms 经 workers 仓储 POST → PUT → GET 透传（删旧插新不丢列）。"""
        client, _ = workers_client
        tt = {"applied_map_ids": ["pm_1"], "lowercase_latin": True}
        _create_project(client, chapters=[
            _chapter("ch-1", 0, "第一章", [_segment("seg-1", 0, "第一段。", text_transforms=tt)]),
        ])
        seg = client.get("/api/segmented-projects/proj-1").json()["chapters"][0]["segments"][0]
        assert seg["text_transforms"] == tt

        # PUT 全量保存（删旧插新）：payload 未携带该字段 → 保留旧值（对齐 svc 语义）
        payload = _project(chapters=[
            _chapter("ch-1", 0, "第一章", [_segment("seg-1", 0, "改过的第一段。")]),
        ])
        resp = client.put("/api/segmented-projects/proj-1", json=payload)
        assert resp.status_code == 200, resp.text
        seg = client.get("/api/segmented-projects/proj-1").json()["chapters"][0]["segments"][0]
        assert seg["text"] == "改过的第一段。"
        assert seg["text_transforms"] == tt

        # PUT 显式携带新值 → 覆盖
        new_tt = {"applied_map_ids": ["pm_2"], "lowercase_latin": False}
        payload["chapters"][0]["segments"][0]["text_transforms"] = new_tt
        resp = client.put("/api/segmented-projects/proj-1", json=payload)
        assert resp.status_code == 200, resp.text
        seg = client.get("/api/segmented-projects/proj-1").json()["chapters"][0]["segments"][0]
        assert seg["text_transforms"] == new_tt

    def test_delete_missing_404(self, workers_client):
        client, _ = workers_client
        assert client.delete("/api/segmented-projects/nope").status_code == 404

    def test_put_id_mismatch_400(self, workers_client):
        client, _ = workers_client
        resp = client.put("/api/segmented-projects/proj-1", json=_project(pid="proj-2"))
        assert resp.status_code == 400

    def test_chapter_segment_reorder_and_drop(self, workers_client):
        """全量保存语义：重排序 + 删除章节/分段。"""
        client, _ = workers_client
        _create_project(client, chapters=[
            _chapter("ch-a", 0, "A", [_segment("s-a1", 0, "甲。")]),
            _chapter("ch-b", 1, "B", [_segment("s-b1", 0, "乙。")]),
        ])
        # 交换顺序并删掉 ch-b
        payload = _project(chapters=[
            _chapter("ch-b", 0, "B", [_segment("s-b1", 0, "乙。")]),
            _chapter("ch-a", 1, "A", []),
        ])
        resp = client.put("/api/segmented-projects/proj-1", json=payload)
        assert resp.status_code == 200, resp.text
        detail = client.get("/api/segmented-projects/proj-1").json()
        assert [c["id"] for c in detail["chapters"]] == ["ch-b", "ch-a"]
        assert detail["chapters"][1]["segments"] == []

    def test_scratchpad_rejected(self, workers_client):
        client, _ = workers_client
        assert client.get("/api/segmented-projects/__scratchpad__").status_code == 403
        assert client.put(
            "/api/segmented-projects/__scratchpad__", json=_project(pid="__scratchpad__")
        ).status_code == 403
        assert client.delete("/api/segmented-projects/__scratchpad__").status_code == 403
        assert client.post(
            "/api/segmented-projects", json=_project(pid="__scratchpad__")
        ).status_code == 403


class TestAudioIdWrite:
    def test_segment_audio_id_round_trip(self, workers_client):
        """frontend 存储模式：音频在 IndexedDB，分段只存 audio_id 引用。"""
        client, _ = workers_client
        _create_project(client)
        payload = _project()
        payload["chapters"][0]["segments"][0]["audio"] = {
            "current": {"audio_id": "idb-abc123", "origin": "tts", "duration_sec": 1.5},
            "duration_sec": 1.5,
        }
        payload["chapters"][0]["segments"][0]["generated_params"] = {"engine": "edge_tts"}
        resp = client.put("/api/segmented-projects/proj-1", json=payload)
        assert resp.status_code == 200, resp.text

        seg = client.get("/api/segmented-projects/proj-1").json()["chapters"][0]["segments"][0]
        assert seg["audio"]["current"]["audio_id"] == "idb-abc123"
        assert seg["audio"]["current"]["duration_sec"] == 1.5
        assert seg["generated_params"] == {"engine": "edge_tts"}

        # 列表摘要把 audio_id 计入已生成
        stats = client.get("/api/segmented-projects").json()["items"][0]["summary_stats"]
        assert stats["generated_count"] == 1
        assert stats["duration_sec"] == 1.5


class TestChaptersBatch:
    def test_batch_creates_structure(self, workers_client):
        client, _ = workers_client
        _create_project(client)
        resp = client.post(
            "/api/segmented-projects/proj-1/chapters:batch",
            json={
                "chapters": [
                    {"chapter_title": "批次一", "narration_script": "第一句。第二句。",
                     "segments": [{"text": "第一句。"}, {"text": "第二句。"}]},
                    {"chapter_title": "批次二",
                     "segments": [{"text": "第三句。", "emotion": "sad"}]},
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert len(body["chapters"]) == 2
        assert [len(c["segments"]) for c in body["chapters"]] == [2, 1]

        detail = client.get("/api/segmented-projects/proj-1").json()
        # batch 是整体替换：原 _chapter("ch-1") 被删除
        assert [c["name"] for c in detail["chapters"]] == ["批次一", "批次二"]
        assert detail["chapters"][0]["narration_script"] == "第一句。第二句。"
        assert detail["chapters"][0]["voice"]["engine"] == "edge_tts"
        assert detail["chapters"][1]["segments"][0]["emotion"] == "sad"

        # mark_consistent：新结构三层基线一致
        ch_id = body["chapters"][0]["id"]
        status = client.get(f"/api/segmented-projects/proj-1/chapters/{ch_id}/sync-status")
        assert status.status_code == 200
        assert status.json() == {"l1_dirty": False, "l2_dirty": False, "l3_dirty": False}

    def test_batch_missing_project_404(self, workers_client):
        client, _ = workers_client
        resp = client.post("/api/segmented-projects/nope/chapters:batch", json={"chapters": []})
        assert resp.status_code == 404

    def test_batch_preserve_audio_reuses_identical_segment(self, workers_client):
        """workers 模式：重拆时文本未变的 segment 沿承 audio（audio_id 引用）/generated_params/emotion。"""
        client, _ = workers_client
        _create_project(client, chapters=[
            _chapter("ch-1", 0, "01. 介绍", [
                _segment("seg-1", 0, "不变的一段。", emotion="calm",
                         audio={"current": {"audio_id": "idb-1", "origin": "tts", "duration_sec": 1.0},
                                "duration_sec": 1.0},
                         generated_params={"engine": "edge_tts"}),
                _segment("seg-2", 1, "旧的一段。",
                         audio={"current": {"audio_id": "idb-2", "origin": "tts"}},
                         generated_params={"engine": "edge_tts"}),
            ], split_config={"delimiters": ["。"], "mode": "rule"}),
        ])
        resp = client.post(
            "/api/segmented-projects/proj-1/chapters:batch",
            json={
                "preserve_audio": True,
                "chapters": [
                    {"chapter_title": "02. 介绍",
                     "segments": [{"text": "不变的一段。"}, {"text": "新的一段。"}]},
                ],
            },
        )
        assert resp.status_code == 200, resp.text
        reuse = resp.json()["reuse"]
        assert reuse["chapters_matched"] == 1  # 序号平移（01.->02.）仍匹配
        assert reuse["segments_reused"] == 1
        assert reuse["segments_new"] == 1

        detail = client.get("/api/segmented-projects/proj-1").json()
        ch = detail["chapters"][0]
        assert ch["split_config"] == {"delimiters": ["。"], "mode": "rule"}  # 沿承旧章规则
        segs = ch["segments"]
        assert segs[0]["audio"]["current"]["audio_id"] == "idb-1"
        assert segs[0]["emotion"] == "calm"
        assert segs[0]["generated_params"] == {"engine": "edge_tts"}
        assert segs[1].get("audio") is None

    def test_batch_split_segments_uses_matched_chapter_delimiters(self, workers_client):
        """workers 模式 split_segments：按匹配章节的 split_config.delimiters 规则拆分。"""
        client, _ = workers_client
        _create_project(client, chapters=[
            _chapter("ch-1", 0, "01. 旧章", [],
                     split_config={"delimiters": ["。"], "mode": "rule"}),
        ])
        resp = client.post(
            "/api/segmented-projects/proj-1/chapters:batch",
            json={
                "split_segments": True,
                "chapters": [
                    {"chapter_title": "01. 旧章",
                     "narration_script": "甲甲甲甲甲，乙乙。丙丙丙丙，丁丁。"},
                ],
            },
        )
        assert resp.status_code == 200, resp.text

        detail = client.get("/api/segmented-projects/proj-1").json()
        ch = detail["chapters"][0]
        assert [s["text"] for s in ch["segments"]] == ["甲甲甲甲甲，乙乙。", "丙丙丙丙，丁丁。"]


class TestLayerSync:
    def _create_script_chapter(self, client):
        _create_project(client, chapters=[
            _chapter("ch-1", 0, "剧本章", [_segment("seg-old", 0, "旧分段。")],
                     narration_script="第一句话。第二句话。第三句话。"),
        ])

    def test_sync_status_missing_chapter_404(self, workers_client):
        client, _ = workers_client
        _create_project(client)
        assert client.get(
            "/api/segmented-projects/proj-1/chapters/nope/sync-status"
        ).status_code == 404

    def test_split_preview_and_replace(self, workers_client):
        client, _ = workers_client
        self._create_script_chapter(client)

        # preview_only：只返回切分结果，不动库
        preview = client.post(
            "/api/segmented-projects/proj-1/chapters/ch-1/split",
            json={"text": "第一句甲。第二句乙。", "mode": "rule", "replace_strategy": "preview_only"},
        )
        assert preview.status_code == 200, preview.text
        assert [i["text"] for i in preview.json()["items"]] == ["第一句甲。", "第二句乙。"]
        assert preview.json()["project"] is None
        segs = client.get("/api/segmented-projects/proj-1").json()["chapters"][0]["segments"]
        assert [s["id"] for s in segs] == ["seg-old"]

        # replace_chapter_segments：替换分段并重新基线
        replaced = client.post(
            "/api/segmented-projects/proj-1/chapters/ch-1/split",
            json={"text": "第一句话。第二句话。第三句话。", "mode": "rule",
                  "replace_strategy": "replace_chapter_segments"},
        )
        assert replaced.status_code == 200, replaced.text
        detail = replaced.json()["project"]
        assert [s["text"] for s in detail["chapters"][0]["segments"]] == [
            "第一句话。", "第二句话。", "第三句话。",
        ]
        status = client.get("/api/segmented-projects/proj-1/chapters/ch-1/sync-status")
        assert status.json() == {"l1_dirty": False, "l2_dirty": False, "l3_dirty": False}

    def test_split_missing_chapter_404(self, workers_client):
        client, _ = workers_client
        _create_project(client)
        resp = client.post(
            "/api/segmented-projects/proj-1/chapters/nope/split",
            json={"text": "甲。", "mode": "rule"},
        )
        assert resp.status_code == 404

    def test_split_invalid_mode_422(self, workers_client):
        client, _ = workers_client
        _create_project(client)
        resp = client.post(
            "/api/segmented-projects/proj-1/chapters/ch-1/split",
            json={"text": "甲。", "mode": "bogus"},
        )
        assert resp.status_code == 422

    def test_resplit_from_script(self, workers_client):
        client, _ = workers_client
        self._create_script_chapter(client)
        resp = client.post("/api/segmented-projects/proj-1/chapters/ch-1/resplit-from-script")
        assert resp.status_code == 200, resp.text
        segs = resp.json()["chapters"][0]["segments"]
        assert [s["text"] for s in segs] == ["第一句话。", "第二句话。", "第三句话。"]
        assert client.get(
            "/api/segmented-projects/proj-1/chapters/ch-1/sync-status"
        ).json()["l3_dirty"] is False

    def test_resplit_missing_chapter_404(self, workers_client):
        client, _ = workers_client
        _create_project(client)
        assert client.post(
            "/api/segmented-projects/proj-1/chapters/nope/resplit-from-script"
        ).status_code == 404

    def test_rewrite_script_from_segments(self, workers_client):
        """编辑分段文本（PUT 全量保存后 split_anchor 仍在）→ 回写 L2。"""
        client, _ = workers_client
        self._create_script_chapter(client)
        # 先 split 建立基线与 anchors
        client.post(
            "/api/segmented-projects/proj-1/chapters/ch-1/split",
            json={"text": "第一句话。第二句话。第三句话。", "mode": "rule",
                  "replace_strategy": "replace_chapter_segments"},
        )
        detail = client.get("/api/segmented-projects/proj-1").json()
        # 编辑第二段文本（经全量保存，验证 split_anchor 被保留）
        payload = _project(chapters=detail["chapters"])
        payload["chapters"][0]["segments"][1]["text"] = "改过的第二句话。"
        resp = client.put("/api/segmented-projects/proj-1", json=payload)
        assert resp.status_code == 200, resp.text

        rewritten = client.post(
            "/api/segmented-projects/proj-1/chapters/ch-1/rewrite-script-from-segments"
        )
        assert rewritten.status_code == 200, rewritten.text
        assert rewritten.json()["narration_script"] == "第一句话。改过的第二句话。第三句话。"
        ch = client.get("/api/segmented-projects/proj-1").json()["chapters"][0]
        assert ch["narration_script"] == "第一句话。改过的第二句话。第三句话。"

    def test_rewrite_conflict_409(self, workers_client):
        """L2 在 split 后被直接改动 → 回写冲突。"""
        client, _ = workers_client
        self._create_script_chapter(client)
        client.post(
            "/api/segmented-projects/proj-1/chapters/ch-1/split",
            json={"text": "第一句话。第二句话。第三句话。", "mode": "rule",
                  "replace_strategy": "replace_chapter_segments"},
        )
        # 直接改 L2（全量保存），l2 变脏
        detail = client.get("/api/segmented-projects/proj-1").json()
        payload = _project(chapters=detail["chapters"])
        payload["chapters"][0]["narration_script"] = "完全不同的剧本。"
        assert client.put("/api/segmented-projects/proj-1", json=payload).status_code == 200
        resp = client.post(
            "/api/segmented-projects/proj-1/chapters/ch-1/rewrite-script-from-segments"
        )
        assert resp.status_code == 409


class TestApplyAnimationSpec:
    def test_apply_merges_specs(self, workers_client):
        client, _ = workers_client
        _create_project(client)
        resp = client.post(
            "/api/segmented-projects/proj-1/apply-animation-spec",
            json={
                "theme": "dark-botanical",
                "segments": [
                    {"segment_id": "seg-1", "visual_concept": "数据流动", "mood": "calm"},
                    {"segment_id": "seg-ghost", "visual_concept": "不存在"},
                ],
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["theme_updated"] is True
        assert body["segments_updated"] == 1
        assert body["missing_segment_ids"] == ["seg-ghost"]

        detail = client.get("/api/segmented-projects/proj-1").json()
        assert detail["animation_theme"] == "dark-botanical"
        spec = detail["chapters"][0]["segments"][0]["animation_spec"]
        assert spec["visual_concept"] == "数据流动"
        assert spec["mood"] == "calm"
        assert spec["generated_at"]

    def test_apply_missing_project_404(self, workers_client):
        client, _ = workers_client
        resp = client.post(
            "/api/segmented-projects/nope/apply-animation-spec", json={"segments": []}
        )
        assert resp.status_code == 404


class TestRoleDeleteCleanup:
    def test_delete_role_cleans_segment_references(self, workers_client):
        client, store = workers_client
        _create_project(client)
        role = {
            "id": "role-1", "name": "林夏", "role_kind": "cast",
            "voice": {"engine": "edge_tts", "params": {}}, "favorite_styles": [],
            "project_id": "proj-1",
        }
        assert client.post("/api/roles", json=role).status_code == 201

        # 项目默认旁白 + 分段 role_id / voice.source=role 三处引用
        payload = _project()
        payload["default_narrator_role_id"] = "role-1"
        payload["chapters"][0]["segments"][0].update(
            {"role_id": "role-1", "voice": {"source": "role", "role_id": "role-1"}}
        )
        assert client.put("/api/segmented-projects/proj-1", json=payload).status_code == 200

        assert client.delete("/api/roles/role-1").status_code == 204

        detail = client.get("/api/segmented-projects/proj-1").json()
        assert detail["default_narrator_role_id"] is None
        seg = detail["chapters"][0]["segments"][0]
        assert seg["role_id"] is None
        assert seg["voice"] == {"source": "chapter"}


class TestSourcesProjectValidation:
    def test_paste_requires_existing_project(self, workers_client):
        client, _ = workers_client
        resp = client.post(
            "/api/projects/nope/sources/paste",
            json={"source_type": "paste", "title": "t", "pasted_text": "正文。"},
        )
        assert resp.status_code == 404

    def test_paste_after_project_created(self, workers_client):
        client, _ = workers_client
        _create_project(client, pid="proj-x", chapters=[])
        resp = client.post(
            "/api/projects/proj-x/sources/paste",
            json={"source_type": "paste", "title": "第一章", "pasted_text": "这是正文。"},
        )
        assert resp.status_code == 201, resp.text


class TestLocalOnlyEndpointsNotMounted:
    """ffmpeg / 本地 FS / 合成类端点在 workers 模式不挂载 → 404。"""

    def test_synthesis_and_file_endpoints_404(self, workers_client):
        client, _ = workers_client
        cases = [
            # synthesize/上传/读取音频已 worker 化（Supabase Storage），见下测试
            ("get", "/api/segmented-projects/p/chapters/c/export-audio", {}),
            ("post", "/api/segmented-projects/p/export-all-chapters", {}),
            ("post", "/api/segmented-projects/p/chapters/c/adjust-audio", {"json": {}}),
            ("post", "/api/segmented-projects/migrate", {"json": {"projects": []}}),
            ("get", "/api/segmented-projects/p/export", {}),
            ("post", "/api/segmented-projects/import", {}),
            ("post", "/api/segmented-projects/p/export-text-file-to-remotion",
             {"json": {"filename": "a.txt", "content": "x"}}),
            ("post", "/api/segmented-projects/p/scaffold-remotion", {"json": {}}),
        ]
        for method, url, kwargs in cases:
            resp = getattr(client, method)(url, **kwargs)
            # 未挂载：路径完全无匹配 → 404；路径匹配到元数据路由但方法不允许 → 405
            assert resp.status_code in (404, 405), (
                f"{method.upper()} {url} -> {resp.status_code}"
            )

    def test_audio_endpoints_mounted_in_workers(self, workers_client, monkeypatch):
        """合成/上传/读取音频端点已 worker 化：注入 mock asset store 后，
        端点走 workers 分支（fake repo 无项目 → 业务 404），不再因
        Storage 未配置抛 RuntimeError。挂载本身由 test_app_factory 锁。"""
        from unittest.mock import AsyncMock, MagicMock

        from app.core.asset_store import get_asset_store

        client, _ = workers_client
        mock_store = MagicMock()
        mock_store.put = AsyncMock(return_value="k")
        mock_store.get = AsyncMock(return_value=None)
        client.app.dependency_overrides[get_asset_store] = lambda: mock_store
        try:
            # synthesize/读取：fake repo 无项目 → 业务 404
            resp = client.post(
                "/api/segmented-projects/p/chapters/c/segments/s/synthesize", json={})
            assert resp.status_code == 404
            resp = client.get("/api/segmented-projects/p/audio/c/s")
            assert resp.status_code == 404
            # upload：缺 file 参数 → 422（端点已挂载并进入参数校验）
            resp = client.post("/api/segmented-projects/p/chapters/c/segments/s/audio")
            assert resp.status_code in (404, 422)
        finally:
            client.app.dependency_overrides.clear()


class TestChaptersBatchPreservePlan:
    """workers 模式共享 plan_batch_reuse：A2 自动拆分 / 全局兜底 / dry_run / 边界识别。"""

    def test_batch_dry_run_has_no_side_effects(self, workers_client):
        client, _ = workers_client
        _create_project(client, chapters=[
            _chapter("ch-1", 0, "01. 章", [
                _segment("seg-1", 0, "不变的一段。",
                         audio={"current": {"audio_id": "idb-1", "origin": "tts"}},
                         generated_params={"engine": "edge_tts"}),
                _segment("seg-2", 1, "将被丢弃的录音。",
                         audio={"current": {"audio_id": "idb-2", "origin": "recorded"}}),
            ]),
        ])
        resp = client.post(
            "/api/segmented-projects/proj-1/chapters:batch",
            json={
                "dry_run": True,
                "preserve_audio": True,
                "split_segments": True,
                "chapters": [
                    {"chapter_title": "01. 章", "narration_script": "不变的一段。新的一段。"},
                ],
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["chapters"] == []
        reuse = body["reuse"]
        assert reuse["segments_reused"] == 1
        assert reuse["discard"]["text_changed"] == 1
        assert reuse["recorded_discard"] == 1

        # 零副作用：原结构原样保留
        detail = client.get("/api/segmented-projects/proj-1").json()
        assert detail["chapters"][0]["id"] == "ch-1"
        assert [s["id"] for s in detail["chapters"][0]["segments"]] == ["seg-1", "seg-2"]

    def test_batch_preserve_audio_auto_splits_matched_chapter(self, workers_client):
        """A2：preserve_audio + 无 payload segments + 命中含旧段的快照 -> 自动 rule_split。"""
        client, _ = workers_client
        _create_project(client, chapters=[
            _chapter("ch-1", 0, "01. 介绍", [
                _segment("seg-1", 0, "文本完全不变。",
                         audio={"current": {"audio_id": "idb-1", "origin": "tts"}},
                         generated_params={"engine": "edge_tts"}),
            ]),
        ])
        resp = client.post(
            "/api/segmented-projects/proj-1/chapters:batch",
            json={
                "preserve_audio": True,
                "split_segments": False,
                "chapters": [
                    {"chapter_title": "01. 介绍", "narration_script": "文本完全不变。"},
                ],
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["reuse"]["segments_reused"] == 1

        detail = client.get("/api/segmented-projects/proj-1").json()
        segs = detail["chapters"][0]["segments"]
        assert [s["text"] for s in segs] == ["文本完全不变。"]
        assert segs[0]["audio"]["current"]["audio_id"] == "idb-1"

    def test_batch_chapter_restructure_global_fallback(self, workers_client):
        """S3：章节重组（新标题）但文本未动 -> 全局兜底沿承 audio。"""
        client, _ = workers_client
        _create_project(client, chapters=[
            _chapter("ch-1", 0, "01. 大章", [
                _segment("seg-1", 0, "前半段内容。",
                         audio={"current": {"audio_id": "idb-a", "origin": "tts"}}),
                _segment("seg-2", 1, "后半段内容。",
                         audio={"current": {"audio_id": "idb-b", "origin": "tts"}}),
            ]),
        ])
        resp = client.post(
            "/api/segmented-projects/proj-1/chapters:batch",
            json={
                "preserve_audio": True,
                "split_segments": True,
                "chapters": [
                    {"chapter_title": "01. 大章(上)", "narration_script": "前半段内容。"},
                    {"chapter_title": "02. 大章(下)", "narration_script": "后半段内容。"},
                ],
            },
        )
        assert resp.status_code == 200, resp.text
        reuse = resp.json()["reuse"]
        assert reuse["chapters_matched"] == 0
        assert reuse["segments_reused"] == 2

        detail = client.get("/api/segmented-projects/proj-1").json()
        assert detail["chapters"][0]["segments"][0]["audio"]["current"]["audio_id"] == "idb-a"
        assert detail["chapters"][1]["segments"][0]["audio"]["current"]["audio_id"] == "idb-b"

    def test_batch_boundary_change_reported(self, workers_client):
        """S2：新文本 == 同一旧章内连续多段连接 -> boundary_changed 如实上报，不复用。"""
        client, _ = workers_client
        _create_project(client, chapters=[
            _chapter("ch-1", 0, "01. 章", [
                _segment("seg-1", 0, "这是一句很长的话，",
                         audio={"current": {"audio_id": "idb-a", "origin": "tts"}}),
                _segment("seg-2", 1, "后面还有半句。",
                         audio={"current": {"audio_id": "idb-b", "origin": "tts"}}),
            ]),
        ])
        resp = client.post(
            "/api/segmented-projects/proj-1/chapters:batch",
            json={
                "preserve_audio": True,
                "chapters": [
                    {"chapter_title": "01. 章",
                     "segments": [{"text": "这是一句很长的话，后面还有半句。"}]},
                ],
            },
        )
        assert resp.status_code == 200, resp.text
        reuse = resp.json()["reuse"]
        assert reuse["segments_reused"] == 0
        assert reuse["discard"]["boundary_changed"] == 1

        detail = client.get("/api/segmented-projects/proj-1").json()
        assert detail["chapters"][0]["segments"][0].get("audio") is None
