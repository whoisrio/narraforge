"""步骤 3A/4D：AssetStore 二进制资产存储接口 + Local/R2 实现。

克隆样本/试听音频等二进制资产：local 写 backend/data/（既有逻辑）；
workers 存 Cloudflare R2（binding 由 workers 入口经 set_r2_binding 注入）。

接口为异步：R2 binding 方法返回 JS Promise 必须 await，Local 实现同步逻辑
包 async 以保持同一接口，调用方（clone.py）一律 await。

R2 Python 语义（workers-py FFI）：
- ``await bucket.put(key, data)`` / ``await bucket.delete(key)``；
- ``obj = await bucket.get(key)``，缺失返回 None（→ 接口映射为 get→None，
  读路径按 404 语义处理）；
- 对象体经 ``array_buffer()``/``arrayBuffer()`` 读出（Pyodide ArrayBuffer
  需经 Uint8Array 转 bytes，见 spike VERDICT 坑 3）。
"""
import pytest
from fastapi import HTTPException  # noqa: F401  # 保留：历史 501 语义参照

import app.core.asset_store as asset_store_module
from app.core.asset_store import (
    AssetStore,
    LocalAssetStore,
    R2AssetStore,
    get_asset_store,
    set_r2_binding,
)
from app.core.config import settings


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "base_dir", tmp_path)
    return LocalAssetStore()


class TestLocalAssetStore:
    def test_implements_protocol(self, store):
        assert isinstance(store, AssetStore)

    @pytest.mark.asyncio
    async def test_put_get_delete_round_trip(self, store, tmp_path):
        ref = await store.put("data/voices/profiles/hello.mp3", b"audio-bytes")
        # ref 为相对 base_dir 的 POSIX 路径（与 DB 现存值同一约定）
        assert ref == "data/voices/profiles/hello.mp3"
        assert (tmp_path / "data" / "voices" / "profiles" / "hello.mp3").read_bytes() == b"audio-bytes"

        assert await store.get(ref) == b"audio-bytes"

        await store.delete(ref)
        assert await store.get(ref) is None
        assert not (tmp_path / "data" / "voices" / "profiles" / "hello.mp3").exists()

    @pytest.mark.asyncio
    async def test_put_creates_parent_dirs(self, store, tmp_path):
        await store.put("data/voices/previews/deep/nested/x.wav", b"x")
        assert (tmp_path / "data" / "voices" / "previews" / "deep" / "nested" / "x.wav").exists()

    @pytest.mark.asyncio
    async def test_get_missing_returns_none(self, store):
        assert await store.get("data/voices/profiles/nope.mp3") is None

    @pytest.mark.asyncio
    async def test_delete_missing_is_noop(self, store):
        await store.delete("data/voices/profiles/nope.mp3")  # 不抛异常

    def test_url_is_none_for_local(self, store):
        # 本地经 FileResponse 路由服务，无公网 URL
        assert store.url("data/voices/profiles/x.mp3") is None


class _FakeR2Object:
    """R2 get 返回对象的最小 duck-type：array_buffer() 给出字节。

    同步返回 bytes（真实 binding 返回 Promise<ArrayBuffer>，实现两种都接）。
    """

    def __init__(self, data: bytes):
        self._data = data

    def array_buffer(self):
        return self._data


class _FakeR2ObjectCamel:
    """JS 命名变体：arrayBuffer() async 返回 bytes。"""

    def __init__(self, data: bytes):
        self._data = data

    async def arrayBuffer(self):
        return self._data


class _FakeR2Bucket:
    """内存版 R2 bucket binding（async put/get/delete）。"""

    def __init__(self):
        self.objects: dict[str, bytes] = {}

    async def put(self, key: str, data: bytes):
        self.objects[key] = data

    async def get(self, key: str):
        data = self.objects.get(key)
        return _FakeR2Object(data) if data is not None else None

    async def delete(self, key: str):
        self.objects.pop(key, None)


@pytest.fixture
def r2_bucket():
    return _FakeR2Bucket()


class TestR2AssetStore:
    def test_implements_protocol(self, r2_bucket):
        assert isinstance(R2AssetStore(r2_bucket), AssetStore)

    @pytest.mark.asyncio
    async def test_put_get_delete_round_trip(self, r2_bucket):
        store = R2AssetStore(r2_bucket)
        ref = await store.put("data/voices/profiles/hello.mp3", b"audio-bytes")
        # ref 即传入 key（不含内部前缀），与 Local 同一约定
        assert ref == "data/voices/profiles/hello.mp3"
        assert r2_bucket.objects["data/voices/profiles/hello.mp3"] == b"audio-bytes"

        assert await store.get(ref) == b"audio-bytes"

        await store.delete(ref)
        assert await store.get(ref) is None

    @pytest.mark.asyncio
    async def test_key_prefix_applied_to_bucket_keys(self, r2_bucket):
        """key_prefix 只影响 R2 内部 key，对外 ref 不变。"""
        store = R2AssetStore(r2_bucket, key_prefix="assets")
        ref = await store.put("data/voices/profiles/x.mp3", b"x")
        assert ref == "data/voices/profiles/x.mp3"
        assert "assets/data/voices/profiles/x.mp3" in r2_bucket.objects
        assert await store.get(ref) == b"x"
        await store.delete(ref)
        assert r2_bucket.objects == {}

    @pytest.mark.asyncio
    async def test_get_missing_returns_none(self, r2_bucket):
        """R2 get 缺失返回 None → 接口映射 None（读路径 404 语义）。"""
        store = R2AssetStore(r2_bucket)
        assert await store.get("data/voices/profiles/nope.mp3") is None

    @pytest.mark.asyncio
    async def test_camel_case_array_buffer_variant(self):
        """对象体也接受 JS 命名 arrayBuffer()（async）。"""
        class _CamelBucket(_FakeR2Bucket):
            async def get(self, key):
                data = self.objects.get(key)
                return _FakeR2ObjectCamel(data) if data is not None else None

        bucket = _CamelBucket()
        bucket.objects["k2"] = b"camel2"
        camel_store = R2AssetStore(bucket)
        assert await camel_store.get("k2") == b"camel2"

    def test_url_is_none(self, r2_bucket):
        # R2 无私有直出 URL；音频经 API 端点服务
        assert R2AssetStore(r2_bucket).url("data/voices/profiles/x.mp3") is None


class TestGetAssetStore:
    @pytest.fixture(autouse=True)
    def _reset_binding(self):
        yield
        set_r2_binding(None)

    @pytest.mark.asyncio
    async def test_local_mode_returns_local_store(self, monkeypatch):
        monkeypatch.setattr(settings, "deploy_target", "local")
        assert isinstance(await get_asset_store(), LocalAssetStore)

    @pytest.mark.asyncio
    async def test_workers_mode_with_binding_returns_r2_store(self, monkeypatch, r2_bucket):
        monkeypatch.setattr(settings, "deploy_target", "workers")
        set_r2_binding(r2_bucket)
        store = await get_asset_store()
        assert isinstance(store, R2AssetStore)
        assert store.bucket is r2_bucket

    @pytest.mark.asyncio
    async def test_workers_mode_without_binding_is_loud(self, monkeypatch):
        """未注入 binding 时响亮报错（配置/部署错误，不静默 501）。"""
        monkeypatch.setattr(settings, "deploy_target", "workers")
        set_r2_binding(None)
        with pytest.raises(RuntimeError, match="R2"):
            await get_asset_store()
