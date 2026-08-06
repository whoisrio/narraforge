# 本机产品化：全局命令 `narraforge`（无 Docker）

**Status**: TODO (待实施)
**Depends on**: 无
**Created**: 2026-08-06

---

## 背景 / 现存问题

当前使用 NarraForge 需要开 VSCode、开多个终端分别启动 backend（uvicorn:8002）、frontend（vite:5173）、agent（langgraph dev:2024）。
目标是把日常使用产品化：安装一次后，在**任意目录**下用一条全局命令管理整套服务。

```bash
narraforge start    # 后台启动 backend+agent，就绪后自动打开浏览器
narraforge stop     # 停止
narraforge status   # 查看运行状态
narraforge logs     # 跟踪日志
narraforge start --fg   # 前台模式（调试用，Ctrl+C 停止）
```

### 关键决策：不用 Docker

backend 的 Remotion 脚手架（`backend/app/services/remotion_scaffold_service.py`）通过 `subprocess` 调宿主机的 `npx create-video`，并把项目写到宿主机真实路径（全局设置 `animation_root_folder`，解析结果存入 DB 的 `remotion_project_path`）。
Docker 化之后，容器内需要另装 Node，且容器内写出的路径与宿主机不一致，DB 里存的路径对宿主机失效。
本机已有 Python(uv)、Node、ffmpeg，原生运行零新增依赖、对 Remotion 链路天然兼容。
Docker 仅作为将来服务器/Cloudflare 部署的备选路线（见「备选」节）。

## 设计要点

### 架构

产品模式下由 backend 直接托管前端构建产物（`frontend/dist`）。
前端 API 走相对路径 `/api`（`frontend/src/services/api.ts`），agent 走 `http://<hostname>:2024` 直连（`frontend/src/services/langgraph/client.ts`）。
因此浏览器同源访问 8002 拿 UI+API、直连 2024 拿 agent SSE，**前端代码零改动**。
agent 通过 `BACKEND_API_URL=http://127.0.0.1:8002` 调 backend，本机原生部署下不变。
现有 dev 流程（`npm run dev`、vite 5173、开发版 docker-compose.yml）完全保留、不受影响。

```text
用户 shell (任意目录)
  └─ narraforge            # ~/.local/bin/narraforge → repo/bin/narraforge (symlink)
       └─ node scripts/serve.cjs <cmd>   # repo 根由脚本自身路径推导，不依赖 cwd
            ├─ backend: uv run uvicorn main:app --port 8002   (托管 frontend/dist)
            └─ agent:   uv run langgraph dev --port 2024
```

### 1. backend 托管前端静态文件

`backend/main.py` 在所有 API 路由注册之后，若 dist 目录存在则挂载 `app.mount("/", StaticFiles(directory=dist, html=True))`。
加 SPA fallback：未匹配的 GET（排除 `/api`、`/agent`、`/docs`、`/health` 等前缀）返回 `index.html`，保证前端路由刷新不 404。
`backend/app/core/config.py` 增加 `frontend_dist_dir: Path`（默认 `repo/frontend/dist`，可用 `FRONTEND_DIST_DIR` 覆盖）。
目录不存在时跳过挂载，dev 行为不受影响。

### 2. `scripts/serve.cjs`：服务管理器

Node 脚本（跨平台），repo 根由 `__dirname` 推导，不依赖调用时 cwd。
子命令：

- `start`（默认后台）：detached spawn 两个进程。
  - backend：`uv run uvicorn main:app --host 127.0.0.1 --port 8002`（cwd=backend，无 reload）。
  - agent：`uv run langgraph dev --host 127.0.0.1 --port 2024`（cwd=agent）。
  - 启动前若 `frontend/dist` 不存在或 `src/` 比 dist 新，先 `npm run build`（cwd=frontend）。
  - PID 写 `.run/backend.pid`、`.run/agent.pid`；日志写 repo 根 `logs/backend.log`、`logs/agent.log`。
  - 轮询 `/health` 就绪后打印地址并 `open http://localhost:8002`。
  - 端口被占用或 PID 文件指向存活进程时明确报错退出，不重复启动。
- `start --fg`：前台模式，输出打屏（沿用 `scripts/dev-run.cjs` 的行前缀方式），Ctrl+C 一并关停（含 Windows taskkill 逻辑）。
- `stop`：读 PID 杀进程，清理 PID 文件；PID 失效时按端口兜底（lsof 查 8002/2024）。
- `status`：打印两个进程存活状态 + `/health`、agent `:2024/ok` 结果。
- `logs [-f]`：tail 两个日志文件。

### 3. `bin/narraforge`：全局入口脚本

POSIX shell 脚本，解析自身真实路径（追随符号链接）定位 repo 根，然后 `exec node "$ROOT/scripts/serve.cjs" "$@"`。

### 4. 安装/卸载

- `npm run install:cmd` → `node scripts/install.cjs`：
  - 在 `~/.local/bin/narraforge` 建符号链接指向 `bin/narraforge`（目录不存在则先创建）。
  - 检测 `~/.local/bin` 是否在 PATH；不在则打印建议添加到 shell rc 的行（不擅自修改用户 rc 文件）。
  - 链接已存在时提示覆盖确认。
- `npm run uninstall:cmd`：删除符号链接。
- 根 `package.json` 增加 `install:cmd`、`uninstall:cmd` 两个 script。

### 5. 文档更新

- `docs/RUNBOOK.md` 新增「本机产品模式（全局命令）」节：安装一次 → 任意目录 `narraforge start`；数据位置（`backend/data/`、`backend/voice_clone.db` 不动）；升级流程（git pull 后 `narraforge start` 自动重建前端）。
- `docs/RUNBOOK.md` 补「Cloudflare 部署路线」节（仅文档）：前端 dist 可上 Cloudflare Pages；backend 是 Python+ffmpeg+torch 栈，不能跑 Workers，正确路径是服务器上跑本机模式 + Cloudflare Tunnel 暴露 8002/2024。
- `AGENTS.md` 架构节补一句：产品模式 = backend 托管 `frontend/dist` + 全局 `narraforge` 命令（`bin/narraforge` → `scripts/serve.cjs`）。

## 分阶段 Rollout

单阶段即可，实施顺序：

1. `backend/main.py` + `config.py`：静态托管与 SPA fallback。
2. `scripts/serve.cjs` + `bin/narraforge` + `scripts/install.cjs` + `package.json` scripts。
3. 按「验证清单」端到端验证。
4. 文档更新（RUNBOOK、AGENTS.md），删除/归档本 todo。

## 明确不做

- 不引入 Docker；不改 dev 流程与开发版 docker-compose.yml。
- agent 仍用 `langgraph dev`（内存态，与现状一致；持久化本来就是 deferred）。
- 不做 macOS .app、不做开机自启 plist（后续想要可再加，全局命令已为它打好底）。
- 不做 PostgreSQL、nginx、Electron/Tauri。
- 不把代码/数据搬出项目目录；全局命令只是指向项目目录的入口。

## 备选：Docker All-in-One（将来服务器用，本次不实施）

若之后部署到服务器：根目录多阶段 `Dockerfile`（node 构建前端 → python:3.12-slim 装 ffmpeg/uv，backend+agent 双 venv，entrypoint 同容器起两进程）+ prod compose（挂 `backend/data`、`backend/pretrained_models` 卷）。
Remotion 脚手架的解法：`animation_root_folder` 指向的宿主机目录以**相同绝对路径** bind-mount 进容器，DB 里存的 `remotion_project_path` 才对宿主机有效；容器内还需装 Node 供 `npx create-video`。

## 验证清单

1. `npm run install:cmd` 后，在 `$HOME` 等非项目目录执行 `narraforge start`：8002 `/health` ok、agent 2024 正常、浏览器自动打开 UI。
2. UI 各前端路由（如 /settings）刷新不 404。
3. edge-tts 合成一条音频成功（无需 key，端到端验证）。
4. 工作流 drawer 连 agent（2024 SSE 正常）。
5. 触发 scaffold-remotion：脚手架写到宿主机 `animation_root_folder`，路径与 DB 记录一致。
6. `narraforge stop` 后进程清干净、无残留端口占用；再次 `narraforge start` 数据仍在。
7. `narraforge status` / `logs` 输出正确。

## Open Questions

- Windows 上 `bin/narraforge` shell 脚本不可用，是否需要同时提供 `narraforge.cmd`？（当前主用 macOS，可后续再补。）
- `~/.local/bin` 若不在 PATH 且用户不愿改 rc，是否提供备选安装位置（如 `/usr/local/bin`，需 sudo）？
