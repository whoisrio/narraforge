"""TTS 语音核对 API 测试：verify 接口 + runs 运行记录接口。

设计文档：docs/superpowers/specs/2026-10-15-tts-asr-verify-design.md
- verify：multipart 上传音频 + 基准文本 → FunASR 转写 → 比对（monkeypatch transcribe_raw）
- runs：创建（409 防重）/ 心跳 PATCH / GET latest（惰性判活 running→interrupted）
"""
import uuid
from datetime import timedelta

import pytest

from app.core.time_utils import utcnow
from app.models.segmented_project import SegmentVerificationRun
from app.services.funasr_service import FunASRService


def _verify(
    client, *, baseline_text="保温杯可以装热水", audio_bytes=b"fake-audio",
    filename="seg.mp3", **extra,
):
    data = {"baseline_text": baseline_text, **extra}
    return client.post(
        "/api/tts-verify/verify",
        data=data,
        files={"audio": (filename, audio_bytes, "audio/mpeg")},
    )


@pytest.fixture
def patched_transcribe(monkeypatch):
    """monkeypatch FunASRService.transcribe_raw，记录调用并返回可控文本。"""
    calls: list[dict] = []

    def fake_transcribe_raw(self, input_file, device=None):
        calls.append({"input_file": input_file, "device": device})
        return "保温杯可以装热水"

    monkeypatch.setattr(FunASRService, "transcribe_raw", fake_transcribe_raw)
    return calls


class TestVerifyEndpoint:
    def test_happy_path(self, client, patched_transcribe):
        resp = _verify(client)
        assert resp.status_code == 200
        body = resp.json()
        assert body["asr_text"] == "保温杯可以装热水"
        assert body["normalized_baseline"] == "保温杯可以装热水"
        assert body["normalized_asr"] == "保温杯可以装热水"
        assert body["similarity"] == pytest.approx(1.0)
        assert body["match"] is True
        assert body["engine"] == "funasr"
        assert isinstance(body["diff"], list)
        assert body["elapsed_ms"] >= 0
        # 音频落盘给 ASR（临时文件已存在过）
        assert len(patched_transcribe) == 1

    def test_mismatch_result(self, client, patched_transcribe):
        resp = _verify(client, baseline_text="完全不同的另一句话")
        assert resp.status_code == 200
        assert resp.json()["match"] is False

    def test_empty_audio_400(self, client, patched_transcribe):
        resp = _verify(client, audio_bytes=b"")
        assert resp.status_code == 400

    def test_missing_audio_400(self, client, patched_transcribe):
        resp = client.post("/api/tts-verify/verify", data={"baseline_text": "x"})
        assert resp.status_code == 400

    def test_missing_baseline_400(self, client, patched_transcribe):
        resp = _verify(client, baseline_text="")
        assert resp.status_code == 400

    def test_invalid_engine_400(self, client, patched_transcribe):
        resp = _verify(client, engine="whisper")
        assert resp.status_code == 400

    def test_invalid_threshold_400(self, client, patched_transcribe):
        assert _verify(client, threshold="1.5").status_code == 400
        assert _verify(client, threshold="0").status_code == 400

    def test_custom_threshold_passthrough(self, client, monkeypatch):
        monkeypatch.setattr(
            FunASRService, "transcribe_raw",
            lambda self, input_file, device=None: "abcd",
        )
        resp = _verify(client, baseline_text="abce", threshold="0.7")
        assert resp.status_code == 200
        assert resp.json()["match"] is True

    def test_funasr_unavailable_503(self, client, monkeypatch):
        def raise_import_error(self, input_file, device=None):
            raise ImportError("funasr not installed")

        monkeypatch.setattr(FunASRService, "transcribe_raw", raise_import_error)
        resp = _verify(client)
        assert resp.status_code == 503

    def test_stub_env_returns_fixed_text_without_funasr(self, client, monkeypatch):
        """tts_verify_stub=True：不跑真实 ASR，返回可控文本（E2E 专用桩）。"""

        def explode(self, input_file, device=None):
            raise AssertionError("stub 模式不应触碰真实 ASR")

        monkeypatch.setattr(FunASRService, "transcribe_raw", explode)
        from app.core.config import settings as app_settings

        monkeypatch.setattr(app_settings, "tts_verify_stub", True)
        monkeypatch.setattr(app_settings, "tts_verify_stub_text", "桩回读")

        resp = _verify(client, baseline_text="正常朗读的句子")
        assert resp.status_code == 200
        body = resp.json()
        assert body["asr_text"] == "桩回读"
        assert body["device"] == "stub"
        assert body["match"] is False  # 与基准不同 → 不一致（E2E 据此制造 mismatch）


def _create_run(client, project_id, **overrides):
    payload = {"project_id": project_id, "scope": "project", "total": 10, **overrides}
    return client.post("/api/tts-verify/runs", json=payload)


def _backdate(db_session, run_id, seconds):
    run = db_session.query(SegmentVerificationRun).filter_by(id=run_id).one()
    run.updated_at = utcnow() - timedelta(seconds=seconds)
    db_session.commit()


class TestRunsCreate:
    def test_create_run_201(self, client):
        resp = _create_run(client, f"p-{uuid.uuid4().hex[:8]}")
        assert resp.status_code == 201
        body = resp.json()
        assert body["status"] == "running"
        assert body["total"] == 10
        assert body["done"] == 0
        assert body["scope"] == "project"
        assert body["chapter_id"] is None
        assert body["updated_at"].endswith("Z")

    def test_create_chapter_scope_run(self, client):
        pid = f"p-{uuid.uuid4().hex[:8]}"
        resp = _create_run(client, pid, scope="chapter", chapter_id="ch-1")
        assert resp.status_code == 201
        assert resp.json()["chapter_id"] == "ch-1"

    def test_chapter_scope_requires_chapter_id(self, client):
        resp = _create_run(client, f"p-{uuid.uuid4().hex[:8]}", scope="chapter")
        assert resp.status_code == 400

    def test_invalid_scope_400(self, client):
        resp = _create_run(client, f"p-{uuid.uuid4().hex[:8]}", scope="bogus")
        assert resp.status_code == 400

    def test_duplicate_running_run_409(self, client):
        pid = f"p-{uuid.uuid4().hex[:8]}"
        first = _create_run(client, pid)
        assert first.status_code == 201
        second = _create_run(client, pid)
        assert second.status_code == 409
        detail = second.json()["detail"]
        assert detail["code"] == "verify_run_in_progress"
        assert detail["run"]["id"] == first.json()["id"]

    def test_stale_heartbeat_interrupted_then_create_ok(self, client, db_session):
        """心跳过期（>180s）的 running run 先落库标 interrupted，再允许新建。"""
        pid = f"p-{uuid.uuid4().hex[:8]}"
        first = _create_run(client, pid)
        run_id = first.json()["id"]
        _backdate(db_session, run_id, seconds=200)

        second = _create_run(client, pid)
        assert second.status_code == 201
        old = db_session.query(SegmentVerificationRun).filter_by(id=run_id).one()
        db_session.refresh(old)
        assert old.status == "interrupted"


class TestRunsPatch:
    def test_patch_done_heartbeat(self, client):
        pid = f"p-{uuid.uuid4().hex[:8]}"
        run_id = _create_run(client, pid).json()["id"]
        resp = client.patch(f"/api/tts-verify/runs/{run_id}", json={"done": 3})
        assert resp.status_code == 200
        body = resp.json()
        assert body["done"] == 3
        assert body["status"] == "running"

    def test_patch_status_completed(self, client):
        pid = f"p-{uuid.uuid4().hex[:8]}"
        run_id = _create_run(client, pid).json()["id"]
        resp = client.patch(
            f"/api/tts-verify/runs/{run_id}", json={"done": 10, "status": "completed"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "completed"

    def test_patch_status_stopped(self, client):
        pid = f"p-{uuid.uuid4().hex[:8]}"
        run_id = _create_run(client, pid).json()["id"]
        resp = client.patch(f"/api/tts-verify/runs/{run_id}", json={"status": "stopped"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "stopped"

    def test_patch_unknown_run_404(self, client):
        resp = client.patch("/api/tts-verify/runs/nope", json={"done": 1})
        assert resp.status_code == 404

    def test_patch_invalid_status_400(self, client):
        pid = f"p-{uuid.uuid4().hex[:8]}"
        run_id = _create_run(client, pid).json()["id"]
        resp = client.patch(f"/api/tts-verify/runs/{run_id}", json={"status": "bogus"})
        assert resp.status_code == 400


class TestRunsLatest:
    def test_no_runs_returns_null(self, client):
        resp = client.get(
            "/api/tts-verify/runs/latest", params={"project_id": f"p-{uuid.uuid4().hex[:8]}"})
        assert resp.status_code == 200
        assert resp.json()["run"] is None

    def test_latest_returns_newest_run(self, client, db_session):
        """多个 run 时返回最新创建的那个（旧 run 先被惰性判活转 interrupted）。"""
        pid = f"p-{uuid.uuid4().hex[:8]}"
        first = _create_run(client, pid).json()
        _backdate(db_session, first["id"], seconds=200)  # 让第一个能被新 run 取代
        second = _create_run(client, pid)
        assert second.status_code == 201
        resp = client.get("/api/tts-verify/runs/latest", params={"project_id": pid})
        body = resp.json()["run"]
        assert body["id"] == second.json()["id"]
        assert body["status"] == "running"

    def test_latest_lazy_interrupt_stale_running(self, client, db_session):
        """running 但心跳过期 → GET 时落库标 interrupted 后再返回。"""
        pid = f"p-{uuid.uuid4().hex[:8]}"
        run_id = _create_run(client, pid).json()["id"]
        _backdate(db_session, run_id, seconds=200)

        resp = client.get("/api/tts-verify/runs/latest", params={"project_id": pid})
        assert resp.status_code == 200
        body = resp.json()["run"]
        assert body["id"] == run_id
        assert body["status"] == "interrupted"
        # 惰性判定已落库
        row = db_session.query(SegmentVerificationRun).filter_by(id=run_id).one()
        db_session.refresh(row)
        assert row.status == "interrupted"

    def test_latest_fresh_running_returned_as_is(self, client):
        pid = f"p-{uuid.uuid4().hex[:8]}"
        run_id = _create_run(client, pid).json()["id"]
        resp = client.get("/api/tts-verify/runs/latest", params={"project_id": pid})
        body = resp.json()["run"]
        assert body["id"] == run_id
        assert body["status"] == "running"

    def test_missing_project_id_400(self, client):
        resp = client.get("/api/tts-verify/runs/latest")
        assert resp.status_code == 400
