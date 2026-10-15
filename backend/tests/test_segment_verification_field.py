"""segment.verification 字段持久化与 P20 迁移测试。

- 整量 PUT / patch / 项目详情 / 导入导出 全链路透传
- 迁移幂等（列已存在时跳过）
"""
from unittest.mock import patch

from app.core.database import _P20_TTS_VERIFY_ALTER_STMTS
from app.models.segmented_project import SegmentedProjectSegment
from app.schemas.segmented_project import ProjectIn, SegmentPatchIn
from app.services import segmented_project_service as svc


VERIFICATION = {
    "audio_key": "aud-1",
    "status": "mismatch",
    "baseline_text": "保温杯可以装热水",
    "asr_text": "保温杯可以装热水呢",
    "similarity": 0.93,
    "match": False,
    "diff": [{"op": "insert", "baseline": "", "asr": "呢"}],
    "engine": "funasr",
    "checked_at": "2026-10-15T00:00:00Z",
}


def _seed(db_session, tmp_path, monkeypatch, verification=None):
    from app.core import config

    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    segments = [{
        "id": "s1", "position": 0, "text": "你好",
        "voice": {"source": "chapter"},
    }]
    if verification is not None:
        segments[0]["verification"] = verification
    project = ProjectIn(
        id="vp1", name="T", schema_version=2,
        chapters=[{
            "id": "vc1", "position": 0, "name": "第一章",
            "voice": {"engine": "edge_tts", "voice_id": "v1"},
            "split_config": {"delimiters": ["。"], "mode": "rule"},
            "segments": segments,
        }],
    )
    svc.save_project(db_session, project)
    db_session.commit()


def test_verification_save_load_roundtrip(db_session, tmp_path, monkeypatch):
    _seed(db_session, tmp_path, monkeypatch, verification=VERIFICATION)

    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    assert seg.verification == VERIFICATION

    detail = svc.get_project_detail(db_session, "vp1")
    assert detail.chapters[0].segments[0].verification == VERIFICATION


def test_verification_absent_defaults_to_none(db_session, tmp_path, monkeypatch):
    _seed(db_session, tmp_path, monkeypatch)

    detail = svc.get_project_detail(db_session, "vp1")
    assert detail.chapters[0].segments[0].verification is None


def test_verification_preserved_when_payload_omits(db_session, tmp_path, monkeypatch):
    """整量 PUT 未携带 verification（陈旧 autosave）→ 保留 DB 现值不回退。"""
    _seed(db_session, tmp_path, monkeypatch, verification=VERIFICATION)

    fresh = ProjectIn(
        id="vp1", name="T", schema_version=2,
        chapters=[{
            "id": "vc1", "position": 0, "name": "第一章",
            "voice": {"engine": "edge_tts", "voice_id": "v1"},
            "split_config": {"delimiters": ["。"], "mode": "rule"},
            "segments": [{"id": "s1", "position": 0, "text": "你好改", "voice": {"source": "chapter"}}],
        }],
    )
    svc.save_project(db_session, fresh)
    db_session.commit()

    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    assert seg.verification == VERIFICATION
    assert seg.text == "你好改"


def test_verification_patch_tri_state(db_session, tmp_path, monkeypatch):
    _seed(db_session, tmp_path, monkeypatch)

    # 写入
    out = svc.patch_segment(db_session, "vp1", "vc1", "s1", SegmentPatchIn(verification=VERIFICATION))
    assert out[0].verification == VERIFICATION
    # 缺省 = 不动
    out = svc.patch_segment(db_session, "vp1", "vc1", "s1", SegmentPatchIn(text="改"))
    assert out[0].verification == VERIFICATION
    # 显式 null = 清空
    out = svc.patch_segment(db_session, "vp1", "vc1", "s1", SegmentPatchIn(verification=None))
    assert out[0].verification is None


def test_verification_in_export_import(db_session, tmp_path, monkeypatch):
    _seed(db_session, tmp_path, monkeypatch, verification=VERIFICATION)

    from app.services.project_export_service import export_project
    from app.services.project_import_service import import_project

    data, _filename = export_project(db_session, "vp1")
    detail = import_project(db_session, data)
    db_session.commit()

    seg = next(
        s
        for ch in detail.chapters
        for s in ch.segments
    )
    assert seg.verification == VERIFICATION


def test_p20_migration_idempotent(db_session):
    """P20 ALTER 语句：列已存在时跳过不报错。"""
    from sqlalchemy import inspect, text

    from app.core.database import _run_alter_or_skip

    existing = {c["name"] for c in inspect(db_session.bind).get_columns("segmented_project_segments")}
    if "verification" in existing:
        # create_all 已建列：再次执行应跳过（返回 False）且不抛异常
        assert _run_alter_or_skip(db_session.bind, _P20_TTS_VERIFY_ALTER_STMTS[0]) is False
    else:
        assert _run_alter_or_skip(db_session.bind, _P20_TTS_VERIFY_ALTER_STMTS[0]) is True
        db_session.commit()
        # 第二次执行：跳过
        assert _run_alter_or_skip(db_session.bind, _P20_TTS_VERIFY_ALTER_STMTS[0]) is False
        db_session.rollback()


def test_run_table_created_by_metadata(db_session):
    """segment_verification_runs 由 Base.metadata.create_all 自动建表（无需迁移）。"""
    from sqlalchemy import inspect

    tables = inspect(db_session.bind).get_table_names()
    assert "segment_verification_runs" in tables
