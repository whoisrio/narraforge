#!/usr/bin/env python3
"""真实引擎 E2E 冒烟：chapter 音频变速（edge_tts 真实网络 + 真实 ffmpeg）。

覆盖场景：
1. 建 project/chapter/3 segments，edge_tts 真实合成；
2. adjust 1.5x：current.duration_sec ≈ ffprobe 实测（<50ms），且明显变短；
3. 中间插入第 4 段并合成：继承 chapter 的 1.5x，previous stash 存在；
4. 第 1 段上传录音（edge_tts 生成音频充当），再次 adjust 0.8x：
   录音段字节不变（D1）、skipped_recorded == 1，其余段从原始重渲染；
5. 恒等还原：录音段不变，其余段恢复原始时长；
6. 再设 1.5x 后导出（concat mp3 + SRT）：SRT 每 cue 时长 ≈ 对应文件实测
   （<50ms）、时间轴严格连续、SRT 总时长 ≈ 拼接 mp3 实测（<200ms）。

隔离：全程使用临时目录（SQLite DB + assets 根 + 导出目录），不碰
backend/voice_clone.db 与 backend/data/，结束清理临时目录。

运行：cd backend && uv run python scripts/smoke_audio_adjust.py
"""
from __future__ import annotations

import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

# --- 隔离：临时目录 + 独立 SQLite，必须在 import app 之前设好环境变量 ---
TMP = Path(tempfile.mkdtemp(prefix="smoke_audio_adjust_"))
os.environ["DATABASE_URL"] = f"sqlite:///{TMP}/smoke.db"

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.core import config  # noqa: E402
from app.core.audio_encoder import probe_audio_duration  # noqa: E402
from app.core.database import Base  # noqa: E402
from app.models.segmented_project import (  # noqa: E402
    SegmentedProjectChapter,
    SegmentedProjectSegment,
)
from app.schemas.segmented_project import ProjectIn  # noqa: E402
from app.services import segmented_project_service as svc  # noqa: E402

ASSETS = TMP / "assets"
EXPORT = TMP / "export"
# 与 tests/test_adjust_audio.py fixture 相同的手法：直接改 settings 单例
config.settings.segmented_dir = ASSETS
ASSETS.mkdir(parents=True, exist_ok=True)
EXPORT.mkdir(parents=True, exist_ok=True)

engine = create_engine(f"sqlite:///{TMP}/smoke.db", connect_args={"check_same_thread": False})
Base.metadata.create_all(bind=engine)
db = sessionmaker(autocommit=False, autoflush=False, bind=engine)()

EDGE_VOICE = "zh-CN-XiaoxiaoNeural"
REC_VOICE = "zh-CN-YunxiNeural"  # 录音用不同音色，便于区分

FAILED = []


def check(name: str, cond: bool, detail: str) -> None:
    tag = "OK  " if cond else "FAIL"
    print(f"    [{tag}] {name}: {detail}")
    if not cond:
        FAILED.append(f"{name}: {detail}")


def seg_row(sid: str) -> SegmentedProjectSegment:
    db.expire_all()
    return db.query(SegmentedProjectSegment).filter_by(id=sid).one()


def cur_info(sid: str) -> tuple[Path, float, float]:
    """Return (abs current file, stored duration_sec, ffprobe duration)."""
    audio = seg_row(sid).audio
    rel = audio["current"]["path"]
    abs_path = config.settings.segmented_dir / rel
    stored = audio["current"]["duration_sec"]
    probed = probe_audio_duration(abs_path)
    assert probed is not None, f"ffprobe failed for {abs_path}"
    return abs_path, stored, probed


def fmt_size(p: Path) -> str:
    return f"{p.stat().st_size / 1024:.1f}KB"


def synthesize(sid: str) -> None:
    svc.synthesize_segment(db, "p1", "c1", sid)


SRT_TS = re.compile(
    r"(\d+):(\d+):(\d+),(\d+)\s+-->\s+(\d+):(\d+):(\d+),(\d+)"
)


def parse_srt(path: Path) -> list[tuple[float, float]]:
    cues = []
    for m in SRT_TS.finditer(path.read_text(encoding="utf-8")):
        g = [int(x) for x in m.groups()]
        start = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000
        end = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000
        cues.append((start, end))
    return cues


def main() -> int:
    # ---- 1. 建项目 + 3 段 ----
    print("== step 1: create project p1/c1 with 3 segments ==")
    svc.save_project(db, ProjectIn(
        id="p1", name="冒烟项目", schema_version=2, layout="vertical",
        configs={"export_directory": str(EXPORT)},
        chapters=[{
            "id": "c1", "position": 0, "name": "第一章",
            "voice": {"engine": "edge_tts", "voice": EDGE_VOICE},
            "split_config": {"delimiters": ["。"], "mode": "rule"},
            "segments": [
                {"id": "s1", "position": 0, "text": "春眠不觉晓，处处闻啼鸟。", "voice": {"source": "chapter"}},
                {"id": "s2", "position": 1, "text": "夜来风雨声，花落知多少。", "voice": {"source": "chapter"}},
                {"id": "s3", "position": 2, "text": "白日依山尽，黄河入海流。", "voice": {"source": "chapter"}},
            ],
        }],
    ))
    db.commit()

    # ---- 2. 真实 edge_tts 合成 3 段 ----
    print("== step 2: synthesize s1..s3 via real edge_tts ==")
    for sid in ("s1", "s2", "s3"):
        synthesize(sid)
        p, stored, probed = cur_info(sid)
        print(f"    {sid}: file={fmt_size(p)} stored={stored:.3f}s probed={probed:.3f}s")
        check(f"synth {sid} stored≈probed", abs(stored - probed) < 0.05,
              f"|{stored:.3f}-{probed:.3f}|={abs(stored - probed)*1000:.0f}ms")
    orig = {sid: cur_info(sid)[2] for sid in ("s1", "s2", "s3")}

    # ---- 3. adjust 1.5x ----
    print("== step 3: adjust_chapter_audio tempo=1.5 ==")
    r = svc.adjust_chapter_audio(db, "p1", "c1", tempo=1.5)
    print(f"    result: adjusted={r['adjusted']} skipped_recorded={r['skipped_recorded']}")
    check("adjusted == 3", r["adjusted"] == 3, f"got {r['adjusted']}")
    for sid in ("s1", "s2", "s3"):
        p, stored, probed = cur_info(sid)
        expect = orig[sid] / 1.5
        print(f"    {sid}: orig={orig[sid]:.3f}s -> probed={probed:.3f}s "
              f"(expect≈{expect:.3f}s) stored={stored:.3f}s file={fmt_size(p)}")
        check(f"1.5x {sid} stored≈probed", abs(stored - probed) < 0.05,
              f"diff={abs(stored - probed)*1000:.0f}ms")
        check(f"1.5x {sid} probed≈orig/1.5", abs(probed - expect) < 0.1,
              f"diff={abs(probed - expect)*1000:.0f}ms")

    # ---- 4. 中间插入 s4 并合成：应继承 1.5x ----
    print("== step 4: insert s4 at position 1 and synthesize ==")
    svc.save_project(db, ProjectIn(
        id="p1", name="冒烟项目", schema_version=2, layout="vertical",
        configs={"export_directory": str(EXPORT)},
        chapters=[{
            "id": "c1", "position": 0, "name": "第一章",
            "voice": {"engine": "edge_tts", "voice": EDGE_VOICE},
            "split_config": {"delimiters": ["。"], "mode": "rule"},
            "segments": [
                {"id": "s1", "position": 0, "text": "春眠不觉晓，处处闻啼鸟。", "voice": {"source": "chapter"}},
                {"id": "s4", "position": 1, "text": "欲穷千里目，更上一层楼。", "voice": {"source": "chapter"}},
                {"id": "s2", "position": 2, "text": "夜来风雨声，花落知多少。", "voice": {"source": "chapter"}},
                {"id": "s3", "position": 3, "text": "白日依山尽，黄河入海流。", "voice": {"source": "chapter"}},
            ],
        }],
    ))
    db.commit()
    # save_project 后 chapter 的 1.5x 记录必须还在（D6：payload 不能覆盖）
    ch = db.query(SegmentedProjectChapter).filter_by(id="c1").one()
    check("audio_adjust survives save_project", (ch.audio_adjust or {}).get("tempo") == 1.5,
          f"audio_adjust={ch.audio_adjust}")
    synthesize("s4")
    audio4 = seg_row("s4").audio
    p4, stored4, probed4 = cur_info("s4")
    prev4 = audio4.get("previous") or {}
    prev4_d = prev4.get("duration_sec")
    print(f"    s4: probed={probed4:.3f}s prev_stash_duration={prev4_d:.3f}s "
          f"prev_path={prev4.get('path')} file={fmt_size(p4)}")
    check("s4 previous stash exists", bool(prev4.get("path")) and prev4_d is not None,
          f"previous={prev4}")
    check("s4 inherited 1.5x", prev4_d is not None and abs(probed4 - prev4_d / 1.5) < 0.1,
          f"probed={probed4:.3f} vs prev/1.5={prev4_d / 1.5 if prev4_d else None}")
    check("s4 stored≈probed", abs(stored4 - probed4) < 0.05,
          f"diff={abs(stored4 - probed4)*1000:.0f}ms")

    # ---- 5. s1 上传录音（edge_tts 生成音频充当）----
    print("== step 5: upload recording for s1 (edge_tts-generated) ==")
    from app.api.tts import synthesize_speech_internal
    rec_bytes, _fmt = synthesize_speech_internal(
        text="这一段是我亲自录制的旁白，请保留原速。",
        voice_id="", edge_voice=REC_VOICE,
    )
    svc.save_recorded_segment_audio(
        db, "p1", "c1", "s1", audio_bytes=rec_bytes, filename="take.mp3",
    )
    rec_path, rec_stored, rec_probed = cur_info("s1")
    rec_file_bytes = rec_path.read_bytes()
    rec_origin = seg_row("s1").audio["current"].get("origin")
    print(f"    s1 recorded: origin={rec_origin} duration={rec_probed:.3f}s file={fmt_size(rec_path)}")
    check("s1 origin == recorded", rec_origin == "recorded", f"origin={rec_origin}")

    # ---- 6. adjust 0.8x：录音段必须原样保留 ----
    print("== step 6: adjust_chapter_audio tempo=0.8 (recorded exempt) ==")
    r = svc.adjust_chapter_audio(db, "p1", "c1", tempo=0.8)
    print(f"    result: adjusted={r['adjusted']} skipped_recorded={r['skipped_recorded']}")
    check("skipped_recorded == 1", r["skipped_recorded"] == 1, f"got {r['skipped_recorded']}")
    check("adjusted == 3", r["adjusted"] == 3, f"got {r['adjusted']}")
    p1_after, _, _ = cur_info("s1")
    check("recorded bytes unchanged", p1_after.read_bytes() == rec_file_bytes
          and p1_after == rec_path,
          f"path={p1_after} size={fmt_size(p1_after)}")
    check("recorded duration unchanged",
          abs(seg_row("s1").audio["current"]["duration_sec"] - rec_stored) < 1e-9,
          f"stored={seg_row('s1').audio['current']['duration_sec']:.6f} vs {rec_stored:.6f}")
    for sid in ("s2", "s3", "s4"):
        p, stored, probed = cur_info(sid)
        prev_d = seg_row(sid).audio["previous"]["duration_sec"]
        print(f"    {sid}: 0.8x probed={probed:.3f}s (orig≈{prev_d:.3f}s, "
              f"expect≈{prev_d / 0.8:.3f}s) file={fmt_size(p)}")
        check(f"0.8x {sid} re-rendered from original",
              abs(probed - prev_d / 0.8) < 0.15,
              f"diff={abs(probed - prev_d / 0.8)*1000:.0f}ms")
        check(f"0.8x {sid} stored≈probed", abs(stored - probed) < 0.05,
              f"diff={abs(stored - probed)*1000:.0f}ms")

    # ---- 7. 恒等还原 ----
    print("== step 7: identity revert (1.0x / 0dB) ==")
    r = svc.adjust_chapter_audio(db, "p1", "c1", tempo=1.0, volume_db=0.0)
    print(f"    result: adjusted={r['adjusted']} skipped_recorded={r['skipped_recorded']}")
    check("identity skipped_recorded == 1", r["skipped_recorded"] == 1,
          f"got {r['skipped_recorded']}")
    p1_rev, _, _ = cur_info("s1")
    check("recorded bytes unchanged after revert", p1_rev.read_bytes() == rec_file_bytes,
          f"size={fmt_size(p1_rev)}")
    for sid in ("s2", "s3", "s4"):
        p, stored, probed = cur_info(sid)
        orig_d = seg_row(sid).audio["previous"]["duration_sec"]
        print(f"    {sid}: reverted probed={probed:.3f}s (orig={orig_d:.3f}s)")
        check(f"revert {sid} back to original", abs(probed - orig_d) < 0.05,
              f"diff={abs(probed - orig_d)*1000:.0f}ms")
    ch = db.query(SegmentedProjectChapter).filter_by(id="c1").one()
    check("audio_adjust cleared after revert", ch.audio_adjust is None,
          f"audio_adjust={ch.audio_adjust}")

    # ---- 8. 再设 1.5x 并导出 concat mp3 + SRT ----
    print("== step 8: adjust 1.5x then export_all_chapters (mp3 + srt) ==")
    r = svc.adjust_chapter_audio(db, "p1", "c1", tempo=1.5)
    check("re-adjust skipped_recorded == 1", r["skipped_recorded"] == 1,
          f"got {r['skipped_recorded']}")
    out = svc.export_all_chapters(db, "p1")
    entry = out["exported"][0]
    mp3_path = Path(entry["audio_path"])
    srt_path = Path(entry["srt_path"])
    print(f"    exported: mp3={mp3_path.name} ({fmt_size(mp3_path)}) srt={srt_path.name}")

    cues = parse_srt(srt_path)
    ordered = ["s1", "s4", "s2", "s3"]  # position 顺序
    check("srt cue count == 4", len(cues) == 4, f"got {len(cues)}")
    total_srt = 0.0
    for (start, end), sid in zip(cues, ordered):
        _, stored, probed = cur_info(sid)
        cue_d = end - start
        total_srt = end
        print(f"    cue {sid}: {start:.3f}->{end:.3f}s (cue={cue_d:.3f}s "
              f"stored={stored:.3f}s probed={probed:.3f}s)")
        check(f"srt cue {sid} duration≈probed", abs(cue_d - probed) < 0.05,
              f"diff={abs(cue_d - probed)*1000:.0f}ms")
    contiguous = all(abs(cues[i][0] - cues[i - 1][1]) < 1e-9 for i in range(1, len(cues)))
    check("srt timeline strictly contiguous", contiguous,
          " vs ".join(f"end[{i-1}]={cues[i-1][1]:.3f}/start[{i}]={cues[i][0]:.3f}"
                      for i in range(1, len(cues))))
    mp3_total = probe_audio_duration(mp3_path)
    print(f"    srt_total={total_srt:.3f}s mp3_probed={mp3_total:.3f}s")
    check("srt total ≈ concat mp3 total", mp3_total is not None
          and abs(mp3_total - total_srt) < 0.2,
          f"diff={abs((mp3_total or 0) - total_srt)*1000:.0f}ms")

    # ---- 汇总 ----
    if FAILED:
        print(f"\nSMOKE FAILED ({len(FAILED)} assertion(s)):")
        for f in FAILED:
            print(f"  - {f}")
        return 1
    print("\nSMOKE OK")
    return 0


if __name__ == "__main__":
    code = 1
    try:
        code = main()
    except Exception:
        import traceback
        traceback.print_exc()
        code = 1
    finally:
        db.close()
        shutil.rmtree(TMP, ignore_errors=True)
    sys.exit(code)
