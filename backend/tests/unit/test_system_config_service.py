"""Unit tests for system_config_service animation_root_folder helpers."""
from app.core import system_config_service as scs


def test_get_animation_root_folder_unset_returns_none(db_session):
    assert scs.get_animation_root_folder(db_session) is None


def test_set_then_get_round_trip(db_session):
    scs.set_animation_root_folder(db_session, "/tmp/remotion-root")
    db_session.commit()
    assert scs.get_animation_root_folder(db_session) == "/tmp/remotion-root"


def test_set_strips_whitespace(db_session):
    scs.set_animation_root_folder(db_session, "   /tmp/root   ")
    db_session.commit()
    assert scs.get_animation_root_folder(db_session) == "/tmp/root"


def test_set_expands_user(db_session):
    scs.set_animation_root_folder(db_session, "~/remotion-projects")
    db_session.commit()
    value = scs.get_animation_root_folder(db_session)
    assert value is not None
    assert value.endswith("remotion-projects")
    assert "~" not in value


def test_get_treats_empty_as_unset(db_session):
    scs.set_animation_root_folder(db_session, "   ")
    db_session.commit()
    assert scs.get_animation_root_folder(db_session) is None


# ----- narration git remote -----

def test_git_remote_unset_returns_none(db_session):
    assert scs.get_narration_git_remote(db_session) is None


def test_git_remote_round_trip(db_session):
    scs.set_narration_git_remote(db_session, "https://github.com/me/narraforge.git")
    db_session.commit()
    assert scs.get_narration_git_remote(db_session) == "https://github.com/me/narraforge.git"


def test_git_remote_strips_whitespace(db_session):
    scs.set_narration_git_remote(db_session, "  git@host:repo.git  ")
    db_session.commit()
    assert scs.get_narration_git_remote(db_session) == "git@host:repo.git"


def test_git_remote_empty_treated_as_unset(db_session):
    scs.set_narration_git_remote(db_session, "   ")
    db_session.commit()
    assert scs.get_narration_git_remote(db_session) is None
