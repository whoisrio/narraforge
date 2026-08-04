"""API tests for the animation-root global setting endpoints."""
import pytest


def test_get_animation_root_unset_returns_null(client):
    resp = client.get("/api/config/animation-root")
    assert resp.status_code == 200
    assert resp.json() == {"value": None}


def test_put_animation_root_sets_value_and_creates_dir(client, tmp_path):
    target = tmp_path / "remotion-projects"
    resp = client.put("/api/config/animation-root", json={"value": str(target)})
    assert resp.status_code == 200
    assert resp.json()["value"] == str(target)
    # GET reflects it
    assert client.get("/api/config/animation-root").json()["value"] == str(target)
    # dir created on save
    assert target.is_dir()


def test_put_animation_root_empty_rejected(client):
    resp = client.put("/api/config/animation-root", json={"value": "   "})
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "path_empty"


def test_put_animation_root_uncreatable_rejected(client, tmp_path):
    # parent is a file -> ENOTDIR when mkdir
    blocker = tmp_path / "blocker"
    blocker.write_text("x")
    resp = client.put(
        "/api/config/animation-root", json={"value": str(blocker / "sub")}
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["message"].startswith("cannot_create_directory")


def test_test_animation_root_creatable_returns_ok_and_not_saved(client, tmp_path):
    target = tmp_path / "probe"
    resp = client.post(
        "/api/config/animation-root/test", json={"value": str(target)}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["error"] is None
    # not persisted
    assert client.get("/api/config/animation-root").json()["value"] is None


def test_test_animation_root_uncreatable_reports_error(client, tmp_path):
    blocker = tmp_path / "blocker"
    blocker.write_text("x")
    resp = client.post(
        "/api/config/animation-root/test", json={"value": str(blocker / "sub")}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False
    assert body["error"].startswith("cannot_create_directory")
