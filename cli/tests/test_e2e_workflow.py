"""End-to-end workflow test against a real NarraForge backend.

Requires a running backend (default http://127.0.0.1:8002) and network access
for the edge_tts engine. Skipped when the backend is unreachable. The test
creates a uniquely-named project and deletes it in a finally block.
"""
from __future__ import annotations

import json
import subprocess
import uuid
from pathlib import Path

import httpx
import pytest

from narraforge_cli.config import DEFAULT_API_URL

API_URL = DEFAULT_API_URL
CLI_DIR = Path(__file__).resolve().parent.parent

NARRATION = """## 第一章 开场

这是端到端测试的第一章，用来验证整个旁白流水线的正确性。
它包含几句话，字符数需要超过章节合并的最小阈值，避免相邻短章被自动合并。
每一句都会被规则拆分成独立的分段，并逐段调用语音引擎合成音频。
最后一句话结束本章，接下来进入第二章的验证流程。

## 第二章 收尾

第二章同样需要足够的字符数，避免被自动合并成单个章节。
语音合成会逐段调用引擎，生成音频并记录时长。
导出阶段会把每个章节拼接成完整的音频文件。
同时生成对应的字幕文件，时间轴从零开始计置。
"""


def _backend_up() -> bool:
    try:
        r = httpx.get(f"{API_URL}/health", timeout=2.0)
        return r.status_code == 200
    except httpx.TransportError:
        return False


pytestmark = [
    pytest.mark.e2e,
    pytest.mark.skipif(not _backend_up(), reason="NarraForge backend not reachable"),
]


def _nf(*args: str) -> dict:
    """Run the real `nf` CLI via subprocess and return parsed stdout JSON."""
    proc = subprocess.run(
        ["uv", "run", "nf", "--json", *args],
        cwd=CLI_DIR,
        capture_output=True,
        text=True,
        timeout=600,
    )
    assert proc.returncode == 0, (
        f"nf {' '.join(args)} failed ({proc.returncode})\n"
        f"stdout: {proc.stdout}\nstderr: {proc.stderr}"
    )
    return json.loads(proc.stdout)


def test_full_narration_workflow_with_edge_tts(tmp_path: Path) -> None:
    script = tmp_path / "narration.md"
    script.write_text(NARRATION, encoding="utf-8")
    export_root = tmp_path / "remotion-prj"
    project_id: str | None = None
    try:
        # 1. create project with the narration script attached
        data = _nf(
            "project",
            "create",
            "--name",
            f"nf-cli-e2e-{uuid.uuid4().hex[:8]}",
            "--script",
            str(script),
        )
        project_id = data["id"]
        assert data["narration_script_path"]

        # 2. split into chapters + segments (markdown headings auto-detected)
        data = _nf("project", "split", project_id)
        assert data["chapters"] == 2, f"expected 2 chapters, got {data}"

        # 3. select the edge_tts engine (user-standard engine for testing)
        data = _nf("project", "set-engine", project_id, "edge_tts")
        assert len(data["updated"]) == 2
        assert data["voice"]["engine"] == "edge_tts"

        # 4. synthesize every segment
        data = _nf("project", "synthesize", project_id)
        assert data["summary"]["failed"] == 0, f"synthesis failures: {data}"
        assert data["summary"]["ok"] == data["planned"] > 0

        # 5. status reports everything ready
        data = _nf("project", "status", project_id)
        assert data["all_ready"] is True, f"status not ready: {data}"

        # 6. export into the remotion project's public/audio
        export_root.mkdir(parents=True, exist_ok=True)
        data = _nf("project", "export", project_id, "--remotion-path", str(export_root))
        assert data["count"] == 2, f"expected 2 exported chapters, got {data}"
        audio_dir = export_root / "public" / "audio"
        exported_audio = sorted(p for p in audio_dir.glob("*.mp3") if p.stat().st_size > 0)
        exported_srt = sorted(audio_dir.glob("*.srt"))
        assert len(exported_audio) == 2, f"missing mp3 files: {list(audio_dir.iterdir())}"
        assert len(exported_srt) == 2
        for srt in exported_srt:
            content = srt.read_text(encoding="utf-8")
            assert "-->" in content  # valid subtitle timeline

        # 7. dual-read: backend data agrees with what the CLI reported
        detail = httpx.get(f"{API_URL}/api/segmented-projects/{project_id}", timeout=30).json()
        chapters = detail["chapters"]
        assert len(chapters) == 2
        for ch in chapters:
            assert ch["voice"]["engine"] == "edge_tts"
            assert len(ch["segments"]) >= 3
            for seg in ch["segments"]:
                audio = seg["audio"]["current"]
                assert audio["path"], f"segment {seg['id']} has no audio path"
                assert audio.get("duration_sec"), f"segment {seg['id']} missing duration"
                assert len(seg["text"]) <= 80  # MAX_SEGMENT_CHARS respected
    finally:
        if project_id:
            httpx.delete(f"{API_URL}/api/segmented-projects/{project_id}", timeout=30)


def test_export_aborts_when_audio_missing(tmp_path: Path) -> None:
    """Export preflight: a chapter with a missing-audio segment aborts with 409."""
    script = tmp_path / "narration.md"
    script.write_text(NARRATION, encoding="utf-8")
    export_root = tmp_path / "remotion-prj-2"
    project_id: str | None = None
    try:
        data = _nf(
            "project",
            "create",
            "--name",
            f"nf-cli-e2e-{uuid.uuid4().hex[:8]}",
            "--script",
            str(script),
        )
        project_id = data["id"]
        _nf("project", "split", project_id)

        proc = subprocess.run(
            ["uv", "run", "nf", "--json", "project", "export", project_id,
             "--remotion-path", str(export_root)],
            cwd=CLI_DIR,
            capture_output=True,
            text=True,
            timeout=120,
        )
        assert proc.returncode == 1
        assert "chapters_incomplete" in proc.stderr
        # the backend resolves (and creates) the export directory before the
        # preflight aborts - but no media files may be written
        audio_dir = export_root / "public" / "audio"
        assert not list(audio_dir.glob("*.mp3")) if audio_dir.exists() else True
        assert not list(audio_dir.glob("*.srt")) if audio_dir.exists() else True
    finally:
        if project_id:
            httpx.delete(f"{API_URL}/api/segmented-projects/{project_id}", timeout=30)


def test_health_command_reports_local_backend() -> None:
    data = _nf("health")
    assert data["health"]["status"] == "healthy"
    assert "edge_tts" in data["capabilities"]["engines"]
