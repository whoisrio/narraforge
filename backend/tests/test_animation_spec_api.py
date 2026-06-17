"""P2 v3: 动画规格 (animation_spec_json + animation_theme) 测试."""
from __future__ import annotations


def _create_project_with_segments(client, project_id: str = "p-anim-1"):
    """辅助: 创建项目 + 2 个 chapter + 3 个 segment."""
    client.post(
        "/api/segmented-projects",
        json={
            "id": project_id,
            "name": "Animation Test",
            "schema_version": 2,
            "layout": "vertical",
            "active_chapter_id": None,
            "original_text": None,
            "chapters": [
                {
                    "id": "ch1", "position": 0, "name": "第一章", "engine": None,
                    "default_params": {}, "split_config": {}, "original_text": None,
                    "segments": [
                        {"id": "s1", "position": 0, "text": "第 1 段", "duration_sec": 4.0},
                        {"id": "s2", "position": 1, "text": "第 2 段", "duration_sec": 5.0},
                    ],
                },
                {
                    "id": "ch2", "position": 1, "name": "第二章", "engine": None,
                    "default_params": {}, "split_config": {}, "original_text": None,
                    "segments": [
                        {"id": "s3", "position": 0, "text": "第 3 段", "duration_sec": 6.0},
                    ],
                },
            ],
        },
    )


def test_animation_theme_round_trip(client):
    """project.animation_theme 字段保存+读取."""
    _create_project_with_segments(client, "p-anim-2")
    # 设置 theme
    r = client.put(
        "/api/segmented-projects/p-anim-2",
        json={
            "id": "p-anim-2", "name": "Animation Test",
            "schema_version": 2, "layout": "vertical",
            "animation_theme": "dark-botanical",
            "chapters": [
                {"id": "ch1", "position": 0, "name": "第一章",
                 "default_params": {}, "split_config": {},
                 "segments": []},
            ],
        },
    )
    assert r.status_code == 200, r.text
    # 读回
    r = client.get("/api/segmented-projects/p-anim-2")
    assert r.json()["animation_theme"] == "dark-botanical"


def test_animation_spec_round_trip_via_save(client):
    """segment.animation_spec 字段保存+读取 (走 save_project 路径)."""
    _create_project_with_segments(client, "p-anim-3")
    spec = {
        "visual_concept": "kinetic-typography + warm-gold",
        "layout": "centered-text",
        "mood": "calm",
        "phases": {"intro_sec": 0.8, "sustain_sec": 2.4, "outro_sec": 0.8},
        "animations": {"in": "electric-bolt-strike-left", "sustain": "word-by-word-glow", "out": "fade-and-zoom-to-next"},
        "emphasis": ["R1"],
        "asset_refs": ["bg/dark-botanical-1.mp4"],
        "notes": "开场用电流引入, 暖金高光突出 R1",
    }
    r = client.put(
        "/api/segmented-projects/p-anim-3",
        json={
            "id": "p-anim-3", "name": "T",
            "schema_version": 2, "layout": "vertical",
            "chapters": [
                {"id": "ch1", "position": 0, "name": "第一章",
                 "default_params": {}, "split_config": {},
                 "segments": [
                    {"id": "s1", "position": 0, "text": "x",
                     "animation_spec": spec},
                 ]},
            ],
        },
    )
    assert r.status_code == 200
    # 读回
    r = client.get("/api/segmented-projects/p-anim-3")
    seg = r.json()["chapters"][0]["segments"][0]
    assert seg["animation_spec"] == spec
    assert seg["animation_spec"]["visual_concept"] == "kinetic-typography + warm-gold"
    assert seg["animation_spec"]["phases"]["sustain_sec"] == 2.4


def test_apply_animation_spec_batch(client):
    """POST /apply-animation-spec 一次性写多个 segment + theme."""
    _create_project_with_segments(client, "p-anim-4")
    r = client.post(
        "/api/segmented-projects/p-anim-4/apply-animation-spec",
        json={
            "theme": "tech-blueprint",
            "narration_version": "v2",
            "segments": [
                {"segment_id": "s1", "layout": "data-card",
                 "animations": {"in": "scale-in"}},
                {"segment_id": "s2", "layout": "centered-text",
                 "mood": "dramatic"},
                {"segment_id": "s3", "layout": "router-diagram",
                 "asset_refs": ["diagram/moe-router.svg"]},
            ],
        },
    )
    assert r.status_code == 200, r.text
    result = r.json()
    assert result["theme_updated"] is True
    assert result["segments_updated"] == 3
    assert result["segments_skipped"] == 0
    assert result["missing_segment_ids"] == []

    # 读回
    r = client.get("/api/segmented-projects/p-anim-4")
    data = r.json()
    assert data["animation_theme"] == "tech-blueprint"
    seg_specs = {s["id"]: s.get("animation_spec") for ch in data["chapters"] for s in ch["segments"]}
    assert seg_specs["s1"]["layout"] == "data-card"
    assert seg_specs["s1"]["animations"]["in"] == "scale-in"
    assert seg_specs["s2"]["mood"] == "dramatic"
    assert seg_specs["s3"]["asset_refs"] == ["diagram/moe-router.svg"]
    # 每个 spec 都应记录 generated_at
    for spec in seg_specs.values():
        assert "generated_at" in spec


def test_apply_animation_spec_merge_existing(client):
    """二次应用: 旧字段保留, 新字段覆盖, 未传字段不动."""
    _create_project_with_segments(client, "p-anim-5")
    # 第一次: 设置 mood + layout
    client.post(
        "/api/segmented-projects/p-anim-5/apply-animation-spec",
        json={
            "theme": "dark-botanical",
            "segments": [
                {"segment_id": "s1", "mood": "calm", "layout": "centered-text"},
            ],
        },
    )
    # 第二次: 只改 mood, layout 应保留
    client.post(
        "/api/segmented-projects/p-anim-5/apply-animation-spec",
        json={
            "segments": [
                {"segment_id": "s1", "mood": "dramatic"},
            ],
        },
    )
    # 读回
    r = client.get("/api/segmented-projects/p-anim-5")
    seg = r.json()["chapters"][0]["segments"][0]
    assert seg["animation_spec"]["mood"] == "dramatic"     # 新
    assert seg["animation_spec"]["layout"] == "centered-text"  # 旧保留
    # theme 也保留
    assert r.json()["animation_theme"] == "dark-botanical"


def test_apply_animation_spec_missing_segments(client):
    """缺失 segment_id 报告在 missing_segment_ids, 不报错."""
    _create_project_with_segments(client, "p-anim-6")
    r = client.post(
        "/api/segmented-projects/p-anim-6/apply-animation-spec",
        json={
            "segments": [
                {"segment_id": "s1", "layout": "x"},
                {"segment_id": "s_does_not_exist", "layout": "y"},
            ],
        },
    )
    assert r.status_code == 200
    result = r.json()
    assert result["segments_updated"] == 1
    assert result["segments_skipped"] == 1
    assert result["missing_segment_ids"] == ["s_does_not_exist"]


def test_apply_animation_spec_project_not_found(client):
    r = client.post(
        "/api/segmented-projects/p-nope/apply-animation-spec",
        json={"segments": []},
    )
    assert r.status_code == 404


def test_apply_animation_spec_empty_segments(client):
    """不传 segments: 仅设置 theme (允许)."""
    _create_project_with_segments(client, "p-anim-7")
    r = client.post(
        "/api/segmented-projects/p-anim-7/apply-animation-spec",
        json={"theme": "warm-paper"},
    )
    assert r.status_code == 200
    assert r.json()["segments_updated"] == 0
    assert r.json()["theme_updated"] is True


def test_animation_spec_null_after_omitted(client):
    """save_project 不传 animation_spec, 已有值应保留."""
    _create_project_with_segments(client, "p-anim-8")
    # 先写 spec
    client.post(
        "/api/segmented-projects/p-anim-8/apply-animation-spec",
        json={"segments": [{"segment_id": "s1", "layout": "data-card"}]},
    )
    # save_project 不带 animation_spec 字段 (现有 spec 应保留)
    r = client.put(
        "/api/segmented-projects/p-anim-8",
        json={
            "id": "p-anim-8", "name": "T",
            "schema_version": 2, "layout": "vertical",
            "chapters": [
                {"id": "ch1", "position": 0, "name": "第一章",
                 "default_params": {}, "split_config": {},
                 "segments": [{"id": "s1", "position": 0, "text": "x"}]},
            ],
        },
    )
    assert r.status_code == 200
    seg = r.json()["chapters"][0]["segments"][0]
    assert seg["animation_spec"] is not None
    assert seg["animation_spec"]["layout"] == "data-card"
