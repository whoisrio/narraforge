"""Deterministic extraction of code blocks and image refs from markdown.

The kv workflow needs to know which source-document chapters contain code
blocks or images so the animation-brief node can reference them. Parsing
markdown directly is more reliable than asking the LLM to recall them.
"""
from __future__ import annotations

import re

_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")


def extract_source_elements(source_document: str) -> list[dict]:
    """Return [{kind, ref, chapter_index, excerpt}] for code blocks and images.

    ``chapter_index`` counts markdown heading lines (``#`` / ``##`` ...) from 0;
    elements before the first heading get index 0.
    """
    elements: list[dict] = []
    chapter_index = -1
    in_code = False
    code_lines: list[str] = []
    for line in source_document.split("\n"):
        stripped = line.strip()
        if not in_code and stripped.startswith("#"):
            chapter_index += 1
        if stripped.startswith("```"):
            if in_code:
                elements.append(
                    {
                        "kind": "code",
                        "ref": "",
                        "chapter_index": max(chapter_index, 0),
                        "excerpt": "\n".join(code_lines)[:200],
                    }
                )
                code_lines = []
                in_code = False
            else:
                in_code = True
            continue
        if in_code:
            code_lines.append(line)
            continue
        for m in _IMAGE_RE.finditer(line):
            elements.append(
                {
                    "kind": "image",
                    "ref": m.group(2),
                    "chapter_index": max(chapter_index, 0),
                    "excerpt": m.group(1),
                }
            )
    return elements
