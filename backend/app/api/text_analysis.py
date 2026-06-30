"""智能文稿解析 API — 纯正则 + LLM 增强。"""

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.text_analysis_service import analyze_script

logger = logging.getLogger(__name__)

router = APIRouter()


# ---- Request / Response Models ----

class SplitRequest(BaseModel):
    text: str = Field(..., min_length=1, description="原始文本内容")
    mode: Literal["auto", "script", "article"] = "auto"
    min_occurrences: int = Field(default=2, ge=1, le=10, description="角色出现最低次数阈值")


class SegmentItem(BaseModel):
    text: str
    role: str | None = None
    role_confidence: float = 1.0


class ChapterItem(BaseModel):
    title: str
    segments: list[SegmentItem]


class DetectedRoleItem(BaseModel):
    name: str
    occurrences: int
    confidence: float


class SplitResponse(BaseModel):
    method: str
    chapters: list[ChapterItem]
    detected_roles: list[DetectedRoleItem]


# ---- Endpoints ----

@router.post("/split", response_model=SplitResponse)
def split_script(req: SplitRequest):
    """纯正则拆分：章节识别 + 角色识别 + 台词分配。零配置，不调 LLM。"""
    try:
        result = analyze_script(
            text=req.text,
            mode=req.mode,
            min_occurrences=req.min_occurrences,
        )

        return SplitResponse(
            method=result.method,
            chapters=[
                ChapterItem(
                    title=ch.title,
                    segments=[
                        SegmentItem(
                            text=seg.text,
                            role=seg.role,
                            role_confidence=seg.role_confidence,
                        )
                        for seg in ch.segments
                    ],
                )
                for ch in result.chapters
            ],
            detected_roles=[
                DetectedRoleItem(
                    name=dr.name,
                    occurrences=dr.occurrences,
                    confidence=dr.confidence,
                )
                for dr in result.detected_roles
            ],
        )
    except Exception as e:
        logger.exception("script_split failed")
        raise HTTPException(status_code=500, detail=f"文稿分析失败: {e}")
