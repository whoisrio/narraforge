"""文本拆分与 SSML 标注 API。"""

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.text_split_service import (
    rule_split,
    llm_split,
    ssml_annotate,
    markdown_detect,
    markdown_split,
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
    min_len_to_merge: int = Field(
        default=5,
        ge=0,
        description="短段合并阈值：当前段 < 此值时，尝试与下一段合并；0 为关闭合并",
    )
    next_max_len_to_merge: int = Field(
        default=15,
        ge=0,
        description="合并时下一段长度上限：下一段 < 此值才能合并",
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
    """按指定标点切分文本。纯本地，无 LLM 依赖。

    后置短段合并：当一段长度少于 ``min_len_to_merge`` 且下一段长度少于
    ``next_max_len_to_merge`` 时，将两段并入同一行，以避免逗号密集衍生的碎片段。
    """
    try:
        segments = rule_split(
            req.text,
            req.delimiters,
            min_len_to_merge=req.min_len_to_merge,
            next_max_len_to_merge=req.next_max_len_to_merge,
        )
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


# ---- Markdown 检测 + 切分 (P2 v3+) ----

class MarkdownHeadingItem(BaseModel):
    level: int
    raw: str
    title: str
    char_pos: int
    is_chinese_chapter: bool = False
    preview: str | None = None


class MarkdownChapterItem(BaseModel):
    index: int
    title: str
    level: int
    start_char: int
    end_char: int
    char_count: int
    preview: str | None = None


class MarkdownDetectRequest(BaseModel):
    text: str = Field(..., min_length=1, description="markdown 全文")
    min_chars: int = Field(default=80, ge=0, description="短章合并阈值 (字符)")
    front_matter_mode: Literal["prepend_to_first", "own_chapter", "skip"] = Field(
        default="prepend_to_first",
        description="首个标题前的内容怎么处理",
    )


class MarkdownDetectResponse(BaseModel):
    doc_title: str | None
    candidates: list[MarkdownHeadingItem]            # 全部 H1-H6 候选
    chapters: list[MarkdownChapterItem]              # 默认推荐 (H2 + 短章合并)
    total_chars: int


class MarkdownSplitRequest(BaseModel):
    text: str = Field(..., min_length=1)
    levels: list[int] = Field(default=[2], description="用哪些层级当章节边界, e.g. [2] 或 [1, 2]")
    min_chars: int = Field(default=80, ge=0)
    front_matter_mode: Literal["prepend_to_first", "own_chapter", "skip"] = "prepend_to_first"


class MarkdownSplitResponse(BaseModel):
    doc_title: str | None
    chapters: list[MarkdownChapterItem]
    total_chars: int
    used_levels: list[int]


@router.post("/markdown-detect", response_model=MarkdownDetectResponse)
def detect_markdown(req: MarkdownDetectRequest):
    """仅检测, 不切. 返回全部 H1-H6 候选 + 默认推荐章节 (H2 切 + 短章合并).

    后端不决定粒度 — UI 让用户挑 levels 再调 /markdown-split.
    """
    try:
        result = markdown_detect(
            req.text,
            min_chars=req.min_chars,
            front_matter_mode=req.front_matter_mode,
        )
        return MarkdownDetectResponse(**result)
    except Exception as e:
        logger.exception("markdown_detect failed")
        raise HTTPException(status_code=500, detail=f"markdown 检测失败: {e}")


@router.post("/markdown-split", response_model=MarkdownSplitResponse)
def split_markdown(req: MarkdownSplitRequest):
    """按用户指定的 levels 切分. 返回 flat 章节列表 (不嵌套).

    levels: 例如 [2] 只用 H2 切; [1, 2] H1+H2 都切 (H1 仍作 doc_title, 不作章节).
    """
    if not req.levels or any(l < 1 or l > 6 for l in req.levels):
        raise HTTPException(status_code=400, detail="levels 必须在 1-6 之间")
    try:
        chapters = markdown_split(
            req.text,
            levels=req.levels,
            min_chars=req.min_chars,
            front_matter_mode=req.front_matter_mode,
        )
        # 拿 doc_title (走 detect 一遍取)
        full = markdown_detect(req.text, min_chars=req.min_chars, front_matter_mode=req.front_matter_mode)
        return MarkdownSplitResponse(
            doc_title=full.get("doc_title"),
            chapters=chapters,
            total_chars=len(req.text),
            used_levels=req.levels,
        )
    except Exception as e:
        logger.exception("markdown_split failed")
        raise HTTPException(status_code=500, detail=f"markdown 切分失败: {e}")
