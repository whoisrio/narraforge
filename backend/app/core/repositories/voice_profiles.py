"""VoiceProfile 仓储（步骤 3A）。

方法签名提取自 clone.py / tts.py / mimo_tts.py 的实际调用（YAGNI）。
返回值统一为 voice_to_dict 形状（A5/B-P1-8 契约：含 has_preview/has_source），
Local 与 Supabase 实现共用同一映射，保证两模式响应一致。
"""
from __future__ import annotations

import copy
from typing import Protocol, runtime_checkable

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.supabase_client import SupabaseClient
from app.models.voice_profile import VoiceProfile

TABLE = "voice_profiles"

# update 允许的字段（防 id/created_at 被改写）
_UPDATABLE_FIELDS = ("name", "description", "avatar", "project_id", "voice", "voice_params", "preview")
_JSON_FIELDS = ("voice", "voice_params", "preview")


def voice_row_to_dict(row: dict) -> dict:
    """DB 行（Supabase/ORM 通用）→ voice_to_dict 形状。"""
    voice = row.get("voice") or {}
    voice_params = row.get("voice_params") or {}
    preview = row.get("preview") or {}
    model = voice.get("model", "")
    created_at = row.get("created_at")
    return {
        "id": str(row["id"]),
        "name": row.get("name"),
        "description": row.get("description"),
        "avatar": row.get("avatar"),
        "project_id": row.get("project_id"),
        "voice": voice,
        "voice_params": voice_params,
        "preview": preview,
        "has_preview": bool(preview.get("preview_audio_path")),
        "has_source": bool((voice_params.get(model) or {}).get("source_audio_path")),
        "created_at": created_at.isoformat() if hasattr(created_at, "isoformat") else created_at,
    }


def _orm_to_dict(v: VoiceProfile) -> dict:
    return voice_row_to_dict(
        {
            "id": v.id,
            "name": v.name,
            "description": v.description,
            "avatar": v.avatar,
            "project_id": v.project_id,
            "voice": v.voice,
            "voice_params": v.voice_params,
            "preview": v.preview,
            "created_at": v.created_at,
        }
    )


@runtime_checkable
class VoiceProfileRepository(Protocol):
    def list(self, project_id: str | None = None) -> list[dict]: ...
    def get(self, voice_id: str) -> dict | None: ...
    def create(self, fields: dict) -> dict: ...
    def update(self, voice_id: str, fields: dict) -> dict | None: ...
    def delete(self, voice_id: str) -> bool: ...
    def find_by_description(self, description: str, exclude_id: str) -> dict | None: ...


class LocalVoiceProfileRepository:
    """把 clone.py 路由里的 SQLAlchemy 查询搬进仓储；路由不再持有 Session。"""

    def __init__(self, db: Session):
        self._db = db

    def list(self, project_id: str | None = None) -> list[dict]:
        query = self._db.query(VoiceProfile)
        if project_id:
            query = query.filter(
                or_(VoiceProfile.project_id == None, VoiceProfile.project_id == project_id)
            )
        else:
            query = query.filter(VoiceProfile.project_id == None)
        return [_orm_to_dict(v) for v in query.order_by(VoiceProfile.created_at.desc()).all()]

    def get(self, voice_id: str) -> dict | None:
        v = self._db.query(VoiceProfile).filter(VoiceProfile.id == voice_id).first()
        return _orm_to_dict(v) if v else None

    def create(self, fields: dict) -> dict:
        v = VoiceProfile(
            id=fields["id"],
            name=fields["name"],
            description=fields.get("description"),
            avatar=fields.get("avatar"),
            project_id=fields.get("project_id"),
            voice=fields.get("voice") or {},
            voice_params=fields.get("voice_params") or {},
            preview=fields.get("preview"),
        )
        self._db.add(v)
        self._db.commit()
        self._db.refresh(v)
        return _orm_to_dict(v)

    def update(self, voice_id: str, fields: dict) -> dict | None:
        v = self._db.query(VoiceProfile).filter(VoiceProfile.id == voice_id).first()
        if v is None:
            return None
        for key, value in fields.items():
            if key not in _UPDATABLE_FIELDS:
                continue
            # JSON 列浅拷贝比较会相等导致不标脏、静默丢失更新（AGENTS.md 教训）——深拷贝再赋值
            if key in _JSON_FIELDS and value is not None:
                value = copy.deepcopy(value)
            setattr(v, key, value)
        self._db.commit()
        self._db.refresh(v)
        return _orm_to_dict(v)

    def delete(self, voice_id: str) -> bool:
        v = self._db.query(VoiceProfile).filter(VoiceProfile.id == voice_id).first()
        if v is None:
            return False
        self._db.delete(v)
        self._db.commit()
        return True

    def find_by_description(self, description: str, exclude_id: str) -> dict | None:
        v = (
            self._db.query(VoiceProfile)
            .filter(VoiceProfile.description == description, VoiceProfile.id != exclude_id)
            .first()
        )
        return _orm_to_dict(v) if v else None


class SupabaseVoiceProfileRepository:
    """PostgREST 实现。"""

    def __init__(self, client: SupabaseClient):
        self._client = client

    def list(self, project_id: str | None = None) -> list[dict]:
        if project_id:
            params = {"or": f"(project_id.is.null,project_id.eq.{project_id})"}
        else:
            params = {"project_id": "is.null"}
        params["order"] = "created_at.desc"
        return [voice_row_to_dict(row) for row in self._client.select(TABLE, params=params)]

    def get(self, voice_id: str) -> dict | None:
        row = self._client.select_one(TABLE, params={"id": f"eq.{voice_id}"})
        return voice_row_to_dict(row) if row else None

    def create(self, fields: dict) -> dict:
        row = {
            "id": fields["id"],
            "name": fields["name"],
            "description": fields.get("description"),
            "avatar": fields.get("avatar"),
            "project_id": fields.get("project_id"),
            "voice": fields.get("voice") or {},
            "voice_params": fields.get("voice_params") or {},
            "preview": fields.get("preview"),
        }
        inserted = self._client.insert(TABLE, [row])
        return voice_row_to_dict(inserted[0])

    def update(self, voice_id: str, fields: dict) -> dict | None:
        values = {k: v for k, v in fields.items() if k in _UPDATABLE_FIELDS}
        if not values:
            current = self.get(voice_id)
            return current
        rows = self._client.update(TABLE, values, params={"id": f"eq.{voice_id}"})
        if not rows:
            return None
        return voice_row_to_dict(rows[0])

    def delete(self, voice_id: str) -> bool:
        return bool(self._client.delete(TABLE, params={"id": f"eq.{voice_id}"}))

    def find_by_description(self, description: str, exclude_id: str) -> dict | None:
        row = self._client.select_one(
            TABLE,
            params={"description": f"eq.{description}", "id": f"neq.{exclude_id}"},
        )
        return voice_row_to_dict(row) if row else None
