from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

from app.core.config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if "sqlite" in settings.database_url else {}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# P2 v2: 轻量级 schema migration (在 create_all 之后跑, 幂等).
# 因为 Base.metadata.create_all 不会 ALTER 已有表, 老 DB 需要手动加列.
_P2_V2_ALTER_STMTS = (
    # project 级: 旁白文档当前活跃版本
    "ALTER TABLE segmented_projects ADD COLUMN active_narration_version VARCHAR",
    # chapter 级: 旁白文档关联
    "ALTER TABLE segmented_project_chapters ADD COLUMN narration_document_id VARCHAR",
    "ALTER TABLE segmented_project_chapters ADD COLUMN narration_version VARCHAR",
    "ALTER TABLE segmented_project_chapters ADD COLUMN narration_slice_start INTEGER",
    "ALTER TABLE segmented_project_chapters ADD COLUMN narration_slice_end INTEGER",
    "ALTER TABLE segmented_project_chapters ADD COLUMN narration_synced_at DATETIME",
)

# P2 v3: 动画规格字段 (复用 segments 表, 加 2 列).
_P2_V3_ALTER_STMTS = (
    # project 级: 整体动画主题
    "ALTER TABLE segmented_projects ADD COLUMN animation_theme VARCHAR",
    # project 级: 默认关联 Remotion 项目路径
    "ALTER TABLE segmented_projects ADD COLUMN remotion_project_path VARCHAR",
    # chapter 级: 给 Remotion/视觉设计使用的章节标题
    "ALTER TABLE segmented_project_chapters ADD COLUMN design_title VARCHAR",
    # segment 级: 完整动画规格 (JSON 字符串)
    "ALTER TABLE segmented_project_segments ADD COLUMN animation_spec_json TEXT",
)

# P3: dialogue roles and local prosody marks.
_P3_ROLE_PROSODY_ALTER_STMTS = (
    "ALTER TABLE segmented_projects ADD COLUMN default_narrator_role_id VARCHAR",
    "ALTER TABLE segmented_project_segments ADD COLUMN role_id VARCHAR",
    "ALTER TABLE segmented_project_segments ADD COLUMN role_snapshot JSON",
    "ALTER TABLE segmented_project_segments ADD COLUMN segment_kind VARCHAR DEFAULT 'narration'",
    "ALTER TABLE segmented_project_segments ADD COLUMN prosody_marks JSON",
)

# P4: explicit voice role kind.
_P4_ROLE_KIND_ALTER_STMTS = (
    "ALTER TABLE roles ADD COLUMN role_kind VARCHAR DEFAULT 'cast'",
)

# P5: voice profile avatar.
_P5_VOICE_AVATAR_ALTER_STMTS = (
    "ALTER TABLE voice_profiles ADD COLUMN avatar VARCHAR",
)

# P6: voice clone original/preview audio paths.
_P6_CLONE_AUDIO_PATHS_ALTER_STMTS = (
    "ALTER TABLE voice_profiles ADD COLUMN original_audio_path VARCHAR",
    "ALTER TABLE voice_profiles ADD COLUMN cloned_preview_path VARCHAR",
)

# P7: source document for library.
_P7_SOURCE_DOCUMENT_ALTER_STMTS = (
    "ALTER TABLE segmented_projects ADD COLUMN source_document TEXT",
)

# P8: voice profile prompt text (VoxCPM reference audio transcript).
_P8_PROMPT_TEXT_ALTER_STMTS = (
    "ALTER TABLE voice_profiles ADD COLUMN prompt_text VARCHAR",
)

# P9: voice profile project scope (NULL = global, non-null = project-specific).
_P9_VOICE_PROJECT_SCOPE_ALTER_STMTS = (
    "ALTER TABLE voice_profiles ADD COLUMN project_id VARCHAR",
)

# P10: voice engine metadata (voices_engine nested structure).
_P10_VOICE_ENGINE_ALTER_STMTS = (
    "ALTER TABLE voice_profiles ADD COLUMN voice_engine_type VARCHAR",
    "ALTER TABLE voice_profiles ADD COLUMN engine_type VARCHAR",
    "ALTER TABLE voice_profiles ADD COLUMN engine_sub_type VARCHAR",
    "ALTER TABLE voice_profiles ADD COLUMN engine_params JSON",
)

# P11: rename audio_path → source_audio_path, drop original_audio_path.
_P11_SOURCE_AUDIO_ALTER_STMTS = (
    "ALTER TABLE voice_profiles ADD COLUMN source_audio_path VARCHAR",
    # 项目级配置 JSON 字段 (split_voice_mode 等)
    "ALTER TABLE segmented_projects ADD COLUMN configs JSON",
)

# P12: segment 显式音色引用
_P12_VOICE_REF_ALTER_STMTS = (
    "ALTER TABLE segmented_project_segments ADD COLUMN voice_ref JSON",
)


def _run_alter_or_skip(conn, stmt: str) -> bool:
    """执行 ALTER TABLE. 列已存在时跳过.

    Returns True if executed, False if skipped.
    """
    parts = stmt.split()
    if len(parts) >= 6 and parts[0].upper() == "ALTER" and parts[1].upper() == "TABLE":
        table_name = parts[2]
        column_name = parts[5]
        existing_columns = {c["name"] for c in inspect(conn).get_columns(table_name)}
        if column_name in existing_columns:
            return False

    try:
        conn.execute(text(stmt))
        return True
    except Exception as e:
        msg = str(e).lower()
        if "duplicate column" in msg or "already exists" in msg:
            return False
        raise


def _migrate_source_audio_path(conn):
    """P11: copy audio_path/original_audio_path → source_audio_path (幂等)."""
    import logging
    logger = logging.getLogger(__name__)
    try:
        existing = {c["name"] for c in inspect(conn).get_columns("voice_profiles")}
        if "source_audio_path" not in existing:
            return
        if "original_audio_path" in existing:
            conn.execute(text(
                "UPDATE voice_profiles SET source_audio_path = original_audio_path "
                "WHERE source_audio_path IS NULL AND original_audio_path IS NOT NULL"
            ))
        if "audio_path" in existing:
            conn.execute(text(
                "UPDATE voice_profiles SET source_audio_path = audio_path "
                "WHERE source_audio_path IS NULL AND audio_path IS NOT NULL AND audio_path != ''"
            ))
        logger.info("[migration] P11: copied audio_path → source_audio_path")
    except Exception as e:
        logger.warning(f"[migration] P11 data migration skipped: {e}")


def _migrate_design_preview_and_drop_legacy(conn):
    """P12: move design source→preview, drop audio_path/original_audio_path columns."""
    import logging
    logger = logging.getLogger(__name__)
    try:
        existing = {c["name"] for c in inspect(conn).get_columns("voice_profiles")}
        if "audio_path" not in existing and "original_audio_path" not in existing:
            return

        # Step 1: move design voice source_audio_path → cloned_preview_path
        if "source_audio_path" in existing and "cloned_preview_path" in existing:
            conn.execute(text(
                "UPDATE voice_profiles SET cloned_preview_path = source_audio_path, source_audio_path = NULL "
                "WHERE source_audio_path LIKE '%design_%' AND (cloned_preview_path IS NULL OR cloned_preview_path = '')"
            ))
            count = conn.execute(text(
                "SELECT changes()"
            )).scalar()
            if count:
                logger.info(f"[migration] P12: moved {count} design source → preview")

        # Step 2: drop audio_path and original_audio_path via table recreate
        columns = conn.execute(text("PRAGMA table_info(voice_profiles)")).fetchall()
        drop_cols = {"audio_path", "original_audio_path"}
        keep_cols = [c for c in columns if c[1] not in drop_cols]
        if len(keep_cols) == len(columns):
            # No columns to drop (already clean)
            return

        col_defs = []
        for col in keep_cols:
            cid, name, col_type, notnull, default_val, pk = col
            not_null = " NOT NULL" if notnull else ""
            default = f" DEFAULT {default_val}" if default_val is not None else ""
            pk_str = " PRIMARY KEY" if pk else ""
            col_defs.append(f"{name} {col_type}{not_null}{default}{pk_str}")

        fk_list = conn.execute(text("PRAGMA foreign_key_list(voice_profiles)")).fetchall()
        fk_stmts = []
        for fk in fk_list:
            fk_stmts.append(
                f"FOREIGN KEY ({fk[3]}) REFERENCES {fk[2]}({fk[4]})"
                + (f" ON DELETE {fk[6]}" if fk[6] != "NO ACTION" else "")
            )

        col_sql = ", ".join(col_defs + fk_stmts)

        indexes = conn.execute(text("PRAGMA index_list(voice_profiles)")).fetchall()
        index_stmts = []
        for idx in indexes:
            idx_name = idx[1]
            if idx_name.startswith("sqlite_"):
                continue  # skip internal SQLite indexes
            unique = "UNIQUE " if idx[2] else ""
            cols = conn.execute(text(f"PRAGMA index_info({idx_name})")).fetchall()
            col_names = ", ".join(c[2] for c in cols)
            index_stmts.append(f"CREATE {unique}INDEX IF NOT EXISTS {idx_name} ON voice_profiles ({col_names})")

        conn.execute(text("ALTER TABLE voice_profiles RENAME TO voice_profiles_old"))
        conn.execute(text(f"CREATE TABLE voice_profiles ({col_sql})"))
        col_names = ", ".join(c[1] for c in keep_cols)
        conn.execute(text(f"INSERT INTO voice_profiles ({col_names}) SELECT {col_names} FROM voice_profiles_old"))
        conn.execute(text("DROP TABLE voice_profiles_old"))
        for stmt in index_stmts:
            conn.execute(text(stmt))

        logger.info("[migration] P12: dropped audio_path and original_audio_path columns")
    except Exception as e:
        logger.warning(f"[migration] P12 skipped: {e}")


def _migrate_absolute_to_relative(conn):
    """P13: convert absolute paths in voice_profiles to relative paths (幂等)."""
    import logging
    from pathlib import Path as FsPath
    from app.core.config import settings
    logger = logging.getLogger(__name__)
    try:
        existing = {c["name"] for c in inspect(conn).get_columns("voice_profiles")}
        path_cols = [c for c in ("source_audio_path", "cloned_preview_path") if c in existing]
        if not path_cols:
            return

        base = settings.base_dir
        for col in path_cols:
            rows = conn.execute(text(f"SELECT rowid, {col} FROM voice_profiles WHERE {col} IS NOT NULL")).fetchall()
            updated = 0
            for rowid, val in rows:
                p = FsPath(val)
                if p.is_absolute():
                    try:
                        rel = str(p.relative_to(base)).replace("\\", "/")
                    except ValueError:
                        rel = str(p).replace("\\", "/")
                    if rel != val:
                        conn.execute(text(f"UPDATE voice_profiles SET {col} = :rel WHERE rowid = :rid"), {"rel": rel, "rid": rowid})
                        updated += 1
            if updated:
                logger.info(f"[migration] P13: converted {updated} absolute paths in {col}")
    except Exception as e:
        logger.warning(f"[migration] P13 skipped: {e}")


def init_db():
    Base.metadata.create_all(bind=engine)
    # 跑 P2 v2 + v3 列迁移 (幂等)
    with engine.begin() as conn:
        import logging
        for stmt in _P2_V2_ALTER_STMTS + _P2_V3_ALTER_STMTS + _P3_ROLE_PROSODY_ALTER_STMTS + _P4_ROLE_KIND_ALTER_STMTS + _P5_VOICE_AVATAR_ALTER_STMTS + _P6_CLONE_AUDIO_PATHS_ALTER_STMTS + _P7_SOURCE_DOCUMENT_ALTER_STMTS + _P8_PROMPT_TEXT_ALTER_STMTS + _P9_VOICE_PROJECT_SCOPE_ALTER_STMTS + _P10_VOICE_ENGINE_ALTER_STMTS + _P11_SOURCE_AUDIO_ALTER_STMTS + _P12_VOICE_REF_ALTER_STMTS:
            if _run_alter_or_skip(conn, stmt):
                logging.getLogger(__name__).info(f"[migration] applied: {stmt}")
        # P11 data migration: copy audio_path → source_audio_path
        _migrate_source_audio_path(conn)
        # P12: move design source→preview, drop audio_path/original_audio_path
        _migrate_design_preview_and_drop_legacy(conn)
        # P13: convert absolute paths to relative paths
        _migrate_absolute_to_relative(conn)
        # P9000: v3 schema migration (voice/audio/engine JSON + drop old columns)
        _migrate_v3_reduce_schema(conn)
        # P9002: unify chapter voice params (default_params → voice EngineParams)
        _migrate_chapter_voice(conn)


def _migrate_v3_reduce_schema(conn):
    """P9000: migrate segments/voice_profiles/roles to v3 schema.

    Adds voice/audio JSON columns, migrates old flat data, drops old columns.
    SQLite doesn't support DROP COLUMN in old versions, so we use table recreate.
    """
    import json
    import logging
    logger = logging.getLogger(__name__)

    # ── Build column sets ──
    seg_cols = {c["name"] for c in inspect(conn).get_columns("segmented_project_segments")}
    vp_cols = {c["name"] for c in inspect(conn).get_columns("voice_profiles")}
    role_cols = {c["name"] for c in inspect(conn).get_columns("roles")}

    # ── segments: add voice + audio + drop old columns ──
    _run_alter_or_skip(conn, "ALTER TABLE segmented_project_segments ADD COLUMN voice JSON NOT NULL DEFAULT '{\"source\":\"chapter\"}'")
    _run_alter_or_skip(conn, "ALTER TABLE segmented_project_segments ADD COLUMN audio JSON")

    # Migrate data if old columns still exist and voice data is empty
    if "params" in seg_cols:
        logger.info("[migration] P9000: migrating segment data to voice/audio")
        seg_rows = conn.execute(text(
            "SELECT id, params, voice_ref, locked_params, ssml, role_id, "
            "current_audio_path, previous_audio_path, audio_format, duration_sec "
            "FROM segmented_project_segments"
        )).fetchall()
        for s in seg_rows:
            sid, sp, svr, slp, s_ssml, s_role_id, s_cur, s_prev, s_fmt, s_dur = s
            sp_dict = json.loads(sp) if sp else {}
            svr_dict = json.loads(svr) if svr else None
            slp_list = json.loads(slp) if slp else []
            voice = _build_voice_from_legacy(sp_dict, svr_dict, slp_list, s_ssml, s_role_id)
            audio = None
            if s_cur or s_prev or s_fmt or s_dur is not None:
                audio = {"format": s_fmt or "mp3"}
                if s_cur: audio["current"] = {"id": None, "path": s_cur}
                if s_prev: audio["previous"] = {"id": None, "path": s_prev}
                if s_dur is not None: audio["duration_sec"] = s_dur
            conn.execute(text("UPDATE segmented_project_segments SET voice=:v, audio=:a WHERE id=:id"),
                         {"v": json.dumps(voice), "a": json.dumps(audio) if audio else None, "id": sid})
        logger.info(f"[migration] P9000: migrated {len(seg_rows)} segment rows")

    _drop_columns_via_recreate(conn, "segmented_project_segments", [
        "project_id", "ssml", "params", "voice_ref", "locked_params",
        "current_audio_path", "previous_audio_path", "audio_format",
        "duration_sec", "audio_missing", "ssml_annotated_by_llm",
        "prosody_marks", "role_snapshot",
    ])

    # ── voice_profiles: add engine + drop old columns ──
    _run_alter_or_skip(conn, "ALTER TABLE voice_profiles ADD COLUMN engine JSON NOT NULL DEFAULT '{}'")

    if "qwen_voice_id" in vp_cols or "external_audio_url" in vp_cols:
        logger.info("[migration] P9000: migrating voice_profile data to engine")
        vp_rows = conn.execute(text(
            "SELECT id, qwen_voice_id, external_audio_url, mimo_voice_id, prompt_text, "
            "clone_engine, is_cloned, cloned_at FROM voice_profiles"
        )).fetchall()
        for v in vp_rows:
            vid, vq, ve, vm, vp_text, vc, vi, vca = v
            eng = {}
            if vc: eng["type"] = vc
            if vq: eng["qwen_voice_id"] = vq
            if ve: eng["external_audio_url"] = ve
            if vm: eng["mimo_voice_id"] = vm
            if vp_text: eng["prompt_text"] = vp_text
            if vi is not None: eng["is_cloned"] = bool(vi)
            if vca: eng["cloned_at"] = vca
            conn.execute(text("UPDATE voice_profiles SET engine=:e WHERE id=:id"),
                         {"e": json.dumps(eng), "id": vid})
        logger.info(f"[migration] P9000: migrated {len(vp_rows)} voice_profiles")

    _drop_columns_via_recreate(conn, "voice_profiles", [
        "qwen_voice_id", "external_audio_url", "mimo_voice_id", "prompt_text",
        "clone_engine", "is_cloned", "cloned_at", "voice_engine_type",
        "engine_type", "engine_sub_type", "role",
    ])

    # ── roles: add voice + drop old columns ──
    _run_alter_or_skip(conn, "ALTER TABLE roles ADD COLUMN voice JSON NOT NULL DEFAULT '{\"engine\":\"edge_tts\",\"params\":{}}'")

    if "default_engine" in role_cols:
        logger.info("[migration] P9000: migrating role data to voice")
        role_rows = conn.execute(text(
            "SELECT id, default_engine, default_voice, default_engine_params FROM roles"
        )).fetchall()
        for r in role_rows:
            rid, re, rv, rp = r
            rp_dict = json.loads(rp) if rp else {}
            voice = {"engine": re or "edge_tts", "params": rp_dict}
            if rv:
                engine = re or "edge_tts"
                if engine in ("cosyvoice", "voxcpm", "mimo_tts"):
                    voice["params"]["voice_id"] = rv
                elif engine == "edge_tts":
                    voice["params"]["voice"] = rv
            conn.execute(text("UPDATE roles SET voice=:v WHERE id=:id"),
                         {"v": json.dumps(voice), "id": rid})
        logger.info(f"[migration] P9000: migrated {len(role_rows)} roles")

    _drop_columns_via_recreate(conn, "roles", ["default_engine", "default_voice", "default_engine_params"])

    # ── chapters: drop narration columns ──
    if "narration_document_id" in {c["name"] for c in inspect(conn).get_columns("segmented_project_chapters")}:
        _drop_columns_via_recreate(conn, "segmented_project_chapters", [
            "narration_document_id", "narration_version",
            "narration_slice_start", "narration_slice_end", "narration_synced_at",
        ])
        logger.info("[migration] P9000: dropped narration columns from chapters")

    # ── projects: drop active_narration_version ──
    if "active_narration_version" in {c["name"] for c in inspect(conn).get_columns("segmented_projects")}:
        _drop_columns_via_recreate(conn, "segmented_projects", ["active_narration_version"])
        logger.info("[migration] P9000: dropped active_narration_version from projects")

    # ── P9001: fix segments whose voice.source should be 'role' but is 'custom' ──
    _fix_role_source_segments(conn, logger)


def _migrate_chapter_voice(conn):
    """P9002: unify chapter voice params into a single voice JSON (EngineParams format).

    Combines chapter.engine + chapter.default_params into chapter.voice,
    then drops the old engine and default_params columns.
    """
    import json
    import logging
    logger = logging.getLogger(__name__)

    # Check if voice column already exists
    col_info = conn.execute(text("PRAGMA table_info(segmented_project_chapters)")).fetchall()
    col_names = {c[1] for c in col_info}
    if "voice" in col_names:
        logger.info("[migration] P9002: voice column already exists, skipping")
        return

    # Add voice column
    conn.execute(text("ALTER TABLE segmented_project_chapters ADD COLUMN voice JSON NOT NULL DEFAULT '{}'"))

    # Migrate data: build EngineParams from engine + default_params
    rows = conn.execute(text(
        "SELECT id, engine, default_params FROM segmented_project_chapters"
    )).fetchall()

    migrated = 0
    for row in rows:
        ch_id, engine, default_params_json = row
        engine_type = engine or "edge_tts"
        dp = json.loads(default_params_json) if default_params_json else {}

        # Build EngineParams dict based on engine type
        voice: dict[str, object] = {"engine": engine_type}
        if engine_type == "edge_tts":
            voice["voice"] = dp.get("edge_voice", "")
            voice["rate"] = str(dp.get("edge_rate", "+0%"))
            voice["volume"] = str(dp.get("edge_volume", "+0%"))
        elif engine_type == "cosyvoice":
            voice["voice_id"] = dp.get("voice_id", "")
            voice["speed"] = dp.get("speed", 1.0)
            voice["volume"] = dp.get("volume", 80)
            voice["pitch"] = dp.get("pitch", 1.0)
            voice["language"] = dp.get("language", "Chinese")
            voice["instruction"] = dp.get("instruction", "")
        elif engine_type == "mimo_tts":
            mode = dp.get("mimo_mode", "preset")
            voice["mode"] = mode
            if mode == "preset":
                voice["voice_id"] = dp.get("mimo_preset_voice", "")
            elif mode in ("voiceclone", "voicedesign"):
                voice["voice_id"] = dp.get("mimo_clone_voice_id", "")
            voice["instruction"] = dp.get("mimo_instruction", "")
            if dp.get("mimo_voice_description"):
                voice["voice_description"] = dp["mimo_voice_description"]
        elif engine_type == "voxcpm":
            voice["mode"] = dp.get("voxcpm_mode", "clone")
            voice["voice_id"] = dp.get("voice_id", "")
            if dp.get("voxcpm_style_control"):
                voice["style_control"] = dp.get("voxcpm_style_control")
            if dp.get("voxcpm_cfg_value"):
                voice["cfg_value"] = dp["voxcpm_cfg_value"]
            if dp.get("voxcpm_inference_timesteps"):
                voice["inference_timesteps"] = dp["voxcpm_inference_timesteps"]

        conn.execute(
            text("UPDATE segmented_project_chapters SET voice = :voice WHERE id = :id"),
            {"voice": json.dumps(voice), "id": ch_id},
        )
        migrated += 1

    logger.info(f"[migration] P9002: migrated {migrated} chapter voice params")

    # Drop engine and default_params columns via table recreate
    _drop_columns_via_recreate(conn, "segmented_project_chapters", ["engine", "default_params"])
    logger.info("[migration] P9002: dropped engine, default_params columns from chapters")


def _fix_role_source_segments(conn, logger):
    """Fix segments that have role_id but voice.source = 'custom' (migration bug)."""
    import json

    rows = conn.execute(text(
        "SELECT id, voice, role_id FROM segmented_project_segments "
        "WHERE role_id IS NOT NULL AND json_extract(voice, '$.source') = 'custom'"
    )).fetchall()

    fixed = 0
    for sid, sv, role_id in rows:
        voice = json.loads(sv) if sv else {}
        voice["source"] = "role"
        voice["role_id"] = role_id
        voice.pop("engine", None)
        voice.pop("params", None)
        conn.execute(text("UPDATE segmented_project_segments SET voice=:v WHERE id=:id"),
                     {"v": json.dumps(voice), "id": sid})
        fixed += 1

    if fixed:
        logger.info(f"[migration] P9001: fixed {fixed} segment(s) — changed voice.source from 'custom' to 'role'")


def _build_voice_from_legacy(params_dict, voice_ref_dict, locked_params_list, ssml_text, role_id):
    """Build VoiceSource JSON from legacy segment data."""
    # If segment has a role, it's always role-source
    if role_id:
        return {"source": "role", "role_id": role_id}

    overridden = any(k in (locked_params_list or []) for k in params_dict)

    if overridden:
        engine = params_dict.get("engine", "edge_tts")
        result = {"source": "custom", "engine": engine, "params": {}}
        # Convert old flat field names → new EngineParams format
        if engine == "edge_tts":
            result["params"]["voice"] = params_dict.get("edge_voice", "")
            result["params"]["rate"] = params_dict.get("edge_rate", "+0%")
            result["params"]["volume"] = params_dict.get("edge_volume", "+0%")
        elif engine == "mimo_tts":
            mode = params_dict.get("mimo_mode", "voiceclone")
            result["params"]["mode"] = "preset" if mode == "preset" else mode
            if mode == "preset":
                result["params"]["voice_id"] = params_dict.get("mimo_preset_voice", "")
            elif mode == "voiceclone":
                result["params"]["voice_id"] = params_dict.get("mimo_clone_voice_id", "")
            elif mode == "voicedesign":
                result["params"]["voice_id"] = params_dict.get("mimo_clone_voice_id", "")
                result["params"]["voice_description"] = params_dict.get("mimo_voice_description", "")
            if params_dict.get("mimo_instruction"):
                result["params"]["instruction"] = params_dict["mimo_instruction"]
        elif engine == "cosyvoice":
            result["params"]["voice_id"] = params_dict.get("voice_id", "")
            if params_dict.get("instruction"):
                result["params"]["instruction"] = params_dict["instruction"]
            for k in ("speed", "volume", "pitch", "language"):
                if params_dict.get(k) is not None:
                    result["params"][k] = params_dict[k]
        elif engine == "voxcpm":
            voxcpm_mode = params_dict.get("voxcpm_mode", "tts_design")
            mode_map = {"design": "tts_design", "clone": "clone", "ultimate": "ultimate"}
            result["params"]["mode"] = mode_map.get(voxcpm_mode, "tts_design")
            result["params"]["voice_id"] = params_dict.get("voice_id", "")
            if params_dict.get("voxcpm_voice_description"):
                result["params"]["voice_description"] = params_dict["voxcpm_voice_description"]
        # Include ssml if cosyvoice
        if engine == "cosyvoice" and ssml_text:
            result["params"]["ssml"] = ssml_text
        return result

    return {"source": "chapter"}


def _drop_columns_via_recreate(conn, table_name, columns_to_drop):
    """Drop columns from a SQLite table by recreating it without those columns."""
    col_info = conn.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
    keep_cols = [(c[1], c[2]) for c in col_info if c[1] not in set(columns_to_drop)]

    # 1. Create temp table
    col_defs = ", ".join(f'"{n}" {t}' for n, t in keep_cols)
    conn.execute(text(f"CREATE TABLE IF NOT EXISTS {table_name}_tmp ({col_defs})"))

    # 2. Copy data
    col_names = ", ".join(f'"{n}"' for n, _ in keep_cols)
    conn.execute(text(f"INSERT INTO {table_name}_tmp ({col_names}) SELECT {col_names} FROM {table_name}"))

    # 3. Swap
    conn.execute(text(f"DROP TABLE {table_name}"))
    conn.execute(text(f"ALTER TABLE {table_name}_tmp RENAME TO {table_name}"))