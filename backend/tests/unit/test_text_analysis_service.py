"""
智能文稿解析 — 纯正则引擎 单元测试
"""

import pytest
from app.services.text_analysis_service import (
    analyze_script,
    _find_chapter_boundaries,
    _scan_roles,
    _assign_role,
    _strip_role_prefix,
)

# ────────────────────────────────────────────────────────────
# 章节拆分
# ────────────────────────────────────────────────────────────

class TestChapterBoundaries:
    """章节边界检测"""

    def test_cn_chapter_numbers(self):
        """中文章节号"""
        text = "第1章 夜路\n\n文本A\n\n第2章 破庙\n\n文本B"
        boundaries = _find_chapter_boundaries(text)
        assert len(boundaries) == 2
        assert boundaries[0][0] == "第1章 夜路"
        assert boundaries[1][0] == "第2章 破庙"

    def test_cn_chapter_variants(self):
        """中文章节号变体: 集、回、篇"""
        for marker in ["第三集 启程", "第二回 大闹天宫", "第五篇 终章"]:
            text = f"{marker}\n\n正文"
            boundaries = _find_chapter_boundaries(text)
            assert len(boundaries) == 1, f"failed for {marker}"

    def test_markdown_headings(self):
        """Markdown 标题 H1-H3 降级"""
        text = "# 引言\n\n文本A\n\n## 第一节\n\n文本B\n\n### 小节\n\n文本C"
        boundaries = _find_chapter_boundaries(text)
        assert len(boundaries) == 3

    def test_cn_takes_priority_over_markdown(self):
        """中文章节号优先于 Markdown"""
        text = "第1章 开始\n\n# 这不会被当章节\n\n正文"
        boundaries = _find_chapter_boundaries(text)
        assert len(boundaries) == 1
        assert boundaries[0][0] == "第1章 开始"

    def test_no_chapter_returns_empty(self):
        """无章节格式的纯文本"""
        boundaries = _find_chapter_boundaries("这是一段普通的叙述文本，没有任何章节标记。")
        assert boundaries == []


# ────────────────────────────────────────────────────────────
# 角色识别
# ────────────────────────────────────────────────────────────

class TestRoleScanning:
    """全文字符频次统计"""

    def test_rule_a_colon(self):
        """规则 A: 行首冒号"""
        text = "小明：快点走！\n小红：等等我！\n小明：别磨蹭了。"
        counter, _ = _scan_roles(text)
        assert counter.get("小明") == 2
        assert counter.get("小红") == 1

    def test_rule_b_verb_colon(self):
        """规则 B: 带动词的冒号"""
        text = "小明说：你好。\n小红问道：你是谁？\n小明笑道：是我啊。"
        counter, _ = _scan_roles(text)
        assert counter.get("小明") == 2
        assert counter.get("小红") == 1

    def test_single_char_filtered(self):
        """单字角色名被过滤"""
        text = "我：知道了。\n你：好的。"
        counter, _ = _scan_roles(text)
        assert "我" not in counter
        assert "你" not in counter

    def test_english_role_names(self):
        """规则 D: 全大写英文角色名"""
        text = "JOHN\nWe need to go.\n\nMARY\nWait for me!"
        counter, _ = _scan_roles(text)
        assert "JOHN" in counter
        assert "MARY" in counter


# ────────────────────────────────────────────────────────────
# 角色分配
# ────────────────────────────────────────────────────────────

class TestRoleAssignment:
    """单行角色分配"""

    def test_assign_high_frequency_role(self):
        """高频角色分配"""
        counter = {"小明": 3, "小红": 2}
        role, conf = _assign_role("小明：快走！", counter, min_occurrences=2)
        assert role == "小明"
        assert conf > 0.9

    def test_low_frequency_filtered(self):
        """低频角色被过滤(归为旁白)"""
        counter = {"路人": 1, "小明": 3}
        role, conf = _assign_role("路人：请问一下...", counter, min_occurrences=2)
        assert role is None

    def test_narration_line(self):
        """叙述行无角色"""
        role, conf = _assign_role("天色渐暗，远处传来狼嚎。", {"小明": 2}, min_occurrences=2)
        assert role is None


# ────────────────────────────────────────────────────────────
# 标签剥离
# ────────────────────────────────────────────────────────────

class TestRolePrefixStripping:
    """角色前缀剥离"""

    def test_strip_colon_prefix(self):
        """去掉 角色名："""
        result = _strip_role_prefix("小明：快点走！", "小明")
        assert result == "快点走！"

    def test_strip_verb_colon_prefix(self):
        """去掉 角色名说："""
        result = _strip_role_prefix("小红说：知道了。", "小红")
        assert result == "知道了。"

    def test_no_role_no_strip(self):
        """无角色时不剥离"""
        result = _strip_role_prefix("这是一段旁白。", None)
        assert result == "这是一段旁白。"


# ────────────────────────────────────────────────────────────
# 端到端 analyze_script
# ────────────────────────────────────────────────────────────

class TestAnalyzeScriptE2E:
    """完整解析流程"""

    @pytest.fixture
    def sample_script(self):
        return (
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

    def test_chapter_count(self, sample_script):
        result = analyze_script(sample_script)
        assert len(result.chapters) == 2

    def test_chapter_titles(self, sample_script):
        result = analyze_script(sample_script)
        assert result.chapters[0].title == "第1章 夜路"
        assert result.chapters[1].title == "第2章 破庙"

    def test_detected_roles(self, sample_script):
        result = analyze_script(sample_script)
        role_names = {r.name for r in result.detected_roles}
        assert "小明" in role_names
        assert "小红" in role_names
        assert len(result.detected_roles) == 2

    def test_role_occurrences(self, sample_script):
        result = analyze_script(sample_script)
        roles = {r.name: r.occurrences for r in result.detected_roles}
        assert roles["小明"] >= 4
        assert roles["小红"] >= 4

    def test_segments_have_roles(self, sample_script):
        result = analyze_script(sample_script)
        ch1_roles = [s.role for s in result.chapters[0].segments]
        assert "小明" in ch1_roles
        assert "小红" in ch1_roles

    def test_narration_lines_no_role(self, sample_script):
        result = analyze_script(sample_script)
        for seg in result.chapters[0].segments:
            if "天色" in seg.text or "远处" in seg.text:
                assert seg.role is None

    def test_empty_text(self):
        result = analyze_script("")
        assert len(result.chapters) == 0
        assert len(result.detected_roles) == 0

    def test_no_chapter_format(self):
        """无章节格式的剧本"""
        text = "小明：走吧。\n小红：好的。\n小明：快点。\n小红：知道了。"
        result = analyze_script(text)
        assert len(result.chapters) == 1
        assert result.chapters[0].title == ""
        assert "小明" in {r.name for r in result.detected_roles}
