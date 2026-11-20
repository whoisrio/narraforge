# CosyVoice base64 直传注册 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 CosyVoice 音色注册新增“本地音频 base64 Data URI 直传”途径，注册不再依赖公网 URL/七牛，同时保留 URL→SDK 老路径。

**Architecture:** service 层按入参类型自动分发（本地文件→新 HTTP base64 路径；http(s) URL→现有 SDK 路径）。`create_clone` 移除七牛依赖，落库 `voice_id` + `target_model` + `enrollment_method`。同步请求内轮询，未就绪按失败处理（错误信息含 voice_id）。

**Tech Stack:** FastAPI + urllib（无新依赖）、SQLAlchemy JSON 列、pytest（unittest.mock）、Playwright E2E。

**Spec:** `docs/superpowers/specs/2026-11-20-cosyvoice-base64-enrollment-design.md`

---

## Task 1: service 层 base64 注册的单元测试（红）

**Files:**
- Modify: `backend/tests/unit/test_qwen_tts_service.py`（文件末尾追加新测试类）

- [ ] **Step 1: 追加失败测试**

```python
class TestCosyVoiceBase64Enrollment:
    """CosyVoice base64 直传注册（voice-enrollment HTTP API）"""

    def _make_service(self) -> QwenTTSService:
        return QwenTTSService(api_key="test_api_key", model="cosyvoice-v3.5-plus")

    def _make_mp3(self, tmp_path, size_bytes=1024) -> str:
        path = tmp_path / "ref.mp3"
        path.write_bytes(b"\xff\xfb" + b"\x00" * (size_bytes - 2))
        return str(path)

    def _urlopen_response(self, payload: dict):
        resp = Mock()
        resp.read.return_value = json.dumps(payload).encode("utf-8")
        return resp

    def test_build_audio_data_uri_mime_mapping(self, tmp_path):
        service = self._make_service()
        cases = {
            "a.mp3": "audio/mpeg",
            "b.wav": "audio/wav",
            "c.m4a": "audio/mp4",
        }
        for name, mime in cases.items():
            p = tmp_path / name
            p.write_bytes(b"0" * 64)
            uri = service._build_audio_data_uri(str(p))
            assert uri.startswith(f"data:{mime};base64,")
            base64.b64decode(uri.split(";base64,", 1)[1])  # 可解码

    def test_build_audio_data_uri_rejects_unsupported_ext(self, tmp_path):
        service = self._make_service()
        p = tmp_path / "x.flac"
        p.write_bytes(b"0" * 64)
        with pytest.raises(ValueError, match="Unsupported audio format"):
            service._build_audio_data_uri(str(p))

    def test_build_audio_data_uri_rejects_oversize(self, tmp_path):
        service = self._make_service()
        p = tmp_path / "big.mp3"
        p.write_bytes(b"0" * (10 * 1024 * 1024 + 1))
        with pytest.raises(ValueError, match="10MB"):
            service._build_audio_data_uri(str(p))

    def test_base64_enrollment_success(self, tmp_path):
        service = self._make_service()
        audio_path = self._make_mp3(tmp_path)

        captured_requests: list[dict] = []

        def fake_urlopen(req, context=None, **kwargs):
            captured_requests.append(json.loads(req.data.decode("utf-8")))
            if captured_requests and "action" in captured_requests[-1]["input"] \
                    and captured_requests[-1]["input"]["action"] == "create_voice":
                return self._urlopen_response({"output": {"voice_id": "cosyvoice-v3.5-plus-clone-abc"}})
            return self._urlopen_response({"output": {"voice_id": "cosyvoice-v3.5-plus-clone-abc", "status": "OK"}})

        with patch("app.services.qwen_tts_service.urllib.request.urlopen", side_effect=fake_urlopen), \
             patch.object(QwenTTSService, "_probe_audio_duration", return_value=12.0):
            result = service._register_cloned_voice_cosyvoice_base64(audio_path, "测试音色")

        assert result["voice_id"] == "cosyvoice-v3.5-plus-clone-abc"
        assert result["voice_name"] == "测试音色"
        assert result["role"] == "custom"
        assert result["target_model"] == "cosyvoice-v3.5-plus"
        assert result["enrollment_method"] == "base64"

        create_body = captured_requests[0]
        assert create_body["model"] == "voice-enrollment"
        assert create_body["input"]["action"] == "create_voice"
        assert create_body["input"]["target_model"] == "cosyvoice-v3.5-plus"
        prefix = create_body["input"]["prefix"]
        assert len(prefix) <= 10 and prefix.isalnum()
        assert create_body["input"]["audio"].startswith("data:audio/mpeg;base64,")

        query_body = captured_requests[1]
        assert query_body["input"]["action"] == "query_voice"
        assert query_body["input"]["voice_id"] == "cosyvoice-v3.5-plus-clone-abc"

    def test_base64_enrollment_undeployed_raises_with_voice_id(self, tmp_path):
        service = self._make_service()
        audio_path = self._make_mp3(tmp_path)

        responses = [
            self._urlopen_response({"output": {"voice_id": "voice-x"}}),
            self._urlopen_response({"output": {"voice_id": "voice-x", "status": "UNDEPLOYED"}}),
        ]

        with patch("app.services.qwen_tts_service.urllib.request.urlopen", side_effect=responses), \
             patch.object(QwenTTSService, "_probe_audio_duration", return_value=12.0):
            with pytest.raises(RuntimeError, match="voice-x"):
                service._register_cloned_voice_cosyvoice_base64(audio_path, "n")

    def test_base64_enrollment_timeout_raises_with_voice_id(self, tmp_path):
        service = self._make_service()
        audio_path = self._make_mp3(tmp_path)

        responses = [
            self._urlopen_response({"output": {"voice_id": "voice-y"}}),
        ] + [
            self._urlopen_response({"output": {"voice_id": "voice-y", "status": "DEPLOYING"}})
        ] * 3

        with patch("app.services.qwen_tts_service.urllib.request.urlopen", side_effect=responses), \
             patch.object(QwenTTSService, "_probe_audio_duration", return_value=12.0):
            with pytest.raises(RuntimeError, match="voice-y"):
                service._register_cloned_voice_cosyvoice_base64(
                    audio_path, "n", max_attempts=3, poll_interval=0
                )

    def test_dispatch_local_file_routes_to_base64(self, tmp_path):
        service = self._make_service()
        with patch.object(service, "_register_cloned_voice_cosyvoice_base64") as mock_b64:
            service._register_cloned_voice_sync("/tmp/local.mp3", "n")
        mock_b64.assert_called_once_with("/tmp/local.mp3", "n")

    def test_dispatch_url_routes_to_sdk_path(self):
        service = self._make_service()
        with patch.object(service, "_register_cloned_voice_cosyvoice") as mock_sdk:
            service._register_cloned_voice_sync("https://cdn.example.com/a.wav", "n")
        mock_sdk.assert_called_once_with("https://cdn.example.com/a.wav", "n")
```

需要在文件头部 import 区补充 `import base64`、`import json`、`import urllib.request`（若缺）。

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/unit/test_qwen_tts_service.py::TestCosyVoiceBase64Enrollment -x -q`
Expected: FAIL（`_build_audio_data_uri` / `_register_cloned_voice_cosyvoice_base64` / `_probe_audio_duration` 不存在）

## Task 2: service 层实现（绿）

**Files:**
- Modify: `backend/app/services/qwen_tts_service.py`

- [ ] **Step 1: 类常量与 `__init__` 增加 base_url**

类常量区（`VOICE_ENROLLMENT_API_PATH` 附近）新增：

```python
    # 新式统一音色注册 API（Qwen-Audio-TTS / CosyVoice 共用）
    ENROLLMENT_MODEL = "voice-enrollment"
    ENROLLMENT_PATH = "/services/audio/tts/customization"
    AUDIO_DATA_URI_MIME = {".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4"}
    MAX_ENROLL_AUDIO_BYTES = 10 * 1024 * 1024
    MAX_ENROLL_AUDIO_SECONDS = 60.0
    DEFAULT_DASHSCOPE_API_BASE = "https://dashscope.aliyuncs.com/api/v1"
```

`__init__` 签名加 `base_url: Optional[str] = None`，方法体加：

```python
        self.base_url = (base_url or settings.qwen_base_url or self.DEFAULT_DASHSCOPE_API_BASE).rstrip("/")
```

- [ ] **Step 2: 新增 5 个方法（放在 `_register_cloned_voice_cosyvoice` 之前）**

```python
    def _make_voice_prefix(self) -> str:
        """音色名前缀：仅字母数字、≤10 字符（官方限制）。"""
        from datetime import datetime

        return f"clone{datetime.now().strftime('%H%M%S')}"[:10]

    def _probe_audio_duration(self, audio_path: str) -> Optional[float]:
        """用 ffprobe 探测音频时长（秒）；ffprobe 不可用或无法解析时返回 None。"""
        try:
            result = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", audio_path],
                capture_output=True, text=True, check=False,
            )
            if result.returncode != 0:
                return None
            return float(result.stdout.strip())
        except (FileNotFoundError, ValueError):
            return None

    def _build_audio_data_uri(self, audio_path: str) -> str:
        """校验本地音频并编码为 data URI（base64 直传注册的入参）。"""
        if not os.path.exists(audio_path):
            raise FileNotFoundError(f"Reference audio not found: {audio_path}")

        ext = os.path.splitext(audio_path)[1].lower()
        mime = self.AUDIO_DATA_URI_MIME.get(ext)
        if not mime:
            raise ValueError(
                f"Unsupported audio format: {ext}. Expected MP3, WAV, or M4A."
            )

        size = os.path.getsize(audio_path)
        if size > self.MAX_ENROLL_AUDIO_BYTES:
            raise ValueError(
                f"Audio file too large: {size} bytes (limit {self.MAX_ENROLL_AUDIO_BYTES} bytes / 10MB)"
            )

        duration = self._probe_audio_duration(audio_path)
        if duration is not None and duration > self.MAX_ENROLL_AUDIO_SECONDS:
            raise ValueError(
                f"Audio too long: {duration:.1f}s (limit {self.MAX_ENROLL_AUDIO_SECONDS:.0f}s)"
            )

        with open(audio_path, "rb") as f:
            audio_base64 = base64.b64encode(f.read()).decode("ascii")
        return f"data:{mime};base64,{audio_base64}"

    def _enrollment_post(self, action_input: Dict[str, Any]) -> Dict:
        """调用 voice-enrollment 定制端点并解析 JSON 响应。"""
        request_body = {"model": self.ENROLLMENT_MODEL, "input": action_input}
        url = f"{self.base_url}{self.ENROLLMENT_PATH}"
        data = json.dumps(request_body).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=self._get_headers())
        context = ssl.create_default_context()
        with urllib.request.urlopen(req, context=context) as response:
            result = json.loads(response.read().decode("utf-8"))
        if "code" in result and result["code"] not in ("", "Success"):
            raise Exception(
                f"Voice enrollment API error: {result.get('code')} - {result.get('message', 'Unknown error')}"
            )
        return result

    def _wait_for_voice_ready_http(
        self, voice_id: str, max_attempts: int = 45, poll_interval: float = 2.0
    ) -> str:
        """轮询 query_voice 直到 status == OK；失败/超时的异常信息必须包含 voice_id。"""
        for attempt in range(max_attempts):
            try:
                result = self._enrollment_post({"action": "query_voice", "voice_id": voice_id})
                output = result.get("output", {})
                status = output.get("status")
                logger.info(
                    f"Voice query attempt {attempt + 1}/{max_attempts}: status='{status}'"
                )
                if status == "OK":
                    return voice_id
                if status not in ("DEPLOYING", None):
                    raise RuntimeError(
                        f"Voice processing failed with status '{status}' "
                        f"(voice_id={voice_id}). The cloud record must be cleaned up manually "
                        f"or via /clone/sync-from-qwen."
                    )
            except RuntimeError:
                raise
            except Exception as e:
                logger.warning(f"Voice query error (attempt {attempt + 1}): {e}")
            time.sleep(poll_interval)

        raise RuntimeError(
            f"Voice registration timeout: voice_id={voice_id} did not become OK "
            f"after {max_attempts} attempts. The cloud record may still deploy later; "
            f"check via query or /clone/sync-from-qwen."
        )

    def _register_cloned_voice_cosyvoice_base64(
        self,
        reference_audio_path: str,
        voice_name: str = "cloned_voice",
        max_attempts: int = 45,
        poll_interval: float = 2.0,
    ) -> Dict[str, Any]:
        """
        CosyVoice base64 直传注册（新式 voice-enrollment HTTP API）。

        本地音频编码为 Data URI 直接上传，无需公网 URL/七牛/PUBLIC_BASE_URL。
        create_voice 同步返回 voice_id，随后轮询 query_voice 直到 OK。
        """
        audio_uri = self._build_audio_data_uri(reference_audio_path)
        prefix = self._make_voice_prefix()

        logger.info(
            f"Registering cloned voice (CosyVoice base64): {voice_name} "
            f"(prefix: {prefix}, target_model: {self.model})"
        )

        result = self._enrollment_post(
            {
                "action": "create_voice",
                "target_model": self.model,
                "prefix": prefix,
                "audio": audio_uri,
            }
        )

        voice_id = (result.get("output") or {}).get("voice_id")
        if not voice_id:
            raise Exception(f"Voice enrollment response missing voice_id: {result}")

        logger.info(f"Voice created. voice_id: {voice_id}; waiting for deploy...")
        self._wait_for_voice_ready_http(voice_id, max_attempts=max_attempts, poll_interval=poll_interval)

        return {
            "voice_id": voice_id,
            "voice_name": voice_name,
            "role": "custom",
            "target_model": self.model,
            "enrollment_method": "base64",
        }
```

需要在文件头部 import 区确认有 `import subprocess`（新增）、`import ssl`（已有）。

- [ ] **Step 3: 修改 `_register_cloned_voice_sync` 的 cosyvoice 分支**

```python
        if self.is_cosyvoice:
            if reference_audio_path.startswith(("http://", "https://")):
                return self._register_cloned_voice_cosyvoice(reference_audio_path, voice_name)
            return self._register_cloned_voice_cosyvoice_base64(reference_audio_path, voice_name)
```

同时给 `_register_cloned_voice_cosyvoice`（SDK 路径）的返回 dict 补 `"target_model": self.model, "enrollment_method": "url"`。

- [ ] **Step 4: 更新老路径 docstring 中的七牛措辞**

`_register_cloned_voice_cosyvoice` docstring 中“可以通过 external_audio_url 参数直接传入外部音频 URL（如七牛云、AWS S3 等）”改为不提七牛的表述（外部 URL 仍支持）。

- [ ] **Step 5: 运行 Task 1 测试通过**

Run: `cd backend && uv run pytest tests/unit/test_qwen_tts_service.py -q`
Expected: PASS（全部）

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/qwen_tts_service.py backend/tests/unit/test_qwen_tts_service.py
git commit -m "feat(backend): add base64 data URI enrollment pathway for CosyVoice voice registration"
```

## Task 3: 配置 `QWEN_BASE_URL`

**Files:**
- Modify: `backend/app/core/config.py:151-152` 附近
- Modify: `backend/app/core/model_config_service.py`（PROVIDER_SCHEMAS["qwen_tts"]）
- Modify: `backend/app/services/qwen_tts_service.py`（get_tts_service）
- Test: `backend/tests/unit/test_qwen_tts_service.py`

- [ ] **Step 1: 失败测试（get_tts_service 读取界面配置的 base_url 并参与指纹）**

```python
    @pytest.mark.asyncio
    async def test_get_tts_service_base_url_from_ui_config_rebuilds_singleton(self):
        """界面配置的 base_url 应传入服务并参与单例指纹。"""
        import app.services.qwen_tts_service as tts_module
        from app.services.qwen_tts_service import get_tts_service

        tts_module._tts_service = None
        tts_module._tts_config_fingerprint = None

        fake_db = object()
        config_by_key = {
            "qwen_tts": {"api_key": "k1", "model": "cosyvoice-v3.5-plus", "base_url": "https://ws.cn-beijing.maas.aliyuncs.com/api/v1"},
            "app": {},
        }

        with patch("app.services.qwen_tts_service.settings") as mock_settings, \
             patch("app.core.model_config_service.get_effective_config",
                   side_effect=lambda db, key: config_by_key.get(key, {})):
            mock_settings.qwen_api_key = ""
            mock_settings.qwen_model = ""
            mock_settings.public_base_url = ""
            svc = await get_tts_service(fake_db)
            assert svc.base_url == "https://ws.cn-beijing.maas.aliyuncs.com/api/v1"

            config_by_key["qwen_tts"] = {**config_by_key["qwen_tts"], "base_url": "https://dashscope.aliyuncs.com/api/v1"}
            svc2 = await get_tts_service(fake_db)
            assert svc2 is not svc
            assert svc2.base_url == "https://dashscope.aliyuncs.com/api/v1"

        tts_module._tts_service = None
        tts_module._tts_config_fingerprint = None
```

- [ ] **Step 2: 实现**

config.py（qwen_model 之后）：

```python
    qwen_base_url: str = "https://dashscope.aliyuncs.com/api/v1"
```

model_config_service.py PROVIDER_SCHEMAS["qwen_tts"] 增加：

```python
        "base_url": {
            "label": "API Base URL",
            "type": "text",
            "sensitive": False,
            "default_from_settings": "qwen_base_url",
            "description": "DashScope API 地址（可用业务空间专属域名）",
        },
```

qwen_tts_service.py：`_make_tts_fingerprint(api_key, model, public_base_url)` 改为四参加 `base_url`；`get_tts_service` 读 `config.get("base_url")`（界面优先 → settings 降级），传 `base_url=` 给构造器，指纹纳入。

- [ ] **Step 3: 运行单测**

Run: `cd backend && uv run pytest tests/unit/test_qwen_tts_service.py -q`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/app/core/config.py backend/app/core/model_config_service.py backend/app/services/qwen_tts_service.py backend/tests/unit/test_qwen_tts_service.py
git commit -m "feat(backend): configurable QWEN_BASE_URL for voice enrollment endpoint"
```

## Task 4: API 层 `create_clone` 重写（红→绿）

**Files:**
- Modify: `backend/tests/conftest.py:121` mock_tts_service 返回值
- Modify: `backend/tests/integration/test_clone_api.py`
- Modify: `backend/app/api/clone.py`

- [ ] **Step 1: 更新 conftest mock 返回值（补 target_model/enrollment_method）**

```python
    service.register_cloned_voice = AsyncMock(return_value={
        "voice_id": "test_cloned_voice_123",
        "voice_name": "Test Voice",
        "role": "custom",
        "target_model": "cosyvoice-v3.5-plus",
        "enrollment_method": "base64",
    })
```

- [ ] **Step 2: 改写集成测试（红）**

`test_create_clone_success` 重写：删除 qiniu patch，断言 `register_cloned_voice` 以本地路径调用、落库含 `voice_id`/`target_model`/`enrollment_method`；新增 `test_create_clone_audio_missing_404`、`test_create_clone_failure_keeps_upload_state`（side_effect=Exception → 500，重查 profile 仍 `voice_type == "upload"`）。

```python
    def test_create_clone_success(self, client: TestClient, db_session, mock_tts_service):
        """测试创建克隆声音成功：本地音频 base64 直传注册，无需公网 URL。"""
        import uuid

        from app.models.voice_profile import VoiceProfile

        voice_id = str(uuid.uuid4())
        audio_path = os.path.join(tempfile.gettempdir(), f"clone_test_{voice_id}.wav")
        with open(audio_path, "w") as f:
            f.write("dummy audio data")

        voice = VoiceProfile(
            id=voice_id,
            name="Clone Test",
            voice={"model": "", "voice_type": "upload"},
            voice_params={"": {"source_audio_path": audio_path}},
        )
        db_session.add(voice)
        db_session.commit()

        request_data = {
            "profile_id": voice_id,
            "name": "Cloned Voice Name",
            "role": "custom",
            "engine_params": {"speed": 1, "language": "Chinese", "volume": 80},
        }
        response = client.post("/api/clone/create-clone", json=request_data)

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == voice_id
        assert data["voice"]["model"] == "cosyvoice"
        assert data["voice"]["voice_type"] == "clone"

        vp_params = data["voice_params"]["cosyvoice"]["params"]
        assert vp_params["voice_id"] == "test_cloned_voice_123"
        assert vp_params["target_model"] == "cosyvoice-v3.5-plus"
        assert vp_params["enrollment_method"] == "base64"
        assert vp_params["speed"] == 1

        mock_tts_service.register_cloned_voice.assert_called_once_with(
            reference_audio_path=audio_path, voice_name="Cloned Voice Name"
        )
        if os.path.exists(audio_path):
            os.unlink(audio_path)

    def test_create_clone_audio_missing_404(self, client: TestClient, db_session, mock_tts_service):
        import uuid

        from app.models.voice_profile import VoiceProfile

        voice_id = str(uuid.uuid4())
        voice = VoiceProfile(
            id=voice_id,
            name="Missing Audio",
            voice={"model": "", "voice_type": "upload"},
            voice_params={"": {"source_audio_path": "/nonexistent/audio.mp3"}},
        )
        db_session.add(voice)
        db_session.commit()

        response = client.post("/api/clone/create-clone", json={"profile_id": voice_id})
        assert response.status_code == 404

    def test_create_clone_failure_keeps_upload_state(self, client: TestClient, db_session, mock_tts_service):
        import uuid

        from app.models.voice_profile import VoiceProfile

        voice_id = str(uuid.uuid4())
        audio_path = os.path.join(tempfile.gettempdir(), f"clone_fail_{voice_id}.wav")
        with open(audio_path, "w") as f:
            f.write("dummy audio data")

        voice = VoiceProfile(
            id=voice_id,
            name="Fail Case",
            voice={"model": "", "voice_type": "upload"},
            voice_params={"": {"source_audio_path": audio_path}},
        )
        db_session.add(voice)
        db_session.commit()

        mock_tts_service.register_cloned_voice.side_effect = Exception(
            "Voice processing failed with status 'UNDEPLOYED' (voice_id=voice-x)"
        )
        response = client.post("/api/clone/create-clone", json={"profile_id": voice_id})

        assert response.status_code == 500
        assert "voice-x" in response.json()["detail"]

        refreshed = client.get(f"/api/clone/{voice_id}").json()
        assert refreshed["voice"]["voice_type"] == "upload"

        if os.path.exists(audio_path):
            os.unlink(audio_path)
```

- [ ] **Step 3: 重写 `create_clone`（绿）**

替换现有 external_audio_url/七牛逻辑：

```python
@local_router.post("/create-clone", response_model=VoiceProfileOut)
async def create_clone(request: RegisterRequest, db: Session = Depends(get_db)):
    """注册克隆声音 - 本地音频 base64 直传 voice-enrollment API（workers 模式不挂载）"""
    voice = db.query(VoiceProfile).filter(VoiceProfile.id == request.profile_id).first()
    if not voice:
        raise HTTPException(status_code=404, detail="Voice not found")

    vp = dict(voice.voice_params or {})
    model = (voice.voice or {}).get("model", "")
    model_vp = dict(vp.get(model, {}) or {})
    resolved_src = _resolve(model_vp.get("source_audio_path", ""))
    if not resolved_src:
        raise HTTPException(status_code=404, detail="Audio file not found")

    try:
        tts_service = await get_tts_service(db)
        result = await tts_service.register_cloned_voice(
            reference_audio_path=resolved_src,
            voice_name=request.name or voice.name,
        )

        new_model_vp = dict(model_vp)
        new_model_vp.setdefault("params", {})
        new_model_vp["params"]["voice_id"] = result["voice_id"]
        if result.get("target_model"):
            new_model_vp["params"]["target_model"] = result["target_model"]
        new_model_vp["params"]["enrollment_method"] = result.get("enrollment_method", "base64")
        if request.engine_params:
            new_model_vp["params"].update(request.engine_params)
        new_vp = {**vp, "cosyvoice": new_model_vp}
        voice.voice = {"model": "cosyvoice", "voice_type": "clone"}
        voice.voice_params = new_vp

        if request.name:
            voice.name = request.name
        if request.avatar:
            voice.avatar = request.avatar
        if request.project_id and not voice.project_id:
            voice.project_id = request.project_id

        db.commit()
        db.refresh(voice)
        return voice_to_dict(voice)

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Voice registration failed: {str(e)}")
```

- [ ] **Step 4: 运行集成测试**

Run: `cd backend && uv run pytest tests/integration/test_clone_api.py tests/test_api_clone.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/clone.py backend/tests/conftest.py backend/tests/integration/test_clone_api.py
git commit -m "feat(backend): create-clone registers via local base64 upload, drop public URL requirement"
```

## Task 5: 七牛清理

**Files:**
- Delete: `backend/app/services/qiniu_service.py`
- Delete: `backend/tests/manual/manual_qiniu_upload.py`
- Modify: `backend/pyproject.toml`（删 `"qiniu>=7.17.0"`）
- Modify: `backend/tests/test_app_factory.py:155`（heavy 集合去掉 `'qiniu'`）
- Modify: `backend/uv.lock`（`uv lock` 自动更新）

- [ ] **Step 1: 删文件与依赖**

```bash
git rm backend/app/services/qiniu_service.py backend/tests/manual/manual_qiniu_upload.py
```

pyproject 删除 qiniu 行；test_app_factory.py 的 heavy 字符串去掉 `'qiniu'`。
然后 `cd backend && uv lock && uv sync --extra test --extra local-ml --extra local-services`。

- [ ] **Step 2: 全仓残留检查**

Run: `rg -n "qiniu" backend/ --ignore-case -g '!uv.lock'`
Expected: 无业务引用（TEST_MAP.md 等文档在 Task 8 处理）

- [ ] **Step 3: 全量测试**

Run: `cd backend && uv run ruff check . && uv run pytest -q`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add -A backend
git commit -m "chore(backend): remove Qiniu OSS dependency from voice clone flow"
```

## Task 6: 前端 VoiceList 注册弹窗 bug 修复

`handleRegister` 发送 `voice_id`，后端 `RegisterRequest` 期待 `profile_id` → 恒 422。同端点修复。

**Files:**
- Modify: `frontend/src/components/VoiceClone/VoiceList.tsx:152-157`
- Test: `frontend/src/components/VoiceClone/VoiceList.test.tsx`

- [ ] **Step 1: 失败测试（断言请求体含 profile_id 且 4xx 走 toast）**

在 `VoiceList.test.tsx` 补一个用例：mock global fetch 返回 `{ ok: false, status: 422 }`，触发注册，断言 `fetch` 被调用时 body 含 `profile_id` 且展示了失败提示。

- [ ] **Step 2: 实现**

```ts
      const resp = await fetch(apiUrl('/clone/create-clone'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_id: selectedVoice.id,
          name: registerName,
          role: registerRole,
        }),
      });
      if (!resp.ok) {
        toast.error(t('voiceList.registrationFailed'));
        return;
      }
      const result = await resp.json();
      setRegisterResult(result);
```

- [ ] **Step 3: `cd frontend && npm test` 通过，Commit**

```bash
git add frontend/src/components/VoiceClone/VoiceList.tsx frontend/src/components/VoiceClone/VoiceList.test.tsx
git commit -m "fix(frontend): send profile_id in VoiceList register dialog payload"
```

## Task 7: E2E 用例

**Files:**
- Modify: `tests/e2e/specs/voice-clone.spec.ts`

- [ ] **Step 1: 新增 CosyVoice 注册失败路径用例**

要点：CI/E2E 环境无真实 DashScope Key（未配 QWEN_API_KEY 时 get_tts_service 抛 ValueError → 500）。
流程：克隆声音面板 → 引擎选 `CosyVoice` → 上传 fixture 音频 → 点 `使用 CosyVoice 复刻`。
断言：出现错误提示（`audioPreview.cloneFailed` 文案 `克隆失败，请重试`）、无未捕获页面错误（console.error 可忽略——失败分支会主动 console.error）、列表中不出现该克隆音色（前端回滚删除）。文件头注释注明：真实注册 happy path 是带 Key 环境的手工验收（见 e2e-test-guide）。

- [ ] **Step 2: 若 Playwright 环境可用则运行**

Run: `npm run e2e -- --grep "CosyVoice"`（按 `tests/e2e/README.md` 的启动要求）
Expected: PASS；无浏览器环境则记录于 PR 描述。

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/specs/voice-clone.spec.ts
git commit -m "test(e2e): cover CosyVoice clone registration failure path"
```

## Task 8: 文档更新

**Files（全部修改）:**
- `docs/api-reference.md`：create-clone 描述改为“本地音频 base64 直传注册，无需公网 URL/七牛”；错误场景补 404 音频缺失、500 含上游信息与 voice_id。
- `docs/ENV.md`：新增 `QWEN_BASE_URL`（默认 `https://dashscope.aliyuncs.com/api/v1`，支持业务空间域名）。
- `docs/database-schema.md`：voice_params.cosyvoice.params 示例补 `target_model`、`enrollment_method`。
- `docs/deployment-feature-matrix.md`：CosyVoice 注册不再依赖七牛/公网 URL。
- `docs/e2e-test-guide.md`：CosyVoice 注册 E2E 覆盖范围 + 带 Key 手工验收步骤。
- `backend/tests/TEST_MAP.md`：登记新增/改写用例，移除 qiniu 相关条目。

- [ ] **Step 1: 逐文件修改（每句一行）**
- [ ] **Step 2: Commit**

```bash
git add docs backend/tests/TEST_MAP.md
git commit -m "docs: update clone enrollment docs for base64 pathway and QWEN_BASE_URL"
```

## Task 9: 全量验收

- [ ] `cd backend && uv run ruff check . && uv run pytest -q` → 全绿
- [ ] `cd frontend && npm run lint && npm test` → 全绿
- [ ] `rg -n "qiniu" backend docs --ignore-case -g '!uv.lock'` → 仅剩历史性描述或无
- [ ] 手工验收（带真实 Key 环境，可后补）：上传 → 注册 → voice_id 落库 → 合成出声
- [ ] 最终 commit / 准备 PR

## Self-Review 结论

- 规格覆盖：§3 分发→Task 2；§4 实现细节→Task 1/2；§5 API→Task 4；§6 配置→Task 3；§7 落库→Task 4；§8 异常→Task 1/2/4；§9 清理→Task 5；§10 测试→Task 1/4/7；§11 文档→Task 8。E2E 失败路径与手工 happy path 边界已在 spec §10 与 Task 7 一致。
- 类型一致性：`_register_cloned_voice_cosyvoice_base64(path, voice_name, max_attempts, poll_interval)` 与 dispatch 调用一致；返回 dict 键 `voice_id/voice_name/role/target_model/enrollment_method` 在 conftest mock、API、测试三处一致。
- 无占位符。
