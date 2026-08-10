"""FastAPI routes for source documents (P2 v2)."""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.core.repositories.deps import get_source_document_repo
from app.core.repositories.source_documents import SourceDocumentRepository
from app.schemas.segmented_project import SourceDocumentIn, SourceDocumentOut

logger = logging.getLogger(__name__)
router = APIRouter()


# ----- 源 CRUD -----

@router.get(
    "/projects/{project_id}/sources",
    response_model=list[SourceDocumentOut],
)
def list_sources(project_id: str, repo: SourceDocumentRepository = Depends(get_source_document_repo)):
    """列出项目所有源."""
    return repo.list(project_id)


@router.post(
    "/projects/{project_id}/sources/paste",
    response_model=SourceDocumentOut,
    status_code=201,
)
def create_paste_source(
    project_id: str,
    body: SourceDocumentIn,
    repo: SourceDocumentRepository = Depends(get_source_document_repo),
):
    """创建粘贴文本源 (source_type='paste')."""
    if body.source_type != "paste":
        raise HTTPException(status_code=400, detail="source_type_must_be_paste")
    if not body.pasted_text or not body.pasted_text.strip():
        raise HTTPException(status_code=400, detail="pasted_text_required")
    try:
        return repo.create_paste(
            project_id,
            title=body.title,
            pasted_text=body.pasted_text,
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post(
    "/projects/{project_id}/sources/audio",
    response_model=SourceDocumentOut,
    status_code=201,
)
async def upload_audio_source(
    project_id: str,
    file: UploadFile = File(...),
    title: str = Form(""),
    repo: SourceDocumentRepository = Depends(get_source_document_repo),
):
    """上传音频源 (source_type='audio'). 支持 mp3/wav/m4a/ogg."""
    # 校验后缀
    filename = file.filename or "upload"
    suffix = Path(filename).suffix.lower()
    if suffix.lstrip(".") not in ("mp3", "wav", "m4a", "ogg"):
        raise HTTPException(status_code=400, detail=f"unsupported_audio_format: {suffix}")
    # 校验大小 (50MB 上限, 临时)
    audio_bytes = await file.read()
    if len(audio_bytes) == 0:
        raise HTTPException(status_code=400, detail="empty_file")
    if len(audio_bytes) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="file_too_large_50mb_max")

    try:
        return repo.create_audio(
            project_id,
            title=title or filename,
            audio_bytes=audio_bytes,
            suffix=suffix,
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except NotImplementedError as e:
        # workers 模式：音频源依赖 R2 资产存储（部署步骤 4）
        raise HTTPException(status_code=501, detail="audio_source_requires_asset_store") from e


@router.delete(
    "/projects/{project_id}/sources/{source_id}",
    status_code=204,
)
def delete_source(
    project_id: str,
    source_id: str,
    repo: SourceDocumentRepository = Depends(get_source_document_repo),
):
    """删除源 (audio 会同时删除磁盘文件)."""
    ok = repo.delete(project_id, source_id)
    if not ok:
        raise HTTPException(status_code=404, detail="source_not_found")
    return None


@router.get("/projects/{project_id}/sources/{source_id}/audio")
def get_source_audio(
    project_id: str,
    source_id: str,
    repo: SourceDocumentRepository = Depends(get_source_document_repo),
):
    """下载/播放音频源文件 (audio 类型才有)."""
    src = repo.get(project_id, source_id)
    if src is None:
        raise HTTPException(status_code=404, detail="source_not_found")
    if src.source_type != "audio" or not src.audio_path:
        raise HTTPException(status_code=400, detail="source_is_not_audio")
    p = Path(src.audio_path)
    if not p.exists():
        raise HTTPException(status_code=410, detail="audio_file_missing")
    # 推断 media type
    suffix = p.suffix.lstrip(".").lower()
    media_type = {
        "mp3": "audio/mpeg",
        "wav": "audio/wav",
        "m4a": "audio/mp4",
        "ogg": "audio/ogg",
    }.get(suffix, "application/octet-stream")
    return FileResponse(path=str(p), media_type=media_type, filename=p.name)
