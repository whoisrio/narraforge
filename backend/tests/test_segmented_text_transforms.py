"""合成时文本变换（发音映射 + 大写转小写）持久化与合成管道测试。

- segment.text_transforms 的 save/load 往返（schema → ORM → 序列化）
- local synthesize_segment 的变换行为见 Task 4 追加的用例
"""
import json
from unittest.mock import patch

from app.models.segmented_project import SegmentedProjectSegment
from app.schemas.segmented_project import ProjectIn
from app.services import segmented_project_service as svc


def _seed(db_session, tmp_path, monkeypatch, *, seg_text="你好",
          configs=None, text_transforms=None):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    project = ProjectIn(
        id="p1", name="T", schema_version=2,
        configs=configs,
        chapters=[{
            "id": "c1", "position": 0, "name": "第一章",
            "voice": {"engine": "edge_tts", "voice_id": "v1"},
            "split_config": {"delimiters": ["。"], "mode": "rule"},
            "segments": [{
                "id": "s1", "position": 0, "text": seg_text,
                "voice": {"source": "chapter"},
                **({"text_transforms": text_transforms}
                   if text_transforms is not None else {}),
            }],
        }],
    )
    svc.save_project(db_session, project)
    db_session.commit()


def test_text_transforms_save_load_roundtrip(db_session, tmp_path, monkeypatch):
    tt = {"applied_map_ids": ["pm_x1"], "lowercase_latin": True}
    _seed(db_session, tmp_path, monkeypatch, text_transforms=tt)

    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    assert seg.text_transforms == tt

    detail = svc.get_project_detail(db_session, "p1")
    assert detail.chapters[0].segments[0].text_transforms == tt


def test_text_transforms_absent_defaults_to_none(db_session, tmp_path, monkeypatch):
    _seed(db_session, tmp_path, monkeypatch)
    detail = svc.get_project_detail(db_session, "p1")
    assert detail.chapters[0].segments[0].text_transforms is None
