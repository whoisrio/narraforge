from app.source_elements import extract_source_elements


DOC = """# 第一章

这是第一段。

```python
def hello():
    return 1
```

![架构图](images/arch.png)

## 第二章

![流程](https://example.com/flow.svg)

普通段落。
"""


def test_extracts_code_blocks_with_chapter_index():
    elements = extract_source_elements(DOC)
    codes = [e for e in elements if e["kind"] == "code"]
    assert len(codes) == 1
    assert codes[0]["chapter_index"] == 0
    assert "def hello():" in codes[0]["excerpt"]


def test_extracts_images_with_ref():
    elements = extract_source_elements(DOC)
    images = [e for e in elements if e["kind"] == "image"]
    assert [i["ref"] for i in images] == ["images/arch.png", "https://example.com/flow.svg"]
    assert images[0]["excerpt"] == "架构图"
    assert images[1]["chapter_index"] == 1


def test_empty_document_returns_empty():
    assert extract_source_elements("") == []


def test_images_inside_code_block_are_ignored():
    doc = "```\n![not an image](x.png)\n```\n"
    elements = extract_source_elements(doc)
    assert [e["kind"] for e in elements] == ["code"]
