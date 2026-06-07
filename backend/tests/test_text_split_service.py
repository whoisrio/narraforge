"""Tests for text_split_service."""
import pytest


# ------- rule_split -------

def test_rule_split_all_delimiters():
    from app.services.text_split_service import rule_split
    text = "你好，世界。今天是个好日子！我们一起出去玩？"
    result = rule_split(text, ["，", "。", "！", "？"])
    assert result == ["你好，", "世界。", "今天是个好日子！", "我们一起出去玩？"]


def test_rule_split_only_period():
    from app.services.text_split_service import rule_split
    text = "你好，世界。今天好。"
    result = rule_split(text, ["。"])
    assert result == ["你好，世界。", "今天好。"]


def test_rule_split_no_delimiter_returns_single():
    from app.services.text_split_service import rule_split
    result = rule_split("一段没有标点的文字", [])
    assert result == ["一段没有标点的文字"]


def test_rule_split_filters_empty_and_pure_punct():
    from app.services.text_split_service import rule_split
    text = "你好。。。世界。"
    result = rule_split(text, ["。"])
    # 连续 "。" 产生的空段 / 纯标点段被过滤
    assert result == ["你好。", "世界。"]


def test_rule_split_strips_whitespace_around_segments():
    from app.services.text_split_service import rule_split
    text = "  你好。  世界。  "
    result = rule_split(text, ["。"])
    assert result == ["你好。", "世界。"]


def test_rule_split_handles_leading_punct():
    from app.services.text_split_service import rule_split
    text = "。开头是标点。"
    result = rule_split(text, ["。"])
    assert result == ["开头是标点。"]


def test_rule_split_mixed_chinese_english():
    from app.services.text_split_service import rule_split
    text = "Hello world，今天 weather is good。"
    result = rule_split(text, ["，", "。"])
    assert result == ["Hello world，", "今天 weather is good。"]


def test_rule_split_empty_text_returns_empty_list():
    from app.services.text_split_service import rule_split
    assert rule_split("", ["，", "。"]) == []
    assert rule_split("   ", ["，", "。"]) == []
