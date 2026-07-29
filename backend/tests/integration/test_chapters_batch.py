"""Integration test for the chapters:batch endpoint (used by split_segment node)."""
from app.core import config
from app.core import segmented_assets as assets
from app.models.segmented_project import SegmentedProject
from app.schemas.segmented_project import ProjectIn
from app.services.segmented_project_service import (
    create_chapter_for_project,
    create_segment_for_chapter,
    save_project,
)


def test_batch_create_chapters_and_segments(client, db_session):
    """Create a project, batch POST chapters, assert DB rows created."""
    save_project(db_session, ProjectIn(id="p-batch-1", name="t", layout="vertical"))
    db_session.commit()

    payload = {
        "chapters": [
            {
                "chapter_title": "Ch1",
                "segments": [
                    {"text": "seg one", "emotion": "neutral", "role": "narration", "segment_kind": "narration"},
                    {"text": "seg two", "emotion": "happy", "role": "narration", "segment_kind": "narration"},
                ],
            },
            {
                "chapter_title": "Ch2",
                "segments": [
                    {"text": "seg three", "emotion": "calm", "role": "narration", "segment_kind": "narration"},
                ],
            },
        ]
    }
    r = client.post(f"/api/segmented-projects/p-batch-1/chapters:batch", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["chapters"]) == 2
    assert data["chapters"][0]["id"]
    assert len(data["chapters"][0]["segments"]) == 2
    assert data["chapters"][1]["segments"][0]["id"]

    db_session.expire_all()
    proj = db_session.query(SegmentedProject).get("p-batch-1")
    assert len(proj.chapters) == 2
    assert len(proj.chapters[0].segments) == 2


def test_batch_replaces_existing_chapters(client, db_session):
    """Second batch POST replaces (not duplicates) existing chapters."""
    save_project(db_session, ProjectIn(id="p-batch-2", name="t2", layout="vertical"))
    create_chapter_for_project(db_session, "p-batch-2", "old", 0)
    db_session.commit()

    payload = {"chapters": [{"chapter_title": "new", "segments": [{"text": "x", "emotion": "neutral"}]}]}
    r = client.post(f"/api/segmented-projects/p-batch-2/chapters:batch", json=payload)
    assert r.status_code == 200

    db_session.expire_all()
    proj = db_session.query(SegmentedProject).get("p-batch-2")
    assert len(proj.chapters) == 1  # replaced
    assert proj.chapters[0].name == "new"


def test_batch_404_unknown_project(client, db_session):
    r = client.post("/api/segmented-projects/nope/chapters:batch", json={"chapters": []})
    assert r.status_code == 404


def test_batch_persists_narration_script(client, db_session):
    """narration_script in batch payload is persisted and readable via project detail."""
    save_project(db_session, ProjectIn(id="p-batch-ns", name="t", layout="vertical"))
    db_session.commit()

    payload = {
        "chapters": [
            {
                "chapter_title": "Ch1",
                "narration_script": "第一章旁白稿。",
                "segments": [{"text": "seg one"}],
            },
            {
                "chapter_title": "Ch2",
                "segments": [{"text": "seg two"}],
            },
        ]
    }
    r = client.post("/api/segmented-projects/p-batch-ns/chapters:batch", json=payload)
    assert r.status_code == 200, r.text

    detail = client.get("/api/segmented-projects/p-batch-ns")
    assert detail.status_code == 200, detail.text
    chapters = detail.json()["chapters"]
    assert chapters[0]["narration_script"] == "第一章旁白稿。"
    assert chapters[1]["narration_script"] is None

    db_session.expire_all()
    proj = db_session.query(SegmentedProject).get("p-batch-ns")
    assert proj.chapters[0].narration_script == "第一章旁白稿。"
    assert proj.chapters[1].narration_script is None


def test_batch_persists_project_narration_as_document_path(client, db_session):
    """Top-level narration_script is written to a file; DB stores only the path."""
    save_project(db_session, ProjectIn(id="p-batch-pns", name="t", layout="vertical"))
    db_session.commit()

    payload = {
        "chapters": [{"chapter_title": "Ch1", "segments": [{"text": "seg one"}]}],
        "narration_script": "# 完整旁白稿\n全文内容。",
    }
    r = client.post("/api/segmented-projects/p-batch-pns/chapters:batch", json=payload)
    assert r.status_code == 200, r.text

    db_session.expire_all()
    proj = db_session.query(SegmentedProject).get("p-batch-pns")
    assert proj.narration_document_path
    # 内容在文件里，detail 读穿返回内容
    from app.core.segmented_assets import read_project_document

    assert read_project_document(proj.narration_document_path) == "# 完整旁白稿\n全文内容。"
    detail = client.get("/api/segmented-projects/p-batch-pns")
    assert detail.json()["narration_script"] == "# 完整旁白稿\n全文内容。"
    assert detail.json()["narration_document_path"] == proj.narration_document_path

    # 不传 narration_script 的 batch 不覆盖已有路径
    r2 = client.post(
        "/api/segmented-projects/p-batch-pns/chapters:batch",
        json={"chapters": [{"chapter_title": "Ch2", "segments": []}]},
    )
    assert r2.status_code == 200, r2.text
    db_session.expire_all()
    proj2 = db_session.query(SegmentedProject).get("p-batch-pns")
    assert proj2.narration_document_path == proj.narration_document_path


def test_save_project_stores_source_document_as_path(client, db_session):
    """源文档内容写文件，DB 存路径，detail 读穿返回内容。"""
    save_project(
        db_session,
        ProjectIn(id="p-src-path", name="t", layout="vertical", source_document="# 源文档\n正文。"),
    )
    db_session.commit()

    proj = db_session.query(SegmentedProject).get("p-src-path")
    assert proj.source_document is None  # 内容不再写 TEXT 列
    assert proj.source_document_path
    detail = client.get("/api/segmented-projects/p-src-path")
    assert detail.json()["source_document"] == "# 源文档\n正文。"


def test_batch_chapter_engine_written_to_voice(client, db_session):
    """Per-chapter `engine` is persisted into chapter.voice JSON, preserving other keys."""
    save_project(db_session, ProjectIn(id="p-batch-eng", name="t", layout="vertical"))
    create_chapter_for_project(
        db_session, "p-batch-eng", "old", 0,
        voice={"engine": "edge_tts", "voice": "zh-CN-YunxiNeural", "rate": "+0%", "volume": "+0%"},
    )
    db_session.commit()

    payload = {
        "chapters": [
            {"chapter_title": "Ch1", "engine": "voxcpm", "segments": [{"text": "a"}]},
            {"chapter_title": "Ch2", "segments": [{"text": "b"}]},
        ]
    }
    r = client.post("/api/segmented-projects/p-batch-eng/chapters:batch", json=payload)
    assert r.status_code == 200, r.text

    db_session.expire_all()
    proj = db_session.query(SegmentedProject).get("p-batch-eng")
    voice1 = proj.chapters[0].voice or {}
    assert voice1["engine"] == "voxcpm"
    assert voice1["voice"] == "zh-CN-YunxiNeural"  # 其他键保留
    voice2 = proj.chapters[1].voice or {}
    assert voice2["engine"] == "edge_tts"  # 未传 engine 时保持默认


def test_batch_chapter_has_default_split_config(client, db_session):
    """Chapters created via batch get a usable split_config (delimiters + mode),
    not an empty {} - so the studio's rule-split settings don't crash on
    splitConfig.delimiters.includes."""
    save_project(db_session, ProjectIn(id="p-batch-sc", name="t", layout="vertical"))
    db_session.commit()

    payload = {"chapters": [{"chapter_title": "Ch1", "original_text": "内容。", "segments": []}]}
    r = client.post("/api/segmented-projects/p-batch-sc/chapters:batch", json=payload)
    assert r.status_code == 200, r.text

    detail = client.get("/api/segmented-projects/p-batch-sc")
    sc = detail.json()["chapters"][0]["split_config"]
    # 默认选中除“、”外的所有拆分选项
    assert sc.get("delimiters") == ["，", "。", "！", "？", "；"]
    assert sc.get("mode") in ("rule", "llm")


def test_project_logo_persists_across_save_and_get(client, db_session):
    """logo (A10) survives create + PUT + GET round-trip (previously frontend-only, dropped on save)."""
    save_project(db_session, ProjectIn(id="p-logo", name="t", layout="vertical", logo="data:image/png;base64,xxx"))
    db_session.commit()

    detail = client.get("/api/segmented-projects/p-logo")
    assert detail.status_code == 200, detail.text
    assert detail.json()["logo"] == "data:image/png;base64,xxx"

    # PUT (save_project) preserves + can update logo
    save_project(db_session, ProjectIn(id="p-logo", name="t", layout="vertical", logo="https://x/y.png"))
    db_session.commit()
    detail2 = client.get("/api/segmented-projects/p-logo")
    assert detail2.json()["logo"] == "https://x/y.png"


def test_batch_persists_chapter_original_text(client, db_session):
    """original_text in batch payload is persisted per chapter so the chapter card shows content."""
    save_project(db_session, ProjectIn(id="p-batch-ot", name="t", layout="vertical"))
    db_session.commit()

    payload = {
        "chapters": [
            {"chapter_title": "Ch1", "original_text": "第一章正文内容。", "narration_script": "第一章正文内容。"},
            {"chapter_title": "Ch2"},
        ]
    }
    r = client.post("/api/segmented-projects/p-batch-ot/chapters:batch", json=payload)
    assert r.status_code == 200, r.text

    detail = client.get("/api/segmented-projects/p-batch-ot")
    chapters = detail.json()["chapters"]
    assert chapters[0]["original_text"] == "第一章正文内容。"
    assert chapters[1]["original_text"] is None


def test_batch_deletes_existing_chapter_audio(client, db_session, tmp_path, monkeypatch):
    """Replacing chapters via batch deletes the old chapters' audio files from disk."""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, ProjectIn(id="p-batch-audio", name="t", layout="vertical"))
    ch = create_chapter_for_project(db_session, "p-batch-audio", "old", 0)
    seg = create_segment_for_chapter(db_session, ch.id, "旧段落。", 0)
    abs_path = assets.segment_audio_path("p-batch-audio", ch.id, project_name="t", segment_id=seg.id, fmt="mp3")
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_bytes(b"fake-audio")
    rel = abs_path.relative_to(tmp_path).as_posix()
    seg.audio = {"format": "mp3", "current": {"path": rel, "duration_sec": 0.4}}
    db_session.commit()
    assert abs_path.exists()

    payload = {"chapters": [{"chapter_title": "new", "segments": []}]}
    r = client.post("/api/segmented-projects/p-batch-audio/chapters:batch", json=payload)
    assert r.status_code == 200, r.text

    # 旧章节的音频文件已被清理（不是只删 DB 行）
    assert not abs_path.exists()
