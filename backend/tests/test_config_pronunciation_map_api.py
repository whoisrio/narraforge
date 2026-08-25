"""全局发音映射字典端点测试（GET/PUT /config/pronunciation-map-global）。"""


def _entry(id="gpm_a1b2c3", source="调动", target="掉动", note=None):
    e = {"id": id, "source": source, "target": target}
    if note:
        e["note"] = note
    return e


def test_get_default_empty(client):
    resp = client.get("/api/config/pronunciation-map-global")
    assert resp.status_code == 200
    assert resp.json() == {"entries": []}


def test_put_roundtrip(client):
    entries = [_entry(), _entry(id="gpm_x9y8z7", source="REST", target="rest", note="防逐字母")]
    resp = client.put("/api/config/pronunciation-map-global", json={"entries": entries})
    assert resp.status_code == 200
    assert resp.json() == {"entries": entries}

    got = client.get("/api/config/pronunciation-map-global")
    assert got.json() == {"entries": entries}


def test_put_empty_source_rejected(client):
    resp = client.put(
        "/api/config/pronunciation-map-global",
        json={"entries": [_entry(source="  ")]},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "pronunciation_source_empty"


def test_put_duplicate_source_rejected(client):
    resp = client.put(
        "/api/config/pronunciation-map-global",
        json={"entries": [_entry(), _entry(id="gpm_zzzzzz")]},  # 同 source
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "pronunciation_source_duplicate"


def test_put_replaces_previous(client):
    client.put("/api/config/pronunciation-map-global", json={"entries": [_entry()]})
    client.put("/api/config/pronunciation-map-global", json={"entries": []})
    assert client.get("/api/config/pronunciation-map-global").json() == {"entries": []}
