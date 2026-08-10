# NarraForge Cloudflare 部署设计（Pages + Workers Python + Supabase）

日期：2026-08-10
状态：已确认路线，待用户审阅
前置验证：`spike/cf-workers/VERDICT.md`（branch `spike/cloudflare-workers-python`，commit `1a46e6e`）

## 1. 背景与目标

把 NarraForge 部署到 Cloudflare，通过 GitHub 导入自动构建。
Cloudflare 版只保留两个在线 TTS 引擎（edge-tts / 小米 mimo）和 mimo 在线声音克隆；不提供 dashscope/qwen TTS 与克隆、本地模型 TTS（voxcpm）、语音转字幕（whisper/funasr），不部署 LangGraph agent 工作流。
本地完整主线功能零回退：同一 `main` 分支既能本地全功能运行，也能构建出 Cloudflare 瘦版。

非目标：
- Cloudflare 版不做 agent 自动化工作流（narration / knowledge_video）。
- Cloudflare 版不做 dashscope/qwen 相关能力（cosyvoice TTS、dashscope 克隆、七牛上传）。
- Cloudflare 版不做 Remotion 脚手架（依赖 `npx create-video` 和本地文件系统）。
- Cloudflare 版不做 narration git 版本快照（依赖本地 git 仓库和 apscheduler 常驻进程）。
- 不重写前端框架、不改变本地开发体验。

## 2. 总体架构

```
GitHub repo (main 分支，单代码库)
├── Cloudflare Pages      → frontend/ 静态构建（Vite, dist/）
├── Cloudflare Workers    → backend/ Python 运行时（pywrangler 部署 FastAPI）
│     ├── Supabase (Postgres, 走 PostgREST REST)  ← 关系数据
│     └── Cloudflare R2                           ← 二进制资产（音色样本/试听）
└── 本地开发              → uvicorn + SQLite + 完整本地模型（行为不变）
```

核心机制是**部署模式开关** `DEPLOY_TARGET=local|workers`（默认 `local`）。
一份代码，两个入口：`uvicorn main:app`（本地）和 Workers entrypoint（`asgi.fetch`）。

## 3. 后端改动

### 3.1 应用工厂化与路由条件注册

把 `backend/main.py` 重构为 `create_app(deploy_target)` 工厂。
workers 模式下不注册以下路由模块：
- `voxcpm.py`（本地 GPU 模型）
- `speech_to_text.py`（本地 whisper/funasr）
- `segmented_projects.py` 中依赖 ffmpeg 和本地文件系统的端点（章节合成落盘、export-audio、adjust-audio）在 workers 模式下不挂载。

保留的路由（全部纯在线或纯数据）：
`tts.py`（只保留 edge-tts 端点，qwen/dashscope 端点不挂载）、`mimo_tts.py`（全部，含 preset/voicedesign/voiceclone）、`clone.py`（只保留 mimo 克隆端点，dashscope/voxcpm 端点不挂载）、`subtitle_llm.py`、`text_split.py`、`text_analysis.py`、`config.py`、`model_config.py`、`roles.py`、`sources.py`、`segmented_projects.py` 的元数据 CRUD 部分。

workers 模式下跳过 `init_db()` 的 SQLite 迁移和 apscheduler 启动（`main.py:108-118` 的启动逻辑按模式分支）。

### 3.2 依赖分组

`backend/pyproject.toml` 把不兼容 Pyodide 的依赖全部挪到 optional extras：
```toml
[project.optional-dependencies]
local-ml = ["torch", "torchaudio", "voxcpm", "funasr", "faster-whisper", "modelscope", "soundfile"]
local-services = ["edge-tts", "dashscope", "qiniu"]   # 含原生扩展的 SDK，workers 模式用 httpx/内置 WS 客户端替代
```
本地安装 `uv sync --extra local-ml --extra local-services`（README/AGENTS.md 同步更新）。
pywrangler 只安装 `[project.dependencies]`（fastapi、httpx、sqlalchemy 等纯 Python 包），workers 构建天然不含 torch 系和 aiohttp 系 SDK。

### 3.3 edge-tts 客户端策略化

workers 模式用 spike 验证过的手写 WS 客户端（`spike/cf-workers/src/edge_tts_ws.py` 产品化，基于 `workers.fetch` 的 WebSocket Upgrade，纯标准库实现 Sec-MS-GEC / SSML / 帧重组）。
本地模式继续用 edge-tts 包。
两者收敛到 `edge_tts_service.py` 后面的同一个接口（`synthesize(text, voice, rate, emotion) -> audio_bytes`），按 `DEPLOY_TARGET` 选择实现。
产品化时补齐 spike 版未覆盖的能力：多段文本的流式分段、WordBoundary 时间轴（字幕对齐用到）。

### 3.4 mimo 走纯 httpx

`mimo_tts_service.py` 把 `urllib.request` 换成 httpx（spike 已验证 httpx 在 Pyodide 可用，且本地 CPython 同样可用，一份代码两处跑）。
mimo voiceclone 样本音频由前端上传后经 Workers 直接转发给 mimo API，不需要公网音频 URL，因此 workers 模式不引入七牛。
dashscope/qwen 相关代码（`qwen_tts_service.py`、`qiniu_service.py`）不进 workers 构建目标，本地模式原样保留。

### 3.5 持久化层（工作量最大的一块）

现状：所有路由经 `Depends(get_db)` 拿 SQLAlchemy Session，访问集中在 `app/core/database.py`。
workers 运行时没有原生 socket，psycopg/asyncpg 不可用（spike 结论），只能走 Supabase PostgREST REST。

设计：
- 在 service 层与 SQLAlchemy 之间引入仓储接口（Repository），覆盖 workers 模式必需的表：
  `segmented_projects` / `segmented_project_chapters` / `segmented_project_segments`、`voice_profiles`、`system_configs`、`roles`、`source_documents`。
- `tts_results` / `transcription_records` 在 workers 模式不持久化（frontend 存储模式下历史本来就在 IndexedDB）。
- 本地模式：现有 SQLAlchemy + SQLite 路径不动，Repository 直接委托现有代码。
- workers 模式：`SupabaseRepository` 用 httpx 调 PostgREST，表结构用一份独立的 Postgres schema SQL（不搬 `database.py` 里约 1000 行 SQLite 方言迁移；schema 从 SQLAlchemy 模型定义导出，作为 Supabase 迁移文件提交）。
- 二进制资产（克隆样本音频、试听音频）workers 模式存 R2（Workers binding），DB 里存 R2 key；本地模式继续存 `backend/data/`。

### 3.6 鉴权（新增，必须）

本地版无鉴权，公网部署必须加，否则任何人能消耗 mimo/edge-tts 调用额度、读写你的项目数据。
workers 模式启用共享密钥校验：
- 后端：FastAPI 依赖项校验 `Authorization: Bearer <token>`，token 存 Workers secret；校验失败返回 401。`/api/health` 和 CORS 预检放行。
- 前端：未持 token 时显示一个简洁的解锁页（输入口令），输入后存 localStorage，axios 拦截器统一带上；401 时清掉 token 回到解锁页。
- 范围：单用户共享口令，不引入多用户/注册体系（YAGNI，后续有需求再换 Supabase Auth）。
本地模式默认关闭，不破坏现有开发和 e2e。

### 3.7 CORS 与域名

Workers 后端挂 `api.<域名>`（或 workers.dev 子域），CORS 放行 Pages 域名。
前端 `api.ts` 的 `baseURL` 改为 `import.meta.env.VITE_API_BASE_URL || '/api'`（含 `api.ts:626` 的 export-audio URL 拼接），Pages 环境变量注入后端地址；本地默认 `/api` 走 Vite proxy，行为不变。

## 4. 前端改动

- 新增运行时能力探测：`GET /api/config/capabilities` 返回 `{ deploy_target, engines: [...], clone_engines: [...], features: { speech_to_text, agent_workflow, backend_storage } }`。
  workers 模式 `engines` 只含 `edge_tts` / `mimo_tts`，`clone_engines` 只含 `mimo`。
  前端据此隐藏/禁用：SpeechToText 页入口、VoiceClone 的 qwen/voxcpm 克隆引擎选项、TTS 面板的 cosyvoice/voxcpm 引擎分支、ModelConfig 页的 `qwen_tts` provider 配置项、工作流 drawer 入口、backend 存储模式切换。
- axios 实例加 Authorization 拦截器（见 3.6）。
- 修复已发现的 agent URL 不一致（`WorkflowDrawer.tsx:89` 硬编码 `localhost:2024`）——workers 模式直接不渲染 drawer，本地模式顺手修掉。
- 其余页面（TTSSynthesis 主工作室、VoiceClone 在线克隆、ModelConfig）无结构改动。

## 5. 构建与部署

### 5.1 前端（Pages）
- Cloudflare Dashboard → Pages → Connect to Git，选仓库。
- Root directory: `frontend`；Build command: `npm run build`；Output: `dist`。
- 环境变量：`NODE_VERSION=22`、`VITE_API_BASE_URL=https://api.<域名>/api`。

### 5.2 后端（Workers）
- `backend/wrangler.toml`：python_workers 兼容标志，`compatibility_date >= 2025-11-02`（spike 验证 2025-08-01 有 `on_fetch` 报错），入口 `workers_entry.py`，绑定 R2 bucket，secrets 存 Supabase service key、mimo API key、访问 token。
- Git 集成：Workers Builds 连接同一仓库，root `backend/`，build command `uv sync && uv run pywrangler deploy`；若 Workers Builds 对 Python 支持有问题，退用 GitHub Actions + `wrangler-action`（ secrets 存 GitHub）。
- 冷启动风险（spike 遗留）：真实部署后实测首请求延迟，必要时评估 Workers 的 Python 快照预热手段或接受。

### 5.3 Supabase
- 免费档建项目，执行 Postgres schema 迁移 SQL（来自 3.5）。
- 开启 PostgREST，service_role key 只放 Workers secrets，不进前端。

## 6. 数据流（workers 模式一次合成）

1. 前端 POST `/api/tts/synthesize`（带 Bearer token）。
2. Workers 校验 token → 按引擎分发：edge-tts 走内置 WS 客户端 / mimo 走 httpx REST。
3. 音频以 base64 返回前端，前端存 IndexedDB（frontend 存储模式，音频不经 Workers 持久化）。
4. 项目/章节/分段元数据经 `SupabaseRepository` 写 PostgREST；mimo 克隆样本/试听音频写 R2。

## 7. 测试策略（TDD）

- 后端：每个新仓储实现配 pytest（SupabaseRepository 用 httpx mock / responses 录制）；`create_app('workers')` 的路由注册快照测试（断言 voxcpm/speech-to-text 不存在、在线路由存在）；edge-tts WS 客户端协议单测（帧重组、GEC token），集成测试沿用 spike 的真实合成用例（标记 `external`）。
- 前端：capabilities 驱动的 UI 显隐测试（Vitest）；axios 拦截器测试。
- e2e：现有 `tests/e2e/` 继续跑本地模式；新增一组 workers 模式 smoke e2e（`pywrangler dev` 起后端，跑核心合成链路），单独标记，不进默认 `npm run e2e`。
- 本地模式回归：`backend` 全量 pytest + 前端 build/lint + `npm run e2e` 必须全绿才算完成。

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| Workers Python 冷启动慢 | 真实部署后实测；可接受则记录，不可接受退回 Containers 方案（镜像同代码可复用） |
| SupabaseRepository 重写遗漏边界 | 仓储接口从现有 service 逐方法提取，TDD 覆盖；frontend 存储模式下需要持久化的表面已收敛到 5 张表 |
| Workers Builds 不支持 Python 构建 | 退路 GitHub Actions + wrangler-action |
| edge-tts 协议被微软改动 | WS 客户端是我们自己的代码，协议变更只需改一处；集成测试会立刻暴露 |
| 共享口令泄露 | token 可随时在 Workers secrets 轮换；前端 localStorage 不含敏感数据 |

## 9. 实施顺序（高层）

1. 后端应用工厂化 + `DEPLOY_TARGET` + 依赖分组（本地模式回归全绿）。
2. mimo httpx 化 + edge-tts WS 客户端产品化与策略化。
3. 仓储接口 + SupabaseRepository + R2 资产存储。
4. Workers 入口 + wrangler.toml + 鉴权 + CORS。
5. 前端 capabilities + 解锁页 + baseURL 环境变量 + axios 拦截器。
6. Pages / Workers / Supabase 三处部署打通，真实环境验证冷启动与核心链路。
