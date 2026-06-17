"""P2 v2 narration API 端到端测试 (P2 v2 概念 + v3 端点)."""
from __future__ import annotations


SAMPLE_BODY = """# DeepSeek 战略拆解

> 引言段落。

## 第 1 章 · 战略起源

2026 年开年，AI 产业进入深水区。DeepSeek 以极致成本训练出 R1 模型。

但真正的护城河，从来不是模型本身。

## 第 2 章 · 技术路线

先说 MLA。传统 Transformer 的 KV 缓存会随着序列长度线性增长。

再说 DualPath。DeepSeek 创新性地把训练和推理拆成两条路径。
"""

SAMPLE_SLICES = [
    {"chapter_index": 0, "title": "第 1 章 · 战略起源", "start_char": 0, "end_char": 80},
    {"chapter_index": 1, "title": "第 2 章 · 技术路线", "start_char": 80, "end_char": 200},
]


def _create_project_with_chapters(client, project_id: str = "p-narr-1"):
    """辅助: 创建项目 + 2 个 chapter."""
    client.post(
        "/api/segmented-projects",
        json={
            "id": project_id,
            "name": "Narration Test",
            "schema_version": 2,
            "layout": "vertical",
            "chapters": [
                {"id": "ch1", "position": 0, "name": "第 1 章 · 战略起源",
                 "default_params": {}, "split_config": {}},
                {"id": "ch2", "position": 1, "name": "第 2 章 · 技术路线",
                 "default_params": {}, "split_config": {}},
            ],
        },
    )


def test_list_narrations_empty(client):
    _create_project_with_chapters(client, "p-narr-2")
    r = client.get("/api/projects/p-narr-2/narrations")
    assert r.status_code == 200
    assert r.json() == []


def test_generate_narration_basic(client):
    _create_project_with_chapters(client, "p-narr-3")
    r = client.post(
        "/api/projects/p-narr-3/narrations/generate",
        json={
            "body_markdown": SAMPLE_BODY,
            "source_ids": ["s1", "s2"],
            "chapter_slices": SAMPLE_SLICES,
            "prompt_hint": "语气保持冷静",
            "settings": {"engine": "mimo"},
        },
    )
    assert r.status_code == 201, r.text
    n = r.json()
    assert n["version"] == "v1"
    assert n["version_kind"] == "full"
    assert n["body_markdown"] == SAMPLE_BODY
    assert n["word_count"] > 0  # 至少一些中文字
    assert n["prompt_hint"] == "语气保持冷静"
    assert n["source_ids"] == ["s1", "s2"]
    assert len(n["chapter_slices"]) == 2
    assert n["chapter_slices"][0]["title"] == "第 1 章 · 战略起源"


def test_generate_narration_v2(client):
    """第二次生成自动 v2."""
    _create_project_with_chapters(client, "p-narr-4")
    # 第一次
    r = client.post(
        "/api/projects/p-narr-4/narrations/generate",
        json={"body_markdown": SAMPLE_BODY, "chapter_slices": SAMPLE_SLICES},
    )
    assert r.json()["version"] == "v1"
    # 第二次
    r = client.post(
        "/api/projects/p-narr-4/narrations/generate",
        json={"body_markdown": SAMPLE_BODY, "chapter_slices": SAMPLE_SLICES},
    )
    assert r.json()["version"] == "v2"


def test_generate_narration_sets_active_version(client):
    _create_project_with_chapters(client, "p-narr-5")
    r = client.post(
        "/api/projects/p-narr-5/narrations/generate",
        json={"body_markdown": SAMPLE_BODY, "chapter_slices": SAMPLE_SLICES},
    )
    assert r.status_code == 201
    # GET project 应有 active_narration_version
    r = client.get("/api/segmented-projects/p-narr-5")
    assert r.json()["active_narration_version"] == "v1"


def test_generate_narration_backfills_chapters(client):
    _create_project_with_chapters(client, "p-narr-6")
    r = client.post(
        "/api/projects/p-narr-6/narrations/generate",
        json={"body_markdown": SAMPLE_BODY, "chapter_slices": SAMPLE_SLICES},
    )
    assert r.status_code == 201
    narr_id = r.json()["id"]
    # 章节应有 narration_* 字段
    r = client.get("/api/segmented-projects/p-narr-6")
    chapters = r.json()["chapters"]
    assert len(chapters) == 2
    for ch in chapters:
        assert ch["narration_document_id"] == narr_id
        assert ch["narration_version"] == "v1"
        assert ch["narration_slice_start"] is not None
        assert ch["narration_slice_end"] is not None


def test_generate_narration_fallback_h2_parse(client):
    """chapter_slices 缺时, 后端按 ## 自动切."""
    _create_project_with_chapters(client, "p-narr-7")
    r = client.post(
        "/api/projects/p-narr-7/narrations/generate",
        json={"body_markdown": SAMPLE_BODY},  # 不传 slices
    )
    assert r.status_code == 201
    chapters = r.json()["chapter_slices"]
    # SAMPLE_BODY 有 2 个 H2
    assert len(chapters) == 2
    assert "第 1 章" in chapters[0]["title"]
    assert "第 2 章" in chapters[1]["title"]


def test_generate_narration_explicit_version(client):
    _create_project_with_chapters(client, "p-narr-8")
    r = client.post(
        "/api/projects/p-narr-8/narrations/generate",
        json={
            "body_markdown": SAMPLE_BODY,
            "chapter_slices": SAMPLE_SLICES,
            "settings": {"version": "v5"},  # 显式指定
        },
    )
    assert r.json()["version"] == "v5"


def test_generate_narration_project_not_found(client):
    r = client.post(
        "/api/projects/p-nope/narrations/generate",
        json={"body_markdown": SAMPLE_BODY, "chapter_slices": SAMPLE_SLICES},
    )
    assert r.status_code == 404


def test_get_narration_by_version(client):
    _create_project_with_chapters(client, "p-narr-9")
    client.post(
        "/api/projects/p-narr-9/narrations/generate",
        json={"body_markdown": SAMPLE_BODY, "chapter_slices": SAMPLE_SLICES},
    )
    r = client.get("/api/projects/p-narr-9/narrations/v1")
    assert r.status_code == 200
    assert r.json()["version"] == "v1"


def test_get_narration_404(client):
    _create_project_with_chapters(client, "p-narr-10")
    r = client.get("/api/projects/p-narr-10/narrations/v99")
    assert r.status_code == 404


def test_list_narrations_after_multiple(client):
    _create_project_with_chapters(client, "p-narr-11")
    # 3 versions
    for i in range(3):
        client.post(
            "/api/projects/p-narr-11/narrations/generate",
            json={"body_markdown": SAMPLE_BODY, "chapter_slices": SAMPLE_SLICES},
        )
    r = client.get("/api/projects/p-narr-11/narrations")
    assert r.status_code == 200
    versions = [n["version"] for n in r.json()]
    assert versions == ["v3", "v2", "v1"]  # desc


def test_delete_narration(client):
    _create_project_with_chapters(client, "p-narr-12")
    client.post(
        "/api/projects/p-narr-12/narrations/generate",
        json={"body_markdown": SAMPLE_BODY, "chapter_slices": SAMPLE_SLICES},
    )
    r = client.delete("/api/projects/p-narr-12/narrations/v1")
    assert r.status_code == 204
    # 列表应空
    r = client.get("/api/projects/p-narr-12/narrations")
    assert r.json() == []


def test_delete_narration_clears_chapter_refs(client):
    _create_project_with_chapters(client, "p-narr-13")
    client.post(
        "/api/projects/p-narr-13/narrations/generate",
        json={"body_markdown": SAMPLE_BODY, "chapter_slices": SAMPLE_SLICES},
    )
    # chapter 有 narration_document_id
    r = client.get("/api/segmented-projects/p-narr-13")
    assert r.json()["chapters"][0]["narration_document_id"] is not None
    # 删 v1
    client.delete("/api/projects/p-narr-13/narrations/v1")
    # active_narration_version 清空, chapter.narration_* 也清
    r = client.get("/api/segmented-projects/p-narr-13")
    assert r.json()["active_narration_version"] is None
    for ch in r.json()["chapters"]:
        assert ch["narration_document_id"] is None
        assert ch["narration_slice_start"] is None
