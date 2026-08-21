"""当前用户用量端点（Phase 3）。

workers：/api/me/* 不在匿名 allowlist → 未认证由 auth 中间件自动 401；
已认证经仓储作用域只见本人数据。local：单租户，返回全量用量。
"""
from fastapi import APIRouter, Depends

from app.core.repositories.deps import get_segmented_repo, get_usage_repo
from app.core.repositories.segmented_projects import SegmentedProjectRepository
from app.core.repositories.usage import UsageRepository

router = APIRouter()


@router.get("/me/usage")
async def get_my_usage(
    segmented_repo: SegmentedProjectRepository = Depends(get_segmented_repo),
    usage_repo: UsageRepository = Depends(get_usage_repo),
):
    """当前用户用量：按项目分桶（含 project_id=None 的无归属 LLM 桶）+ 总计。

    项目名从 segmented_projects 解析（仓储作用域自动限定本人项目）；
    已删除/无归属的项目 project_name 为 None。
    """
    buckets = usage_repo.usage_for_user()
    names = {p.id: p.name for p in segmented_repo.list_projects()}

    projects: list[dict] = []
    totals = {"tts_count": 0, "chars": 0, "input_tokens": 0, "output_tokens": 0}
    for b in buckets:
        entry = {
            "project_id": b["project_id"],
            "project_name": names.get(b["project_id"]) if b["project_id"] else None,
            "tts_count": b["tts_count"],
            "chars": b["chars"],
            "input_tokens": b["input_tokens"],
            "output_tokens": b["output_tokens"],
        }
        projects.append(entry)
        for k in totals:
            totals[k] += entry[k]
    return {"projects": projects, "totals": totals}
