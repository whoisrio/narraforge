"""TTS 语音核对（ASR 回读验收）API。

- POST  /tts-verify/verify          单段核对（multipart：音频 + 基准文本 → ASR → 比对）
- POST  /tts-verify/runs            创建核对运行（防重：心跳新鲜的 running run → 409）
- PATCH /tts-verify/runs/{run_id}   进度心跳 / 终态（completed / stopped）
- GET   /tts-verify/runs/latest     页面加载恢复进度 pill（惰性判活）

整个 router 仅 local 模式挂载（main.py）：funasr 是本地模型，workers 上没有；
runs 表是本地 SQLAlchemy 模型，Supabase 仓储不覆盖。比对逻辑唯一实现在
app.services.tts_verify_service（前端只做编排和呈现，不落库——核对结果由
前端写回 segment.verification，运行进度落后端 runs 表）。
"""
from __future__ import annotations

import logging
import os
import tempfile
import time
import uuid
from datetime import timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

# workers bundle 不含 sqlalchemy：Session 仅作注解（Depends 注入不看它）。
try:
    from sqlalchemy.orm import Session
except ImportError:  # workers bundle
    Session = object  # type: ignore[assignment,misc]

from app.core.config import settings
from app.core.database import get_db
from app.core.time_utils import utcnow
from app.services.tts_verify_service import DEFAULT_THRESHOLD, verify_texts

logger = logging.getLogger(__name__)

router = APIRouter()

# 心跳过时阈值：3 × 默认单段核对超时（60s）。超过即判孤儿 run（崩溃/关页）。
HEARTBEAT_STALE_SECONDS = 180

# E2E/CI 测试桩：TTS_VERIFY_STUB=1 时 verify 不跑真实 ASR，回读文本取
# TTS_VERIFY_STUB_TEXT（缺省固定句子）。桩文本与任何正常基准都不同 →
# 全量核对后所有段都判「不一致」，供 E2E 驱动 mismatch/过滤/忽略流程。
STUB_ENV = "TTS_VERIFY_STUB"
STUB_TEXT_ENV = "TTS_VERIFY_STUB_TEXT"
_STUB_TEXT_DEFAULT = "语音核对测试桩回读文本"

_RUN_STATUSES = {"running", "completed", "stopped", "interrupted"}


class VerifyRunCreateIn(BaseModel):
    project_id: str
    scope: str = "project"  # 'chapter' | 'project'
    chapter_id: str | None = None
    total: int = 0


class VerifyRunPatchIn(BaseModel):
    """PATCH /runs/{id}：done 为进度心跳；status 仅 completed/stopped。"""

    done: int | None = None
    status: str | None = None


# ----- 惰性判活（多客户端判定结果一致：读/写路径都会先落库对齐） -----


def _lazily_interrupt_stale_runs(db: Session) -> int:
    """心跳过期的 running run 落库标 interrupted。返回受影响行数。"""
    from app.models.segmented_project import SegmentVerificationRun

    cutoff = utcnow() - timedelta(seconds=HEARTBEAT_STALE_SECONDS)
    stale = (
        db.query(SegmentVerificationRun)
        .filter(
            SegmentVerificationRun.status == "running",
            SegmentVerificationRun.updated_at < cutoff,
        )
        .all()
    )
    if not stale:
        return 0
    now = utcnow()
    for run in stale:
        run.status = "interrupted"
        run.updated_at = now
    db.commit()
    logger.info("[tts-verify] lazily interrupted %d stale run(s)", len(stale))
    return len(stale)


def _run_to_dict(run) -> dict:  # type: ignore[no-untyped-def]
    """run 序列化。时间戳带 'Z' 后缀显式标 UTC——前端快照 pill 按
    updated_at 计算心跳年龄，无时区歧义。"""
    def iso(value):  # type: ignore[no-untyped-def]
        if value is None:
            return None
        text = value.isoformat()
        return text if text.endswith(("Z", "+00:00")) else f"{text}Z"

    return {
        "id": run.id,
        "project_id": run.project_id,
        "scope": run.scope,
        "chapter_id": run.chapter_id,
        "status": run.status,
        "total": run.total,
        "done": run.done,
        "started_at": iso(run.started_at),
        "updated_at": iso(run.updated_at),
    }


# ----- verify：单段核对（音频 multipart 上传，两种存储模式同一条路） -----


def _stub_asr_text() -> str:
    return os.environ.get(STUB_TEXT_ENV) or _STUB_TEXT_DEFAULT


@router.post("/verify")
def verify_endpoint(
    audio: UploadFile | None = File(default=None),
    baseline_text: str = Form(""),
    threshold: float = Form(default=DEFAULT_THRESHOLD),
    engine: str = Form(default="funasr"),
) -> dict:
    """单段语音核对：ASR 回读 + 归一化比对。返回结构化结果，不落库。"""
    if engine != "funasr":
        # 字段先留出来（YAGNI：不做 provider 抽象），未知引擎直接拒绝
        raise HTTPException(status_code=400, detail="invalid_engine")
    if not (0 < threshold <= 1):
        raise HTTPException(status_code=400, detail="invalid_threshold")
    if audio is None:
        raise HTTPException(status_code=400, detail="audio_required")
    if not baseline_text.strip():
        raise HTTPException(status_code=400, detail="baseline_text_required")

    started = time.monotonic()

    if os.environ.get(STUB_ENV) == "1":
        asr_text = _stub_asr_text()
        result = verify_texts(baseline_text, asr_text, threshold=threshold)
        result.update({"asr_text": asr_text, "engine": engine, "device": "stub"})
        result["elapsed_ms"] = int((time.monotonic() - started) * 1000)
        return result

    content = audio.file.read()
    if not content:
        raise HTTPException(status_code=400, detail="audio_required")

    suffix = Path(audio.filename or "audio.mp3").suffix or ".mp3"
    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        from app.services.funasr_service import FunASRService

        service = FunASRService()
        device_arg = settings.funasr_device or None
        try:
            asr_text = service.transcribe_raw(tmp_path, device=device_arg)
        except ImportError:
            # funasr 是本地模型：workers 部署/未安装时明确 503，前端 toast 提示
            raise HTTPException(status_code=503, detail="funasr_unavailable") from None
        device = getattr(service, "last_device", None) or device_arg or "auto"
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:  # pragma: no cover
                pass

    result = verify_texts(baseline_text, asr_text, threshold=threshold)
    result.update({"asr_text": asr_text, "engine": engine, "device": device})
    result["elapsed_ms"] = int((time.monotonic() - started) * 1000)
    return result


# ----- runs：核对运行记录（全局进度持久化 + 防重） -----


@router.post("/runs", status_code=201)
def create_verify_run(body: VerifyRunCreateIn, db: Session = Depends(get_db)) -> dict:  # type: ignore[name-defined]
    """创建核对运行。防重闸门：该项目已存在心跳新鲜的 running run → 409。

    创建前先惰性判定：把心跳过期的 running run 落库标 interrupted 再决定。
    """
    from app.models.segmented_project import SegmentVerificationRun

    if body.scope not in ("chapter", "project"):
        raise HTTPException(status_code=400, detail="invalid_scope")
    if body.scope == "chapter" and not body.chapter_id:
        raise HTTPException(status_code=400, detail="chapter_id_required")

    _lazily_interrupt_stale_runs(db)
    fresh = (
        db.query(SegmentVerificationRun)
        .filter_by(project_id=body.project_id, status="running")
        .first()
    )
    if fresh is not None:
        raise HTTPException(
            status_code=409,
            detail={"code": "verify_run_in_progress", "run": _run_to_dict(fresh)},
        )

    run = SegmentVerificationRun(
        id=f"svr_{uuid.uuid4().hex[:12]}",
        project_id=body.project_id,
        scope=body.scope,
        chapter_id=body.chapter_id,
        status="running",
        total=max(0, body.total),
        done=0,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return _run_to_dict(run)


@router.patch("/runs/{run_id}")
def patch_verify_run(run_id: str, body: VerifyRunPatchIn, db: Session = Depends(get_db)) -> dict:  # type: ignore[name-defined]
    """每完成一段心跳一次（done）；批量正常结束 completed / 用户取消 stopped。"""
    from app.models.segmented_project import SegmentVerificationRun

    if body.status is not None and body.status not in _RUN_STATUSES:
        raise HTTPException(status_code=400, detail="invalid_status")
    run = db.get(SegmentVerificationRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="run_not_found")
    if body.done is not None:
        run.done = max(0, body.done)
    if body.status is not None:
        run.status = body.status
    run.updated_at = utcnow()  # 心跳：即便 PATCH 只带 done 也推进
    db.commit()
    db.refresh(run)
    return _run_to_dict(run)


@router.get("/runs/latest")
def latest_verify_run(
    project_id: str = "", db: Session = Depends(get_db)  # type: ignore[name-defined]
) -> dict:
    """页面加载时恢复进度 pill。

    后端读时惰性判定：running 但心跳过期 → 落库标 interrupted 再返回，
    多客户端判断结果一致。
    """
    from app.models.segmented_project import SegmentVerificationRun

    if not project_id:
        raise HTTPException(status_code=400, detail="project_id_required")
    _lazily_interrupt_stale_runs(db)
    run = (
        db.query(SegmentVerificationRun)
        .filter_by(project_id=project_id)
        .order_by(SegmentVerificationRun.started_at.desc(), SegmentVerificationRun.id.desc())
        .first()
    )
    return {"run": _run_to_dict(run) if run else None}
