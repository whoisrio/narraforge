"""
智能文稿解析 API 集成测试
"""

import pytest


SAMPLE_SCRIPT = (
    "第1章 夜路\n\n"
    "天色渐暗，远处传来狼嚎。\n\n"
    "小明：我们得快点走了！\n"
    "小红说：可是天这么黑，往哪走？\n"
    "小明：往山那边走，那里有座破庙。\n"
    "小红：你确定记得路？\n"
    "小明：别废话了，快跟上。\n\n"
    "天色完全黑了下来。\n\n"
    "第2章 破庙\n\n"
    "推开门，一股霉味扑面而来。\n\n"
    "小红：这里好阴森。\n"
    "小明：总比外面安全。先把火生起来。\n"
    "小红：你去找柴火，我收拾一下这里。\n"
    "小明：好，别乱跑。\n"
)


class TestTextAnalysisSplitAPI:
    """POST /api/text-analysis/split"""

    def test_split_returns_200(self, client):
        resp = client.post(
            "/api/text-analysis/split",
            json={"text": SAMPLE_SCRIPT, "mode": "auto"},
        )
        assert resp.status_code == 200

    def test_split_returns_correct_structure(self, client):
        resp = client.post(
            "/api/text-analysis/split",
            json={"text": SAMPLE_SCRIPT, "mode": "auto"},
        )
        body = resp.json()
        assert body["method"] == "regex"
        assert "chapters" in body
        assert "detected_roles" in body

    def test_split_detects_two_chapters(self, client):
        resp = client.post(
            "/api/text-analysis/split",
            json={"text": SAMPLE_SCRIPT, "mode": "auto"},
        )
        body = resp.json()
        assert len(body["chapters"]) == 2
        assert body["chapters"][0]["title"] == "第1章 夜路"
        assert body["chapters"][1]["title"] == "第2章 破庙"

    def test_split_detects_roles(self, client):
        resp = client.post(
            "/api/text-analysis/split",
            json={"text": SAMPLE_SCRIPT, "mode": "auto"},
        )
        body = resp.json()
        names = {r["name"] for r in body["detected_roles"]}
        assert "小明" in names
        assert "小红" in names

    def test_segments_have_role_and_confidence(self, client):
        resp = client.post(
            "/api/text-analysis/split",
            json={"text": SAMPLE_SCRIPT, "mode": "auto"},
        )
        body = resp.json()
        # 找一个有角色的段
        seg_with_role = [
            s for ch in body["chapters"] for s in ch["segments"] if s["role"]
        ]
        assert len(seg_with_role) > 0
        seg = seg_with_role[0]
        assert seg["role"] in ("小明", "小红")
        assert isinstance(seg["role_confidence"], (int, float))

    def test_empty_text_rejected(self, client):
        """空文本被 Pydantic 校验拒绝"""
        resp = client.post(
            "/api/text-analysis/split",
            json={"text": "", "mode": "auto"},
        )
        assert resp.status_code == 422

    def test_text_too_short_for_roles(self, client):
        """文本量太小时不产生角色"""
        resp = client.post(
            "/api/text-analysis/split",
            json={"text": "小明：你好！", "mode": "auto"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["detected_roles"]) == 0

    def test_chapter_title_not_in_segments(self, client):
        """章节标题不应当出现在分段里"""
        resp = client.post(
            "/api/text-analysis/split",
            json={"text": SAMPLE_SCRIPT, "mode": "auto"},
        )
        body = resp.json()
        for ch in body["chapters"]:
            for s in ch["segments"]:
                assert not s["text"].startswith("第")

    def test_role_count_confidence(self, client):
        """detected_roles 包含出现次数和置信度"""
        resp = client.post(
            "/api/text-analysis/split",
            json={"text": SAMPLE_SCRIPT, "mode": "auto"},
        )
        body = resp.json()
        for role in body["detected_roles"]:
            assert isinstance(role["name"], str)
            assert isinstance(role["occurrences"], int)
            assert role["occurrences"] >= 2
            assert isinstance(role["confidence"], (int, float))
            assert 0 <= role["confidence"] <= 1
