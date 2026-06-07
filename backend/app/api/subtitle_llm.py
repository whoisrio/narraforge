"""字幕 LLM 服务 API — 校准 + 双语翻译"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional
from sqlalchemy.orm import Session

from app.services.llm_subtitle_service import (
    correct_subtitles,
    translate_subtitles,
    build_bilingual_srt,
)
from app.core.config import settings
from app.core.database import get_db

router = APIRouter()


# ---- Request / Response Models ----

class CorrectionRequest(BaseModel):
    srt_content: str = Field(..., description="SRT 字幕内容")
    original_document: str = Field(..., description="原始文稿/脚本（用于对比校准）")
    language: str = Field("zh", description="字幕语言代码")
    mode: str = Field("smart", description="校准模式: smart=本地预筛+LLM复验, full=全量LLM")


class SuggestionItem(BaseModel):
    index: int
    original: str
    suggested: str
    reason: str
    confidence: str


class CorrectionResponse(BaseModel):
    suggestions: list[SuggestionItem]
    model: str | None


class TranslationRequest(BaseModel):
    srt_content: str = Field(..., description="SRT 字幕内容")
    target_language: str = Field("English", description="目标翻译语言")
    source_language: str = Field("Chinese", description="源语言")


class BilingualSegmentItem(BaseModel):
    index: int
    time_line: str
    original: str
    translated: str


class TranslationResponse(BaseModel):
    segments: list[BilingualSegmentItem]
    bilingual_srt: str
    target_language: str
    model: str | None


# ---- Endpoints ----

@router.post("/correct", response_model=CorrectionResponse)
async def subtitle_correct(req: CorrectionRequest, db: Session = Depends(get_db)):
    """LLM 字幕校准 — 对比原始文稿，找出 ASR 识别的错别字，返回修改建议。

    只改错别字，不改变内容意思，不破坏时间轴。
    """
    if not req.srt_content.strip():
        raise HTTPException(status_code=400, detail="SRT 内容不能为空")
    if not req.original_document.strip():
        raise HTTPException(status_code=400, detail="请提供原始文稿用于对比校准")
    try:
        result = correct_subtitles(
            srt_content=req.srt_content,
            original_document=req.original_document,
            language=req.language,
            mode=req.mode,
            db=db,
        )
        return CorrectionResponse(
            suggestions=[
                SuggestionItem(
                    index=s.index,
                    original=s.original,
                    suggested=s.suggested,
                    reason=s.reason,
                    confidence=s.confidence,
                )
                for s in result.suggestions
            ],
            model=result.model,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"校准失败: {e}")


@router.post("/translate", response_model=TranslationResponse)
async def subtitle_translate(req: TranslationRequest, db: Session = Depends(get_db)):
    """双语字幕翻译 — 将 SRT 字幕翻译为目标语言，返回双语结果。"""
    if not req.srt_content.strip():
        raise HTTPException(status_code=400, detail="SRT 内容不能为空")
    try:
        result = translate_subtitles(
            srt_content=req.srt_content,
            target_language=req.target_language,
            source_language=req.source_language,
            db=db,
        )
        bilingual_srt = build_bilingual_srt(result)
        return TranslationResponse(
            segments=[
                BilingualSegmentItem(
                    index=s.index,
                    time_line=s.time_line,
                    original=s.original,
                    translated=s.translated,
                )
                for s in result.segments
            ],
            bilingual_srt=bilingual_srt,
            target_language=result.target_language,
            model=result.model,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"翻译失败: {e}")


@router.get("/config")
async def get_llm_config(db: Session = Depends(get_db)):
    """返回当前 LLM 配置（不泄露 API Key）。"""
    api_key, base_url, model = "", "", settings.llm_model
    try:
        from app.services.llm_subtitle_service import _get_llm_config
        api_key, base_url, model = _get_llm_config(db=db)
    except Exception:
        pass
    return {
        "model": model,
        "base_url": base_url,
        "has_api_key": bool(api_key),
    }
