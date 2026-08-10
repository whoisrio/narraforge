"""二进制资产存储（步骤 3A/4D）。

克隆样本/试听音频等二进制资产的存储抽象：
- LocalAssetStore：写 backend/data/（现有逻辑）。ref 为相对 base_dir 的 POSIX
  路径，与 DB 现存值同一约定（settings.to_relative），读取方零改动。
- R2AssetStore（步骤 4D）：Cloudflare R2 binding，workers 模式由 workers_entry
  经 set_r2_binding(self.env.ASSETS) 注入；未注入时 get_asset_store 响亮报错
  （部署/配置错误，不静默）。

接口为异步：R2 binding 方法返回 JS Promise 必须 await；Local 实现同步逻辑
包 async 保持同一接口，调用方一律 await。

R2 Python 语义（workers-py FFI，参照 Cloudflare 文档与 spike VERDICT）：
- ``await bucket.put(key, data)`` / ``await bucket.delete(key)``；
- ``obj = await bucket.get(key)``，缺失返回 None（接口上映射 get→None，读路径
  按 404 语义处理）；
- 对象体经 ``array_buffer()``/``arrayBuffer()`` 读出；Pyodide 的 ArrayBuffer
  需经 Uint8Array.new(buf).to_py() 转 bytes（VERDICT 坑 3）。
"""
from __future__ import annotations

import inspect
from typing import Protocol, runtime_checkable

from app.core.config import settings


@runtime_checkable
class AssetStore(Protocol):
    async def put(self, key: str, data: bytes) -> str: ...  # 返回存储引用 ref
    async def get(self, ref: str) -> bytes | None: ...
    async def delete(self, ref: str) -> None: ...
    def url(self, ref: str) -> str | None: ...  # 公网可访问 URL；本地/R2 均无（经 API 端点服务）


class LocalAssetStore:
    """写本地文件系统；key/ref 均为相对 base_dir 的路径。"""

    async def put(self, key: str, data: bytes) -> str:
        p = settings.resolve_path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        return settings.to_relative(p)

    async def get(self, ref: str) -> bytes | None:
        p = settings.resolve_path(ref)
        return p.read_bytes() if p.exists() else None

    async def delete(self, ref: str) -> None:
        p = settings.resolve_path(ref)
        try:
            p.unlink()
        except OSError:
            pass

    def url(self, ref: str) -> str | None:
        return None


async def _maybe_await(value):
    """binding 方法在 Pyodide 返回 Promise（awaitable），fake/同步实现直接返回值。"""
    if inspect.isawaitable(value):
        return await value
    return value


def _buffer_to_bytes(buf) -> bytes:
    if isinstance(buf, (bytes, bytearray, memoryview)):
        return bytes(buf)
    # Pyodide：ArrayBuffer JsProxy 需经 Uint8Array 转 bytes（VERDICT 坑 3）
    from js import Uint8Array  # 仅 Pyodide 运行时存在

    return bytes(Uint8Array.new(buf).to_py())


async def _read_r2_body(obj) -> bytes:
    """从 R2 get 返回的对象读出 bytes，兼容 snake/camel 命名与同步/异步返回。"""
    if isinstance(obj, (bytes, bytearray, memoryview)):
        return bytes(obj)
    for name in ("array_buffer", "arrayBuffer"):
        fn = getattr(obj, name, None)
        if callable(fn):
            return _buffer_to_bytes(await _maybe_await(fn()))
    body = getattr(obj, "body", None)
    if isinstance(body, (bytes, bytearray, memoryview)):
        return bytes(body)
    raise TypeError(f"cannot read R2 object body: {type(obj)!r}")


class R2AssetStore:
    """Cloudflare R2 binding 实现（workers 模式）。

    bucket 为 duck-typed binding（async put/get/delete）。key_prefix 只影响
    R2 内部 key；对外 ref 不含前缀，与 Local 同一约定（DB 存 ref）。
    """

    def __init__(self, bucket, key_prefix: str = ""):
        self.bucket = bucket
        self._key_prefix = key_prefix.strip("/")

    def _r2_key(self, ref: str) -> str:
        return f"{self._key_prefix}/{ref}" if self._key_prefix else ref

    async def put(self, key: str, data: bytes) -> str:
        await _maybe_await(self.bucket.put(self._r2_key(key), data))
        return key

    async def get(self, ref: str) -> bytes | None:
        obj = await _maybe_await(self.bucket.get(self._r2_key(ref)))
        if obj is None:
            return None
        return await _read_r2_body(obj)

    async def delete(self, ref: str) -> None:
        await _maybe_await(self.bucket.delete(self._r2_key(ref)))

    def url(self, ref: str) -> str | None:
        return None


_r2_binding = None


def set_r2_binding(binding) -> None:
    """workers 入口注入 R2 bucket binding（self.env.ASSETS）。"""
    global _r2_binding
    _r2_binding = binding


async def get_asset_store() -> AssetStore:
    """FastAPI 依赖：按 deploy_target 选择实现。workers 未注入 binding 时响亮报错。

    async def：workers 运行时（Pyodide）无线程，sync 依赖会经 anyio.to_thread 失败。
    """
    if settings.deploy_target == "workers":
        if _r2_binding is None:
            raise RuntimeError(
                "R2 asset store unavailable: no bucket binding injected. "
                "workers 入口需经 set_r2_binding(env.ASSETS) 注入"
                "（wrangler.toml 的 [[r2_buckets]] binding = \"ASSETS\"）"
            )
        return R2AssetStore(_r2_binding)
    return LocalAssetStore()
