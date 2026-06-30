from __future__ import annotations

import pytest

from app.schemas.role import RoleIn, RoleUpdate
from app.services.role_service import create_role, delete_role, get_role, list_roles, role_to_out, update_role


def _role_in(role_id: str = "role-narrator") -> RoleIn:
    return RoleIn(
        id=role_id,
        name="旁白",
        avatar="avatar://narrator",
        description="默认旁白声线",
        voice={
            "engine": "edge_tts",
            "params": {
                "engine": "edge_tts",
                "edge_voice": "zh-CN-YunjianNeural",
            },
        },
        favorite_styles=[{"id": "calm", "name": "沉稳", "style_tags": ["calm"]}],
    )


def test_create_and_list_roles(db_session):
    role = create_role(db_session, _role_in())
    db_session.commit()

    out = role_to_out(role)
    assert out.id == "role-narrator"
    assert out.name == "旁白"
    assert out.voice["params"]["edge_voice"] == "zh-CN-YunjianNeural"

    rows = list_roles(db_session)
    assert [item.id for item in rows] == ["role-narrator"]


def test_create_role_rejects_duplicate(db_session):
    create_role(db_session, _role_in("role-dup"))
    db_session.commit()

    with pytest.raises(ValueError, match="role_already_exists"):
        create_role(db_session, _role_in("role-dup"))


def test_update_role_merges_only_provided_fields(db_session):
    create_role(db_session, _role_in())
    db_session.commit()

    updated = update_role(
        db_session,
        "role-narrator",
        RoleUpdate(name="旁白新版", description=None),
    )
    db_session.commit()

    assert updated is not None
    assert updated.name == "旁白新版"
    assert updated.description is None
    assert updated.voice["engine"] == "edge_tts"
    assert updated.voice["params"]["edge_voice"] == "zh-CN-YunjianNeural"


def test_delete_role_returns_false_for_missing(db_session):
    assert delete_role(db_session, "missing") is False


def test_get_role_returns_none_for_missing(db_session):
    assert get_role(db_session, "missing") is None
