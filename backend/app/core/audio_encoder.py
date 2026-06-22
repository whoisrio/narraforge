"""ffmpeg-backed audio transcoding for segmented project storage."""
from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)


class AudioEncoderError(Exception):
    pass


def is_ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def trim_audio_silence_bytes(
    audio_bytes: bytes,
    *,
    keep_ms: int = 80,
    leading_keep_ms: int | None = None,
    trailing_keep_ms: int | None = None,
    threshold_db: str = "-50dB",
) -> bytes:
    """Trim leading/trailing silence with ffmpeg, keeping small natural edges.

    Returns WAV bytes. Raises AudioEncoderError on ffmpeg failure.
    """
    if not is_ffmpeg_available():
        raise AudioEncoderError("ffmpeg is not installed")

    leading_keep_s = max(0, leading_keep_ms if leading_keep_ms is not None else keep_ms) / 1000
    trailing_keep_s = max(0, trailing_keep_ms if trailing_keep_ms is not None else keep_ms) / 1000
    with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as in_tmp:
        in_tmp.write(audio_bytes)
        in_path = Path(in_tmp.name)

    out_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as out_tmp:
            out_path = Path(out_tmp.name)

        # Keep detected silence only at the two outer edges. Use two one-sided
        # silenceremove passes: leading first, then reverse/trim/reverse for
        # trailing. A single pass with stop_periods=1 can remove internal
        # pauses, which is wrong for narration.
        leading = (
            "silenceremove="
            "start_periods=1:"
            f"start_threshold={threshold_db}:"
            f"start_silence={leading_keep_s}"
        )
        trailing = (
            "areverse,"
            "silenceremove="
            "start_periods=1:"
            f"start_threshold={threshold_db}:"
            f"start_silence={trailing_keep_s},"
            "areverse"
        )
        af = f"{leading},{trailing}"
        cmd = [
            "ffmpeg",
            "-y",
            "-loglevel", "error",
            "-i", str(in_path),
            "-af", af,
            "-f", "wav",
            str(out_path),
        ]
        proc = subprocess.run(cmd, capture_output=True, timeout=60)
        if proc.returncode != 0:
            raise AudioEncoderError(
                f"ffmpeg silence trim failed (code {proc.returncode}): {proc.stderr.decode(errors='replace')}"
            )
        return out_path.read_bytes()
    finally:
        for p in (in_path, out_path):
            if p is None:
                continue
            try:
                p.unlink()
            except FileNotFoundError:
                pass


def transcode_to_mp3(
    wav_bytes: bytes,
    output_path: Path,
    *,
    bitrate: str = "96k",
) -> Path:
    """Transcode wav bytes to mp3 using ffmpeg. Atomic write via temp file."""
    if not is_ffmpeg_available():
        raise AudioEncoderError("ffmpeg is not installed")

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as in_tmp:
        in_tmp.write(wav_bytes)
        in_path = Path(in_tmp.name)

    out_tmp = output_path.with_suffix(output_path.suffix + ".tmp")
    cmd = [
        "ffmpeg",
        "-y",
        "-loglevel", "error",
        "-i", str(in_path),
        "-codec:a", "libmp3lame",
        "-b:a", bitrate,
        "-f", "mp3",
        str(out_tmp),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=60)
        if proc.returncode != 0:
            raise AudioEncoderError(
                f"ffmpeg failed (code {proc.returncode}): {proc.stderr.decode(errors='replace')}"
            )
        out_tmp.replace(output_path)
    finally:
        for p in (in_path, out_tmp):
            try:
                p.unlink()
            except FileNotFoundError:
                pass
    logger.debug("Transcoded %d bytes wav -> %s", len(wav_bytes), output_path)
    return output_path


def concat_to_mp3(
    input_paths: list[Path],
    output_path: Path,
    *,
    bitrate: str = "128k",
) -> Path:
    """Concatenate audio files to a single MP3 using ffmpeg."""
    if not is_ffmpeg_available():
        raise AudioEncoderError("ffmpeg is not installed")
    if not input_paths:
        raise AudioEncoderError("no audio files to concatenate")

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    list_path: Path | None = None
    out_tmp = output_path.with_suffix(output_path.suffix + ".tmp")
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".txt", encoding="utf-8", delete=False) as f:
            list_path = Path(f.name)
            for p in input_paths:
                safe_path = str(Path(p).resolve()).replace("'", "'\\''")
                f.write(f"file '{safe_path}'\n")

        cmd = [
            "ffmpeg",
            "-y",
            "-loglevel", "error",
            "-f", "concat",
            "-safe", "0",
            "-i", str(list_path),
            "-codec:a", "libmp3lame",
            "-b:a", bitrate,
            "-f", "mp3",
            str(out_tmp),
        ]
        proc = subprocess.run(cmd, capture_output=True, timeout=180)
        if proc.returncode != 0:
            raise AudioEncoderError(
                f"ffmpeg concat failed (code {proc.returncode}): {proc.stderr.decode(errors='replace')}"
            )
        out_tmp.replace(output_path)
    finally:
        for p in (list_path, out_tmp):
            if p is None:
                continue
            try:
                p.unlink()
            except FileNotFoundError:
                pass

    logger.debug("Concatenated %d audio files -> %s", len(input_paths), output_path)
    return output_path


def probe_audio_duration(audio_path: Path) -> float | None:
    """Return the audio duration in seconds, or None if unavailable.

    Tries ffprobe first (most accurate), then falls back to ffmpeg's
    stderr 'Duration:' line. Returns None when neither tool is available
    or parsing fails. Never raises.
    """
    audio_path = Path(audio_path)
    if not audio_path.exists():
        return None

    # 1) ffprobe (preferred) — `ffprobe -v error -show_entries format=duration ...`
    ffprobe = shutil.which("ffprobe")
    if ffprobe:
        try:
            r = subprocess.run(
                [ffprobe, "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", str(audio_path)],
                capture_output=True, text=True, timeout=10,
            )
            if r.returncode == 0:
                txt = (r.stdout or "").strip()
                if txt:
                    return float(txt)
        except (ValueError, subprocess.SubprocessError):
            pass

    # 2) Fallback — ffmpeg -i parsing the "Duration: HH:MM:SS.xx" line
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        try:
            r = subprocess.run(
                [ffmpeg, "-i", str(audio_path)],
                capture_output=True, text=True, timeout=10,
            )
            # ffmpeg prints "Duration: 00:00:12.34" to stderr even on success
            for line in (r.stderr or "").splitlines():
                if line.strip().startswith("Duration:"):
                    parts = line.split("Duration:", 1)[1].split(",")[0].strip()
                    h, m, s = parts.split(":")
                    return int(h) * 3600 + int(m) * 60 + float(s)
        except (ValueError, subprocess.SubprocessError):
            pass

    return None
