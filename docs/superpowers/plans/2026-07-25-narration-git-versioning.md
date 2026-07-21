# Narration Git Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scheduled git-based versioning for narration text content (project → chapters → segments) so historical state is queryable via `git log` without adding version tables to the app database. MVP is one-way: DB → serialized file tree → `git commit`. No checkout, no diff API, no frontend UI.

**Architecture:** A daily APScheduler job walks every `SegmentedProject`, serializes each into a stable file tree under a single meta git repo (`backend/data/narration-repo/projects/{slug}/…`), then runs `git add -A && git commit` if anything changed. Serialization is human-diffable Markdown + YAML with segment metadata inlined as HTML comments. Segment IDs are frozen on first split and never reused, so `git log --follow` history stays coherent across re-splits. Semantic IDs (project slug from pinyin, chapter `ch{NN}-{slug}`, segment `s{NNN}`) are migrated once with a CLI script.

**Tech Stack:** APScheduler, PyYAML, pypinyin, subprocess (git CLI), SQLAlchemy, pytest.

**Scope explicitly out of MVP:**
- Checkout / restore-from-history (no backfill from git into DB)
- `/api/versioning/*` HTTP endpoints
- Tags (per-release snapshots)
- Frontend UI (history view, diff view)
- Audio files in git (they stay under `backend/uploads/`; excluded via `.gitignore`)

These are natural follow-ups once the write path proves valuable in practice.

**Dependency on `feat/narration-workflow`:** The narration workflow agent produces the L3 text layer (script → edited_script) in LangGraph state only — there is currently no DB column for it. Task 2 adds `Chapter.narration_script`; the agent will need a follow-up commit on `feat/narration-workflow` to persist that field via a new backend endpoint. **This plan does not modify the agent.** It provides the persistence target and documents the contract.

---

## File Structure

### New files

| File | Responsibility |
|------|----------------|
| `backend/app/services/narration_versioning/__init__.py` | Package marker + public API re-exports |
| `backend/app/services/narration_versioning/config.py` | Runtime knobs (repo path, schedule cron, feature flag) |
| `backend/app/services/narration_versioning/ids.py` | Slug / chapter-id / segment-id generators + validators |
| `backend/app/services/narration_versioning/serializer.py` | DB row → file tree writer (pure I/O, no git) |
| `backend/app/services/narration_versioning/git_ops.py` | Subprocess wrapper: init/add/commit/status |
| `backend/app/services/narration_versioning/job.py` | Top-level "snapshot all projects" entrypoint |
| `backend/app/services/narration_versioning/scheduler.py` | APScheduler wiring; started on FastAPI startup |
| `backend/app/services/narration_versioning/id_migration.py` | One-shot ID migration logic (imported by CLI) |
| `backend/scripts/migrate_narration_ids.py` | CLI entrypoint: `uv run python -m scripts.migrate_narration_ids [--dry-run]` |
| `backend/scripts/__init__.py` | Package marker (may already exist) |
| `backend/tests/services/narration_versioning/__init__.py` | Test package marker |
| `backend/tests/services/narration_versioning/test_ids.py` | Slug / segment-id property tests |
| `backend/tests/services/narration_versioning/test_serializer.py` | Round-trip readability + inline-metadata tests |
| `backend/tests/services/narration_versioning/test_git_ops.py` | Git subprocess wrapper tests (uses tmp_path) |
| `backend/tests/services/narration_versioning/test_job.py` | End-to-end snapshot: DB fixture → repo commit assertion |
| `backend/tests/services/narration_versioning/test_id_migration.py` | Migration idempotency + dry-run tests |
| `docs/narration-git-versioning.md` | Design + operational notes (repo layout, ID rules, commit format) |

### Modified files

| File | Change |
|------|--------|
| `backend/app/models/segmented_project.py` | `SegmentedProjectChapter.narration_script = Column(Text, nullable=True)` |
| `backend/app/schemas/segmented_project.py` | `ChapterIn.narration_script: str \| None = None` |
| `backend/app/core/database.py` | New `_P13_NARRATION_SCRIPT_ALTER_STMTS` + append to `init_db` migration chain |
| `backend/main.py` | Start scheduler in existing `@app.on_event("startup")` |
| `backend/pyproject.toml` | Add `apscheduler>=3.10`, `pypinyin>=0.51`, `pyyaml>=6.0` to `dependencies` |
| `docs/ENV.md` | Document `NARRATION_REPO_PATH`, `NARRATION_SNAPSHOT_ENABLED`, `NARRATION_SNAPSHOT_CRON` |
| `docs/database-schema.md` | Document new `narration_script` column on `segmented_project_chapters` |
| `docs/api-reference.md` | Document `narration_script` in `ChapterIn` schema |
| `AGENTS.md` | Add `narration-git-versioning.md` row to Documentation table |

---

## Serialization contract (reference for all downstream tasks)

```
backend/data/narration-repo/
├── .git/
├── .gitignore              # projects/*/audio/
└── projects/
    └── {project_slug}/
        ├── project.yaml    # {id, name, layout, remotion_project_path, configs, ...}
        ├── source.md       # source_document (raw markdown, no wrapping)
        └── chapters/
            └── {chapter_id}/
                ├── chapter.yaml  # {id, position, name, design_title, voice}
                ├── original.md   # Chapter.original_text (L2)
                ├── script.md     # Chapter.narration_script (L3, may be empty)
                └── segments.md   # L4, each segment ~= one paragraph
```

### `segments.md` format

```markdown
<!-- s001 kind=narration -->
第一段的正文文本。可以有 markdown。

<!-- s002 kind=dialogue role=role_xm emotion=happy voice={"source":"role","role_id":"role_xm"} -->
"第二段是对话！" 她笑着说。

<!-- s003 kind=narration -->
第三段。
```

**Rules:**
- One HTML comment line = one segment header. Text starts on the next line.
- Blank line separates segments (visual only; not parsed as data).
- Header key set: `kind` (required), `role`, `emotion`, `voice` — each key uses `key=value` where value is a bare word / JSON blob. Unknown keys are round-tripped verbatim.
- Segment `id` (`s001` etc.) is the first bare token after `<!--`. Always present. Frozen at first split; new segments consume the smallest unused number; deleted IDs never reused (see Task 8 migration).
- `audio` / `generated_params` / `generated_at` are **not** written — they live in the DB and would create noisy diffs. Only text + structural metadata goes to git.

### Commit message format

```
snapshot: {N} project(s) updated ({YYYY-MM-DD HH:MM:SS} UTC)

Projects:
- {slug}: {chapters_changed}/{total_chapters} chapters
```

If nothing staged after `git add -A`, skip the commit entirely.

---

## Task 1: Add dependencies

**Files:**
- Modify: `backend/pyproject.toml`

- [ ] **Step 1: Add runtime deps**

In `backend/pyproject.toml`, append to `dependencies`:

```toml
    "apscheduler>=3.10",
    "pypinyin>=0.51",
    "pyyaml>=6.0",
```

(PyYAML may already be transitive; declare it explicitly since we use it directly.)

- [ ] **Step 2: Sync**

```bash
cd backend && uv sync --extra test
```

Expected: success, no version conflicts.

- [ ] **Step 3: Commit**

```bash
git add backend/pyproject.toml backend/uv.lock
git commit -m "deps(backend): apscheduler + pypinyin + pyyaml for narration versioning"
```

---

## Task 2: Add `narration_script` column to chapters

The narration workflow currently holds the L3 script only in LangGraph state. Persisting it to the DB is a prerequisite for including it in git snapshots.

**Files:**
- Modify: `backend/app/models/segmented_project.py`
- Modify: `backend/app/schemas/segmented_project.py`
- Modify: `backend/app/services/segmented_project_service.py`
- Modify: `backend/app/core/database.py`
- Modify: `docs/database-schema.md`
- Modify: `docs/api-reference.md`
- Test: `backend/tests/test_segmented_projects_api.py`

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_segmented_projects_api.py`:

```python
def test_chapter_narration_script_round_trips(client):
    project_id = "p_test_nscript"
    payload = {
        "id": project_id,
        "name": "T",
        "layout": "vertical",
        "chapters": [
            {
                "id": "c1",
                "position": 0,
                "name": "Ch1",
                "voice": {"engine": "edge_tts"},
                "split_config": {},
                "narration_script": "# 第一章\n改写后的旁白稿。",
                "segments": [],
            }
        ],
    }
    r = client.post("/api/segmented-projects", json=payload)
    assert r.status_code == 200, r.text

    r = client.get(f"/api/segmented-projects/{project_id}")
    assert r.status_code == 200
    got = r.json()
    assert got["chapters"][0]["narration_script"] == "# 第一章\n改写后的旁白稿。"

    payload["chapters"][0]["narration_script"] = "改写 v2"
    r = client.put(f"/api/segmented-projects/{project_id}", json=payload)
    assert r.status_code == 200
    r = client.get(f"/api/segmented-projects/{project_id}")
    assert r.json()["chapters"][0]["narration_script"] == "改写 v2"
```

- [ ] **Step 2: Verify it fails**

```bash
cd backend && uv run --extra test pytest tests/test_segmented_projects_api.py::test_chapter_narration_script_round_trips -q
```

Expected: FAIL.

- [ ] **Step 3: Add SQLAlchemy column**

In `backend/app/models/segmented_project.py`, in `class SegmentedProjectChapter`, immediately after the `original_text` line:

```python
    narration_script = Column(Text, nullable=True)
```

- [ ] **Step 4: Add Pydantic fields**

In `backend/app/schemas/segmented_project.py`, find `class ChapterIn(BaseModel)` and add near `original_text`:

```python
    narration_script: str | None = None
```

Mirror to `ChapterOut` if it exists. Verify:

```bash
grep -n "class Chapter" backend/app/schemas/segmented_project.py
```

- [ ] **Step 5: Ensure service layer round-trips it**

In `backend/app/services/segmented_project_service.py`, find every chapter conversion (DB → schema and schema → DB). Search:

```bash
grep -n "original_text\|design_title" backend/app/services/segmented_project_service.py
```

For every `original_text` occurrence in chapter mapping code, add a sibling `narration_script` handling with identical treatment.

- [ ] **Step 6: Add P13 migration**

In `backend/app/core/database.py`, after `_P12_VOICE_REF_ALTER_STMTS`:

```python
# P13: chapter-level narration script (L3 text layer).
_P13_NARRATION_SCRIPT_ALTER_STMTS = (
    "ALTER TABLE segmented_project_chapters ADD COLUMN narration_script TEXT",
)
```

Then append `+ _P13_NARRATION_SCRIPT_ALTER_STMTS` to the migration chain inside `init_db()`.

- [ ] **Step 7: Verify test now passes**

```bash
cd backend && uv run --extra test pytest tests/test_segmented_projects_api.py::test_chapter_narration_script_round_trips -q
cd backend && uv run --extra test pytest -q
```

Expected: both pass.

- [ ] **Step 8: Update docs**

In `docs/database-schema.md`, `segmented_project_chapters` field table, add row after `original_text`:

```markdown
| `narration_script` | Text | Yes | `NULL` | L3 narration script (edited); source for segment splitting |
```

In `docs/api-reference.md`, in `ChapterIn Schema`, add `narration_script` to the JSON example and field table (mirror `original_text`).

- [ ] **Step 9: Commit**

```bash
git add backend/app/models/segmented_project.py \
        backend/app/schemas/segmented_project.py \
        backend/app/services/segmented_project_service.py \
        backend/app/core/database.py \
        backend/tests/test_segmented_projects_api.py \
        docs/database-schema.md docs/api-reference.md
git commit -m "feat(chapter): add narration_script column (L3 text persistence)"
```

---

## Task 3: ID generators

**Files:**
- Create: `backend/app/services/narration_versioning/__init__.py`
- Create: `backend/app/services/narration_versioning/ids.py`
- Create: `backend/tests/services/narration_versioning/__init__.py`
- Test: `backend/tests/services/narration_versioning/test_ids.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/services/narration_versioning/test_ids.py`:

```python
import pytest
from app.services.narration_versioning.ids import (
    project_slug, chapter_id, next_segment_id,
    is_valid_slug, is_valid_segment_id,
)


class TestProjectSlug:
    def test_ascii_letters_lowercased(self):
        assert project_slug("Hello World") == "hello-world"

    def test_chinese_to_pinyin(self):
        assert project_slug("你好世界") == "ni-hao-shi-jie"

    def test_mixed_ascii_chinese(self):
        assert project_slug("DeepSeek 策略") == "deepseek-ce-lue"

    def test_strips_special_chars(self):
        assert project_slug("Foo/Bar_Baz!") == "foo-bar-baz"

    def test_collapses_dashes(self):
        assert project_slug("a---b") == "a-b"

    def test_trims_dashes(self):
        assert project_slug("--foo--") == "foo"

    def test_empty_falls_back(self):
        assert project_slug("") == "project"
        assert project_slug("!!!") == "project"

    def test_max_length(self):
        assert len(project_slug("a" * 100)) <= 40

    def test_deterministic(self):
        assert project_slug("测试项目") == project_slug("测试项目")


class TestChapterId:
    def test_position_and_slug(self):
        assert chapter_id(1, "开场白") == "ch01-kai-chang-bai"

    def test_pads_to_two_digits(self):
        assert chapter_id(9, "x").startswith("ch09-")
        assert chapter_id(12, "x").startswith("ch12-")

    def test_no_slug_when_empty(self):
        assert chapter_id(1, "") == "ch01"
        assert chapter_id(1, None) == "ch01"


class TestNextSegmentId:
    def test_first_is_s001(self):
        assert next_segment_id(existing=set()) == "s001"

    def test_deleted_ids_not_reused(self):
        assert next_segment_id(existing={"s001", "s003"}) == "s004"

    def test_after_100(self):
        existing = {f"s{i:03d}" for i in range(1, 101)}
        assert next_segment_id(existing=existing) == "s101"

    def test_ignores_legacy(self):
        assert next_segment_id(existing={"legacy-xyz"}) == "s001"


class TestValidators:
    @pytest.mark.parametrize("s,ok", [
        ("a", True), ("foo", True), ("foo-bar", True), ("a1b2", True),
        ("hello-世界", False), ("", False), ("-foo", False), ("foo-", False),
        ("a" * 41, False),
    ])
    def test_slug_shape(self, s, ok):
        assert is_valid_slug(s) is ok

    @pytest.mark.parametrize("s,ok", [
        ("s001", True), ("s999", True),
        ("s0001", False), ("s1", False),
        ("S001", False), ("segment-1", False),
    ])
    def test_segment_id_shape(self, s, ok):
        assert is_valid_segment_id(s) is ok
```

- [ ] **Step 2: Verify tests fail**

```bash
cd backend && uv run --extra test pytest tests/services/narration_versioning/test_ids.py -q
```

Expected: FAIL — import errors.

- [ ] **Step 3: Create package + implement**

Create `backend/app/services/narration_versioning/__init__.py`:

```python
"""Narration git versioning service.

One-way DB → file tree → git commit snapshot pipeline.
See docs/narration-git-versioning.md.
"""
```

Create `backend/tests/services/narration_versioning/__init__.py` (empty file — just marks the dir as a package).

Create `backend/app/services/narration_versioning/ids.py`:

```python
"""Semantic ID generators for the git versioning file tree.

Stability contract:
- Project slug: lowercase [a-z0-9-], 1..40 chars, pinyin-based for Chinese.
- Chapter id:   `ch{NN}-{slug}` from (position, design_title/name).
- Segment id:   `s{NNN}` — frozen at first split; deleted IDs never reused.
"""
from __future__ import annotations

import re
from typing import Iterable

from pypinyin import lazy_pinyin

_ALPHA_NUM = re.compile(r"[a-z0-9]+")
_SEGMENT_ID_RE = re.compile(r"^s\d{3}$")
_SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

MAX_SLUG_LEN = 40


def _to_slug(text: str) -> str:
    if not text:
        return ""
    tokens: list[str] = []
    for piece in lazy_pinyin(text):
        for m in _ALPHA_NUM.finditer(piece.lower()):
            tokens.append(m.group(0))
    slug = "-".join(tokens)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug[:MAX_SLUG_LEN].rstrip("-")


def project_slug(name: str | None) -> str:
    slug = _to_slug(name or "")
    return slug or "project"


def chapter_id(position: int, title: str | None) -> str:
    prefix = f"ch{int(position):02d}"
    slug = _to_slug(title or "")
    return f"{prefix}-{slug}" if slug else prefix


def next_segment_id(existing: Iterable[str]) -> str:
    used = {int(sid[1:]) for sid in existing if _SEGMENT_ID_RE.match(sid)}
    n = 1
    while n in used:
        n += 1
    return f"s{n:03d}"


def is_valid_slug(s: str) -> bool:
    return bool(s) and len(s) <= MAX_SLUG_LEN and bool(_SLUG_RE.match(s))


def is_valid_segment_id(s: str) -> bool:
    return bool(_SEGMENT_ID_RE.match(s))
```

- [ ] **Step 4: Verify tests pass**

```bash
cd backend && uv run --extra test pytest tests/services/narration_versioning/test_ids.py -q
```

Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/narration_versioning/__init__.py \
        backend/app/services/narration_versioning/ids.py \
        backend/tests/services/narration_versioning/__init__.py \
        backend/tests/services/narration_versioning/test_ids.py
git commit -m "feat(versioning): semantic id generators (slug, chapter, segment)"
```

---

## Task 4: File tree serializer

Pure I/O module: given a `SegmentedProject`-like object, write it to a target directory. No git calls.

**Files:**
- Create: `backend/app/services/narration_versioning/serializer.py`
- Test: `backend/tests/services/narration_versioning/test_serializer.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/services/narration_versioning/test_serializer.py`:

```python
from pathlib import Path

from app.services.narration_versioning.serializer import (
    write_project, parse_segments_md,
)


class _Obj:
    def __init__(self, **kw): self.__dict__.update(kw)


def _make_project():
    ch = _Obj(
        id="ch01-opening", project_id="deepseek-strategy",
        position=1, name="Opening", design_title="开场白",
        voice={"engine": "edge_tts"}, split_config={},
        original_text="章节原文。",
        narration_script="# 开场白\n改写后。",
        segments=[
            _Obj(id="s001", chapter_id="ch01-opening", position=0,
                 text="第一段文本。", segment_kind="narration",
                 role_id=None, emotion=None, voice={"source": "chapter"}),
            _Obj(id="s002", chapter_id="ch01-opening", position=1,
                 text="第二段。", segment_kind="dialogue",
                 role_id="role_xm", emotion="happy",
                 voice={"source": "role", "role_id": "role_xm"}),
            _Obj(id="s003", chapter_id="ch01-opening", position=2,
                 text="第三段\n带换行。", segment_kind="narration",
                 role_id=None, emotion=None, voice={"source": "chapter"}),
        ],
    )
    return _Obj(
        id="deepseek-strategy", name="DeepSeek 策略", layout="vertical",
        active_chapter_id=None, animation_theme=None,
        remotion_project_path=None, default_narrator_role_id=None,
        configs={"description": "test project"},
        source_document="# 源文档\n正文。",
        chapters=[ch],
    )


def test_write_project_creates_expected_tree(tmp_path):
    proj = _make_project()
    root = tmp_path / "repo"
    write_project(proj, root)

    proj_dir = root / "projects" / "deepseek-strategy"
    assert (proj_dir / "project.yaml").exists()
    assert (proj_dir / "source.md").read_text() == "# 源文档\n正文。"

    ch_dir = proj_dir / "chapters" / "ch01-opening"
    assert (ch_dir / "chapter.yaml").exists()
    assert (ch_dir / "original.md").read_text() == "章节原文。"
    assert (ch_dir / "script.md").read_text() == "# 开场白\n改写后。"

    segs = (ch_dir / "segments.md").read_text()
    assert "<!-- s001 kind=narration -->" in segs
    assert "第一段文本。" in segs
    assert "<!-- s002 kind=dialogue role=role_xm emotion=happy" in segs
    assert "第三段\n带换行。" in segs


def test_write_is_idempotent(tmp_path):
    proj = _make_project()
    root = tmp_path / "repo"
    write_project(proj, root)
    p = root / "projects" / "deepseek-strategy" / "chapters" / "ch01-opening" / "segments.md"
    snapshot_1 = p.read_text()
    write_project(proj, root)
    snapshot_2 = p.read_text()
    assert snapshot_1 == snapshot_2


def test_deleted_chapter_dir_is_swept(tmp_path):
    proj = _make_project()
    root = tmp_path / "repo"
    write_project(proj, root)
    proj.chapters = []
    write_project(proj, root)
    ch_dir = root / "projects" / "deepseek-strategy" / "chapters" / "ch01-opening"
    assert not ch_dir.exists()


def test_optional_files_deleted_when_null(tmp_path):
    proj = _make_project()
    root = tmp_path / "repo"
    write_project(proj, root)
    ch_dir = root / "projects" / "deepseek-strategy" / "chapters" / "ch01-opening"
    assert (ch_dir / "script.md").exists()
    proj.chapters[0].narration_script = None
    proj.source_document = None
    write_project(proj, root)
    assert not (ch_dir / "script.md").exists()
    assert not (root / "projects" / "deepseek-strategy" / "source.md").exists()


def test_parse_segments_md_round_trip():
    text = (
        '<!-- s001 kind=narration -->\n'
        '第一段。\n\n'
        '<!-- s002 kind=dialogue role=role_xm emotion=happy -->\n'
        '"你好！"\n'
    )
    parsed = parse_segments_md(text)
    assert parsed[0] == {"id": "s001", "kind": "narration", "text": "第一段。"}
    assert parsed[1] == {
        "id": "s002", "kind": "dialogue",
        "role": "role_xm", "emotion": "happy", "text": '"你好！"',
    }
```

- [ ] **Step 2: Verify fails**

```bash
cd backend && uv run --extra test pytest tests/services/narration_versioning/test_serializer.py -q
```

Expected: FAIL — import errors.

- [ ] **Step 3: Implement**

Create `backend/app/services/narration_versioning/serializer.py`:

```python
"""Serialize a SegmentedProject-like object to a git-friendly file tree.

Layout (rooted at `root/projects/{project.id}/`):
    project.yaml
    source.md            (only when source_document non-null)
    chapters/{chapter.id}/
        chapter.yaml
        original.md      (only when original_text non-null)
        script.md        (only when narration_script non-null)
        segments.md      (one HTML comment header + text block per segment)

YAML output uses sort_keys=True for deterministic diffs.
Chapter subdirs no longer in the input are removed so `git status`
reflects deletions.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml


def write_project(project, root: Path) -> Path:
    proj_dir = root / "projects" / project.id
    proj_dir.mkdir(parents=True, exist_ok=True)

    _write_yaml(proj_dir / "project.yaml", {
        "id": project.id,
        "name": project.name,
        "layout": project.layout,
        "active_chapter_id": getattr(project, "active_chapter_id", None),
        "animation_theme": getattr(project, "animation_theme", None),
        "remotion_project_path": getattr(project, "remotion_project_path", None),
        "default_narrator_role_id": getattr(project, "default_narrator_role_id", None),
        "configs": getattr(project, "configs", None) or {},
    })
    _write_text_or_delete(proj_dir / "source.md", getattr(project, "source_document", None))

    chapters_dir = proj_dir / "chapters"
    chapters_dir.mkdir(exist_ok=True)
    written = set()
    for ch in project.chapters:
        ch_dir = chapters_dir / ch.id
        ch_dir.mkdir(exist_ok=True)
        written.add(ch_dir.name)
        _write_yaml(ch_dir / "chapter.yaml", {
            "id": ch.id,
            "position": ch.position,
            "name": ch.name,
            "design_title": getattr(ch, "design_title", None),
            "voice": getattr(ch, "voice", None) or {},
            "split_config": getattr(ch, "split_config", None) or {},
        })
        _write_text_or_delete(ch_dir / "original.md", getattr(ch, "original_text", None))
        _write_text_or_delete(ch_dir / "script.md", getattr(ch, "narration_script", None))
        _write_segments_md(ch_dir / "segments.md", ch.segments)

    for stale in chapters_dir.iterdir():
        if stale.is_dir() and stale.name not in written:
            _rmtree(stale)
    return proj_dir


def _write_yaml(path: Path, data: dict[str, Any]) -> None:
    path.write_text(
        yaml.safe_dump(data, sort_keys=True, allow_unicode=True, default_flow_style=False),
        encoding="utf-8",
    )


def _write_text_or_delete(path: Path, text: str | None) -> None:
    if text is None:
        if path.exists():
            path.unlink()
        return
    path.write_text(text, encoding="utf-8")


def _write_segments_md(path: Path, segments) -> None:
    parts: list[str] = []
    for seg in segments:
        parts.append(_segment_header(seg))
        parts.append(seg.text if seg.text is not None else "")
        parts.append("")
    body = "\n".join(parts).rstrip() + "\n"
    path.write_text(body, encoding="utf-8")


def _segment_header(seg) -> str:
    parts = [seg.id, f"kind={seg.segment_kind}"]
    if getattr(seg, "role_id", None):
        parts.append(f"role={seg.role_id}")
    if getattr(seg, "emotion", None):
        parts.append(f"emotion={seg.emotion}")
    voice = getattr(seg, "voice", None) or {}
    if voice and voice != {"source": "chapter"}:
        parts.append(f"voice={json.dumps(voice, ensure_ascii=False, sort_keys=True, separators=(',', ':'))}")
    return "<!-- " + " ".join(parts) + " -->"


def _rmtree(p: Path) -> None:
    for child in p.iterdir():
        if child.is_dir():
            _rmtree(child)
        else:
            child.unlink()
    p.rmdir()


# ── reader (round-trip aid; used by tests and future checkout work) ──────────

_HEADER_RE = re.compile(r"^<!--\s+(s\d{3})\s+(.*?)\s+-->$")


def parse_segments_md(text: str) -> list[dict]:
    out: list[dict] = []
    current: dict | None = None
    body: list[str] = []
    for line in text.splitlines():
        m = _HEADER_RE.match(line)
        if m:
            if current is not None:
                current["text"] = "\n".join(body).strip("\n")
                out.append(current)
            current = {"id": m.group(1)}
            for pair in _iter_kv(m.group(2)):
                k, v = pair
                try:
                    current[k] = json.loads(v)
                except (ValueError, json.JSONDecodeError):
                    current[k] = v
            body = []
        elif current is not None:
            body.append(line)
    if current is not None:
        current["text"] = "\n".join(body).strip("\n")
        out.append(current)
    return out


def _iter_kv(header_body: str):
    """Yield (key, raw_value_str). Splits on top-level whitespace, respecting `{...}` blocks."""
    i, n = 0, len(header_body)
    while i < n:
        while i < n and header_body[i].isspace():
            i += 1
        j = i
        while j < n and header_body[j] != "=":
            j += 1
        if j >= n:
            return
        key = header_body[i:j]
        j += 1  # skip '='
        start = j
        depth = 0
        while j < n:
            c = header_body[j]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
            elif c.isspace() and depth == 0:
                break
            j += 1
        yield key, header_body[start:j]
        i = j
```

- [ ] **Step 4: Verify tests pass**

```bash
cd backend && uv run --extra test pytest tests/services/narration_versioning/test_serializer.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/narration_versioning/serializer.py \
        backend/tests/services/narration_versioning/test_serializer.py
git commit -m "feat(versioning): serialize project to markdown+yaml file tree"
```

---

## Task 5: Git ops wrapper

Thin subprocess wrapper around `git` CLI (not pygit2/dulwich — CLI is universally available and the surface is tiny).

**Files:**
- Create: `backend/app/services/narration_versioning/git_ops.py`
- Test: `backend/tests/services/narration_versioning/test_git_ops.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/services/narration_versioning/test_git_ops.py`:

```python
import subprocess
from pathlib import Path

from app.services.narration_versioning.git_ops import (
    ensure_repo, add_all, has_staged_changes, commit, git_log,
)


def _sh(cmd: list[str], cwd: Path) -> str:
    return subprocess.check_output(cmd, cwd=cwd, text=True)


def test_ensure_repo_initializes(tmp_path):
    repo = tmp_path / "r"
    ensure_repo(repo, author_name="NarraForge Bot", author_email="bot@narraforge.local")
    assert (repo / ".git").is_dir()
    assert _sh(["git", "config", "user.name"], repo).strip() == "NarraForge Bot"


def test_ensure_repo_writes_gitignore(tmp_path):
    repo = tmp_path / "r"
    ensure_repo(repo, author_name="a", author_email="a@a")
    assert "projects/*/audio/" in (repo / ".gitignore").read_text()


def test_ensure_repo_is_idempotent(tmp_path):
    repo = tmp_path / "r"
    ensure_repo(repo, author_name="a", author_email="a@a")
    (repo / "marker.txt").write_text("keep me")
    subprocess.check_call(["git", "add", "marker.txt"], cwd=repo)
    subprocess.check_call(
        ["git", "-c", "user.name=x", "-c", "user.email=x@x", "commit", "-m", "seed"],
        cwd=repo,
    )
    ensure_repo(repo, author_name="a", author_email="a@a")
    assert (repo / "marker.txt").exists()


def test_has_staged_changes(tmp_path):
    repo = tmp_path / "r"
    ensure_repo(repo, author_name="a", author_email="a@a")
    (repo / "x.md").write_text("hi")
    add_all(repo)
    assert has_staged_changes(repo) is True
    commit(repo, "seed")
    assert has_staged_changes(repo) is False


def test_commit_returns_sha(tmp_path):
    repo = tmp_path / "r"
    ensure_repo(repo, author_name="a", author_email="a@a")
    (repo / "x.md").write_text("hi")
    add_all(repo)
    sha = commit(repo, "seed")
    assert sha is not None and len(sha) == 40


def test_commit_no_staged_returns_none(tmp_path):
    repo = tmp_path / "r"
    ensure_repo(repo, author_name="a", author_email="a@a")
    (repo / "x.md").write_text("hi")
    add_all(repo)
    commit(repo, "seed")
    assert commit(repo, "empty") is None


def test_git_log_filtered_by_path(tmp_path):
    repo = tmp_path / "r"
    ensure_repo(repo, author_name="a", author_email="a@a")
    (repo / "projects").mkdir()
    (repo / "projects" / "a").mkdir()
    (repo / "projects" / "b").mkdir()
    (repo / "projects" / "a" / "x.md").write_text("1")
    (repo / "projects" / "b" / "y.md").write_text("1")
    add_all(repo); commit(repo, "both")

    (repo / "projects" / "a" / "x.md").write_text("2")
    add_all(repo); commit(repo, "only a")

    log_a = git_log(repo, path_filter="projects/a", limit=10)
    log_b = git_log(repo, path_filter="projects/b", limit=10)
    assert len(log_a) == 2
    assert len(log_b) == 1
```

- [ ] **Step 2: Verify fails**

```bash
cd backend && uv run --extra test pytest tests/services/narration_versioning/test_git_ops.py -q
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `backend/app/services/narration_versioning/git_ops.py`:

```python
"""Thin subprocess wrapper around `git`. Not thread-safe."""
from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path


class GitError(RuntimeError):
    pass


DEFAULT_GITIGNORE = (
    "# Audio files live under backend/uploads/, tracked by DB metadata only.\n"
    "projects/*/audio/\n"
)


def ensure_repo(repo: Path, *, author_name: str, author_email: str) -> None:
    repo.mkdir(parents=True, exist_ok=True)
    if not (repo / ".git").is_dir():
        _run(["git", "init", "-q", "-b", "main"], cwd=repo)
    _run(["git", "config", "user.name", author_name], cwd=repo)
    _run(["git", "config", "user.email", author_email], cwd=repo)
    gitignore = repo / ".gitignore"
    if not gitignore.exists() or "projects/*/audio/" not in gitignore.read_text():
        gitignore.write_text(DEFAULT_GITIGNORE)


def add_all(repo: Path) -> None:
    _run(["git", "add", "-A"], cwd=repo)


def has_staged_changes(repo: Path) -> bool:
    proc = _run_raw(["git", "diff", "--cached", "--quiet"], cwd=repo)
    if proc.returncode in (0, 1):
        return proc.returncode == 1
    raise GitError(f"git diff --cached failed: {proc.stderr}")


def commit(repo: Path, message: str) -> str | None:
    if not has_staged_changes(repo):
        return None
    _run(["git", "commit", "-q", "-m", message], cwd=repo)
    return _run(["git", "rev-parse", "HEAD"], cwd=repo).stdout.strip()


@dataclass
class GitLogEntry:
    sha: str
    timestamp: str
    subject: str


def git_log(repo: Path, *, path_filter: str | None = None, limit: int = 50) -> list[GitLogEntry]:
    cmd = ["git", "log", f"-{limit}", "--pretty=format:%H\x1f%cI\x1f%s"]
    if path_filter:
        cmd += ["--", path_filter]
    result = _run(cmd, cwd=repo)
    entries: list[GitLogEntry] = []
    for line in result.stdout.splitlines():
        parts = line.split("\x1f", 2)
        if len(parts) == 3:
            entries.append(GitLogEntry(sha=parts[0], timestamp=parts[1], subject=parts[2]))
    return entries


def _run(cmd: list[str], *, cwd: Path) -> subprocess.CompletedProcess:
    p = _run_raw(cmd, cwd=cwd)
    if p.returncode != 0:
        raise GitError(f"git failed ({p.returncode}): {' '.join(cmd)}\n{p.stderr}")
    return p


def _run_raw(cmd: list[str], *, cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
```

- [ ] **Step 4: Verify tests pass**

```bash
cd backend && uv run --extra test pytest tests/services/narration_versioning/test_git_ops.py -q
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/narration_versioning/git_ops.py \
        backend/tests/services/narration_versioning/test_git_ops.py
git commit -m "feat(versioning): git ops wrapper (init, add, commit, log)"
```

---

## Task 6: Config module

**Files:**
- Create: `backend/app/services/narration_versioning/config.py`

- [ ] **Step 1: Implement**

Create `backend/app/services/narration_versioning/config.py`:

```python
"""Runtime configuration for narration versioning.

Values are read from environment variables. Kept in a module (not app.core.
config.Settings) so tests can monkeypatch cleanly without touching global
settings, and so the feature can be disabled via env without a schema change.
"""
from __future__ import annotations

import os
from pathlib import Path


def repo_path() -> Path:
    """Absolute path to the narration meta-repo.

    Default: `<repo-root>/backend/data/narration-repo/`.
    """
    default = Path(__file__).resolve().parents[4] / "backend" / "data" / "narration-repo"
    return Path(os.getenv("NARRATION_REPO_PATH", str(default))).expanduser().resolve()


def snapshot_enabled() -> bool:
    return os.getenv("NARRATION_SNAPSHOT_ENABLED", "1").lower() not in ("0", "false", "no", "")


def snapshot_cron() -> str:
    """APScheduler CronTrigger string. Default: every day at 03:00 local time."""
    return os.getenv("NARRATION_SNAPSHOT_CRON", "0 3 * * *")


def author_name() -> str:
    return os.getenv("NARRATION_GIT_AUTHOR_NAME", "NarraForge Bot")


def author_email() -> str:
    return os.getenv("NARRATION_GIT_AUTHOR_EMAIL", "bot@narraforge.local")
```

- [ ] **Step 2: Sanity check**

```bash
cd backend && uv run python -c "from app.services.narration_versioning.config import repo_path, snapshot_cron; print(repo_path()); print(snapshot_cron())"
```

Expected: prints absolute path ending in `backend/data/narration-repo` and `0 3 * * *`.

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/narration_versioning/config.py
git commit -m "feat(versioning): config module (env-driven knobs)"
```

---

## Task 7: Snapshot job

Composes serializer + git_ops. Iterates all projects, writes the tree, commits.

**Files:**
- Create: `backend/app/services/narration_versioning/job.py`
- Test: `backend/tests/services/narration_versioning/test_job.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/services/narration_versioning/test_job.py`:

```python
import subprocess

from app.services.narration_versioning.job import snapshot_all
from app.services.narration_versioning.git_ops import git_log


def _seed_project(client, pid="deepseek-strategy", name="DeepSeek 策略"):
    payload = {
        "id": pid,
        "name": name,
        "layout": "vertical",
        "source_document": "# 源",
        "chapters": [
            {
                "id": "ch01-opening",
                "position": 1,
                "name": "Opening",
                "design_title": "开场白",
                "voice": {"engine": "edge_tts"},
                "split_config": {},
                "original_text": "原文。",
                "narration_script": "改写。",
                "segments": [
                    {"id": "s001", "position": 0, "text": "第一段。",
                     "segment_kind": "narration", "voice": {"source": "chapter"}},
                    {"id": "s002", "position": 1, "text": "第二段。",
                     "segment_kind": "narration", "voice": {"source": "chapter"}},
                ],
            }
        ],
    }
    r = client.post("/api/segmented-projects", json=payload)
    assert r.status_code == 200, r.text


def test_snapshot_creates_initial_commit(client, tmp_path):
    _seed_project(client)
    repo = tmp_path / "repo"
    result = snapshot_all(repo=repo)
    assert result.commit_sha is not None
    assert result.projects_snapshotted == 1
    log = git_log(repo, limit=10)
    assert len(log) == 1
    assert log[0].subject.startswith("snapshot:")


def test_snapshot_noop_when_nothing_changed(client, tmp_path):
    _seed_project(client)
    repo = tmp_path / "repo"
    snapshot_all(repo=repo)
    result2 = snapshot_all(repo=repo)
    assert result2.commit_sha is None
    assert len(git_log(repo, limit=10)) == 1


def test_snapshot_records_second_commit_after_edit(client, tmp_path):
    _seed_project(client)
    repo = tmp_path / "repo"
    snapshot_all(repo=repo)

    r = client.get("/api/segmented-projects/deepseek-strategy")
    proj = r.json()
    proj["chapters"][0]["narration_script"] = "改写 v2"
    r = client.put("/api/segmented-projects/deepseek-strategy", json=proj)
    assert r.status_code == 200

    result = snapshot_all(repo=repo)
    assert result.commit_sha is not None
    assert len(git_log(repo, limit=10)) == 2


def test_snapshot_message_contains_project_slug(client, tmp_path):
    _seed_project(client)
    repo = tmp_path / "repo"
    snapshot_all(repo=repo)
    log_out = subprocess.check_output(
        ["git", "log", "-1", "--format=%B"], cwd=repo, text=True,
    )
    assert "deepseek-strategy" in log_out
```

Assumes `client` (FastAPI TestClient) fixture from `backend/tests/conftest.py`. Verify with:

```bash
grep -n "def client\|def db_session\|@pytest.fixture" backend/tests/conftest.py | head -20
```

- [ ] **Step 2: Verify fails**

```bash
cd backend && uv run --extra test pytest tests/services/narration_versioning/test_job.py -q
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `backend/app/services/narration_versioning/job.py`:

```python
"""Top-level snapshot pipeline.

Reads every SegmentedProject from the DB, serializes to the meta repo,
and commits if anything changed.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.segmented_project import SegmentedProject

from . import config
from .git_ops import add_all, commit, ensure_repo
from .serializer import write_project

log = logging.getLogger(__name__)


@dataclass
class SnapshotResult:
    commit_sha: str | None
    projects_snapshotted: int
    repo_path: Path


def snapshot_all(*, repo: Path | None = None, session: Session | None = None) -> SnapshotResult:
    """Run the full snapshot pipeline. Returns a result summary."""
    repo_dir = repo or config.repo_path()
    ensure_repo(
        repo_dir,
        author_name=config.author_name(),
        author_email=config.author_email(),
    )

    own_session = session is None
    session = session or SessionLocal()
    try:
        projects = session.query(SegmentedProject).all()
        for p in projects:
            write_project(p, repo_dir)

        add_all(repo_dir)
        message = _commit_message(projects)
        sha = commit(repo_dir, message)
        if sha:
            log.info("narration snapshot: %s (%d projects)", sha[:8], len(projects))
        else:
            log.info("narration snapshot: no changes")
        return SnapshotResult(
            commit_sha=sha,
            projects_snapshotted=len(projects),
            repo_path=repo_dir,
        )
    finally:
        if own_session:
            session.close()


def _commit_message(projects) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    lines = [f"snapshot: {len(projects)} project(s) ({ts})", "", "Projects:"]
    for p in projects:
        chapters = list(p.chapters or [])
        segments_total = sum(len(ch.segments or []) for ch in chapters)
        lines.append(f"- {p.id}: {len(chapters)} chapter(s), {segments_total} segment(s)")
    return "\n".join(lines) + "\n"
```

- [ ] **Step 4: Verify tests pass**

```bash
cd backend && uv run --extra test pytest tests/services/narration_versioning/test_job.py -q
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/narration_versioning/job.py \
        backend/tests/services/narration_versioning/test_job.py
git commit -m "feat(versioning): snapshot_all pipeline (serialize + commit)"
```

---

## Task 8: ID migration CLI

One-shot migration to backfill semantic IDs onto existing projects. Idempotent; supports `--dry-run`.

**Files:**
- Create: `backend/app/services/narration_versioning/id_migration.py`
- Create: `backend/scripts/__init__.py` (if missing)
- Create: `backend/scripts/migrate_narration_ids.py`
- Test: `backend/tests/services/narration_versioning/test_id_migration.py`

**Design notes:**

- Renames primary keys via a build-plan-then-apply pattern: collect `{old_id → new_id}` maps for projects/chapters/segments, then in one transaction issue UPDATEs (parents first, then FK columns on children).
- SQLite (default) allows PK updates but child FKs are enforced by default. The migration temporarily runs `PRAGMA foreign_keys = OFF` for the duration of the update block.
- Slug collisions resolved with `-{blake2s(old_id, digest_size=2).hex}` suffix; further collisions get an index suffix.
- Chapters/segments ordered by `position` (ties by `created_at`) so `ch01`, `ch02`... reflect UI order.

- [ ] **Step 1: Write failing tests**

Create `backend/tests/services/narration_versioning/test_id_migration.py`:

```python
from app.services.narration_versioning.id_migration import migrate_ids


def test_migrate_assigns_semantic_ids(db_session):
    from app.models.segmented_project import (
        SegmentedProject, SegmentedProjectChapter, SegmentedProjectSegment,
    )

    proj = SegmentedProject(
        id="legacy-uid-abc123",
        name="DeepSeek 策略",
        layout="vertical",
    )
    ch = SegmentedProjectChapter(
        id="legacy-ch-xyz",
        project_id=proj.id,
        position=1,
        name="Opening",
        design_title="开场白",
        voice={}, split_config={},
    )
    ch.segments = [
        SegmentedProjectSegment(
            id="legacy-seg-1", chapter_id=ch.id, position=0,
            text="A", segment_kind="narration", voice={"source": "chapter"},
        ),
        SegmentedProjectSegment(
            id="legacy-seg-2", chapter_id=ch.id, position=1,
            text="B", segment_kind="narration", voice={"source": "chapter"},
        ),
    ]
    proj.chapters = [ch]
    db_session.add(proj)
    db_session.commit()

    result = migrate_ids(session=db_session)
    assert result.projects_migrated == 1
    assert result.chapters_migrated == 1
    assert result.segments_migrated == 2

    db_session.expire_all()
    migrated = db_session.query(SegmentedProject).one()
    assert migrated.id == "deepseek-ce-lue"
    assert migrated.chapters[0].id == "ch01-kai-chang-bai"
    assert [s.id for s in migrated.chapters[0].segments] == ["s001", "s002"]


def test_migrate_is_idempotent(db_session):
    from app.models.segmented_project import SegmentedProject
    proj = SegmentedProject(id="deepseek-ce-lue", name="DeepSeek 策略", layout="vertical")
    db_session.add(proj); db_session.commit()
    result = migrate_ids(session=db_session)
    assert result.projects_migrated == 0


def test_migrate_dry_run_does_not_write(db_session):
    from app.models.segmented_project import SegmentedProject
    proj = SegmentedProject(id="legacy-abc", name="Foo", layout="vertical")
    db_session.add(proj); db_session.commit()
    result = migrate_ids(session=db_session, dry_run=True)
    assert result.projects_migrated == 1
    db_session.expire_all()
    assert db_session.query(SegmentedProject).one().id == "legacy-abc"


def test_slug_collision_resolved_with_hash(db_session):
    from app.models.segmented_project import SegmentedProject
    a = SegmentedProject(id="legacy-a", name="测试", layout="vertical")
    b = SegmentedProject(id="legacy-b", name="测试", layout="vertical")
    db_session.add_all([a, b]); db_session.commit()

    migrate_ids(session=db_session)
    db_session.expire_all()
    ids = sorted(p.id for p in db_session.query(SegmentedProject).all())
    assert ids[0] == "ce-shi"
    assert ids[1].startswith("ce-shi-") and len(ids[1]) > len("ce-shi-")
```

- [ ] **Step 2: Verify fails**

```bash
cd backend && uv run --extra test pytest tests/services/narration_versioning/test_id_migration.py -q
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `backend/app/services/narration_versioning/id_migration.py`:

```python
"""One-shot migration: assign semantic IDs to legacy projects/chapters/segments.

Idempotent — rows already conforming are skipped. Slug collisions resolved
by suffixing a short blake2s hash of the original id.

Runs inside a single transaction. On SQLite, temporarily disables FK
enforcement so PK updates can propagate before we rewrite child FKs.
"""
from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.segmented_project import SegmentedProject
from .ids import (
    project_slug, chapter_id,
    is_valid_slug, is_valid_segment_id,
)

log = logging.getLogger(__name__)


@dataclass
class MigrationResult:
    projects_migrated: int
    chapters_migrated: int
    segments_migrated: int


def _short_hash(s: str) -> str:
    return hashlib.blake2s(s.encode("utf-8"), digest_size=2).hexdigest()


def _unique(base: str, taken: set[str], legacy_id: str) -> str:
    if base not in taken:
        return base
    candidate = f"{base}-{_short_hash(legacy_id)}"
    n = 1
    while candidate in taken:
        candidate = f"{base}-{_short_hash(legacy_id)}-{n}"
        n += 1
    return candidate


def migrate_ids(*, session: Session, dry_run: bool = False) -> MigrationResult:
    projects = session.query(SegmentedProject).order_by(SegmentedProject.created_at).all()
    taken_project_ids = {p.id for p in projects}

    project_rename: dict[str, str] = {}
    for p in projects:
        base = project_slug(p.name)
        if is_valid_slug(p.id) and p.id == base:
            continue
        new_id = _unique(base, taken_project_ids - {p.id}, p.id)
        if new_id != p.id:
            project_rename[p.id] = new_id
            taken_project_ids.discard(p.id)
            taken_project_ids.add(new_id)

    chapter_rename: dict[str, str] = {}
    segment_rename: dict[str, str] = {}
    for p in projects:
        chapters = sorted(p.chapters, key=lambda c: (c.position, c.created_at or ""))
        taken_ch = {c.id for c in chapters}
        for pos_1based, ch in enumerate(chapters, start=1):
            wanted = chapter_id(pos_1based, ch.design_title or ch.name)
            if not (is_valid_slug(ch.id) and ch.id == wanted):
                new_ch_id = _unique(wanted, taken_ch - {ch.id}, ch.id)
                if new_ch_id != ch.id:
                    chapter_rename[ch.id] = new_ch_id
                    taken_ch.discard(ch.id); taken_ch.add(new_ch_id)

            segs = sorted(ch.segments, key=lambda s: s.position)
            existing_ids = [s.id for s in segs]
            wanted_ids = [f"s{i:03d}" for i in range(1, len(segs) + 1)]
            if existing_ids != wanted_ids:
                for old_id, new_id in zip(existing_ids, wanted_ids):
                    if old_id != new_id:
                        segment_rename[old_id] = new_id

    result = MigrationResult(
        projects_migrated=len(project_rename),
        chapters_migrated=len(chapter_rename),
        segments_migrated=len(segment_rename),
    )

    if dry_run or not (project_rename or chapter_rename or segment_rename):
        return result

    _apply(session, project_rename, chapter_rename, segment_rename)
    session.commit()
    return result


def _apply(session: Session, project_rename, chapter_rename, segment_rename) -> None:
    is_sqlite = session.bind.dialect.name == "sqlite"
    if is_sqlite:
        session.execute(text("PRAGMA foreign_keys = OFF"))
    try:
        for old, new in project_rename.items():
            session.execute(text("UPDATE segmented_projects SET id = :new WHERE id = :old"),
                            {"new": new, "old": old})
            session.execute(text("UPDATE segmented_project_chapters SET project_id = :new WHERE project_id = :old"),
                            {"new": new, "old": old})
        for old, new in chapter_rename.items():
            session.execute(text("UPDATE segmented_project_chapters SET id = :new WHERE id = :old"),
                            {"new": new, "old": old})
            session.execute(text("UPDATE segmented_project_segments SET chapter_id = :new WHERE chapter_id = :old"),
                            {"new": new, "old": old})
        for old, new in segment_rename.items():
            session.execute(text("UPDATE segmented_project_segments SET id = :new WHERE id = :old"),
                            {"new": new, "old": old})
    finally:
        if is_sqlite:
            session.execute(text("PRAGMA foreign_keys = ON"))
```

- [ ] **Step 4: Create CLI**

Ensure `backend/scripts/__init__.py` exists (empty). Create `backend/scripts/migrate_narration_ids.py`:

```python
"""CLI: migrate legacy project/chapter/segment IDs to semantic form.

Usage:
    uv run python -m scripts.migrate_narration_ids            # apply
    uv run python -m scripts.migrate_narration_ids --dry-run  # preview
"""
from __future__ import annotations

import argparse
import logging
import sys

from app.core.database import SessionLocal, init_db
from app.services.narration_versioning.id_migration import migrate_ids


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dry-run", action="store_true", help="Preview without writing")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    init_db()

    session = SessionLocal()
    try:
        result = migrate_ids(session=session, dry_run=args.dry_run)
    finally:
        session.close()

    prefix = "[dry-run] " if args.dry_run else ""
    print(f"{prefix}Projects renamed:  {result.projects_migrated}")
    print(f"{prefix}Chapters renamed:  {result.chapters_migrated}")
    print(f"{prefix}Segments renamed:  {result.segments_migrated}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: Verify tests pass**

```bash
cd backend && uv run --extra test pytest tests/services/narration_versioning/test_id_migration.py -q
```

Expected: PASS (4 tests).

- [ ] **Step 6: Dry-run on the dev DB**

```bash
cd backend && uv run python -m scripts.migrate_narration_ids --dry-run
```

Inspect output. If reasonable, apply:

```bash
cd backend && uv run python -m scripts.migrate_narration_ids
```

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/narration_versioning/id_migration.py \
        backend/scripts/__init__.py \
        backend/scripts/migrate_narration_ids.py \
        backend/tests/services/narration_versioning/test_id_migration.py
git commit -m "feat(versioning): CLI to migrate legacy ids to semantic form"
```

---

## Task 9: APScheduler wiring + startup hook

**Files:**
- Create: `backend/app/services/narration_versioning/scheduler.py`
- Modify: `backend/main.py`
- Modify: `docs/ENV.md`
- Modify: `AGENTS.md`
- Create: `docs/narration-git-versioning.md`

- [ ] **Step 1: Implement scheduler**

Create `backend/app/services/narration_versioning/scheduler.py`:

```python
"""APScheduler wiring for the daily snapshot job.

Uses BackgroundScheduler so it runs in-process without external services.
The job is idempotent and short-lived (seconds), so pause/resume across
restarts is unnecessary.
"""
from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from . import config
from .job import snapshot_all

log = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def start() -> None:
    """Start the background scheduler if enabled. Safe to call multiple times."""
    global _scheduler
    if _scheduler is not None:
        log.debug("narration scheduler already running")
        return
    if not config.snapshot_enabled():
        log.info("narration snapshot disabled by env NARRATION_SNAPSHOT_ENABLED=0")
        return

    cron_expr = config.snapshot_cron()
    trigger = CronTrigger.from_crontab(cron_expr)
    sched = BackgroundScheduler(daemon=True)
    sched.add_job(
        _safe_snapshot,
        trigger=trigger,
        id="narration_snapshot",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    sched.start()
    _scheduler = sched
    log.info("narration snapshot scheduler started (cron=%r)", cron_expr)


def shutdown() -> None:
    """Stop the scheduler (used in tests and clean shutdown paths)."""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None


def _safe_snapshot() -> None:
    """Wrapper: catch and log exceptions so the scheduler survives failures."""
    try:
        result = snapshot_all()
        log.info(
            "narration snapshot done: sha=%s, projects=%d",
            (result.commit_sha or "no-op")[:8],
            result.projects_snapshotted,
        )
    except Exception:  # noqa: BLE001
        log.exception("narration snapshot failed")
```

- [ ] **Step 2: Wire into FastAPI startup**

In `backend/main.py`, replace the existing startup event:

```python
@app.on_event("startup")
def startup():
    init_db()
```

with:

```python
@app.on_event("startup")
def startup():
    init_db()
    from app.services.narration_versioning.scheduler import start as _start_versioning_scheduler
    _start_versioning_scheduler()


@app.on_event("shutdown")
def shutdown():
    from app.services.narration_versioning.scheduler import shutdown as _stop_versioning_scheduler
    _stop_versioning_scheduler()
```

The lazy import keeps app boot fast and avoids importing APScheduler on cold paths (e.g. `alembic` command runs).

- [ ] **Step 3: Smoke test — scheduler starts and stops cleanly**

```bash
cd backend && uv run python -c "
import logging; logging.basicConfig(level=logging.INFO)
from app.services.narration_versioning import scheduler
scheduler.start(); scheduler.shutdown(); print('OK')
"
```

Expected: prints `narration snapshot scheduler started (cron=…)` then `OK` without exceptions.

- [ ] **Step 4: Run the full backend suite**

```bash
cd backend && uv run --extra test pytest -q
```

Expected: all pass (previous baseline: 288 passed, 2 skipped, +N from the new tests here).

- [ ] **Step 5: Update ENV docs**

In `docs/ENV.md`, add section:

```markdown
## Narration Git Versioning

| Variable | Default | Purpose |
|---|---|---|
| `NARRATION_SNAPSHOT_ENABLED` | `1` | Toggle the daily snapshot job. `0`/`false` disables. |
| `NARRATION_REPO_PATH` | `backend/data/narration-repo` | Absolute or ~-expandable path to the meta git repo. Created on first startup. |
| `NARRATION_SNAPSHOT_CRON` | `0 3 * * *` | APScheduler CronTrigger spec (5 fields: minute hour dom month dow). Default = daily at 03:00 server local time. |
| `NARRATION_GIT_AUTHOR_NAME` | `NarraForge Bot` | Commit author name. |
| `NARRATION_GIT_AUTHOR_EMAIL` | `bot@narraforge.local` | Commit author email. |
```

- [ ] **Step 6: Update AGENTS.md**

In the Documentation table (search for `| Feature specification |`), add row:

```markdown
| Narration git versioning | `docs/narration-git-versioning.md` | Scheduled DB → git snapshot pipeline (semantic ids, repo layout, commit format). |
```

- [ ] **Step 7: Create ops doc**

Create `docs/narration-git-versioning.md`:

```markdown
# Narration Git Versioning

Automatic, one-way persistence of narration text content into a git repo so history is queryable via standard `git log`. No app-DB version tables; no manual triggers required.

## Where it lives

```
backend/data/narration-repo/
├── .git/
├── .gitignore
└── projects/{slug}/
    ├── project.yaml
    ├── source.md
    └── chapters/{ch-id}/
        ├── chapter.yaml
        ├── original.md
        ├── script.md
        └── segments.md
```

Path is overridable via `NARRATION_REPO_PATH`.

## Semantic IDs

- **Project slug** — pinyin of project name, `[a-z0-9-]`, 1–40 chars. Collisions get a `-<hash>` suffix. Users can override in the DB (any conforming string works).
- **Chapter id** — `ch{NN}-{title-slug}`. `NN` is zero-padded 1-based position.
- **Segment id** — `s{NNN}`. Frozen at first split. Deleted IDs never reused (`git log --follow segments.md` stays coherent).

## Serialization contract

- YAML `sort_keys=True`, no flow style — every write is deterministic.
- `segments.md` header format: `<!-- s001 kind=narration role=… emotion=… voice=… -->`.
- Text bodies are raw markdown; multi-line preserved.
- `configs`, `voice`, `split_config` written as YAML maps for readability.
- Audio metadata (`audio`, `generated_params`, `generated_at`) is **not** written.

## Schedule

Default: daily 03:00 local, cron `0 3 * * *`. Override via `NARRATION_SNAPSHOT_CRON`.
Toggle whole job with `NARRATION_SNAPSHOT_ENABLED=0`.

## Manual run

```bash
cd backend && uv run python -c "
from app.services.narration_versioning.job import snapshot_all
r = snapshot_all(); print(r)
"
```

## Migrating legacy IDs

Existing installations must run the one-shot migration before the first snapshot:

```bash
cd backend && uv run python -m scripts.migrate_narration_ids --dry-run  # preview
cd backend && uv run python -m scripts.migrate_narration_ids            # apply
```

Idempotent — safe to re-run.

## Commit message format

```
snapshot: N project(s) (YYYY-MM-DD HH:MM:SS UTC)

Projects:
- {slug}: {chapters} chapter(s), {segments} segment(s)
```

Empty snapshots (no diff) skip the commit entirely.

## Out of scope for MVP

- Checkout / restore from history (write-only pipeline)
- HTTP API for history browsing
- Tags per release
- Frontend UI (`git log --follow` on the CLI is the interface)
- Audio versioning (mp3/wav are excluded via `.gitignore`)
```

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/narration_versioning/scheduler.py \
        backend/main.py \
        docs/ENV.md docs/narration-git-versioning.md AGENTS.md
git commit -m "feat(versioning): APScheduler daily snapshot + ops docs"
```

---

## Task 10: End-to-end smoke test

**Files:**
- Test: `backend/tests/services/narration_versioning/test_e2e_smoke.py`

- [ ] **Step 1: Write the smoke test**

Create `backend/tests/services/narration_versioning/test_e2e_smoke.py`:

```python
"""End-to-end: seed via API → migrate ids → snapshot → verify git history."""
import subprocess

from app.services.narration_versioning.id_migration import migrate_ids
from app.services.narration_versioning.job import snapshot_all


def test_full_pipeline(client, db_session, tmp_path):
    # Seed with legacy IDs
    r = client.post("/api/segmented-projects", json={
        "id": "legacy-project-abc",
        "name": "端到端测试",
        "layout": "vertical",
        "chapters": [{
            "id": "legacy-ch-1",
            "position": 1,
            "name": "章节一",
            "design_title": "序章",
            "voice": {"engine": "edge_tts"}, "split_config": {},
            "original_text": "原文。",
            "narration_script": "改写。",
            "segments": [
                {"id": "legacy-seg-1", "position": 0, "text": "一。",
                 "segment_kind": "narration", "voice": {"source": "chapter"}},
                {"id": "legacy-seg-2", "position": 1, "text": "二。",
                 "segment_kind": "narration", "voice": {"source": "chapter"}},
            ],
        }],
    })
    assert r.status_code == 200

    # Migrate IDs
    m = migrate_ids(session=db_session)
    assert m.projects_migrated == 1
    assert m.chapters_migrated == 1
    assert m.segments_migrated == 2

    # Snapshot
    repo = tmp_path / "repo"
    result = snapshot_all(repo=repo)
    assert result.commit_sha is not None

    # Verify tree
    proj_dir = repo / "projects" / "duan-dao-duan-ce-shi"
    assert (proj_dir / "project.yaml").exists()
    assert (proj_dir / "chapters" / "ch01-xu-zhang" / "segments.md").exists()

    # Verify git log
    out = subprocess.check_output(["git", "log", "--oneline"], cwd=repo, text=True)
    assert len(out.strip().splitlines()) == 1

    # Idempotent second run
    result2 = snapshot_all(repo=repo)
    assert result2.commit_sha is None
```

- [ ] **Step 2: Run**

```bash
cd backend && uv run --extra test pytest tests/services/narration_versioning/test_e2e_smoke.py -q
```

Expected: PASS.

- [ ] **Step 3: Full suite regression check**

```bash
cd backend && uv run --extra test pytest -q
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/services/narration_versioning/test_e2e_smoke.py
git commit -m "test(versioning): end-to-end smoke — seed + migrate + snapshot"
```

---

## Post-MVP follow-ups (not in this plan)

Documented here so they're not forgotten but explicitly deferred:

1. **Persist `narration_script` from the agent.** Add a backend endpoint the agent can call after `script_review` completes, e.g. `PATCH /api/segmented-projects/{id}/chapters/{cid}/narration-script`. Wire the agent's `state.narration_script` / `state.edited_script` into that call. Lives on `feat/narration-workflow`, not here.
2. **Checkout / history browsing.** `POST /api/narration-versioning/restore` reads a `git show` blob back into the DB (respecting semantic IDs). Requires a merge/conflict UI on the frontend.
3. **`git diff` API.** Return a structured diff of two commits (project/chapter/segment adds/removes/modifies) so a future history view can render it.
4. **Tags.** Automatic tag on major state transitions (e.g. "synthesis complete for chapter X").
5. **Frontend history view.** Read-only timeline per project, driven by `git log --follow` + the diff API.
6. **Audio manifest snapshotting.** Not the audio itself (too big for git) but a `chapters/{ch}/audio.yaml` listing filenames + durations. Enables verifying that a historical text version matches a specific audio build.

---

## Self-Review Checklist (for the author)

**Spec coverage:**
- ✅ Scheduled snapshot (APScheduler) — Task 9
- ✅ Single meta repo + subdirectories — serializer layout + Task 5 gitignore
- ✅ Markdown + YAML + HTML comments — Task 4 serializer
- ✅ Segment ID stability + no reuse — `next_segment_id` (Task 3) + migration deterministic mapping (Task 8)
- ✅ Audio excluded — `.gitignore` in `ensure_repo`
- ✅ Inline segment metadata — `_segment_header` (Task 4)
- ✅ Pinyin slug + user-overridable — `project_slug` uses pinyin; DB `id` column accepts any conforming string, no unique constraint added
- ✅ APScheduler in-process — Task 9
- ✅ `Chapter.narration_script` added — Task 2

**Placeholder scan:** none of "TBD" / "implement later" / "similar to Task N" present. All code shown inline.

**Type consistency:**
- `SnapshotResult(commit_sha, projects_snapshotted, repo_path)` used consistently in `job.py` and tests.
- `MigrationResult(projects_migrated, chapters_migrated, segments_migrated)` used consistently in `id_migration.py`, CLI, and tests.
- `snapshot_all(*, repo=None, session=None)` signature consistent across `job.py`, tests, and doc example.
- `ensure_repo(repo, *, author_name, author_email)` — kwargs-only after `repo` — consistent everywhere.

**Known unknowns to verify at execution time:**
- The exact `db_session` / `client` fixture names in `backend/tests/conftest.py` (Task 4/7 flag this explicitly).
- Whether the existing service layer preserves the payload `id` for projects/chapters/segments (Task 7 assumes yes; the P9000 test in `test_segmented_projects_api.py` already confirms this pattern).
- Whether `pypinyin` produces `ce-lue` for `策略` — the tests will catch a mismatch. If pypinyin outputs a different form (e.g. `cè-lüè` before ASCII stripping), the `_ALPHA_NUM` regex will still handle it (accents get dropped). Any legitimate pinyin difference is trivially adjustable in the test.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-25-narration-git-versioning.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Tasks are sized 2–8 steps each; a subagent per task with a checkpoint review after 2 and 5 works well.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints after each task.

**Which approach?**
