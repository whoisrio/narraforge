---
title: NarraForge API
emoji: 🎙️
colorFrom: indigo
colorTo: blue
sdk: gradio
python_version: "3.12"
app_file: app.py
---

# NarraForge API (HF Space, Gradio SDK)

NarraForge 后端的 HF Spaces 部署仓库（**Gradio SDK 兜底路径**——不依赖 Docker SDK
的收费策略；本 Space 不使用 Gradio 界面，`app.py` 直接起 uvicorn 跑 FastAPI）。

本仓库内容由主仓库 `scripts/sync-hf-space.sh --sdk gradio` 同步生成，**不要直接手改**：

- `README.md` — 本文件（含 HF 要求的 YAML frontmatter）。
- `app.py` — 启动器（主仓库 `hf-space/app.py`），起 uvicorn 服务 `backend/main:app`。
- `requirements.txt` — 由 `uv export` 从 backend 依赖生成（core + local-services，不含 torch）。
- `backend/` — 主仓库 `backend/` 目录全量。

Space 运行配置（Secrets，见主仓库 `docs/RUNBOOK.md` HF Spaces 章节）：
`DEPLOY_TARGET=workers`、`SUPABASE_*`、`MIMO_API_KEY`、`GATEWAY_SECRET`、
`CORS_ORIGINS` 等。

健康检查：`GET /health` → `{"status": "healthy"}`。
