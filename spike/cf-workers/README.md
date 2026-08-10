# Spike: FastAPI backend on Cloudflare Workers Python (Pyodide)

验证把 NarraForge 瘦身后的 FastAPI 后端部署到 Cloudflare Workers Python 运行时的可行性。
结论见 [VERDICT.md](./VERDICT.md)。

## 怎么跑

```bash
cd spike/cf-workers
uv sync                    # 安装 workers-py / pywrangler 等 dev 依赖
uv run pywrangler dev --port 8787
```

首次启动会下载 Pyodide 并 vendor 依赖（约 8.5MB），第一个请求需要等 Pyodide 初始化（10s+）。

## 检查点路由

| 路由 | 检查点 | 预期 |
|---|---|---|
| `GET /` | CP2 FastAPI 跑通 | `{"message": ..., "cp2": "ok"}` |
| `GET /httpx` | CP3 httpx 出站 HTTPS | `status: 401`（api.xiaomimimo.com 无 key） |
| `GET /edge-tts` | CP1 edge-tts WebSocket 合成 | `ok: true, is_mp3: true` + base64 音频 |
| `GET /supabase` | CP4 Supabase REST 可达 | `status: 401`（api.supabase.com 无 key） |

把 `/edge-tts` 返回的 `audio_base64` 解码即为 `output/edge_tts_worker.mp3` 同款音频（本仓库已提交一份作为证据）。

## 文件

- `src/main.py` — FastAPI app + WorkerEntrypoint（ASGI 桥接）
- `src/edge_tts_ws.py` — 手写 edge-tts 协议客户端（不依赖 edge-tts/aiohttp 包）
- `test-node-ws.mjs` — Node 侧对照实验（证明裸 `new WebSocket` 无自定义头会被服务端 1006 拒绝）
- `output/edge_tts_worker.mp3` — Worker 里真实合成出的 MP3（`afinfo` 可解码）

## 环境注意

本机 shell 若设了 `http_proxy/https_proxy`，workerd 会走本地代理发出站请求，首个请求会明显变慢（观測到 16~75s），不影响结论。
`wrangler.jsonc` 的 `compatibility_date` 用 `2025-11-02`；早期日期（2025-08-01）在 wrangler 4.120 + workers-py 1.16 下报 `Method on_fetch does not exist`。
