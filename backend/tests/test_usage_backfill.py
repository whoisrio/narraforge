"""usage 回填服务测试：把存量已合成 segment 与 tts_results 历史写入 usage_events。

覆盖（按 AGENTS.md 一次性迁移规范）：
- 只回填 audio.current.origin != 'recorded' 且有 current 音频的段
- tts_results 历史行 → project_id=None 的 tts 事件，created_at 保留
- 幂等：确定性 uuid5 主键，重复执行不产生重复事件
- 多项目归属不串（multi-entity collision 用例）
"""
from datetime import datetime, timezone

from app.models.tts_result import TTSResultRecord
from app.models.usage_event import UsageEvent
from app.schemas.segmented_project import ProjectIn
from app.services import segmented_project_service as svc
from app.services import usage_backfill_service as backfill


def _seed_project(db, project_id: str, chapters: list[dict]) -> None:
    svc.save_project(db, ProjectIn(
        id=project_id, name=f"P-{project_id}", schema_version=2, chapters=chapters,
    ))
    db.commit()


def _chapter(cid: str, position: int, segments: list[dict]) -> dict:
    return {
        "id": cid, "position": position, "name": cid, "engine": "edge_tts",
        "voice": {"engine": "edge_tts", "voice_id": "v1"},
        "split_config": {"delimiters": ["。"], "mode": "rule"},
        "segments": segments,
    }


def _set_audio(db, project_id: str, chapter_id: str, segment_id: str, origin: str | None) -> None:
    """直接给 segment 写 current 音频 JSON（不跑真实合成）。

    注意 SQLAlchemy JSON 列必须 deepcopy + flag_modified，否则 UPDATE 不生效。
    """
    import copy

    from sqlalchemy.orm.attributes import flag_modified

    row = svc.get_segment_row(db, project_id, chapter_id, segment_id)
    current = {"path": f"data/projects/{project_id}/{chapter_id}/{segment_id}.wav"}
    if origin is not None:
        current["origin"] = origin
    audio = copy.deepcopy(row.audio or {})
    audio["current"] = current
    row.audio = audio
    flag_modified(row, "audio")
    db.commit()


def test_backfill_segments_and_history(db_session):
    _seed_project(db_session, "p1", [
        _chapter("c1", 0, [
            {"id": "s1", "position": 0, "text": "已合成的段。"},        # 7 字 → tts
            {"id": "s2", "position": 1, "text": "用户录制的段。"},      # recorded → 跳过
            {"id": "s3", "position": 2, "text": "没有音频的段。"},      # 无 current → 跳过
        ]),
    ])
    _set_audio(db_session, "p1", "c1", "s1", origin="tts")
    _set_audio(db_session, "p1", "c1", "s2", origin="recorded")
    # s3 不设音频

    old_time = datetime(2026, 1, 1, tzinfo=timezone.utc)
    db_session.add(TTSResultRecord(
        id="tr1", text="历史合成一", voice_id="v1", audio_path="data/tts-history/a.wav",
        created_at=old_time,
    ))
    db_session.commit()

    stats = backfill.apply_local(db_session)
    db_session.commit()

    assert stats["segment_events"] == 1
    assert stats["history_events"] == 1
    assert stats["skipped_existing"] == 0

    events = db_session.query(UsageEvent).all()
    assert len(events) == 2

    seg_event = next(e for e in events if e.project_id == "p1")
    assert seg_event.kind == "tts"
    assert seg_event.chars == len("已合成的段。")
    assert seg_event.input_tokens == 0 and seg_event.output_tokens == 0
    assert seg_event.estimated is False

    hist_event = next(e for e in events if e.project_id is None)
    assert hist_event.kind == "tts"
    assert hist_event.chars == len("历史合成一")
    assert hist_event.created_at.replace(tzinfo=timezone.utc) == old_time


def test_backfill_is_idempotent(db_session):
    _seed_project(db_session, "p1", [
        _chapter("c1", 0, [{"id": "s1", "position": 0, "text": "段。"}]),
    ])
    _set_audio(db_session, "p1", "c1", "s1", origin="tts")

    first = backfill.apply_local(db_session)
    db_session.commit()
    second = backfill.apply_local(db_session)
    db_session.commit()

    assert first["segment_events"] == 1
    assert second["segment_events"] == 0
    assert second["skipped_existing"] >= 1
    assert db_session.query(UsageEvent).count() == 1


def test_backfill_multi_project_attribution(db_session):
    """多项目：事件 project_id 归属必须各自正确（collision 用例）。"""
    _seed_project(db_session, "p1", [
        _chapter("c1", 0, [{"id": "s1", "position": 0, "text": "一。"}]),
    ])
    _seed_project(db_session, "p2", [
        _chapter("c9", 0, [{"id": "s9", "position": 0, "text": "九九九。"}]),
    ])
    _set_audio(db_session, "p1", "c1", "s1", origin="tts")
    _set_audio(db_session, "p2", "c9", "s9", origin="tts")

    backfill.apply_local(db_session)
    db_session.commit()

    by_project = {e.project_id: e for e in db_session.query(UsageEvent).all()}
    assert by_project["p1"].chars == len("一。")
    assert by_project["p2"].chars == len("九九九。")


def test_backfill_segment_without_origin_counts_as_tts(db_session):
    """老数据 audio.current 可能缺 origin 字段：有 current 且非 recorded 即视为合成过。"""
    _seed_project(db_session, "p1", [
        _chapter("c1", 0, [{"id": "s1", "position": 0, "text": "老段。"}]),
    ])
    _set_audio(db_session, "p1", "c1", "s1", origin=None)

    stats = backfill.apply_local(db_session)
    db_session.commit()
    assert stats["segment_events"] == 1
