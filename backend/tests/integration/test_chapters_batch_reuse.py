"""chapters:batch 的 preserve_audio / split_segments 集成测试。

场景：源文档小改后从文本库重新拆分章节（+segment），文本未变的 segment
应保留已合成音频；章节按标题（忽略前导序号）匹配，沿承 split_config/voice。
"""
from __future__ import annotations

from app.core import config
from app.core import segmented_assets as assets
from app.models.segmented_project import SegmentedProject
from app.schemas.segmented_project import ProjectIn
from app.services.segmented_project_service import (
    create_chapter_for_project,
    create_segment_for_chapter,
    save_project,
)


def _attach_audio(project_id, name, ch, seg, tmp_path, *, origin="tts", content=b"fake-audio"):
    """给 segment 造一个真实存在的音频文件并写入 audio/generated_params。"""
    abs_path = assets.segment_audio_path(
        project_id, ch.id, project_name=name, segment_id=seg.id, fmt="mp3"
    )
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_bytes(content)
    rel = abs_path.relative_to(tmp_path).as_posix()
    seg.audio = {
        "format": "mp3",
        "duration_sec": 0.4,
        "current": {"path": rel, "format": "mp3", "origin": origin, "duration_sec": 0.4},
    }
    seg.generated_params = {"engine": "edge_tts", "voice": "zh-CN-YunxiNeural"}
    return abs_path


def _project(db_session, project_id):
    db_session.expire_all()
    return db_session.query(SegmentedProject).get(project_id)


def test_preserve_audio_reuses_identical_segment(client, db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, ProjectIn(id="p-reuse-1", name="t", layout="vertical"))
    ch = create_chapter_for_project(db_session, "p-reuse-1", "01. 介绍", 0)
    seg_keep = create_segment_for_chapter(db_session, ch.id, "不变的一段。", 0, emotion="calm")
    seg_gone = create_segment_for_chapter(db_session, ch.id, "旧的一段。", 1)
    keep_path = _attach_audio("p-reuse-1", "t", ch, seg_keep, tmp_path)
    gone_path = _attach_audio("p-reuse-1", "t", ch, seg_gone, tmp_path)
    db_session.commit()

    payload = {
        "preserve_audio": True,
        "chapters": [
            {
                "chapter_title": "01. 介绍",
                "segments": [{"text": "不变的一段。"}, {"text": "新的一段。"}],
            }
        ],
    }
    r = client.post("/api/segmented-projects/p-reuse-1/chapters:batch", json=payload)
    assert r.status_code == 200, r.text
    reuse = r.json()["reuse"]
    assert reuse["segments_reused"] == 1
    assert reuse["segments_new"] == 1
    assert reuse["chapters_matched"] == 1

    proj = _project(db_session, "p-reuse-1")
    new_ch = proj.chapters[0]
    segs = new_ch.segments
    assert [s.text for s in segs] == ["不变的一段。", "新的一段。"]

    reused = segs[0]
    assert reused.audio is not None
    new_rel = reused.audio["current"]["path"]
    # 文件已 move 到新章节/新 segment 的规范路径
    assert str(new_ch.id) in new_rel and str(reused.id) in new_rel
    assert (tmp_path / new_rel).exists()
    assert reused.audio["current"]["origin"] == "tts"
    assert reused.generated_params == {"engine": "edge_tts", "voice": "zh-CN-YunxiNeural"}
    assert reused.emotion == "calm"  # payload 未给 emotion 时沿承旧值

    fresh = segs[1]
    assert fresh.audio is None
    assert fresh.generated_params is None

    # 旧路径文件：复用的已 move，未复用的已 GC
    assert not keep_path.exists()
    assert not gone_path.exists()


def test_preserve_audio_matches_title_ignoring_number_prefix(
    client, db_session, tmp_path, monkeypatch
):
    """中间插入章节导致序号平移（01. -> 02.）时仍能匹配，沿承 split_config/voice。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, ProjectIn(id="p-reuse-2", name="t", layout="vertical"))
    ch = create_chapter_for_project(db_session, "p-reuse-2", "01. 介绍", 0)
    ch.split_config = {"delimiters": ["。"], "mode": "rule"}
    ch.voice = {"engine": "voxcpm", "voice_id": "voice-x", "mode": "clone"}
    seg = create_segment_for_chapter(db_session, ch.id, "内容不变。", 0)
    _attach_audio("p-reuse-2", "t", ch, seg, tmp_path)
    db_session.commit()

    payload = {
        "preserve_audio": True,
        "chapters": [
            {"chapter_title": "01. 新增章节", "segments": [{"text": "全新。"}]},
            {"chapter_title": "02. 介绍", "segments": [{"text": "内容不变。"}]},
        ],
    }
    r = client.post("/api/segmented-projects/p-reuse-2/chapters:batch", json=payload)
    assert r.status_code == 200, r.text
    assert r.json()["reuse"]["segments_reused"] == 1

    proj = _project(db_session, "p-reuse-2")
    shifted = proj.chapters[1]
    assert shifted.name == "02. 介绍"
    assert shifted.split_config == {"delimiters": ["。"], "mode": "rule"}
    assert shifted.voice["engine"] == "voxcpm" and shifted.voice["voice_id"] == "voice-x"
    assert shifted.segments[0].audio is not None


def test_preserve_audio_duplicate_text_consumed_once(client, db_session, tmp_path, monkeypatch):
    """重复文本：每条旧 segment 只能被消费一次，多出的新 segment 按新建处理。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, ProjectIn(id="p-reuse-3", name="t", layout="vertical"))
    ch = create_chapter_for_project(db_session, "p-reuse-3", "01. 章", 0)
    s1 = create_segment_for_chapter(db_session, ch.id, "重复。", 0)
    s2 = create_segment_for_chapter(db_session, ch.id, "重复。", 1)
    _attach_audio("p-reuse-3", "t", ch, s1, tmp_path, content=b"audio-A")
    _attach_audio("p-reuse-3", "t", ch, s2, tmp_path, content=b"audio-B")
    db_session.commit()

    payload = {
        "preserve_audio": True,
        "chapters": [
            {"chapter_title": "01. 章", "segments": [{"text": "重复。"}] * 3},
        ],
    }
    r = client.post("/api/segmented-projects/p-reuse-3/chapters:batch", json=payload)
    assert r.status_code == 200, r.text
    reuse = r.json()["reuse"]
    assert reuse["segments_reused"] == 2
    assert reuse["segments_new"] == 1

    proj = _project(db_session, "p-reuse-3")
    segs = proj.chapters[0].segments
    reused_payloads = set()
    for s in segs[:2]:
        assert s.audio is not None
        reused_payloads.add((tmp_path / s.audio["current"]["path"]).read_bytes())
    assert reused_payloads == {b"audio-A", b"audio-B"}  # 两条旧音频各被用一次
    assert segs[2].audio is None


def test_preserve_audio_missing_file_not_reused(client, db_session, tmp_path, monkeypatch):
    """旧 audio 记录的磁盘文件缺失时不复用、不报错，按新 segment 处理。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, ProjectIn(id="p-reuse-4", name="t", layout="vertical"))
    ch = create_chapter_for_project(db_session, "p-reuse-4", "01. 章", 0)
    seg = create_segment_for_chapter(db_session, ch.id, "文本一样。", 0)
    seg.audio = {
        "format": "mp3",
        "current": {"path": "ghost/chapters/x/segments/y.mp3", "format": "mp3", "origin": "tts"},
    }
    db_session.commit()

    payload = {
        "preserve_audio": True,
        "chapters": [{"chapter_title": "01. 章", "segments": [{"text": "文本一样。"}]}],
    }
    r = client.post("/api/segmented-projects/p-reuse-4/chapters:batch", json=payload)
    assert r.status_code == 200, r.text
    assert r.json()["reuse"]["segments_reused"] == 0

    proj = _project(db_session, "p-reuse-4")
    assert proj.chapters[0].segments[0].audio is None


def test_preserve_audio_recorded_origin_reused(client, db_session, tmp_path, monkeypatch):
    """用户录音（origin=recorded）同样按文本一致保留。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, ProjectIn(id="p-reuse-5", name="t", layout="vertical"))
    ch = create_chapter_for_project(db_session, "p-reuse-5", "01. 章", 0)
    seg = create_segment_for_chapter(db_session, ch.id, "录音段。", 0)
    _attach_audio("p-reuse-5", "t", ch, seg, tmp_path, origin="recorded")
    db_session.commit()

    payload = {
        "preserve_audio": True,
        "chapters": [{"chapter_title": "01. 章", "segments": [{"text": "录音段。"}]}],
    }
    r = client.post("/api/segmented-projects/p-reuse-5/chapters:batch", json=payload)
    assert r.status_code == 200, r.text
    assert r.json()["reuse"]["segments_reused"] == 1

    proj = _project(db_session, "p-reuse-5")
    assert proj.chapters[0].segments[0].audio["current"]["origin"] == "recorded"


def test_split_segments_uses_matched_chapter_delimiters(client, db_session, tmp_path, monkeypatch):
    """split_segments=True：匹配章节用其 split_config.delimiters 拆分；新章节用默认分隔符。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, ProjectIn(id="p-split-1", name="t", layout="vertical"))
    ch = create_chapter_for_project(db_session, "p-split-1", "01. 旧章", 0)
    ch.split_config = {"delimiters": ["。"], "mode": "rule"}
    db_session.commit()

    payload = {
        "split_segments": True,
        "chapters": [
            {
                "chapter_title": "01. 旧章",
                "narration_script": "甲甲甲甲甲，乙乙。丙丙丙丙，丁丁。",
            },
            {
                "chapter_title": "02. 新章",
                "narration_script": "第一句话内容。第二句话内容。",
            },
        ],
    }
    r = client.post("/api/segmented-projects/p-split-1/chapters:batch", json=payload)
    assert r.status_code == 200, r.text

    proj = _project(db_session, "p-split-1")
    old_ch, new_ch = proj.chapters
    # 旧章 split_config 沿承，只按 "。" 切（逗号不切）
    assert old_ch.split_config == {"delimiters": ["。"], "mode": "rule"}
    assert [s.text for s in old_ch.segments] == ["甲甲甲甲甲，乙乙。", "丙丙丙丙，丁丁。"]
    # 新章用默认分隔符
    assert [s.text for s in new_ch.segments] == ["第一句话内容。", "第二句话内容。"]


def test_split_segments_payload_segments_win(client, db_session, tmp_path, monkeypatch):
    """payload 自带 segments 时 split_segments 不覆盖。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, ProjectIn(id="p-split-2", name="t", layout="vertical"))
    db_session.commit()

    payload = {
        "split_segments": True,
        "chapters": [
            {
                "chapter_title": "01. 章",
                "narration_script": "甲。乙。",
                "segments": [{"text": "手工段。"}],
            }
        ],
    }
    r = client.post("/api/segmented-projects/p-split-2/chapters:batch", json=payload)
    assert r.status_code == 200, r.text

    proj = _project(db_session, "p-split-2")
    assert [s.text for s in proj.chapters[0].segments] == ["手工段。"]


def test_preserve_audio_false_keeps_destructive_behavior(client, db_session, tmp_path, monkeypatch):
    """不传 preserve_audio：行为与现状一致——文本相同也不保留音频，旧文件删除。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, ProjectIn(id="p-reuse-6", name="t", layout="vertical"))
    ch = create_chapter_for_project(db_session, "p-reuse-6", "01. 章", 0)
    seg = create_segment_for_chapter(db_session, ch.id, "一样的文本。", 0)
    old_path = _attach_audio("p-reuse-6", "t", ch, seg, tmp_path)
    db_session.commit()

    payload = {"chapters": [{"chapter_title": "01. 章", "segments": [{"text": "一样的文本。"}]}]}
    r = client.post("/api/segmented-projects/p-reuse-6/chapters:batch", json=payload)
    assert r.status_code == 200, r.text

    proj = _project(db_session, "p-reuse-6")
    assert proj.chapters[0].segments[0].audio is None
    assert not old_path.exists()
