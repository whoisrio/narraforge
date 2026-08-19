"""chapters:batch 的 preserve_audio / split_segments 集成测试。

场景：源文档小改后从文本库重新拆分章节（+segment），文本未变的 segment
应保留已合成音频；章节按标题（忽略前导序号）匹配，沿承 split_config/voice。

重拆保留修复（spec 2026-08-17 Part A）覆盖：
- S1 弹窗默认路径：preserve_audio + 无 payload segments -> 匹配章自动拆分重建（A2）；
- S2 边界不同：如实报告 boundary_changed，音频不复用不静默；
- S3 章节重组：全局兜底复用（A1）；
- dry_run 零副作用（A4）；文件事务安全（A5）：commit 失败补偿、GC 在 commit 后、
  audio.previous 随迁。
"""
from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

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


# ---------------------------------------------------------------------------
# S1 翻转：preserve_audio 默认路径（不带 segments、不勾 split_segments）
# 匹配章节自动 rule_split 重建，音频保留（A2）
# ---------------------------------------------------------------------------


def test_preserve_audio_auto_splits_matched_chapter(client, db_session, tmp_path, monkeypatch):
    """S1 修复：弹窗默认路径（无 segments、split_segments=False）重拆同一文档。

    匹配章节含旧 segment -> 按最终 split_config 自动 rule_split 重建，
    文本未变的 segment 保留音频；不再产出空章节 + 全删。
    """
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, ProjectIn(id="p-auto-1", name="t", layout="vertical"))
    ch = create_chapter_for_project(db_session, "p-auto-1", "01. 介绍", 0)
    seg = create_segment_for_chapter(db_session, ch.id, "文本完全不变。", 0)
    audio_path = _attach_audio("p-auto-1", "t", ch, seg, tmp_path)
    db_session.commit()

    payload = {
        "preserve_audio": True,
        "split_segments": False,  # 弹窗默认不勾
        "chapters": [
            {"chapter_title": "01. 介绍", "narration_script": "文本完全不变。",
             "original_text": "文本完全不变。"},
        ],
    }
    r = client.post("/api/segmented-projects/p-auto-1/chapters:batch", json=payload)
    assert r.status_code == 200, r.text
    reuse = r.json()["reuse"]
    assert reuse["segments_reused"] == 1
    assert reuse["discard"] == {"text_changed": 0, "boundary_changed": 0, "no_audio": 0}

    proj = _project(db_session, "p-auto-1")
    segs = proj.chapters[0].segments
    assert [s.text for s in segs] == ["文本完全不变。"]  # 自动拆分重建，不是空章节
    new_rel = segs[0].audio["current"]["path"]
    assert str(segs[0].id) in new_rel
    assert (tmp_path / new_rel).exists()
    assert not audio_path.exists()  # 已 move


def test_preserve_audio_no_auto_split_for_unmatched_chapter(client, db_session, tmp_path, monkeypatch):
    """A2 边界：未匹配（新标题）章节不自动拆分，保持原 split_segments 语义。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, ProjectIn(id="p-auto-2", name="t", layout="vertical"))
    ch = create_chapter_for_project(db_session, "p-auto-2", "01. 旧章", 0)
    create_segment_for_chapter(db_session, ch.id, "旧内容。", 0)
    db_session.commit()

    payload = {
        "preserve_audio": True,
        "split_segments": False,
        "chapters": [
            {"chapter_title": "02. 全新章", "narration_script": "甲。乙。"},
        ],
    }
    r = client.post("/api/segmented-projects/p-auto-2/chapters:batch", json=payload)
    assert r.status_code == 200, r.text

    proj = _project(db_session, "p-auto-2")
    assert proj.chapters[0].name == "02. 全新章"
    assert len(proj.chapters[0].segments) == 0  # 不自动拆分
    assert r.json()["reuse"]["chapters_matched"] == 0


# ---------------------------------------------------------------------------
# S2 翻转：边界不同 -> 如实报告 boundary_changed，音频不复用（诚实而非静默）
# ---------------------------------------------------------------------------


def test_boundary_change_reported_honestly(client, db_session, tmp_path, monkeypatch):
    """旧 segment 是细分边界，重拆 payload 带来合并段（边界变化方向：新文本 ==
    同一旧章内连续多段旧文本的连接）-> 0 复用 + boundary_changed 如实上报。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, ProjectIn(id="p-bound-1", name="t", layout="vertical"))
    ch = create_chapter_for_project(db_session, "p-bound-1", "01. 章", 0)
    s1 = create_segment_for_chapter(db_session, ch.id, "这是一句很长的话，", 0)
    s2 = create_segment_for_chapter(db_session, ch.id, "后面还有半句。", 1)
    p1 = _attach_audio("p-bound-1", "t", ch, s1, tmp_path, content=b"A")
    p2 = _attach_audio("p-bound-1", "t", ch, s2, tmp_path, content=b"B")
    db_session.commit()

    payload = {
        "preserve_audio": True,
        "chapters": [
            {"chapter_title": "01. 章",
             "segments": [{"text": "这是一句很长的话，后面还有半句。"}]},
        ],
    }
    r = client.post("/api/segmented-projects/p-bound-1/chapters:batch", json=payload)
    assert r.status_code == 200, r.text
    reuse = r.json()["reuse"]
    assert reuse["segments_reused"] == 0
    assert reuse["discard"]["boundary_changed"] == 1
    assert reuse["discard"]["text_changed"] == 0

    # 不复用的旧音频被 GC（dry_run 已如实预告）
    assert not p1.exists() and not p2.exists()
    proj = _project(db_session, "p-bound-1")
    assert proj.chapters[0].segments[0].audio is None


# ---------------------------------------------------------------------------
# S3 翻转：章节重组（文本逐字未动）-> 全局兜底复用
# ---------------------------------------------------------------------------


def test_chapter_restructure_global_fallback(client, db_session, tmp_path, monkeypatch):
    """S3 修复：文档中段加标题把一章拆成两章，segment 文本未动 -> 跨章兜底复用。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, ProjectIn(id="p-restr-1", name="t", layout="vertical"))
    ch = create_chapter_for_project(db_session, "p-restr-1", "01. 大章", 0)
    s1 = create_segment_for_chapter(db_session, ch.id, "前半段内容。", 0)
    s2 = create_segment_for_chapter(db_session, ch.id, "后半段内容。", 1)
    _attach_audio("p-restr-1", "t", ch, s1, tmp_path, content=b"A")
    _attach_audio("p-restr-1", "t", ch, s2, tmp_path, content=b"B")
    db_session.commit()

    payload = {
        "preserve_audio": True,
        "split_segments": True,
        "chapters": [
            {"chapter_title": "01. 大章(上)", "narration_script": "前半段内容。",
             "original_text": "前半段内容。"},
            {"chapter_title": "02. 大章(下)", "narration_script": "后半段内容。",
             "original_text": "后半段内容。"},
        ],
    }
    r = client.post("/api/segmented-projects/p-restr-1/chapters:batch", json=payload)
    assert r.status_code == 200, r.text
    reuse = r.json()["reuse"]
    assert reuse["chapters_matched"] == 0  # 标题都对不上
    assert reuse["segments_reused"] == 2   # 全局兜底复用
    assert reuse["recorded_discard"] == 0

    proj = _project(db_session, "p-restr-1")
    for new_ch in proj.chapters:
        seg = new_ch.segments[0]
        rel = seg.audio["current"]["path"]
        assert str(new_ch.id) in rel and str(seg.id) in rel
        assert (tmp_path / rel).exists()


# ---------------------------------------------------------------------------
# A4：dry_run 完整规划但零副作用
# ---------------------------------------------------------------------------


def test_dry_run_has_no_side_effects(client, db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, ProjectIn(id="p-dry-1", name="t", layout="vertical"))
    ch = create_chapter_for_project(db_session, "p-dry-1", "01. 章", 0)
    seg_keep = create_segment_for_chapter(db_session, ch.id, "不变的一段。", 0)
    seg_gone = create_segment_for_chapter(db_session, ch.id, "将被丢弃的录音。", 1)
    keep_path = _attach_audio("p-dry-1", "t", ch, seg_keep, tmp_path)
    gone_path = _attach_audio("p-dry-1", "t", ch, seg_gone, tmp_path, origin="recorded")
    old_ch_id, old_seg_ids = ch.id, {seg_keep.id, seg_gone.id}
    db_session.commit()
    doc_path_before = _project(db_session, "p-dry-1").narration_document_path

    payload = {
        "dry_run": True,
        "preserve_audio": True,
        "split_segments": True,
        "narration_script": "# 文档\n\n## 章\n不变的一段。新的一段。",
        "chapters": [
            {"chapter_title": "01. 章",
             "narration_script": "不变的一段。新的一段。"},
        ],
    }
    r = client.post("/api/segmented-projects/p-dry-1/chapters:batch", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["chapters"] == []  # dry_run 不分配 id
    reuse = body["reuse"]
    assert reuse["segments_reused"] == 1
    assert reuse["segments_new"] == 1
    assert reuse["discard"]["text_changed"] == 1
    assert reuse["recorded_discard"] == 1  # 录音丢弃特别警示

    # 零副作用：DB 行不变、文件不动、narration 文档不重写
    proj = _project(db_session, "p-dry-1")
    assert proj.chapters[0].id == old_ch_id
    assert {s.id for s in proj.chapters[0].segments} == old_seg_ids
    assert proj.narration_document_path == doc_path_before
    assert keep_path.exists() and gone_path.exists()


# ---------------------------------------------------------------------------
# A5：文件事务安全
# ---------------------------------------------------------------------------


def test_commit_failure_compensates_file_moves(client, db_session, tmp_path, monkeypatch):
    """commit 抛异常 -> 已搬走的文件搬回旧路径（反向补偿），未消费文件不被 GC。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, ProjectIn(id="p-txn-1", name="t", layout="vertical"))
    ch = create_chapter_for_project(db_session, "p-txn-1", "01. 章", 0)
    seg_keep = create_segment_for_chapter(db_session, ch.id, "不变的一段。", 0)
    seg_gone = create_segment_for_chapter(db_session, ch.id, "旧的一段。", 1)
    keep_path = _attach_audio("p-txn-1", "t", ch, seg_keep, tmp_path, content=b"keep")
    gone_path = _attach_audio("p-txn-1", "t", ch, seg_gone, tmp_path, content=b"gone")
    db_session.commit()

    class _Boom(Exception):
        pass

    def _boom_commit(self):
        raise _Boom()

    monkeypatch.setattr(Session, "commit", _boom_commit)
    payload = {
        "preserve_audio": True,
        "chapters": [
            {"chapter_title": "01. 章", "segments": [{"text": "不变的一段。"}, {"text": "新的一段。"}]},
        ],
    }
    with pytest.raises(_Boom):
        client.post("/api/segmented-projects/p-txn-1/chapters:batch", json=payload)

    # 反向补偿：复用段的文件回到旧路径；未消费段未被 GC
    assert keep_path.exists() and keep_path.read_bytes() == b"keep"
    assert gone_path.exists() and gone_path.read_bytes() == b"gone"


def test_previous_audio_follows_reuse_move(client, db_session, tmp_path, monkeypatch):
    """复用段的 audio.previous 随 current 一并搬到新段目录旁并更新引用（S4 修复）。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, ProjectIn(id="p-prev-1", name="t", layout="vertical"))
    ch = create_chapter_for_project(db_session, "p-prev-1", "01. 章", 0)
    seg = create_segment_for_chapter(db_session, ch.id, "带历史的段。", 0)
    cur_path = _attach_audio("p-prev-1", "t", ch, seg, tmp_path, content=b"cur")
    # 手工补一个 previous（合成历史）：同目录 .prev.mp3 命名惯例
    prev_abs = cur_path.with_name(f"{seg.id}.prev.mp3")
    prev_abs.write_bytes(b"prev")
    prev_rel = prev_abs.relative_to(tmp_path).as_posix()
    seg.audio["previous"] = {"path": prev_rel, "format": "mp3", "origin": "tts", "duration_sec": 0.4}
    db_session.commit()

    payload = {
        "preserve_audio": True,
        "chapters": [{"chapter_title": "01. 章", "segments": [{"text": "带历史的段。"}]}],
    }
    r = client.post("/api/segmented-projects/p-prev-1/chapters:batch", json=payload)
    assert r.status_code == 200, r.text
    assert r.json()["reuse"]["segments_reused"] == 1

    proj = _project(db_session, "p-prev-1")
    new_seg = proj.chapters[0].segments[0]
    new_cur = new_seg.audio["current"]["path"]
    new_prev = new_seg.audio["previous"]["path"]
    # current 与 previous 都搬到新 segment 目录旁，previous 用 .prev 命名惯例
    assert str(new_seg.id) in new_cur
    assert new_prev == new_cur.replace(f"{new_seg.id}.mp3", f"{new_seg.id}.prev.mp3")
    assert (tmp_path / new_cur).read_bytes() == b"cur"
    assert (tmp_path / new_prev).read_bytes() == b"prev"
    # 旧路径全部失效
    assert not cur_path.exists() and not prev_abs.exists()
