"""SegmentedProject 仓储（步骤 3B）。

方法签名提取自 segmented_projects.py 路由的实际调用（YAGNI）——只覆盖
workers 模式必需的元数据链路：项目/章节/分段 CRUD、batch、split、layer-sync、
animation spec。合成/ffmpeg/文件落盘（synthesize_segment、录音上传、导出、
adjust-audio、migrate、project export/import）不抽象，那些端点是 local-only。

Local 薄封装 segmented_project_service（事务与文件镜像都在 service 内）；
Supabase 走 PostgREST，语义对齐 svc.save_project 的全量保存模型：
- 章节/分段整体 reconcile（删旧插新），保留 payload 未覆盖的行状态
  （created_at / sync_state / audio_adjust / split_anchor）；
- 章节/分段的 position 唯一约束靠「先删后插」规避（不对单行做位置交换）；
- 文件系统镜像（manifest/原文档/分段文本落盘）是本地资产行为，workers 不做。

workers 模式已知取舍（写进设计缺口，非 bug）：
- 项目级长文档：source_document 内容直接存 source_document 文本列（本地模式
  该列已弃用、内容落文件）；narration_script（项目级）没有对应文本列，本步
  不支持（workers 模式不跑 agent 工作流，前端拿不到也传不回该字段）；
- 音频二进制不进后端：分段 audio JSON 由前端写 {current: {audio_id}} 引用
  IndexedDB；summary 的 generated_count 把 audio_id 与 path 同等计数。
"""
from __future__ import annotations

import logging
import uuid
from types import SimpleNamespace
from typing import Any, Protocol, runtime_checkable

from app.core.supabase_client import SupabaseClient
from app.core.time_utils import utcnow
from app.schemas.segmented_project import (
    ChapterIn,
    ProjectDetail,
    ProjectIn,
    ProjectSummary,
    SegmentIn,
)

# workers bundle 不含 sqlalchemy：Local* 只在 local 模式实例化。
try:
    from sqlalchemy.orm import Session

    from app.services import segmented_project_service as svc
except ImportError:  # workers bundle
    Session = Any  # type: ignore[assignment,misc]
    svc = None  # type: ignore[assignment]
from app.services.layer_sync_service import (
    mark_consistent,
    mark_split,
    rewrite_script_from_segments as ls_rewrite_script_from_segments,
    sync_status as ls_sync_status,
)
from app.services.animation_spec_codec import (
    _dump_animation_spec,
    _parse_animation_spec,
)
from app.services.text_split_service import rule_split

logger = logging.getLogger(__name__)

PROJECTS = "segmented_projects"
CHAPTERS = "segmented_project_chapters"
SEGMENTS = "segmented_project_segments"

_DEFAULT_SPLIT_CONFIG = {"delimiters": ["，", "。", "！", "？", "；"], "mode": "rule"}
_DEFAULT_VOICE = {"engine": "edge_tts", "voice": "zh-CN-YunxiNeural", "rate": "+0%", "volume": "+0%"}


@runtime_checkable
class SegmentedProjectRepository(Protocol):
    def list_projects(self) -> list[ProjectSummary]: ...
    def get_project(self, project_id: str) -> ProjectDetail | None: ...
    def project_exists(self, project_id: str) -> bool: ...
    def save_project(self, project: ProjectIn) -> ProjectDetail: ...
    def delete_project(self, project_id: str) -> bool: ...
    def batch_create_structure(
        self, project_id: str, chapters: list[dict[str, Any]], narration_script: str | None = None
    ) -> list[dict[str, Any]]: ...  # LookupError("project_not_found")
    def apply_animation_spec(
        self, project_id: str, theme: str | None, items: list[dict[str, Any]]
    ) -> dict[str, Any]: ...  # LookupError(f"project_not_found: {id}")
    def get_sync_status(self, project_id: str, chapter_id: str) -> dict[str, bool] | None: ...
    def resplit_from_script(self, project_id: str, chapter_id: str) -> ProjectDetail: ...
    def rewrite_script_from_segments(self, project_id: str, chapter_id: str) -> str: ...
    def split_replace_segments(
        self, project_id: str, chapter_id: str, texts: list[str]
    ) -> ProjectDetail: ...


# ---------------------------------------------------------------------------
# Local 实现：薄封装现有 service（零行为变化）
# ---------------------------------------------------------------------------


class LocalSegmentedProjectRepository:
    """委托 segmented_project_service；事务（commit）都在 service 函数内部。"""

    def __init__(self, db: Session):
        self._db = db

    def list_projects(self) -> list[ProjectSummary]:
        return svc.list_projects(self._db)

    def get_project(self, project_id: str) -> ProjectDetail | None:
        return svc.get_project_detail(self._db, project_id)

    def project_exists(self, project_id: str) -> bool:
        return svc.get_project_row(self._db, project_id) is not None

    def save_project(self, project: ProjectIn) -> ProjectDetail:
        return svc.save_project(self._db, project)

    def delete_project(self, project_id: str) -> bool:
        return svc.delete_project(self._db, project_id)

    def batch_create_structure(
        self, project_id: str, chapters: list[dict[str, Any]], narration_script: str | None = None
    ) -> list[dict[str, Any]]:
        return svc.batch_create_structure(self._db, project_id, chapters, narration_script)

    def apply_animation_spec(
        self, project_id: str, theme: str | None, items: list[dict[str, Any]]
    ) -> dict[str, Any]:
        return svc.apply_animation_spec(self._db, project_id, theme, items)

    def get_sync_status(self, project_id: str, chapter_id: str) -> dict[str, bool] | None:
        chapter = svc.get_chapter_row(self._db, project_id, chapter_id)
        if chapter is None:
            return None
        return ls_sync_status(chapter)

    def resplit_from_script(self, project_id: str, chapter_id: str) -> ProjectDetail:
        return svc.resplit_from_script(self._db, project_id, chapter_id)

    def rewrite_script_from_segments(self, project_id: str, chapter_id: str) -> str:
        chapter = svc.get_chapter_row(self._db, project_id, chapter_id)
        if chapter is None:
            raise LookupError("chapter_not_found")
        new_script = ls_rewrite_script_from_segments(chapter)
        self._db.commit()
        return new_script

    def split_replace_segments(
        self, project_id: str, chapter_id: str, texts: list[str]
    ) -> ProjectDetail:
        """从原 split_chapter 路由搬入的替换实现（行为逐字不变）。"""
        proj = svc.get_project_row(self._db, project_id)
        chapter = svc.get_chapter_row(self._db, project_id, chapter_id)
        if proj is None or chapter is None:
            raise LookupError("chapter_not_found")
        payload = ProjectIn(
            id=proj.id, name=proj.name, schema_version=proj.schema_version,
            layout=proj.layout, active_chapter_id=proj.active_chapter_id,
            original_text=proj.original_text,
            animation_theme=getattr(proj, "animation_theme", None),
            remotion_project_path=getattr(proj, "remotion_project_path", None),
            configs=getattr(proj, "configs", None),
            source_document=getattr(proj, "source_document", None),
            narration_script=getattr(proj, "narration_script", None),
            default_narrator_role_id=getattr(proj, "default_narrator_role_id", None),
            logo=getattr(proj, "logo", None),
            chapters=[
                {
                    "id": c.id, "position": c.position, "name": c.name,
                    "voice": c.voice or {},
                    "split_config": c.split_config or {},
                    "original_text": c.original_text,
                    "narration_script": c.narration_script,
                    "design_title": getattr(c, "design_title", None),
                    "segments": (
                        [
                            {
                                "id": f"{c.id}-seg-{idx}",
                                "position": idx, "text": t,
                                "params": c.voice or {},
                                "locked_params": [],
                            }
                            for idx, t in enumerate(texts)
                        ]
                        if c.id == chapter_id else
                        [
                            {
                                "id": s.id, "position": s.position, "text": s.text,
                                "emotion": s.emotion,
                                "voice": getattr(s, "voice", {"source": "chapter"}),
                                "generated_params": s.generated_params,
                                "audio": getattr(s, "audio", None),
                            }
                            for s in c.segments
                        ]
                    ),
                }
                for c in proj.chapters
            ],
        )
        detail = svc.save_project(self._db, payload)
        # layer-sync: split just regenerated segments from L2 -> re-baseline L2/L3.
        ch_row = svc.get_chapter_row(self._db, project_id, chapter_id)
        if ch_row is not None:
            mark_split(ch_row)
            self._db.commit()
        return detail


# ---------------------------------------------------------------------------
# Supabase 实现：PostgREST
# ---------------------------------------------------------------------------


def _seg_row_to_in(row: dict) -> SegmentIn:
    return SegmentIn(
        id=row["id"],
        position=row.get("position"),
        text=row.get("text") or "",
        emotion=row.get("emotion"),
        role_id=row.get("role_id"),
        segment_kind=row.get("segment_kind") or "narration",
        voice=row.get("voice") or {"source": "chapter"},
        generated_params=row.get("generated_params"),
        audio=row.get("audio"),
        generated_at=row.get("generated_at"),
        animation_spec=_parse_animation_spec(row.get("animation_spec_json")),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


def _ch_row_to_in(row: dict, seg_rows: list[dict]) -> ChapterIn:
    return ChapterIn(
        id=row["id"],
        position=row.get("position"),
        name=row["name"],
        voice=row.get("voice") or {},
        split_config=row.get("split_config") or {},
        original_text=row.get("original_text"),
        narration_script=row.get("narration_script"),
        design_title=row.get("design_title"),
        audio_adjust=row.get("audio_adjust"),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
        segments=[_seg_row_to_in(s) for s in seg_rows],
    )


def _rows_to_detail(
    p_row: dict, ch_rows: list[dict], seg_rows: list[dict]
) -> ProjectDetail:
    segs_by_chapter: dict[str, list[dict]] = {}
    for s in seg_rows:
        segs_by_chapter.setdefault(s["chapter_id"], []).append(s)
    chapters = []
    for ch in sorted(ch_rows, key=lambda c: c.get("position") or 0):
        segs = sorted(segs_by_chapter.get(ch["id"], []), key=lambda s: s.get("position") or 0)
        chapters.append(_ch_row_to_in(ch, segs))
    return ProjectDetail(
        id=p_row["id"],
        name=p_row["name"],
        schema_version=p_row.get("schema_version") or 2,
        layout=p_row.get("layout") or "vertical",
        active_chapter_id=p_row.get("active_chapter_id"),
        original_text=p_row.get("original_text"),
        animation_theme=p_row.get("animation_theme"),
        remotion_project_path=p_row.get("remotion_project_path"),
        # workers：源文档内容直接存文本列（本地模式是弃用列 + 文件路径）
        source_document=p_row.get("source_document"),
        # 项目级旁白稿无文本列（本地存文件），workers 本步不支持 → 恒 None
        narration_script=None,
        source_document_path=p_row.get("source_document_path"),
        narration_document_path=p_row.get("narration_document_path"),
        default_narrator_role_id=p_row.get("default_narrator_role_id"),
        logo=p_row.get("logo"),
        configs=p_row.get("configs"),
        created_at=p_row.get("created_at"),
        updated_at=p_row.get("updated_at"),
        chapters=chapters,
    )


def _row_to_summary(p_row: dict, ch_rows: list[dict], seg_rows: list[dict]) -> ProjectSummary:
    generated_count = 0
    duration_sec = 0.0
    for s in seg_rows:
        audio = s.get("audio") or {}
        current = audio.get("current") or {}
        # workers 前端存储模式用 audio_id 引用 IndexedDB；与本地 path 同等计数
        if current.get("path") or current.get("audio_id"):
            generated_count += 1
        duration_sec += float(current.get("duration_sec") or 0)
    return ProjectSummary(
        id=p_row["id"],
        name=p_row["name"],
        schema_version=p_row.get("schema_version") or 2,
        layout=p_row.get("layout") or "vertical",
        active_chapter_id=p_row.get("active_chapter_id"),
        remotion_project_path=p_row.get("remotion_project_path"),
        summary_stats={
            "chapter_count": len(ch_rows),
            "segment_count": len(seg_rows),
            "generated_count": generated_count,
            "duration_sec": round(duration_sec, 2),
        },
        created_at=p_row.get("created_at") or "",
        updated_at=p_row.get("updated_at") or "",
    )


def _chapter_stand_in(ch_row: dict, seg_rows: list[dict]):
    """layer_sync_service 是鸭子类型（getattr），用 SimpleNamespace 复用其纯逻辑。"""
    segs = [
        SimpleNamespace(
            text=s.get("text"),
            position=s.get("position"),
            split_anchor=s.get("split_anchor"),
        )
        for s in sorted(seg_rows, key=lambda s: s.get("position") or 0)
    ]
    chapter = SimpleNamespace(
        original_text=ch_row.get("original_text"),
        narration_script=ch_row.get("narration_script"),
        sync_state=ch_row.get("sync_state"),
        segments=segs,
    )
    return chapter, segs


class SupabaseSegmentedProjectRepository:
    """PostgREST 实现。无本地 FS 依赖；多步写无事务（PostgREST 限制），单用户规模可接受。"""

    def __init__(self, client: SupabaseClient):
        self._client = client

    # ----- 查询 -----

    def _get_project_row(self, project_id: str) -> dict | None:
        return self._client.select_one(PROJECTS, params={"id": f"eq.{project_id}"})

    def _list_chapter_rows(self, project_id: str) -> list[dict]:
        return self._client.select(
            CHAPTERS, params={"project_id": f"eq.{project_id}", "order": "position.asc"}
        )

    def _list_segment_rows(self, chapter_ids: list[str]) -> list[dict]:
        if not chapter_ids:
            return []
        return self._client.select(
            SEGMENTS,
            params={"chapter_id": f"in.({','.join(chapter_ids)})", "order": "position.asc"},
        )

    def _get_chapter_row(self, project_id: str, chapter_id: str) -> dict | None:
        return self._client.select_one(
            CHAPTERS, params={"id": f"eq.{chapter_id}", "project_id": f"eq.{project_id}"}
        )

    def list_projects(self) -> list[ProjectSummary]:
        projects = self._client.select(PROJECTS, params={"order": "updated_at.desc"})
        chapters = self._client.select(CHAPTERS)
        segments = self._client.select(SEGMENTS)
        return [
            _row_to_summary(
                p,
                [c for c in chapters if c["project_id"] == p["id"]],
                [s for s in segments if s["chapter_id"] in {c["id"] for c in chapters if c["project_id"] == p["id"]}],
            )
            for p in projects
        ]

    def get_project(self, project_id: str) -> ProjectDetail | None:
        p_row = self._get_project_row(project_id)
        if p_row is None:
            return None
        ch_rows = self._list_chapter_rows(project_id)
        seg_rows = self._list_segment_rows([c["id"] for c in ch_rows])
        return _rows_to_detail(p_row, ch_rows, seg_rows)

    def project_exists(self, project_id: str) -> bool:
        return (
            self._client.select_one(PROJECTS, params={"id": f"eq.{project_id}", "select": "id"})
            is not None
        )

    # ----- 全量保存 -----

    def save_project(self, project: ProjectIn) -> ProjectDetail:
        now = utcnow().isoformat()
        existing_p = self._get_project_row(project.id)
        # 先读出要保留的行状态（全量 reconcile 是删旧插新，否则这些列会丢）
        old_chapters = self._list_chapter_rows(project.id) if existing_p else []
        old_ch_by_id = {c["id"]: c for c in old_chapters}
        old_seg_by_id = {
            s["id"]: s for s in self._list_segment_rows(list(old_ch_by_id))
        }

        p_row: dict[str, Any] = {
            "id": project.id,
            "name": project.name,
            "schema_version": project.schema_version,
            "layout": project.layout,
            "active_chapter_id": project.active_chapter_id,
            "original_text": project.original_text,
            "animation_theme": project.animation_theme,
            "remotion_project_path": project.remotion_project_path,
            "default_narrator_role_id": project.default_narrator_role_id,
            "configs": project.configs,
            "logo": project.logo,
            "created_at": project.created_at or (existing_p or {}).get("created_at") or now,
            "updated_at": now,
        }
        if existing_p:
            # 保留本地资产路径类列（workers 恒 None，但不主动清）
            for key in ("source_document_path", "narration_document_path"):
                if existing_p.get(key) is not None:
                    p_row[key] = existing_p[key]
        if project.source_document is not None:
            # workers：源文档内容直接存文本列；None 表示不更新（对齐 svc 语义）
            p_row["source_document"] = project.source_document
        elif existing_p and existing_p.get("source_document") is not None:
            p_row["source_document"] = existing_p["source_document"]
        if project.narration_script is not None:
            logger.warning(
                "[supabase] project-level narration_script is not persisted in workers mode "
                "(project %s)", project.id,
            )
        self._client.insert(PROJECTS, [p_row], upsert=True)

        # 整体替换章节/分段（先删后插，绕开 position 唯一约束的行级冲突）
        if old_ch_by_id:
            self._client.delete(
                SEGMENTS, params={"chapter_id": f"in.({','.join(old_ch_by_id)})"}
            )
            self._client.delete(CHAPTERS, params={"project_id": f"eq.{project.id}"})

        ch_rows: list[dict[str, Any]] = []
        seg_rows: list[dict[str, Any]] = []
        for ch_idx, ch_in in enumerate(project.chapters):
            prev_ch = old_ch_by_id.get(ch_in.id, {})
            ch_rows.append({
                "id": ch_in.id,
                "project_id": project.id,
                "position": ch_in.position if ch_in.position is not None else ch_idx,
                "name": ch_in.name,
                "voice": ch_in.voice or {},
                "split_config": ch_in.split_config or {},
                "original_text": ch_in.original_text,
                "narration_script": ch_in.narration_script,
                "design_title": ch_in.design_title,
                # audio_adjust/sync_state 只能由专门端点管理，payload 忽略、保留旧值
                "sync_state": prev_ch.get("sync_state"),
                "audio_adjust": prev_ch.get("audio_adjust"),
                "created_at": ch_in.created_at or prev_ch.get("created_at") or now,
                "updated_at": now,
            })
            for seg_idx, s_in in enumerate(ch_in.segments):
                prev_seg = old_seg_by_id.get(s_in.id, {})
                seg_rows.append({
                    "id": s_in.id,
                    "chapter_id": ch_in.id,
                    "position": s_in.position if s_in.position is not None else seg_idx,
                    "text": s_in.text or "",
                    "emotion": s_in.emotion,
                    "role_id": s_in.role_id,
                    "segment_kind": s_in.segment_kind or "narration",
                    "voice": s_in.voice or {"source": "chapter"},
                    # None 表示 payload 未携带 → 保留旧值（对齐 svc.save_project）
                    "generated_params": (
                        s_in.generated_params
                        if s_in.generated_params is not None
                        else prev_seg.get("generated_params")
                    ),
                    "audio": s_in.audio if s_in.audio is not None else prev_seg.get("audio"),
                    "generated_at": s_in.generated_at,
                    "animation_spec_json": (
                        _dump_animation_spec(s_in.animation_spec)
                        if s_in.animation_spec is not None
                        else prev_seg.get("animation_spec_json")
                    ),
                    # split_anchor 由 layer-sync 端点管理，payload 没有此字段 → 保留
                    "split_anchor": prev_seg.get("split_anchor"),
                    "created_at": s_in.created_at or prev_seg.get("created_at") or now,
                    "updated_at": now,
                })
        if ch_rows:
            self._client.insert(CHAPTERS, ch_rows)
        if seg_rows:
            self._client.insert(SEGMENTS, seg_rows)
        detail = self.get_project(project.id)
        assert detail is not None
        return detail

    def delete_project(self, project_id: str) -> bool:
        if not self.project_exists(project_id):
            return False
        ch_ids = [c["id"] for c in self._list_chapter_rows(project_id)]
        if ch_ids:
            self._client.delete(SEGMENTS, params={"chapter_id": f"in.({','.join(ch_ids)})"})
        self._client.delete(CHAPTERS, params={"project_id": f"eq.{project_id}"})
        # 对齐 svc.delete_project：显式清理源（不依赖 PG FK cascade 单点）
        self._client.delete("source_documents", params={"project_id": f"eq.{project_id}"})
        self._client.delete(PROJECTS, params={"id": f"eq.{project_id}"})
        return True

    # ----- batch（agent split_segment 节点 / 前端批量建结构） -----

    def batch_create_structure(
        self, project_id: str, chapters: list[dict[str, Any]], narration_script: str | None = None
    ) -> list[dict[str, Any]]:
        now = utcnow().isoformat()
        if not self.project_exists(project_id):
            raise LookupError("project_not_found")
        if narration_script is not None:
            logger.warning(
                "[supabase] project-level narration_script is not persisted in workers mode "
                "(project %s)", project_id,
            )

        old_chapters = self._list_chapter_rows(project_id)
        # default voice：第一个现有章节，或 edge_tts 默认（对齐 svc）
        default_voice = dict(_DEFAULT_VOICE)
        if old_chapters:
            ch_voice = old_chapters[0].get("voice") or {}
            if ch_voice.get("voice") and ch_voice.get("engine") == "edge_tts":
                default_voice = ch_voice
            elif ch_voice.get("voice_id") and ch_voice.get("engine") in (
                "cosyvoice", "mimo_tts", "voxcpm"
            ):
                default_voice = ch_voice

        if old_chapters:
            self._client.delete(
                SEGMENTS,
                params={"chapter_id": f"in.({','.join(c['id'] for c in old_chapters)})"},
            )
            self._client.delete(CHAPTERS, params={"project_id": f"eq.{project_id}"})

        result: list[dict[str, Any]] = []
        ch_rows: list[dict[str, Any]] = []
        seg_rows: list[dict[str, Any]] = []
        for index, ch_data in enumerate(chapters):
            chapter_id = str(uuid.uuid4())
            title = ch_data.get("chapter_title", f"Chapter {index + 1}")
            voice = dict(default_voice)
            engine = ch_data.get("engine")
            if engine:
                voice["engine"] = engine
            seg_result = []
            new_segs = []
            for position, seg_data in enumerate(ch_data.get("segments", [])):
                seg_id = str(uuid.uuid4())
                row = {
                    "id": seg_id,
                    "chapter_id": chapter_id,
                    "position": position,
                    "text": seg_data["text"],
                    "emotion": seg_data.get("emotion"),
                    "role_id": None,
                    "segment_kind": seg_data.get("segment_kind", "narration"),
                    "voice": {"source": "chapter"},
                    "created_at": now,
                    "updated_at": now,
                }
                new_segs.append(row)
                seg_result.append({"id": seg_id})
            # layer-sync：L2/L3 同批产出 → 三层基线一次性快照（mark_consistent）
            stand_in, seg_ns = _chapter_stand_in(
                {
                    "original_text": ch_data.get("original_text"),
                    "narration_script": ch_data.get("narration_script"),
                    "sync_state": None,
                },
                new_segs,
            )
            mark_consistent(stand_in)
            for row, ns in zip(new_segs, seg_ns):
                row["split_anchor"] = ns.split_anchor
            ch_rows.append({
                "id": chapter_id,
                "project_id": project_id,
                "position": index,
                "name": title,
                "voice": voice,
                "split_config": dict(_DEFAULT_SPLIT_CONFIG),
                "original_text": ch_data.get("original_text"),
                "narration_script": ch_data.get("narration_script"),
                "sync_state": stand_in.sync_state,
                "created_at": now,
                "updated_at": now,
            })
            seg_rows.extend(new_segs)
            result.append({"id": chapter_id, "segments": seg_result})
        if ch_rows:
            self._client.insert(CHAPTERS, ch_rows)
        if seg_rows:
            self._client.insert(SEGMENTS, seg_rows)
        return result

    # ----- animation spec -----

    def apply_animation_spec(
        self, project_id: str, theme: str | None, items: list[dict[str, Any]]
    ) -> dict[str, Any]:
        if not self.project_exists(project_id):
            raise LookupError(f"project_not_found: {project_id}")
        now = utcnow().isoformat()

        theme_updated = False
        if theme is not None:
            self._client.update(
                PROJECTS,
                {"animation_theme": theme, "updated_at": now},
                params={"id": f"eq.{project_id}"},
            )
            theme_updated = True

        ch_ids = [c["id"] for c in self._list_chapter_rows(project_id)]
        seg_index = {s["id"]: s for s in self._list_segment_rows(ch_ids)}

        updated = 0
        missing: list[str] = []
        for it in items:
            seg_id = it.get("segment_id")
            if not seg_id:
                continue
            seg = seg_index.get(seg_id)
            if seg is None:
                missing.append(seg_id)
                continue
            # 合并: 覆盖传入的所有非 None 字段 (segment_id 除外), 保留未传的
            merged = _parse_animation_spec(seg.get("animation_spec_json")) or {}
            for key, v in it.items():
                if key == "segment_id" or v is None:
                    continue
                merged[key] = v
            merged["generated_at"] = now
            self._client.update(
                SEGMENTS,
                {"animation_spec_json": _dump_animation_spec(merged), "updated_at": now},
                params={"id": f"eq.{seg_id}"},
            )
            updated += 1
        return {
            "theme_updated": theme_updated,
            "segments_updated": updated,
            "segments_skipped": len(missing),
            "missing_segment_ids": missing,
        }

    # ----- layer-sync -----

    def get_sync_status(self, project_id: str, chapter_id: str) -> dict[str, bool] | None:
        ch_row = self._get_chapter_row(project_id, chapter_id)
        if ch_row is None:
            return None
        seg_rows = self._list_segment_rows([chapter_id])
        stand_in, _ = _chapter_stand_in(ch_row, seg_rows)
        return ls_sync_status(stand_in)

    def resplit_from_script(self, project_id: str, chapter_id: str) -> ProjectDetail:
        ch_row = self._get_chapter_row(project_id, chapter_id)
        if ch_row is None:
            raise LookupError("chapter_not_found")
        now = utcnow().isoformat()
        delimiters = (ch_row.get("split_config") or {}).get(
            "delimiters", _DEFAULT_SPLIT_CONFIG["delimiters"]
        )
        items = rule_split(ch_row.get("narration_script") or "", delimiters)

        self._client.delete(SEGMENTS, params={"chapter_id": f"eq.{chapter_id}"})
        new_segs = [
            {
                "id": str(uuid.uuid4()),
                "chapter_id": chapter_id,
                "position": i,
                "text": text,
                "segment_kind": "narration",
                "voice": {"source": "chapter"},
                "created_at": now,
                "updated_at": now,
            }
            for i, text in enumerate(items)
        ]
        stand_in, seg_ns = _chapter_stand_in(ch_row, new_segs)
        mark_split(stand_in)
        for row, ns in zip(new_segs, seg_ns):
            row["split_anchor"] = ns.split_anchor
        if new_segs:
            self._client.insert(SEGMENTS, new_segs)
        self._client.update(
            CHAPTERS,
            {"sync_state": stand_in.sync_state, "updated_at": now},
            params={"id": f"eq.{chapter_id}"},
        )
        detail = self.get_project(project_id)
        assert detail is not None
        return detail

    def rewrite_script_from_segments(self, project_id: str, chapter_id: str) -> str:
        ch_row = self._get_chapter_row(project_id, chapter_id)
        if ch_row is None:
            raise LookupError("chapter_not_found")
        now = utcnow().isoformat()
        seg_rows = self._list_segment_rows([chapter_id])
        stand_in, seg_ns = _chapter_stand_in(ch_row, seg_rows)
        # ValueError("l2_dirty_conflict") 由路由映射 409
        new_script = ls_rewrite_script_from_segments(stand_in)
        self._client.update(
            CHAPTERS,
            {
                "narration_script": new_script,
                "sync_state": stand_in.sync_state,
                "updated_at": now,
            },
            params={"id": f"eq.{chapter_id}"},
        )
        for row, ns in zip(
            sorted(seg_rows, key=lambda s: s.get("position") or 0), seg_ns
        ):
            self._client.update(
                SEGMENTS,
                {"split_anchor": ns.split_anchor, "updated_at": now},
                params={"id": f"eq.{row['id']}"},
            )
        return new_script

    def split_replace_segments(
        self, project_id: str, chapter_id: str, texts: list[str]
    ) -> ProjectDetail:
        """workers 语义：只替换目标章节的分段（其余章节/分段行不动）。"""
        ch_row = self._get_chapter_row(project_id, chapter_id)
        if ch_row is None:
            raise LookupError("chapter_not_found")
        now = utcnow().isoformat()

        self._client.delete(SEGMENTS, params={"chapter_id": f"eq.{chapter_id}"})
        new_segs = [
            {
                "id": f"{chapter_id}-seg-{idx}",
                "chapter_id": chapter_id,
                "position": idx,
                "text": t,
                "segment_kind": "narration",
                "voice": {"source": "chapter"},
                "created_at": now,
                "updated_at": now,
            }
            for idx, t in enumerate(texts)
        ]
        stand_in, seg_ns = _chapter_stand_in(ch_row, new_segs)
        mark_split(stand_in)
        for row, ns in zip(new_segs, seg_ns):
            row["split_anchor"] = ns.split_anchor
        if new_segs:
            self._client.insert(SEGMENTS, new_segs)
        self._client.update(
            CHAPTERS,
            {"sync_state": stand_in.sync_state, "updated_at": now},
            params={"id": f"eq.{chapter_id}"},
        )
        self._client.update(PROJECTS, {"updated_at": now}, params={"id": f"eq.{project_id}"})
        detail = self.get_project(project_id)
        assert detail is not None
        return detail
