"""TTSResultRecord 仓储（后端存储模式，workers 适配）。

方法签名提取自 tts.py 的实际调用：
- list()：全部历史（created_at desc）
- get(id)：单条
- create(fields)：写入（audio_path 为音频引用——local 为相对路径 / workers 为 Supabase Storage key）
- delete(id)：删除

Local 用 SQLAlchemy（local 模式），Supabase 用 PostgREST（workers 模式）。
返回 dict 形状与 TTSResultRecordOut 契约一致（tts.py _result_to_dict 消费）。
"""
from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from app.core.supabase_client import SupabaseClient
from app.core.repositories.user_scope import UserScope

# workers bundle 不含 sqlalchemy / app.models：Local* 只在 local 模式实例化。
try:
    from sqlalchemy.orm import Session

    from app.models.tts_result import TTSResultRecord
except ImportError:  # workers bundle
    Session = Any  # type: ignore[assignment,misc]
    TTSResultRecord = None  # type: ignore[assignment,misc]

TABLE = "tts_results"


def tts_row_to_dict(row: dict) -> dict:
    """DB 行（Supabase/ORM 通用）→ TTSResultRecordOut 形状（含 audio_path 供读取端点用）。"""
    created_at = row.get("created_at")
    return {
        "id": str(row["id"]),
        "text": row.get("text"),
        "voice_id": row.get("voice_id"),
        "voice_name": row.get("voice_name"),
        "audio_path": row.get("audio_path"),
        "audio_format": row.get("audio_format"),
        "speed": row.get("speed"),
        "volume": row.get("volume"),
        "pitch": row.get("pitch"),
        "instruction": row.get("instruction"),
        "language": row.get("language"),
        "source": row.get("source"),
        "created_at": created_at.isoformat() if hasattr(created_at, "isoformat") else created_at,
    }


def _orm_to_dict(r: TTSResultRecord) -> dict:
    return tts_row_to_dict(
        {
            "id": r.id,
            "text": r.text,
            "voice_id": r.voice_id,
            "voice_name": r.voice_name,
            "audio_path": r.audio_path,
            "audio_format": r.audio_format,
            "speed": r.speed,
            "volume": r.volume,
            "pitch": r.pitch,
            "instruction": r.instruction,
            "language": r.language,
            "source": r.source,
            "created_at": r.created_at,
        }
    )


@runtime_checkable
class TTSResultRepository(Protocol):
    def list(self) -> list[dict]: ...
    def get(self, result_id: str) -> dict | None: ...
    def create(self, fields: dict) -> dict: ...
    def delete(self, result_id: str) -> bool: ...


class LocalTTSResultRepository:
    """SQLAlchemy 实现（local 模式，保持既有行为）。"""

    def __init__(self, db: Session):
        self._db = db

    def list(self) -> list[dict]:
        rows = (
            self._db.query(TTSResultRecord)
            .order_by(TTSResultRecord.created_at.desc())
            .all()
        )
        return [_orm_to_dict(r) for r in rows]

    def get(self, result_id: str) -> dict | None:
        r = self._db.query(TTSResultRecord).filter(TTSResultRecord.id == result_id).first()
        return _orm_to_dict(r) if r else None

    def create(self, fields: dict) -> dict:
        r = TTSResultRecord(
            id=fields["id"],
            text=fields["text"],
            voice_id=fields["voice_id"],
            voice_name=fields.get("voice_name"),
            audio_path=fields["audio_path"],
            audio_format=fields.get("audio_format", "mp3"),
            speed=fields.get("speed", 1.0),
            volume=fields.get("volume", 80),
            pitch=fields.get("pitch", 1.0),
            instruction=fields.get("instruction", ""),
            language=fields.get("language", "Chinese"),
            source=fields.get("source"),
        )
        self._db.add(r)
        self._db.commit()
        self._db.refresh(r)
        return _orm_to_dict(r)

    def delete(self, result_id: str) -> bool:
        r = self._db.query(TTSResultRecord).filter(TTSResultRecord.id == result_id).first()
        if r is None:
            return False
        self._db.delete(r)
        self._db.commit()
        return True


class SupabaseTTSResultRepository(UserScope):
    """PostgREST 实现（workers 模式）。M4：用户归属作用域。"""

    def __init__(self, client: SupabaseClient, owner_id: str | None = None, see_all: bool = False):
        super().__init__(owner_id=owner_id, see_all=see_all)
        self._client = client

    def list(self) -> list[dict]:
        rows = self._client.select(TABLE, params=self._scope_params({"order": "created_at.desc"}))
        return [tts_row_to_dict(r) for r in rows]

    def get(self, result_id: str) -> dict | None:
        row = self._client.select_one(TABLE, params=self._scope_params({"id": f"eq.{result_id}"}))
        return tts_row_to_dict(row) if row else None

    def create(self, fields: dict) -> dict:
        row = self._stamp_row({
            "id": fields["id"],
            "text": fields["text"],
            "voice_id": fields["voice_id"],
            "voice_name": fields.get("voice_name"),
            "audio_path": fields["audio_path"],
            "audio_format": fields.get("audio_format", "mp3"),
            "speed": fields.get("speed", 1.0),
            "volume": fields.get("volume", 80),
            "pitch": fields.get("pitch", 1.0),
            "instruction": fields.get("instruction", ""),
            "language": fields.get("language", "Chinese"),
            "source": fields.get("source"),
        })
        inserted = self._client.insert(TABLE, [row])
        return tts_row_to_dict(inserted[0])

    def delete(self, result_id: str) -> bool:
        return bool(self._client.delete(TABLE, params=self._scope_params({"id": f"eq.{result_id}"})))
