#!/bin/bash
# ============================================================
# daily-commit-push.sh —— 每日定时提交推送（本地改动 → GitHub 备份）
# ============================================================
# 背景：改动直落本地目录（微信开发者工具直接编译），GitHub 仅作
#       每日备份 + 多 AI 协同。本脚本每晚定时执行：
#   1) 有改动才提交（无改动静默退出）
#   2) 提交信息 = 当天日期 + 改动文件清单摘要
#   3) 推送走退避重试（复用 git_push.sh 的防滥用逻辑）
#
# 用法：
#   bash scripts/daily-commit-push.sh          # 手动执行
#   bash scripts/daily-commit-push.sh --dry    # 只看不提交
# ============================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

DRY=0
[ "${1:-}" = "--dry" ] && DRY=1

# ---- 无改动则静默退出 ----
if [ -z "$(git status --porcelain)" ]; then
  echo "✅ 工作区干净，无改动需要提交（$(date '+%F %T')）"
  exit 0
fi

# ---- 汇总改动 ----
DATE_TAG=$(date '+%Y-%m-%d')
COUNT=$(git status --porcelain | wc -l | tr -d ' ')
CHANGED=$(git status --porcelain | awk '{print $2}' | sed 's|.*/||' | tr '\n' ' ' | cut -c1-80)
echo "📦 发现 $COUNT 个改动文件：$CHANGED"

# 提交信息：当天日期 + 文件数（列出关键改动目录，保持简洁可读）
MSG="chore(auto): 每日改动提交 $DATE_TAG（$COUNT 个文件）"
DETAIL=$(git status --porcelain | awk '{print $2}' | sed 's|^|  - |' | head -20)
FULL_MSG="$MSG

自动提交（daily-commit-push.sh）：
$DETAIL"

if [ "$DRY" -eq 1 ]; then
  echo "（--dry 模式，不实际提交）"
  echo "$FULL_MSG"
  exit 0
fi

# ---- 提交 ----
git add -A
git commit -m "$FULL_MSG" >/dev/null 2>&1 || {
  # 提交失败（可能无实际差异）→ 检查
  if [ -z "$(git status --porcelain)" ]; then
    echo "✅ 改动已全部提交，无剩余差异"
    exit 0
  fi
  echo "⛔ 提交失败，请手动检查"
  exit 1
}
echo "✅ 已提交：$MSG"

# ---- 推送（复用 git_push.sh 的退避与频率保护） ----
if [ -f "$REPO_ROOT/scripts/git_push.sh" ]; then
  bash "$REPO_ROOT/scripts/git_push.sh"
else
  echo "⚠️ 未找到 git_push.sh，直接推送（无退避保护）"
  git push origin main 2>&1 | tail -3
fi
