# Dialogue Prosody Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a backend global role library, segment-level role snapshots, chat-style dialogue view, and local prosody marks for sub-sentence tone control.

**Architecture:** Keep the existing segment-first project model. Add backend role assets and additive segment/project fields, then render an alternate dialogue view over the same `Segment[]` data. Use role snapshots for reproducible generation and local `prosody_marks` for inline tone annotations.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, pytest, React 19, TypeScript, Vite, Vitest, CSS Modules, Playwright.

---

## Scope and sequencing

This spec spans backend persistence, frontend editing, UI, and generation. The tasks below are sequenced so each commit leaves the app in a working state:

1. Backend role library API.
2. Backend segmented project field persistence.
3. Frontend shared role/prosody types, migration, reducer, and API client.
4. Role library panel and picker.
5. Dialogue view, narration blocks, and view switching.
6. Inline prosody mark editor.
7. Generation input resolution, stale detection, and capability reporting.
8. Split-and-concat fallback boundary and final E2E coverage.

## File structure

### Backend

- Create: `backend/app/models/role.py` — SQLAlchemy global role model.
- Modify: `backend/app/models/__init__.py` — export `Role`.
- Create: `backend/app/schemas/role.py` — `RoleIn`, `RoleUpdate`, `RoleOut`.
- Create: `backend/app/services/role_service.py` — role CRUD and serializer.
- Create: `backend/app/api/roles.py` — thin FastAPI routes.
- Modify: `backend/main.py` — include roles router.
- Modify: `backend/app/models/segmented_project.py` — project narrator fields and segment role/prosody fields.
- Modify: `backend/app/schemas/segmented_project.py` — request/response fields.
- Modify: `backend/app/services/segmented_project_service.py` — save/load new fields and generation metadata.
- Modify: `backend/app/core/database.py` — idempotent column migration statements.
- Create: `backend/tests/test_roles_api.py` — API round-trip tests.
- Create: `backend/tests/test_role_service.py` — service-level snapshot behavior tests.
- Modify: `backend/tests/test_segmented_projects_api.py` — schema round-trip test.
- Modify: `backend/tests/test_segmented_projects_service.py` — save/load new fields test.
- Modify: `backend/tests/test_segmented_synthesis.py` — generated metadata and stale-input tests.

### Frontend shared model and services

- Modify: `frontend/src/types/index.ts` — role, snapshot, prosody, segment kind, capability types.
- Modify: `frontend/src/hooks/useSegmentedProject.ts` — migration defaults and immutable reducer actions.
- Modify: `frontend/src/hooks/__tests__/useSegmentedProject.test.ts` — reducer tests.
- Modify: `frontend/src/services/api.ts` — role API client.
- Create: `frontend/src/services/prosodyCapabilities.ts` — engine capability constants.
- Create: `frontend/src/services/segmentGenerationInputs.ts` — effective-input calculation for stale detection.
- Create: `frontend/src/services/segmentGenerationInputs.test.ts` — stale input tests.

### Frontend role UI

- Create: `frontend/src/components/SegmentedTTS/RoleLibraryPanel.tsx`.
- Create: `frontend/src/components/SegmentedTTS/RoleLibraryPanel.module.css`.
- Create: `frontend/src/components/SegmentedTTS/RolePicker.tsx`.
- Create: `frontend/src/components/SegmentedTTS/RolePicker.module.css`.
- Create: `frontend/src/components/SegmentedTTS/RoleSyncPrompt.tsx`.
- Create: `frontend/src/components/SegmentedTTS/RoleSyncPrompt.module.css`.

### Frontend dialogue and prosody UI

- Create: `frontend/src/components/SegmentedTTS/ChatSegmentView.tsx`.
- Create: `frontend/src/components/SegmentedTTS/ChatSegmentView.module.css`.
- Create: `frontend/src/components/SegmentedTTS/ChatBubble.tsx`.
- Create: `frontend/src/components/SegmentedTTS/ChatBubble.module.css`.
- Create: `frontend/src/components/SegmentedTTS/NarrationBlock.tsx`.
- Create: `frontend/src/components/SegmentedTTS/NarrationBlock.module.css`.
- Create: `frontend/src/components/SegmentedTTS/ProsodyMarkEditor.tsx`.
- Create: `frontend/src/components/SegmentedTTS/ProsodyMarkEditor.module.css`.
- Modify: `frontend/src/pages/TTSSynthesis.tsx` — view switch state and wiring only.
- Modify: `frontend/src/components/SegmentedTTS/SegmentRow.tsx` — use shared stale detection helper.

### E2E

- Create: `tests/e2e/specs/dialogue-prosody.spec.ts` — critical workflow.

---

## Task 1: Backend global role library

**Files:**
- Create: `backend/app/models/role.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/app/schemas/role.py`
- Create: `backend/app/services/role_service.py`
- Create: `backend/app/api/roles.py`
- Modify: `backend/main.py:95-108`
- Create: `backend/tests/test_roles_api.py`
- Create: `backend/tests/test_role_service.py`

- [ ] **Step 1: Write failing API tests**

Create `backend/tests/test_roles_api.py`:

```python
from __future__ import annotations


def _role_payload(role_id: str = "role-linxia") -> dict:
    return {
        "id": role_id,
        "name": "林夏",
        "avatar": "avatar://linxia",
        "description": "温柔但紧张的女主角",
        "default_engine": "edge_tts",
        "default_voice": "zh-CN-XiaoxiaoNeural",
        "default_engine_params": {
            "engine": "edge_tts",
            "edge_voice": "zh-CN-XiaoxiaoNeural",
            "edge_rate": "+0%",
            "edge_volume": "+0%",
        },
        "favorite_styles": [
            {"id": "soft", "name": "低声", "style_tags": ["low_voice"]},
        ],
    }


def test_roles_crud_round_trip(client):
    created = client.post("/api/roles", json=_role_payload())
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["id"] == "role-linxia"
    assert body["name"] == "林夏"
    assert body["default_engine"] == "edge_tts"
    assert body["default_engine_params"]["edge_voice"] == "zh-CN-XiaoxiaoNeural"
    assert body["favorite_styles"][0]["name"] == "低声"
    assert body["created_at"]
    assert body["updated_at"]

    listed = client.get("/api/roles")
    assert listed.status_code == 200
    assert [role["id"] for role in listed.json()] == ["role-linxia"]

    updated = client.put(
        "/api/roles/role-linxia",
        json={
            "name": "林夏新版",
            "default_voice": "zh-CN-XiaoyiNeural",
            "default_engine_params": {
                "engine": "edge_tts",
                "edge_voice": "zh-CN-XiaoyiNeural",
            },
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "林夏新版"
    assert updated.json()["default_voice"] == "zh-CN-XiaoyiNeural"

    deleted = client.delete("/api/roles/role-linxia")
    assert deleted.status_code == 204
    assert client.get("/api/roles").json() == []


def test_role_create_rejects_duplicate_id(client):
    payload = _role_payload("role-dup")
    assert client.post("/api/roles", json=payload).status_code == 201
    duplicate = client.post("/api/roles", json=payload)
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "role_already_exists"


def test_role_update_missing_returns_404(client):
    response = client.put("/api/roles/missing", json={"name": "missing"})
    assert response.status_code == 404
    assert response.json()["detail"] == "role_not_found"
```

- [ ] **Step 2: Write failing service tests**

Create `backend/tests/test_role_service.py`:

```python
from __future__ import annotations

import pytest

from app.schemas.role import RoleIn, RoleUpdate
from app.services.role_service import create_role, delete_role, get_role, list_roles, role_to_out, update_role


def _role_in(role_id: str = "role-narrator") -> RoleIn:
    return RoleIn(
        id=role_id,
        name="旁白",
        avatar="avatar://narrator",
        description="默认旁白声线",
        default_engine="edge_tts",
        default_voice="zh-CN-YunjianNeural",
        default_engine_params={
            "engine": "edge_tts",
            "edge_voice": "zh-CN-YunjianNeural",
        },
        favorite_styles=[{"id": "calm", "name": "沉稳", "style_tags": ["calm"]}],
    )


def test_create_and_list_roles(db_session):
    role = create_role(db_session, _role_in())
    db_session.commit()

    out = role_to_out(role)
    assert out.id == "role-narrator"
    assert out.name == "旁白"
    assert out.default_engine_params["edge_voice"] == "zh-CN-YunjianNeural"

    rows = list_roles(db_session)
    assert [item.id for item in rows] == ["role-narrator"]


def test_create_role_rejects_duplicate(db_session):
    create_role(db_session, _role_in("role-dup"))
    db_session.commit()

    with pytest.raises(ValueError, match="role_already_exists"):
        create_role(db_session, _role_in("role-dup"))


def test_update_role_merges_only_provided_fields(db_session):
    create_role(db_session, _role_in())
    db_session.commit()

    updated = update_role(
        db_session,
        "role-narrator",
        RoleUpdate(name="旁白新版", description=None),
    )
    db_session.commit()

    assert updated is not None
    assert updated.name == "旁白新版"
    assert updated.description is None
    assert updated.default_engine == "edge_tts"
    assert updated.default_engine_params["edge_voice"] == "zh-CN-YunjianNeural"


def test_delete_role_returns_false_for_missing(db_session):
    assert delete_role(db_session, "missing") is False


def test_get_role_returns_none_for_missing(db_session):
    assert get_role(db_session, "missing") is None
```

- [ ] **Step 3: Run backend role tests to verify they fail**

Run:

```bash
cd backend && uv run --extra test pytest tests/test_roles_api.py tests/test_role_service.py -q
```

Expected: FAIL with import errors for `app.schemas.role` or missing `/api/roles` routes.

- [ ] **Step 4: Create SQLAlchemy role model**

Create `backend/app/models/role.py`:

```python
from __future__ import annotations

from sqlalchemy import Column, DateTime, JSON, String

from app.core.database import Base
from app.core.time_utils import utcnow


class Role(Base):
    __tablename__ = "roles"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    avatar = Column(String, nullable=True)
    description = Column(String, nullable=True)
    default_engine = Column(String, nullable=False, default="edge_tts")
    default_voice = Column(String, nullable=True)
    default_engine_params = Column(JSON, nullable=False, default=dict)
    favorite_styles = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Role(id={self.id}, name={self.name!r})>"
```

- [ ] **Step 5: Export role model**

Modify `backend/app/models/__init__.py` by adding the import and `__all__` entry:

```python
from app.models.role import Role
```

Add this string inside `__all__`:

```python
"Role",
```

- [ ] **Step 6: Create role schemas**

Create `backend/app/schemas/role.py`:

```python
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class RoleIn(BaseModel):
    id: str
    name: str = Field(..., min_length=1)
    avatar: str | None = None
    description: str | None = None
    default_engine: str = "edge_tts"
    default_voice: str | None = None
    default_engine_params: dict[str, Any] = Field(default_factory=dict)
    favorite_styles: list[dict[str, Any]] = Field(default_factory=list)


class RoleUpdate(BaseModel):
    name: str | None = None
    avatar: str | None = None
    description: str | None = None
    default_engine: str | None = None
    default_voice: str | None = None
    default_engine_params: dict[str, Any] | None = None
    favorite_styles: list[dict[str, Any]] | None = None


class RoleOut(RoleIn):
    created_at: str
    updated_at: str
```

- [ ] **Step 7: Create role service**

Create `backend/app/services/role_service.py`:

```python
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.time_utils import utcnow
from app.models.role import Role
from app.schemas.role import RoleIn, RoleOut, RoleUpdate


def _to_iso(value: datetime | None) -> str:
    if value is None:
        return ""
    if value.tzinfo is None:
        return value.isoformat()
    return value.astimezone(timezone.utc).isoformat()


def role_to_out(role: Role) -> RoleOut:
    return RoleOut(
        id=role.id,
        name=role.name,
        avatar=role.avatar,
        description=role.description,
        default_engine=role.default_engine,
        default_voice=role.default_voice,
        default_engine_params=role.default_engine_params or {},
        favorite_styles=role.favorite_styles or [],
        created_at=_to_iso(role.created_at),
        updated_at=_to_iso(role.updated_at),
    )


def list_roles(db: Session) -> list[RoleOut]:
    roles = db.query(Role).order_by(Role.updated_at.desc()).all()
    return [role_to_out(role) for role in roles]


def get_role(db: Session, role_id: str) -> Role | None:
    return db.query(Role).filter_by(id=role_id).first()


def create_role(db: Session, payload: RoleIn) -> Role:
    if get_role(db, payload.id) is not None:
        raise ValueError("role_already_exists")
    role = Role(
        id=payload.id,
        name=payload.name,
        avatar=payload.avatar,
        description=payload.description,
        default_engine=payload.default_engine,
        default_voice=payload.default_voice,
        default_engine_params=payload.default_engine_params,
        favorite_styles=payload.favorite_styles,
    )
    db.add(role)
    db.flush()
    return role


def update_role(db: Session, role_id: str, payload: RoleUpdate) -> Role | None:
    role = get_role(db, role_id)
    if role is None:
        return None
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(role, key, value)
    role.updated_at = utcnow()
    db.flush()
    return role


def delete_role(db: Session, role_id: str) -> bool:
    role = get_role(db, role_id)
    if role is None:
        return False
    db.delete(role)
    db.flush()
    return True
```

- [ ] **Step 8: Create role API router**

Create `backend/app/api/roles.py`:

```python
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.role import RoleIn, RoleOut, RoleUpdate
from app.services import role_service as svc

router = APIRouter()


@router.get("/roles", response_model=list[RoleOut])
def list_roles(db: Session = Depends(get_db)) -> list[RoleOut]:
    return svc.list_roles(db)


@router.post("/roles", response_model=RoleOut, status_code=201)
def create_role(payload: RoleIn, db: Session = Depends(get_db)) -> RoleOut:
    try:
        role = svc.create_role(db, payload)
        db.commit()
    except ValueError as exc:
        db.rollback()
        if str(exc) == "role_already_exists":
            raise HTTPException(status_code=409, detail="role_already_exists") from exc
        raise
    return svc.role_to_out(role)


@router.put("/roles/{role_id}", response_model=RoleOut)
def update_role(role_id: str, payload: RoleUpdate, db: Session = Depends(get_db)) -> RoleOut:
    role = svc.update_role(db, role_id, payload)
    if role is None:
        raise HTTPException(status_code=404, detail="role_not_found")
    db.commit()
    db.refresh(role)
    return svc.role_to_out(role)


@router.delete("/roles/{role_id}", status_code=204)
def delete_role(role_id: str, db: Session = Depends(get_db)) -> None:
    if not svc.delete_role(db, role_id):
        raise HTTPException(status_code=404, detail="role_not_found")
    db.commit()
    return None
```

- [ ] **Step 9: Register the router**

Modify `backend/main.py` import line to include `roles`:

```python
from app.api import clone, tts, config, speech_to_text, mimo_tts, subtitle_llm, model_config, text_split, segmented_projects, voxcpm, sources, narrations, roles
```

Add after the narrations router:

```python
app.include_router(roles.router, prefix="/api", tags=["roles"])
```

- [ ] **Step 10: Run role tests**

Run:

```bash
cd backend && uv run --extra test pytest tests/test_roles_api.py tests/test_role_service.py -q
```

Expected: PASS.

- [ ] **Step 11: Run focused backend regression tests**

Run:

```bash
cd backend && uv run --extra test pytest tests/test_segmented_projects_api.py tests/test_segmented_projects_service.py -q
```

Expected: PASS.

- [ ] **Step 12: Commit backend role library**

Run:

```bash
git add backend/app/models/role.py backend/app/models/__init__.py backend/app/schemas/role.py backend/app/services/role_service.py backend/app/api/roles.py backend/main.py backend/tests/test_roles_api.py backend/tests/test_role_service.py
git commit -m "feat(backend): add global role library"
```

---

## Task 2: Backend segmented project role and prosody fields

**Files:**
- Modify: `backend/app/models/segmented_project.py:24-41,96-128`
- Modify: `backend/app/schemas/segmented_project.py:8-28,64-78`
- Modify: `backend/app/services/segmented_project_service.py:127-183,230-312,519-591`
- Modify: `backend/app/core/database.py:24-80`
- Modify: `backend/tests/test_segmented_projects_api.py`
- Modify: `backend/tests/test_segmented_projects_service.py`
- Modify: `backend/tests/test_segmented_synthesis.py`

- [ ] **Step 1: Add failing segmented API round-trip test**

Append to `backend/tests/test_segmented_projects_api.py`:

```python

def test_project_round_trips_role_and_prosody_fields(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = _payload("p-role")
    payload["default_narrator_role_id"] = "role-narrator"
    payload["default_narrator_snapshot"] = {
        "id": "role-narrator",
        "name": "旁白",
        "default_engine": "edge_tts",
        "default_voice": "zh-CN-YunjianNeural",
        "default_engine_params": {"engine": "edge_tts", "edge_voice": "zh-CN-YunjianNeural"},
    }
    payload["chapters"][0]["segments"][0].update({
        "role_id": "role-linxia",
        "role_snapshot": {
            "id": "role-linxia",
            "name": "林夏",
            "default_engine": "edge_tts",
            "default_voice": "zh-CN-XiaoxiaoNeural",
            "default_engine_params": {"engine": "edge_tts", "edge_voice": "zh-CN-XiaoxiaoNeural"},
        },
        "segment_kind": "dialogue",
        "prosody_marks": [
            {
                "id": "mark-1",
                "start": 0,
                "end": 2,
                "emotion": "sad",
                "style_tags": ["low_voice", "slow"],
                "instruction": "压低声音",
                "intensity": 0.7,
            }
        ],
    })

    created = client.post("/api/segmented-projects", json=payload)
    assert created.status_code == 201, created.text

    fetched = client.get("/api/segmented-projects/p-role")
    assert fetched.status_code == 200
    body = fetched.json()
    assert body["default_narrator_role_id"] == "role-narrator"
    assert body["default_narrator_snapshot"]["name"] == "旁白"
    segment = body["chapters"][0]["segments"][0]
    assert segment["role_id"] == "role-linxia"
    assert segment["role_snapshot"]["name"] == "林夏"
    assert segment["segment_kind"] == "dialogue"
    assert segment["prosody_marks"][0]["style_tags"] == ["low_voice", "slow"]
```

- [ ] **Step 2: Add failing service round-trip test**

Append to `backend/tests/test_segmented_projects_service.py`:

```python

def test_save_project_persists_role_snapshot_and_prosody_marks(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)

    project = _seed_project("p-role")
    project.default_narrator_role_id = "role-narrator"
    project.default_narrator_snapshot = {
        "id": "role-narrator",
        "name": "旁白",
        "default_engine_params": {"engine": "edge_tts", "edge_voice": "zh-CN-YunjianNeural"},
    }
    project.chapters[0].segments[0].role_id = "role-linxia"
    project.chapters[0].segments[0].role_snapshot = {
        "id": "role-linxia",
        "name": "林夏",
        "default_engine_params": {"engine": "edge_tts", "edge_voice": "zh-CN-XiaoxiaoNeural"},
    }
    project.chapters[0].segments[0].segment_kind = "dialogue"
    project.chapters[0].segments[0].prosody_marks = [
        {"id": "mark-1", "start": 0, "end": 2, "style_tags": ["low_voice"]}
    ]

    save_project(db_session, project)
    db_session.commit()

    detail = get_project_detail(db_session, "p-role")
    assert detail is not None
    assert detail.default_narrator_role_id == "role-narrator"
    assert detail.default_narrator_snapshot["name"] == "旁白"
    segment = detail.chapters[0].segments[0]
    assert segment.role_id == "role-linxia"
    assert segment.role_snapshot["name"] == "林夏"
    assert segment.segment_kind == "dialogue"
    assert segment.prosody_marks[0]["id"] == "mark-1"
```

- [ ] **Step 3: Add failing synthesis metadata test**

Append to `backend/tests/test_segmented_synthesis.py`:

```python

def test_synthesize_segment_records_role_and_prosody_inputs(db_session, tmp_path, monkeypatch):
    from unittest.mock import patch

    from app.core import config
    from app.schemas.segmented_project import ProjectIn
    from app.services.segmented_project_service import get_project_detail, save_project, synthesize_segment

    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = ProjectIn(
        id="p-gen-role",
        name="Role Gen",
        schema_version=2,
        layout="vertical",
        chapters=[{
            "id": "c1",
            "position": 0,
            "name": "第一章",
            "engine": "edge_tts",
            "default_params": {"engine": "edge_tts", "edge_voice": "zh-CN-XiaoxiaoNeural"},
            "split_config": {"delimiters": ["。"], "mode": "rule"},
            "segments": [{
                "id": "s1",
                "position": 0,
                "text": "你好",
                "params": {"engine": "edge_tts"},
                "role_id": "role-linxia",
                "role_snapshot": {
                    "id": "role-linxia",
                    "name": "林夏",
                    "default_engine_params": {
                        "engine": "edge_tts",
                        "edge_voice": "zh-CN-XiaoxiaoNeural",
                    },
                },
                "segment_kind": "dialogue",
                "prosody_marks": [{"id": "mark-1", "start": 0, "end": 1, "style_tags": ["slow"]}],
            }],
        }],
    )
    save_project(db_session, payload)
    db_session.commit()

    wav_bytes = b"RIFF\x00\x00\x00\x00WAVEfmt "
    with patch("app.services.segmented_project_service.is_ffmpeg_available", return_value=False), patch(
        "app.services.segmented_project_service.synthesize_with_engine",
        return_value=(wav_bytes, "wav"),
    ):
        synthesize_segment(db_session, "p-gen-role", "c1", "s1")

    detail = get_project_detail(db_session, "p-gen-role")
    assert detail is not None
    generated = detail.chapters[0].segments[0].generated_params
    assert generated["role_id"] == "role-linxia"
    assert generated["role_snapshot"]["name"] == "林夏"
    assert generated["prosody_marks"][0]["id"] == "mark-1"
```

- [ ] **Step 4: Run tests to verify failure**

Run:

```bash
cd backend && uv run --extra test pytest tests/test_segmented_projects_api.py::test_project_round_trips_role_and_prosody_fields tests/test_segmented_projects_service.py::test_save_project_persists_role_snapshot_and_prosody_marks tests/test_segmented_synthesis.py::test_synthesize_segment_records_role_and_prosody_inputs -q
```

Expected: FAIL because schemas do not accept the new fields.

- [ ] **Step 5: Extend backend models**

Modify `backend/app/models/segmented_project.py`.

Add to `SegmentedProject` after `remotion_project_path`:

```python
    default_narrator_role_id = Column(
        String,
        ForeignKey("roles.id", ondelete="SET NULL"),
        nullable=True,
    )
    default_narrator_snapshot = Column(JSON, nullable=True)
```

Add to `SegmentedProjectSegment` after `emotion`:

```python
    role_id = Column(String, ForeignKey("roles.id", ondelete="SET NULL"), nullable=True)
    role_snapshot = Column(JSON, nullable=True)
    segment_kind = Column(String, nullable=False, default="narration")
    prosody_marks = Column(JSON, nullable=False, default=list)
```

- [ ] **Step 6: Extend Pydantic schemas**

Modify `backend/app/schemas/segmented_project.py`.

Add to `SegmentIn` after `emotion`:

```python
    role_id: str | None = None
    role_snapshot: dict[str, Any] | None = None
    segment_kind: str = "narration"
    prosody_marks: list[dict[str, Any]] = Field(default_factory=list)
```

Add to `ProjectIn` after `remotion_project_path`:

```python
    default_narrator_role_id: str | None = None
    default_narrator_snapshot: dict[str, Any] | None = None
```

- [ ] **Step 7: Serialize fields in project detail**

Modify `project_to_detail` in `backend/app/services/segmented_project_service.py`.

Inside `SegmentIn(...)`, after `emotion=s.emotion` add:

```python
                role_id=getattr(s, "role_id", None),
                role_snapshot=getattr(s, "role_snapshot", None),
                segment_kind=getattr(s, "segment_kind", None) or "narration",
                prosody_marks=getattr(s, "prosody_marks", None) or [],
```

Inside `ProjectDetail(...)`, after `remotion_project_path=getattr(p, "remotion_project_path", None),` add:

```python
        default_narrator_role_id=getattr(p, "default_narrator_role_id", None),
        default_narrator_snapshot=getattr(p, "default_narrator_snapshot", None),
```

- [ ] **Step 8: Save fields in project persistence**

Modify `save_project` in `backend/app/services/segmented_project_service.py`.

After `setattr(p, "remotion_project_path", project.remotion_project_path)` add:

```python
    setattr(p, "default_narrator_role_id", project.default_narrator_role_id)
    setattr(p, "default_narrator_snapshot", project.default_narrator_snapshot)
```

Inside the segment loop after `seg.emotion = s_in.emotion` add:

```python
            setattr(seg, "role_id", s_in.role_id)
            setattr(seg, "role_snapshot", s_in.role_snapshot)
            setattr(seg, "segment_kind", s_in.segment_kind or "narration")
            setattr(seg, "prosody_marks", s_in.prosody_marks or [])
```

- [ ] **Step 9: Include role and prosody in generated params**

Modify `synthesize_segment` in `backend/app/services/segmented_project_service.py`.

After `effective = _merge_params(chapter.default_params, seg.params, request_params)` insert:

```python
    role_snapshot = getattr(seg, "role_snapshot", None)
    if isinstance(role_snapshot, dict):
        effective = _merge_params(role_snapshot.get("default_engine_params"), effective)
    role_id = getattr(seg, "role_id", None)
    prosody_marks = getattr(seg, "prosody_marks", None) or []
    if role_id is not None:
        effective["role_id"] = role_id
    if role_snapshot is not None:
        effective["role_snapshot"] = role_snapshot
    effective["prosody_marks"] = prosody_marks
    effective["segment_kind"] = getattr(seg, "segment_kind", None) or "narration"
```

Keep the existing `engine = effective.get("engine", "edge_tts")` line after this inserted block.

- [ ] **Step 10: Add idempotent DB migrations**

Modify `backend/app/core/database.py` after `_P2_V3_ALTER_STMTS`:

```python
# P3: dialogue roles and local prosody marks.
_P3_ROLE_PROSODY_ALTER_STMTS = (
    "ALTER TABLE segmented_projects ADD COLUMN default_narrator_role_id VARCHAR",
    "ALTER TABLE segmented_projects ADD COLUMN default_narrator_snapshot JSON",
    "ALTER TABLE segmented_project_segments ADD COLUMN role_id VARCHAR",
    "ALTER TABLE segmented_project_segments ADD COLUMN role_snapshot JSON",
    "ALTER TABLE segmented_project_segments ADD COLUMN segment_kind VARCHAR DEFAULT 'narration'",
    "ALTER TABLE segmented_project_segments ADD COLUMN prosody_marks JSON",
)
```

Change the migration loop to:

```python
        for stmt in _P2_V2_ALTER_STMTS + _P2_V3_ALTER_STMTS + _P3_ROLE_PROSODY_ALTER_STMTS:
```

- [ ] **Step 11: Run focused backend tests**

Run:

```bash
cd backend && uv run --extra test pytest tests/test_segmented_projects_api.py tests/test_segmented_projects_service.py tests/test_segmented_synthesis.py -q
```

Expected: PASS.

- [ ] **Step 12: Run full backend test suite**

Run:

```bash
cd backend && uv run --extra test pytest -q
```

Expected: PASS or only documented external-service tests skipped.

- [ ] **Step 13: Commit segmented backend fields**

Run:

```bash
git add backend/app/models/segmented_project.py backend/app/schemas/segmented_project.py backend/app/services/segmented_project_service.py backend/app/core/database.py backend/tests/test_segmented_projects_api.py backend/tests/test_segmented_projects_service.py backend/tests/test_segmented_synthesis.py
git commit -m "feat(backend): persist segment roles and prosody marks"
```

---

## Task 3: Frontend shared types, migration, reducer, and API client

**Files:**
- Modify: `frontend/src/types/index.ts:215-345`
- Modify: `frontend/src/hooks/useSegmentedProject.ts:1-360`
- Modify: `frontend/src/hooks/__tests__/useSegmentedProject.test.ts`
- Modify: `frontend/src/services/api.ts:416-448`
- Create: `frontend/src/services/prosodyCapabilities.ts`
- Create: `frontend/src/services/segmentGenerationInputs.ts`
- Create: `frontend/src/services/segmentGenerationInputs.test.ts`

- [ ] **Step 1: Add failing reducer tests**

Append to `frontend/src/hooks/__tests__/useSegmentedProject.test.ts` inside `describe('segmentedReducer', () => { ... })` before the closing `});`:

```typescript
  it('SET_SEGMENT_ROLE stores role id and snapshot immutably', () => {
    const segment: Segment = {
      id: 's1', text: 'hello', params: { engine: 'edge_tts' }, status: 'idle', created_at: '', updated_at: '',
    };
    const project = makeProject({}, { segments: [segment] });
    const roleSnapshot = {
      id: 'role-linxia',
      name: '林夏',
      default_engine: 'edge_tts' as const,
      default_voice: 'zh-CN-XiaoxiaoNeural',
      default_engine_params: { engine: 'edge_tts' as const, edge_voice: 'zh-CN-XiaoxiaoNeural' },
      favorite_styles: [],
    };

    const next = segmentedReducer({ project }, {
      type: 'SET_SEGMENT_ROLE',
      id: 's1',
      roleId: 'role-linxia',
      roleSnapshot,
    });

    expect(ac(next.project).segments[0].role_id).toBe('role-linxia');
    expect(ac(next.project).segments[0].role_snapshot?.name).toBe('林夏');
    expect(project.chapters[0].segments[0].role_id).toBeUndefined();
  });

  it('UPDATE_PROSODY_MARKS replaces marks on one segment only', () => {
    const s1: Segment = { id: 's1', text: '你好世界', params: { engine: 'edge_tts' }, status: 'idle', created_at: '', updated_at: '' };
    const s2: Segment = { id: 's2', text: '第二句', params: { engine: 'edge_tts' }, status: 'idle', created_at: '', updated_at: '' };
    const project = makeProject({}, { segments: [s1, s2] });

    const next = segmentedReducer({ project }, {
      type: 'UPDATE_PROSODY_MARKS',
      id: 's1',
      prosodyMarks: [{ id: 'm1', start: 0, end: 2, style_tags: ['low_voice'] }],
    });

    expect(ac(next.project).segments[0].prosody_marks).toEqual([
      { id: 'm1', start: 0, end: 2, style_tags: ['low_voice'] },
    ]);
    expect(ac(next.project).segments[1].prosody_marks).toEqual([]);
  });

  it('SET_SEGMENT_KIND sets dialogue or narration without changing text', () => {
    const s1: Segment = { id: 's1', text: '旁白', params: { engine: 'edge_tts' }, status: 'idle', created_at: '', updated_at: '' };
    const next = segmentedReducer({ project: makeProject({}, { segments: [s1] }) }, {
      type: 'SET_SEGMENT_KIND', id: 's1', segmentKind: 'narration',
    });
    expect(ac(next.project).segments[0].segment_kind).toBe('narration');
    expect(ac(next.project).segments[0].text).toBe('旁白');
  });

  it('SET_PROJECT_NARRATOR stores narrator role and snapshot', () => {
    const roleSnapshot = {
      id: 'role-narrator',
      name: '旁白',
      default_engine: 'edge_tts' as const,
      default_voice: 'zh-CN-YunjianNeural',
      default_engine_params: { engine: 'edge_tts' as const, edge_voice: 'zh-CN-YunjianNeural' },
      favorite_styles: [],
    };
    const next = segmentedReducer({ project: makeProject() }, {
      type: 'SET_PROJECT_NARRATOR',
      roleId: 'role-narrator',
      roleSnapshot,
    });
    expect(next.project.default_narrator_role_id).toBe('role-narrator');
    expect(next.project.default_narrator_snapshot?.name).toBe('旁白');
  });
```

- [ ] **Step 2: Add failing generation-input tests**

Create `frontend/src/services/segmentGenerationInputs.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { Segment, SegmentEngineParams, RoleSnapshot } from '../types';
import { buildSegmentGenerationInputs, isSegmentAudioStale } from './segmentGenerationInputs';

const defaultParams: SegmentEngineParams = { engine: 'edge_tts', edge_voice: 'zh-CN-XiaoxiaoNeural' };

function makeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 's1',
    text: '你好',
    params: { engine: 'edge_tts' },
    status: 'ready',
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

const roleSnapshot: RoleSnapshot = {
  id: 'role-linxia',
  name: '林夏',
  default_engine: 'edge_tts',
  default_voice: 'zh-CN-XiaoxiaoNeural',
  default_engine_params: { engine: 'edge_tts', edge_voice: 'zh-CN-XiaoxiaoNeural' },
  favorite_styles: [],
};

describe('segmentGenerationInputs', () => {
  it('builds effective inputs from role snapshot before segment params', () => {
    const inputs = buildSegmentGenerationInputs(makeSegment({ role_id: 'role-linxia', role_snapshot: roleSnapshot }), defaultParams);
    expect(inputs.engine).toBe('edge_tts');
    expect(inputs.edge_voice).toBe('zh-CN-XiaoxiaoNeural');
    expect(inputs.role_id).toBe('role-linxia');
    expect(inputs.role_snapshot?.name).toBe('林夏');
  });

  it('marks audio stale when prosody marks changed', () => {
    const segment = makeSegment({
      prosody_marks: [{ id: 'm1', start: 0, end: 1, style_tags: ['slow'] }],
      generated_params: {
        engine: 'edge_tts',
        edge_voice: 'zh-CN-XiaoxiaoNeural',
        prosody_marks: [],
      },
    });
    expect(isSegmentAudioStale(segment, defaultParams)).toBe(true);
  });

  it('keeps audio fresh when effective inputs match generated params', () => {
    const marks = [{ id: 'm1', start: 0, end: 1, style_tags: ['slow'] }];
    const segment = makeSegment({
      role_id: 'role-linxia',
      role_snapshot: roleSnapshot,
      prosody_marks: marks,
      generated_params: {
        engine: 'edge_tts',
        edge_voice: 'zh-CN-XiaoxiaoNeural',
        role_id: 'role-linxia',
        role_snapshot: roleSnapshot,
        prosody_marks: marks,
        segment_kind: 'narration',
      },
    });
    expect(isSegmentAudioStale(segment, defaultParams)).toBe(false);
  });
});
```

- [ ] **Step 3: Run frontend tests to verify failure**

Run:

```bash
cd frontend && npm test -- --run src/hooks/__tests__/useSegmentedProject.test.ts src/services/segmentGenerationInputs.test.ts
```

If the project has no `test` script, run:

```bash
cd frontend && npx vitest run src/hooks/__tests__/useSegmentedProject.test.ts src/services/segmentGenerationInputs.test.ts
```

Expected: FAIL because types/actions/helpers do not exist.

- [ ] **Step 4: Add shared frontend types**

Modify `frontend/src/types/index.ts` after `EmotionType`:

```typescript
export type SegmentKind = 'dialogue' | 'narration';

export interface FavoriteStyle {
  id: string;
  name: string;
  emotion?: EmotionType;
  style_tags: string[];
  instruction?: string;
  intensity?: number;
}

export interface RoleSnapshot {
  id: string;
  name: string;
  avatar?: string | null;
  description?: string | null;
  default_engine: SegmentEngineParams['engine'];
  default_voice?: string | null;
  default_engine_params: SegmentEngineParams;
  favorite_styles: FavoriteStyle[];
}

export interface Role extends RoleSnapshot {
  created_at: string;
  updated_at: string;
}

export interface RoleUpdate {
  name?: string | null;
  avatar?: string | null;
  description?: string | null;
  default_engine?: SegmentEngineParams['engine'];
  default_voice?: string | null;
  default_engine_params?: Partial<SegmentEngineParams>;
  favorite_styles?: FavoriteStyle[];
}

export interface ProsodyMark {
  id: string;
  start: number;
  end: number;
  emotion?: EmotionType;
  style_tags: string[];
  instruction?: string;
  intensity?: number;
}

export interface ProsodyCapability {
  supportsEmotion: boolean;
  supportsStyleTags: boolean;
  supportsInstruction: boolean;
  supportsSsml: boolean;
  requiresSplitFallback: boolean;
}
```

Add these fields to `Segment` after `emotion?: EmotionType;`:

```typescript
  role_id?: string | null;
  role_snapshot?: RoleSnapshot | null;
  segment_kind?: SegmentKind;
  prosody_marks?: ProsodyMark[];
```

Add these fields to `SegmentedProject` after `remotion_project_path?: string | null;`:

```typescript
  default_narrator_role_id?: string | null;
  default_narrator_snapshot?: RoleSnapshot | null;
```

- [ ] **Step 5: Add prosody capabilities service**

Create `frontend/src/services/prosodyCapabilities.ts`:

```typescript
import type { ProsodyCapability, SegmentEngineParams } from '../types';

const CAPABILITIES: Record<SegmentEngineParams['engine'], ProsodyCapability> = {
  edge_tts: {
    supportsEmotion: false,
    supportsStyleTags: true,
    supportsInstruction: false,
    supportsSsml: false,
    requiresSplitFallback: true,
  },
  cosyvoice: {
    supportsEmotion: true,
    supportsStyleTags: true,
    supportsInstruction: true,
    supportsSsml: true,
    requiresSplitFallback: false,
  },
  mimo_tts: {
    supportsEmotion: true,
    supportsStyleTags: true,
    supportsInstruction: true,
    supportsSsml: false,
    requiresSplitFallback: false,
  },
  voxcpm: {
    supportsEmotion: true,
    supportsStyleTags: true,
    supportsInstruction: true,
    supportsSsml: false,
    requiresSplitFallback: false,
  },
};

export function getProsodyCapability(engine: SegmentEngineParams['engine']): ProsodyCapability {
  return CAPABILITIES[engine];
}
```

- [ ] **Step 6: Add generation input helper**

Create `frontend/src/services/segmentGenerationInputs.ts`:

```typescript
import type { Segment, SegmentEngineParams } from '../types';

export interface SegmentGenerationInputs extends Record<string, unknown> {
  engine: SegmentEngineParams['engine'];
  role_id?: string | null;
  role_snapshot?: Segment['role_snapshot'];
  prosody_marks: NonNullable<Segment['prosody_marks']>;
  segment_kind: NonNullable<Segment['segment_kind']>;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function buildSegmentGenerationInputs(
  segment: Segment,
  defaultParams: SegmentEngineParams,
): SegmentGenerationInputs {
  const roleParams = segment.role_snapshot?.default_engine_params ?? {};
  const merged = {
    ...defaultParams,
    ...roleParams,
    ...segment.params,
  } as SegmentEngineParams;
  return {
    ...merged,
    role_id: segment.role_id ?? null,
    role_snapshot: segment.role_snapshot ?? null,
    prosody_marks: segment.prosody_marks ?? [],
    segment_kind: segment.segment_kind ?? 'narration',
  };
}

export function isSegmentAudioStale(segment: Segment, defaultParams: SegmentEngineParams): boolean {
  if (segment.status !== 'ready' || !segment.generated_params) {
    return false;
  }
  const current = buildSegmentGenerationInputs(segment, defaultParams);
  const generated = {
    ...segment.generated_params,
    prosody_marks: (segment.generated_params.prosody_marks as unknown[] | undefined) ?? [],
    segment_kind: (segment.generated_params.segment_kind as string | undefined) ?? 'narration',
  };
  return stableStringify(current) !== stableStringify(generated);
}
```

- [ ] **Step 7: Update reducer migration and actions immutably**

Modify `frontend/src/hooks/useSegmentedProject.ts` imports:

```typescript
import type { SegmentedProject, Chapter, Segment, SegmentEngineParams, ProsodyMark, RoleSnapshot, SegmentKind } from '../types';
```

In `enrichSegment`, add defaults before `created_at`:

```typescript
    role_id: raw.role_id ?? null,
    role_snapshot: raw.role_snapshot ?? null,
    segment_kind: raw.segment_kind ?? 'narration',
    prosody_marks: raw.prosody_marks ?? [],
```

In `migrateV1` v2 return, change the return to include narrator defaults:

```typescript
    return {
      ...raw,
      default_narrator_role_id: raw.default_narrator_role_id ?? null,
      default_narrator_snapshot: raw.default_narrator_snapshot ?? null,
      chapters,
    } as SegmentedProject;
```

In the v1 migration return object, add:

```typescript
    default_narrator_role_id: raw.default_narrator_role_id ?? null,
    default_narrator_snapshot: raw.default_narrator_snapshot ?? null,
```

Update `makeSegment`:

```typescript
function makeSegment(text: string, params: SegmentEngineParams, segmentKind: SegmentKind = 'narration'): Segment {
  const now = new Date().toISOString();
  return {
    id: uid(),
    text,
    params: { ...params },
    status: 'idle',
    segment_kind: segmentKind,
    prosody_marks: [],
    created_at: now,
    updated_at: now,
  };
}
```

Add action variants after `UPDATE_EMOTION`:

```typescript
  | { type: 'SET_PROJECT_NARRATOR'; roleId: string | null; roleSnapshot: RoleSnapshot | null }
  | { type: 'SET_SEGMENT_ROLE'; id: string; roleId: string | null; roleSnapshot: RoleSnapshot | null }
  | { type: 'SET_SEGMENT_KIND'; id: string; segmentKind: SegmentKind }
  | { type: 'UPDATE_PROSODY_MARKS'; id: string; prosodyMarks: ProsodyMark[] }
```

Add a helper before the reducer:

```typescript
function updateSegment(
  p: SegmentedProject,
  segmentId: string,
  updater: (segment: Segment) => Segment,
): SegmentedProject {
  return updateActive(p, ch => ({
    ...ch,
    segments: ch.segments.map(segment => segment.id === segmentId ? updater(segment) : segment),
    updated_at: new Date().toISOString(),
  }));
}
```

Add reducer cases after `UPDATE_EMOTION`:

```typescript
    case 'SET_PROJECT_NARRATOR':
      return {
        project: {
          ...p,
          default_narrator_role_id: action.roleId,
          default_narrator_snapshot: action.roleSnapshot,
          updated_at: new Date().toISOString(),
        },
      };
    case 'SET_SEGMENT_ROLE':
      return {
        project: updateSegment(p, action.id, seg => ({
          ...seg,
          role_id: action.roleId,
          role_snapshot: action.roleSnapshot,
          updated_at: new Date().toISOString(),
        })),
      };
    case 'SET_SEGMENT_KIND':
      return {
        project: updateSegment(p, action.id, seg => ({
          ...seg,
          segment_kind: action.segmentKind,
          updated_at: new Date().toISOString(),
        })),
      };
    case 'UPDATE_PROSODY_MARKS':
      return {
        project: updateSegment(p, action.id, seg => ({
          ...seg,
          prosody_marks: action.prosodyMarks.map(mark => ({ ...mark, style_tags: [...mark.style_tags] })),
          updated_at: new Date().toISOString(),
        })),
      };
```

- [ ] **Step 8: Add role API client**

Modify `frontend/src/services/api.ts` imports at the top if needed, or use inline type imports like existing code.

Add after `segmentedProjectApi`:

```typescript
export const roleApi = {
  listRoles: async (): Promise<import('../types').Role[]> => {
    const { data } = await api.get<import('../types').Role[]>('/roles');
    return data;
  },
  createRole: async (role: import('../types').RoleSnapshot): Promise<import('../types').Role> => {
    const { data } = await api.post<import('../types').Role>('/roles', role);
    return data;
  },
  updateRole: async (id: string, update: import('../types').RoleUpdate): Promise<import('../types').Role> => {
    const { data } = await api.put<import('../types').Role>(`/roles/${id}`, update);
    return data;
  },
  deleteRole: async (id: string): Promise<void> => {
    await api.delete(`/roles/${id}`);
  },
};
```

- [ ] **Step 9: Run focused frontend tests**

Run:

```bash
cd frontend && npx vitest run src/hooks/__tests__/useSegmentedProject.test.ts src/services/segmentGenerationInputs.test.ts
```

Expected: PASS.

- [ ] **Step 10: Run frontend build**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 11: Commit frontend shared model work**

Run:

```bash
git add frontend/src/types/index.ts frontend/src/hooks/useSegmentedProject.ts frontend/src/hooks/__tests__/useSegmentedProject.test.ts frontend/src/services/api.ts frontend/src/services/prosodyCapabilities.ts frontend/src/services/segmentGenerationInputs.ts frontend/src/services/segmentGenerationInputs.test.ts
git commit -m "feat(frontend): add role and prosody data model"
```

---

## Task 4: Role library panel, picker, and sync prompt

**Files:**
- Create: `frontend/src/components/SegmentedTTS/RoleLibraryPanel.tsx`
- Create: `frontend/src/components/SegmentedTTS/RoleLibraryPanel.module.css`
- Create: `frontend/src/components/SegmentedTTS/RolePicker.tsx`
- Create: `frontend/src/components/SegmentedTTS/RolePicker.module.css`
- Create: `frontend/src/components/SegmentedTTS/RoleSyncPrompt.tsx`
- Create: `frontend/src/components/SegmentedTTS/RoleSyncPrompt.module.css`
- Modify: `frontend/src/pages/TTSSynthesis.tsx`

- [ ] **Step 1: Create role picker component**

Create `frontend/src/components/SegmentedTTS/RolePicker.tsx`:

```tsx
import type { Role, RoleSnapshot } from '../../types';
import styles from './RolePicker.module.css';

interface RolePickerProps {
  roles: Role[];
  value?: string | null;
  label?: string;
  onChange: (roleId: string | null, snapshot: RoleSnapshot | null) => void;
  onManage: () => void;
}

function toSnapshot(role: Role): RoleSnapshot {
  return {
    id: role.id,
    name: role.name,
    avatar: role.avatar,
    description: role.description,
    default_engine: role.default_engine,
    default_voice: role.default_voice,
    default_engine_params: role.default_engine_params,
    favorite_styles: role.favorite_styles,
  };
}

export function RolePicker({ roles, value, label = '角色', onChange, onManage }: RolePickerProps) {
  return (
    <label className={styles.root}>
      <span className={styles.label}>{label}</span>
      <div className={styles.controls}>
        <select
          className={styles.select}
          value={value ?? ''}
          onChange={(event) => {
            const role = roles.find(item => item.id === event.target.value);
            onChange(role?.id ?? null, role ? toSnapshot(role) : null);
          }}
        >
          <option value="">未选择</option>
          {roles.map(role => (
            <option key={role.id} value={role.id}>{role.name}</option>
          ))}
        </select>
        <button type="button" className={styles.manageButton} onClick={onManage}>管理</button>
      </div>
    </label>
  );
}
```

Create `frontend/src/components/SegmentedTTS/RolePicker.module.css`:

```css
.root {
  display: grid;
  gap: 6px;
}

.label {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.controls {
  display: flex;
  gap: 8px;
}

.select {
  flex: 1;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 8px 10px;
  background: var(--surface-color);
  color: var(--text-primary);
}

.manageButton {
  border: 1px solid rgba(196, 122, 58, 0.35);
  border-radius: 10px;
  padding: 8px 12px;
  background: rgba(196, 122, 58, 0.08);
  color: #9a5a21;
  cursor: pointer;
}
```

- [ ] **Step 2: Create role sync prompt component**

Create `frontend/src/components/SegmentedTTS/RoleSyncPrompt.tsx`:

```tsx
import type { Role, RoleSnapshot } from '../../types';
import styles from './RoleSyncPrompt.module.css';

interface RoleSyncPromptProps {
  role: Role | undefined;
  snapshot: RoleSnapshot | null | undefined;
  onSyncSegment: () => void;
  onSyncChapter: () => void;
  onSyncProject: () => void;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function isRoleSnapshotOutdated(role: Role | undefined, snapshot: RoleSnapshot | null | undefined): boolean {
  if (!role || !snapshot) return false;
  const current = {
    name: role.name,
    avatar: role.avatar,
    description: role.description,
    default_engine: role.default_engine,
    default_voice: role.default_voice,
    default_engine_params: role.default_engine_params,
    favorite_styles: role.favorite_styles,
  };
  const saved = {
    name: snapshot.name,
    avatar: snapshot.avatar,
    description: snapshot.description,
    default_engine: snapshot.default_engine,
    default_voice: snapshot.default_voice,
    default_engine_params: snapshot.default_engine_params,
    favorite_styles: snapshot.favorite_styles,
  };
  return stableStringify(current) !== stableStringify(saved);
}

export function RoleSyncPrompt({ role, snapshot, onSyncSegment, onSyncChapter, onSyncProject }: RoleSyncPromptProps) {
  if (!role && snapshot) {
    return <div className={styles.deleted}>全局角色已删除，当前使用项目快照。</div>;
  }
  if (!isRoleSnapshotOutdated(role, snapshot)) return null;
  return (
    <div className={styles.root}>
      <span>全局角色“{role?.name}”有更新。</span>
      <button type="button" onClick={onSyncSegment}>同步当前段</button>
      <button type="button" onClick={onSyncChapter}>同步本章</button>
      <button type="button" onClick={onSyncProject}>同步全项目</button>
    </div>
  );
}
```

Create `frontend/src/components/SegmentedTTS/RoleSyncPrompt.module.css`:

```css
.root,
.deleted {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid rgba(196, 122, 58, 0.28);
  border-radius: 12px;
  padding: 8px 10px;
  background: rgba(196, 122, 58, 0.08);
  color: #7a4a1f;
  font-size: 12px;
}

.root button {
  border: 0;
  border-radius: 999px;
  padding: 4px 8px;
  background: #c47a3a;
  color: white;
  cursor: pointer;
}
```

- [ ] **Step 3: Create role library panel**

Create `frontend/src/components/SegmentedTTS/RoleLibraryPanel.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { Role, RoleSnapshot, SegmentEngineParams } from '../../types';
import { roleApi } from '../../services/api';
import styles from './RoleLibraryPanel.module.css';

interface RoleLibraryPanelProps {
  open: boolean;
  onClose: () => void;
  onRolesChanged: (roles: Role[]) => void;
}

function createEmptyRole(): RoleSnapshot {
  return {
    id: `role-${Date.now()}`,
    name: '新角色',
    avatar: '',
    description: '',
    default_engine: 'edge_tts',
    default_voice: '',
    default_engine_params: { engine: 'edge_tts' },
    favorite_styles: [],
  };
}

export function RoleLibraryPanel({ open, onClose, onRolesChanged }: RoleLibraryPanelProps) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [draft, setDraft] = useState<RoleSnapshot>(createEmptyRole);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    roleApi.listRoles()
      .then(items => {
        setRoles(items);
        onRolesChanged(items);
      })
      .catch(() => setError('角色库加载失败'));
  }, [open, onRolesChanged]);

  if (!open) return null;

  const saveDraft = async () => {
    if (!draft.name.trim()) {
      setError('角色名不能为空');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const existing = roles.find(role => role.id === draft.id);
      const saved = existing
        ? await roleApi.updateRole(draft.id, draft)
        : await roleApi.createRole(draft);
      const next = existing
        ? roles.map(role => role.id === saved.id ? saved : role)
        : [saved, ...roles];
      setRoles(next);
      onRolesChanged(next);
      setDraft(createEmptyRole());
    } catch {
      setError('角色保存失败');
    } finally {
      setSaving(false);
    }
  };

  const deleteRole = async (roleId: string) => {
    setError(null);
    try {
      await roleApi.deleteRole(roleId);
      const next = roles.filter(role => role.id !== roleId);
      setRoles(next);
      onRolesChanged(next);
    } catch {
      setError('角色删除失败');
    }
  };

  const setEngineParams = (params: Partial<SegmentEngineParams>) => {
    setDraft(prev => ({
      ...prev,
      default_engine_params: { ...prev.default_engine_params, ...params },
    }));
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="角色库">
      <div className={styles.panel}>
        <header className={styles.header}>
          <h2>全局角色库</h2>
          <button type="button" onClick={onClose}>关闭</button>
        </header>

        {error && <div className={styles.error}>{error}</div>}

        <section className={styles.editor}>
          <label>角色名<input value={draft.name} onChange={event => setDraft(prev => ({ ...prev, name: event.target.value }))} /></label>
          <label>头像<input value={draft.avatar ?? ''} onChange={event => setDraft(prev => ({ ...prev, avatar: event.target.value }))} /></label>
          <label>描述<input value={draft.description ?? ''} onChange={event => setDraft(prev => ({ ...prev, description: event.target.value }))} /></label>
          <label>引擎
            <select value={draft.default_engine} onChange={event => {
              const engine = event.target.value as SegmentEngineParams['engine'];
              setDraft(prev => ({ ...prev, default_engine: engine, default_engine_params: { ...prev.default_engine_params, engine } }));
            }}>
              <option value="edge_tts">Edge-TTS</option>
              <option value="cosyvoice">CosyVoice</option>
              <option value="mimo_tts">MiMo</option>
              <option value="voxcpm">VoxCPM</option>
            </select>
          </label>
          <label>默认音色<input value={draft.default_voice ?? ''} onChange={event => setDraft(prev => ({ ...prev, default_voice: event.target.value }))} /></label>
          <label>Edge voice<input value={draft.default_engine_params.edge_voice ?? ''} onChange={event => setEngineParams({ edge_voice: event.target.value })} /></label>
          <button type="button" disabled={saving} onClick={saveDraft}>{saving ? '保存中...' : '保存角色'}</button>
        </section>

        <section className={styles.list}>
          {roles.map(role => (
            <article key={role.id} className={styles.roleCard}>
              <div>
                <strong>{role.name}</strong>
                <p>{role.default_engine} · {role.default_voice || '未设置音色'}</p>
              </div>
              <div className={styles.actions}>
                <button type="button" onClick={() => setDraft(role)}>编辑</button>
                <button type="button" onClick={() => void deleteRole(role.id)}>删除</button>
              </div>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
```

Create `frontend/src/components/SegmentedTTS/RoleLibraryPanel.module.css`:

```css
.overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  justify-content: flex-end;
  background: rgba(30, 20, 12, 0.32);
}

.panel {
  width: min(520px, 100vw);
  height: 100%;
  overflow: auto;
  background: var(--surface-color);
  box-shadow: -16px 0 36px rgba(0, 0, 0, 0.16);
  padding: 20px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.header h2 {
  margin: 0;
  color: var(--text-primary);
}

.header button,
.editor button,
.actions button {
  border: 1px solid rgba(196, 122, 58, 0.35);
  border-radius: 10px;
  padding: 8px 12px;
  background: rgba(196, 122, 58, 0.08);
  color: #8a4f1f;
  cursor: pointer;
}

.error {
  margin: 12px 0;
  border-radius: 10px;
  padding: 10px;
  background: #fff0f0;
  color: #a33;
}

.editor {
  display: grid;
  gap: 10px;
  margin: 16px 0;
}

.editor label {
  display: grid;
  gap: 5px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.editor input,
.editor select {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 8px 10px;
  background: var(--surface-color);
  color: var(--text-primary);
}

.list {
  display: grid;
  gap: 10px;
}

.roleCard {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 12px;
}

.roleCard p {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.actions {
  display: flex;
  gap: 8px;
}
```

- [ ] **Step 4: Wire panel state into `TTSSynthesis.tsx`**

Add imports:

```typescript
import { RoleLibraryPanel } from '../components/SegmentedTTS/RoleLibraryPanel';
import type { Role } from '../types';
```

If `Role` conflicts with existing type import, merge it into the existing type import:

```typescript
import type { TTSRequest, TTSResult, VoiceProfile, SegmentedProject, Chapter, SegmentEngineParams, Role } from '../types';
```

Add state near other UI state:

```typescript
  const [roles, setRoles] = useState<Role[]>([]);
  const [roleLibraryOpen, setRoleLibraryOpen] = useState(false);
```

Render before the closing root element of the page:

```tsx
      <RoleLibraryPanel
        open={roleLibraryOpen}
        onClose={() => setRoleLibraryOpen(false)}
        onRolesChanged={setRoles}
      />
```

Add a temporary toolbar button near the existing editor controls:

```tsx
<button type="button" className={styles.secondaryBtn} onClick={() => setRoleLibraryOpen(true)}>
  角色库
</button>
```

If `styles.secondaryBtn` does not exist, use an existing nearby button class from `TTSSynthesis.module.css` rather than adding a page-level style.

- [ ] **Step 5: Run frontend build**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit role UI components**

Run:

```bash
git add frontend/src/components/SegmentedTTS/RoleLibraryPanel.tsx frontend/src/components/SegmentedTTS/RoleLibraryPanel.module.css frontend/src/components/SegmentedTTS/RolePicker.tsx frontend/src/components/SegmentedTTS/RolePicker.module.css frontend/src/components/SegmentedTTS/RoleSyncPrompt.tsx frontend/src/components/SegmentedTTS/RoleSyncPrompt.module.css frontend/src/pages/TTSSynthesis.tsx
git commit -m "feat(frontend): add role library UI"
```

---

## Task 5: Dialogue view and narration blocks

**Files:**
- Create: `frontend/src/components/SegmentedTTS/ChatSegmentView.tsx`
- Create: `frontend/src/components/SegmentedTTS/ChatSegmentView.module.css`
- Create: `frontend/src/components/SegmentedTTS/ChatBubble.tsx`
- Create: `frontend/src/components/SegmentedTTS/ChatBubble.module.css`
- Create: `frontend/src/components/SegmentedTTS/NarrationBlock.tsx`
- Create: `frontend/src/components/SegmentedTTS/NarrationBlock.module.css`
- Modify: `frontend/src/pages/TTSSynthesis.tsx`

- [ ] **Step 1: Create chat bubble component**

Create `frontend/src/components/SegmentedTTS/ChatBubble.tsx`:

```tsx
import type { EmotionType, Role, Segment } from '../../types';
import { VoiceAvatar } from '../ui/VoiceAvatar';
import styles from './ChatBubble.module.css';

interface ChatBubbleProps {
  segment: Segment;
  index: number;
  role?: Role;
  isSelected: boolean;
  isPlaying: boolean;
  onSelect: (id: string) => void;
  onRegenerate: (id: string) => void;
  onPlay: (id: string) => void;
}

const EMOTION_LABELS: Record<EmotionType, string> = {
  happy: '欣喜', sad: '沉重', angry: '愤怒', calm: '沉稳', neutral: '中性', excited: '激昂',
};

function emotionClass(emotion?: EmotionType): string {
  const value = emotion ?? 'neutral';
  return styles[`emo${value.charAt(0).toUpperCase()}${value.slice(1)}`] || styles.emoNeutral;
}

function voiceLabel(segment: Segment): string {
  const snapshot = segment.role_snapshot;
  if (snapshot?.default_voice) return snapshot.default_voice;
  if (segment.params.edge_voice) return segment.params.edge_voice;
  if (segment.params.voice_id) return segment.params.voice_id;
  if (segment.params.mimo_preset_voice) return segment.params.mimo_preset_voice;
  return '未选择音色';
}

export function ChatBubble({ segment, index, role, isSelected, isPlaying, onSelect, onRegenerate, onPlay }: ChatBubbleProps) {
  const roleName = role?.name ?? segment.role_snapshot?.name ?? '未命名角色';
  const emotion = (segment.emotion ?? 'neutral') as EmotionType;
  return (
    <article
      className={`${styles.root} ${emotionClass(emotion)} ${isSelected ? styles.selected : ''}`}
      onClick={() => onSelect(segment.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => { if (event.key === 'Enter') onSelect(segment.id); }}
    >
      <VoiceAvatar name={roleName} size={36} gender="female" />
      <div className={styles.body}>
        <header className={styles.meta}>
          <span>#{String(index).padStart(2, '0')} · {roleName}</span>
          <span>{segment.params.engine} · {voiceLabel(segment)}</span>
        </header>
        <p className={styles.text}>{segment.text || '空台词'}</p>
        <footer className={styles.footer}>
          <span>{EMOTION_LABELS[emotion]}</span>
          <span>{segment.prosody_marks?.length ?? 0} 个局部语气</span>
          <button type="button" onClick={(event) => { event.stopPropagation(); onPlay(segment.id); }}>{isPlaying ? '播放中' : '播放'}</button>
          <button type="button" onClick={(event) => { event.stopPropagation(); onRegenerate(segment.id); }}>生成</button>
        </footer>
      </div>
    </article>
  );
}
```

Create `frontend/src/components/SegmentedTTS/ChatBubble.module.css`:

```css
.root {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  max-width: 760px;
  cursor: pointer;
}

.body {
  min-width: 0;
  border: 1px solid rgba(196, 122, 58, 0.18);
  border-radius: 18px 18px 18px 6px;
  padding: 12px 14px;
  box-shadow: 0 2px 8px rgba(80, 45, 12, 0.08);
}

.selected .body {
  border-color: #c47a3a;
  box-shadow: 0 0 0 3px rgba(196, 122, 58, 0.16);
}

.meta,
.footer {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  color: var(--text-secondary);
  font-size: 12px;
}

.text {
  margin: 8px 0;
  color: var(--text-primary);
  line-height: 1.7;
  white-space: pre-wrap;
}

.footer button {
  border: 0;
  border-radius: 999px;
  padding: 4px 9px;
  background: rgba(196, 122, 58, 0.12);
  color: #8a4f1f;
  cursor: pointer;
}

.emoHappy .body { background: rgba(255, 232, 166, 0.52); }
.emoSad .body { background: rgba(202, 218, 240, 0.52); }
.emoAngry .body { background: rgba(244, 190, 176, 0.52); }
.emoCalm .body { background: rgba(196, 225, 207, 0.52); }
.emoNeutral .body { background: rgba(255, 255, 255, 0.86); }
.emoExcited .body { background: rgba(255, 216, 172, 0.58); }
```

- [ ] **Step 2: Create narration block component**

Create `frontend/src/components/SegmentedTTS/NarrationBlock.tsx`:

```tsx
import type { EmotionType, Segment } from '../../types';
import styles from './NarrationBlock.module.css';

interface NarrationBlockProps {
  segment: Segment;
  index: number;
  isSelected: boolean;
  hasNarratorVoice: boolean;
  onSelect: (id: string) => void;
}

function emotionClass(emotion?: EmotionType): string {
  const value = emotion ?? 'neutral';
  return styles[`emo${value.charAt(0).toUpperCase()}${value.slice(1)}`] || styles.emoNeutral;
}

export function NarrationBlock({ segment, index, isSelected, hasNarratorVoice, onSelect }: NarrationBlockProps) {
  return (
    <article
      className={`${styles.root} ${emotionClass(segment.emotion)} ${isSelected ? styles.selected : ''}`}
      onClick={() => onSelect(segment.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => { if (event.key === 'Enter') onSelect(segment.id); }}
    >
      <div className={styles.label}>旁白 #{String(index).padStart(2, '0')}</div>
      {!hasNarratorVoice && <div className={styles.warning}>需要设置旁白音色</div>}
      <p>{segment.text || '空旁白'}</p>
    </article>
  );
}
```

Create `frontend/src/components/SegmentedTTS/NarrationBlock.module.css`:

```css
.root {
  max-width: 720px;
  margin: 0 auto;
  border: 1px dashed rgba(196, 122, 58, 0.35);
  border-radius: 16px;
  padding: 12px 16px;
  text-align: center;
  cursor: pointer;
}

.selected {
  border-style: solid;
  border-color: #c47a3a;
  box-shadow: 0 0 0 3px rgba(196, 122, 58, 0.14);
}

.label {
  color: #8a4f1f;
  font-size: 12px;
  font-weight: 700;
}

.warning {
  display: inline-flex;
  margin-top: 6px;
  border-radius: 999px;
  padding: 3px 8px;
  background: #fff0e8;
  color: #a33;
  font-size: 12px;
}

.root p {
  margin: 8px 0 0;
  color: var(--text-primary);
  line-height: 1.7;
  white-space: pre-wrap;
}

.emoHappy { background: rgba(255, 232, 166, 0.35); }
.emoSad { background: rgba(202, 218, 240, 0.35); }
.emoAngry { background: rgba(244, 190, 176, 0.35); }
.emoCalm { background: rgba(196, 225, 207, 0.35); }
.emoNeutral { background: rgba(255, 255, 255, 0.68); }
.emoExcited { background: rgba(255, 216, 172, 0.42); }
```

- [ ] **Step 3: Create chat segment view**

Create `frontend/src/components/SegmentedTTS/ChatSegmentView.tsx`:

```tsx
import type { Role, Segment, SegmentKind } from '../../types';
import { ChatBubble } from './ChatBubble';
import { NarrationBlock } from './NarrationBlock';
import styles from './ChatSegmentView.module.css';

interface ChatSegmentViewProps {
  segments: Segment[];
  roles: Role[];
  selectedId?: string;
  playingId?: string;
  hasNarratorVoice: boolean;
  onSelect: (id: string) => void;
  onAppend: (kind: SegmentKind) => void;
  onRegenerate: (id: string) => void;
  onPlay: (id: string) => void;
}

export function ChatSegmentView({
  segments,
  roles,
  selectedId,
  playingId,
  hasNarratorVoice,
  onSelect,
  onAppend,
  onRegenerate,
  onPlay,
}: ChatSegmentViewProps) {
  return (
    <div className={styles.root}>
      {!hasNarratorVoice && (
        <div className={styles.narratorWarning}>多角色项目需要设置旁白音色。请在角色库中创建旁白角色并设为项目旁白。</div>
      )}
      <div className={styles.flow}>
        {segments.map((segment, index) => {
          const kind = segment.segment_kind ?? 'narration';
          if (kind === 'narration') {
            return (
              <NarrationBlock
                key={segment.id}
                segment={segment}
                index={index + 1}
                isSelected={segment.id === selectedId}
                hasNarratorVoice={hasNarratorVoice}
                onSelect={onSelect}
              />
            );
          }
          return (
            <ChatBubble
              key={segment.id}
              segment={segment}
              index={index + 1}
              role={roles.find(role => role.id === segment.role_id)}
              isSelected={segment.id === selectedId}
              isPlaying={segment.id === playingId}
              onSelect={onSelect}
              onRegenerate={onRegenerate}
              onPlay={onPlay}
            />
          );
        })}
      </div>
      <div className={styles.actions}>
        <button type="button" onClick={() => onAppend('dialogue')}>+ 新增台词</button>
        <button type="button" onClick={() => onAppend('narration')}>+ 新增旁白</button>
      </div>
    </div>
  );
}
```

Create `frontend/src/components/SegmentedTTS/ChatSegmentView.module.css`:

```css
.root {
  display: grid;
  gap: 14px;
}

.narratorWarning {
  border: 1px solid rgba(196, 122, 58, 0.32);
  border-radius: 12px;
  padding: 10px 12px;
  background: rgba(196, 122, 58, 0.08);
  color: #8a4f1f;
  font-size: 13px;
}

.flow {
  display: grid;
  gap: 14px;
  border-radius: 18px;
  padding: 18px;
  background: linear-gradient(180deg, rgba(248, 243, 236, 0.92), rgba(255, 251, 246, 0.92));
}

.actions {
  display: flex;
  justify-content: center;
  gap: 10px;
}

.actions button {
  border: 1px solid rgba(196, 122, 58, 0.34);
  border-radius: 999px;
  padding: 8px 14px;
  background: rgba(196, 122, 58, 0.08);
  color: #8a4f1f;
  cursor: pointer;
}
```

- [ ] **Step 4: Wire view switch into `TTSSynthesis.tsx`**

Add import:

```typescript
import { ChatSegmentView } from '../components/SegmentedTTS/ChatSegmentView';
```

Merge `SegmentKind` into the existing type import:

```typescript
import type { TTSRequest, TTSResult, VoiceProfile, SegmentedProject, Chapter, SegmentEngineParams, Role, SegmentKind } from '../types';
```

Add state near `compactMode`:

```typescript
  const [segmentViewMode, setSegmentViewMode] = useState<'list' | 'dialogue'>('list');
```

Add handler near other segment handlers:

```typescript
  const handleAppendByKind = useCallback((kind: SegmentKind) => {
    dispatch({ type: 'APPEND_SEGMENT', text: '' });
    setTimeout(() => {
      setProject(prev => {
        const active = getActiveChapter(prev);
        const latest = active?.segments[active.segments.length - 1];
        if (!latest) return prev;
        return segmentedReducer({ project: prev }, { type: 'SET_SEGMENT_KIND', id: latest.id, segmentKind: kind }).project;
      });
    }, 0);
  }, [dispatch]);
```

Replace the current `SegmentList` rendering block with a conditional that preserves the exact existing props for list mode and uses `ChatSegmentView` for dialogue mode:

```tsx
<div className={styles.viewSwitch}>
  <button type="button" onClick={() => setSegmentViewMode('list')} aria-pressed={segmentViewMode === 'list'}>列表视图</button>
  <button type="button" onClick={() => setSegmentViewMode('dialogue')} aria-pressed={segmentViewMode === 'dialogue'}>对话视图</button>
</div>
{segmentViewMode === 'dialogue' ? (
  <ChatSegmentView
    segments={activeChapter.segments}
    roles={roles}
    selectedId={activeChapter.selected_segment_id}
    playingId={playingId}
    hasNarratorVoice={!!project.default_narrator_snapshot?.default_voice || !!project.default_narrator_snapshot?.default_engine_params?.edge_voice}
    onSelect={(id) => dispatch({ type: 'SELECT_SEGMENT', id })}
    onAppend={handleAppendByKind}
    onRegenerate={handleRegenerate}
    onPlay={handlePlay}
  />
) : (
  <SegmentList
    segments={activeChapter.segments}
    layout={project.layout}
    selectedId={activeChapter.selected_segment_id}
    playingId={playingId}
    isPaused={isPaused}
    compact={compactMode}
    voices={voices}
    globalVoiceId={selectedVoiceId}
    globalVoiceName={voices.find(v => (v.qwen_voice_id || v.id) === selectedVoiceId)?.description || voices.find(v => (v.qwen_voice_id || v.id) === selectedVoiceId)?.name}
    globalEdgeVoice={edgeVoice}
    engine={engine}
    globalMimoMode={mimoMode}
    globalMimoPresetVoice={mimoPresetVoice}
    globalMimoCloneVoiceId={mimoCloneVoiceId}
    chapterStartOffset={effectiveTimeOffset}
    onSelect={(id) => dispatch({ type: 'SELECT_SEGMENT', id })}
    onDelete={handleDeleteSegment}
    onInsertAfter={handleInsertAfter}
    onAppend={handleAppendSegment}
    onReorder={handleReorder}
    onEdit={(id) => dispatch({ type: 'SELECT_SEGMENT', id: id || undefined })}
    onRegenerate={handleRegenerate}
    onPlay={handlePlay}
    onTrimSilence={handleTrimSilence}
    onUndo={handleUndoRegenerate}
    onAnnotateSSML={handleAnnotateSSML}
    onDuplicate={handleDuplicateSegment}
    onUpdateText={(id, text) => dispatch({ type: 'UPDATE_TEXT', id, text })}
    onUpdateSSML={(id, ssml) => dispatch({ type: 'UPDATE_SSML', id, ssml })}
    onUpdateParams={(id, segmentParams) => dispatch({ type: 'UPDATE_PARAMS', id, params: segmentParams })}
    onUpdateEmotion={(id, emotion) => dispatch({ type: 'UPDATE_EMOTION', id, emotion })}
    onToggleIndependentVoice={(id) => dispatch({ type: 'TOGGLE_INDEPENDENT_VOICE', id })}
    onMerge={handleMergeSegments}
    onSplit={handleSplitSegment}
  />
)}
```

Use the project’s actual handler names in this replacement. If a handler has a different name in the file, keep the existing name and only wrap the rendering condition.

Add a minimal `viewSwitch` class to `frontend/src/pages/TTSSynthesis.module.css` if it does not already exist:

```css
.viewSwitch {
  display: inline-flex;
  gap: 6px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  padding: 4px;
  background: var(--surface-color);
}

.viewSwitch button {
  border: 0;
  border-radius: 999px;
  padding: 6px 12px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.viewSwitch button[aria-pressed="true"] {
  background: rgba(196, 122, 58, 0.14);
  color: #8a4f1f;
}
```

- [ ] **Step 5: Run frontend build**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit dialogue view**

Run:

```bash
git add frontend/src/components/SegmentedTTS/ChatSegmentView.tsx frontend/src/components/SegmentedTTS/ChatSegmentView.module.css frontend/src/components/SegmentedTTS/ChatBubble.tsx frontend/src/components/SegmentedTTS/ChatBubble.module.css frontend/src/components/SegmentedTTS/NarrationBlock.tsx frontend/src/components/SegmentedTTS/NarrationBlock.module.css frontend/src/pages/TTSSynthesis.tsx frontend/src/pages/TTSSynthesis.module.css
git commit -m "feat(frontend): add dialogue segment view"
```

---

## Task 6: Inline prosody mark editor

**Files:**
- Create: `frontend/src/components/SegmentedTTS/ProsodyMarkEditor.tsx`
- Create: `frontend/src/components/SegmentedTTS/ProsodyMarkEditor.module.css`
- Modify: `frontend/src/components/SegmentedTTS/ChatBubble.tsx`
- Modify: `frontend/src/components/SegmentedTTS/NarrationBlock.tsx`
- Modify: `frontend/src/components/SegmentedTTS/ChatSegmentView.tsx`
- Modify: `frontend/src/pages/TTSSynthesis.tsx`

- [ ] **Step 1: Create prosody editor component**

Create `frontend/src/components/SegmentedTTS/ProsodyMarkEditor.tsx`:

```tsx
import { useState } from 'react';
import type { EmotionType, ProsodyMark } from '../../types';
import styles from './ProsodyMarkEditor.module.css';

interface ProsodyMarkEditorProps {
  selection: { start: number; end: number; text: string } | null;
  onSave: (mark: ProsodyMark) => void;
  onCancel: () => void;
}

const STYLE_OPTIONS = [
  { value: 'low_voice', label: '低声' },
  { value: 'emphasis', label: '重读' },
  { value: 'pause', label: '停顿' },
  { value: 'slow', label: '放慢' },
  { value: 'fast', label: '加快' },
];

const EMOTIONS: { value: EmotionType; label: string }[] = [
  { value: 'neutral', label: '中性' },
  { value: 'happy', label: '开心' },
  { value: 'sad', label: '悲伤' },
  { value: 'angry', label: '愤怒' },
  { value: 'calm', label: '平静' },
  { value: 'excited', label: '兴奋' },
];

export function ProsodyMarkEditor({ selection, onSave, onCancel }: ProsodyMarkEditorProps) {
  const [emotion, setEmotion] = useState<EmotionType>('neutral');
  const [styleTags, setStyleTags] = useState<string[]>([]);
  const [instruction, setInstruction] = useState('');
  const [intensity, setIntensity] = useState(0.5);

  if (!selection) return null;

  const toggleStyle = (value: string) => {
    setStyleTags(prev => prev.includes(value) ? prev.filter(item => item !== value) : [...prev, value]);
  };

  const save = () => {
    onSave({
      id: `mark-${Date.now()}`,
      start: selection.start,
      end: selection.end,
      emotion,
      style_tags: styleTags,
      instruction: instruction.trim() || undefined,
      intensity,
    });
  };

  return (
    <div className={styles.root}>
      <div className={styles.selection}>“{selection.text}”</div>
      <label>情绪
        <select value={emotion} onChange={event => setEmotion(event.target.value as EmotionType)}>
          {EMOTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <div className={styles.styles}>
        {STYLE_OPTIONS.map(option => (
          <button
            key={option.value}
            type="button"
            aria-pressed={styleTags.includes(option.value)}
            onClick={() => toggleStyle(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <label>强度
        <input type="range" min="0" max="1" step="0.1" value={intensity} onChange={event => setIntensity(Number(event.target.value))} />
      </label>
      <label>高级指令
        <input value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="例如：压低声音，带一点犹豫" />
      </label>
      <div className={styles.actions}>
        <button type="button" onClick={save}>保存标注</button>
        <button type="button" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
```

Create `frontend/src/components/SegmentedTTS/ProsodyMarkEditor.module.css`:

```css
.root {
  display: grid;
  gap: 10px;
  border: 1px solid rgba(196, 122, 58, 0.3);
  border-radius: 14px;
  padding: 12px;
  background: var(--surface-color);
  box-shadow: 0 10px 24px rgba(80, 45, 12, 0.12);
}

.selection {
  color: #8a4f1f;
  font-weight: 700;
}

.root label {
  display: grid;
  gap: 5px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.root input,
.root select {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 8px 10px;
}

.styles,
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.styles button,
.actions button {
  border: 1px solid rgba(196, 122, 58, 0.35);
  border-radius: 999px;
  padding: 6px 10px;
  background: rgba(196, 122, 58, 0.08);
  color: #8a4f1f;
  cursor: pointer;
}

.styles button[aria-pressed="true"] {
  background: #c47a3a;
  color: white;
}
```

- [ ] **Step 2: Add highlighted text renderer to chat bubble**

Modify `ChatBubble.tsx`.

Add props:

```typescript
  onTextSelection: (segmentId: string, start: number, end: number, text: string) => void;
```

Add helper above component:

```tsx
function renderMarkedText(segment: Segment) {
  const text = segment.text || '空台词';
  const marks = [...(segment.prosody_marks ?? [])].sort((a, b) => a.start - b.start);
  if (marks.length === 0) return text;
  const parts: JSX.Element[] = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.start > cursor) parts.push(<span key={`plain-${cursor}`}>{text.slice(cursor, mark.start)}</span>);
    parts.push(<mark key={mark.id} className={styles.prosodyMark}>{text.slice(mark.start, mark.end)}</mark>);
    cursor = Math.max(cursor, mark.end);
  }
  if (cursor < text.length) parts.push(<span key={`plain-${cursor}`}>{text.slice(cursor)}</span>);
  return parts;
}
```

Change text paragraph to:

```tsx
        <p
          className={styles.text}
          onMouseUp={(event) => {
            const selection = window.getSelection();
            const selected = selection?.toString() ?? '';
            if (!selection || selected.length === 0) return;
            const start = segment.text.indexOf(selected);
            if (start < 0) return;
            event.stopPropagation();
            onTextSelection(segment.id, start, start + selected.length, selected);
          }}
        >
          {renderMarkedText(segment)}
        </p>
```

Add to `ChatBubble.module.css`:

```css
.prosodyMark {
  border-radius: 5px;
  padding: 1px 3px;
  background: rgba(196, 122, 58, 0.22);
  color: inherit;
  border-bottom: 2px solid #c47a3a;
}
```

- [ ] **Step 3: Add highlighted text renderer to narration block**

Modify `NarrationBlock.tsx` the same way: add `onTextSelection` prop and render `<mark className={styles.prosodyMark}>` spans inside the paragraph. Add this CSS to `NarrationBlock.module.css`:

```css
.prosodyMark {
  border-radius: 5px;
  padding: 1px 3px;
  background: rgba(196, 122, 58, 0.2);
  color: inherit;
  border-bottom: 2px solid #c47a3a;
}
```

- [ ] **Step 4: Manage selected text in chat segment view**

Modify `ChatSegmentView.tsx` props:

```typescript
  onUpdateProsodyMarks: (id: string, marks: NonNullable<Segment['prosody_marks']>) => void;
```

Import and render editor:

```typescript
import { useState } from 'react';
import { ProsodyMarkEditor } from './ProsodyMarkEditor';
```

Inside component state:

```typescript
  const [selection, setSelection] = useState<{ segmentId: string; start: number; end: number; text: string } | null>(null);
```

Pass `onTextSelection` to `ChatBubble` and `NarrationBlock`:

```tsx
onTextSelection={(segmentId, start, end, text) => setSelection({ segmentId, start, end, text })}
```

Render after the flow:

```tsx
      <ProsodyMarkEditor
        selection={selection}
        onCancel={() => setSelection(null)}
        onSave={(mark) => {
          if (!selection) return;
          const segment = segments.find(item => item.id === selection.segmentId);
          const marks = [...(segment?.prosody_marks ?? []), mark];
          onUpdateProsodyMarks(selection.segmentId, marks);
          setSelection(null);
        }}
      />
```

- [ ] **Step 5: Wire prosody update in `TTSSynthesis.tsx`**

When rendering `ChatSegmentView`, add:

```tsx
    onUpdateProsodyMarks={(id, prosodyMarks) => dispatch({ type: 'UPDATE_PROSODY_MARKS', id, prosodyMarks })}
```

- [ ] **Step 6: Run tests and build**

Run:

```bash
cd frontend && npx vitest run src/hooks/__tests__/useSegmentedProject.test.ts src/services/segmentGenerationInputs.test.ts && npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit prosody editor UI**

Run:

```bash
git add frontend/src/components/SegmentedTTS/ProsodyMarkEditor.tsx frontend/src/components/SegmentedTTS/ProsodyMarkEditor.module.css frontend/src/components/SegmentedTTS/ChatBubble.tsx frontend/src/components/SegmentedTTS/ChatBubble.module.css frontend/src/components/SegmentedTTS/NarrationBlock.tsx frontend/src/components/SegmentedTTS/NarrationBlock.module.css frontend/src/components/SegmentedTTS/ChatSegmentView.tsx frontend/src/pages/TTSSynthesis.tsx
git commit -m "feat(frontend): add inline prosody marks"
```

---

## Task 7: Generation resolution and stale detection

**Files:**
- Modify: `frontend/src/components/SegmentedTTS/SegmentRow.tsx:181-203`
- Modify: `frontend/src/components/SegmentedTTS/ChatBubble.tsx`
- Modify: `frontend/src/services/segmentGenerationInputs.ts`
- Modify: `backend/app/services/segmented_project_service.py:519-591`
- Modify: `backend/tests/test_segmented_synthesis.py`

- [ ] **Step 1: Add backend test for role snapshot overriding chapter defaults**

Append to `backend/tests/test_segmented_synthesis.py`:

```python

def test_synthesize_segment_uses_role_snapshot_voice_before_chapter_defaults(db_session, tmp_path, monkeypatch):
    from unittest.mock import patch

    from app.core import config
    from app.schemas.segmented_project import ProjectIn
    from app.services.segmented_project_service import save_project, synthesize_segment

    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    project = ProjectIn(
        id="p-priority",
        name="Priority",
        schema_version=2,
        layout="vertical",
        chapters=[{
            "id": "c1",
            "position": 0,
            "name": "第一章",
            "engine": "edge_tts",
            "default_params": {"engine": "edge_tts", "edge_voice": "zh-CN-YunjianNeural"},
            "split_config": {"delimiters": ["。"], "mode": "rule"},
            "segments": [{
                "id": "s1",
                "position": 0,
                "text": "你好",
                "params": {"engine": "edge_tts"},
                "role_snapshot": {
                    "id": "role-linxia",
                    "name": "林夏",
                    "default_engine_params": {"engine": "edge_tts", "edge_voice": "zh-CN-XiaoxiaoNeural"},
                },
            }],
        }],
    )
    save_project(db_session, project)
    db_session.commit()

    captured: dict[str, object] = {}

    def fake_synth(engine, text, params, db=None):
        captured["engine"] = engine
        captured["params"] = params
        return b"RIFF\x00\x00\x00\x00WAVEfmt ", "wav"

    with patch("app.services.segmented_project_service.is_ffmpeg_available", return_value=False), patch(
        "app.services.segmented_project_service.synthesize_with_engine",
        side_effect=fake_synth,
    ):
        synthesize_segment(db_session, "p-priority", "c1", "s1")

    assert captured["engine"] == "edge_tts"
    assert captured["params"]["edge_voice"] == "zh-CN-XiaoxiaoNeural"
```

- [ ] **Step 2: Run backend test to verify failure or protect behavior**

Run:

```bash
cd backend && uv run --extra test pytest tests/test_segmented_synthesis.py::test_synthesize_segment_uses_role_snapshot_voice_before_chapter_defaults -q
```

Expected: PASS if Task 2 already merged role params correctly; FAIL if merge order is wrong.

- [ ] **Step 3: Ensure backend merge order matches priority**

In `synthesize_segment`, role snapshot params must sit between chapter defaults and segment params. Use this shape:

```python
    role_snapshot = getattr(seg, "role_snapshot", None)
    role_params = role_snapshot.get("default_engine_params") if isinstance(role_snapshot, dict) else None
    effective = _merge_params(chapter.default_params, role_params, seg.params, request_params)
```

Then append role metadata:

```python
    role_id = getattr(seg, "role_id", None)
    prosody_marks = getattr(seg, "prosody_marks", None) or []
    if role_id is not None:
        effective["role_id"] = role_id
    if role_snapshot is not None:
        effective["role_snapshot"] = role_snapshot
    effective["prosody_marks"] = prosody_marks
    effective["segment_kind"] = getattr(seg, "segment_kind", None) or "narration"
```

- [ ] **Step 4: Replace SegmentRow stale detection with shared helper**

Modify `frontend/src/components/SegmentedTTS/SegmentRow.tsx` imports:

```typescript
import { isSegmentAudioStale } from '../../services/segmentGenerationInputs';
```

Replace lines that compute `generatedEngine`, `engineChanged`, `currentGlobalVoice`, `voiceChanged`, and `isStale` with:

```typescript
  const defaultParamsForStale = {
    ...segment.params,
    engine: (effectiveEngine || segment.params.engine) as Segment['params']['engine'],
    voice_id: !hasOverride ? globalVoiceId : segment.params.voice_id,
    edge_voice: !hasOverride ? globalEdgeVoice : segment.params.edge_voice,
    mimo_mode: !hasOverride ? globalMimoMode as Segment['params']['mimo_mode'] : segment.params.mimo_mode,
    mimo_preset_voice: !hasOverride ? globalMimoPresetVoice : segment.params.mimo_preset_voice,
    mimo_clone_voice_id: !hasOverride ? globalMimoCloneVoiceId : segment.params.mimo_clone_voice_id,
  };
  const isStale = isSegmentAudioStale(segment, defaultParamsForStale);
```

Keep `currentGlobalVoice` for warning text by reintroducing it below:

```typescript
  const currentGlobalVoice = effectiveEngine === 'edge_tts'
    ? (globalEdgeVoice || '')
    : effectiveEngine === 'mimo_tts'
      ? (globalMimoMode === 'voiceclone' ? (globalMimoCloneVoiceId || '') : (globalMimoPresetVoice || ''))
      : (globalVoiceId || '');
```

- [ ] **Step 5: Show stale state in chat bubble**

Add `isStale?: boolean` prop to `ChatBubbleProps` and render a warning chip in the footer:

```tsx
          {isStale && <span className={styles.stale}>需重新生成</span>}
```

Add CSS:

```css
.stale {
  border-radius: 999px;
  padding: 3px 8px;
  background: #fff0e8;
  color: #a33;
  font-weight: 700;
}
```

In `ChatSegmentView`, compute it with `isSegmentAudioStale(segment, segment.role_snapshot?.default_engine_params ?? segment.params)` and pass to `ChatBubble`.

- [ ] **Step 6: Run focused tests and build**

Run:

```bash
cd backend && uv run --extra test pytest tests/test_segmented_synthesis.py -q
cd ../frontend && npx vitest run src/services/segmentGenerationInputs.test.ts && npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit generation and stale detection**

Run:

```bash
git add backend/app/services/segmented_project_service.py backend/tests/test_segmented_synthesis.py frontend/src/components/SegmentedTTS/SegmentRow.tsx frontend/src/components/SegmentedTTS/ChatBubble.tsx frontend/src/components/SegmentedTTS/ChatBubble.module.css frontend/src/components/SegmentedTTS/ChatSegmentView.tsx frontend/src/services/segmentGenerationInputs.ts frontend/src/services/segmentGenerationInputs.test.ts
git commit -m "feat: include roles and prosody in generation staleness"
```

---

## Task 8: Split-and-concat fallback boundary and E2E coverage

**Files:**
- Modify: `backend/app/services/segmented_project_service.py`
- Modify: `backend/tests/test_segmented_synthesis.py`
- Create: `tests/e2e/specs/dialogue-prosody.spec.ts`
- Modify: `docs/api-reference.md` if it documents segmented project fields.

- [ ] **Step 1: Add backend unit test for local prosody split planning**

Append to `backend/tests/test_segmented_synthesis.py`:

```python

def test_plan_prosody_subsegments_splits_text_around_marks():
    from app.services.segmented_project_service import plan_prosody_subsegments

    parts = plan_prosody_subsegments(
        "我不是不相信你，只是有点害怕。",
        [{"id": "m1", "start": 8, "end": 14, "style_tags": ["low_voice"]}],
    )

    assert parts == [
        {"text": "我不是不相信你，", "prosody": None},
        {"text": "只是有点害怕", "prosody": {"id": "m1", "start": 8, "end": 14, "style_tags": ["low_voice"]}},
        {"text": "。", "prosody": None},
    ]
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cd backend && uv run --extra test pytest tests/test_segmented_synthesis.py::test_plan_prosody_subsegments_splits_text_around_marks -q
```

Expected: FAIL because `plan_prosody_subsegments` is missing.

- [ ] **Step 3: Add split planning function**

Add to `backend/app/services/segmented_project_service.py` before `synthesize_segment`:

```python
def plan_prosody_subsegments(text: str, marks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Split text into plain and marked ranges for engines that need fallback generation."""
    normalized = sorted(
        [mark for mark in marks if isinstance(mark.get("start"), int) and isinstance(mark.get("end"), int)],
        key=lambda mark: mark["start"],
    )
    parts: list[dict[str, Any]] = []
    cursor = 0
    text_length = len(text)
    for mark in normalized:
        start = max(0, min(mark["start"], text_length))
        end = max(start, min(mark["end"], text_length))
        if start > cursor:
            parts.append({"text": text[cursor:start], "prosody": None})
        if end > start:
            parts.append({"text": text[start:end], "prosody": mark})
        cursor = max(cursor, end)
    if cursor < text_length:
        parts.append({"text": text[cursor:], "prosody": None})
    return [part for part in parts if part["text"]]
```

- [ ] **Step 4: Keep fallback execution behind a small boundary**

Add this helper after `plan_prosody_subsegments`:

```python
def should_use_split_fallback(engine: str, prosody_marks: list[dict[str, Any]]) -> bool:
    if not prosody_marks:
        return False
    return engine == "edge_tts"
```

In `synthesize_segment`, before the current `audio_bytes, _native_fmt = synthesize_with_engine(...)`, insert:

```python
    if should_use_split_fallback(engine, prosody_marks):
        # First version keeps UI and metadata ready for split fallback while continuing
        # to generate one segment audio. The dedicated concat execution can replace
        # this branch without changing API or stored fields.
        effective["prosody_split_plan"] = plan_prosody_subsegments(text_to_speak, prosody_marks)
```

This task records the split plan in generated params and gives the next audio-work task a stable function to expand. It does not publish partial audio.

- [ ] **Step 5: Add E2E spec skeleton for critical user path**

Create `tests/e2e/specs/dialogue-prosody.spec.ts`:

```typescript
import { expect, test } from '@playwright/test';

test('creates a role and opens dialogue view', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /角色库/ }).click();
  await expect(page.getByRole('dialog', { name: /角色库/ })).toBeVisible();
  await page.getByLabel(/角色名/).fill('林夏');
  await page.getByLabel(/默认音色/).fill('zh-CN-XiaoxiaoNeural');
  await page.getByRole('button', { name: /保存角色/ }).click();
  await expect(page.getByText('林夏')).toBeVisible();
  await page.getByRole('button', { name: /关闭/ }).click();
  await page.getByRole('button', { name: /对话视图/ }).click();
  await page.getByRole('button', { name: /新增台词/ }).click();
  await expect(page.getByText(/空台词/)).toBeVisible();
});
```

- [ ] **Step 6: Run backend and frontend verification**

Run:

```bash
cd backend && uv run --extra test pytest tests/test_segmented_synthesis.py -q
cd ../frontend && npm run build
```

Expected: PASS.

- [ ] **Step 7: Run E2E if app launch helpers are available**

If the project E2E README says to start the app manually, use two terminals:

```bash
cd backend && uv run uvicorn main:app --host 127.0.0.1 --port 8002
cd frontend && npm run dev
```

Then run:

```bash
npx playwright test tests/e2e/specs/dialogue-prosody.spec.ts
```

Expected: PASS. If browser automation is not configured in this checkout, record the exact setup failure in the final task report.

- [ ] **Step 8: Update API docs for new role fields**

If `docs/api-reference.md` contains the segmented project schema, add these field descriptions to the segmented project section:

```markdown
- `default_narrator_role_id`: optional global role ID for narration segments.
- `default_narrator_snapshot`: saved narrator role voice configuration.
- `segment.role_id`: optional global role ID for a dialogue or narration segment.
- `segment.role_snapshot`: saved role voice configuration used for reproducible generation.
- `segment.segment_kind`: `dialogue` or `narration`.
- `segment.prosody_marks`: local sub-sentence tone marks with `start`, `end`, `emotion`, `style_tags`, `instruction`, and `intensity`.
```

- [ ] **Step 9: Commit fallback boundary and E2E**

Run:

```bash
git add backend/app/services/segmented_project_service.py backend/tests/test_segmented_synthesis.py tests/e2e/specs/dialogue-prosody.spec.ts docs/api-reference.md
git commit -m "feat: add prosody fallback planning"
```

---

## Final verification

- [ ] **Step 1: Run full backend tests**

```bash
cd backend && uv run --extra test pytest -q
```

Expected: PASS or documented skips for external-service tests.

- [ ] **Step 2: Run frontend build**

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 3: Run frontend focused tests**

```bash
cd frontend && npx vitest run src/hooks/__tests__/useSegmentedProject.test.ts src/services/segmentGenerationInputs.test.ts
```

Expected: PASS.

- [ ] **Step 4: Inspect git diff**

```bash
git status --short
git diff --stat
```

Expected: working tree contains only intentional files if final commits were not made, or clean if every task committed.

## Self-review checklist

- Spec coverage: role library is covered by Tasks 1 and 4; segmented fields by Tasks 2 and 3; dialogue view by Task 5; prosody marks by Task 6; generation and stale detection by Tasks 7 and 8; E2E by Task 8.
- Placeholder scan: this plan uses concrete file paths, test names, code snippets, commands, and expected outcomes.
- Type consistency: role field names match the spec: `role_id`, `role_snapshot`, `segment_kind`, `prosody_marks`, `default_narrator_role_id`, and `default_narrator_snapshot`.
