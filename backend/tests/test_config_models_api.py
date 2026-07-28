"""A1 regression tests: config.py must return real 404s, not Flask-style tuples."""


def test_update_config_missing_returns_404(client):
    resp = client.put("/api/config/models/nonexistent", json={"name": "x"})
    assert resp.status_code == 404


def test_delete_config_missing_returns_404(client):
    resp = client.delete("/api/config/models/nonexistent")
    assert resp.status_code == 404


def test_set_default_config_missing_returns_404(client):
    resp = client.post("/api/config/models/nonexistent/set-default")
    assert resp.status_code == 404
