"""二进制资产存储（步骤 3A/4D/6A-2）。

克隆样本/试听音频等二进制资产的存储抽象：
- LocalAssetStore：写 backend/data/（现有逻辑）。ref 为相对 base_dir 的 POSIX
  路径，与 DB 现存值同一约定（settings.to_relative），读取方零改动。
- R2AssetStore（步骤 4D）：Cloudflare R2 binding，workers 模式由 workers_entry
  经 set_r2_binding(self.env.ASSETS) 注入；显式 r2 而未注入时 get_asset_store
  响亮报错（部署/配置错误，不静默）。
- SupabaseStorageAssetStore（步骤 6A-2）：Supabase Storage REST。Render 免费档
  文件系统临时、且没有 R2 binding（Workers 专有），此场景下 workers 模式的
  二进制资产改存 Supabase Storage bucket（settings.supabase_storage_bucket）。

选择逻辑（get_asset_store，settings.asset_store_backend）：
- auto（默认）：local 模式→Local；workers 模式→有 R2 binding 用 R2，否则 Supabase。
- 显式 local / r2 / supabase 可覆盖（如付费 Workers 用 R2、本地调试 Supabase）。

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

import httpx

from app.core.config import settings
from app.core.supabase_client import SupabaseError


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


def _is_storage_not_found(resp: httpx.Response) -> bool:
    """Supabase Storage 缺失对象判定：404，或部分版本返回的 400 + not_found 负载。"""
    if resp.status_code == 404:
        return True
    if resp.status_code != 400:
        return False
    try:
        body = resp.json()
    except ValueError:
        return False
    if not isinstance(body, dict):
        return False
    text = f"{body.get('statusCode', '')} {body.get('error', '')} {body.get('message', '')}".lower()
    return "not_found" in text or "not found" in text


def _raise_storage_error(resp: httpx.Response) -> None:
    try:
        detail = resp.json()
        message = detail.get("message") or str(detail) if isinstance(detail, dict) else str(detail)
    except ValueError:
        message = resp.text
    raise SupabaseError(resp.status_code, message)


class SupabaseStorageAssetStore:
    """Supabase Storage REST 实现（步骤 6A-2，Render 等无 R2 binding 的 workers 部署）。

    REST：``{SUPABASE_URL}/storage/v1/object/{bucket}/{key}``，service key 鉴权
    （apikey + Authorization Bearer，与 PostgREST 客户端同一约定）。
    - put：PUT + ``x-upsert: true``（重复生成试听须覆盖而非 409）；ref 即传入 key。
    - get：GET，缺失（404 / 400 not_found）映射 None，与 Local/R2 同一语义。
    - delete：DELETE，缺失为 no-op；其他 >=400 抛 SupabaseError。
    - url()：None——bucket 私有（service key 访问），音频仍经 API 端点服务。

    transport 可注入（测试用 httpx.MockTransport）。
    """

    def __init__(
        self,
        base_url: str | None = None,
        service_key: str | None = None,
        bucket: str | None = None,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: float = 30.0,
    ):
        base_url = base_url or settings.supabase_url
        service_key = service_key or settings.supabase_service_key
        bucket = bucket or settings.supabase_storage_bucket
        if not base_url or not service_key or not bucket:
            raise RuntimeError(
                "Supabase Storage asset store is not configured: set "
                "SUPABASE_URL / SUPABASE_SERVICE_KEY / SUPABASE_STORAGE_BUCKET"
            )
        self.bucket = bucket
        self._base_url = base_url.rstrip("/") + "/storage/v1/object"
        self._headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
        }
        self._transport = transport
        self._timeout = timeout

    def _client(self) -> httpx.AsyncClient:
        # 每次调用新建 client：实现是无状态依赖（FastAPI 每请求注入），
        # 不持有长连接，避免跨事件循环复用问题。
        return httpx.AsyncClient(
            base_url=self._base_url,
            headers=self._headers,
            transport=self._transport,
            timeout=self._timeout,
        )

    async def put(self, key: str, data: bytes) -> str:
        async with self._client() as client:
            resp = await client.put(
                f"{self.bucket}/{key}", content=data, headers={"x-upsert": "true"}
            )
        if resp.status_code >= 400:
            _raise_storage_error(resp)
        return key

    async def get(self, ref: str) -> bytes | None:
        async with self._client() as client:
            resp = await client.get(f"{self.bucket}/{ref}")
        if _is_storage_not_found(resp):
            return None
        if resp.status_code >= 400:
            _raise_storage_error(resp)
        return resp.content

    async def delete(self, ref: str) -> None:
        async with self._client() as client:
            resp = await client.delete(f"{self.bucket}/{ref}")
        if _is_storage_not_found(resp):
            return
        if resp.status_code >= 400:
            _raise_storage_error(resp)

    async def create_signed_upload_url(self, key: str, expires_in: int = 600) -> dict:
        """签发 Supabase Storage 签名上传 URL（Vercel 适配：前端直传，绕 4.5MB 请求体上限）。

        REST：``POST /storage/v1/object/upload/sign/{bucket}/{key}``，service key 鉴权。
        响应 ``{url, path, token}``，其中 url 为相对 /storage/v1 的路径（含 token
        查询参数）；返回绝对 upload_url 供前端直接 ``fetch(PUT)``。
        """
        async with self._client() as client:
            resp = await client.post(
                f"upload/sign/{self.bucket}/{key}", json={"expiresIn": expires_in}
            )
        if resp.status_code >= 400:
            _raise_storage_error(resp)
        data = resp.json()
        rel_url = data.get("url")
        token = data.get("token")
        if not rel_url or not token:
            raise SupabaseError(500, f"unexpected signed upload URL response: {data}")
        storage_root = self._base_url[: -len("/object")]
        return {
            "upload_url": f"{storage_root}{rel_url}",
            "storage_path": key,
            "token": token,
        }

    def url(self, ref: str) -> str | None:
        return None


_r2_binding = None


def set_r2_binding(binding) -> None:
    """workers 入口注入 R2 bucket binding（self.env.ASSETS）。"""
    global _r2_binding
    _r2_binding = binding


async def get_asset_store() -> AssetStore:
    """FastAPI 依赖：按 settings.asset_store_backend 选择实现。

    auto（默认）：local 模式→Local；workers 模式→有 R2 binding（真 Workers）用 R2，
    否则 Supabase Storage（Render 等无 binding 的 CPython 部署）。
    显式 r2 而未注入 binding 时响亮报错（部署/配置错误，不静默）。

    async def：workers 运行时（Pyodide）无线程，sync 依赖会经 anyio.to_thread 失败。
    """
    backend = settings.asset_store_backend
    if backend == "auto":
        if settings.deploy_target == "workers":
            backend = "r2" if _r2_binding is not None else "supabase"
        else:
            backend = "local"
    if backend == "local":
        return LocalAssetStore()
    if backend == "r2":
        if _r2_binding is None:
            raise RuntimeError(
                "R2 asset store unavailable: no bucket binding injected. "
                "workers 入口需经 set_r2_binding(env.ASSETS) 注入"
                "（wrangler.toml 的 [[r2_buckets]] binding = \"ASSETS\"）"
            )
        return R2AssetStore(_r2_binding)
    if backend == "supabase":
        return SupabaseStorageAssetStore()
    raise ValueError(
        f"unknown asset_store_backend: {backend!r}（可选 auto | local | r2 | supabase）"
    )
