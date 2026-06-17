"""FastAPI routes for narration documents (P2 v2)."""
from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.narration import NarrationDocument
from app.models.segmented_project import SegmentedProject
from app.schemas.segmented_project import (
    GenerateNarrationRequest,
    NarrationDocumentOut,
    NarrationListItem,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# H2 标题正则: 行首 ## 后接空格 + 标题
H2_RE = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)


def _to_iso(value: datetime | None) -> str:
    if value is None:
        return ""
    return value.isoformat()


def _parse_chapters_from_markdown(body: str) -> list[dict[str, Any]]:
    """从 ## 切章节: 返回 [{chapter_index, title, start_char, end_char}]."""
    matches = list(H2_RE.finditer(body))
    chapters: list[dict[str, Any]] = []
    for idx, m in enumerate(matches):
        start = m.start()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(body)
        title = m.group(1).strip()
        # 跳过 "第 N 章 ·" 之后的部分, 保留更纯的主题
        chapters.append({
            "chapter_index": idx,
            "title": title,
            "start_char": start,
            "end_char": end,
        })
    return chapters


def _next_version(existing: list[str]) -> str:
    """从现有版本号算下一个 major 版本. v1, v2 → v3."""
    majors: list[int] = []
    for v in existing:
        m = re.match(r"^v(\d+)", v)
        if m:
            majors.append(int(m.group(1)))
    return f"v{(max(majors) + 1) if majors else 1}"


def _narration_to_out(n: NarrationDocument) -> NarrationDocumentOut:
    return NarrationDocumentOut(
        id=n.id,
        project_id=n.project_id,
        version=n.version,
        version_kind=n.version_kind,
        body_markdown=n.body_markdown,
        word_count=n.word_count,
        source_ids=json.loads(n.source_ids_json or "[]"),
        prompt_hint=n.prompt_hint,
        settings=json.loads(n.settings_json or "{}"),
        chapter_slices=json.loads(n.chapter_slices_json or "[]"),
        generated_at=_to_iso(n.generated_at),
    )


# ---- endpoints ----

@router.get(
    "/projects/{project_id}/narrations",
    response_model=list[NarrationListItem],
)
def list_narrations(project_id: str, db: Session = Depends(get_db)):
    """列出项目所有旁白版本 (轻量, 不含 body_markdown)."""
    rows = (
        db.query(NarrationDocument)
        .filter_by(project_id=project_id)
        .order_by(NarrationDocument.generated_at.desc())
        .all()
    )
    return [
        NarrationListItem(
            id=n.id,
            version=n.version,
            version_kind=n.version_kind,
            word_count=n.word_count,
            source_ids=json.loads(n.source_ids_json or "[]"),
            generated_at=_to_iso(n.generated_at),
        )
        for n in rows
    ]


@router.get(
    "/projects/{project_id}/narrations/{version}",
    response_model=NarrationDocumentOut,
)
def get_narration(project_id: str, version: str, db: Session = Depends(get_db)):
    """取一个版本完整内容."""
    n = (
        db.query(NarrationDocument)
        .filter_by(project_id=project_id, version=version)
        .first()
    )
    if n is None:
        raise HTTPException(status_code=404, detail="narration_not_found")
    return _narration_to_out(n)


@router.post(
    "/projects/{project_id}/narrations/generate",
    response_model=NarrationDocumentOut,
    status_code=201,
)
def generate_narration(
    project_id: str,
    body: GenerateNarrationRequest,
    db: Session = Depends(get_db),
):
    """Skill 推送旁白文档入口.

    接收已写好的 body_markdown (LLM 已生成) + chapter_slices (skill 已解析),
    写入 narration_documents 表, 同时把切片回填到 chapter.narration_* 字段.

    章节切分优先用 body.chapter_slices (skill 解析), 缺则后端 fallback 用 ## 解析.
    """
    # 1. 项目必须存在
    proj = db.query(SegmentedProject).filter_by(id=project_id).first()
    if proj is None:
        raise HTTPException(status_code=404, detail="project_not_found")

    # 2. 算版本号 (skill 可通过 settings.version 显式指定, 否则自动递增)
    existing_versions = [
        v[0] for v in
        db.query(NarrationDocument.version).filter_by(project_id=project_id).all()
    ]
    settings_dict = body.settings.model_dump() if body.settings else {}
    explicit_version = settings_dict.get("version")
    version = explicit_version or _next_version(existing_versions)
    settings_dict["version"] = version
    body.settings = body.settings.__class__(**settings_dict)

    # 3. 解析 chapters
    if body.chapter_slices and len(body.chapter_slices) > 0:
        chapters = [{
            "chapter_index": c.chapter_index,
            "title": c.title,
            "start_char": c.start_char,
            "end_char": c.end_char,
        } for c in body.chapter_slices]
    else:
        # fallback: 后端按 ## 解析
        chapters = _parse_chapters_from_markdown(body.body_markdown)

    # 4. 字数统计 (粗略: 中文字符数)
    word_count = sum(1 for c in body.body_markdown if c.strip() and ord(c) > 127)

    # 5. 写库
    settings_json_str = json.dumps(body.settings.model_dump() if body.settings else {}, ensure_ascii=False)
    narr = NarrationDocument(
        id=f"narr_{uuid.uuid4().hex[:12]}",
        project_id=project_id,
        version=version,
        version_kind="full",
        body_markdown=body.body_markdown,
        word_count=word_count,
        source_ids_json=json.dumps(body.source_ids, ensure_ascii=False),
        prompt_hint=body.prompt_hint,
        settings_json=settings_json_str,
        chapter_slices_json=json.dumps(chapters, ensure_ascii=False),
    )
    db.add(narr)

    # 6. 回填到 chapters 表 (按 position 顺序配对 sorted_slices)
    sorted_slices = sorted(chapters, key=lambda s: s.get("chapter_index", 0))
    for ch, slice_data in zip(proj.chapters, sorted_slices):
        ch.narration_document_id = narr.id
        ch.narration_version = version
        ch.narration_slice_start = slice_data["start_char"]
        ch.narration_slice_end = slice_data["end_char"]
        ch.narration_synced_at = datetime.utcnow()

    # 7. 设 project.active_narration_version
    setattr(proj, "active_narration_version", version)

    try:
        db.commit()
        db.refresh(narr)
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"narration_already_exists: {version}")

    logger.info(f"created narration {narr.id} v{version} for project {project_id}: {word_count} chars, {len(chapters)} chapters")
    return _narration_to_out(narr)


@router.delete(
    "/projects/{project_id}/narrations/{version}",
    status_code=204,
)
def delete_narration(project_id: str, version: str, db: Session = Depends(get_db)):
    """删除一个旁白版本 (LRU 清理用)."""
    n = (
        db.query(NarrationDocument)
        .filter_by(project_id=project_id, version=version)
        .first()
    )
    if n is None:
        raise HTTPException(status_code=404, detail="narration_not_found")
    db.delete(n)
    # 若删的是 active, 清空
    proj = db.query(SegmentedProject).filter_by(id=project_id).first()
    if proj and getattr(proj, "active_narration_version", None) == version:
        setattr(proj, "active_narration_version", None)
        # 清空 chapter.narration_* 字段
        for ch in proj.chapters:
            ch.narration_document_id = None
            ch.narration_version = None
            ch.narration_slice_start = None
            ch.narration_slice_end = None
            ch.narration_synced_at = None
    db.commit()
    return None
