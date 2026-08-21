"""dev 库角色垃圾数据清理服务测试（一次性，plan/apply 两阶段，幂等）。

清理三类（用户确认）：
- e2e 漏入的 test-role-* 角色（小明/小红）
- project_id='__scratchpad__' 的孤儿角色（__scratchpad__→NULL 归一化之前的残留）
- segment 里指向不存在角色的悬空 role_id（置 NULL）

不动：project_id IS NULL 的全局角色（用户决定保留）、正常项目角色。
"""
from app.models.role import Role
from app.schemas.segmented_project import ProjectIn
from app.services import role_cleanup_service as cleanup
from app.services import segmented_project_service as svc


def _seed_project(db) -> None:
    svc.save_project(db, ProjectIn(
        id="p1", name="P1", schema_version=2,
        chapters=[{
            "id": "c1", "position": 0, "name": "c1", "engine": "edge_tts",
            "voice": {"engine": "edge_tts", "voice_id": "v1"},
            "split_config": {"delimiters": ["。"], "mode": "rule"},
            "segments": [
                {"id": "s1", "position": 0, "text": "引用悬空角色的段。", "role_id": "role-ghost-gone"},
                {"id": "s2", "position": 1, "text": "引用正常角色的段。", "role_id": "role-normal"},
            ],
        }],
    ))
    db.commit()


def _add_role(db, role_id: str, name: str, project_id: str | None) -> None:
    db.add(Role(id=role_id, name=name, description="", project_id=project_id, voice={"engine": "edge_tts"}))
    db.commit()


def test_cleanup_plan_and_apply(db_session):
    _seed_project(db_session)
    _add_role(db_session, "test-role-xiaoming", "小明", None)            # e2e 漏入 → 删
    _add_role(db_session, "test-role-xiaohong", "小红", None)            # e2e 漏入 → 删
    _add_role(db_session, "role-orphan-1", "林夏-1", "__scratchpad__")   # 孤儿 → 删
    _add_role(db_session, "role-normal", "正常角色", "p1")               # 项目角色 → 保留
    _add_role(db_session, "role-cast-global", "磁性男嗓", None)          # 全局角色 → 保留（用户决定）

    plan = cleanup.plan_local(db_session)
    assert sorted(plan["test_role_ids"]) == ["test-role-xiaohong", "test-role-xiaoming"]
    assert plan["scratchpad_role_ids"] == ["role-orphan-1"]
    assert plan["dangling_segment_role_ids"] == ["role-ghost-gone"]

    stats = cleanup.apply_local(db_session)
    db_session.commit()

    assert stats["test_roles_deleted"] == 2
    assert stats["scratchpad_roles_deleted"] == 1
    assert stats["dangling_role_refs_nulled"] == 1

    remaining = {r.id for r in db_session.query(Role).all()}
    assert remaining == {"role-normal", "role-cast-global"}

    from app.models.segmented_project import SegmentedProjectSegment
    segs = {s.id: s.role_id for s in db_session.query(SegmentedProjectSegment).all()}
    assert segs["s1"] is None
    assert segs["s2"] == "role-normal"


def test_cleanup_is_idempotent(db_session):
    _add_role(db_session, "test-role-xiaoming", "小明", None)
    _add_role(db_session, "role-orphan-1", "林夏-1", "__scratchpad__")

    first = cleanup.apply_local(db_session)
    db_session.commit()
    second = cleanup.apply_local(db_session)
    db_session.commit()

    assert first["test_roles_deleted"] == 1
    assert second["test_roles_deleted"] == 0
    assert second["scratchpad_roles_deleted"] == 0
    assert second["dangling_role_refs_nulled"] == 0
