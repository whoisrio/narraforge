"""二进制资产存储（步骤 3A）。

克隆样本/试听音频等二进制资产的存储抽象：
- LocalAssetStore：写 backend/data/（现有逻辑）。ref 为相对 base_dir 的 POSIX
  路径，与 DB 现存值同一约定（settings.to_relative），读取方零改动。
- R2 实现留到部署步骤 4（workers 运行时才有 binding）；workers 模式本步
  经 get_asset_store 明确 501，不静默失败。
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable

from fastapi import HTTPException

from app.core.config import settings


@runtime_checkable
class AssetStore(Protocol):
    def put(self, key: str, data: bytes) -> str: ...  # 返回存储引用 ref
    def get(self, ref: str) -> bytes | None: ...
    def delete(self, ref: str) -> None: ...
    def url(self, ref: str) -> str | None: ...  # 公网可访问 URL；本地无（经 FileResponse 服务）


class LocalAssetStore:
    """写本地文件系统；key/ref 均为相对 base_dir 的路径。"""

    def put(self, key: str, data: bytes) -> str:
        p = settings.resolve_path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        return settings.to_relative(p)

    def get(self, ref: str) -> bytes | None:
        p = settings.resolve_path(ref)
        return p.read_bytes() if p.exists() else None

    def delete(self, ref: str) -> None:
        p = settings.resolve_path(ref)
        try:
            p.unlink()
        except OSError:
            pass

    def url(self, ref: str) -> str | None:
        return None


def get_asset_store() -> AssetStore:
    """FastAPI 依赖：按 deploy_target 选择实现。R2 实现见部署步骤 4。"""
    if settings.deploy_target == "workers":
        raise HTTPException(status_code=501, detail="asset_store_unavailable_in_workers")
    return LocalAssetStore()
