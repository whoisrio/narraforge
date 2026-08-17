"""SourceDocument 仓储（步骤 3A）。

方法签名提取自 source_document_service + sources.py 路由（YAGNI）。
Local 薄封装 source_document_service（其内部已自行 commit + 写盘/探时长）。

Supabase 实现说明：
- paste 源全链路可用；项目存在性校验（3B 补齐）直接查 segmented_projects 表，
  与 local 的 _ensure_project_exists 对齐（缺项目 → LookupError → 路由 404）。
- audio 源需要二进制资产存储（R2，步骤 4），本步 create_audio 抛
  NotImplementedError，由路由映射为 501。
"""
from __future__ import annotations

import uuid
from typing import Any, Protocol, runtime_checkable

from app.core.supabase_client import SupabaseClient
from app.core.repositories.user_scope import UserScope
from app.schemas.segmented_project import SourceDocumentOut

# workers bundle 不含 sqlalchemy：Local* 只在 local 模式实例化。
try:
    from sqlalchemy.orm import Session

    from app.services import source_document_service as svc
except ImportError:  # workers bundle
    Session = Any  # type: ignore[assignment,misc]
    svc = None  # type: ignore[assignment]

TABLE = "source_documents"


def _row_to_out(row: dict) -> SourceDocumentOut:
    return SourceDocumentOut(
        id=row["id"],
        project_id=row["project_id"],
        source_type=row["source_type"],
        title=row["title"],
        file_path=row.get("file_path"),
        pasted_text=row.get("pasted_text"),
        audio_path=row.get("audio_path"),
        file_size=row.get("file_size"),
        duration_sec=row.get("duration_sec"),
        created_at=row.get("created_at") or "",
    )


@runtime_checkable
class SourceDocumentRepository(Protocol):
    def list(self, project_id: str) -> list[SourceDocumentOut]: ...
    def get(self, project_id: str, source_id: str) -> SourceDocumentOut | None: ...
    def create_paste(self, project_id: str, title: str, pasted_text: str) -> SourceDocumentOut: ...
    def create_audio(
        self,
        project_id: str,
        title: str,
        audio_bytes: bytes,
        suffix: str,
        duration_sec: float | None = None,
    ) -> SourceDocumentOut: ...
    def delete(self, project_id: str, source_id: str) -> bool: ...


class LocalSourceDocumentRepository:
    """委托现有 service 函数（含项目校验、写盘、时长探测、文件清理）。"""

    def __init__(self, db: Session):
        self._db = db

    def list(self, project_id: str) -> list[SourceDocumentOut]:
        return svc.list_sources(self._db, project_id)

    def get(self, project_id: str, source_id: str) -> SourceDocumentOut | None:
        src = svc.get_source(self._db, project_id, source_id)
        return svc.source_to_out(src) if src else None

    def create_paste(self, project_id: str, title: str, pasted_text: str) -> SourceDocumentOut:
        return svc.create_source_paste(self._db, project_id, title, pasted_text)

    def create_audio(
        self,
        project_id: str,
        title: str,
        audio_bytes: bytes,
        suffix: str,
        duration_sec: float | None = None,
    ) -> SourceDocumentOut:
        return svc.create_source_audio(
            self._db, project_id, title, audio_bytes, suffix, duration_sec
        )

    def delete(self, project_id: str, source_id: str) -> bool:
        return svc.delete_source(self._db, project_id, source_id)


class SupabaseSourceDocumentRepository(UserScope):
    """PostgREST 实现。audio 源见模块 docstring。M4：用户归属作用域。

    归属双保险：source 行自身带 user_id 过滤，create 前的项目存在性校验
    也加归属过滤（他人项目 → LookupError → 路由 404）。
    """

    def __init__(self, client: SupabaseClient, owner_id: str | None = None, see_all: bool = False):
        super().__init__(owner_id=owner_id, see_all=see_all)
        self._client = client

    def list(self, project_id: str) -> list[SourceDocumentOut]:
        rows = self._client.select(
            TABLE,
            params=self._scope_params(
                {"project_id": f"eq.{project_id}", "order": "created_at.desc"}
            ),
        )
        return [_row_to_out(row) for row in rows]

    def get(self, project_id: str, source_id: str) -> SourceDocumentOut | None:
        row = self._client.select_one(
            TABLE,
            params=self._scope_params({"id": f"eq.{source_id}", "project_id": f"eq.{project_id}"}),
        )
        return _row_to_out(row) if row else None

    def create_paste(self, project_id: str, title: str, pasted_text: str) -> SourceDocumentOut:
        # 项目存在性 + 归属校验（对齐 local _ensure_project_exists → 路由 404）
        if not self._client.select_one(
            "segmented_projects",
            params=self._scope_params({"id": f"eq.{project_id}", "select": "id"}),
        ):
            raise LookupError(f"project_not_found: {project_id}")
        # 对齐 local：title 为空取正文前 30 字；file_size 为 UTF-8 字节数
        row = self._stamp_row({
            "id": f"src_{uuid.uuid4().hex[:12]}",
            "project_id": project_id,
            "source_type": "paste",
            "title": title or pasted_text[:30].replace("\n", " "),
            "pasted_text": pasted_text,
            "file_size": len(pasted_text.encode("utf-8")),
        })
        inserted = self._client.insert(TABLE, [row])
        return _row_to_out(inserted[0])

    def create_audio(
        self,
        project_id: str,
        title: str,
        audio_bytes: bytes,
        suffix: str,
        duration_sec: float | None = None,
    ) -> SourceDocumentOut:
        raise NotImplementedError(
            "audio sources require the R2 asset store (deploy step 4)"
        )

    def delete(self, project_id: str, source_id: str) -> bool:
        # audio 源的文件清理由 R2 资产存储负责（步骤 4）；本步只删行
        return bool(
            self._client.delete(
                TABLE,
                params=self._scope_params(
                    {"id": f"eq.{source_id}", "project_id": f"eq.{project_id}"}
                ),
            )
        )
