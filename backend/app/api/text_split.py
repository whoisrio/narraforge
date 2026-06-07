"""文本拆分与 SSML 标注 API。"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.text_split_service import (
    rule_split,
    llm_split,
    ssml_annotate,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ---- Request / Response Models ----

class RuleSplitRequest(BaseModel):
    text: str = Field(..., min_length=1, description="待拆分文本")
    delimiters: list[str] = Field(
        default_factory=lambda: ["，", "。", "！", "？"],
        description="分隔符列表",
    )


class RuleSplitResponse(BaseModel):
    segments: list[str]


class LLMSplitRequest(BaseModel):
    text: str = Field(..., min_length=1)
    delimiters: list[str] | None = None


class LLMSplitSegmentItem(BaseModel):
    text: str
    reason: str
    emotion: str = "neutral"


class LLMSplitResponse(BaseModel):
    segments: list[LLMSplitSegmentItem]
    model: str | None


class SSMLAnnotateRequest(BaseModel):
    texts: list[str] = Field(..., min_length=1)
    style_hint: str = ""


class SSMLAnnotationItem(BaseModel):
    text: str
    ssml: str
    rationale: str


class SSMLAnnotateResponse(BaseModel):
    annotations: list[SSMLAnnotationItem]
    model: str | None


# ---- Endpoints ----

@router.post("/rule", response_model=RuleSplitResponse)
def split_rule(req: RuleSplitRequest):
    """按指定标点切分文本。纯本地，无 LLM 依赖。"""
    try:
        segments = rule_split(req.text, req.delimiters)
        return RuleSplitResponse(segments=segments)
    except Exception as e:
        logger.exception("rule_split failed")
        raise HTTPException(status_code=500, detail=f"拆分失败: {e}")


@router.post("/llm", response_model=LLMSplitResponse)
def split_llm(req: LLMSplitRequest, db: Session = Depends(get_db)):
    """LLM 智能语义拆分。"""
    try:
        result = llm_split(req.text, req.delimiters, db=db)
        return LLMSplitResponse(
            segments=[LLMSplitSegmentItem(**s) for s in result.segments],
            model=result.model,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.exception("llm_split failed")
        raise HTTPException(status_code=500, detail=f"智能拆分失败: {e}")


@router.post("/ssml-annotate", response_model=SSMLAnnotateResponse)
def annotate_ssml(req: SSMLAnnotateRequest, db: Session = Depends(get_db)):
    """LLM 为每段加 SSML 标签。"""
    try:
        result = ssml_annotate(req.texts, req.style_hint, db=db)
        return SSMLAnnotateResponse(
            annotations=[SSMLAnnotationItem(**a) for a in result.annotations],
            model=result.model,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.exception("ssml_annotate failed")
        raise HTTPException(status_code=500, detail=f"SSML 标注失败: {e}")
