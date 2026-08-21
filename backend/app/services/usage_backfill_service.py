"""usage_events 存量回填（一次性迁移，plan/apply 两阶段，幂等）。

把两类存量数据折算成 kind='tts' 的 usage 事件：

1. 已合成的 segment：`audio.current` 存在且 `origin != 'recorded'`
   （老数据可能缺 origin 字段，有 current 即视为合成过）。
   每段计 1 次 TTS，chars=len(text)，project_id 归属项目。
   注意：无法还原重复合成次数，只按当前状态计 1 次。
2. tts_results 历史行：每行 1 次 TTS，chars=len(text)，project_id=NULL，
   created_at 保留原行时间。

LLM 调用无历史记录，无法回填（token 维度从启用计量起才开始累积）。

幂等：事件 id 用 uuid5(命名空间, 稳定源串) 生成，重复执行命中已有主键即跳过。
备份：local apply 前由 CLI 用 SQLite 在线备份 API 落一个副本（WAL 安全）。
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.segmented_project import SegmentedProjectChapter, SegmentedProjectSegment
from app.models.tts_result import TTSResultRecord
from app.models.usage_event import UsageEvent

logger = logging.getLogger(__name__)

_NS = uuid.NAMESPACE_URL


def _segment_event_id(project_id: str, chapter_id: str, segment_id: str) -> str:
    return str(uuid.uuid5(_NS, f"narraforge:usage-backfill:seg:{project_id}:{chapter_id}:{segment_id}"))


def _history_event_id(tts_result_id: str) -> str:
    return str(uuid.uuid5(_NS, f"narraforge:usage-backfill:tts_result:{tts_result_id}"))


def collect_local(db: Session) -> list[UsageEvent]:
    """扫描本地库，构造待写入的事件列表（不判重、不落库）。"""
    events: list[UsageEvent] = []

    project_by_chapter = {
        c.id: c.project_id for c in db.query(SegmentedProjectChapter).all()
    }
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for seg in db.query(SegmentedProjectSegment).all():
        current = (seg.audio or {}).get("current") or {}
        if not current.get("path"):
            continue
        if current.get("origin") == "recorded":
            continue
        project_id = project_by_chapter.get(seg.chapter_id)
        events.append(UsageEvent(
            id=_segment_event_id(project_id or "", seg.chapter_id, seg.id),
            project_id=project_id,
            kind="tts",
            chars=len(seg.text or ""),
            input_tokens=0,
            output_tokens=0,
            estimated=False,
            created_at=now,
        ))

    for row in db.query(TTSResultRecord).all():
        events.append(UsageEvent(
            id=_history_event_id(row.id),
            project_id=None,
            kind="tts",
            chars=len(row.text or ""),
            input_tokens=0,
            output_tokens=0,
            estimated=False,
            created_at=row.created_at or now,
        ))

    return events


def apply_local(db: Session) -> dict:
    """把 collect_local 的结果落库，跳过已存在的确定性主键（幂等）。

    返回统计：segment_events / history_events / skipped_existing。
    调用方负责 commit。
    """
    events = collect_local(db)
    existing = {
        row[0] for row in db.query(UsageEvent.id).filter(
            UsageEvent.id.in_([e.id for e in events])
        ).all()
    } if events else set()

    stats = {"segment_events": 0, "history_events": 0, "skipped_existing": 0}
    for e in events:
        if e.id in existing:
            stats["skipped_existing"] += 1
            continue
        db.add(e)
        if e.project_id is None:
            stats["history_events"] += 1
        else:
            stats["segment_events"] += 1
    return stats
