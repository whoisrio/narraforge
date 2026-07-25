# Narration Git Push + 手动提交

**Status**: Approved
**Created**: 2026-07-25
**Branch**: feat/narration-git-push
**Size**: Small-Medium

## 背景

`narration-git-versioning` 已实现每日 03:00 cron 快照（序列化全部项目 -> git commit），
但只本地提交，不 push；remote 地址也无处配置。需要：远端备份 + 手动触发。

## 目标

1. 全局设置 `narration_git_remote`（DB），`/settings` UI 可配。
2. 每日 cron job commit 后，若 remote 已配则 `git push`；未配只本地 commit。
3. 手动「立即提交并推送」按钮（`/settings`），触发一次 snapshot + push，返回结果。
4. 无 remote 时只本地 commit，不 push（不报错）。

## 非目标

- 不做多环境冲突合并（各 env 独立历史，普通 push；非快进冲突显式失败，不 force）。
- 不做分支配置（固定 `main`，与 `git init -b main` 一致）。
- 不做 push 鉴权配置（remote URL 内嵌凭证或 SSH key，文档说明）。

## 设计

### 全局设置

`SystemConfig` 键 `narration_git_remote`（string，可空）。`system_config_service`：
- `get_narration_git_remote(db) -> str | None`
- `set_narration_git_remote(db, value: str)`

### git_ops

新增 `push(repo, remote_url, branch='main')`：
- `git remote set-url origin <remote_url>`（无 origin 则 `git remote add origin <url>`）
- `git push origin <branch>`
- 失败抛 `GitError`（含 stderr）。

### job

`snapshot_all` 增参 `remote_url: str | None = None`：
- commit 后，若 `remote_url` 非空 -> `git_ops.push`。
- `SnapshotResult` 加 `pushed: bool` + `push_error: str | None`。
- push 失败不抛（已 commit 的事实不变），记录 `push_error`。

cron 的 `_safe_snapshot` 与手动端点都从 DB 读 remote 传入。

### API

```
GET  /api/config/narration-git-remote        -> { "value": str | null }
PUT  /api/config/narration-git-remote        body { "value": str } -> { "value": str }
POST /api/config/narration-git/snapshot      -> { "commit_sha": str|null, "projects": int, "pushed": bool, "push_error": str|null, "remote_configured": bool }
```

### 前端

`/settings`（ModelConfig）新 section "Narration Git 版本管理"：
- remote URL 文本输入 + 保存。
- 「立即提交并推送」按钮 -> POST snapshot -> 显示结果（commit sha / pushed / error）。
- i18n zh-CN + en-US。

## 测试

- **Backend unit**：`get/set_narration_git_remote` 往返；`git_ops.push`（mock subprocess：set-url + push 调用序列、无 origin 时 add、失败抛 GitError）。
- **Backend integration**：`snapshot_all` 有 remote -> push 调用；无 remote -> 不 push、`pushed=false`；push 失败 -> `pushed=false` + `push_error`，commit 仍成功。
- **API**：GET/PUT remote；POST snapshot 返回结构。
- **Frontend**：section 加载/保存 remote；按钮触发 snapshot + 结果显示。
- **E2E**（可选）：设 remote -> 点按钮 -> 断言 pushed（mock git）或 remote_configured。

## 涉及文件

- `backend/app/core/system_config_service.py` - get/set helper
- `backend/app/services/narration_versioning/git_ops.py` - `push`
- `backend/app/services/narration_versioning/job.py` - push 集成 + SnapshotResult
- `backend/app/services/narration_versioning/scheduler.py` - 传 remote
- `backend/app/api/config.py` - remote GET/PUT + snapshot POST
- `frontend/src/components/Settings/NarrationGitSetting.tsx`（新）
- `frontend/src/services/api.ts` + i18n
- `docs/api-reference.md` / `docs/narration-git-versioning.md` / `backend/tests/TEST_MAP.md`
