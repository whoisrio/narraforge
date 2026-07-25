"""One-shot migration: consolidate voices / tts-history / srt under data/ (PR-B).

Moves:
- clone samples   uploads/voices/<referenced>          -> data/voices/profiles/
- clone previews  output/clone_voices/*                -> data/voices/previews/
- TTS history     uploads/voices/tts_* + uploads/tts_results/* -> data/tts-history/
- srt artifacts   uploads/srt/* + output/srt/*         -> data/srt/
- temp files      uploads/voices/temp_audio_*          -> data/temp/

Rewrites DB path strings accordingly:
- voice_profiles.voice_params[*].source_audio_path  (base_dir-relative)
- voice_profiles.preview.preview_audio_path         (base_dir-relative)
- tts_results.audio_path                            (absolute)
- transcription_records.audio_path                  (absolute)

Two-phase (plan/apply), idempotent; unreferenced orphan files are moved
without DB changes; missing sources are skipped.
"""
from __future__ import annotations

import json
import logging
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.tts_result import TTSResultRecord as TTSResult
from app.models.transcription_record import TranscriptionRecord
from app.models.voice_profile import VoiceProfile

log = logging.getLogger(__name__)


@dataclass
class StoragePlan:
    file_moves: dict[Path, Path] = field(default_factory=dict)   # abs -> abs
    notes: list[str] = field(default_factory=list)


def _move(plan: StoragePlan, src: Path, dst: Path) -> None:
    if src == dst or not src.exists():
        return
    plan.file_moves[src] = dst


def _rel(p: Path) -> str:
    return settings.to_relative(p)


def plan_storage(session: Session) -> StoragePlan:
    plan = StoragePlan()
    profiles_dir = settings.voices_profiles_dir
    previews_dir = settings.voices_previews_dir
    history_dir = settings.tts_history_dir
    srt_dir = settings.srt_output_dir
    temp_dir = settings.temp_dir

    # ── voice profiles: samples + previews (DB-referenced) ──
    for vp in session.query(VoiceProfile).all():
        params = vp.voice_params if isinstance(vp.voice_params, dict) else {}
        for model_vp in params.values():
            if not isinstance(model_vp, dict):
                continue
            raw = model_vp.get("source_audio_path")
            if raw:
                src = settings.resolve_path(raw)
                _move(plan, src, profiles_dir / src.name)
        preview = vp.preview if isinstance(vp.preview, dict) else {}
        raw = preview.get("preview_audio_path")
        if raw:
            src = settings.resolve_path(raw)
            _move(plan, src, previews_dir / src.name)

    # ── orphan files in legacy dirs (same class, no DB ref) ──
    legacy_voices = settings.voices_dir
    if legacy_voices.exists():
        for f in legacy_voices.iterdir():
            if not f.is_file():
                continue
            if f.name.startswith("temp_audio_"):
                _move(plan, f, temp_dir / f.name)
            elif f.name.startswith("tts_"):
                _move(plan, f, history_dir / f.name)
            elif f in plan.file_moves:
                continue
            else:
                _move(plan, f, profiles_dir / f.name)

    legacy_previews = settings.clone_voices_dir
    if legacy_previews.exists():
        for f in legacy_previews.iterdir():
            if f.is_file():
                _move(plan, f, previews_dir / f.name)

    legacy_tts_results = settings.uploads_dir / "tts_results"
    if legacy_tts_results.exists():
        for f in legacy_tts_results.iterdir():
            if f.is_file():
                _move(plan, f, history_dir / f.name)

    for legacy_srt in (settings.uploads_dir / "srt", settings.output_dir / "srt"):
        if legacy_srt.exists():
            for f in legacy_srt.iterdir():
                if f.is_file():
                    _move(plan, f, srt_dir / f.name)

    # ── DB absolute paths: tts_results / transcription_records ──
    for rec in session.query(TTSResult).all():
        if rec.audio_path:
            src = Path(rec.audio_path)
            _move(plan, src, history_dir / src.name)
    for rec in session.query(TranscriptionRecord).all():
        if rec.audio_path:
            src = Path(rec.audio_path)
            _move(plan, src, srt_dir / src.name)

    return plan


def apply_storage(session: Session, plan: StoragePlan) -> None:
    # 1) move files
    moved: dict[Path, Path] = {}
    for src, dst in sorted(plan.file_moves.items(), key=lambda kv: len(str(kv[0]))):
        if not src.exists():
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists():
            src.unlink()  # content already present at destination
        else:
            shutil.move(str(src), str(dst))
        moved[src] = dst

    def remap_abs(p: str | None) -> str | None:
        if not p:
            return p
        return str(moved.get(Path(p), Path(p)))

    def remap_rel(p: str | None) -> str | None:
        if not p:
            return p
        src = settings.resolve_path(p)
        dst = moved.get(src)
        return _rel(dst) if dst else p

    # 2) rewrite DB paths
    for vp in session.query(VoiceProfile).all():
        params = vp.voice_params if isinstance(vp.voice_params, dict) else None
        if params:
            updated = json.loads(json.dumps(params))
            changed = False
            for model_vp in updated.values():
                if isinstance(model_vp, dict) and model_vp.get("source_audio_path"):
                    new = remap_rel(model_vp["source_audio_path"])
                    if new != model_vp["source_audio_path"]:
                        model_vp["source_audio_path"] = new
                        changed = True
            if changed:
                vp.voice_params = updated
        preview = vp.preview if isinstance(vp.preview, dict) else None
        if preview and preview.get("preview_audio_path"):
            new = remap_rel(preview["preview_audio_path"])
            if new != preview["preview_audio_path"]:
                vp.preview = {**preview, "preview_audio_path": new}

    for rec in session.query(TTSResult).all():
        new = remap_abs(rec.audio_path)
        if new != rec.audio_path:
            rec.audio_path = new
    for rec in session.query(TranscriptionRecord).all():
        new = remap_abs(rec.audio_path)
        if new != rec.audio_path:
            rec.audio_path = new

    session.commit()
