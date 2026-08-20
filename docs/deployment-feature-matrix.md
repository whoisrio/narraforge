# 部署功能矩阵（线上轻量服务 vs 本地算力）

本文整理 NarraForge 各功能对运行环境的依赖，划分「能跑在轻量线上服务（Vercel serverless / Cloudflare Workers + Supabase）」与「只能跑在本地」两类。
代码内的事实源是 `backend/app/core/deploy_capabilities.py`（`GET /api/config/capabilities` 的数据来源）与 `backend/main.py` 中按 `deploy_target` 条件挂载的路由。

- `local`：本地开发/自托管，全量功能（含本地 ML 模型、ffmpeg、git、Node.js）。
- `workers`：线上轻量形态，不安装 `local-ml` 依赖（torch/faster-whisper/funasr/voxcpm），不挂载本地专属路由。

> 前端导航差异：workers 部署下「设置」（模型配置页）入口对用户隐藏——线上凭据由服务端环境变量统一管理，页面无可配置项；`/api/model-config/*` 端点本身仍按 A 类保留。

## A. 线上轻量可跑（workers 模式已支持）

| 功能 | 端点 | 依赖 |
|---|---|---|
| edge-tts 合成 | `POST /api/tts/synthesize`（engine=edge_tts）、`GET /api/tts/edge-voices`、`/edge-languages` | 微软在线 TTS；workers 用手写 WS 客户端（`edge_tts_ws_client.py`） |
| MiMo TTS | `/api/mimo-tts/*`（voices/preset/voicedesign/voiceclone/voiceclone-direct） | 纯 httpx 调小米 API（OpenAI 兼容） |
| LLM 文本处理 | `POST /api/text-split/llm`、`/ssml-annotate`、`/api/subtitle-llm/correct`、`/translate`、`/api/text-analysis/split` | OpenAI 兼容 HTTPS |
| 纯 Python 文本处理 | `POST /api/text-split/rule`、`/markdown-detect`、`/markdown-split`、章节 rule 拆分 | 无外部依赖 |
| 项目/章节/分段 CRUD | `/api/segmented-projects/*`（通用 router） | Supabase PostgREST + Storage（asset store） |
| 分段合成 | segment synthesize（engine ∈ edge_tts/mimo_tts） | `segmented_synth_workers.py` 已限定引擎 |
| 角色/源文档/配置 | `/api/roles`、`/api/sources`、`/api/config/*`、`/api/model-config/*` | PostgREST；model-config 用 RSA 加密（cryptography 为 base 依赖） |
| 管理后台统计 | `GET /api/admin/stats/overview`、`/api/admin/users`、`/api/admin/logs` | Supabase 统计表（profiles/daily_stats/operation_logs/daily_active_users）+ `increment_metric` RPC；仅 admin |
| Try 页（/try 获客页） | 前端静态页 + `POST /api/tts/synthesize`（edge_tts）+ `GET /api/tts/edge-voices`；匿名按 IP 限流（`rate_limit_counters` 表 + `hit_rate_limit` RPC） | 纯前端 IndexedDB 存储历史，零项目持久化 |

> workers 模式的认证语义（2026-08 起）：A 类端点中，仅匿名 allowlist
> （`GET /health`、`GET /`、`GET /api/config/capabilities`、`GET /api/config/storage-mode`、
> `POST /api/tts/synthesize`（仅 edge_tts）、`POST /api/mimo-tts/*`、`POST /api/text-split/*`、
> `POST /api/subtitle-llm/*`、`POST /api/text-analysis/*`）对匿名放行；
> 其余一律要求 Supabase 用户 JWT 或 legacy admin 凭证，且按用户隔离数据。
> 详见 `docs/api-reference.md`「认证与数据隔离」。
| MiMo 克隆 | `POST /api/clone/create-clone-mimo`、`/create-from-design`、`/upload-from-url`、`/upload-from-storage` | httpx + Supabase Storage presigned 上传 |

## B. 本质是云端 API，但因 SDK 依赖暂只能在 local 跑（后续可改造）

这些功能不需要本地算力，仅因第三方 SDK 不兼容 Pyodide 而未上 workers；改写为纯 httpx 后可迁入 A 类。

| 功能 | 端点 | 阻塞点 |
|---|---|---|
| CosyVoice 克隆/合成 | `POST /api/clone/create-clone`、`GET /api/clone/list-from-qwen`、`POST /api/clone/sync-from-qwen`、`POST /api/tts/batch` | dashscope SDK（WebSocket 声音注册）+ qiniu SDK（OSS 上传公网 URL） |
| LangGraph agent 服务 | `agent/`（narration / knowledge_video 图） | 运行时本身无本地算力（全是 LLM + HTTP 调后端），但 `langgraph dev` 是有状态内存服务，不适合 serverless；且 voxcpm 引擎与 scaffold 节点依赖本地后端能力 |

## C. 只能本地（算力/环境依赖，架构上无法上 serverless）

| 功能 | 端点/入口 | 依赖 |
|---|---|---|
| VoxCPM 合成/克隆/音色设计 | `/api/voxcpm/*`（status/load/unload/tts/design/clone/ultimate-clone） | 2B 参数本地模型，ModelScope 下载权重，GPU/CPU 推理 |
| 语音转写 | `POST /api/speech-to-text/transcribe`、`/multi-transcribe` 及历史/下载 | faster-whisper（HF 模型下载）/ FunASR（paraformer-zh + fsmn-vad + ct-punc）；多音频合并用 ffmpeg |
| 克隆音频上传转码 | `POST /api/clone/upload` | ffmpeg（libmp3lame） |
| 章节音频导出/调整 | segmented local_router：`export-audio`、`export-all-chapters`、`adjust-audio(-all)`、项目 ZIP `export` | ffmpeg/ffprobe（拼接、调速调音量、响度探测） |
| Remotion 脚手架 | `POST /api/segmented-projects/{id}/scaffold-remotion` | shell 调 `npx create-video`（需 Node.js）+ 本地文件系统 |
| 旁白 git 版本快照 | `POST /api/config/narration-git/snapshot` + apscheduler 定时 | 本地 git 仓库（`data/narration-repo/`） |

## 维护约定

- 新增功能时先判定类别：只依赖网络/纯 Python/Supabase 的进 A；依赖第三方不兼容 SDK 的进 B 并记录阻塞点；依赖本地模型/二进制/文件系统的进 C。
- workers 清单必须保持为 local 清单的子集（`deploy_capabilities.py` 头部注释的既有约束）。
- 功能迁移（B→A）后同步更新本文档、`deploy_capabilities.py` 与 `docs/RUNBOOK.md`。
