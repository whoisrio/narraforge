#!/usr/bin/env bash
# 同步后端代码到 Hugging Face Space 仓库（Docker SDK）。
#
# 用法：
#   scripts/sync-hf-space.sh <space-git-url> [clone-dir]
#     <space-git-url>  Space 仓库 git 地址，如 https://huggingface.co/spaces/<user>/<space>
#     [clone-dir]      本地克隆目录，默认 .hf-space-clone（已 gitignore）
#
# 同步内容（Space 仓库 = 纯镜像，见下）：
#   hf-space/README.md          → <clone>/README.md   （HF frontmatter）
#   backend/Dockerfile.cloud    → <clone>/Dockerfile
#   backend/ 全量               → <clone>/ 根目录     （Docker SDK 构建上下文 = 仓库根）
#
# 文件集合 = git 已跟踪 + 未忽略的新文件（git ls-files --cached --others
# --exclude-standard）。本地数据/密钥/模型权重（.env、*.db*、pretrained_models、
# data/、*-backup-*.tgz 等）一律被 gitignore 挡住，不会进 Space 仓库。
#
# 安全性说明：Space 仓库被当作本流程的纯镜像——rsync --delete 会删除克隆目录里
# 不属于本次同步的文件（.git / .gitattributes 除外）。不要在 Space 仓库里手工放
# 其他文件；要加文件请改主仓库 backend/ 或本脚本。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <space-git-url> [clone-dir]" >&2
  exit 1
fi
SPACE_URL="$1"
CLONE_DIR="${2:-$REPO_ROOT/.hf-space-clone}"

# 1. 拿到 Space 克隆（存在则快进到远端 main，克隆目录由本脚本独占管理）
if [[ -d "$CLONE_DIR/.git" ]]; then
  git -C "$CLONE_DIR" fetch origin
  git -C "$CLONE_DIR" reset --hard origin/main
else
  git clone "$SPACE_URL" "$CLONE_DIR"
fi

# 2. 用 staging 目录收敛文件集合，再 rsync --delete 镜像到克隆目录
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cd "$REPO_ROOT"
git ls-files -z --cached --others --exclude-standard -- backend/ hf-space/README.md \
  | while IFS= read -r -d '' f; do
      mkdir -p "$STAGE/$(dirname "$f")"
      cp "$f" "$STAGE/$f"
    done
cp "$STAGE/backend/Dockerfile.cloud" "$STAGE/backend/Dockerfile"
cp "$STAGE/hf-space/README.md" "$STAGE/backend/README.md"

# 主仓库里被误跟踪的运行时产物/测试配置，不进 Space 仓库
rm -f "$STAGE/backend/.coverage" \
      "$STAGE/backend"/workflow_checkpoints.db* \
      "$STAGE/backend/.env.e2e" "$STAGE/backend/.env.prod-test"

rsync -a --delete --exclude=.git --exclude=.gitattributes \
  "$STAGE/backend/" "$CLONE_DIR/"

# 3. 提交并推送（需确认；CI 场景用 SYNC_HF_ASSUME_YES=1 跳过提示）
cd "$CLONE_DIR"
git add -A
if git diff --cached --quiet; then
  echo "==> Space 仓库已是最新，无改动。"
  exit 0
fi
git status --short
if [[ "${SYNC_HF_ASSUME_YES:-0}" == "1" ]]; then
  answer=y
else
  read -r -p "==> 提交并推送到 Space（触发重新构建）？[y/N] " answer
fi
if [[ "$answer" == "y" || "$answer" == "Y" ]]; then
  git commit -m "sync: backend $(git -C "$REPO_ROOT" rev-parse --short HEAD)"
  git push origin main
  echo "==> 已推送，到 Space 页面看构建日志。"
else
  echo "==> 已暂存未提交。手动提交：git -C '$CLONE_DIR' commit && git -C '$CLONE_DIR' push"
fi
