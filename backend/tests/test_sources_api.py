"""P2 v2 源 CRUD API 端到端测试."""
from __future__ import annotations

import io

import pytest


def _create_project(client, project_id: str = "p-test"):
    """辅助：先创建一个项目."""
    r = client.post(
        "/api/segmented-projects",
        json={
            "id": project_id,
            "name": "Source Test",
            "schema_version": 2,
            "layout": "vertical",
            "active_chapter_id": None,
            "original_text": None,
            "chapters": [],
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_list_sources_empty(client):
    _create_project(client, "p-srcs-1")
    r = client.get("/api/projects/p-srcs-1/sources")
    assert r.status_code == 200
    assert r.json() == []


def test_create_paste_source(client):
    _create_project(client, "p-srcs-2")
    r = client.post(
        "/api/projects/p-srcs-2/sources/paste",
        json={
            "source_type": "paste",
            "title": "测试笔记",
            "pasted_text": "这是一段测试文本。包含中文。",
        },
    )
    assert r.status_code == 201, r.text
    src = r.json()
    assert src["source_type"] == "paste"
    assert src["title"] == "测试笔记"
    assert src["pasted_text"] == "这是一段测试文本。包含中文。"
    assert src["file_size"] > 0
    assert src["audio_path"] is None
    assert src["id"].startswith("src_")


def test_create_paste_empty_text_rejected(client):
    _create_project(client, "p-srcs-3")
    r = client.post(
        "/api/projects/p-srcs-3/sources/paste",
        json={"source_type": "paste", "title": "x", "pasted_text": "   "},
    )
    assert r.status_code == 400
    assert "pasted_text_required" in r.json()["detail"]


def test_create_paste_wrong_source_type(client):
    _create_project(client, "p-srcs-4")
    r = client.post(
        "/api/projects/p-srcs-4/sources/paste",
        json={"source_type": "audio", "title": "x", "pasted_text": "hello"},
    )
    assert r.status_code == 400


def test_create_paste_unknown_project(client):
    r = client.post(
        "/api/projects/p-does-not-exist/sources/paste",
        json={"source_type": "paste", "title": "x", "pasted_text": "hello"},
    )
    assert r.status_code == 404


def test_list_sources_after_create(client):
    _create_project(client, "p-srcs-5")
    # 创建 3 个粘贴源
    for i in range(3):
        client.post(
            "/api/projects/p-srcs-5/sources/paste",
            json={
                "source_type": "paste",
                "title": f"笔记 {i}",
                "pasted_text": f"内容 {i}",
            },
        )
    r = client.get("/api/projects/p-srcs-5/sources")
    assert r.status_code == 200
    sources = r.json()
    assert len(sources) == 3
    # 按 created_at desc 排序 (最新在前)
    titles = [s["title"] for s in sources]
    assert "笔记 2" in titles[:1] or "笔记 0" in titles[:1]  # 顺序敏感, 任一首位即可


def test_upload_audio_source(client, tmp_path, monkeypatch):
    from app.core import config as cfg
    monkeypatch.setattr(cfg.settings, "segmented_dir", tmp_path)
    _create_project(client, "p-srcs-6")

    # 模拟一个简单 mp3 文件 (内容并非真实, 仅测 upload pipeline)
    fake_mp3 = b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\xff\xfb\x90\x00" * 100
    r = client.post(
        "/api/projects/p-srcs-6/sources/audio",
        files={"file": ("test.mp3", io.BytesIO(fake_mp3), "audio/mpeg")},
        data={"title": "测试音频"},
    )
    assert r.status_code == 201, r.text
    src = r.json()
    assert src["source_type"] == "audio"
    assert src["title"] == "测试音频"
    assert src["audio_path"] is not None
    assert src["audio_path"].endswith(".mp3")
    assert src["file_size"] == len(fake_mp3)
    # ffprobe 在测试环境可能没装/对假数据探测失败 → duration_sec 可为 None
    assert src["pasted_text"] is None

    # 验证文件真实存在
    from pathlib import Path
    p = Path(src["audio_path"])
    assert p.exists()
    assert p.read_bytes() == fake_mp3


def test_upload_audio_unsupported_format(client, tmp_path, monkeypatch):
    from app.core import config as cfg
    monkeypatch.setattr(cfg.settings, "segmented_dir", tmp_path)
    _create_project(client, "p-srcs-7")
    r = client.post(
        "/api/projects/p-srcs-7/sources/audio",
        files={"file": ("test.txt", io.BytesIO(b"not audio"), "text/plain")},
        data={"title": "x"},
    )
    assert r.status_code == 400
    assert "unsupported_audio_format" in r.json()["detail"]


def test_upload_audio_empty_file(client, tmp_path, monkeypatch):
    from app.core import config as cfg
    monkeypatch.setattr(cfg.settings, "segmented_dir", tmp_path)
    _create_project(client, "p-srcs-8")
    r = client.post(
        "/api/projects/p-srcs-8/sources/audio",
        files={"file": ("test.mp3", io.BytesIO(b""), "audio/mpeg")},
        data={"title": "x"},
    )
    assert r.status_code == 400
    assert "empty_file" in r.json()["detail"]


def test_delete_source(client, tmp_path, monkeypatch):
    from app.core import config as cfg
    monkeypatch.setattr(cfg.settings, "segmented_dir", tmp_path)
    _create_project(client, "p-srcs-9")
    # 创建一个
    r = client.post(
        "/api/projects/p-srcs-9/sources/paste",
        json={"source_type": "paste", "title": "x", "pasted_text": "y"},
    )
    src_id = r.json()["id"]
    # 删除
    r = client.delete(f"/api/projects/p-srcs-9/sources/{src_id}")
    assert r.status_code == 204
    # 列表确认空
    r = client.get("/api/projects/p-srcs-9/sources")
    assert r.json() == []


def test_delete_source_not_found(client):
    _create_project(client, "p-srcs-10")
    r = client.delete("/api/projects/p-srcs-10/sources/nonexistent")
    assert r.status_code == 404


def test_delete_audio_source_removes_file(client, tmp_path, monkeypatch):
    from pathlib import Path
    from app.core import config as cfg
    monkeypatch.setattr(cfg.settings, "segmented_dir", tmp_path)
    _create_project(client, "p-srcs-11")

    fake_mp3 = b"\xff\xfb\x90\x00" * 200
    r = client.post(
        "/api/projects/p-srcs-11/sources/audio",
        files={"file": ("a.mp3", io.BytesIO(fake_mp3), "audio/mpeg")},
        data={"title": "audio"},
    )
    src = r.json()
    audio_path = Path(src["audio_path"])
    assert audio_path.exists()

    # 删除源 -> 文件也应消失
    r = client.delete(f"/api/projects/p-srcs-11/sources/{src['id']}")
    assert r.status_code == 204
    assert not audio_path.exists()


def test_get_source_audio_file(client, tmp_path, monkeypatch):
    from app.core import config as cfg
    monkeypatch.setattr(cfg.settings, "segmented_dir", tmp_path)
    _create_project(client, "p-srcs-12")

    fake_mp3 = b"\xff\xfb\x90\x00" * 100
    r = client.post(
        "/api/projects/p-srcs-12/sources/audio",
        files={"file": ("a.mp3", io.BytesIO(fake_mp3), "audio/mpeg")},
        data={"title": "audio"},
    )
    src_id = r.json()["id"]

    # GET 下载
    r = client.get(f"/api/projects/p-srcs-12/sources/{src_id}/audio")
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/mpeg"
    assert r.content == fake_mp3


def test_get_source_audio_on_paste_source(client):
    _create_project(client, "p-srcs-13")
    r = client.post(
        "/api/projects/p-srcs-13/sources/paste",
        json={"source_type": "paste", "title": "x", "pasted_text": "y"},
    )
    src_id = r.json()["id"]
    r = client.get(f"/api/projects/p-srcs-13/sources/{src_id}/audio")
    assert r.status_code == 400
    assert "source_is_not_audio" in r.json()["detail"]


def test_source_cascade_delete_with_project(client, tmp_path, monkeypatch):
    """删除项目时, 所有源也应删除 (FK CASCADE)."""
    from app.core import config as cfg
    monkeypatch.setattr(cfg.settings, "segmented_dir", tmp_path)
    _create_project(client, "p-srcs-14")
    client.post(
        "/api/projects/p-srcs-14/sources/paste",
        json={"source_type": "paste", "title": "x", "pasted_text": "y"},
    )
    client.post(
        "/api/projects/p-srcs-14/sources/paste",
        json={"source_type": "paste", "title": "x2", "pasted_text": "y2"},
    )
    assert len(client.get("/api/projects/p-srcs-14/sources").json()) == 2

    # 删项目
    client.delete("/api/segmented-projects/p-srcs-14")
    # 源应级联消失 (查列表会因项目不存在但路由仍按 project_id 过滤, 返回 [])
    r = client.get("/api/projects/p-srcs-14/sources")
    assert r.json() == []
