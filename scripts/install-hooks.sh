#!/bin/bash
# install-hooks.sh —— 安装 AI 协作 hooks（pre-push 门禁 + 推送频率保护）
# 任何新 clone 的 One-News 仓库应先执行本脚本，确保推送规范生效。
set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$REPO_ROOT/.git/hooks"
cp "$REPO_ROOT/scripts/hooks/pre-push" "$REPO_ROOT/.git/hooks/pre-push" 2>/dev/null || \
  cp "$REPO_ROOT/.git/hooks/pre-push" "$REPO_ROOT/.git/hooks/pre-push"
chmod +x "$REPO_ROOT/.git/hooks/pre-push"
echo "✅ hooks 已安装: $REPO_ROOT/.git/hooks/pre-push"
