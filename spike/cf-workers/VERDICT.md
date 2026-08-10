# VERDICT: Cloudflare Workers Python 承载 NarraForge 后端 — spike 结论

日期：2026-08-10。
环境：macOS, wrangler 4.120.0（pywrangler / workers-py 1.16.2），Pyodide 3.12.7，本地 `wrangler dev`（未真实部署）。

## 总评

**可行，但 edge-tts 必须换实现，且有明显运行时约束。**
四个检查点全部通过；其中 CP1（决定性测试）在 Worker 里真实合成出可解码的 MP3。
主要代价：edge-tts 官方包不可用（依赖 aiohttp），需要内置一个约 200 行的手写协议客户端；SQLite/文件系统类持久化需要整体替换。

---

## CP1: edge-tts WebSocket 合成 — ✅ 通过（决定性）

在 Workers Python 里用手写协议完成了一次真实合成，并校验为合法 MP3。

- 命令：`curl http://127.0.0.1:8787/edge-tts`（Worker 内执行 `src/edge_tts_ws.py: synthesize()`）
- 输出摘要：`{"ok": true, "audio_bytes": 35712, "is_mp3": true, "head_hex": "fff364c4...4c414d", "sha256": "6768a719..."}`，日志显示 `101 upgrade accepted → turn.start → response → audio.metadata → 49 个 audio chunk → turn.end`。
- 音频落盘 `output/edge_tts_worker.mp3`，本机校验：
  - `file`: `MPEG ADTS, layer III, v2, 48 kbps, 24 kHz, Monaural`
  - `afinfo`: 24000 Hz mono，estimated duration 5.952s，248 packets — 与测试文本（一句中文）时长吻合。

### 过程中踩到的三个坑（对迁移直接有效）

1. **服务端要求 WS 握手带浏览器头**。
   裸 `new WebSocket(url)`（无法自定义头）在 Node 对照实验（`test-node-ws.mjs`）和 Worker 里都被拒（1006 / error before open）。
   用 curl 复现握手：带齐 `User-Agent(Edg)`、`Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold`、`Cookie: muid=...`、`Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits` 才返回 `101 Switching Protocols`。
   **解法**：Workers 的 `fetch(url, {headers: {Upgrade: "websocket", ...}})` 可以带任意头，返回 `response.webSocket`，`accept()` 后正常收发。
   这正好避开了"workers.fetch 是否支持 WebSocket Upgrade"的疑问——支持，且是唯一可行路径。
2. **Workers 的 `fetch()` 不接受 `wss://` scheme**，报 `Fetch API cannot load: wss://...`。
   解法：把 URL 换成 `https://` + `Upgrade: websocket` 头。
3. **二进制帧解析细节**：`header_len` 包含自身 2 字节（与 edge-tts 的 `get_headers_and_data` 一致），头部从 offset 2 开始；Pyodide 里 ArrayBuffer 要用 `Uint8Array.new(buf).to_py()` 转成 bytes，`memoryview(JsProxy)` 直接报错。

### 结论

Sec-MS-GEC（SHA256(win32 ticks + token)）+ speech.config + SSML 的完整流程在 Pyodide 里纯 stdlib（hashlib/time/uuid）可跑通，无任何原生依赖。
edge-tts 协议在 Workers Python 上可用。

---

## CP2: FastAPI 在 Workers Python 跑通 — ✅ 通过

- 代码：`src/main.py`（`from workers import WorkerEntrypoint; import asgi`，`asgi.fetch(app, request, self.env)`）。
- 证据：`curl /` → `{"message":"hello from FastAPI on Workers Python","cp2":"ok"}`；`/openapi.json` 正常输出（FastAPI 完整功能可用，非裸路由）。
- 依赖机制：以 Cloudflare 官方文档为准用 `pyproject.toml` 声明依赖（fastapi、httpx），`pywrangler` 自动 vendor 成 `python_modules`（394 个模块，约 8.5MB）。
- 坑：`compatibility_date = "2025-08-01"` 时所有请求报 `TypeError: Method on_fetch does not exist`（python-entrypoint-helper），改成 `2025-11-02` 后正常；新老 entrypoint 约定对 compat date 敏感，迁移时锁死文档推荐日期。
- 冷启动：isolate 首个请求要初始化 Pyodide，本地观測 10~75s（含本机代理因素）；热请求毫秒级。正式部署需评估冷启动对 UX 的影响。

---

## CP3: httpx 出站 HTTPS — ✅ 通过

- 路由：`GET /httpx` → `httpx.AsyncClient().get("https://api.xiaomimimo.com/v1/models")`。
- 证据：返回 `status: 401`，body `{"error": {"message": "Invalid API Key", ...}}` — 正是无 key 时的预期响应，证明 TLS 出站、DNS、HTTP 语义全通。
- httpx 是 Cloudflare 文档明确支持的两个 HTTP 库之一（另一个是 aiohttp）；在 Pyodide 里它底层走 JS fetch，无需任何补丁。
- 启示：mimo_tts、dashscope(qwen_tts) 都可以绕过各自 SDK 走纯 REST + httpx，不需要 SDK 移植。

---

## CP4: Supabase Postgres 连接 — ✅ 走 REST 路径可行（直连排除）

- psycopg/asyncpg 需要原生 socket，Pyodide 没有（且不是纯 Python），直接排除，未实测。
- 验证 REST 路径：`GET /supabase` → `httpx.get("https://api.supabase.com/v1/projects")` → `status: 401, body: {"message":"Unauthorized"}`。
  Supabase 网关（Kong）正常响应，TLS + REST 语义通；PostgREST（`https://<project>.supabase.co/rest/v1/...`）只是同一机制下的另一个 HTTPS 端点，带 `apikey` 头即可用。
- 备选：Cloudflare Hyperdrive（TCP pool 代理）+ 支持 wire protocol 的纯 Python 驱动也可以评估，但对本项目的读写规模，REST 已够。

---

## 对正式迁移的启示

### 必须改的代码

1. **`backend/app/services/edge_tts_service.py`** — 不能再用 `edge-tts` 包（aiohttp 依赖）。
   把 `spike/cf-workers/src/edge_tts_ws.py` 产品化内置：Sec-MS-GEC 生成、fetch-upgrade WS 客户端、SSML/speech.config 构造、二进制帧重组。
   注意 spike 版只实现了单段文本一次性合成；后端的流式分段/WordBoundary（字幕时间轴）逻辑需要按 `communicate.py` 补齐。
2. **TTS SDK 全部走 REST**：mimo_tts、qwen_tts(dashscope) 用 httpx 直连 REST API（CP3 已证明通道可用），不要移植 SDK。
3. **持久化整体替换**：SQLite → D1 或 Supabase(PostgREST via httpx)；`backend/data/` 文件系统资产 → R2（Workers 无可写文件系统）。
   现有 `frontend/backend` 双存储模式抽象是好事，新增一个 `workers` 模式比重写便宜。
4. **LangGraph agent 不在此路径上**：agent 依赖大量 Python 生态，建议独立部署，不进 Workers。

### 运行时约束（设计时要考虑）

- 冷启动慢（Pyodide init + 8.5MB vendored 包）；依赖越多包越大，正式迁移要严格瘦身依赖列表。
- Workers CPU 时间/内存/subrequest 限制：长文本分段合成会发多个 WS，注意每请求 subrequest 配额；音频拼接在内存里做，避免大 buffer。
- 本地 `wrangler dev` 会走 shell 的 http_proxy（首个请求 16~75s），真实部署无此问题，但本地调试错觉要排除。

### 建议

- 方向可行，值得进入正式方案设计；最大风险不在协议（已验证），而在**冷启动延迟**和**持久化重写的工作量**。
- edge-tts 手写客户端建议作为后端内部的独立模块双运行时兼容（本地用 edge-tts 包，Workers 用手写），或统一用手写版减少分叉。
