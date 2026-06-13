"""P2 v3+ Markdown 检测 + 切分测试."""
from __future__ import annotations


# ===== 测试用 markdown 文档 =====

SAMPLE_MD = """# DeepSeek 战略拆解

> 这是一段引言。说明本文背景。
> 应该在章节边界前。

## 第 1 章 · 战略起源

2026 年开年，AI 产业进入深水区。
DeepSeek 以极致成本训练出 R1 模型。

### MLA 多头潜在注意力

这是 H3 标题, 应当被并入 H2 第 1 章。

## 第 2 章 · 技术路线

先说 MLA。传统 Transformer 的 KV 缓存会随着序列长度线性增长。
再说 DualPath。

## 短章

只是几行内容, 应被合并。

## 第 3 章 · 产业映射

技术再强, 最终要落到产业。

```python
# 代码块里的 # 不当标题
def foo():
    return 1
```

# 这是代码块外的 H1 应该是另一个文档标题 (本测试忽略)
"""


def test_markdown_detect_basic(client):
    r = client.post("/api/text-split/markdown-detect", json={"text": SAMPLE_MD})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["doc_title"] == "DeepSeek 战略拆解"
    # 候选标题: H2 4个 + H3 1个 = 5
    levels = [c["level"] for c in data["candidates"]]
    assert levels.count(2) == 4
    assert levels.count(3) == 1
    # 默认推荐: H2 切, 短章合并, front_matter prepend.
    # 最少 2 章 (ch1 含引言, ch2 单独), 短章合到 ch3 后会保留 ch3.
    chapters = data["chapters"]
    assert len(chapters) >= 2
    # 必有 ch1 (引言+第 1 章) 和 ch2
    titles = [ch["title"] for ch in chapters]
    assert any("第 1 章 · 战略起源" in t for t in titles)
    assert any("第 2 章 · 技术路线" in t for t in titles)
    # 第 3 章 存在 (可能合并了"短章")
    assert any("第 3 章 · 产业映射" in t or "产业映射" in t for t in titles)


def test_markdown_detect_short_chapter_merged(client):
    """短章 (15字) < min_chars (80字) 合并到下一章."""
    r = client.post(
        "/api/text-split/markdown-detect",
        json={"text": SAMPLE_MD, "min_chars": 80},
    )
    data = r.json()
    # "短章" + "第 3 章 · 产业映射" 合并: 标题应是 "短章 · 第 3 章 · 产业映射"
    titles = [ch["title"] for ch in data["chapters"]]
    # 短章是 H2, 短于 80 字, 合并到下一章
    assert not any("短章" == t for t in titles), f"短章未被合并: {titles}"
    # 找到含"短章"+"产业映射"合并的章节
    assert any("短章" in t and "产业映射" in t for t in titles), \
        f"短章+产业映射合并未生效: {titles}"


def test_markdown_detect_is_chinese_chapter_flag(client):
    """is_chinese_chapter 标识第 N 章 格式 (H2)."""
    r = client.post("/api/text-split/markdown-detect", json={"text": SAMPLE_MD})
    data = r.json()
    # 抽所有第 N 章 格式的 H2 候选
    chinese_h2 = [c for c in data["candidates"]
                 if c["level"] == 2 and c.get("is_chinese_chapter")]
    assert len(chinese_h2) >= 3  # SAMPLE_MD 至少 3 个 "第 N 章"
    # 非第 N 章 格式的 H2 (如 "短章") 应该是 False
    non_chinese_h2 = [c for c in data["candidates"]
                     if c["level"] == 2 and not c.get("is_chinese_chapter")]
    assert any("短章" in c["raw"] for c in non_chinese_h2)


def test_markdown_detect_code_block_excluded(client):
    """fenced code block 内的 # 不算标题, code block 外的 H1 只作 doc_title."""
    r = client.post("/api/text-split/markdown-detect", json={"text": SAMPLE_MD})
    data = r.json()
    # doc_title 取第一个 H1 (从 SAMPLE 顺序看应该是 "DeepSeek 战略拆解", 不是末尾的)
    assert data["doc_title"] == "DeepSeek 战略拆解"
    # candidates 不含 H1 (H1 只作 doc_title, 不作章节)
    titles = [c["raw"] for c in data["candidates"]]
    assert not any(t.startswith("代码块外的 H1") for t in titles)
    # candidates 都是 H2/H3
    for c in data["candidates"]:
        assert c["level"] >= 2


def test_markdown_detect_no_headings(client):
    """无标题文档: 整篇当 1 章."""
    text = "这是纯文本。没有标题。"
    r = client.post("/api/text-split/markdown-detect", json={"text": text})
    data = r.json()
    assert data["doc_title"] is None
    assert len(data["chapters"]) == 1
    assert data["chapters"][0]["title"] == "全文"
    assert data["chapters"][0]["char_count"] == len(text)


def test_markdown_detect_empty_text(client):
    r = client.post("/api/text-split/markdown-detect", json={"text": ""})
    assert r.status_code == 422  # Pydantic 校验: min_length=1


def test_markdown_detect_front_matter_modes(client):
    text = """这是引言段落, 没有任何标题在上面。
另一个引言行。

## 第一章

正文内容。
"""
    # 模式 1: prepend_to_first (默认 min_chars=80, 引言 30 字不算短章)
    # 但引言 30 字 < min_chars 80, 短章合并: 引言被合到第一章 → 1 章
    r = client.post(
        "/api/text-split/markdown-detect",
        json={"text": text, "front_matter_mode": "prepend_to_first", "min_chars": 10},
    )
    data = r.json()
    assert len(data["chapters"]) == 1
    assert data["chapters"][0]["start_char"] == 0  # 引言已拼
    assert "含引言" in data["chapters"][0]["title"]

    # 模式 2: own_chapter - 引言独立成章
    r = client.post(
        "/api/text-split/markdown-detect",
        json={"text": text, "front_matter_mode": "own_chapter", "min_chars": 10},
    )
    data = r.json()
    assert len(data["chapters"]) == 2
    assert data["chapters"][0]["title"] == "引言"

    # 模式 3: skip - 引言直接扔
    r = client.post(
        "/api/text-split/markdown-detect",
        json={"text": text, "front_matter_mode": "skip", "min_chars": 10},
    )
    data = r.json()
    assert len(data["chapters"]) == 1
    assert data["chapters"][0]["start_char"] > 0  # 引言被跳


def test_markdown_split_custom_levels(client):
    """用户指定 levels=[1, 2]: H1 和 H2 都切, 但 H1 仍作 doc_title."""
    # 关闭短章合并 (min_chars=0) 简化期望
    r = client.post(
        "/api/text-split/markdown-split",
        json={"text": SAMPLE_MD, "levels": [1, 2], "min_chars": 0},
    )
    data = r.json()
    # doc_title 还是 H1
    assert data["doc_title"] == "DeepSeek 战略拆解"
    # used_levels 回显
    assert data["used_levels"] == [1, 2]
    # 4 个 H2 候选全部成章节
    assert len(data["chapters"]) == 4
    # chapters 标题里没有 H1
    for ch in data["chapters"]:
        assert ch["level"] == 2


def test_markdown_split_only_h3(client):
    """levels=[3]: 只用 H3 当章节边界, H2 不切."""
    r = client.post(
        "/api/text-split/markdown-split",
        json={"text": SAMPLE_MD, "levels": [3]},
    )
    data = r.json()
    # 整篇当 1 章 (只有一个 H3)
    assert len(data["chapters"]) == 1


def test_markdown_split_invalid_levels(client):
    """levels 越界报错."""
    r = client.post(
        "/api/text-split/markdown-split",
        json={"text": SAMPLE_MD, "levels": [0, 7]},
    )
    assert r.status_code == 400


def test_markdown_split_text_slice_correct(client):
    """切片边界正确: 用切片能拿回原始内容."""
    r = client.post(
        "/api/text-split/markdown-detect",
        json={"text": SAMPLE_MD, "min_chars": 0},  # 关闭合并
    )
    data = r.json()
    # 拿回"第 1 章"内容
    ch1 = next(ch for ch in data["chapters"] if "第 1 章" in ch["title"])
    content = SAMPLE_MD[ch1["start_char"]:ch1["end_char"]]
    assert "战略起源" in content
    assert "MLA 多头潜在注意力" in content  # H3 内容并入


def test_chapter_preserves_actual_position(client):
    """start_char / end_char 严格反映原文字符位置."""
    text = "前导内容\n\n## 第一章\n\n第一章正文\n\n## 第二章\n\n第二章正文"
    r = client.post(
        "/api/text-split/markdown-detect",
        json={"text": text, "min_chars": 0},
    )
    data = r.json()
    # 默认 front_matter prepend → 1 章 (前导 + 第一章 + 第二章 拼一起)
    # 简化: 改 own_chapter 模式
    r = client.post(
        "/api/text-split/markdown-detect",
        json={"text": text, "min_chars": 0, "front_matter_mode": "own_chapter"},
    )
    data = r.json()
    assert len(data["chapters"]) == 3
    ch_intro, ch1, ch2 = data["chapters"]
    # 切片验证
    assert "前导内容" in text[ch_intro["start_char"]:ch_intro["end_char"]]
    assert "第一章正文" in text[ch1["start_char"]:ch1["end_char"]]
    assert "第一章正文" not in text[ch2["start_char"]:ch2["end_char"]]
    assert "第二章正文" in text[ch2["start_char"]:ch2["end_char"]]
    # 边界
    assert ch1["end_char"] == ch2["start_char"]
