"""API tests for /api/text-split/*."""
from unittest.mock import patch


def test_rule_split_endpoint(client):
    resp = client.post("/api/text-split/rule", json={
        "text": "你好，世界。今天好。",
        "delimiters": ["，", "。"],
    })
    assert resp.status_code == 200
    # 默认 min_len_to_merge=5 → 前两个短段合并，尾段保留
    assert resp.json() == {"segments": ["你好，世界。", "今天好。"]}


def test_rule_split_endpoint_disable_merge(client):
    """传 min_len_to_merge=0 关闭合并，保留原细粒度。"""
    resp = client.post("/api/text-split/rule", json={
        "text": "你好，世界。今天好。",
        "delimiters": ["，", "。"],
        "min_len_to_merge": 0,
    })
    assert resp.status_code == 200
    assert resp.json() == {"segments": ["你好，", "世界。", "今天好。"]}


def test_rule_split_endpoint_custom_thresholds(client):
    """自定义阈值：很小的 next_max_len_to_merge → 不合并。"""
    resp = client.post("/api/text-split/rule", json={
        "text": "你好，世界。",
        "delimiters": ["，", "。"],
        "min_len_to_merge": 5,
        "next_max_len_to_merge": 1,  # 下一段必须<1才合并 → 永不合并
    })
    assert resp.status_code == 200
    assert resp.json() == {"segments": ["你好，", "世界。"]}


def test_rule_split_empty_text_422(client):
    resp = client.post("/api/text-split/rule", json={
        "text": "",
        "delimiters": ["。"],
    })
    assert resp.status_code == 422 or resp.status_code == 400


def test_llm_split_endpoint_success(client):
    from app.services import text_split_service
    fake = text_split_service.SplitResult(
        segments=[{"text": "段1", "reason": "x"}, {"text": "段2", "reason": "y"}],
        model="test-model",
    )
    with patch("app.api.text_split.llm_split", return_value=fake):
        resp = client.post("/api/text-split/llm", json={"text": "段1段2"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["model"] == "test-model"
    assert [s["text"] for s in body["segments"]] == ["段1", "段2"]


def test_llm_split_value_error_returns_400(client):
    with patch("app.api.text_split.llm_split", side_effect=ValueError("bad input")):
        resp = client.post("/api/text-split/llm", json={"text": "x"})
    assert resp.status_code == 400


def test_llm_split_runtime_error_returns_502(client):
    with patch("app.api.text_split.llm_split", side_effect=RuntimeError("LLM down")):
        resp = client.post("/api/text-split/llm", json={"text": "x"})
    assert resp.status_code == 502


def test_ssml_annotate_endpoint_success(client):
    from app.services import text_split_service
    fake = text_split_service.SSMLAnnotateResult(
        annotations=[{"text": "你好", "ssml": "<speak>你好</speak>", "rationale": "x"}],
        model="m",
    )
    with patch("app.api.text_split.ssml_annotate", return_value=fake):
        resp = client.post("/api/text-split/ssml-annotate", json={
            "texts": ["你好"], "style_hint": "播音腔",
        })
    assert resp.status_code == 200
    body = resp.json()
    assert body["annotations"][0]["ssml"] == "<speak>你好</speak>"


def test_ssml_annotate_empty_texts_returns_422(client):
    resp = client.post("/api/text-split/ssml-annotate", json={"texts": []})
    assert resp.status_code in (400, 422)
