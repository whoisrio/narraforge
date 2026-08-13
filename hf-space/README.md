---
title: NarraForge API
emoji: 🎙️
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
---

# NarraForge API (HF Space)

NarraForge 后端的 HF Spaces 部署仓库（Docker SDK，免费 CPU 档）。

本仓库内容由主仓库 `scripts/sync-hf-space.sh` 同步生成，**不要直接手改**：

- `README.md` — 本文件（含 HF 要求的 YAML frontmatter）。
- `Dockerfile` — 主仓库 `backend/Dockerfile.cloud` 的副本。
- 其余文件 — 主仓库 `backend/` 目录全量。

Space 运行配置（Secrets，见主仓库 `docs/RUNBOOK.md` HF Spaces 章节）：
`DEPLOY_TARGET=workers`、`SUPABASE_*`、`MIMO_API_KEY`、`GATEWAY_SECRET`、
`CORS_ORIGINS` 等。

健康检查：`GET /health` → `{"status": "healthy"}`。
