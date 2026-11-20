# CosyVoice 音色注册新增 base64 直传途径 — 设计文档

日期：2026-11-20。
分支：`feat/cosyvoice-base64-enrollment`。
状态：设计已获用户确认，进入实施。

## 1. 背景与问题

CosyVoice 音色注册当前依赖 dashscope SDK 的 `VoiceEnrollmentService.create_voice(url=...)`，只接受公网可访问的音频 URL。
为了凑出这个 URL，`backend/app/api/clone.py::create_clone` 必须把本地音频上传到七牛云，未配置七牛时直接 500（"Qiniu not configured"）。
本地部署用户被迫配置七牛 OSS 或 `PUBLIC_BASE_URL` 内网穿透，体验差且引入不必要的第三方依赖。

阿里云百炼已提供统一的新式 `voice-enrollment` HTTP API（`POST {base}/services/audio/tts/customization`，`action: create_voice`），
对 CosyVoice（cosyvoice-v3.5-plus/flash、v3-plus/flash、v2）与 Qwen-Audio-TTS 均适用，且 HTTP 方式支持 Base64 Data URI 直传音频，无需公网 URL。

关键事实（已核对官方文档）：

创建请求同步返回 `output.voice_id`，之后需 `action: query_voice` 轮询直到 `status == "OK"`（中间态 `DEPLOYING`）。
音色创建时永久绑定 `target_model`，换模型必须重新注册。
音频要求：WAV(16bit)/MP3/M4A、时长 ≤60s、大小 ≤10MB、采样率 ≥16kHz。
prefix 要求：仅字母数字、≤10 字符。
配额：每账号自定义音色上限 1000 个，注册免费，合成按目标模型计费。

## 2. 目标 / 非目标

目标：

- 新增“本地音频 base64 直传注册”途径，注册不再依赖公网 URL、七牛、`PUBLIC_BASE_URL`。
- 现有 SDK URL 注册路径原样保留，URL 入参场景仍走老路。
- 从 clone 注册流程中移除七牛依赖（含服务文件、SDK 依赖、手工测试）。
- 落库 `voice_id`、`target_model`、`enrollment_method`，满足模型绑定约束并保留可观测性。

非目标：

- 不做 pending/DEPLOYING 状态机：同步请求内轮询，未就绪一律按失败处理（用户已确认）。
- 不动 TTS 系列注册 `_register_cloned_voice_tts`（其请求形状与新 API 不同，后续单独验证）。
- 前端零改动：注册入口、调用签名、UI 流程全部保持不变。

## 3. 方案总览：service 层自动分发

选择逻辑集中在 `backend/app/services/qwen_tts_service.py::_register_cloned_voice_sync` 的 cosyvoice 分支：

```python
if reference_audio_path.startswith(("http://", "https://")):
    return self._register_cloned_voice_cosyvoice(...)        # 现有 SDK 路径，保持不动
return self._register_cloned_voice_cosyvoice_base64(...)     # 新增
```

前端不做任何区分：录音/上传/粘贴 URL 三种输入在 `/clone/upload` 与 `/clone/upload-from-url` 已统一归一化为本地 MP3（`source_audio_path`），
因此 `create_clone` 实际永远传本地文件、永远走新途径；URL 直传只是 service 层对历史入参的兼容。

## 4. Service 层设计

新增方法 `_register_cloned_voice_cosyvoice_base64(reference_audio_path, voice_name)`：

1. 校验本地文件：存在；扩展名 ∈ {mp3, wav, m4a}；大小 ≤10MB；用 ffprobe 校验时长 ≤60s（ffprobe 不可用时跳过该检查）。
2. 构造 data URI：`.mp3 → audio/mpeg`、`.wav → audio/wav`、`.m4a → audio/mp4`。
3. `POST {qwen_base_url}/services/audio/tts/customization`，请求体：

```json
{
  "model": "voice-enrollment",
  "input": {
    "action": "create_voice",
    "target_model": "<self.model>",
    "prefix": "clone{HHMMSS}"[:10],
    "audio": "<data URI>"
  }
}
```

4. 同步解析 `output.voice_id`。
5. 轮询 `action: query_voice`：`OK` → 返回；`UNDEPLOYED` → 抛 RuntimeError（含 voice_id）；`DEPLOYING` → 继续；间隔 2s、上限 90s，超时抛 RuntimeError（含 voice_id）。
6. 成功返回 `{"voice_id", "voice_name", "role": "custom", "target_model": self.model}`。

顺手修复现有 bug：`clone{HHMMSS}` 共 11 字符，超出官方 ≤10 限制；新路径统一 `[:10]` 截断。
HTTP 请求用 urllib 直发并禁用代理（与仓库既有 dashscope 调用习惯一致），错误分支解析 DashScope 错误 body（code/message/request_id）并原样透出。

## 5. API 层设计

`backend/app/api/clone.py::create_clone` 简化：

- 删除 `external_audio_url` 优先逻辑、七牛上传分支与 "Qiniu not configured" 错误。
- 流程改为：`_resolve(source_audio_path)`（缺失 → 404）→ `register_cloned_voice(本地路径)` → 落库。
- 失败 → 500（带上游 message 与 voice_id，如有），profile 保持「已上传未注册」状态，可直接重试。
- 成功落库：`voice.voice = {"model": "cosyvoice", "voice_type": "clone"}`；
  `voice_params.cosyvoice.params` 写入 `voice_id`、`target_model`、`enrollment_method`。

`/clone/upload-from-url` 保留（它是音频输入方式，与注册途径无关）。

## 6. 配置

- `backend/app/core/config.py` 新增 `qwen_base_url: str = "https://dashscope.aliyuncs.com/api/v1"`（环境变量 `QWEN_BASE_URL`）。
  旧域名官方确认仍可用；业务空间专属域名 `{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1` 通过该配置支持。
- `backend/app/core/model_config_service.py` 的 `PROVIDER_SCHEMAS["qwen_tts"]` 增加 `base_url` 字段（照抄 `mimo_tts` 的 `base_url` 写法），UI 可配。
- `get_tts_service` 的配置指纹纳入 `base_url`，配置变更时重建单例。

## 7. 数据落库

`voice_profiles.voice_params`（JSON 列，无迁移）：

```jsonc
{
  "cosyvoice": {
    "source_audio_path": "data/voices/profiles/xxx.mp3",
    "params": {
      "voice_id": "cosyvoice-v3.5-plus-clone-xxxx",
      "target_model": "cosyvoice-v3.5-plus",
      "enrollment_method": "base64"
    }
  }
}
```

`enrollment_method` 取值 `"base64" | "url"`，仅作运维观测，不影响任何行为。

## 8. 异常处理（已确认：按失败处理）

| 阶段 | 场景 | 处理 |
| --- | --- | --- |
| 创建请求失败（无 voice_id） | 音频超限/格式错/API Key 无效/配额满/prefix 不合规 | 抛错 → API 500（透出上游 message）→ profile 保持未注册 → 用户可直接重试，无副作用 |
| 创建成功但部署未就绪（有 voice_id） | `UNDEPLOYED`（音频质检不过）或轮询超时（持续 `DEPLOYING`） | RuntimeError 信息必须包含 voice_id（云端已产生记录，需可追溯、可清理） |

孤儿音色清理沿用现有 `/clone/sync-from-qwen` 通道，不新增补偿逻辑。

## 9. 七牛清理

已 grep 确认 clone 流程外无业务调用，删除：

- `backend/app/services/qiniu_service.py`
- `clone.py` 中 `upload_to_qiniu` / `is_qiniu_configured` 及其调用
- `pyproject.toml` 中 `qiniu` 依赖
- `backend/tests/manual/manual_qiniu_upload.py`
- 相关文档中关于注册需配置七牛的描述

## 10. 测试计划（TDD：先红后绿）

单元（`backend/tests/unit/test_qwen_tts_service.py`）：

- data URI 构造与 MIME 映射（mp3/wav/m4a）。
- prefix ≤10 字符且仅字母数字。
- create_voice 请求体形状（model/action/target_model/prefix/audio）。
- `output.voice_id` 解析；缺少该字段时报错。
- 轮询三态：OK 返回；UNDEPLOYED 与超时的 RuntimeError 均含 voice_id。
- 以 `http(s)://` 开头的入参仍路由到既有 SDK 路径。

集成（`backend/tests/integration/test_clone_api.py` 与 `backend/tests/test_api_clone.py`）：

- 未配置七牛时 `POST /clone/create-clone` 成功（mock service 层），落库含 `voice_id` + `target_model` + `enrollment_method`。
- 本地音频缺失 → 404。
- 注册失败 → 500，profile 仍为 upload 态。
- 存量依赖七牛 mock 的用例改写为 base64 路径断言。

E2E（`tests/e2e/specs/voice-clone.spec.ts`）：

- 现有 MiMo 用例保持不变。
- 新增 CosyVoice 注册流程用例：选择 CosyVoice 引擎 → 上传音频 → 触发注册。
  CI 环境无真实 DashScope Key，断言失败路径：错误被 UI 优雅呈现、无未捕获异常、profile 未被误标为 clone。
  真实注册的 happy path（注册成功 → DB 断言 `voice_id`/`target_model` → 合成出声）作为带 Key 环境的手工验收步骤，
  写入 `docs/e2e-test-guide.md` 的 gap 分析与运行说明。

验收命令：`cd backend && uv run ruff check . && uv run pytest -q`；
E2E：`npm run e2e`；
手工 happy path：不配七牛/`PUBLIC_BASE_URL`，上传 → 注册 → voice_id 落库 → 合成出声。

## 11. 文档更新（随本 PR）

- `docs/api-reference.md`：`create-clone` 行为变更（不再需要公网 URL/七牛；新增落库字段说明）。
- `docs/ENV.md`：新增 `QWEN_BASE_URL`。
- `docs/database-schema.md`：`voice_params.cosyvoice.params` 示例补 `target_model`、`enrollment_method`。
- `docs/deployment-feature-matrix.md`：CosyVoice 注册解除七牛/公网 URL 依赖的部署形态说明。
- `docs/e2e-test-guide.md`：CosyVoice 注册的 E2E 覆盖与手工验收步骤。
- `backend/tests/TEST_MAP.md`：新增/改写用例登记。

## 12. 分支与提交

- 全程在 `feat/cosyvoice-base64-enrollment` 分支，不直接改 master。
- 提交信息使用英文，不含 AI 署名。
