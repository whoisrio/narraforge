"""V2（Vercel 适配）：克隆音频直传 Supabase Storage，绕开 4.5MB 请求体上限。

- POST /api/clone/upload-url           — 服务端用 service key 签发 Supabase
  签名上传 URL，前端随后直传 Storage（不经过 Vercel 函数体）。
- POST /api/clone/upload-from-storage  — 直传完成后按 storage_path 建
  VoiceProfile（与 /upload 同一数据形状，后续 create-clone-mimo 流程不变）。
"""
import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.asset_store import SupabaseStorageAssetStore, get_asset_store
from app.core.config import settings
from main import app

# 依赖覆盖点（实现后存在于 app.api.clone）
from app.api.clone import get_signed_upload_store


def _make_store(handler) -> SupabaseStorageAssetStore:
    return SupabaseStorageAssetStore(
        base_url="https://proj.supabase.co",
        service_key="svc-key",
        bucket="voice-assets",
        transport=httpx.MockTransport(handler),
    )


@pytest.fixture
def override_signed_store(client):
    """返回一个安装函数：把 MockTransport -backed store 注入依赖。"""
    def _install(store):
        app.dependency_overrides[get_signed_upload_store] = lambda: store

    yield _install
    app.dependency_overrides.pop(get_signed_upload_store, None)


class TestSignedUploadUrl:
    def test_returns_absolute_signed_upload_url(self, client, override_signed_store):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["url"] = str(request.url)
            seen["authorization"] = request.headers.get("authorization")
            seen["apikey"] = request.headers.get("apikey")
            return httpx.Response(200, json={
                "url": "/object/upload/sign/voice-assets/data/voices/profiles/x.mp3?token=tok123",
                "path": "data/voices/profiles/x.mp3",
                "token": "tok123",
            })

        override_signed_store(_make_store(handler))
        resp = client.post(
            "/api/clone/upload-url",
            json={"filename": "我的 声音.mp3", "content_type": "audio/mpeg"},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["token"] == "tok123"
        # upload_url 必须是绝对地址（前端 fetch PUT 直传用）
        assert data["upload_url"] == (
            "https://proj.supabase.co/storage/v1/object/upload/sign/"
            "voice-assets/data/voices/profiles/x.mp3?token=tok123"
        )
        # storage_path 与 /upload 同一 key 约定（相对 voices_profiles_dir）
        assert data["storage_path"].startswith("data/voices/profiles/")
        assert data["storage_path"].endswith(".mp3")
        assert " " not in data["storage_path"] and "我" not in data["storage_path"]
        # 后端确实用 service key 调了 Supabase 签名端点
        assert seen["url"].startswith(
            "https://proj.supabase.co/storage/v1/object/upload/sign/voice-assets/data/voices/profiles/"
        )
        assert seen["authorization"] == "Bearer svc-key"
        assert seen["apikey"] == "svc-key"

    def test_rejects_webm(self, client, override_signed_store):
        """serverless 无 ffmpeg，webm 无法转码——响亮拒绝而非上传后失败。"""
        override_signed_store(_make_store(lambda r: httpx.Response(500)))
        resp = client.post(
            "/api/clone/upload-url",
            json={"filename": "recording.webm", "content_type": "audio/webm"},
        )
        assert resp.status_code == 400
        assert "webm" in resp.text.lower()

    def test_rejects_unsupported_extension(self, client, override_signed_store):
        override_signed_store(_make_store(lambda r: httpx.Response(500)))
        resp = client.post(
            "/api/clone/upload-url",
            json={"filename": "notes.txt", "content_type": "text/plain"},
        )
        assert resp.status_code == 400

    def test_upstream_error_maps_to_502(self, client, override_signed_store):
        override_signed_store(_make_store(lambda r: httpx.Response(500, json={"message": "boom"})))
        resp = client.post(
            "/api/clone/upload-url",
            json={"filename": "a.mp3", "content_type": "audio/mpeg"},
        )
        assert resp.status_code == 502

    def test_unconfigured_returns_503(self, client, monkeypatch):
        """未配置 Supabase 时响亮 503（不静默 500）。"""
        monkeypatch.setattr(settings, "supabase_url", "")
        monkeypatch.setattr(settings, "supabase_service_key", "")
        resp = client.post(
            "/api/clone/upload-url",
            json={"filename": "a.mp3", "content_type": "audio/mpeg"},
        )
        assert resp.status_code == 503


class _MemStore:
    """内存 AssetStore（upload-from-storage 测试用，不碰文件系统）。"""

    def __init__(self, objects: dict[str, bytes]):
        self.objects = objects

    async def get(self, ref: str):
        return self.objects.get(ref)

    async def put(self, key: str, data: bytes) -> str:  # pragma: no cover - 防御
        self.objects[key] = data
        return key

    async def delete(self, ref: str) -> None:  # pragma: no cover - 防御
        self.objects.pop(ref, None)

    def url(self, ref: str):
        return None


@pytest.fixture
def override_asset_store(client):
    def _install(store):
        app.dependency_overrides[get_asset_store] = lambda: store

    yield _install
    app.dependency_overrides.pop(get_asset_store, None)


class TestUploadFromStorage:
    def test_creates_voice_profile_from_storage_path(self, client, override_asset_store):
        override_asset_store(_MemStore({"data/voices/profiles/abc_20260813.mp3": b"audio-bytes"}))
        resp = client.post("/api/clone/upload-from-storage", json={
            "storage_path": "data/voices/profiles/abc_20260813.mp3",
            "name": "直传音色",
            "prompt_text": "你好世界",
        })
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["name"] == "直传音色"
        assert data["has_source"] is True
        params = data["voice_params"].get("", {})
        assert params.get("source_audio_path") == "data/voices/profiles/abc_20260813.mp3"
        assert params.get("params", {}).get("prompt_text") == "你好世界"

    def test_missing_object_returns_404(self, client, override_asset_store):
        override_asset_store(_MemStore({}))
        resp = client.post("/api/clone/upload-from-storage", json={
            "storage_path": "data/voices/profiles/none.mp3",
        })
        assert resp.status_code == 404

    def test_rejects_path_traversal(self, client, override_asset_store):
        override_asset_store(_MemStore({}))
        resp = client.post("/api/clone/upload-from-storage", json={
            "storage_path": "data/voices/profiles/../../secret.mp3",
        })
        assert resp.status_code == 400

    def test_rejects_outside_voices_prefix(self, client, override_asset_store):
        override_asset_store(_MemStore({"data/other/x.mp3": b"x"}))
        resp = client.post("/api/clone/upload-from-storage", json={
            "storage_path": "data/other/x.mp3",
        })
        assert resp.status_code == 400

    def test_rejects_webm(self, client, override_asset_store):
        override_asset_store(_MemStore({"data/voices/profiles/x.webm": b"x"}))
        resp = client.post("/api/clone/upload-from-storage", json={
            "storage_path": "data/voices/profiles/x.webm",
        })
        assert resp.status_code == 400
