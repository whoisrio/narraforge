"""步骤 3A：AssetStore 二进制资产存储接口 + Local 实现。

克隆样本/试听音频等二进制资产：local 写 backend/data/（现有逻辑），
workers 的 R2 实现留到部署步骤 4（workers 运行时才有 binding）。
本步只定义接口、Local 实现和按模式选择的依赖（workers → 501）。
"""
import pytest
from fastapi import HTTPException

from app.core.asset_store import AssetStore, LocalAssetStore, get_asset_store
from app.core.config import settings


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "base_dir", tmp_path)
    return LocalAssetStore()


class TestLocalAssetStore:
    def test_implements_protocol(self, store):
        assert isinstance(store, AssetStore)

    def test_put_get_delete_round_trip(self, store, tmp_path):
        ref = store.put("data/voices/profiles/hello.mp3", b"audio-bytes")
        # ref 为相对 base_dir 的 POSIX 路径（与 DB 现存值同一约定）
        assert ref == "data/voices/profiles/hello.mp3"
        assert (tmp_path / "data" / "voices" / "profiles" / "hello.mp3").read_bytes() == b"audio-bytes"

        assert store.get(ref) == b"audio-bytes"

        store.delete(ref)
        assert store.get(ref) is None
        assert not (tmp_path / "data" / "voices" / "profiles" / "hello.mp3").exists()

    def test_put_creates_parent_dirs(self, store, tmp_path):
        store.put("data/voices/previews/deep/nested/x.wav", b"x")
        assert (tmp_path / "data" / "voices" / "previews" / "deep" / "nested" / "x.wav").exists()

    def test_get_missing_returns_none(self, store):
        assert store.get("data/voices/profiles/nope.mp3") is None

    def test_delete_missing_is_noop(self, store):
        store.delete("data/voices/profiles/nope.mp3")  # 不抛异常

    def test_url_is_none_for_local(self, store):
        # 本地经 FileResponse 路由服务，无公网 URL
        assert store.url("data/voices/profiles/x.mp3") is None


class TestGetAssetStore:
    def test_local_mode_returns_local_store(self, monkeypatch):
        monkeypatch.setattr(settings, "deploy_target", "local")
        assert isinstance(get_asset_store(), LocalAssetStore)

    def test_workers_mode_raises_501_until_r2(self, monkeypatch):
        monkeypatch.setattr(settings, "deploy_target", "workers")
        with pytest.raises(HTTPException) as exc_info:
            get_asset_store()
        assert exc_info.value.status_code == 501
