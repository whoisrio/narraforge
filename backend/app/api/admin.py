"""管理后台 API（M5，仅 workers 模式挂载，见 main.create_app）。

全端点 require_admin：legacy admin（旧凭证通道）恒通过；用户 JWT 需
email ∈ settings.admin_emails。数据经 SupabaseAdminStatsRepository 读
M2 统计表（stats_middleware 写入）。
"""
from fastapi import APIRouter, Depends

from app.core.auth_deps import require_admin
from app.core.repositories.admin_stats import SupabaseAdminStatsRepository
from app.core.repositories.deps import get_admin_stats_repo

router = APIRouter(dependencies=[Depends(require_admin)])


@router.get("/stats/overview")
async def stats_overview(repo: SupabaseAdminStatsRepository = Depends(get_admin_stats_repo)):
    """总览：总用户数、今日 DAU、近 30 天 DAU/访问量序列。"""
    return repo.overview()


@router.get("/users")
async def list_users(
    page: int = 1,
    page_size: int = 20,
    repo: SupabaseAdminStatsRepository = Depends(get_admin_stats_repo),
):
    """用户列表（分页，含操作次数）。"""
    return repo.list_users(page=page, page_size=page_size)


@router.get("/logs")
async def list_logs(
    page: int = 1,
    page_size: int = 50,
    user_id: str | None = None,
    action: str | None = None,
    date: str | None = None,
    repo: SupabaseAdminStatsRepository = Depends(get_admin_stats_repo),
):
    """操作日志（分页，最新在前；支持 user_id/action/date 过滤）。"""
    return repo.list_logs(
        page=page, page_size=page_size, user_id=user_id, action=action, date=date
    )
