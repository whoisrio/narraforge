"""dev 库角色垃圾数据清理（一次性，plan/apply 两阶段，幂等）。

清理三类（2026-08-21 用户确认）：
- e2e 漏入的 `test-role-%` 角色（e2e 环境自己会 seed，dev 库不需要）
- `project_id='__scratchpad__'` 的孤儿角色（`__scratchpad__`→NULL 归一化
  之前的残留，渲染不可见但占用表）
- segment 里指向不存在角色的悬空 `role_id`（置 NULL，渲染无害但属脏数据）

明确不动：`project_id IS NULL` 的全局角色（用户决定保留跨项目共享）、
正常项目角色。CLI 见 `scripts/cleanup_ghost_roles.py`。
"""
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.models.role import Role
from app.models.segmented_project import SegmentedProjectSegment

logger = logging.getLogger(__name__)


def plan_local(db: Session) -> dict:
    """扫描待清理项（只读）。"""
    test_role_ids = [
        r.id for r in db.query(Role).filter(Role.id.like("test-role-%")).all()
    ]
    scratchpad_role_ids = [
        r.id for r in db.query(Role).filter(Role.project_id == "__scratchpad__").all()
    ]
    existing = {r.id for r in db.query(Role.id).all()}
    dangling_segment_role_ids = sorted({
        s.role_id
        for s in db.query(SegmentedProjectSegment).filter(
            SegmentedProjectSegment.role_id.isnot(None)
        ).all()
        if s.role_id not in existing
    })
    return {
        "test_role_ids": test_role_ids,
        "scratchpad_role_ids": scratchpad_role_ids,
        "dangling_segment_role_ids": dangling_segment_role_ids,
    }


def apply_local(db: Session) -> dict:
    """执行清理。调用方负责 commit。重复执行是 no-op。"""
    plan = plan_local(db)

    stats = {
        "test_roles_deleted": 0,
        "scratchpad_roles_deleted": 0,
        "dangling_role_refs_nulled": 0,
    }
    if plan["test_role_ids"]:
        stats["test_roles_deleted"] = db.query(Role).filter(
            Role.id.in_(plan["test_role_ids"])
        ).delete(synchronize_session=False)
    if plan["scratchpad_role_ids"]:
        stats["scratchpad_roles_deleted"] = db.query(Role).filter(
            Role.id.in_(plan["scratchpad_role_ids"])
        ).delete(synchronize_session=False)

    # 悬空引用在角色删除后重新计算（删完角色会产生新的悬空引用？不会——
    # 本清理只删无引用的 test/scratchpad 角色；但保守起见按删除后状态算）
    existing = {r.id for r in db.query(Role.id).all()}
    dangling = db.query(SegmentedProjectSegment).filter(
        SegmentedProjectSegment.role_id.isnot(None),
        SegmentedProjectSegment.role_id.notin_(existing) if existing else True,
    ).all()
    for seg in dangling:
        seg.role_id = None
        stats["dangling_role_refs_nulled"] += 1

    return stats
