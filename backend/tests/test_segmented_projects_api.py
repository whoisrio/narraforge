import io
import wave
from unittest.mock import patch

from app.core import config


def _silent_wav_bytes(duration_ms: int = 50) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setparams((1, 2, 16000, 0, "NONE", "NONE"))
        frames = int(16000 * duration_ms / 1000)
        w.writeframes(b"\x00\x00" * frames)
    return buf.getvalue()


def _payload(pid: str = "p1") -> dict:
    return {
        "id": pid, "name": "Test", "schema_version": 2, "layout": "vertical",
        "chapters": [{
            "id": "c1", "position": 0, "name": "第一章", "engine": "edge_tts",
            "voice": {"engine": "edge_tts", "voice_id": "v1"},
            "split_config": {"delimiters": ["。"], "mode": "rule"},
            "original_text": "全文",
            "segments": [{
                "id": "s1", "position": 0, "text": "hello",
                "voice": {"source": "chapter"},
            }],
        }],
    }


def test_crud_round_trip(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)

    r = client.post("/api/segmented-projects", json=_payload("p1"))
    assert r.status_code == 201, r.text
    assert r.json()["chapters"][0]["segments"][0]["text"] == "hello"

    r = client.get("/api/segmented-projects")
    assert r.status_code == 200
    assert {p["id"] for p in r.json()["items"]} == {"p1"}

    r = client.get("/api/segmented-projects/p1")
    assert r.status_code == 200
    assert r.json()["chapters"][0]["original_text"] == "全文"

    payload = _payload("p1")
    payload["chapters"][0]["segments"] = []
    r = client.put("/api/segmented-projects/p1", json=payload)
    assert r.status_code == 200
    assert r.json()["chapters"][0]["segments"] == []

    r = client.delete("/api/segmented-projects/p1")
    assert r.status_code == 204


def test_list_projects_includes_card_summary_stats(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = _payload("p-stats")
    payload["chapters"].append({
        "id": "c2", "position": 1, "name": "第二章", "engine": "edge_tts",
        "voice": {"engine": "edge_tts", "voice_id": "v1"},
        "split_config": {"delimiters": ["。"], "mode": "rule"},
        "segments": [
            {"id": "s2", "position": 0, "text": "ready", "voice": {"source": "chapter"},
             "audio": {"current": {"path": "p/c2/s2.mp3", "format": "mp3", "duration_sec": 3.4}}},
            {"id": "s3", "position": 1, "text": "idle", "voice": {"source": "chapter"}},
        ],
    })
    payload["chapters"][0]["segments"][0]["audio"] = {"current": {"path": "p/c1/s1.mp3", "format": "mp3", "duration_sec": 2.2}}

    created = client.post("/api/segmented-projects", json=payload)
    assert created.status_code == 201, created.text

    r = client.get("/api/segmented-projects")
    assert r.status_code == 200
    summary = r.json()["items"][0]
    assert summary["summary_stats"] == {
        "chapter_count": 2,
        "segment_count": 3,
        "generated_count": 2,
        "duration_sec": 5.6,
    }


def test_404_on_missing(client):
    r = client.get("/api/segmented-projects/nope")
    assert r.status_code == 404


def test_synthesize_endpoint_writes_audio(client, tmp_path, monkeypatch):
    from app.core.audio_encoder import is_ffmpeg_available
    if not is_ffmpeg_available():
        import pytest
        pytest.skip("ffmpeg not installed")
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    client.post("/api/segmented-projects", json=_payload("p1"))
    fake = _silent_wav_bytes()
    with patch(
        "app.services.segmented_project_service.synthesize_with_engine",
        return_value=(fake, "wav"),
    ):
        r = client.post(
            "/api/segmented-projects/p1/chapters/c1/segments/s1/synthesize",
            json={"params": {"engine": "edge_tts", "voice_id": "v1"}},
        )
    assert r.status_code == 200, r.text
    seg = r.json()["chapters"][0]["segments"][0]
    audio = seg.get("audio") or {}
    current = audio.get("current", {}) if isinstance(audio, dict) else {}
    assert current.get("path", "").endswith(".mp3")
    assert current.get("format") == "mp3"
    full = tmp_path / current["path"]
    assert full.exists()


def test_migrate_endpoint_creates_projects(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = _payload("p-mig")
    r = client.post("/api/segmented-projects/migrate",
                    json={"projects": [payload], "audios": []})
    assert r.status_code == 200
    assert r.json()["results"][0]["status"] == "ok"
    r = client.get("/api/segmented-projects")
    assert {p["id"] for p in r.json()["items"]} == {"p-mig"}


def test_project_round_trips_role_fields(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = _payload("p-role")
    payload["default_narrator_role_id"] = "role-narrator"
    payload["chapters"][0]["segments"][0].update({
        "role_id": "role-linxia",
        "segment_kind": "dialogue",
        "voice": {
            "source": "role",
            "name": "林夏",
            "engine": "edge_tts",
            "role_id": "role-linxia",
        },
    })

    created = client.post("/api/segmented-projects", json=payload)
    assert created.status_code == 201, created.text

    fetched = client.get("/api/segmented-projects/p-role")
    assert fetched.status_code == 200
    body = fetched.json()
    assert body["default_narrator_role_id"] == "role-narrator"
    segment = body["chapters"][0]["segments"][0]
    assert segment["role_id"] == "role-linxia"
    assert segment["segment_kind"] == "dialogue"
    assert segment["voice"]["source"] == "role"
    assert segment["voice"]["name"] == "林夏"


def test_project_configs_json_round_trips_ui_settings(client, tmp_path, monkeypatch):
    """Regression: project UI settings (description / export_directory) are stored in the
    free-form `configs` JSON bucket, not dedicated columns. Verify create → get → list → put
    all preserve those keys, and that `configs=None` on PUT clears them.
    """
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)

    payload = _payload("p-cfg")
    payload["remotion_project_path"] = "/tmp/remotion"
    payload["configs"] = {
        "description": "给 DeepSeek 视频做旁白",
        "export_directory": "public/narration",
        "split_voice_mode": "dialogue",
    }

    created = client.post("/api/segmented-projects", json=payload)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["remotion_project_path"] == "/tmp/remotion"
    assert body["configs"] == {
        "description": "给 DeepSeek 视频做旁白",
        "export_directory": "public/narration",
        "split_voice_mode": "dialogue",
    }

    fetched = client.get("/api/segmented-projects/p-cfg").json()
    assert fetched["configs"]["description"] == "给 DeepSeek 视频做旁白"
    assert fetched["configs"]["export_directory"] == "public/narration"
    assert fetched["configs"]["split_voice_mode"] == "dialogue"

    # PUT with a modified configs value replaces (full-state save).
    payload["configs"] = {"export_directory": "assets/audio"}
    updated = client.put("/api/segmented-projects/p-cfg", json=payload).json()
    assert updated["configs"] == {"export_directory": "assets/audio"}

    # PUT with configs=None clears.
    payload["configs"] = None
    cleared = client.put("/api/segmented-projects/p-cfg", json=payload).json()
    assert cleared["configs"] is None


def test_chapter_narration_script_round_trips(client):
    project_id = "p_test_nscript"
    payload = {
        "id": project_id,
        "name": "T",
        "layout": "vertical",
        "chapters": [
            {
                "id": "c1",
                "position": 0,
                "name": "Ch1",
                "voice": {"engine": "edge_tts"},
                "split_config": {},
                "narration_script": "# 第一章\n改写后的旁白稿。",
                "segments": [],
            }
        ],
    }
    r = client.post("/api/segmented-projects", json=payload)
    assert r.status_code in (200, 201), r.text

    r = client.get(f"/api/segmented-projects/{project_id}")
    assert r.status_code == 200
    got = r.json()
    assert got["chapters"][0]["narration_script"] == "# 第一章\n改写后的旁白稿。"

    payload["chapters"][0]["narration_script"] = "改写 v2"
    r = client.put(f"/api/segmented-projects/{project_id}", json=payload)
    assert r.status_code == 200
    r = client.get(f"/api/segmented-projects/{project_id}")
    assert r.json()["chapters"][0]["narration_script"] == "改写 v2"


# ===== segment 长度上限（max_segment_chars，local+workers 都生效）=====

LONG_SEGMENT_TEXT = "这" * 81  # 超默认 80 上限 1 字


def test_create_project_rejects_overlong_segment(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = _payload("p-long")
    payload["chapters"][0]["segments"][0]["text"] = LONG_SEGMENT_TEXT
    r = client.post("/api/segmented-projects", json=payload)
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["code"] == "segment_too_long"
    assert detail["max"] == 80
    assert detail["chapter_id"] == "c1"
    assert detail["segment_id"] == "s1"


def test_put_project_rejects_overlong_segment(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    assert client.post("/api/segmented-projects", json=_payload("p1")).status_code == 201
    payload = _payload("p1")
    payload["chapters"][0]["segments"][0]["text"] = LONG_SEGMENT_TEXT
    r = client.put("/api/segmented-projects/p1", json=payload)
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "segment_too_long"


def test_batch_chapters_rejects_overlong_segment(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = _payload("p1")
    payload["chapters"] = []
    assert client.post("/api/segmented-projects", json=payload).status_code == 201
    r = client.post(
        "/api/segmented-projects/p1/chapters:batch",
        json={"chapters": [
            {"chapter_title": "第一章", "segments": [{"text": LONG_SEGMENT_TEXT}]},
        ]},
    )
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "segment_too_long"


def test_synthesize_text_override_rejects_overlong(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    assert client.post("/api/segmented-projects", json=_payload("p1")).status_code == 201
    r = client.post(
        "/api/segmented-projects/p1/chapters/c1/segments/s1/synthesize",
        json={"text": LONG_SEGMENT_TEXT},
    )
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "segment_too_long"


def test_overlong_segment_allowed_when_limit_zero(client, tmp_path, monkeypatch):
    """max_segment_chars=0 → 不限制。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    monkeypatch.setattr(config.settings, "max_segment_chars", 0)
    payload = _payload("p-nolimit")
    payload["chapters"][0]["segments"][0]["text"] = LONG_SEGMENT_TEXT
    r = client.post("/api/segmented-projects", json=payload)
    assert r.status_code == 201, r.text


def test_exactly_max_chars_segment_ok(client, tmp_path, monkeypatch):
    """恰好等于上限的段放行。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = _payload("p-exact")
    payload["chapters"][0]["segments"][0]["text"] = "这" * 80
    r = client.post("/api/segmented-projects", json=payload)
    assert r.status_code == 201, r.text


def test_split_endpoint_caps_segments_to_max_len(client, tmp_path, monkeypatch):
    """/split 规则拆分调用点传入 max_len：超长段在拆分阶段被截断。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    assert client.post("/api/segmented-projects", json=_payload("p1")).status_code == 201
    text = "我" * 70 + "，" + "我" * 79 + "。"  # 规则切（delimiters=["。"]）出 151 字段
    r = client.post(
        "/api/segmented-projects/p1/chapters/c1/split",
        json={"text": text, "mode": "rule", "replace_strategy": "preview_only"},
    )
    assert r.status_code == 200, r.text
    items = [i["text"] for i in r.json()["items"]]
    assert items == ["我" * 70 + "，", "我" * 79 + "。"]


def test_resplit_from_script_caps_segments(client, tmp_path, monkeypatch):
    """resplit-from-script 调用点同样截断到 max_len。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = _payload("p-resplit")
    payload["chapters"][0]["narration_script"] = "我" * 150 + "。"
    payload["chapters"][0]["segments"] = []
    assert client.post("/api/segmented-projects", json=payload).status_code == 201
    r = client.post("/api/segmented-projects/p-resplit/chapters/c1/resplit-from-script")
    assert r.status_code == 200, r.text
    segs = r.json()["chapters"][0]["segments"]
    assert segs
    assert all(len(s["text"]) <= 80 for s in segs)


# ===== 章节配额豁免：local 模式不启用 =====

def test_local_mode_has_no_chapter_quota(client, tmp_path, monkeypatch):
    """local 模式无章节上限：>3 章的项目照常创建。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = _payload("p-many-ch")
    payload["chapters"] = [
        {"id": f"c{i}", "position": i, "name": f"第{i}章",
         "split_config": {"delimiters": ["。"], "mode": "rule"}, "segments": []}
        for i in range(4)
    ]
    r = client.post("/api/segmented-projects", json=payload)
    assert r.status_code == 201, r.text


def test_put_rejects_stale_base_updated_at(client, tmp_path, monkeypatch):
    """陈旧 base_updated_at 的整量 PUT → 409 stale_payload（乐观锁）。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    r = client.post("/api/segmented-projects", json=_payload("p-stale"))
    assert r.status_code == 201, r.text

    stale = _payload("p-stale")
    stale["base_updated_at"] = "2000-01-01T00:00:00"
    r = client.put("/api/segmented-projects/p-stale", json=stale)
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "stale_payload"


def test_put_accepts_matching_base_updated_at(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    r = client.post("/api/segmented-projects", json=_payload("p-fresh"))
    assert r.status_code == 201, r.text
    server_updated_at = r.json()["updated_at"]

    fresh = _payload("p-fresh")
    fresh["name"] = "Fresh"
    fresh["base_updated_at"] = server_updated_at
    r = client.put("/api/segmented-projects/p-fresh", json=fresh)
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Fresh"


# ── 段级 PATCH 端点（2026-08-27 粒度重构 Phase 2）──


def test_patch_segment_updates_text_and_bumps_project_updated_at(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    created = client.post("/api/segmented-projects", json=_payload("p1"))
    assert created.status_code == 201, created.text
    old_project_updated_at = created.json()["updated_at"]

    r = client.patch("/api/segmented-projects/p1/chapters/c1/segments/s1", json={"text": "改过的文本"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["segment"]["text"] == "改过的文本"
    assert body["project_updated_at"] != old_project_updated_at

    got = client.get("/api/segmented-projects/p1").json()
    assert got["chapters"][0]["segments"][0]["text"] == "改过的文本"


def test_patch_segment_clears_emotion_with_explicit_null(client, tmp_path, monkeypatch):
    """tri-state：显式 null = 清空；字段缺省 = 不动。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = _payload("p1")
    payload["chapters"][0]["segments"][0]["emotion"] = "happy"
    assert client.post("/api/segmented-projects", json=payload).status_code == 201

    # 缺省 emotion → 保持
    r = client.patch("/api/segmented-projects/p1/chapters/c1/segments/s1", json={"text": "x"})
    assert r.status_code == 200
    assert r.json()["segment"]["emotion"] == "happy"
    # 显式 null → 清空
    r = client.patch("/api/segmented-projects/p1/chapters/c1/segments/s1", json={"emotion": None})
    assert r.status_code == 200
    assert r.json()["segment"]["emotion"] is None


def test_patch_segment_sets_role_kind_and_voice(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    assert client.post("/api/segmented-projects", json=_payload("p1")).status_code == 201

    r = client.patch(
        "/api/segmented-projects/p1/chapters/c1/segments/s1",
        json={"role_id": "role-a", "segment_kind": "dialogue",
              "voice": {"source": "role", "role_id": "role-a"}},
    )
    assert r.status_code == 200, r.text
    seg = r.json()["segment"]
    assert seg["role_id"] == "role-a"
    assert seg["segment_kind"] == "dialogue"
    assert seg["voice"]["source"] == "role"


def test_patch_segment_preserves_server_owned_audio(client, tmp_path, monkeypatch):
    """PATCH 内容字段不得触碰 audio/generated_params（服务端自产）。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = _payload("p1")
    payload["chapters"][0]["segments"][0]["audio"] = {
        "current": {"path": "p1/c1/s1.mp3", "format": "mp3", "duration_sec": 1.5},
    }
    payload["chapters"][0]["segments"][0]["generated_params"] = {"engine": "edge_tts"}
    assert client.post("/api/segmented-projects", json=payload).status_code == 201

    r = client.patch("/api/segmented-projects/p1/chapters/c1/segments/s1",
                     json={"text": "新文本", "audio": None})
    assert r.status_code == 200, r.text
    seg = r.json()["segment"]
    assert seg["audio"]["current"]["path"] == "p1/c1/s1.mp3"
    assert seg["generated_params"] == {"engine": "edge_tts"}


def test_patch_segment_404_on_missing(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    assert client.post("/api/segmented-projects", json=_payload("p1")).status_code == 201
    r = client.patch("/api/segmented-projects/p1/chapters/c1/segments/nope", json={"text": "x"})
    assert r.status_code == 404
    r = client.patch("/api/segmented-projects/p1/chapters/nope/segments/s1", json={"text": "x"})
    assert r.status_code == 404


def test_patch_segment_rejects_too_long_text(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    assert client.post("/api/segmented-projects", json=_payload("p1")).status_code == 201
    r = client.patch("/api/segmented-projects/p1/chapters/c1/segments/s1",
                     json={"text": "字" * 200})
    assert r.status_code == 422


def test_patch_segment_voice_change_demotes_audio(client, tmp_path, monkeypatch):
    """voice 变更 → 旧音频降级为 previous、current 清空（文件保留），
    与前端 CLEAR_SEGMENT_AUDIO 语义一致。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = _payload("p1")
    payload["chapters"][0]["segments"][0]["voice"] = {"source": "chapter"}
    payload["chapters"][0]["segments"][0]["audio"] = {
        "format": "mp3",
        "duration_sec": 1.5,
        "current": {"path": "p1/c1/s1.mp3", "format": "mp3", "duration_sec": 1.5},
    }
    assert client.post("/api/segmented-projects", json=payload).status_code == 201

    r = client.patch(
        "/api/segmented-projects/p1/chapters/c1/segments/s1",
        json={"voice": {"source": "custom", "engine": "edge_tts", "params": {"edge_voice": "zh-CN-XiaoxiaoNeural"}}},
    )
    assert r.status_code == 200, r.text
    audio = r.json()["segment"]["audio"]
    assert audio.get("current") is None
    assert audio["previous"]["path"] == "p1/c1/s1.mp3"

    # 回归（2026-08-27 e2e 全灭）：current=None 后项目列表/详情不得 500
    assert client.get("/api/segmented-projects").status_code == 200
    detail = client.get("/api/segmented-projects/p1")
    assert detail.status_code == 200
    summary = client.get("/api/segmented-projects").json()["items"][0]
    assert summary["summary_stats"]["generated_count"] == 0

    # voice 未变 → audio 不动（此时 current 已为空，再 PATCH 同值也不应再生 previous）
    r = client.patch(
        "/api/segmented-projects/p1/chapters/c1/segments/s1",
        json={"voice": {"source": "custom", "engine": "edge_tts", "params": {"edge_voice": "zh-CN-XiaoxiaoNeural"}}},
    )
    assert r.status_code == 200
    audio = r.json()["segment"]["audio"]
    assert audio.get("current") is None
    assert audio["previous"]["path"] == "p1/c1/s1.mp3"


def test_patch_segment_text_change_keeps_audio(client, tmp_path, monkeypatch):
    """文本编辑不影响音频（与现有前端 UPDATE_TEXT 语义一致）。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = _payload("p1")
    payload["chapters"][0]["segments"][0]["audio"] = {
        "current": {"path": "p1/c1/s1.mp3", "format": "mp3"},
    }
    assert client.post("/api/segmented-projects", json=payload).status_code == 201

    r = client.patch("/api/segmented-projects/p1/chapters/c1/segments/s1", json={"text": "新文本"})
    assert r.status_code == 200
    assert r.json()["segment"]["audio"]["current"]["path"] == "p1/c1/s1.mp3"


def test_patch_segment_unlock_audio_clears_origin(client, tmp_path, monkeypatch):
    """unlock_audio=True：清除录音 origin 锁（显式解锁意图），音频引用本身保留。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = _payload("p1")
    payload["chapters"][0]["segments"][0]["audio"] = {
        "current": {"path": "p1/c1/s1.webm", "format": "webm", "origin": "recorded"},
    }
    assert client.post("/api/segmented-projects", json=payload).status_code == 201

    r = client.patch(
        "/api/segmented-projects/p1/chapters/c1/segments/s1",
        json={"unlock_audio": True},
    )
    assert r.status_code == 200, r.text
    current = r.json()["segment"]["audio"]["current"]
    assert current.get("origin") is None
    assert current["path"] == "p1/c1/s1.webm"  # 音频引用保留

    # 无 origin 时 unlock 是 no-op
    r = client.patch(
        "/api/segmented-projects/p1/chapters/c1/segments/s1",
        json={"unlock_audio": True},
    )
    assert r.status_code == 200
    assert r.json()["segment"]["audio"]["current"]["path"] == "p1/c1/s1.webm"


# ── 段结构端点（2026-08-27 粒度重构 Phase 3）──


def _three_segment_payload(pid: str = "p1") -> dict:
    payload = _payload(pid)
    payload["chapters"][0]["segments"] = [
        {"id": "s1", "position": 0, "text": "一", "voice": {"source": "chapter"}},
        {"id": "s2", "position": 1, "text": "二", "voice": {"source": "chapter"}},
        {"id": "s3", "position": 2, "text": "三", "voice": {"source": "chapter"}},
    ]
    return payload


def test_create_segment_appends_and_returns_positions(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    created = client.post("/api/segmented-projects", json=_three_segment_payload())
    assert created.status_code == 201, created.text
    old_updated_at = created.json()["updated_at"]

    r = client.post("/api/segmented-projects/p1/chapters/c1/segments", json={"text": "新段"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["segment"]["text"] == "新段"
    assert body["segment"]["position"] == 3
    assert [p["id"] for p in body["positions"]] == ["s1", "s2", "s3", body["segment"]["id"]]
    assert [p["position"] for p in body["positions"]] == [0, 1, 2, 3]
    assert body["project_updated_at"] != old_updated_at

    got = client.get("/api/segmented-projects/p1").json()
    assert [s["text"] for s in got["chapters"][0]["segments"]] == ["一", "二", "三", "新段"]


def test_create_segment_empty_body_is_legal(client, tmp_path, monkeypatch):
    """空文本新建段是合法场景（先建段再编辑）。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    assert client.post("/api/segmented-projects", json=_payload("p1")).status_code == 201
    r = client.post("/api/segmented-projects/p1/chapters/c1/segments", json={})
    assert r.status_code == 201, r.text
    assert r.json()["segment"]["text"] == ""
    assert r.json()["segment"]["position"] == 1


def test_create_segment_inserts_after_anchor(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    assert client.post("/api/segmented-projects", json=_three_segment_payload()).status_code == 201

    r = client.post(
        "/api/segmented-projects/p1/chapters/c1/segments",
        json={"text": "插队", "after_id": "s1"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["segment"]["position"] == 1
    assert [p["id"] for p in body["positions"]] == ["s1", body["segment"]["id"], "s2", "s3"]

    got = client.get("/api/segmented-projects/p1").json()
    assert [s["text"] for s in got["chapters"][0]["segments"]] == ["一", "插队", "二", "三"]


def test_create_segment_404s(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    assert client.post("/api/segmented-projects", json=_payload("p1")).status_code == 201
    # 章节不存在 → 404 chapter_not_found
    r = client.post("/api/segmented-projects/p1/chapters/nope/segments", json={"text": "x"})
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "chapter_not_found"
    # 项目不存在 → 404
    assert client.post(
        "/api/segmented-projects/nope/chapters/c1/segments", json={"text": "x"}
    ).status_code == 404
    # after_id 在章内无对应段 → 404 segment_not_found
    r = client.post(
        "/api/segmented-projects/p1/chapters/c1/segments",
        json={"text": "x", "after_id": "s-ghost"},
    )
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "segment_not_found"


def test_create_segment_rejects_overlong_text(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    assert client.post("/api/segmented-projects", json=_payload("p1")).status_code == 201
    r = client.post(
        "/api/segmented-projects/p1/chapters/c1/segments", json={"text": "字" * 200}
    )
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "segment_too_long"


def test_structure_reconcile_endpoint(client, tmp_path, monkeypatch):
    """structure reconcile：更新 + 删除 + 新建 + 重排一次完成。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    created = client.post("/api/segmented-projects", json=_three_segment_payload())
    assert created.status_code == 201, created.text
    old_updated_at = created.json()["updated_at"]

    r = client.patch(
        "/api/segmented-projects/p1/chapters/c1/structure",
        json={"segments": [
            {"id": "s3", "text": "三", "position": 0},
            {"id": None, "text": "新段", "position": 1},
            {"id": "s2", "text": "二（改）", "position": 2},
        ]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert [s["position"] for s in body["segments"]] == [0, 1, 2]
    assert body["segments"][0]["id"] == "s3"
    assert body["segments"][1]["text"] == "新段"
    assert body["segments"][2]["text"] == "二（改）"
    assert body["project_updated_at"] != old_updated_at

    got = client.get("/api/segmented-projects/p1").json()
    segs = got["chapters"][0]["segments"]
    assert [s["text"] for s in segs] == ["三", "新段", "二（改）"]
    assert [s["position"] for s in segs] == [0, 1, 2]


def test_structure_reconcile_preserves_server_owned_audio(client, tmp_path, monkeypatch):
    """structure reconcile 不覆盖已存在段的 audio/generated_params（文本未变场景）。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = _three_segment_payload()
    payload["chapters"][0]["segments"][0]["audio"] = {
        "current": {"path": "p1/c1/s1.mp3", "format": "mp3"},
    }
    payload["chapters"][0]["segments"][0]["generated_params"] = {"engine": "edge_tts"}
    assert client.post("/api/segmented-projects", json=payload).status_code == 201

    r = client.patch(
        "/api/segmented-projects/p1/chapters/c1/structure",
        json={"segments": [
            {"id": "s1", "text": "一", "position": 2},
            {"id": "s2", "text": "二", "position": 0},
            {"id": "s3", "text": "三", "position": 1},
        ]},
    )
    assert r.status_code == 200, r.text
    seg = next(s for s in r.json()["segments"] if s["id"] == "s1")
    assert seg["position"] == 2
    assert seg["audio"]["current"]["path"] == "p1/c1/s1.mp3"
    assert seg["generated_params"] == {"engine": "edge_tts"}


def test_structure_reconcile_text_change_demotes_audio(client, tmp_path, monkeypatch):
    """结构性文本变更（合并等）→ 旧音频降级：current 清空、previous 保留、
    generated_params 置空（原则 4）。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = _three_segment_payload()
    payload["chapters"][0]["segments"][0]["audio"] = {
        "current": {"path": "p1/c1/s1.mp3", "format": "mp3", "duration_sec": 1.5},
    }
    payload["chapters"][0]["segments"][0]["generated_params"] = {"engine": "edge_tts"}
    assert client.post("/api/segmented-projects", json=payload).status_code == 201

    r = client.patch(
        "/api/segmented-projects/p1/chapters/c1/structure",
        json={"segments": [
            {"id": "s1", "text": "一（合并后）", "position": 0},
            {"id": "s2", "text": "二", "position": 1},
            {"id": "s3", "text": "三", "position": 2},
        ]},
    )
    assert r.status_code == 200, r.text
    seg = next(s for s in r.json()["segments"] if s["id"] == "s1")
    assert seg["text"] == "一（合并后）"
    assert seg["audio"].get("current") is None
    assert seg["audio"]["previous"]["path"] == "p1/c1/s1.mp3"
    assert seg["generated_params"] is None


def test_structure_reconcile_404_and_422(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    assert client.post("/api/segmented-projects", json=_payload("p1")).status_code == 201
    # 章节不存在 → 404
    r = client.patch("/api/segmented-projects/p1/chapters/nope/structure", json={"segments": []})
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "chapter_not_found"
    # 项目不存在 → 404
    assert client.patch(
        "/api/segmented-projects/nope/chapters/c1/structure", json={"segments": []}
    ).status_code == 404
    # 超长段文本 → 422
    r = client.patch(
        "/api/segmented-projects/p1/chapters/c1/structure",
        json={"segments": [{"id": "s1", "text": "字" * 200, "position": 0}]},
    )
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "segment_too_long"


# ── 章节操作端点（2026-08-27 粒度重构 Phase 4）──


def test_create_chapter_appends_and_reads_back(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    created = client.post("/api/segmented-projects", json=_payload("p1"))
    assert created.status_code == 201, created.text
    old_updated_at = created.json()["updated_at"]

    r = client.post("/api/segmented-projects/p1/chapters", json={"name": "第二章"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["chapter"]["name"] == "第二章"
    assert body["chapter"]["position"] == 1
    assert body["chapter"]["segments"] == []
    assert body["chapter"]["split_config"]["mode"] == "rule"
    assert body["project_updated_at"] != old_updated_at

    got = client.get("/api/segmented-projects/p1").json()
    assert [c["name"] for c in got["chapters"]] == ["第一章", "第二章"]
    assert [c["position"] for c in got["chapters"]] == [0, 1]


def test_create_chapter_404_on_missing_project(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    r = client.post("/api/segmented-projects/nope/chapters", json={"name": "x"})
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "project_not_found"


def test_patch_chapter_partial_update(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    created = client.post("/api/segmented-projects", json=_payload("p1"))
    assert created.status_code == 201, created.text
    old_updated_at = created.json()["updated_at"]

    r = client.patch("/api/segmented-projects/p1/chapters/c1", json={"name": "改名章"})
    assert r.status_code == 200, r.text
    ch = r.json()["chapter"]
    assert ch["name"] == "改名章"
    assert ch["voice"] == {"engine": "edge_tts", "voice_id": "v1"}  # 缺省字段不动
    assert ch["split_config"] == {"delimiters": ["。"], "mode": "rule"}
    assert r.json()["project_updated_at"] != old_updated_at

    r = client.patch(
        "/api/segmented-projects/p1/chapters/c1",
        json={"design_title": "分镜标题", "voice": {"engine": "cosyvoice"}},
    )
    assert r.status_code == 200
    ch = r.json()["chapter"]
    assert ch["design_title"] == "分镜标题"
    assert ch["voice"] == {"engine": "cosyvoice"}
    assert ch["name"] == "改名章"  # 上轮结果保持

    # 显式 null 清空 design_title
    r = client.patch("/api/segmented-projects/p1/chapters/c1", json={"design_title": None})
    assert r.status_code == 200
    assert r.json()["chapter"]["design_title"] is None

    # GET 回读一致
    got = client.get("/api/segmented-projects/p1").json()
    assert got["chapters"][0]["name"] == "改名章"
    assert got["chapters"][0]["voice"] == {"engine": "cosyvoice"}


def test_patch_chapter_404_on_missing(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    assert client.post("/api/segmented-projects", json=_payload("p1")).status_code == 201
    r = client.patch("/api/segmented-projects/p1/chapters/nope", json={"name": "x"})
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "chapter_not_found"
    assert client.patch(
        "/api/segmented-projects/nope/chapters/c1", json={"name": "x"}
    ).status_code == 404


def test_delete_chapter_cascades_segments_and_returns_base(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = _payload("p1")
    payload["chapters"].append({
        "id": "c2", "position": 1, "name": "第二章", "engine": "edge_tts",
        "voice": {"engine": "edge_tts"},
        "split_config": {"delimiters": ["。"], "mode": "rule"},
        "segments": [{"id": "s2", "position": 0, "text": "二", "voice": {"source": "chapter"}}],
    })
    created = client.post("/api/segmented-projects", json=payload)
    assert created.status_code == 201, created.text
    old_updated_at = created.json()["updated_at"]

    r = client.delete("/api/segmented-projects/p1/chapters/c1")
    assert r.status_code == 200, r.text
    assert r.json()["project_updated_at"] != old_updated_at

    got = client.get("/api/segmented-projects/p1").json()
    assert [c["id"] for c in got["chapters"]] == ["c2"]
    # 该章段行级联删除；其余章节不受影响
    assert got["chapters"][0]["segments"][0]["id"] == "s2"


def test_delete_chapter_404_on_missing(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    assert client.post("/api/segmented-projects", json=_payload("p1")).status_code == 201
    assert client.delete("/api/segmented-projects/p1/chapters/nope").status_code == 404
    assert client.delete("/api/segmented-projects/nope/chapters/c1").status_code == 404


def test_reorder_chapters_endpoint(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = _payload("p1")
    payload["chapters"].append({
        "id": "c2", "position": 1, "name": "第二章", "engine": "edge_tts",
        "voice": {"engine": "edge_tts"},
        "split_config": {"delimiters": ["。"], "mode": "rule"},
        "segments": [],
    })
    created = client.post("/api/segmented-projects", json=payload)
    assert created.status_code == 201, created.text
    old_updated_at = created.json()["updated_at"]

    r = client.post("/api/segmented-projects/p1/chapters:reorder",
                    json={"chapter_ids": ["c2", "c1"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert [(c["id"], c["position"]) for c in body["chapters"]] == [("c2", 0), ("c1", 1)]
    assert body["project_updated_at"] != old_updated_at

    got = client.get("/api/segmented-projects/p1").json()
    assert [c["id"] for c in got["chapters"]] == ["c2", "c1"]
    assert [c["position"] for c in got["chapters"]] == [0, 1]


def test_reorder_chapters_422_on_mismatch(client, tmp_path, monkeypatch):
    """缺/多/未知/重复 id → 422 chapter_ids_mismatch。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    assert client.post("/api/segmented-projects", json=_payload("p1")).status_code == 201

    for bad in ([], ["c1", "ghost"], ["c1", "c1"]):
        r = client.post("/api/segmented-projects/p1/chapters:reorder",
                        json={"chapter_ids": bad})
        assert r.status_code == 422, bad
        assert r.json()["detail"]["code"] == "chapter_ids_mismatch"

    # 校验失败后原序保持
    got = client.get("/api/segmented-projects/p1").json()
    assert [c["id"] for c in got["chapters"]] == ["c1"]


def test_reorder_chapters_404_on_missing_project(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    r = client.post("/api/segmented-projects/nope/chapters:reorder",
                    json={"chapter_ids": []})
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "project_not_found"


# ----- 项目元信息 + 文档层（D/E 类：粒度重构 Phase 5） -----


def test_patch_project_endpoint_partial_update(client, tmp_path, monkeypatch):
    """PATCH /segmented-projects/{id}：tri-state 部分更新，响应为完整 ProjectDetail。"""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = _payload("p-meta")
    payload["configs"] = {"description": "旧描述"}
    payload["default_narrator_role_id"] = "role-1"
    payload["logo"] = "logo.png"
    assert client.post("/api/segmented-projects", json=payload).status_code == 201

    r = client.patch("/api/segmented-projects/p-meta", json={"name": "改名项目"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == "改名项目"
    # 缺省字段不动
    assert body["layout"] == "vertical"
    assert body["configs"] == {"description": "旧描述"}
    assert body["default_narrator_role_id"] == "role-1"
    assert body["logo"] == "logo.png"
    assert body["updated_at"]

    # layout/configs 更新 + 显式 null 清空
    r = client.patch(
        "/api/segmented-projects/p-meta",
        json={"layout": "horizontal", "configs": {"description": None},
              "logo": None, "default_narrator_role_id": None,
              "animation_theme": "dark-gold", "remotion_project_path": "/tmp/rp"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "改名项目"
    assert body["layout"] == "horizontal"
    assert body["configs"] == {"description": None}
    assert body["logo"] is None
    assert body["default_narrator_role_id"] is None
    assert body["animation_theme"] == "dark-gold"
    assert body["remotion_project_path"] == "/tmp/rp"

    # GET 回读一致
    got = client.get("/api/segmented-projects/p-meta").json()
    assert got["name"] == "改名项目"
    assert got["layout"] == "horizontal"
    assert got["animation_theme"] == "dark-gold"


def test_patch_project_rename_relocates_dir(client, tmp_path, monkeypatch):
    """改名走 PATCH：资产目录在同一事务内搬迁，音频文件随迁。"""
    from app.core import segmented_assets as assets
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    assert client.post("/api/segmented-projects", json=_payload("p-rn")).status_code == 201
    old_dir = assets.project_dir("p-rn", "Test")
    audio_file = old_dir / "chapters" / "c1" / "audio" / "s1.mp3"
    audio_file.parent.mkdir(parents=True, exist_ok=True)
    audio_file.write_bytes(b"fake")

    r = client.patch("/api/segmented-projects/p-rn", json={"name": "改名了"})
    assert r.status_code == 200, r.text
    new_dir = assets.project_dir("p-rn", "改名了")
    assert new_dir.exists()
    assert not old_dir.exists()
    assert (new_dir / "chapters" / "c1" / "audio" / "s1.mp3").read_bytes() == b"fake"


def test_patch_project_404_and_scratchpad(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    assert client.patch("/api/segmented-projects/nope",
                        json={"name": "x"}).status_code == 404
    assert client.patch("/api/segmented-projects/__scratchpad__",
                        json={"name": "x"}).status_code == 403


def test_put_source_document_endpoint(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    assert client.post("/api/segmented-projects", json=_payload("p-doc")).status_code == 201

    r = client.put("/api/segmented-projects/p-doc/source-document",
                   json={"text": "# 新源文档\n正文。"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["path"] and body["project_updated_at"]
    from pathlib import Path
    assert Path(body["path"]).exists()  # 绝对路径直接可读
    assert Path(body["path"]).read_text(encoding="utf-8") == "# 新源文档\n正文。"

    got = client.get("/api/segmented-projects/p-doc").json()
    assert got["source_document"] == "# 新源文档\n正文。"
    assert got["source_document_path"] == body["path"]
    assert got["updated_at"] == body["project_updated_at"]

    # 覆盖写入：再次 PUT 更新内容与版本
    r2 = client.put("/api/segmented-projects/p-doc/source-document",
                    json={"text": "第二次写入"})
    assert r2.status_code == 200
    assert Path(r2.json()["path"]).read_text(encoding="utf-8") == "第二次写入"
    assert r2.json()["project_updated_at"] >= body["project_updated_at"]


def test_put_narration_script_endpoint(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    assert client.post("/api/segmented-projects", json=_payload("p-doc2")).status_code == 201

    r = client.put("/api/segmented-projects/p-doc2/narration-script",
                   json={"text": "完整旁白稿"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["path"] and body["project_updated_at"]
    from pathlib import Path
    assert Path(body["path"]).read_text(encoding="utf-8") == "完整旁白稿"

    got = client.get("/api/segmented-projects/p-doc2").json()
    assert got["narration_script"] == "完整旁白稿"
    assert got["narration_document_path"] == body["path"]


def test_document_put_404_and_scratchpad(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    assert client.put("/api/segmented-projects/nope/source-document",
                      json={"text": "x"}).status_code == 404
    assert client.put("/api/segmented-projects/nope/narration-script",
                      json={"text": "x"}).status_code == 404
    assert client.put("/api/segmented-projects/__scratchpad__/source-document",
                      json={"text": "x"}).status_code == 403
    assert client.put("/api/segmented-projects/__scratchpad__/narration-script",
                      json={"text": "x"}).status_code == 403


# ----- 孤儿音频文件 sweep（粒度重构 Phase 6，local-only） -----


def test_sweep_orphan_audio_endpoint_dry_run_default(client, db_session, tmp_path, monkeypatch):
    """POST /segmented-projects/sweep-orphan-audio：缺省 dry-run 只报告；
    execute=true 才删。"""
    from app.models.segmented_project import SegmentedProjectSegment
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    assert client.post("/api/segmented-projects", json=_payload("p-sw")).status_code == 201
    from app.core.segmented_assets import project_dir
    prefix = project_dir("p-sw", "Test").name
    segs_dir = project_dir("p-sw", "Test") / "chapters" / "c1" / "segments"
    segs_dir.mkdir(parents=True, exist_ok=True)
    (segs_dir / "s1.mp3").write_bytes(b"cur")
    (segs_dir / "s-ghost.mp3").write_bytes(b"orphan")
    # 把 s1.mp3 挂上引用（服务端自产字段，只能直写 DB）
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    seg.audio = {"current": {"path": f"{prefix}/chapters/c1/segments/s1.mp3",
                             "format": "mp3"}}
    db_session.commit()

    # 干跑（缺省）
    r = client.post("/api/segmented-projects/sweep-orphan-audio", json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dry_run"] is True
    assert len(body["orphans"]) == 1
    assert body["orphans"][0]["path"].endswith("s-ghost.mp3")
    assert body["orphans"][0]["size_bytes"] == len(b"orphan")
    assert body["total_count"] == 1
    assert (segs_dir / "s-ghost.mp3").exists()  # 未删

    # 明确 dry-run
    r = client.post("/api/segmented-projects/sweep-orphan-audio",
                    json={"execute": False})
    assert r.status_code == 200
    assert r.json()["dry_run"] is True

    # 执行
    r = client.post("/api/segmented-projects/sweep-orphan-audio",
                    json={"execute": True})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dry_run"] is False
    assert body["deleted_count"] == 1
    assert not (segs_dir / "s-ghost.mp3").exists()
    assert (segs_dir / "s1.mp3").exists()  # 引用文件保留
