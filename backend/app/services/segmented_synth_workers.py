"""分段项目音频的 workers 版实现（Vercel/CF，无 sqlalchemy / ffmpeg）。

segmented_project_service 依赖 ORM（sqlalchemy），workers bundle 不含；
这里提供不依赖 ORM 的轻量实现，供 synthesize/upload/read 端点在
deploy_target=workers 时使用：
- 数据读写走 SegmentedProjectRepository（Supabase PostgREST）
- 音频走 AssetStore（Supabase Storage / R2）
- 合成支持 edge_tts / mimo_tts（纯在线 API，workers 可用；cosyvoice/voxcpm
  依赖本地 SDK/GPU，workers 不支持）

local 模式不走本模块（svc 保持现状，ffmpeg 转码/trim/adjust 不受影响）。
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

from app.core.asset_store import AssetStore
from app.core.config import settings
from app.core.repositories.segmented_projects import SegmentedProjectRepository
from app.services.engine_capabilities import prepare_text_for_engine
from app.schemas.segmented_project import SynthesizeParams

logger = logging.getLogger(__name__)

# 音频在 Supabase Storage 内的 key 前缀（与 local data/segments/... 相对路径同构）
SEGMENT_AUDIO_PREFIX = "data/segments"


def _merge_params(*sources: dict[str, Any] | None) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for s in sources:
        if s:
            for k, v in s.items():
                if v is not None:
                    out[k] = v
    return out


def _flatten_voice_for_synthesis(voice: dict[str, Any] | None) -> dict[str, Any]:
    """提取 voice JSON 里的引擎参数（与 svc 同约定）。"""
    flat: dict[str, Any] = {}
    if not isinstance(voice, dict):
        return flat
    engine = voice.get("engine")
    params = voice.get("params")
    if isinstance(params, dict):
        flat.update({k: v for k, v in params.items() if v is not None})
    if engine:
        flat["engine"] = engine
    return flat


def _find_segment(
    project: dict[str, Any],
    chapter_id: str,
    segment_id: str,
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    """在 ProjectDetail 形状的 project 里定位 chapter/segment。"""
    for ch in project.get("chapters", []):
        if ch.get("id") != chapter_id:
            continue
        for seg in ch.get("segments", []):
            if seg.get("id") == segment_id:
                return ch, seg
    return None


def _audio_key(project_id: str, chapter_id: str, segment_id: str, fmt: str) -> str:
    return f"{SEGMENT_AUDIO_PREFIX}/{project_id}/{chapter_id}/{segment_id}.{fmt}"


async def synthesize_segment_workers(
    repo: SegmentedProjectRepository,
    store: AssetStore,
    *,
    project_id: str,
    chapter_id: str,
    segment_id: str,
    request_params: dict[str, Any] | None,
    text_override: str | None,
    ssml_override: str | None,
    keep_previous: bool,
    force: bool,
    usage_repo: Any | None = None,
) -> dict[str, Any]:
    """workers 版合成：edge-tts → store.put → repo 保存（全量写回）。

    无 ffmpeg：不 trim/不转码/不 adjust；音频原样存（mp3）；时长不探测（None）。
    usage_repo（Phase 3）：合成成功后记录一条 kind='tts' 用量（best-effort）。
    """
    detail = repo.get_project(project_id)
    if detail is None:
        raise LookupError("project_not_found")
    project = detail.model_dump(mode="json") if hasattr(detail, "model_dump") else detail

    found = _find_segment(project, chapter_id, segment_id)
    if found is None:
        raise LookupError("segment_not_found")
    chapter, seg = found

    # 录音锁定：除非 force，否则不覆盖
    audio = seg.get("audio") or {}
    current = audio.get("current", {}) if isinstance(audio, dict) else {}
    if not force and current.get("origin") == "recorded":
        return detail

    chapter_voice = chapter.get("voice") or {}
    seg_voice = seg.get("voice") or {}
    effective = _merge_params(
        _flatten_voice_for_synthesis(chapter_voice),
        _flatten_voice_for_synthesis(seg_voice) if isinstance(seg_voice, dict) else None,
        request_params,
    )
    engine = effective.get("engine") or "edge_tts"
    if engine not in ("edge_tts", "mimo_tts"):
        raise ValueError(
            f"engine '{engine}' not supported in workers mode "
            "(edge_tts / mimo_tts only)"
        )
    effective["engine"] = engine

    try:
        sp = SynthesizeParams(**effective)
    except Exception as e:  # pydantic 校验失败 → 422
        raise ValueError(f"invalid synthesize params: {e}") from e

    # 风格 tag 引擎适配（与 svc 同约定）：mimo 用 instruction
    style = sp.mimo_instruction if engine == "mimo_tts" else None
    text_to_speak = text_override or seg.get("text") or ""
    text_to_speak = prepare_text_for_engine(
        text_to_speak,
        engine=engine,
        emotion=seg.get("emotion"),
        style=style,
        mute_tags=bool(getattr(sp, "mute_tags", False)),
        underscore_to_space=bool(getattr(sp, "underscore_to_space", False)),
        skip_parenthesized=bool(getattr(sp, "skip_parenthesized", False)),
    )
    if ssml_override:
        text_to_speak = ssml_override

    if engine == "edge_tts":
        # edge-tts 合成（与 svc synthesize_with_engine 的 edge 分支同路径）
        from app.api.tts import synthesize_speech_internal

        audio_bytes, native_fmt = synthesize_speech_internal(
            text=text_to_speak,
            edge_voice=sp.edge_voice,
            edge_rate=sp.edge_rate,
            edge_volume=sp.edge_volume,
        )
    else:
        # mimo（纯 API，workers 可用；与 svc 的 mimo 分支同路径，db=None 走 Supabase 配置）
        from app.api.mimo_tts import synthesize_mimo_internal

        audio_bytes, native_fmt = synthesize_mimo_internal(
            text=text_to_speak,
            mimo_mode=sp.mimo_mode,
            preset_voice=sp.mimo_preset_voice,
            clone_voice_id=sp.mimo_clone_voice_id,
            voice_description=sp.mimo_voice_description,
            instruction=sp.mimo_instruction,
            context=getattr(sp, "context", None),
            db=None,
        )
    fmt = native_fmt or "mp3"
    ref = await store.put(_audio_key(project_id, chapter_id, segment_id, fmt), audio_bytes)

    # 更新 segment audio（current 降级 previous 保留用于撤销）
    # 注意：status 是前端派生字段（基于 audio 判断），后端不存
    prev_current = current if current.get("path") or current.get("id") else None
    seg["audio"] = {
        "format": fmt,
        "current": {"path": ref, "origin": "tts"},
        **({"previous": prev_current} if (prev_current and keep_previous) else {}),
    }
    seg["generated_params"] = {k: v for k, v in effective.items() if v is not None}

    # 全量写回（Supabase 仓储 save_project 语义）
    saved = repo.save_project(_to_project_in(project))
    if usage_repo is not None:
        # Phase 3 用量计量：kind='tts'，chars=合成文本字符数（best-effort）
        usage_repo.record_event(
            kind="tts",
            chars=len(text_override or seg.get("text") or ""),
            project_id=project_id,
        )
    return saved.model_dump(mode="json") if hasattr(saved, "model_dump") else saved


async def upload_segment_audio_workers(
    repo: SegmentedProjectRepository,
    store: AssetStore,
    *,
    project_id: str,
    chapter_id: str,
    segment_id: str,
    audio_bytes: bytes,
    filename: str,
    duration_sec: float | None,
) -> dict[str, Any]:
    """workers 版录音上传：原样存（无 ffmpeg 转码），origin='recorded' 锁定。"""
    detail = repo.get_project(project_id)
    if detail is None:
        raise LookupError("project_not_found")
    project = detail.model_dump(mode="json") if hasattr(detail, "model_dump") else detail

    found = _find_segment(project, chapter_id, segment_id)
    if found is None:
        raise LookupError("segment_not_found")
    chapter, seg = found

    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "mp3").lower()
    if ext not in ("mp3", "wav", "webm", "ogg", "m4a"):
        ext = "mp3"
    ref = await store.put(
        _audio_key(project_id, chapter_id, segment_id, f"rec-{uuid.uuid4().hex[:8]}.{ext}"),
        audio_bytes,
    )

    prev_current = (seg.get("audio") or {}).get("current") if isinstance(seg.get("audio"), dict) else None
    seg["audio"] = {
        "format": ext,
        "current": {"path": ref, "origin": "recorded", **({"duration_sec": duration_sec} if duration_sec else {})},
        **({"previous": prev_current} if prev_current else {}),
    }

    saved = repo.save_project(_to_project_in(project))
    return saved.model_dump(mode="json") if hasattr(saved, "model_dump") else saved


async def get_segment_audio_workers(
    repo: SegmentedProjectRepository,
    store: AssetStore,
    *,
    project_id: str,
    chapter_id: str,
    segment_id: str,
) -> bytes | None:
    """workers 版读取：repo 定位 segment → store.get(ref)。"""
    detail = repo.get_project(project_id)
    if detail is None:
        return None
    project = detail.model_dump(mode="json") if hasattr(detail, "model_dump") else detail
    found = _find_segment(project, chapter_id, segment_id)
    if found is None:
        return None
    _ch, seg = found
    audio = seg.get("audio") or {}
    current = audio.get("current", {}) if isinstance(audio, dict) else {}
    ref = current.get("path")
    if not ref:
        return None
    return await store.get(ref)


def _to_project_in(project: dict[str, Any]):
    """ProjectDetail(dict) → ProjectIn（save_project 入参）。

    仓储 save_project 接受 ProjectIn（pydantic）；字段对齐即可。
    """
    from app.schemas.segmented_project import ChapterIn, ProjectIn, SegmentIn

    return ProjectIn(
        id=project["id"],
        name=project.get("name", ""),
        schema_version=project.get("schema_version", 2),
        layout=project.get("layout", "vertical"),
        original_text=project.get("original_text"),
        active_chapter_id=project.get("active_chapter_id"),
        configs=project.get("configs") or {},
        chapters=[
            ChapterIn(
                id=ch["id"],
                position=ch.get("position", 0),
                name=ch.get("name", ""),
                voice=ch.get("voice") or {},
                split_config=ch.get("split_config") or {"delimiters": ["。"], "mode": "rule"},
                original_text=ch.get("original_text"),
                narration_script=ch.get("narration_script"),
                design_title=ch.get("design_title"),
                segments=[
                    SegmentIn(
                        id=s["id"],
                        position=s.get("position", 0),
                        text=s.get("text", ""),
                        emotion=s.get("emotion"),
                        role_id=s.get("role_id"),
                        segment_kind=s.get("segment_kind", "narration"),
                        voice=s.get("voice") or {"source": "chapter"},
                        generated_params=s.get("generated_params"),
                        audio=s.get("audio"),
                        animation_spec=s.get("animation_spec"),
                        created_at=s.get("created_at"),
                        updated_at=s.get("updated_at"),
                    )
                    for s in ch.get("segments", [])
                ],
                created_at=ch.get("created_at"),
                updated_at=ch.get("updated_at"),
            )
            for ch in project.get("chapters", [])
        ],
        created_at=project.get("created_at"),
        updated_at=project.get("updated_at"),
    )
