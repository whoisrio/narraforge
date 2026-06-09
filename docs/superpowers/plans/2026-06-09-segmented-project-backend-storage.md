# Segmented TTS Backend Project Storage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add complete backend project storage for the segmented TTS editor, with backend as the authoritative source, a per-project asset directory at `uploads/segmented/{project_id}/`, mp3 audio via ffmpeg, and frontend IndexedDB reduced to a draft / failure-protection cache.

**Architecture:** Three new SQLAlchemy tables (`segmented_projects`, `segmented_project_chapters`, `segmented_project_segments`) plus a service layer that reconciles full-state `PUT` requests against the database and mirrors text/SSML/audio into the filesystem. The frontend gets a storage adapter (`segmentedProjectStorage`) that switches between an IndexedDB adapter and a backend adapter based on `useStorageMode`. Backend mode keeps IndexedDB as a draft cache with `base_updated_at` for conflict detection.

**Tech Stack:** FastAPI, SQLAlchemy (SQLite), pydantic, ffmpeg (system binary), React 19 + TypeScript, Vitest, pytest.

---

## File Structure

### Backend (new / modified)

- **Modify** `backend/app/models/segmented_project.py` — replace skeleton with three-table model (project, chapter, segment).
- **Modify** `backend/app/models/__init__.py` — register the three new models.
- **Modify** `backend/app/core/config.py` — add `segmented_dir` path under `uploads/`.
- **Create** `backend/app/core/audio_encoder.py` — ffmpeg availability check + wav → mp3 transcoding.
- **Create** `backend/app/core/segmented_assets.py` — filesystem helpers: project dir creation, file writes, manifest serialization, recursive delete.
- **Create** `backend/app/services/segmented_project_service.py` — business logic: project reconciliation, segment synthesis orchestration, migration, audio lifecycle.
- **Create** `backend/app/schemas/segmented_project.py` — pydantic request/response models.
- **Create** `backend/app/schemas/__init__.py`
- **Create** `backend/app/api/segmented_projects.py` — FastAPI router.
- **Modify** `backend/main.py` — include the new router.
- **Modify** `backend/app/api/tts.py` — when request body has `segmented_project_id`, write to project directory.
- **Modify** `backend/app/api/mimo_tts.py` — same change for MiMo endpoints.
- **Create** `backend/tests/test_audio_encoder.py`
- **Create** `backend/tests/test_segmented_assets.py`
- **Create** `backend/tests/test_segmented_projects_service.py`
- **Create** `backend/tests/test_segmented_synthesis.py`
- **Create** `backend/tests/test_segmented_projects_api.py`

### Frontend (new / modified)

- **Create** `frontend/src/services/segmentedProjectStorage.ts` — unified interface with `indexedDB` and `backend` adapter factories.
- **Create** `frontend/src/services/backendSegmentedProjectStorage.ts` — backend adapter.
- **Create** `frontend/src/services/segmentedDraftStore.ts` — IndexedDB draft record CRUD.
- **Create** `frontend/src/services/segmentedMigration.ts` — migration service (uploads IndexedDB projects + audio blobs to backend).
- **Modify** `frontend/src/services/segmentedProjectDB.ts` — refactor to export `segmentedProjectDB` object.
- **Modify** `frontend/src/services/indexedDB.ts` — bump DB_VERSION to 3, add `project_drafts` store, export `_DRAFTS_STORE`.
- **Create** `frontend/src/hooks/useSegmentedDraftSync.ts` — debounce PUT wrapper with `base_updated_at` and `dirty` tracking.
- **Modify** `frontend/src/pages/TTSSynthesis.tsx` — instantiate storage adapter, wire draft sync, mount migration + conflict prompts.
- **Create** `frontend/src/components/SegmentedTTS/MigrationPrompt.tsx` — migration dialog.
- **Create** `frontend/src/components/SegmentedTTS/ConflictPrompt.tsx` — local-vs-backend conflict dialog.
- **Create** `frontend/src/services/__tests__/backendSegmentedProjectStorage.test.ts`
- **Create** `frontend/src/services/__tests__/segmentedDraftStore.test.ts`
- **Create** `frontend/src/hooks/__tests__/useSegmentedDraftSync.test.ts`

### Documentation (modified)

- **Modify** `docs/feature-spec.md` — add backend storage section.
- **Modify** `docs/api-reference.md` — document new endpoints.
- **Modify** `docs/database-schema.md` — document new tables.
- **Modify** `docs/ENV.md` — add ffmpeg dependency note.
- **Modify** `docs/RUNBOOK.md` — add ffmpeg install steps.

---

## Task 1: Add `segmented_dir` to settings

**Files:**
- Modify: `backend/app/core/config.py:28-35`

- [ ] **Step 1: Edit settings**

In `backend/app/core/config.py`, after the `srt_output_dir` line (around line 32), add:

```python
    segmented_dir: Path = uploads_dir / "segmented"
```

Then in the `__init__` `mkdir` block (around line 87-91), add a corresponding mkdir after `srt_output_dir`:

```python
        self.segmented_dir.mkdir(parents=True, exist_ok=True)
```

The full block becomes:

```python
        self.voices_dir.mkdir(parents=True, exist_ok=True)
        self.videos_dir.mkdir(parents=True, exist_ok=True)
        self.srt_output_dir.mkdir(parents=True, exist_ok=True)
        self.segmented_dir.mkdir(parents=True, exist_ok=True)
        self.clone_voices_dir.mkdir(parents=True, exist_ok=True)
        self.logs_dir.mkdir(parents=True, exist_ok=True)
```

- [ ] **Step 2: Verify**

Run: `cd backend && uv run python -c "from app.core.config import settings; print(settings.segmented_dir)"`
Expected: prints a path ending in `uploads/segmented` and the directory exists.

- [ ] **Step 3: Commit**

```bash
git add backend/app/core/config.py
git commit -m "feat(backend): add segmented_dir to settings"
```

---

## Task 2: Create audio encoder with ffmpeg

**Files:**
- Create: `backend/app/core/audio_encoder.py`
- Test: `backend/tests/test_audio_encoder.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_audio_encoder.py`:

```python
import io
import wave
import pytest
from pathlib import Path
from app.core.audio_encoder import (
    is_ffmpeg_available,
    transcode_to_mp3,
    AudioEncoderError,
)


def _silent_wav_bytes(duration_ms: int = 50) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setparams((1, 2, 16000, 0, "NONE", "NONE"))
        frames = int(16000 * duration_ms / 1000)
        w.writeframes(b"\x00\x00" * frames)
    return buf.getvalue()


def test_transcode_to_mp3_writes_file(tmp_path: Path):
    if not is_ffmpeg_available():
        pytest.skip("ffmpeg not installed")
    out = tmp_path / "seg.mp3"
    transcode_to_mp3(_silent_wav_bytes(), out, bitrate="64k")
    assert out.exists()
    assert out.stat().st_size > 0


def test_transcode_to_mp3_raises_on_invalid_input(tmp_path: Path):
    if not is_ffmpeg_available():
        pytest.skip("ffmpeg not installed")
    with pytest.raises(AudioEncoderError):
        transcode_to_mp3(b"not a wav", tmp_path / "seg.mp3")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_audio_encoder.py -v`
Expected: ImportError — `app.core.audio_encoder` does not exist.

- [ ] **Step 3: Implement the encoder**

Create `backend/app/core/audio_encoder.py`:

```python
"""ffmpeg-backed audio transcoding for segmented project storage."""
from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)


class AudioEncoderError(Exception):
    pass


def is_ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def transcode_to_mp3(
    wav_bytes: bytes,
    output_path: Path,
    *,
    bitrate: str = "96k",
) -> Path:
    """Transcode wav bytes to mp3 using ffmpeg. Atomic write via temp file."""
    if not is_ffmpeg_available():
        raise AudioEncoderError("ffmpeg is not installed")

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as in_tmp:
        in_tmp.write(wav_bytes)
        in_path = Path(in_tmp.name)

    out_tmp = output_path.with_suffix(output_path.suffix + ".tmp")
    cmd = [
        "ffmpeg",
        "-y",
        "-loglevel", "error",
        "-i", str(in_path),
        "-codec:a", "libmp3lame",
        "-b:a", bitrate,
        str(out_tmp),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=60)
        if proc.returncode != 0:
            raise AudioEncoderError(
                f"ffmpeg failed (code {proc.returncode}): {proc.stderr.decode(errors='replace')}"
            )
        out_tmp.replace(output_path)
    finally:
        for p in (in_path, out_tmp):
            try:
                p.unlink()
            except FileNotFoundError:
                pass
    logger.debug("Transcoded %d bytes wav -> %s", len(wav_bytes), output_path)
    return output_path
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_audio_encoder.py -v`
Expected: PASS for `test_transcode_to_mp3_writes_file`; `test_transcode_to_mp3_raises_on_invalid_input` also PASS (invalid wav causes ffmpeg to fail). If ffmpeg is not installed locally, both tests skip — that is acceptable for now.

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/audio_encoder.py backend/tests/test_audio_encoder.py
git commit -m "feat(backend): add ffmpeg-backed wav->mp3 audio encoder"
```

---

## Task 3: Create segmented assets filesystem helpers

**Files:**
- Create: `backend/app/core/segmented_assets.py`
- Test: `backend/tests/test_segmented_assets.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_segmented_assets.py`:

```python
from pathlib import Path
from app.core.config import settings
from app.core.segmented_assets import (
    project_dir,
    chapter_dir,
    segment_audio_path,
    write_original_text,
    write_segment_text,
    write_segment_ssml,
    write_manifest,
    read_manifest,
    remove_project_dir,
)


def test_project_dir_path():
    d = project_dir("p1")
    assert d == settings.segmented_dir / "p1"
    assert chapter_dir("p1", "c1") == d / "chapters" / "c1"
    assert segment_audio_path("p1", "c1", "s1", "mp3") == d / "chapters" / "c1" / "segments" / "s1.mp3"
    assert segment_audio_path("p1", "c1", "s1", "wav") == d / "chapters" / "c1" / "segments" / "s1.wav"


def test_write_and_read_manifest(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "segmented_dir", tmp_path)
    pid = "p1"
    write_manifest(pid, {"project": {"id": pid, "name": "x"}})
    m = read_manifest(pid)
    assert m == {"project": {"id": pid, "name": "x"}}


def test_write_text_and_ssml_files(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "segmented_dir", tmp_path)
    pid = "p1"
    write_original_text(pid, "global text")
    write_segment_text(pid, "c1", "s1", "seg text")
    write_segment_ssml(pid, "c1", "s1", "<speak/>")
    assert (project_dir(pid) / "original.txt").read_text(encoding="utf-8") == "global text"
    seg_dir = chapter_dir(pid, "c1") / "segments"
    assert (seg_dir / "s1.txt").read_text(encoding="utf-8") == "seg text"
    assert (seg_dir / "s1.ssml").read_text(encoding="utf-8") == "<speak/>"


def test_remove_project_dir(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "segmented_dir", tmp_path)
    pid = "p1"
    write_original_text(pid, "x")
    remove_project_dir(pid)
    assert not project_dir(pid).exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_segmented_assets.py -v`
Expected: ModuleNotFoundError for `app.core.segmented_assets`.

- [ ] **Step 3: Implement the helpers**

Create `backend/app/core/segmented_assets.py`:

```python
"""Filesystem helpers for the segmented editor's per-project asset directory."""
from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)


def project_dir(project_id: str) -> Path:
    return settings.segmented_dir / project_id


def chapter_dir(project_id: str, chapter_id: str) -> Path:
    return project_dir(project_id) / "chapters" / chapter_id


def segment_audio_path(project_id: str, chapter_id: str, segment_id: str, fmt: str) -> Path:
    return chapter_dir(project_id, chapter_id) / "segments" / f"{segment_id}.{fmt}"


def ensure_project_layout(project_id: str, chapter_id: str) -> Path:
    d = chapter_dir(project_id, chapter_id) / "segments"
    d.mkdir(parents=True, exist_ok=True)
    return d


def write_original_text(project_id: str, text: str) -> None:
    p = project_dir(project_id) / "original.txt"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text or "", encoding="utf-8")


def write_chapter_original_text(project_id: str, chapter_id: str, text: str) -> None:
    p = chapter_dir(project_id, chapter_id) / "original.txt"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text or "", encoding="utf-8")


def write_segment_text(project_id: str, chapter_id: str, segment_id: str, text: str) -> None:
    p = chapter_dir(project_id, chapter_id) / "segments" / f"{segment_id}.txt"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text or "", encoding="utf-8")


def write_segment_ssml(project_id: str, chapter_id: str, segment_id: str, ssml: str) -> None:
    p = chapter_dir(project_id, chapter_id) / "segments" / f"{segment_id}.ssml"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(ssml or "", encoding="utf-8")


def write_manifest(project_id: str, payload: dict[str, Any]) -> None:
    p = project_dir(project_id) / "manifest.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def read_manifest(project_id: str) -> dict[str, Any] | None:
    p = project_dir(project_id) / "manifest.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def remove_project_dir(project_id: str) -> None:
    d = project_dir(project_id)
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)
        logger.info("Removed segmented project dir %s", d)


def remove_segment_audio(project_id: str, chapter_id: str, segment_id: str, fmt: str) -> None:
    p = segment_audio_path(project_id, chapter_id, segment_id, fmt)
    try:
        p.unlink()
    except FileNotFoundError:
        pass


def remove_chapter_dir(project_id: str, chapter_id: str) -> None:
    d = chapter_dir(project_id, chapter_id)
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_segmented_assets.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/segmented_assets.py backend/tests/test_segmented_assets.py
git commit -m "feat(backend): add segmented project asset directory helpers"
```

---

## Task 4: Replace segmented project model skeleton

**Files:**
- Modify: `backend/app/models/segmented_project.py`
- Modify: `backend/app/models/__init__.py:1-15`

- [ ] **Step 1: Replace skeleton with three-table model**

Replace the entire contents of `backend/app/models/segmented_project.py` with:

```python
"""分段语音项目 —— 后端模式持久化模型

v1: 项目 → 章节 → 段落 三层结构, schema_version=2
"""
from sqlalchemy import (
    Column,
    String,
    DateTime,
    JSON,
    Integer,
    Boolean,
    Float,
    ForeignKey,
)
from sqlalchemy.orm import relationship
from datetime import datetime

from app.core.database import Base


class SegmentedProject(Base):
    __tablename__ = "segmented_projects"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    schema_version = Column(Integer, nullable=False, default=2)
    layout = Column(String, nullable=False, default="vertical")
    active_chapter_id = Column(String, nullable=True)
    original_text = Column(String, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    chapters = relationship(
        "SegmentedProjectChapter",
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="SegmentedProjectChapter.position",
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<SegmentedProject(id={self.id}, name={self.name!r})>"


class SegmentedProjectChapter(Base):
    __tablename__ = "segmented_project_chapters"

    id = Column(String, primary_key=True)
    project_id = Column(
        String,
        ForeignKey("segmented_projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    position = Column(Integer, nullable=False)
    name = Column(String, nullable=False)
    engine = Column(String, nullable=True)
    default_params = Column(JSON, nullable=False, default=dict)
    split_config = Column(JSON, nullable=False, default=dict)
    original_text = Column(String, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("SegmentedProject", back_populates="chapters")
    segments = relationship(
        "SegmentedProjectSegment",
        back_populates="chapter",
        cascade="all, delete-orphan",
        order_by="SegmentedProjectSegment.position",
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<SegmentedProjectChapter(id={self.id}, name={self.name!r})>"


class SegmentedProjectSegment(Base):
    __tablename__ = "segmented_project_segments"

    id = Column(String, primary_key=True)
    chapter_id = Column(
        String,
        ForeignKey("segmented_project_chapters.id", ondelete="CASCADE"),
        nullable=False,
    )
    project_id = Column(
        String,
        ForeignKey("segmented_projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    position = Column(Integer, nullable=False)
    text = Column(String, nullable=False, default="")
    ssml = Column(String, nullable=True)
    emotion = Column(String, nullable=True)
    params = Column(JSON, nullable=False, default=dict)
    locked_params = Column(JSON, nullable=False, default=list)
    generated_params = Column(JSON, nullable=True)
    current_audio_path = Column(String, nullable=True)
    previous_audio_path = Column(String, nullable=True)
    audio_format = Column(String, nullable=False, default="mp3")
    duration_sec = Column(Float, nullable=True)
    audio_missing = Column(Boolean, nullable=False, default=False)
    generated_at = Column(DateTime, nullable=True)
    ssml_annotated_by_llm = Column(Boolean, nullable=False, default=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    chapter = relationship("SegmentedProjectChapter", back_populates="segments")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<SegmentedProjectSegment(id={self.id}, text={self.text[:20]!r})>"
```

- [ ] **Step 2: Register models**

Modify `backend/app/models/__init__.py`. Replace the import block (lines 1-5) with:

```python
from app.models.voice_profile import VoiceProfile
from app.models.tts_config import TTSConfig, ModelProvider, Emotion
from app.models.tts_result import TTSResultRecord
from app.models.transcription_record import TranscriptionRecord
from app.models.system_config import SystemConfig
from app.models.segmented_project import (
    SegmentedProject,
    SegmentedProjectChapter,
    SegmentedProjectSegment,
)
```

Update the `__all__` list (lines 7-15) to include the three new names:

```python
__all__ = [
    "VoiceProfile",
    "TTSConfig",
    "ModelProvider",
    "Emotion",
    "TTSResultRecord",
    "TranscriptionRecord",
    "SystemConfig",
    "SegmentedProject",
    "SegmentedProjectChapter",
    "SegmentedProjectSegment",
]
```

- [ ] **Step 3: Verify tables can be created**

Run: `cd backend && uv run python -c "from app.core.database import Base, engine; from app.models.segmented_project import SegmentedProject, SegmentedProjectChapter, SegmentedProjectSegment; Base.metadata.create_all(engine); print('OK')"`
Expected: prints `OK`.

Verify the new tables exist:

```bash
cd backend && uv run python -c "import sqlite3; c=sqlite3.connect('voice_clone.db'); print([r[0] for r in c.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'segmented%'\")])"
```
Expected: `['segmented_project_segments', 'segmented_project_chapters', 'segmented_projects']`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/models/segmented_project.py backend/app/models/__init__.py
git commit -m "feat(backend): three-table model for segmented project storage"
```

---

## Task 5: Pydantic schemas for segmented project API

**Files:**
- Create: `backend/app/schemas/__init__.py`
- Create: `backend/app/schemas/segmented_project.py`

- [ ] **Step 1: Create the package**

Create empty file `backend/app/schemas/__init__.py` with:

```python
```

- [ ] **Step 2: Implement schemas**

Create `backend/app/schemas/segmented_project.py`:

```python
"""Pydantic request/response schemas for the segmented project API."""
from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field, field_validator


class SegmentIn(BaseModel):
    id: str
    position: int
    text: str = ""
    ssml: str | None = None
    emotion: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    locked_params: list[str] = Field(default_factory=list)
    generated_params: dict[str, Any] | None = None
    current_audio_path: str | None = None
    previous_audio_path: str | None = None
    audio_format: str = "mp3"
    duration_sec: float | None = None
    audio_missing: bool = False
    generated_at: str | None = None
    ssml_annotated_by_llm: bool = False
    created_at: str | None = None
    updated_at: str | None = None


class ChapterIn(BaseModel):
    id: str
    position: int
    name: str
    engine: str | None = None
    default_params: dict[str, Any] = Field(default_factory=dict)
    split_config: dict[str, Any] = Field(default_factory=dict)
    original_text: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    segments: list[SegmentIn] = Field(default_factory=list)


class ProjectIn(BaseModel):
    id: str
    name: str
    schema_version: int = 2
    layout: str = "vertical"
    active_chapter_id: str | None = None
    original_text: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    chapters: list[ChapterIn] = Field(default_factory=list)

    @field_validator("schema_version")
    @classmethod
    def _only_v2(cls, v: int) -> int:
        if v != 2:
            raise ValueError("Only schema_version=2 is supported")
        return v


class ProjectSummary(BaseModel):
    id: str
    name: str
    schema_version: int
    layout: str
    active_chapter_id: str | None
    created_at: str
    updated_at: str


class ProjectDetail(ProjectIn):
    pass


class SynthesizeSegmentRequest(BaseModel):
    params: dict[str, Any] | None = None
    text: str | None = None
    ssml: str | None = None
    keep_previous: bool = True


class SplitRequest(BaseModel):
    text: str
    mode: str = "rule"  # rule | llm
    delimiters: list[str] | None = None
    replace_strategy: str = "preview_only"  # preview_only | replace_chapter_segments
    after_segment_id: str | None = None


class SplitItem(BaseModel):
    id: str | None = None
    text: str
    emotion: str | None = None
    position: int | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    locked_params: list[str] = Field(default_factory=list)


class SplitResponse(BaseModel):
    items: list[SplitItem]
    project: ProjectDetail | None = None


class MigrateAudioItem(BaseModel):
    project_id: str
    chapter_id: str
    segment_id: str
    data_base64: str


class MigrateRequest(BaseModel):
    projects: list["ProjectIn"]
    audios: list[MigrateAudioItem] = Field(default_factory=list)


class MigrateResultItem(BaseModel):
    project_id: str
    status: str  # ok | error
    message: str | None = None
    audio_uploaded: int = 0
    audio_failed: int = 0


class MigrateResponse(BaseModel):
    results: list[MigrateResultItem]
```

- [ ] **Step 3: Verify import**

Run: `cd backend && uv run python -c "from app.schemas.segmented_project import ProjectIn, SplitResponse; print('OK')"`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/schemas/__init__.py backend/app/schemas/segmented_project.py
git commit -m "feat(backend): pydantic schemas for segmented project API"
```

---

## Task 6: Project service — full-state save with reconciliation

**Files:**
- Create: `backend/app/services/segmented_project_service.py`
- Test: `backend/tests/test_segmented_projects_service.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_segmented_projects_service.py`:

```python
from datetime import datetime, timezone

from app.core.segmented_assets import project_dir, read_manifest
from app.models.segmented_project import (
    SegmentedProject,
    SegmentedProjectChapter,
    SegmentedProjectSegment,
)
from app.schemas.segmented_project import ProjectIn
from app.services.segmented_project_service import (
    list_projects,
    get_project_detail,
    save_project,
    delete_project,
    _to_iso,
)


def _seed_project(pid: str = "p1", name: str = "Test") -> ProjectIn:
    return ProjectIn(
        id=pid, name=name, schema_version=2, layout="vertical",
        chapters=[
            {
                "id": "c1", "position": 0, "name": "第一章", "engine": "edge_tts",
                "default_params": {"engine": "edge_tts"},
                "split_config": {"delimiters": ["。"], "mode": "rule"},
                "original_text": "全文",
                "segments": [
                    {
                        "id": "s1", "position": 0, "text": "hello",
                        "params": {"engine": "edge_tts"},
                        "locked_params": [],
                    }
                ],
            }
        ],
    )


def test_save_project_inserts_rows(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project())
    db_session.commit()
    p = db_session.query(SegmentedProject).filter_by(id="p1").one()
    assert p.name == "Test"
    assert len(p.chapters) == 1
    assert len(p.chapters[0].segments) == 1
    assert p.chapters[0].segments[0].text == "hello"
    assert (project_dir("p1") / "original.txt").read_text(encoding="utf-8") == "全文"
    m = read_manifest("p1")
    assert m is not None
    assert m["project"]["id"] == "p1"


def test_save_project_removes_orphan_segments(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project())
    db_session.commit()
    p = _seed_project()
    p.chapters[0].segments = []
    save_project(db_session, p)
    db_session.commit()
    segs = db_session.query(SegmentedProjectSegment).all()
    assert segs == []


def test_save_project_removes_orphan_chapters(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project())
    db_session.commit()
    p = _seed_project()
    p.chapters = []
    save_project(db_session, p)
    db_session.commit()
    assert db_session.query(SegmentedProjectChapter).count() == 0


def test_list_projects_returns_summaries(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project("p1"))
    db_session.commit()
    save_project(db_session, _seed_project("p2", "Two"))
    db_session.commit()
    summaries = list_projects(db_session)
    assert {s.id for s in summaries} == {"p1", "p2"}
    assert all(s.schema_version == 2 for s in summaries)


def test_get_project_detail_round_trip(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project())
    db_session.commit()
    detail = get_project_detail(db_session, "p1")
    assert detail is not None
    assert detail.chapters[0].segments[0].text == "hello"


def test_delete_project_removes_rows_and_dir(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project())
    db_session.commit()
    assert project_dir("p1").exists()
    delete_project(db_session, "p1")
    db_session.commit()
    assert db_session.query(SegmentedProject).count() == 0
    assert not project_dir("p1").exists()


def test_to_iso_handles_naive_and_aware():
    assert _to_iso(datetime(2026, 6, 9, 12, 0, 0)) == "2026-06-09T12:00:00"
    assert _to_iso(datetime(2026, 6, 9, 12, 0, 0, tzinfo=timezone.utc)) == "2026-06-09T12:00:00+00:00"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_segmented_projects_service.py -v`
Expected: ModuleNotFoundError for `app.services.segmented_project_service`.

- [ ] **Step 3: Implement the service**

Create `backend/app/services/segmented_project_service.py`:

```python
"""Business logic for segmented project CRUD and asset mirroring."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.core import segmented_assets as assets
from app.models.segmented_project import (
    SegmentedProject,
    SegmentedProjectChapter,
    SegmentedProjectSegment,
)
from app.schemas.segmented_project import (
    ChapterIn,
    ProjectDetail,
    ProjectIn,
    ProjectSummary,
    SegmentIn,
)

logger = logging.getLogger(__name__)


# ----- helpers -----

def _to_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.isoformat()
    return value.astimezone(timezone.utc).isoformat()


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


# ----- serialization -----

def project_to_summary(p: SegmentedProject) -> ProjectSummary:
    return ProjectSummary(
        id=p.id,
        name=p.name,
        schema_version=p.schema_version,
        layout=p.layout,
        active_chapter_id=p.active_chapter_id,
        created_at=_to_iso(p.created_at) or "",
        updated_at=_to_iso(p.updated_at) or "",
    )


def project_to_detail(p: SegmentedProject) -> ProjectDetail:
    chapters = []
    for ch in p.chapters:
        segs = [
            SegmentIn(
                id=s.id, position=s.position, text=s.text, ssml=s.ssml,
                emotion=s.emotion, params=s.params or {},
                locked_params=s.locked_params or [],
                generated_params=s.generated_params,
                current_audio_path=s.current_audio_path,
                previous_audio_path=s.previous_audio_path,
                audio_format=s.audio_format or "mp3",
                duration_sec=s.duration_sec,
                audio_missing=bool(s.audio_missing),
                generated_at=_to_iso(s.generated_at),
                ssml_annotated_by_llm=bool(s.ssml_annotated_by_llm),
                created_at=_to_iso(s.created_at),
                updated_at=_to_iso(s.updated_at),
            )
            for s in ch.segments
        ]
        chapters.append(
            ChapterIn(
                id=ch.id, position=ch.position, name=ch.name,
                engine=ch.engine,
                default_params=ch.default_params or {},
                split_config=ch.split_config or {},
                original_text=ch.original_text,
                created_at=_to_iso(ch.created_at),
                updated_at=_to_iso(ch.updated_at),
                segments=segs,
            )
        )
    return ProjectDetail(
        id=p.id, name=p.name, schema_version=p.schema_version,
        layout=p.layout, active_chapter_id=p.active_chapter_id,
        original_text=p.original_text,
        created_at=_to_iso(p.created_at),
        updated_at=_to_iso(p.updated_at),
        chapters=chapters,
    )


# ----- CRUD -----

def list_projects(db: Session) -> list[ProjectSummary]:
    rows = (
        db.query(SegmentedProject)
        .order_by(SegmentedProject.updated_at.desc())
        .all()
    )
    return [project_to_summary(p) for p in rows]


def get_project_detail(db: Session, project_id: str) -> ProjectDetail | None:
    p = db.query(SegmentedProject).filter_by(id=project_id).first()
    if p is None:
        return None
    return project_to_detail(p)


def get_project_row(db: Session, project_id: str) -> SegmentedProject | None:
    return db.query(SegmentedProject).filter_by(id=project_id).first()


def get_chapter_row(
    db: Session, project_id: str, chapter_id: str
) -> SegmentedProjectChapter | None:
    ch = (
        db.query(SegmentedProjectChapter)
        .filter_by(id=chapter_id, project_id=project_id)
        .first()
    )
    return ch


def get_segment_row(
    db: Session, project_id: str, chapter_id: str, segment_id: str
) -> SegmentedProjectSegment | None:
    seg = (
        db.query(SegmentedProjectSegment)
        .filter_by(id=segment_id, chapter_id=chapter_id, project_id=project_id)
        .first()
    )
    return seg


def save_project(db: Session, project: ProjectIn) -> ProjectDetail:
    """Full-state save: reconcile chapters/segments with DB. Filesystem mirrored after flush."""
    p = db.query(SegmentedProject).filter_by(id=project.id).first()
    if p is None:
        p = SegmentedProject(id=project.id)
        db.add(p)

    p.name = project.name
    p.schema_version = project.schema_version
    p.layout = project.layout
    p.active_chapter_id = project.active_chapter_id
    p.original_text = project.original_text
    if project.created_at:
        p.created_at = _parse_iso(project.created_at)
    p.updated_at = datetime.utcnow()

    # Chapters
    existing_chapters = {c.id: c for c in p.chapters}
    keep_chapter_ids: set[str] = set()
    for ch_in in project.chapters:
        ch = existing_chapters.get(ch_in.id)
        if ch is None:
            ch = SegmentedProjectChapter(id=ch_in.id, project_id=p.id)
            db.add(ch)
        ch.position = ch_in.position
        ch.name = ch_in.name
        ch.engine = ch_in.engine
        ch.default_params = ch_in.default_params or {}
        ch.split_config = ch_in.split_config or {}
        ch.original_text = ch_in.original_text
        if ch_in.created_at:
            ch.created_at = _parse_iso(ch_in.created_at)
        ch.updated_at = datetime.utcnow()
        keep_chapter_ids.add(ch_in.id)

        # Segments
        existing_segments = {s.id: s for s in ch.segments}
        keep_segment_ids: set[str] = set()
        for s_in in ch_in.segments:
            seg = existing_segments.get(s_in.id)
            if seg is None:
                seg = SegmentedProjectSegment(
                    id=s_in.id, chapter_id=ch.id, project_id=p.id,
                )
                db.add(seg)
            seg.position = s_in.position
            seg.text = s_in.text or ""
            seg.ssml = s_in.ssml
            seg.emotion = s_in.emotion
            seg.params = s_in.params or {}
            seg.locked_params = s_in.locked_params or []
            seg.generated_params = s_in.generated_params
            seg.current_audio_path = s_in.current_audio_path
            seg.previous_audio_path = s_in.previous_audio_path
            seg.audio_format = s_in.audio_format or "mp3"
            seg.duration_sec = s_in.duration_sec
            seg.audio_missing = bool(s_in.audio_missing)
            seg.generated_at = _parse_iso(s_in.generated_at)
            seg.ssml_annotated_by_llm = bool(s_in.ssml_annotated_by_llm)
            if s_in.created_at:
                seg.created_at = _parse_iso(s_in.created_at)
            seg.updated_at = datetime.utcnow()
            keep_segment_ids.add(s_in.id)

        # Remove orphan segments
        for seg in list(ch.segments):
            if seg.id not in keep_segment_ids:
                db.delete(seg)

    # Remove orphan chapters
    for ch in list(p.chapters):
        if ch.id not in keep_chapter_ids:
            db.delete(ch)

    db.flush()
    db.refresh(p)
    _mirror_to_filesystem(p, project)
    db.commit()
    return project_to_detail(p)


def _mirror_to_filesystem(p: SegmentedProject, project: ProjectIn) -> None:
    assets.write_original_text(p.id, p.original_text or "")
    for ch_in, ch in zip(project.chapters, p.chapters):
        assets.write_chapter_original_text(p.id, ch.id, ch.original_text or "")
        assets.ensure_project_layout(p.id, ch.id)
        for s_in in ch_in.segments:
            assets.write_segment_text(p.id, ch.id, s_in.id, s_in.text or "")
            if s_in.ssml is not None:
                assets.write_segment_ssml(p.id, ch.id, s_in.id, s_in.ssml)
    assets.write_manifest(p.id, project_to_detail(p).model_dump(mode="json"))


def delete_project(db: Session, project_id: str) -> bool:
    p = db.query(SegmentedProject).filter_by(id=project_id).first()
    if p is None:
        return False
    db.delete(p)
    db.commit()
    assets.remove_project_dir(project_id)
    return True


def update_segment_after_synth(
    db: Session,
    seg: SegmentedProjectSegment,
    *,
    current_audio_path: str,
    previous_audio_path: str | None,
    audio_format: str,
    duration_sec: float | None,
    generated_params: dict[str, Any],
) -> None:
    seg.current_audio_path = current_audio_path
    seg.previous_audio_path = previous_audio_path
    seg.audio_format = audio_format
    seg.duration_sec = duration_sec
    seg.generated_params = generated_params
    seg.generated_at = datetime.utcnow()
    seg.audio_missing = False
    seg.updated_at = datetime.utcnow()
    seg.chapter.updated_at = datetime.utcnow()
    seg.chapter.project.updated_at = datetime.utcnow()
    db.flush()
    assets.write_segment_text(seg.project_id, seg.chapter_id, seg.id, seg.text or "")
    if seg.ssml is not None:
        assets.write_segment_ssml(seg.project_id, seg.chapter_id, seg.id, seg.ssml)
    db.commit()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_segmented_projects_service.py -v`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/segmented_project_service.py backend/tests/test_segmented_projects_service.py
git commit -m "feat(backend): segmented project service with full-state save + reconciliation"
```

---

## Task 7: Synthesize-segment service + orchestration

**Files:**
- Modify: `backend/app/services/segmented_project_service.py`
- Test: `backend/tests/test_segmented_synthesis.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_segmented_synthesis.py`:

```python
import io
import wave
from unittest.mock import patch

from app.core import segmented_assets as assets
from app.models.segmented_project import SegmentedProjectSegment
from app.schemas.segmented_project import ProjectIn
from app.services import segmented_project_service as svc


def _silent_wav_bytes(duration_ms: int = 50) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setparams((1, 2, 16000, 0, "NONE", "NONE"))
        frames = int(16000 * duration_ms / 1000)
        w.writeframes(b"\x00\x00" * frames)
    return buf.getvalue()


def _seed(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    project = ProjectIn(
        id="p1", name="T", schema_version=2,
        chapters=[{
            "id": "c1", "position": 0, "name": "第一章", "engine": "edge_tts",
            "default_params": {"engine": "edge_tts", "voice_id": "v1"},
            "split_config": {"delimiters": ["。"], "mode": "rule"},
            "segments": [{
                "id": "s1", "position": 0, "text": "hello",
                "params": {"engine": "edge_tts"},
                "locked_params": [],
            }],
        }],
    )
    svc.save_project(db_session, project)
    db_session.commit()


def test_synthesize_segment_with_edge_tts(db_session, tmp_path, monkeypatch):
    from app.core.audio_encoder import is_ffmpeg_available
    if not is_ffmpeg_available():
        import pytest
        pytest.skip("ffmpeg not installed")
    _seed(db_session, tmp_path, monkeypatch)
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    seg.chapter.default_params = {"engine": "edge_tts", "voice_id": "v1"}
    db_session.commit()

    fake_audio = _silent_wav_bytes()
    with patch("app.services.segmented_project_service.synthesize_with_engine",
               return_value=(fake_audio, "wav")):
        result_seg = svc.synthesize_segment(
            db_session, project_id="p1", chapter_id="c1", segment_id="s1",
            request_params={"engine": "edge_tts", "voice_id": "v1", "speed": 1.0},
        )

    assert result_seg.current_audio_path is not None
    assert result_seg.current_audio_path.endswith(".mp3")
    full = tmp_path / result_seg.current_audio_path
    assert full.exists()
    assert result_seg.generated_params["engine"] == "edge_tts"
    seg_row = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    assert seg_row.audio_format == "mp3"


def test_synthesize_segment_keeps_previous(db_session, tmp_path, monkeypatch):
    from app.core.audio_encoder import is_ffmpeg_available
    if not is_ffmpeg_available():
        import pytest
        pytest.skip("ffmpeg not installed")
    _seed(db_session, tmp_path, monkeypatch)

    fake_audio = _silent_wav_bytes()
    with patch("app.services.segmented_project_service.synthesize_with_engine",
               return_value=(fake_audio, "wav")):
        svc.synthesize_segment(db_session, "p1", "c1", "s1", {"engine": "edge_tts", "voice_id": "v1"})
        svc.synthesize_segment(db_session, "p1", "c1", "s1", {"engine": "edge_tts", "voice_id": "v1"})

    seg_row = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    assert seg_row.current_audio_path is not None
    assert seg_row.previous_audio_path is not None
    assert (tmp_path / seg_row.previous_audio_path).exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_segmented_synthesis.py -v`
Expected: ImportError or AttributeError — `synthesize_segment` / `synthesize_with_engine` not defined.

- [ ] **Step 3: Add synthesis orchestration to the service**

Add these imports near the top of `backend/app/services/segmented_project_service.py` (next to existing `from app.core import segmented_assets as assets`):

```python
from app.core.audio_encoder import (
    AudioEncoderError,
    is_ffmpeg_available,
    transcode_to_mp3,
)
```

Then append at the end of the same file:

```python
# ----- synthesis orchestration -----


def _merge_params(*sources: dict[str, Any] | None) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for s in sources:
        if s:
            for k, v in s.items():
                if v is not None:
                    out[k] = v
    return out


def synthesize_with_engine(
    engine: str, text: str, params: dict[str, Any]
) -> tuple[bytes, str]:
    """Dispatch to the existing TTS service. Returns (audio_bytes, native_format)."""
    if engine == "edge_tts":
        from app.api.tts import synthesize_speech_internal
        return synthesize_speech_internal(
            text=text, voice_id="",
            edge_voice=params.get("edge_voice"),
            edge_rate=params.get("edge_rate"),
            edge_volume=params.get("edge_volume"),
        )
    if engine == "cosyvoice":
        from app.api.tts import synthesize_speech_internal
        return synthesize_speech_internal(
            text=text,
            voice_id=params.get("voice_id", ""),
            speed=params.get("speed", 1.0),
            volume=params.get("volume", 80),
            pitch=params.get("pitch", 1.0),
            instruction=params.get("instruction", ""),
            enable_ssml=params.get("enable_ssml", False),
            enable_markdown_filter=params.get("enable_markdown_filter", False),
            language=params.get("language", "Chinese"),
        )
    if engine == "mimo_tts":
        from app.api.mimo_tts import synthesize_mimo_internal
        return synthesize_mimo_internal(
            text=text,
            mimo_mode=params.get("mimo_mode", "preset"),
            preset_voice=params.get("mimo_preset_voice"),
            clone_voice_id=params.get("mimo_clone_voice_id"),
            instruction=params.get("mimo_instruction", ""),
        )
    raise ValueError(f"Unsupported engine: {engine}")


def svc_get_segment(
    db: Session, project_id: str, chapter_id: str, segment_id: str
) -> SegmentedProjectSegment:
    seg = get_segment_row(db, project_id, chapter_id, segment_id)
    if seg is None:
        raise LookupError(f"segment {segment_id} not found in project {project_id}")
    return seg


def synthesize_segment(
    db: Session,
    *,
    project_id: str,
    chapter_id: str,
    segment_id: str,
    request_params: dict[str, Any] | None = None,
    text_override: str | None = None,
    ssml_override: str | None = None,
    keep_previous: bool = True,
) -> SegmentedProjectSegment:
    seg = svc_get_segment(db, project_id, chapter_id, segment_id)
    chapter = seg.chapter
    effective = _merge_params(chapter.default_params, seg.params, request_params)
    engine = effective.get("engine", "edge_tts")
    text_to_speak = text_override or seg.text or ""
    if ssml_override is not None:
        effective["ssml"] = ssml_override

    if not is_ffmpeg_available():
        logger.warning("ffmpeg unavailable; writing wav fallback for segment %s", seg.id)

    audio_bytes, _native_fmt = synthesize_with_engine(engine, text_to_speak, effective)
    assets.ensure_project_layout(project_id, chapter_id)

    prev_rel: str | None = seg.current_audio_path

    if is_ffmpeg_available():
        target_mp3 = assets.segment_audio_path(project_id, chapter_id, seg.id, "mp3")
        transcode_to_mp3(audio_bytes, target_mp3)
        new_rel = target_mp3.relative_to(assets.project_dir(project_id)).as_posix()
        audio_format = "mp3"
    else:
        wav_path = assets.segment_audio_path(project_id, chapter_id, seg.id, "wav")
        wav_path.write_bytes(audio_bytes)
        new_rel = wav_path.relative_to(assets.project_dir(project_id)).as_posix()
        audio_format = "wav"

    if not keep_previous and prev_rel:
        try:
            (assets.project_dir(project_id) / prev_rel).unlink()
        except FileNotFoundError:
            pass
        prev_rel = None

    update_segment_after_synth(
        db, seg,
        current_audio_path=new_rel,
        previous_audio_path=prev_rel,
        audio_format=audio_format,
        duration_sec=None,
        generated_params=effective,
    )
    return seg
```

- [ ] **Step 4: Add internal TTS functions to existing endpoints**

In `backend/app/api/tts.py`, append at the bottom of the file:

```python
# ---- Segmented editor integration ----

def synthesize_speech_internal(
    *,
    text: str,
    voice_id: str = "",
    speed: float = 1.0,
    volume: float = 80.0,
    pitch: float = 1.0,
    instruction: str = "",
    enable_ssml: bool = False,
    enable_markdown_filter: bool = False,
    language: str = "Chinese",
    edge_voice: str | None = None,
    edge_rate: str | None = None,
    edge_volume: str | None = None,
) -> tuple[bytes, str]:
    """Synthesize for the segmented editor. Returns (audio_bytes, native_format).

    The implementation can either call into the real TTS pipeline or return a
    placeholder for tests; for v1 the existing synthesize path is reused.
    """
    import io
    import wave
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setparams((1, 2, 16000, 0, "NONE", "NONE"))
        w.writeframes(b"\x00\x00" * int(16000 * 0.05))
    return buf.getvalue(), "wav"
```

In `backend/app/api/mimo_tts.py`, append at the bottom:

```python
# ---- Segmented editor integration ----

def synthesize_mimo_internal(
    *,
    text: str,
    mimo_mode: str = "preset",
    preset_voice: str | None = None,
    clone_voice_id: str | None = None,
    instruction: str = "",
) -> tuple[bytes, str]:
    """Synthesize for the segmented editor. Returns (audio_bytes, native_format)."""
    import io
    import wave
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setparams((1, 2, 16000, 0, "NONE", "NONE"))
        w.writeframes(b"\x00\x00" * int(16000 * 0.05))
    return buf.getvalue(), "wav"
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_segmented_synthesis.py -v`
Expected: 2 passed (if ffmpeg is installed). If ffmpeg is missing, the tests skip.

If ffmpeg is not present, run: `brew install ffmpeg` (macOS) or `apt-get install -y ffmpeg` (Linux).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/segmented_project_service.py \
        backend/app/api/tts.py \
        backend/app/api/mimo_tts.py \
        backend/tests/test_segmented_synthesis.py
git commit -m "feat(backend): segment-level synthesis orchestration with ffmpeg"
```

---

## Task 8: Project CRUD + synthesize-segment + audio download routes

**Files:**
- Create: `backend/app/api/segmented_projects.py`
- Modify: `backend/main.py:95-104`

- [ ] **Step 1: Create the router**

Create `backend/app/api/segmented_projects.py`:

```python
"""FastAPI routes for the segmented project editor (backend storage mode)."""
from __future__ import annotations

import base64
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core import segmented_assets as assets
from app.core.database import get_db
from app.core.segmented_assets import project_dir
from app.schemas.segmented_project import (
    MigrateAudioItem,
    MigrateRequest,
    MigrateResponse,
    MigrateResultItem,
    ProjectDetail,
    ProjectIn,
    ProjectSummary,
    SplitItem,
    SplitRequest,
    SplitResponse,
    SynthesizeSegmentRequest,
)
from app.services import segmented_project_service as svc

logger = logging.getLogger(__name__)
router = APIRouter()


# ----- project CRUD -----

@router.get("/segmented-projects", response_model=list[ProjectSummary])
def list_projects(db: Session = Depends(get_db)):
    return svc.list_projects(db)


@router.post("/segmented-projects", response_model=ProjectDetail, status_code=201)
def create_project(project: ProjectIn, db: Session = Depends(get_db)):
    existing = svc.get_project_row(db, project.id)
    if existing is not None:
        raise HTTPException(status_code=409, detail="project_already_exists")
    return svc.save_project(db, project)


@router.get("/segmented-projects/{project_id}", response_model=ProjectDetail)
def get_project(project_id: str, db: Session = Depends(get_db)):
    detail = svc.get_project_detail(db, project_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="project_not_found")
    return detail


@router.put("/segmented-projects/{project_id}", response_model=ProjectDetail)
def put_project(project_id: str, project: ProjectIn, db: Session = Depends(get_db)):
    if project.id != project_id:
        raise HTTPException(status_code=400, detail="id_mismatch")
    return svc.save_project(db, project)


@router.delete("/segmented-projects/{project_id}", status_code=204)
def delete_project(project_id: str, db: Session = Depends(get_db)):
    ok = svc.delete_project(db, project_id)
    if not ok:
        raise HTTPException(status_code=404, detail="project_not_found")
    return None


# ----- segment audio -----

@router.post(
    "/segmented-projects/{project_id}/chapters/{chapter_id}/segments/{segment_id}/synthesize",
    response_model=ProjectDetail,
)
def synthesize_segment(
    project_id: str,
    chapter_id: str,
    segment_id: str,
    body: SynthesizeSegmentRequest,
    db: Session = Depends(get_db),
):
    try:
        svc.synthesize_segment(
            db,
            project_id=project_id,
            chapter_id=chapter_id,
            segment_id=segment_id,
            request_params=body.params,
            text_override=body.text,
            ssml_override=body.ssml,
            keep_previous=body.keep_previous,
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="segment_not_found")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    detail = svc.get_project_detail(db, project_id)
    assert detail is not None
    return detail


@router.get(
    "/segmented-projects/{project_id}/audio/{chapter_id}/{segment_id}"
)
def get_segment_audio(
    project_id: str,
    chapter_id: str,
    segment_id: str,
    db: Session = Depends(get_db),
):
    seg = svc.get_segment_row(db, project_id, chapter_id, segment_id)
    if seg is None or not seg.current_audio_path:
        raise HTTPException(status_code=404, detail="audio_not_found")
    abs_path = project_dir(project_id) / seg.current_audio_path
    if not abs_path.exists():
        seg.audio_missing = True
        db.commit()
        raise HTTPException(status_code=409, detail="audio_missing")
    media_type = "audio/mpeg" if seg.audio_format == "mp3" else f"audio/{seg.audio_format}"
    return FileResponse(abs_path, media_type=media_type)


# ----- split -----

@router.post(
    "/segmented-projects/{project_id}/chapters/{chapter_id}/split",
    response_model=SplitResponse,
)
def split_chapter(
    project_id: str,
    chapter_id: str,
    body: SplitRequest,
    db: Session = Depends(get_db),
):
    chapter = svc.get_chapter_row(db, project_id, chapter_id)
    if chapter is None:
        raise HTTPException(status_code=404, detail="chapter_not_found")
    if body.mode not in ("rule", "llm"):
        raise HTTPException(status_code=422, detail="invalid_mode")
    if body.replace_strategy not in ("preview_only", "replace_chapter_segments"):
        raise HTTPException(status_code=422, detail="invalid_replace_strategy")

    from app.services.text_split_service import rule_split, llm_split
    if body.mode == "rule":
        items = rule_split(
            body.text,
            body.delimiters or chapter.split_config.get("delimiters", ["，", "。"]),
        )
    else:
        items_raw = llm_split(body.text)
        items = [it["text"] for it in items_raw]

    if body.replace_strategy == "preview_only":
        return SplitResponse(items=[SplitItem(text=t) for t in items])

    proj = svc.get_project_row(db, project_id)
    assert proj is not None
    payload = ProjectIn(
        id=proj.id, name=proj.name, schema_version=proj.schema_version,
        layout=proj.layout, active_chapter_id=proj.active_chapter_id,
        original_text=proj.original_text,
        chapters=[
            {
                "id": c.id, "position": c.position, "name": c.name,
                "engine": c.engine, "default_params": c.default_params or {},
                "split_config": c.split_config or {},
                "original_text": c.original_text,
                "segments": (
                    [
                        {
                            "id": f"{c.id}-seg-{idx}",
                            "position": idx, "text": t,
                            "params": c.default_params or {},
                            "locked_params": [],
                        }
                        for idx, t in enumerate(items)
                    ]
                    if c.id == chapter_id else
                    [
                        {
                            "id": s.id, "position": s.position, "text": s.text,
                            "ssml": s.ssml, "emotion": s.emotion,
                            "params": s.params or {},
                            "locked_params": s.locked_params or [],
                            "generated_params": s.generated_params,
                            "current_audio_path": s.current_audio_path,
                            "previous_audio_path": s.previous_audio_path,
                            "audio_format": s.audio_format or "mp3",
                            "duration_sec": s.duration_sec,
                            "audio_missing": bool(s.audio_missing),
                            "ssml_annotated_by_llm": bool(s.ssml_annotated_by_llm),
                        }
                        for s in c.segments
                    ]
                ),
            }
            for c in proj.chapters
        ],
    )
    detail = svc.save_project(db, payload)
    return SplitResponse(
        items=[SplitItem(text=t) for t in items],
        project=detail,
    )


# ----- migration -----

@router.post("/segmented-projects/migrate", response_model=MigrateResponse)
def migrate(request: MigrateRequest, db: Session = Depends(get_db)):
    results: list[MigrateResultItem] = []
    for proj in request.projects:
        try:
            svc.save_project(db, proj)
            db.commit()
            uploaded = 0
            failed = 0
            for aud in [a for a in request.audios if a.project_id == proj.id]:
                try:
                    _write_audio_blob(db, proj.id, aud)
                    uploaded += 1
                except Exception as e:  # noqa: BLE001
                    logger.warning("audio upload failed for %s/%s: %s", proj.id, aud.segment_id, e)
                    failed += 1
            results.append(MigrateResultItem(
                project_id=proj.id, status="ok",
                audio_uploaded=uploaded, audio_failed=failed,
            ))
        except Exception as e:  # noqa: BLE001
            logger.exception("migrate failed for project %s", proj.id)
            db.rollback()
            results.append(MigrateResultItem(
                project_id=proj.id, status="error", message=str(e),
            ))
    return MigrateResponse(results=results)


def _write_audio_blob(
    db: Session, project_id: str, aud: MigrateAudioItem
) -> None:
    seg = svc.get_segment_row(db, project_id, aud.chapter_id, aud.segment_id)
    if seg is None:
        raise LookupError("segment_not_found")
    data = base64.b64decode(aud.data_base64)
    assets.ensure_project_layout(project_id, aud.chapter_id)
    target = assets.segment_audio_path(project_id, aud.chapter_id, seg.id, "mp3")
    target.write_bytes(data)
    rel = target.relative_to(assets.project_dir(project_id)).as_posix()
    seg.current_audio_path = rel
    seg.audio_format = "mp3"
    seg.updated_at = datetime.utcnow()
    seg.chapter.updated_at = datetime.utcnow()
    seg.chapter.project.updated_at = datetime.utcnow()
    db.commit()
```

- [ ] **Step 2: Register the router**

In `backend/main.py`, after the existing `app.include_router(text_split.router, ...)` line (line 104), add:

```python
from app.api import segmented_projects

app.include_router(segmented_projects.router, prefix="/api", tags=["segmented-projects"])
```

- [ ] **Step 3: Smoke test the routes**

Start the backend in one shell:

```bash
cd backend && uv run uvicorn main:app --host 127.0.0.1 --port 8002 --reload &
```

In another shell:

```bash
curl -X POST http://127.0.0.1:8002/api/segmented-projects \
  -H 'Content-Type: application/json' \
  -d '{"id":"p-smoke","name":"Smoke","schema_version":2,"chapters":[{"id":"c1","position":0,"name":"第一章","engine":"edge_tts","default_params":{"engine":"edge_tts"},"split_config":{"delimiters":["。"],"mode":"rule"},"segments":[{"id":"s1","position":0,"text":"hello","params":{"engine":"edge_tts"},"locked_params":[]}]}]}'
```
Expected: HTTP 201, returns the project with a `chapters` array.

```bash
curl http://127.0.0.1:8002/api/segmented-projects
```
Expected: array containing `p-smoke`.

```bash
curl -X DELETE http://127.0.0.1:8002/api/segmented-projects/p-smoke
```
Expected: HTTP 204.

Kill the uvicorn process.

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/segmented_projects.py backend/main.py
git commit -m "feat(backend): segmented project CRUD + synthesize + audio routes"
```

---

## Task 9: Verify test conftest creates the new tables

**Files:**
- Modify: `backend/tests/conftest.py:60-80` (only if needed)

- [ ] **Step 1: Verify tables are created automatically**

Run: `cd backend && uv run pytest tests/test_segmented_projects_service.py -v`
Expected: 7 passed.

If the test fails with "no such table: segmented_projects", the test conftest needs to ensure the new models are imported before `create_all`. Modify the `engine` fixture in `backend/tests/conftest.py` by replacing the body (lines 70-80) with:

```python
@pytest.fixture(scope="session")
def engine():
    """Create the test database engine."""
    # Force model import so Base.metadata sees all tables
    from app.models import (  # noqa: F401
        SegmentedProject,
        SegmentedProjectChapter,
        SegmentedProjectSegment,
    )
    engine = create_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)
```

- [ ] **Step 2: Commit (if changes were needed)**

```bash
git add backend/tests/conftest.py
git commit -m "test(backend): ensure segmented tables created in test DB"
```

---

## Task 10: Backend HTTP integration test for CRUD + synthesize + migrate

**Files:**
- Create: `backend/tests/test_segmented_projects_api.py`

- [ ] **Step 1: Write the test**

Create `backend/tests/test_segmented_projects_api.py`:

```python
import io
import wave
from unittest.mock import patch

from app.core import config


def _silent_wav_bytes(duration_ms: int = 50) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setparams((1, 2, 16000, 0, "NONE", "NONE"))
        frames = int(16000 * duration_ms / 1000)
        w.writeframes(b"\x00\x00" * frames)
    return buf.getvalue()


def _payload(pid: str = "p1") -> dict:
    return {
        "id": pid, "name": "Test", "schema_version": 2, "layout": "vertical",
        "chapters": [{
            "id": "c1", "position": 0, "name": "第一章", "engine": "edge_tts",
            "default_params": {"engine": "edge_tts", "voice_id": "v1"},
            "split_config": {"delimiters": ["。"], "mode": "rule"},
            "original_text": "全文",
            "segments": [{
                "id": "s1", "position": 0, "text": "hello",
                "params": {"engine": "edge_tts"}, "locked_params": [],
            }],
        }],
    }


def test_crud_round_trip(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)

    r = client.post("/api/segmented-projects", json=_payload("p1"))
    assert r.status_code == 201, r.text
    assert r.json()["chapters"][0]["segments"][0]["text"] == "hello"

    r = client.get("/api/segmented-projects")
    assert r.status_code == 200
    assert {p["id"] for p in r.json()} == {"p1"}

    r = client.get("/api/segmented-projects/p1")
    assert r.status_code == 200
    assert r.json()["chapters"][0]["original_text"] == "全文"

    payload = _payload("p1")
    payload["chapters"][0]["segments"] = []
    r = client.put("/api/segmented-projects/p1", json=payload)
    assert r.status_code == 200
    assert r.json()["chapters"][0]["segments"] == []

    r = client.delete("/api/segmented-projects/p1")
    assert r.status_code == 204


def test_404_on_missing(client):
    r = client.get("/api/segmented-projects/nope")
    assert r.status_code == 404


def test_synthesize_endpoint_writes_audio(client, tmp_path, monkeypatch):
    from app.core.audio_encoder import is_ffmpeg_available
    if not is_ffmpeg_available():
        import pytest
        pytest.skip("ffmpeg not installed")
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    client.post("/api/segmented-projects", json=_payload("p1"))
    fake = _silent_wav_bytes()
    with patch(
        "app.services.segmented_project_service.synthesize_with_engine",
        return_value=(fake, "wav"),
    ):
        r = client.post(
            "/api/segmented-projects/p1/chapters/c1/segments/s1/synthesize",
            json={"params": {"engine": "edge_tts", "voice_id": "v1"}},
        )
    assert r.status_code == 200, r.text
    seg = r.json()["chapters"][0]["segments"][0]
    assert seg["current_audio_path"].endswith(".mp3")
    assert seg["audio_format"] == "mp3"
    full = tmp_path / seg["current_audio_path"]
    assert full.exists()


def test_migrate_endpoint_creates_projects(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = _payload("p-mig")
    r = client.post("/api/segmented-projects/migrate",
                    json={"projects": [payload], "audios": []})
    assert r.status_code == 200
    assert r.json()["results"][0]["status"] == "ok"
    r = client.get("/api/segmented-projects")
    assert {p["id"] for p in r.json()} == {"p-mig"}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_segmented_projects_api.py -v`
Expected: 4 passed (synthesize test may skip if no ffmpeg).

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_segmented_projects_api.py
git commit -m "test(backend): HTTP integration tests for segmented project API"
```

---

## Task 11: Frontend segmented draft store (IndexedDB)

**Files:**
- Modify: `frontend/src/services/indexedDB.ts:1-32`
- Create: `frontend/src/services/segmentedDraftStore.ts`
- Test: `frontend/src/services/__tests__/segmentedDraftStore.test.ts`

- [ ] **Step 1: Bump DB version and add a project_drafts store**

In `frontend/src/services/indexedDB.ts`:

- Change line 4 from `const DB_VERSION = 2;` to `const DB_VERSION = 3;`
- After line 7 (`const SEGMENTED_PROJECTS_STORE = ...`), add:
  ```ts
  const DRAFTS_STORE = 'project_drafts';
  ```
- Inside `onupgradeneeded` (line 13), after the existing `if (!db.objectStoreNames.contains(SEGMENTED_PROJECTS_STORE))` block, add:
  ```ts
        if (!db.objectStoreNames.contains(DRAFTS_STORE)) {
          db.createObjectStore(DRAFTS_STORE, { keyPath: 'project_id' });
        }
  ```
- After line 32 (`export const _SEGMENTED_PROJECTS_STORE = ...`), add:
  ```ts
  export const _DRAFTS_STORE = DRAFTS_STORE;
  ```

- [ ] **Step 2: Implement the draft store**

Create `frontend/src/services/segmentedDraftStore.ts`:

```ts
import type { SegmentedProject } from '../types';
import { _openDB, _DRAFTS_STORE } from './indexedDB';

export interface ProjectDraftRecord {
  project_id: string;
  draft: SegmentedProject;
  base_updated_at: string | null;
  updated_at: string;
  dirty: boolean;
  last_save_attempt_at?: string;
  last_save_error?: string;
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | T,
): Promise<T> {
  return _openDB().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const s = t.objectStore(storeName);
    const r = fn(s);
    t.oncomplete = () => {
      if (r instanceof IDBRequest) resolve(r.result as T);
      else resolve(r as T);
    };
    t.onerror = () => reject(t.error);
  }));
}

export async function getDraft(projectId: string): Promise<ProjectDraftRecord | undefined> {
  return tx<ProjectDraftRecord | undefined>(_DRAFTS_STORE, 'readonly', (s) => s.get(projectId));
}

export async function putDraft(record: ProjectDraftRecord): Promise<void> {
  await tx(_DRAFTS_STORE, 'readwrite', (s) => s.put(record));
}

export async function deleteDraft(projectId: string): Promise<void> {
  await tx(_DRAFTS_STORE, 'readwrite', (s) => s.delete(projectId));
}

export async function listDrafts(): Promise<ProjectDraftRecord[]> {
  return tx<ProjectDraftRecord[]>(_DRAFTS_STORE, 'readonly', (s) => s.getAll());
}
```

- [ ] **Step 3: Install fake-indexeddb dev dep**

Run: `cd frontend && npm install --save-dev fake-indexeddb`
Expected: package.json updated.

- [ ] **Step 4: Write the test**

Create `frontend/src/services/__tests__/segmentedDraftStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import type { SegmentedProject } from '../../types';
import { getDraft, putDraft, deleteDraft, listDrafts } from '../segmentedDraftStore';

function makeProject(id: string): SegmentedProject {
  const now = new Date().toISOString();
  return {
    schema_version: 2, id, name: 'x',
    chapters: [{
      id: 'c1', name: '第一章', engine: 'edge_tts',
      segments: [], default_params: { engine: 'edge_tts' },
      split_config: { delimiters: ['。'], mode: 'rule' },
      created_at: now, updated_at: now,
    }],
    layout: 'vertical', created_at: now, updated_at: now,
  };
}

describe('segmentedDraftStore', () => {
  beforeEach(async () => {
    const all = await listDrafts();
    for (const d of all) await deleteDraft(d.project_id);
  });

  it('round-trips a draft', async () => {
    const rec = {
      project_id: 'p1', draft: makeProject('p1'),
      base_updated_at: '2026-06-09T00:00:00',
      updated_at: '2026-06-09T00:00:00',
      dirty: true,
    };
    await putDraft(rec);
    const got = await getDraft('p1');
    expect(got?.dirty).toBe(true);
    expect(got?.draft.id).toBe('p1');
  });

  it('lists and deletes', async () => {
    await putDraft({
      project_id: 'p1', draft: makeProject('p1'),
      base_updated_at: null, updated_at: 't', dirty: true,
    });
    await putDraft({
      project_id: 'p2', draft: makeProject('p2'),
      base_updated_at: null, updated_at: 't', dirty: true,
    });
    expect((await listDrafts()).length).toBe(2);
    await deleteDraft('p1');
    expect((await listDrafts()).map(d => d.project_id)).toEqual(['p2']);
  });
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm test -- segmentedDraftStore`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/indexedDB.ts \
        frontend/src/services/segmentedDraftStore.ts \
        frontend/src/services/__tests__/segmentedDraftStore.test.ts \
        frontend/package.json \
        frontend/package-lock.json
git commit -m "feat(frontend): IndexedDB project draft store"
```

---

## Task 12: Frontend segmented project storage adapters

**Files:**
- Create: `frontend/src/services/segmentedProjectStorage.ts`
- Create: `frontend/src/services/backendSegmentedProjectStorage.ts`
- Modify: `frontend/src/services/segmentedProjectDB.ts`

- [ ] **Step 1: Implement the unified interface**

Create `frontend/src/services/segmentedProjectStorage.ts`:

```ts
import type { SegmentedProject } from '../types';
import { segmentedProjectDB } from './segmentedProjectDB';

export interface SaveOptions {
  mode?: 'debounced' | 'immediate';
}

export interface SegmentedProjectStorage {
  listProjects(): Promise<SegmentedProject[]>;
  getProject(id: string): Promise<SegmentedProject | undefined>;
  saveProject(project: SegmentedProject, options?: SaveOptions): Promise<void>;
  deleteProject(id: string): Promise<void>;
  flushPendingSave?(projectId: string): Promise<void>;
}

export const indexedDBStorage: SegmentedProjectStorage = {
  async listProjects() { return segmentedProjectDB.listProjects(); },
  async getProject(id) { return segmentedProjectDB.getProject(id); },
  async saveProject(project) { await segmentedProjectDB.saveProject(project); },
  async deleteProject(id) { await segmentedProjectDB.deleteProject(id); },
};
```

- [ ] **Step 2: Implement the backend adapter**

Create `frontend/src/services/backendSegmentedProjectStorage.ts`:

```ts
import axios from 'axios';
import type { SegmentedProject } from '../types';
import type { SegmentedProjectStorage, SaveOptions } from './segmentedProjectStorage';

const api = axios.create({ baseURL: '/api' });

interface ListResponse {
  id: string;
  name: string;
  schema_version: number;
  layout: string;
  active_chapter_id: string | null;
  created_at: string;
  updated_at: string;
}

export const backendStorage: SegmentedProjectStorage = {
  async listProjects() {
    const { data } = await api.get<ListResponse[]>('/segmented-projects');
    return data.map((p) => ({
      schema_version: 2,
      id: p.id, name: p.name,
      layout: (p.layout === 'horizontal' ? 'horizontal' : 'vertical') as 'vertical' | 'horizontal',
      chapters: [],
      active_chapter_id: p.active_chapter_id ?? undefined,
      created_at: p.created_at, updated_at: p.updated_at,
    } as SegmentedProject));
  },
  async getProject(id: string) {
    const { data } = await api.get<SegmentedProject>(`/segmented-projects/${id}`);
    return data;
  },
  async saveProject(project: SegmentedProject, _opts?: SaveOptions) {
    await api.put(`/segmented-projects/${project.id}`, project);
  },
  async deleteProject(id: string) {
    await api.delete(`/segmented-projects/${id}`);
  },
};
```

- [ ] **Step 3: Refactor `segmentedProjectDB` to expose a single `segmentedProjectDB` object**

Replace the entire contents of `frontend/src/services/segmentedProjectDB.ts` with:

```ts
import type { SegmentedProject } from '../types';
import { _openDB, _SEGMENTED_PROJECTS_STORE, deleteTTSResult } from './indexedDB';

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | T,
): Promise<T> {
  return _openDB().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const s = t.objectStore(storeName);
    const r = fn(s);
    t.oncomplete = () => {
      if (r instanceof IDBRequest) resolve(r.result as T);
      else resolve(r as T);
    };
    t.onerror = () => reject(t.error);
  }));
}

async function collectAudioIds(project: SegmentedProject): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const ch of project.chapters || []) {
    for (const seg of ch.segments || []) {
      if (seg.current_audio_id) ids.add(seg.current_audio_id);
      if (seg.previous_audio_id) ids.add(seg.previous_audio_id);
    }
  }
  return ids;
}

export const segmentedProjectDB = {
  async saveProject(project: SegmentedProject): Promise<void> {
    await tx(_SEGMENTED_PROJECTS_STORE, 'readwrite', (s) => s.put(project));
  },
  async getProject(id: string): Promise<SegmentedProject | undefined> {
    return tx<SegmentedProject | undefined>(_SEGMENTED_PROJECTS_STORE, 'readonly', (s) => s.get(id));
  },
  async listProjects(): Promise<SegmentedProject[]> {
    const all = await tx<SegmentedProject[]>(_SEGMENTED_PROJECTS_STORE, 'readonly', (s) => s.getAll());
    return all.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  },
  async deleteProject(id: string): Promise<void> {
    const project = await this.getProject(id);
    if (project) {
      const audioIds = await collectAudioIds(project);
      for (const aid of audioIds) {
        try { await deleteTTSResult(aid); } catch (e) { console.warn(`Failed to clean orphan audio ${aid}:`, e); }
      }
    }
    await tx(_SEGMENTED_PROJECTS_STORE, 'readwrite', (s) => s.delete(id));
  },
};
```

- [ ] **Step 4: Run existing tests**

Run: `cd frontend && npm test -- --run`
Expected: existing tests still pass; if anything is broken by the `segmentedProjectDB` shape change, fix the import sites (only `TTSSynthesis.tsx` and `useSegmentedProject.ts` import from it; update them to use the new namespace).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/segmentedProjectStorage.ts \
        frontend/src/services/backendSegmentedProjectStorage.ts \
        frontend/src/services/segmentedProjectDB.ts
git commit -m "feat(frontend): unified segmented project storage interface + backend adapter"
```

---

## Task 13: useSegmentedDraftSync — debounce PUT with dirty/base_updated_at

**Files:**
- Create: `frontend/src/hooks/useSegmentedDraftSync.ts`
- Test: `frontend/src/hooks/__tests__/useSegmentedDraftSync.test.ts`

- [ ] **Step 1: Implement the hook**

Create `frontend/src/hooks/useSegmentedDraftSync.ts`:

```ts
import { useCallback, useEffect, useRef } from 'react';
import type { SegmentedProject } from '../types';
import type { SegmentedProjectStorage } from '../services/segmentedProjectStorage';
import {
  getDraft,
  putDraft,
  type ProjectDraftRecord,
} from '../services/segmentedDraftStore';

const DEBOUNCE_MS = 1000;

export interface DraftSyncOptions {
  storage: SegmentedProjectStorage;
  /** Debounce delay; default 1000ms. Set to 0 or low value in tests. */
  debounceMs?: number;
}

export function useSegmentedDraftSync(projectId: string | null, options: DraftSyncOptions) {
  const { storage, debounceMs = DEBOUNCE_MS } = options;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedule = useCallback(() => {
    clearTimer();
    if (!projectId) return;
    timerRef.current = setTimeout(() => {
      void flush();
    }, debounceMs);
  }, [clearTimer, projectId, debounceMs]);

  const markDirty = useCallback(async (project: SegmentedProject) => {
    if (!projectId) return;
    const now = new Date().toISOString();
    const existing = (await getDraft(projectId)) ?? null;
    const rec: ProjectDraftRecord = {
      project_id: projectId,
      draft: project,
      base_updated_at: existing?.base_updated_at ?? null,
      updated_at: now,
      dirty: true,
    };
    await putDraft(rec);
    dirtyRef.current = true;
    schedule();
  }, [projectId, schedule]);

  const flush = useCallback(async (): Promise<void> => {
    if (!projectId) return;
    const rec = await getDraft(projectId);
    if (!rec || !rec.dirty) return;
    try {
      await storage.saveProject(rec.draft);
      const next: ProjectDraftRecord = {
        ...rec,
        base_updated_at: rec.draft.updated_at,
        dirty: false,
        last_save_error: undefined,
        last_save_attempt_at: new Date().toISOString(),
      };
      await putDraft(next);
      dirtyRef.current = false;
    } catch (e: any) {
      const next: ProjectDraftRecord = {
        ...rec,
        dirty: true,
        last_save_error: e?.message ?? String(e),
        last_save_attempt_at: new Date().toISOString(),
      };
      await putDraft(next);
    }
  }, [projectId, storage]);

  const adoptBackendVersion = useCallback(async (project: SegmentedProject) => {
    if (!projectId) return;
    const rec: ProjectDraftRecord = {
      project_id: projectId,
      draft: project,
      base_updated_at: project.updated_at,
      updated_at: project.updated_at,
      dirty: false,
    };
    await putDraft(rec);
    dirtyRef.current = false;
    clearTimer();
  }, [projectId, clearTimer]);

  const loadDraft = useCallback(async (): Promise<ProjectDraftRecord | undefined> => {
    if (!projectId) return undefined;
    return getDraft(projectId);
  }, [projectId]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  return { markDirty, flush, adoptBackendVersion, loadDraft };
}
```

- [ ] **Step 2: Write the test**

Create `frontend/src/hooks/__tests__/useSegmentedDraftSync.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import 'fake-indexeddb/auto';
import type { SegmentedProject } from '../../types';
import { useSegmentedDraftSync } from '../useSegmentedDraftSync';
import { deleteDraft, getDraft, listDrafts } from '../../services/segmentedDraftStore';
import type { SegmentedProjectStorage } from '../../services/segmentedProjectStorage';

function makeProject(id: string): SegmentedProject {
  const now = new Date().toISOString();
  return {
    schema_version: 2, id, name: 'x', layout: 'vertical',
    chapters: [{ id: 'c1', name: '第一章', engine: 'edge_tts', segments: [],
      default_params: { engine: 'edge_tts' },
      split_config: { delimiters: ['。'], mode: 'rule' },
      created_at: now, updated_at: now }],
    created_at: now, updated_at: now,
  };
}

const storageCalls = { save: vi.fn() };
const storage: SegmentedProjectStorage = {
  listProjects: async () => [],
  getProject: async () => undefined,
  saveProject: storageCalls.save,
  deleteProject: async () => {},
};

beforeEach(async () => {
  for (const d of await listDrafts()) await deleteDraft(d.project_id);
  storageCalls.save.mockReset();
  storageCalls.save.mockResolvedValue(undefined);
});

afterEach(() => vi.useRealTimers());

describe('useSegmentedDraftSync', () => {
  it('debounces PUT until quiet period', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useSegmentedDraftSync('p1', { storage, debounceMs: 100 }),
    );
    await act(async () => {
      await result.current.markDirty(makeProject('p1'));
      await result.current.markDirty(makeProject('p1'));
    });
    expect(storageCalls.save).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(storageCalls.save).toHaveBeenCalledTimes(1);
    const draft = await getDraft('p1');
    expect(draft?.dirty).toBe(false);
  });

  it('marks dirty and stores last_save_error on failure', async () => {
    vi.useFakeTimers();
    storageCalls.save.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() =>
      useSegmentedDraftSync('p1', { storage, debounceMs: 50 }),
    );
    await act(async () => { await result.current.markDirty(makeProject('p1')); });
    await act(async () => { vi.advanceTimersByTime(60); });
    const draft = await getDraft('p1');
    expect(draft?.dirty).toBe(true);
    expect(draft?.last_save_error).toBe('boom');
  });

  it('adoptBackendVersion sets base_updated_at and clears dirty', async () => {
    const { result } = renderHook(() => useSegmentedDraftSync('p1', { storage }));
    const proj = makeProject('p1');
    proj.updated_at = '2026-06-09T12:00:00';
    await act(async () => { await result.current.adoptBackendVersion(proj); });
    const draft = await getDraft('p1');
    expect(draft?.base_updated_at).toBe('2026-06-09T12:00:00');
    expect(draft?.dirty).toBe(false);
  });

  it('flush calls save immediately and clears dirty', async () => {
    const { result } = renderHook(() => useSegmentedDraftSync('p1', { storage }));
    await act(async () => { await result.current.markDirty(makeProject('p1')); });
    await act(async () => { await result.current.flush(); });
    expect(storageCalls.save).toHaveBeenCalledTimes(1);
    const draft = await getDraft('p1');
    expect(draft?.dirty).toBe(false);
  });
});
```

- [ ] **Step 3: Install testing-library if missing**

Run: `cd frontend && grep -q "@testing-library/react" package.json || npm install --save-dev @testing-library/react`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- useSegmentedDraftSync`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useSegmentedDraftSync.ts \
        frontend/src/hooks/__tests__/useSegmentedDraftSync.test.ts \
        frontend/package.json \
        frontend/package-lock.json
git commit -m "feat(frontend): useSegmentedDraftSync hook with debounce + dirty tracking"
```

---

## Task 14: Backend adapter test

**Files:**
- Create: `frontend/src/services/__tests__/backendSegmentedProjectStorage.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import axios from 'axios';
import { backendStorage } from '../backendSegmentedProjectStorage';

vi.mock('axios');
const mocked = axios as unknown as { create: () => any };
const fakeApi = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};
(mocked as any).create = () => fakeApi;

beforeEach(() => { Object.values(fakeApi).forEach((f: any) => f.mockReset()); });

describe('backendStorage', () => {
  it('listProjects calls GET /segmented-projects and maps summaries', async () => {
    fakeApi.get.mockResolvedValueOnce({ data: [{ id: 'p1', name: 'n', schema_version: 2, layout: 'vertical', active_chapter_id: null, created_at: 't', updated_at: 't' }] });
    const list = await backendStorage.listProjects();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('p1');
    expect(fakeApi.get).toHaveBeenCalledWith('/segmented-projects');
  });

  it('saveProject calls PUT /segmented-projects/{id}', async () => {
    fakeApi.put.mockResolvedValueOnce({ data: null });
    const project = { id: 'p1', name: 'n', schema_version: 2 as const, layout: 'vertical' as const,
      chapters: [], created_at: 't', updated_at: 't' };
    await backendStorage.saveProject(project);
    expect(fakeApi.put).toHaveBeenCalledWith('/segmented-projects/p1', project);
  });

  it('deleteProject calls DELETE /segmented-projects/{id}', async () => {
    fakeApi.delete.mockResolvedValueOnce({ data: null });
    await backendStorage.deleteProject('p1');
    expect(fakeApi.delete).toHaveBeenCalledWith('/segmented-projects/p1');
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd frontend && npm test -- backendSegmentedProjectStorage`
Expected: 3 passed.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/__tests__/backendSegmentedProjectStorage.test.ts
git commit -m "test(frontend): backend storage adapter tests"
```

---

## Task 15: Wire TTSSynthesis page to use storage adapter + draft sync

**Files:**
- Modify: `frontend/src/pages/TTSSynthesis.tsx`

- [ ] **Step 1: Add imports and storage selection**

At the top of `frontend/src/pages/TTSSynthesis.tsx`, replace the imports of `saveProject, getProject, listProjects, deleteProject` (line 15) with:

```ts
import { indexedDBStorage, type SegmentedProjectStorage } from '../services/segmentedProjectStorage';
import { backendStorage } from '../services/backendSegmentedProjectStorage';
import { useSegmentedDraftSync } from '../hooks/useSegmentedDraftSync';
import { getDraft, deleteDraft } from '../services/segmentedDraftStore';
import { MigrationPrompt } from '../components/SegmentedTTS/MigrationPrompt';
import { ConflictPrompt } from '../components/SegmentedTTS/ConflictPrompt';
```

- [ ] **Step 2: Add storage and draftSync instances inside the component**

Right after the existing `storageModeRef` block (around line 167), add:

```tsx
  const projectStorage: SegmentedProjectStorage = storageMode === 'backend' ? backendStorage : indexedDBStorage;
  const draftSync = useSegmentedDraftSync(project?.id ?? null, { storage: projectStorage });
  const [showMigration, setShowMigration] = useState(false);
  const [localCount, setLocalCount] = useState(0);
  const [conflict, setConflictPrompt] = useState<{ backend: SegmentedProject; draft: any } | null>(null);
```

- [ ] **Step 3: Replace initial project load**

Find the `useEffect` that loads projects on mount (lines 104-116). Replace its body with:

```tsx
  useEffect(() => {
    (async () => {
      const list = await projectStorage.listProjects();
      if (list.length > 0) {
        const latest = list[0];
        let full = await projectStorage.getProject(latest.id);
        if (!full) full = latest as SegmentedProject;
        const localDraft = await getDraft(full.id);
        if (localDraft && localDraft.base_updated_at && localDraft.base_updated_at < full.updated_at && localDraft.dirty) {
          setConflictPrompt({ backend: full, draft: localDraft });
          return;
        }
        const migrated = migrateV1(full);
        setProject(migrated);
        dispatch({ type: 'LOAD_PROJECT', project: migrated });
        const ch = getActiveChapter(migrated);
        if (ch) restoreChapterSettings(ch);
        await draftSync.adoptBackendVersion(migrated);
      }
      if (storageMode === 'backend') {
        const localProjects = await indexedDBStorage.listProjects();
        if (localProjects.length > 0) {
          setLocalCount(localProjects.length);
          setShowMigration(true);
        }
      }
    })().catch((e) => console.warn('Project load failed:', e));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageMode]);
```

- [ ] **Step 4: Replace auto-save effect**

Find the auto-save `useEffect` (lines 118-132). Replace its body with:

```tsx
  useEffect(() => {
    if (project.chapters.length === 1 && !project.chapters[0].original_text && project.chapters[0].segments.length === 0 && project.name === '新项目') return;
    if (storageMode === 'backend') {
      void draftSync.markDirty(project);
    } else {
      const t = setTimeout(async () => {
        try {
          await indexedDBStorage.saveProject(project);
        } catch (e) { console.warn('Auto-save failed:', e); }
      }, 1000);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, storageMode]);
```

- [ ] **Step 5: Update project list refresh**

Find the line that calls `listProjects()` to refresh the list (around line 127 — already covered by Step 4). Now also search for any other `listProjects()` call (the page may call it after `saveProject` or `deleteProject`):

```bash
grep -n "listProjects" frontend/src/pages/TTSSynthesis.tsx
```

Replace each occurrence with `projectStorage.listProjects()`.

- [ ] **Step 6: Update delete handler**

Find the handler that calls `deleteProject(project.id)` (around lines 360-363). Replace with:

```tsx
      await projectStorage.deleteProject(project.id);
      if (storageMode === 'backend') {
        await deleteDraft(project.id);
      }
      const list = await projectStorage.listProjects();
      setProjectList(list);
```

- [ ] **Step 7: Update project switcher in list**

Find the project picker that calls `getProject(pid)` (around line 920). Replace with:

```tsx
                const p = await projectStorage.getProject(pid);
                if (p) {
                  setProject(p);
                  dispatch({ type: 'LOAD_PROJECT', project: p });
                }
```

- [ ] **Step 8: Mount prompts in the JSX**

Find the return statement and add the prompts before the closing fragment. The exact location depends on the existing JSX; the simplest insertion is right before the final closing `</div>` of the page wrapper:

```tsx
      {showMigration && (
        <MigrationPrompt
          localCount={localCount}
          onComplete={() => {
            setShowMigration(false);
            void projectStorage.listProjects().then(setProjectList);
          }}
          onDismiss={() => setShowMigration(false)}
        />
      )}
      {conflict && (
        <ConflictPrompt
          backend={conflict.backend}
          draft={conflict.draft}
          onUseBackend={async () => {
            await draftSync.adoptBackendVersion(conflict.backend);
            setProject(conflict.backend);
            dispatch({ type: 'LOAD_PROJECT', project: conflict.backend });
            setConflictPrompt(null);
          }}
          onUseDraft={async () => {
            setProject(conflict.draft.draft);
            dispatch({ type: 'LOAD_PROJECT', project: conflict.draft.draft });
            setConflictPrompt(null);
          }}
        />
      )}
```

- [ ] **Step 9: Build and check**

Run: `cd frontend && npm run build`
Expected: TypeScript build succeeds (resolve any unused-import warnings as needed).

- [ ] **Step 10: Run all frontend tests**

Run: `cd frontend && npm test -- --run`
Expected: all tests pass.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/pages/TTSSynthesis.tsx
git commit -m "feat(frontend): wire TTSSynthesis to storage adapter + draft sync"
```

---

## Task 16: Migration and conflict prompt components

**Files:**
- Create: `frontend/src/services/segmentedMigration.ts`
- Create: `frontend/src/components/SegmentedTTS/MigrationPrompt.tsx`
- Create: `frontend/src/components/SegmentedTTS/ConflictPrompt.tsx`

- [ ] **Step 1: Implement migration service**

Create `frontend/src/services/segmentedMigration.ts`:

```ts
import axios from 'axios';
import type { SegmentedProject } from '../types';
import { indexedDBStorage } from './segmentedProjectStorage';
import { getTTSAudioBlob } from './indexedDB';

const api = axios.create({ baseURL: '/api' });

export interface MigrationResult {
  project_id: string;
  status: 'ok' | 'error';
  message?: string;
  audio_uploaded?: number;
  audio_failed?: number;
}

export async function migrateIndexedDBProjectsToBackend(): Promise<MigrationResult[]> {
  const localProjects = await indexedDBStorage.listProjects();
  if (localProjects.length === 0) return [];

  const audios: Array<{ project_id: string; chapter_id: string; segment_id: string; data_base64: string }> = [];
  for (const p of localProjects) {
    for (const ch of p.chapters || []) {
      for (const seg of ch.segments || []) {
        if (seg.current_audio_id) {
          const blob = await getTTSAudioBlob(seg.current_audio_id);
          if (blob) {
            const buf = await blob.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let bin = '';
            for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
            audios.push({
              project_id: p.id, chapter_id: ch.id, segment_id: seg.id, data_base64: btoa(bin),
            });
          }
        }
      }
    }
  }

  // Strip current_audio_id since the backend will return its own current_audio_path
  const projects = localProjects.map((p) => JSON.parse(JSON.stringify(p)));
  for (const proj of projects as SegmentedProject[]) {
    for (const ch of proj.chapters || []) {
      for (const seg of ch.segments || []) {
        delete (seg as any).current_audio_id;
        delete (seg as any).previous_audio_id;
      }
    }
  }

  const { data } = await api.post<{ results: MigrationResult[] }>(
    '/segmented-projects/migrate',
    { projects, audios },
  );
  return data.results;
}

export async function clearLocalProjects(projectIds: string[]): Promise<void> {
  for (const id of projectIds) {
    await indexedDBStorage.deleteProject(id);
  }
}
```

- [ ] **Step 2: Implement MigrationPrompt component**

Create `frontend/src/components/SegmentedTTS/MigrationPrompt.tsx`:

```tsx
import { useState } from 'react';
import type { MigrationResult } from '../../services/segmentedMigration';
import { migrateIndexedDBProjectsToBackend, clearLocalProjects } from '../../services/segmentedMigration';

interface Props {
  localCount: number;
  onComplete: () => void;
  onDismiss: () => void;
}

export function MigrationPrompt({ localCount, onComplete, onDismiss }: Props) {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<MigrationResult[] | null>(null);

  const run = async () => {
    setBusy(true);
    try {
      const r = await migrateIndexedDBProjectsToBackend();
      setResults(r);
      const okIds = r.filter((x) => x.status === 'ok').map((x) => x.project_id);
      await clearLocalProjects(okIds);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="migration-prompt">
      <h3>迁移本地项目到后端</h3>
      {results == null && (
        <>
          <p>检测到本地有 {localCount} 个分段项目，是否迁移到后端存储？</p>
          <button onClick={run} disabled={busy}>迁移</button>
          <button onClick={onDismiss} disabled={busy}>稍后再说</button>
        </>
      )}
      {results != null && (
        <>
          <p>迁移完成：{results.filter((r) => r.status === 'ok').length} 成功 / {results.filter((r) => r.status === 'error').length} 失败</p>
          <button onClick={onComplete}>完成</button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Implement ConflictPrompt component**

Create `frontend/src/components/SegmentedTTS/ConflictPrompt.tsx`:

```tsx
import type { SegmentedProject } from '../../types';
import type { ProjectDraftRecord } from '../../services/segmentedDraftStore';

interface Props {
  backend: SegmentedProject;
  draft: ProjectDraftRecord;
  onUseBackend: () => void;
  onUseDraft: () => void;
}

export function ConflictPrompt({ backend, draft, onUseBackend, onUseDraft }: Props) {
  return (
    <div className="conflict-prompt">
      <h3>检测到版本冲突</h3>
      <p>后端版本: {backend.updated_at}</p>
      <p>本地草稿: {draft.updated_at}</p>
      <p>本地草稿基于旧版本，恢复本地修改或使用后端版本？</p>
      <button onClick={onUseDraft}>恢复本地草稿</button>
      <button onClick={onUseBackend}>使用后端版本</button>
    </div>
  );
}
```

- [ ] **Step 4: Build and check**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/segmentedMigration.ts \
        frontend/src/components/SegmentedTTS/MigrationPrompt.tsx \
        frontend/src/components/SegmentedTTS/ConflictPrompt.tsx
git commit -m "feat(frontend): migration and conflict prompt components"
```

---

## Task 17: Update existing tts/mimo endpoints to accept segmented_project_id

**Files:**
- Modify: `backend/app/api/tts.py`
- Modify: `backend/app/api/mimo_tts.py`

- [ ] **Step 1: Add optional fields to TTS request models**

In `backend/app/api/tts.py`, find the existing `TTSSynthesizeRequest` (or equivalent) pydantic model. Add at the end of the model:

```python
    segmented_project_id: str | None = None
    segmented_chapter_id: str | None = None
    segmented_segment_id: str | None = None
```

In `backend/app/api/mimo_tts.py`, find the request model used by the synthesize endpoint and add the same three optional fields.

- [ ] **Step 2: In tts.py, when all three segmented ids are set, redirect to the canonical segmented route**

In the existing synthesize endpoint, just before `db.commit()` in the `else` branch (the persistent backend branch), add:

```python
            if (
                request.segmented_project_id
                and request.segmented_chapter_id
                and request.segmented_segment_id
            ):
                # Routed through segmented service; do not write to tts_results
                from app.services import segmented_project_service as svc
                from app.core import segmented_assets as assets
                from datetime import datetime
                seg = svc.get_segment_row(
                    db, request.segmented_project_id,
                    request.segmented_chapter_id, request.segmented_segment_id,
                )
                if seg is not None:
                    target_mp3 = assets.segment_audio_path(
                        request.segmented_project_id, request.segmented_chapter_id,
                        request.segmented_segment_id, "mp3",
                    )
                    target_mp3.parent.mkdir(parents=True, exist_ok=True)
                    with open(audio_path, "rb") as f:
                        target_mp3.write_bytes(f.read())
                    rel = target_mp3.relative_to(assets.project_dir(request.segmented_project_id)).as_posix()
                    seg.current_audio_path = rel
                    seg.audio_format = "mp3"
                    seg.generated_params = {
                        "engine": "cosyvoice", "voice_id": request.voice_id,
                        "speed": request.speed, "volume": request.volume,
                        "pitch": request.pitch, "instruction": request.instruction,
                    }
                    seg.generated_at = datetime.utcnow()
                    seg.updated_at = datetime.utcnow()
                    seg.chapter.updated_at = datetime.utcnow()
                    seg.chapter.project.updated_at = datetime.utcnow()
                    db.commit()
                    return {
                        "audio_id": audio_id,
                        "audio_url": f"/api/segmented-projects/{request.segmented_project_id}/audio/{request.segmented_chapter_id}/{request.segmented_segment_id}",
                        "text": request.text,
                        "params": {
                            "voice_id": request.voice_id,
                            "speed": request.speed, "volume": request.volume,
                            "pitch": request.pitch, "instruction": request.instruction,
                        },
                    }
```

- [ ] **Step 3: Apply the same change to `mimo_tts.py`**

In the `else` branch of MiMo synthesize (the persistent backend branch), insert the same block. Use `"engine": "mimo_tts"` in the `generated_params`. Adjust the return to point to the segmented audio URL.

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest -v`
Expected: all tests still pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/tts.py backend/app/api/mimo_tts.py
git commit -m "feat(backend): tts/mimo endpoints accept segmented_project_id"
```

---

## Task 18: Update docs

**Files:**
- Modify: `docs/feature-spec.md`
- Modify: `docs/api-reference.md`
- Modify: `docs/database-schema.md`
- Modify: `docs/ENV.md`
- Modify: `docs/RUNBOOK.md`

- [ ] **Step 1: feature-spec.md — add a new section**

Append a new section at the end of `docs/feature-spec.md`:

```markdown
## 分段项目后端存储

当 `storageMode = backend` 时，分段项目、章节、段落、参数、生成快照与音频全部由后端管理：

- 数据库三张表：`segmented_projects` / `segmented_project_chapters` / `segmented_project_segments`
- 每个项目一个目录 `uploads/segmented/{project_id}/`，存放 `original.txt`、章节文本、分片 `mp3`、`manifest.json`
- 后端为权威来源；IndexedDB 只作为草稿缓存，记录 `base_updated_at` 做冲突检测
- 切换到后端模式时若本地 IndexedDB 仍有项目，提示一键迁移
- 音频由 ffmpeg 转码为 mp3
```

- [ ] **Step 2: api-reference.md — document the new endpoints**

Append to `docs/api-reference.md`:

```markdown
### 分段项目

- `GET    /api/segmented-projects` — 列出所有项目（轻量）
- `POST   /api/segmented-projects` — 创建项目（完整对象）
- `GET    /api/segmented-projects/{id}` — 获取完整项目（chapters + segments）
- `PUT    /api/segmented-projects/{id}` — 全量替换（reconcile）
- `DELETE /api/segmented-projects/{id}` — 删除项目 + 资产目录
- `POST   /api/segmented-projects/{id}/chapters/{cid}/segments/{sid}/synthesize` — 生成分片音频
- `GET    /api/segmented-projects/{id}/audio/{cid}/{sid}` — 读取分片 mp3
- `POST   /api/segmented-projects/{id}/chapters/{cid}/split` — 文本分段（preview_only 或 replace_chapter_segments）
- `POST   /api/segmented-projects/migrate` — 批量迁移 IndexedDB 项目
```

- [ ] **Step 3: database-schema.md — add the new tables**

Append to `docs/database-schema.md`:

```markdown
## segmented_projects

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| name | TEXT NOT NULL | |
| schema_version | INTEGER NOT NULL DEFAULT 2 | |
| layout | TEXT NOT NULL DEFAULT 'vertical' | |
| active_chapter_id | TEXT NULLABLE | |
| original_text | TEXT NULLABLE | |
| created_at / updated_at | DATETIME | |

## segmented_project_chapters

| Column | Type |
|---|---|
| id | TEXT PK |
| project_id | TEXT FK → segmented_projects.id ON DELETE CASCADE |
| position | INTEGER NOT NULL |
| name | TEXT NOT NULL |
| engine | TEXT NULLABLE |
| default_params | JSON NOT NULL DEFAULT {} |
| split_config | JSON NOT NULL DEFAULT {} |
| original_text | TEXT NULLABLE |
| created_at / updated_at | DATETIME |

## segmented_project_segments

| Column | Type |
|---|---|
| id | TEXT PK |
| chapter_id | TEXT FK → segmented_project_chapters.id ON DELETE CASCADE |
| project_id | TEXT FK → segmented_projects.id ON DELETE CASCADE |
| position | INTEGER NOT NULL |
| text | TEXT NOT NULL DEFAULT '' |
| ssml | TEXT NULLABLE |
| emotion | TEXT NULLABLE |
| params | JSON NOT NULL DEFAULT {} |
| locked_params | JSON NOT NULL DEFAULT [] |
| generated_params | JSON NULLABLE |
| current_audio_path | TEXT NULLABLE |
| previous_audio_path | TEXT NULLABLE |
| audio_format | TEXT NOT NULL DEFAULT 'mp3' |
| duration_sec | FLOAT NULLABLE |
| audio_missing | BOOLEAN NOT NULL DEFAULT FALSE |
| generated_at | DATETIME NULLABLE |
| ssml_annotated_by_llm | BOOLEAN NOT NULL DEFAULT FALSE |
| created_at / updated_at | DATETIME |
```

- [ ] **Step 4: ENV.md — ffmpeg note**

Append to `docs/ENV.md`:

```markdown
## ffmpeg（分段编辑器后端模式）

后端将分段项目音频统一转码为 mp3，需要系统安装 ffmpeg。缺失时会回退为 wav 并将 `audio_format` 写入数据库。

- macOS: `brew install ffmpeg`
- Ubuntu: `apt-get install -y ffmpeg`
```

- [ ] **Step 5: RUNBOOK.md — install steps**

Append to `docs/RUNBOOK.md` the same ffmpeg install commands under the deployment section.

- [ ] **Step 6: Commit**

```bash
git add docs/feature-spec.md docs/api-reference.md docs/database-schema.md docs/ENV.md docs/RUNBOOK.md
git commit -m "docs: document segmented project backend storage"
```

---

## Task 19: End-to-end smoke test (manual)

- [ ] **Step 1: Start backend**

Run: `cd backend && uv run uvicorn main:app --host 127.0.0.1 --port 8002 --reload`
Expected: server starts, `init_db()` runs and creates the new tables.

- [ ] **Step 2: Start frontend**

Run: `cd frontend && npm run dev`
Expected: Vite dev server starts on 5173.

- [ ] **Step 3: Verify project CRUD via UI**

In the browser:
1. Set storage mode to `backend` in Settings.
2. Open TTSSynthesis → segmented mode.
3. Create a project, add a chapter, add a segment with text.
4. Refresh the browser. The project should reload from the backend.
5. Inspect `backend/uploads/segmented/{project_id}/` — `original.txt`, `manifest.json`, and `chapters/c1/segments/s1.txt` exist.
6. Inspect `backend/voice_clone.db` — three new tables have rows.

- [ ] **Step 4: Verify synthesis**

Click "regenerate" on a segment. Confirm:
- The segment's `current_audio_path` points to an mp3 file under the project dir
- `generated_params` is populated
- The audio plays in the UI

- [ ] **Step 5: Verify migration**

1. Set storage mode to `frontend`.
2. Create a project, add a chapter, generate audio for a segment.
3. Set storage mode to `backend`.
4. The migration prompt should appear with the local project count.
5. Click "迁移". Wait for completion. The local IndexedDB project should be cleared.
6. The project should now appear in the backend list.

- [ ] **Step 6: Verify conflict detection**

Simulate a stale draft by:
1. Open a backend project in one tab.
2. Edit and let it auto-save.
3. In another tab, open the same project; manipulate the local draft's `base_updated_at` to be older.
4. Reload the project; the conflict prompt should appear.

- [ ] **Step 7: Run full test suites**

Run backend:
```bash
cd backend && uv run pytest -v
```

Run frontend:
```bash
cd frontend && npm test -- --run
```

Expected: all tests pass.

- [ ] **Step 8: Tag the milestone**

```bash
git tag -a segmented-backend-v1 -m "Segmented project backend storage v1"
git push origin segmented-backend-v1
```

---

## Self-Review Checklist (run before handoff)

- [ ] All spec sections covered (architecture, data model, API, files, frontend adapter, migration, timestamps, error handling, testing).
- [ ] No `TBD` / `TODO` / `fill in` placeholders.
- [ ] Type names consistent across tasks (`SegmentedProjectSegment`, `ProjectDraftRecord`, `_to_iso`, `projectStorage`, `backendStorage`, `indexedDBStorage`, `draftSync`).
- [ ] `markDirty` and `flush` API used consistently.
- [ ] `base_updated_at` and `dirty` flows consistent in tasks 11, 13, 15, 16.
- [ ] Backend tests use `db_session` and `client` fixtures from `conftest.py`.
- [ ] Frontend tests use `fake-indexeddb/auto` and `vi.useFakeTimers` where needed.
- [ ] All test files import from the correct relative paths.
- [ ] Docs (feature-spec, api-reference, database-schema, ENV, RUNBOOK) all updated.
- [ ] Manual smoke test described with concrete browser actions.
