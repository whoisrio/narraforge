"""合成时文本变换（发音映射 + 大写转小写）持久化与合成管道测试。

- segment.text_transforms 的 save/load 往返（schema → ORM → 序列化）
- local synthesize_segment 的变换行为见 Task 4 追加的用例
"""
import json
from unittest.mock import patch

from app.core.system_config_service import PRONUNCIATION_MAP_GLOBAL_KEY, set_config
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


def test_text_transforms_preserved_when_payload_omits(db_session, tmp_path, monkeypatch):
    """payload 不带 text_transforms 时保留 DB 现值（与 generated_params 同语义）。"""
    tt = {"applied_map_ids": ["pm_x1"], "lowercase_latin": True}
    _seed(db_session, tmp_path, monkeypatch, text_transforms=tt)

    # 再保存一次：payload 不含 text_transforms
    detail = svc.get_project_detail(db_session, "p1")
    payload = ProjectIn(**detail.model_dump())
    payload.chapters[0].segments[0].text_transforms = None
    svc.save_project(db_session, payload)

    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    assert seg.text_transforms == tt


def _capture_synth_text(db_session, tmp_path, monkeypatch, *, seg_text,
                        configs=None, text_transforms=None, global_map=None):
    """seed + patch 引擎，返回实际送给引擎的文本。"""
    _seed(db_session, tmp_path, monkeypatch, seg_text=seg_text, configs=configs,
          text_transforms=text_transforms)
    if global_map is not None:
        set_config(db_session, PRONUNCIATION_MAP_GLOBAL_KEY,
                   json.dumps(global_map, ensure_ascii=False))
        db_session.commit()

    captured: dict = {}

    def fake_synth(text, p, db=None):
        captured["text"] = text
        return b"RIFF\x00\x00\x00\x00WAVEfmt ", "wav"

    with patch("app.services.segmented_project_service.is_ffmpeg_available", return_value=False), patch(
        "app.services.segmented_project_service.synthesize_with_engine",
        side_effect=fake_synth,
    ):
        svc.synthesize_segment(db_session, "p1", "c1", "s1")
    return captured


def test_synth_project_map_apply_all(db_session, tmp_path, monkeypatch):
    captured = _capture_synth_text(
        db_session, tmp_path, monkeypatch, seg_text="他调动了队伍",
        configs={
            "pronunciation_map": [{"id": "pm_1", "source": "调动", "target": "掉动"}],
            "pronunciation_apply_all": True,
        },
    )
    assert captured["text"] == "他掉动了队伍"


def test_synth_segment_applied_ids_select_subset(db_session, tmp_path, monkeypatch):
    captured = _capture_synth_text(
        db_session, tmp_path, monkeypatch, seg_text="他调动了队伍",
        configs={"pronunciation_map": [
            {"id": "pm_a", "source": "调动", "target": "掉动"},
            {"id": "pm_b", "source": "队伍", "target": "团队"},
        ]},
        text_transforms={"applied_map_ids": ["pm_a"]},
    )
    assert captured["text"] == "他掉动了队伍"


def test_synth_dangling_map_id_ignored(db_session, tmp_path, monkeypatch):
    captured = _capture_synth_text(
        db_session, tmp_path, monkeypatch, seg_text="他调动了队伍",
        configs={"pronunciation_map": [{"id": "pm_a", "source": "调动", "target": "掉动"}]},
        text_transforms={"applied_map_ids": ["pm_gone"]},
    )
    assert captured["text"] == "他调动了队伍"


def test_synth_project_map_overrides_global(db_session, tmp_path, monkeypatch):
    # 同 source 项目条目覆盖全局条目（含 id）：apply_all 用项目 target
    captured = _capture_synth_text(
        db_session, tmp_path, monkeypatch, seg_text="他调动了队伍",
        configs={
            "pronunciation_map": [{"id": "pm_1", "source": "调动", "target": "项目版"}],
            "pronunciation_apply_all": True,
        },
        global_map=[{"id": "gpm_1", "source": "调动", "target": "全球版"}],
    )
    assert captured["text"] == "他项目版了队伍"


def test_synth_overridden_global_id_becomes_dangling(db_session, tmp_path, monkeypatch):
    # 段引用了被项目条目覆盖的全局 id → 悬空，合成忽略
    captured = _capture_synth_text(
        db_session, tmp_path, monkeypatch, seg_text="他调动了队伍",
        configs={"pronunciation_map": [{"id": "pm_1", "source": "调动", "target": "项目版"}]},
        text_transforms={"applied_map_ids": ["gpm_1"]},
        global_map=[{"id": "gpm_1", "source": "调动", "target": "全球版"}],
    )
    assert captured["text"] == "他调动了队伍"


def test_synth_global_map_via_segment_ids(db_session, tmp_path, monkeypatch):
    captured = _capture_synth_text(
        db_session, tmp_path, monkeypatch, seg_text="他调动了队伍",
        text_transforms={"applied_map_ids": ["gpm_1"]},
        global_map=[{"id": "gpm_1", "source": "调动", "target": "掉动"}],
    )
    assert captured["text"] == "他掉动了队伍"


def test_synth_lowercase_latin_project_default(db_session, tmp_path, monkeypatch):
    captured = _capture_synth_text(
        db_session, tmp_path, monkeypatch, seg_text="使用 REST API 接口",
        configs={"lowercase_latin": True},
    )
    assert captured["text"] == "使用 rest api 接口"


def test_synth_lowercase_latin_segment_override_off(db_session, tmp_path, monkeypatch):
    captured = _capture_synth_text(
        db_session, tmp_path, monkeypatch, seg_text="使用 REST API 接口",
        configs={"lowercase_latin": True},
        text_transforms={"lowercase_latin": False},
    )
    assert captured["text"] == "使用 REST API 接口"


def test_synth_lowercase_latin_segment_override_on(db_session, tmp_path, monkeypatch):
    captured = _capture_synth_text(
        db_session, tmp_path, monkeypatch, seg_text="使用 REST API 接口",
        text_transforms={"lowercase_latin": True},
    )
    assert captured["text"] == "使用 rest api 接口"


def test_synth_transforms_run_before_engine_cleaning(db_session, tmp_path, monkeypatch):
    # 顺序：映射替换先于 prepare_text_for_engine —— target 里的下划线仍被
    # underscore_to_space 处理
    captured = _capture_synth_text(
        db_session, tmp_path, monkeypatch, seg_text="调动",
        configs={
            "pronunciation_map": [{"id": "pm_1", "source": "调动", "target": "调_动"}],
            "pronunciation_apply_all": True,
            "underscore_to_space": True,
        },
    )
    assert captured["text"] == "调 动"


def test_synth_effective_text_recorded(db_session, tmp_path, monkeypatch):
    captured = _capture_synth_text(
        db_session, tmp_path, monkeypatch, seg_text="他调动了队伍",
        configs={
            "pronunciation_map": [{"id": "pm_1", "source": "调动", "target": "掉动"}],
            "pronunciation_apply_all": True,
        },
    )
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    assert seg.generated_params["effective_text"] == captured["text"]
    # 原文不变（显示/字幕/SRT 不受影响）
    assert seg.text == "他调动了队伍"


def test_synth_skips_global_map_load_when_nothing_applies(db_session, tmp_path, monkeypatch):
    _seed(db_session, tmp_path, monkeypatch, seg_text="你好")
    with patch("app.services.segmented_project_service._load_global_pronunciation_map") as loader, patch(
        "app.services.segmented_project_service.is_ffmpeg_available", return_value=False), patch(
        "app.services.segmented_project_service.synthesize_with_engine",
        return_value=(b"RIFF\x00\x00\x00\x00WAVEfmt ", "wav"),
    ):
        svc.synthesize_segment(db_session, "p1", "c1", "s1")
    loader.assert_not_called()


def test_synth_loads_global_map_when_apply_all(db_session, tmp_path, monkeypatch):
    _seed(db_session, tmp_path, monkeypatch, seg_text="你好",
          configs={"pronunciation_apply_all": True})
    with patch("app.services.segmented_project_service._load_global_pronunciation_map",
               return_value=[]) as loader, patch(
        "app.services.segmented_project_service.is_ffmpeg_available", return_value=False), patch(
        "app.services.segmented_project_service.synthesize_with_engine",
        return_value=(b"RIFF\x00\x00\x00\x00WAVEfmt ", "wav"),
    ):
        svc.synthesize_segment(db_session, "p1", "c1", "s1")
    loader.assert_called_once()
