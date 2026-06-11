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
