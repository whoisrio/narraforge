from __future__ import annotations


def _role_payload(role_id: str = "role-linxia") -> dict:
    return {
        "id": role_id,
        "name": "林夏",
        "avatar": "avatar://linxia",
        "description": "温柔但紧张的女主角",
        "role_kind": "cast",
        "voice": {
            "engine": "edge_tts",
            "params": {
                "engine": "edge_tts",
                "edge_voice": "zh-CN-XiaoxiaoNeural",
                "edge_rate": "+0%",
                "edge_volume": "+0%",
            },
        },
        "favorite_styles": [
            {"id": "soft", "name": "低声", "style_tags": ["low_voice"]},
        ],
    }


def test_roles_crud_round_trip(client):
    created = client.post("/api/roles", json=_role_payload())
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["id"] == "role-linxia"
    assert body["name"] == "林夏"
    assert body["role_kind"] == "cast"
    assert body["voice"]["engine"] == "edge_tts"
    assert body["voice"]["params"]["edge_voice"] == "zh-CN-XiaoxiaoNeural"
    assert body["favorite_styles"][0]["name"] == "低声"
    assert body["created_at"]
    assert body["updated_at"]

    listed = client.get("/api/roles")
    assert listed.status_code == 200
    assert [role["id"] for role in listed.json()] == ["role-linxia"]

    updated = client.put(
        "/api/roles/role-linxia",
        json={
            "name": "林夏新版",
            "role_kind": "narrator",
            "voice": {
                "engine": "edge_tts",
                "params": {
                    "engine": "edge_tts",
                    "edge_voice": "zh-CN-XiaoyiNeural",
                },
            },
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "林夏新版"
    assert updated.json()["role_kind"] == "narrator"
    assert updated.json()["voice"]["params"]["edge_voice"] == "zh-CN-XiaoyiNeural"

    deleted = client.delete("/api/roles/role-linxia")
    assert deleted.status_code == 204
    assert client.get("/api/roles").json() == []


def test_role_create_rejects_duplicate_id(client):
    payload = _role_payload("role-dup")
    assert client.post("/api/roles", json=payload).status_code == 201
    duplicate = client.post("/api/roles", json=payload)
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "role_already_exists"


def test_role_update_missing_returns_404(client):
    response = client.put("/api/roles/missing", json={"name": "missing"})
    assert response.status_code == 404
    assert response.json()["detail"] == "role_not_found"
