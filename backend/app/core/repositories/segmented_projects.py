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

import copy
import logging
import uuid
from types import SimpleNamespace
from typing import Any, Protocol, runtime_checkable

from app.core.supabase_client import SupabaseClient
from app.core.time_utils import utcnow
from app.core.config import settings
from app.core.repositories.user_scope import UserScope
from app.schemas.segmented_project import (
    ChapterCreateIn,
    ChapterIn,
    ChapterPatchIn,
    ProjectDetail,
    ProjectIn,
    ProjectPatchIn,
    ProjectSummary,
    SegmentCreateIn,
    SegmentIn,
    SegmentPatchIn,
    StalePayloadError,
    StructureSegmentIn,
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
from app.services.batch_reuse import (
    build_reuse_index,
    new_reuse_report,
    normalize_chapter_title,
    plan_batch_reuse,
    resolve_split_delimiters,
    snapshot_has_segments,
)

logger = logging.getLogger(__name__)

PROJECTS = "segmented_projects"
CHAPTERS = "segmented_project_chapters"
SEGMENTS = "segmented_project_segments"

_DEFAULT_SPLIT_CONFIG = {"delimiters": ["，", "。", "！", "？", "；"], "mode": "rule"}
_DEFAULT_VOICE = {"engine": "edge_tts", "voice": "zh-CN-YunxiNeural", "rate": "+0%", "volume": "+0%"}


def _max_segment_len() -> int | None:
    """max_segment_chars > 0 → 上限；否则 None（不限制）。local+workers 都生效。"""
    return settings.max_segment_chars if settings.max_segment_chars > 0 else None


@runtime_checkable
class SegmentedProjectRepository(Protocol):
    def list_projects(self) -> list[ProjectSummary]: ...
    def get_project(self, project_id: str) -> ProjectDetail | None: ...
    def project_exists(self, project_id: str) -> bool: ...
    def count_owned(self) -> int: ...
    def count_chapters(self, project_id: str) -> int: ...
    def save_project(self, project: ProjectIn) -> ProjectDetail: ...
    def patch_segment(
        self, project_id: str, chapter_id: str, segment_id: str, patch: SegmentPatchIn,
    ) -> tuple[SegmentIn, str] | None:
        """段级部分更新；返回 (更新后的段, 项目最新 updated_at)，不存在 → None。..."""
        ...
    def create_segment(
        self, project_id: str, chapter_id: str, body: SegmentCreateIn,
    ) -> tuple[SegmentIn, list[dict[str, Any]], str] | None:
        """新建段；返回 (新段, 章内 [{id, position}], 项目最新 updated_at)。

        章节不存在（或跨用户）→ None → 路由 404；after_id 在章内无对应段
        → ValueError("after_segment_not_found") → 路由 404 segment_not_found。
        """
        ...
    def reconcile_chapter_structure(
        self, project_id: str, chapter_id: str, segments: list[StructureSegmentIn],
    ) -> tuple[list[SegmentIn], str] | None:
        """章内结构 reconcile（删除/合并/拆段/排序）；返回 (该章全部段, 项目最新 updated_at)。

        章节不存在（或跨用户）→ None → 路由 404。
        """
        ...
    def create_chapter(
        self, project_id: str, body: ChapterCreateIn,
    ) -> tuple[ChapterIn, str] | None:
        """新建章节（position 追加到末尾）；返回 (新章节, 项目最新 updated_at)。

        项目不存在（或跨用户）→ None → 路由 404。
        """
        ...
    def patch_chapter(
        self, project_id: str, chapter_id: str, patch: ChapterPatchIn,
    ) -> tuple[ChapterIn, str] | None:
        """章节部分更新（name/voice/split_config/design_title，tri-state）；
        返回 (更新后的章节, 项目最新 updated_at)。章节不存在（或跨用户）→ None → 路由 404。"""
        ...
    def delete_chapter(self, project_id: str, chapter_id: str) -> str | None:
        """删章（段行级联删除，音频文件保留在盘上）；返回项目最新 updated_at。

        章节不存在（或跨用户）→ None → 路由 404。
        """
        ...
    def reorder_chapters(
        self, project_id: str, chapter_ids: list[str],
    ) -> tuple[list[dict[str, Any]], str] | None:
        """按数组顺序重排章节 position；返回 (全章按新序的 [{id, name, position}],
        项目最新 updated_at)。

        项目不存在（或跨用户）→ None → 路由 404；chapter_ids 未恰好覆盖项目
        全部章节 id → ValueError("chapter_ids_mismatch") → 路由 422。
        """
        ...
    def patch_project(
        self, project_id: str, patch: ProjectPatchIn,
    ) -> ProjectDetail | None:
        """项目元信息部分更新（tri-state，改名时事务内搬迁资产目录）；
        返回更新后的 ProjectDetail。项目不存在（或跨用户）-> None -> 路由 404。"""
        ...
    def put_source_document(
        self, project_id: str, text: str,
    ) -> tuple[str | None, str] | None:
        """写源文档（local：落文件+路径列；workers：文本列）；返回
        (路径或 None, 项目最新 updated_at)。项目不存在（或跨用户）-> None。"""
        ...
    def put_narration_script(
        self, project_id: str, text: str,
    ) -> tuple[str | None, str] | None:
        """写项目级完整旁白稿（local：落文件+路径列；workers：不持久化，
        no-op 警告）；返回 (路径或 None, 项目最新 updated_at)。
        项目不存在（或跨用户）-> None。
        """
        ...
    def delete_project(self, project_id: str) -> bool: ...
    def batch_create_structure(
        self, project_id: str, chapters: list[dict[str, Any]], narration_script: str | None = None,
        *, preserve_audio: bool = False, split_segments: bool = False, dry_run: bool = False,
    ) -> dict[str, Any]: ...  # LookupError("project_not_found"); {"chapters": [...], "reuse": report|None}
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

    def count_owned(self) -> int:
        """local 单租户无用户概念：配额检查不生效（路由层只在 workers 模式调用），返回 0。"""
        return 0

    def count_chapters(self, project_id: str) -> int:
        """项目章节数（章节配额用；不存在的项目返回 0）。"""
        proj = svc.get_project_row(self._db, project_id)
        return len(proj.chapters) if proj is not None else 0

    def save_project(self, project: ProjectIn) -> ProjectDetail:
        return svc.save_project(self._db, project)

    def patch_segment(
        self, project_id: str, chapter_id: str, segment_id: str, patch: SegmentPatchIn,
    ) -> tuple[SegmentIn, str] | None:
        return svc.patch_segment(self._db, project_id, chapter_id, segment_id, patch)

    def create_segment(
        self, project_id: str, chapter_id: str, body: SegmentCreateIn,
    ) -> tuple[SegmentIn, list[dict[str, Any]], str] | None:
        return svc.create_segment(
            self._db, project_id, chapter_id, text=body.text, after_id=body.after_id,
        )

    def reconcile_chapter_structure(
        self, project_id: str, chapter_id: str, segments: list[StructureSegmentIn],
    ) -> tuple[list[SegmentIn], str] | None:
        return svc.reconcile_chapter_structure(self._db, project_id, chapter_id, segments)

    def create_chapter(
        self, project_id: str, body: ChapterCreateIn,
    ) -> tuple[ChapterIn, str] | None:
        return svc.create_chapter(self._db, project_id, name=body.name)

    def patch_chapter(
        self, project_id: str, chapter_id: str, patch: ChapterPatchIn,
    ) -> tuple[ChapterIn, str] | None:
        return svc.patch_chapter(self._db, project_id, chapter_id, patch)

    def delete_chapter(self, project_id: str, chapter_id: str) -> str | None:
        return svc.delete_chapter(self._db, project_id, chapter_id)

    def reorder_chapters(
        self, project_id: str, chapter_ids: list[str],
    ) -> tuple[list[dict[str, Any]], str] | None:
        return svc.reorder_chapters(self._db, project_id, chapter_ids)

    def patch_project(
        self, project_id: str, patch: ProjectPatchIn,
    ) -> ProjectDetail | None:
        return svc.patch_project(self._db, project_id, patch)

    def put_source_document(
        self, project_id: str, text: str,
    ) -> tuple[str | None, str] | None:
        return svc.put_source_document(self._db, project_id, text)

    def put_narration_script(
        self, project_id: str, text: str,
    ) -> tuple[str | None, str] | None:
        return svc.put_narration_script(self._db, project_id, text)

    def delete_project(self, project_id: str) -> bool:
        return svc.delete_project(self._db, project_id)

    def batch_create_structure(
        self, project_id: str, chapters: list[dict[str, Any]], narration_script: str | None = None,
        *, preserve_audio: bool = False, split_segments: bool = False, dry_run: bool = False,
    ) -> dict[str, Any]:
        return svc.batch_create_structure(
            self._db, project_id, chapters, narration_script,
            preserve_audio=preserve_audio, split_segments=split_segments, dry_run=dry_run,
        )

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
        text_transforms=row.get("text_transforms"),
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


class SupabaseSegmentedProjectRepository(UserScope):
    """PostgREST 实现。无本地 FS 依赖；多步写无事务（PostgREST 限制），单用户规模可接受。

    M4 用户归属：projects 表带 user_id 过滤/标记；chapters/segments 无该列，
    归属经 project 传递——所有章节/分段级操作先经 `_owns_project` 校验归属
    （校验走带作用域的 project 查询，跨用户一律按不存在处理 → 路由 404）。
    """

    def __init__(self, client: SupabaseClient, owner_id: str | None = None, see_all: bool = False):
        super().__init__(owner_id=owner_id, see_all=see_all)
        self._client = client

    # ----- 查询 -----

    def _get_project_row(self, project_id: str) -> dict | None:
        return self._client.select_one(
            PROJECTS, params=self._scope_params({"id": f"eq.{project_id}"})
        )

    def _owns_project(self, project_id: str) -> bool:
        """章节/分段操作前的归属校验（跨用户 → False → 调用方按 not found 处理）。"""
        return (
            self._client.select_one(
                PROJECTS,
                params=self._scope_params({"id": f"eq.{project_id}", "select": "id"}),
            )
            is not None
        )

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
        projects = self._client.select(
            PROJECTS, params=self._scope_params({"order": "updated_at.desc"})
        )
        if not projects:
            return []
        project_ids = [p["id"] for p in projects]
        # 章节/分段只拉自己项目的（chapters/segments 无 user_id 列，按 project 过滤）
        chapters = self._client.select(
            CHAPTERS, params={"project_id": f"in.({','.join(project_ids)})"}
        )
        chapter_ids = [c["id"] for c in chapters]
        segments = (
            self._client.select(
                SEGMENTS, params={"chapter_id": f"in.({','.join(chapter_ids)})"}
            )
            if chapter_ids
            else []
        )
        chapters_by_project: dict[str, list[dict]] = {}
        for c in chapters:
            chapters_by_project.setdefault(c["project_id"], []).append(c)
        return [
            _row_to_summary(
                p,
                chapters_by_project.get(p["id"], []),
                [
                    s
                    for s in segments
                    if s["chapter_id"]
                    in {c["id"] for c in chapters_by_project.get(p["id"], [])}
                ],
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
        return self._owns_project(project_id)

    def count_owned(self) -> int:
        """名下项目数（带 user_id 作用域；see_all 时返回全表行数）。

        配额检查由路由层驱动：legacy admin（see_all=True）跳检查，正常不会
        走到这里；普通登录用户得到的是自己名下的项目数。
        """
        return len(self._client.select(PROJECTS, params=self._scope_params({"select": "id"})))

    def count_chapters(self, project_id: str) -> int:
        """项目章节数（章节配额用；不存在的项目返回 0）。

        chapters 表无 user_id 列，按 project_id 过滤即可——配额检查只在
        路由层校验过归属后调用。
        """
        return len(self._client.select(
            CHAPTERS, params={"project_id": f"eq.{project_id}", "select": "id"}
        ))

    # ----- 全量保存 -----

    def save_project(self, project: ProjectIn) -> ProjectDetail:
        now = utcnow().isoformat()
        existing_p = self._get_project_row(project.id)
        if existing_p is not None and project.base_updated_at is not None:
            # 乐观锁：与 local svc.save_project 同语义（None = 老客户端放行）。
            # PostgREST 原样返回存储字符串，客户端经 GET 回显，可直接比较。
            current = existing_p.get("updated_at")
            if project.base_updated_at != current:
                raise StalePayloadError(server_updated_at=current)
        if existing_p is None and not self._see_all:
            # 跨用户抢占防护：无作用域视角下项目已存在 → 属于他人，
            # 按不存在处理（LookupError → 路由 404，不泄露存在性、不覆盖他人行）
            clash = self._client.select_one(
                PROJECTS, params={"id": f"eq.{project.id}", "select": "id"}
            )
            if clash is not None:
                raise LookupError("project_not_found")
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
            # 保留既有归属（编辑不改变 owner）；新建行由 _stamp_row 写入当前用户
            p_row["user_id"] = existing_p.get("user_id")
        else:
            self._stamp_row(p_row)
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

        # 非毁灭式替换：先 upsert 章节/分段（按 id 幂等更新；唯一约束已设为
        # DEFERRABLE，批量 upsert 可安全处理重排序），再删除"库中存在、payload
        # 未包含"的孤儿行。不再"先删全量再插入"——这样即便某次插入因字段/约束
        # 失败，既有数据也不会被清空（修复保存失败即丢段的数据丢失 bug）。
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
                    "text_transforms": (
                        s_in.text_transforms
                        if s_in.text_transforms is not None
                        else prev_seg.get("text_transforms")
                    ),
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
            self._client.insert(CHAPTERS, ch_rows, upsert=True)
        if seg_rows:
            self._client.insert(SEGMENTS, seg_rows, upsert=True)

        # 删除孤儿：payload 未包含的章节（级联删其分段）与保留章节下被删的段落。
        # 仅清理"用户真正删除的项"，不再清空全量，避免插入失败时数据丢失。
        payload_chapter_ids = [c["id"] for c in ch_rows]
        payload_segment_ids = [s["id"] for s in seg_rows]
        chapter_delete_params: dict[str, str] = {"project_id": f"eq.{project.id}"}
        if payload_chapter_ids:
            chapter_delete_params["id"] = f"notin.({','.join(payload_chapter_ids)})"
        self._client.delete(CHAPTERS, params=chapter_delete_params)
        if payload_chapter_ids:
            seg_delete_params: dict[str, str] = {
                "chapter_id": f"in.({','.join(payload_chapter_ids)})"
            }
            if payload_segment_ids:
                seg_delete_params["id"] = f"notin.({','.join(payload_segment_ids)})"
            self._client.delete(SEGMENTS, params=seg_delete_params)
        detail = self.get_project(project.id)
        assert detail is not None
        return detail

    def patch_segment(
        self, project_id: str, chapter_id: str, segment_id: str, patch: SegmentPatchIn,
    ) -> tuple[SegmentIn, str] | None:
        """段级部分更新（与 svc.patch_segment 同语义）。跨用户/不存在 → None → 404。"""
        if not self._owns_project(project_id):
            return None
        ch_row = self._get_chapter_row(project_id, chapter_id)
        if ch_row is None:
            return None
        seg = self._client.select_one(
            SEGMENTS, params={"id": f"eq.{segment_id}", "chapter_id": f"eq.{chapter_id}"}
        )
        if seg is None:
            return None
        updates: dict[str, Any] = {}
        fields = patch.model_fields_set
        if "text" in fields:
            updates["text"] = patch.text or ""
        if "emotion" in fields:
            updates["emotion"] = patch.emotion
        if "role_id" in fields:
            updates["role_id"] = patch.role_id
        if "segment_kind" in fields:
            updates["segment_kind"] = patch.segment_kind or "narration"
        if "voice" in fields:
            old_voice = seg.get("voice") or {"source": "chapter"}
            new_voice = patch.voice or {"source": "chapter"}
            if new_voice != old_voice:
                # 音色变更 → 音频降级（与 local svc.patch_segment 同语义）
                audio = dict(seg.get("audio") or {})
                current = audio.get("current")
                if isinstance(current, dict) and (
                    current.get("path") or current.get("id") or current.get("audio_id")
                ):
                    audio["previous"] = current
                    audio["current"] = None
                    audio.pop("duration_sec", None)
                    updates["audio"] = audio
                updates["generated_params"] = None
                updates["generated_at"] = None
            updates["voice"] = new_voice
        if "unlock_audio" in fields and patch.unlock_audio:
            # 显式解锁录音：清除 audio.current.origin（与 local svc.patch_segment 同语义）
            audio = copy.deepcopy(seg.get("audio")) if isinstance(seg.get("audio"), dict) else None
            current = (audio or {}).get("current")
            if isinstance(current, dict) and current.get("origin"):
                current.pop("origin", None)
                updates["audio"] = audio
        now = utcnow().isoformat()
        updates["updated_at"] = now
        self._client.update(SEGMENTS, updates, params={"id": f"eq.{segment_id}"})
        self._client.update(CHAPTERS, {"updated_at": now}, params={"id": f"eq.{chapter_id}"})
        self._client.update(
            PROJECTS, {"updated_at": now}, params=self._scope_params({"id": f"eq.{project_id}"})
        )
        return _seg_row_to_in({**seg, **updates}), now

    # ----- 段结构端点（B 类） -----

    def create_segment(
        self, project_id: str, chapter_id: str, body: SegmentCreateIn,
    ) -> tuple[SegmentIn, list[dict[str, Any]], str] | None:
        """新建段（与 svc.create_segment 同语义）。跨用户/章节不存在 → None → 404。

        PostgREST 无事务：插入位置的后续段按 position 降序逐行 +1 平移
        （每步目标位总是空位），规避 (chapter_id, position) 唯一约束冲突。
        """
        if not self._owns_project(project_id):
            return None
        ch_row = self._get_chapter_row(project_id, chapter_id)
        if ch_row is None:
            return None
        seg_rows = self._list_segment_rows([chapter_id])  # position 升序
        if body.after_id is not None:
            idx = next((i for i, r in enumerate(seg_rows) if r["id"] == body.after_id), None)
            if idx is None:
                raise ValueError("after_segment_not_found")
            insert_at = idx + 1
        else:
            insert_at = len(seg_rows)

        now = utcnow().isoformat()
        shifted = seg_rows[insert_at:]
        for row in sorted(shifted, key=lambda r: r.get("position") or 0, reverse=True):
            row["position"] = (row.get("position") or 0) + 1
            self._client.update(
                SEGMENTS,
                {"position": row["position"], "updated_at": now},
                params={"id": f"eq.{row['id']}"},
            )
        new_row: dict[str, Any] = {
            "id": str(uuid.uuid4()),
            "chapter_id": chapter_id,
            "position": insert_at,
            "text": body.text or "",
            "segment_kind": "narration",
            "voice": {"source": "chapter"},
            "created_at": now,
            "updated_at": now,
        }
        self._client.insert(SEGMENTS, [new_row])
        self._client.update(CHAPTERS, {"updated_at": now}, params={"id": f"eq.{chapter_id}"})
        self._client.update(
            PROJECTS, {"updated_at": now}, params=self._scope_params({"id": f"eq.{project_id}"})
        )
        final_rows = seg_rows[:insert_at] + [new_row] + shifted
        positions = [
            {"id": r["id"], "position": r.get("position") or 0} for r in final_rows
        ]
        return _seg_row_to_in(new_row), positions, now

    def reconcile_chapter_structure(
        self, project_id: str, chapter_id: str, segments: list[StructureSegmentIn],
    ) -> tuple[list[SegmentIn], str] | None:
        """章内结构 reconcile（与 svc.reconcile_chapter_structure 同语义）。

        跨用户/章节不存在 → None → 404。已存在段只更新 text/position；**文本
        发生变化时**（合并等）旧音频失效降级（current→previous，文件保留），
        其余自产字段保留；被删段只删 DB 行（workers 音频在客户端 IndexedDB /
        Storage，本就不按状态 diff 清理）。
        position 重排两阶段：现存行先全部置负哨兵，再逐行赋最终值。
        """
        if not self._owns_project(project_id):
            return None
        ch_row = self._get_chapter_row(project_id, chapter_id)
        if ch_row is None:
            return None
        existing_rows = self._list_segment_rows([chapter_id])
        existing_by_id = {r["id"]: r for r in existing_rows}
        now = utcnow().isoformat()

        # Phase 1: 现存行全部置负哨兵，腾出正整数位
        for idx, row in enumerate(existing_rows):
            self._client.update(
                SEGMENTS, {"position": -(idx + 1)}, params={"id": f"eq.{row['id']}"}
            )

        keep_ids: set[str] = set()
        result_rows: list[dict[str, Any]] = []
        for s_in in segments:
            prev = existing_by_id.get(s_in.id) if s_in.id else None
            if prev is None:
                # id 缺省 → 服务端分配；id 存在但该章无此行 → 按新建播种（给定 id）
                row = {
                    "id": s_in.id or str(uuid.uuid4()),
                    "chapter_id": chapter_id,
                    "position": s_in.position,
                    "text": s_in.text or "",
                    "segment_kind": "narration",
                    "voice": {"source": "chapter"},
                    "created_at": now,
                    "updated_at": now,
                }
                self._client.insert(SEGMENTS, [row])
            else:
                updates: dict[str, Any] = {
                    "text": s_in.text or "", "position": s_in.position, "updated_at": now,
                }
                row = {
                    **prev,
                    "text": s_in.text or "",
                    "position": s_in.position,
                    "updated_at": now,
                }
                # 结构性文本变更（合并等）→ 旧音频失效降级（与 local 同语义：
                # current→previous、文件保留、generated_* 置空）；纯重排不动
                if (prev.get("text") or "") != (s_in.text or ""):
                    audio = dict(prev.get("audio") or {})
                    current = audio.get("current")
                    if isinstance(current, dict) and (
                    current.get("path") or current.get("id") or current.get("audio_id")
                ):
                        audio["previous"] = current
                        audio["current"] = None
                        audio.pop("duration_sec", None)
                        updates["audio"] = audio
                        row["audio"] = audio
                    updates["generated_params"] = None
                    updates["generated_at"] = None
                    row["generated_params"] = None
                    row["generated_at"] = None
                self._client.update(
                    SEGMENTS,
                    updates,
                    params={"id": f"eq.{prev['id']}"},
                )
            keep_ids.add(row["id"])
            result_rows.append(row)

        dropped = [r for r in existing_rows if r["id"] not in keep_ids]
        if dropped:
            self._client.delete(
                SEGMENTS, params={"id": f"in.({','.join(r['id'] for r in dropped)})"}
            )
        self._client.update(CHAPTERS, {"updated_at": now}, params={"id": f"eq.{chapter_id}"})
        self._client.update(
            PROJECTS, {"updated_at": now}, params=self._scope_params({"id": f"eq.{project_id}"})
        )
        result_rows.sort(key=lambda r: r.get("position") or 0)
        return [_seg_row_to_in(r) for r in result_rows], now

    # ----- 章节操作端点（C 类） -----

    def create_chapter(
        self, project_id: str, body: ChapterCreateIn,
    ) -> tuple[ChapterIn, str] | None:
        """新建章节（与 svc.create_chapter 同语义）。跨用户/项目不存在 → None → 404。"""
        if not self._owns_project(project_id):
            return None
        ch_rows = self._list_chapter_rows(project_id)
        position = max((r.get("position") or 0) for r in ch_rows) + 1 if ch_rows else 0
        now = utcnow().isoformat()
        row: dict[str, Any] = {
            "id": str(uuid.uuid4()),
            "project_id": project_id,
            "position": position,
            "name": body.name,
            # 默认字段对齐 svc.create_chapter_for_project 惯例
            "voice": {},
            "split_config": dict(_DEFAULT_SPLIT_CONFIG),
            "created_at": now,
            "updated_at": now,
        }
        self._client.insert(CHAPTERS, [row])
        self._client.update(
            PROJECTS, {"updated_at": now}, params=self._scope_params({"id": f"eq.{project_id}"})
        )
        return _ch_row_to_in(row, []), now

    def patch_chapter(
        self, project_id: str, chapter_id: str, patch: ChapterPatchIn,
    ) -> tuple[ChapterIn, str] | None:
        """章节部分更新（与 svc.patch_chapter 同语义）。跨用户/不存在 → None → 404。"""
        if not self._owns_project(project_id):
            return None
        ch_row = self._get_chapter_row(project_id, chapter_id)
        if ch_row is None:
            return None
        updates: dict[str, Any] = {}
        fields = patch.model_fields_set
        if "name" in fields:
            updates["name"] = patch.name or ""
        if "voice" in fields:
            updates["voice"] = patch.voice or {}
        if "split_config" in fields:
            updates["split_config"] = patch.split_config or {}
        if "design_title" in fields:
            updates["design_title"] = patch.design_title
        now = utcnow().isoformat()
        updates["updated_at"] = now
        self._client.update(CHAPTERS, updates, params={"id": f"eq.{chapter_id}"})
        self._client.update(
            PROJECTS, {"updated_at": now}, params=self._scope_params({"id": f"eq.{project_id}"})
        )
        seg_rows = self._list_segment_rows([chapter_id])
        return _ch_row_to_in({**ch_row, **updates}, seg_rows), now

    def delete_chapter(self, project_id: str, chapter_id: str) -> str | None:
        """删章（与 svc.delete_chapter 同语义）：段行一并删除；workers 音频在客户端
        IndexedDB / Storage，本就不按状态 diff 清理。跨用户/不存在 → None → 404。"""
        if not self._owns_project(project_id):
            return None
        ch_row = self._get_chapter_row(project_id, chapter_id)
        if ch_row is None:
            return None
        self._client.delete(SEGMENTS, params={"chapter_id": f"eq.{chapter_id}"})
        self._client.delete(CHAPTERS, params={"id": f"eq.{chapter_id}"})
        now = utcnow().isoformat()
        self._client.update(
            PROJECTS, {"updated_at": now}, params=self._scope_params({"id": f"eq.{project_id}"})
        )
        return now

    def reorder_chapters(
        self, project_id: str, chapter_ids: list[str],
    ) -> tuple[list[dict[str, Any]], str] | None:
        """章节重排（与 svc.reorder_chapters 同语义）。跨用户/项目不存在 → None → 404；
        chapter_ids 未恰好覆盖全部章节 → ValueError("chapter_ids_mismatch") → 422。
        PostgREST 无事务：先全部置负哨兵，再逐行赋终值（防 (project_id, position)
        唯一约束冲突）。
        """
        if not self._owns_project(project_id):
            return None
        ch_rows = self._list_chapter_rows(project_id)
        existing = {r["id"]: r for r in ch_rows}
        if len(chapter_ids) != len(existing) or set(chapter_ids) != set(existing):
            raise ValueError("chapter_ids_mismatch")
        now = utcnow().isoformat()
        # Phase 1: 负哨兵，腾出正整数位
        for idx, row in enumerate(ch_rows):
            self._client.update(
                CHAPTERS, {"position": -(idx + 1)}, params={"id": f"eq.{row['id']}"}
            )
        # Phase 2: 按 payload 顺序赋终值
        result: list[dict[str, Any]] = []
        for pos, cid in enumerate(chapter_ids):
            self._client.update(
                CHAPTERS,
                {"position": pos, "updated_at": now},
                params={"id": f"eq.{cid}"},
            )
            result.append({"id": cid, "name": existing[cid].get("name"), "position": pos})
        self._client.update(
            PROJECTS, {"updated_at": now}, params=self._scope_params({"id": f"eq.{project_id}"})
        )
        return result, now

    def patch_project(
        self, project_id: str, patch: ProjectPatchIn,
    ) -> ProjectDetail | None:
        """项目元信息部分更新（与 svc.patch_project 同语义，tri-state）。

        workers 无本地文件系统：改名不做目录搬迁（workers 音频在 Storage，
        无 slug 目录耦合）。跨用户/项目不存在 -> None -> 404。
        """
        if not self._owns_project(project_id):
            return None
        updates: dict[str, Any] = {}
        fields = patch.model_fields_set
        if "name" in fields:
            updates["name"] = patch.name or ""
        if "layout" in fields:
            updates["layout"] = patch.layout or "vertical"
        if "configs" in fields:
            updates["configs"] = patch.configs
        if "default_narrator_role_id" in fields:
            updates["default_narrator_role_id"] = patch.default_narrator_role_id
        if "logo" in fields:
            updates["logo"] = patch.logo
        if "remotion_project_path" in fields:
            updates["remotion_project_path"] = patch.remotion_project_path
        if "animation_theme" in fields:
            updates["animation_theme"] = patch.animation_theme
        now = utcnow().isoformat()
        updates["updated_at"] = now
        self._client.update(
            PROJECTS, updates, params=self._scope_params({"id": f"eq.{project_id}"})
        )
        return self.get_project(project_id)

    def put_source_document(
        self, project_id: str, text: str,
    ) -> tuple[str | None, str] | None:
        """写源文档：workers 无文件系统，内容直接存 ``source_document`` 文本列
        （对齐 save_project 的 workers 语义）。跨用户/项目不存在 -> None -> 404。
        """
        if not self._owns_project(project_id):
            return None
        now = utcnow().isoformat()
        self._client.update(
            PROJECTS,
            {"source_document": text, "updated_at": now},
            params=self._scope_params({"id": f"eq.{project_id}"}),
        )
        return None, now

    def put_narration_script(
        self, project_id: str, text: str,
    ) -> tuple[str | None, str] | None:
        """写项目级完整旁白稿：workers 模式本就不持久化该字段（对齐
        save_project 的忽略语义），no-op 警告并返回当前版本，不报错。
        跨用户/项目不存在 -> None -> 404。
        """
        if not self._owns_project(project_id):
            return None
        logger.warning(
            "[supabase] project-level narration_script is not persisted in workers mode "
            "(project %s)",
            project_id,
        )
        row = self._get_project_row(project_id)
        return None, (row or {}).get("updated_at") or utcnow().isoformat()

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
        self, project_id: str, chapters: list[dict[str, Any]], narration_script: str | None = None,
        *, preserve_audio: bool = False, split_segments: bool = False, dry_run: bool = False,
    ) -> dict[str, Any]:
        now = utcnow().isoformat()
        if not self.project_exists(project_id):
            raise LookupError("project_not_found")

        old_chapter_rows = self._list_chapter_rows(project_id)

        # 旧结构快照（纯行级匹配；workers 模式不管理音频文件，路径直接沿承）
        old_chapters: list[dict[str, Any]] = []
        if preserve_audio or split_segments:
            old_seg_rows = self._list_segment_rows([c["id"] for c in old_chapter_rows])
            segs_by_chapter: dict[str, list[dict]] = {}
            for s in old_seg_rows:
                segs_by_chapter.setdefault(s["chapter_id"], []).append(s)
            old_chapters = [
                {
                    "name": c.get("name"),
                    "voice": c.get("voice"),
                    "split_config": c.get("split_config"),
                    "segments": segs_by_chapter.get(c["id"], []),
                }
                for c in old_chapter_rows
            ]
        old_index = build_reuse_index(old_chapters) if old_chapters else {}

        # 解析每章 segments：payload 自带 > split_segments 规则拆分 > A2 保留即重建
        resolved_chapters: list[dict[str, Any]] = []
        for index, ch_data in enumerate(chapters):
            seg_payloads = ch_data.get("segments") or []
            if not seg_payloads:
                title = ch_data.get("chapter_title") or f"Chapter {index + 1}"
                snapshot = old_index.get(normalize_chapter_title(title))
                if split_segments or (preserve_audio and snapshot_has_segments(snapshot)):
                    body = ch_data.get("narration_script") or ch_data.get("original_text") or ""
                    delimiters = resolve_split_delimiters(ch_data.get("split_config"), snapshot)
                    seg_payloads = [{"text": t} for t in rule_split(body, delimiters, max_len=_max_segment_len())]
            resolved_chapters.append({**ch_data, "segments": seg_payloads})

        plan = plan_batch_reuse(old_chapters, resolved_chapters, preserve_audio=preserve_audio)
        reuse_report = plan["report"] if (preserve_audio or split_segments) else None

        if dry_run:
            return {"chapters": [], "reuse": reuse_report}

        if narration_script is not None:
            logger.warning(
                "[supabase] project-level narration_script is not persisted in workers mode "
                "(project %s)", project_id,
            )

        if old_chapter_rows:
            self._client.delete(
                SEGMENTS,
                params={"chapter_id": f"in.({','.join(c['id'] for c in old_chapter_rows)})"},
            )
            self._client.delete(CHAPTERS, params={"project_id": f"eq.{project_id}"})

        result: list[dict[str, Any]] = []
        ch_rows: list[dict[str, Any]] = []
        seg_rows: list[dict[str, Any]] = []
        for index, plan_ch in enumerate(plan["chapters"]):
            chapter_id = str(uuid.uuid4())
            title = plan_ch["title"]
            voice = dict(plan_ch["voice"])
            split_config = (
                dict(plan_ch["split_config"])
                if plan_ch["split_config"]
                else dict(_DEFAULT_SPLIT_CONFIG)
            )

            seg_result = []
            new_segs = []
            for position, plan_seg in enumerate(plan_ch["segments"]):
                seg_id = str(uuid.uuid4())
                row = {
                    "id": seg_id,
                    "chapter_id": chapter_id,
                    "position": position,
                    "text": plan_seg["text"],
                    "emotion": plan_seg["emotion"],
                    "role_id": None,
                    "segment_kind": plan_seg["segment_kind"],
                    "voice": {"source": "chapter"},
                    "created_at": now,
                    "updated_at": now,
                }
                matched = plan_seg["match"]
                if matched is not None:
                    if row["emotion"] is None and matched["emotion"]:
                        row["emotion"] = matched["emotion"]
                    if matched["role_id"]:
                        row["role_id"] = matched["role_id"]
                    if matched["voice"]:
                        row["voice"] = matched["voice"]
                    if matched["audio"]:
                        row["audio"] = matched["audio"]
                        if matched["generated_params"]:
                            row["generated_params"] = matched["generated_params"]
                        if matched["generated_at"]:
                            row["generated_at"] = matched["generated_at"]
                new_segs.append(row)
                seg_result.append({"id": seg_id})

            if reuse_report is not None:
                reuse_report["per_chapter"][index]["chapter_id"] = chapter_id

            # layer-sync：L2/L3 同批产出 → 三层基线一次性快照（mark_consistent）
            stand_in, seg_ns = _chapter_stand_in(
                {
                    "original_text": plan_ch["original_text"],
                    "narration_script": plan_ch["narration_script"],
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
                "split_config": split_config,
                "original_text": plan_ch["original_text"],
                "narration_script": plan_ch["narration_script"],
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
        return {"chapters": result, "reuse": reuse_report}

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
                params=self._scope_params({"id": f"eq.{project_id}"}),
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
        if not self._owns_project(project_id):
            return None
        ch_row = self._get_chapter_row(project_id, chapter_id)
        if ch_row is None:
            return None
        seg_rows = self._list_segment_rows([chapter_id])
        stand_in, _ = _chapter_stand_in(ch_row, seg_rows)
        return ls_sync_status(stand_in)

    def resplit_from_script(self, project_id: str, chapter_id: str) -> ProjectDetail:
        if not self._owns_project(project_id):
            raise LookupError("project_not_found")
        ch_row = self._get_chapter_row(project_id, chapter_id)
        if ch_row is None:
            raise LookupError("chapter_not_found")
        now = utcnow().isoformat()
        delimiters = (ch_row.get("split_config") or {}).get(
            "delimiters", _DEFAULT_SPLIT_CONFIG["delimiters"]
        )
        items = rule_split(ch_row.get("narration_script") or "", delimiters, max_len=_max_segment_len())

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
        if not self._owns_project(project_id):
            raise LookupError("project_not_found")
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
        if not self._owns_project(project_id):
            raise LookupError("project_not_found")
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
        self._client.update(
            PROJECTS, {"updated_at": now}, params=self._scope_params({"id": f"eq.{project_id}"})
        )
        detail = self.get_project(project_id)
        assert detail is not None
        return detail
