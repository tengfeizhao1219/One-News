#!/bin/bash
# ============================================================
# git_push.sh —— 标准推送入口（多 AI 协作 / 高频开发场景）
# ============================================================
# 背景：2026-08 出现 GitHub secondary rate limit（滥用冷却）——
#       高频 push（峰值 10 次/时）触发写操作挂起/超时。
# 本脚本统一规范推送行为：
#   1) 失败指数退避（10s→30s→60s→120s，最多 5 次）
#   2) 强制 HTTP/1.1（规避 HTTP2 framing 层错误）
#   3) 推送间隔保护（同仓库 60s 内不重复 push，避免触发滥用检测）
#   4) 推送前自动跑门禁（pre-push hook 已含 check_intel.sh）
#
# 用法：
#   bash scripts/git_push.sh [--force] [branch]
#     --force  跳过推送间隔保护（紧急修复时用，慎用）
#     branch   目标分支，默认 main
# ============================================================
set -uo pipefail

# ---- 配置 ----
BRANCH="${2:-main}"
MIN_PUSH_INTERVAL=60        # 秒：同仓库最小推送间隔（滥用检测保护）
MAX_ATTEMPTS=5              # 最大尝试次数
BASE_DELAY=10               # 初始退避秒数
LOCK_FILE="$HOME/.cache/one-news-last-push"
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

# ---- 推送间隔保护 ----
now=$(date +%s)
last_push=0
if [ -f "$LOCK_FILE" ]; then
  last_push=$(cat "$LOCK_FILE" 2>/dev/null || echo 0)
fi
elapsed=$(( now - last_push ))
if [ "$FORCE" -eq 0 ] && [ "$elapsed" -lt "$MIN_PUSH_INTERVAL" ]; then
  wait_s=$(( MIN_PUSH_INTERVAL - elapsed ))
  echo "⏳ 距上次推送仅 ${elapsed}s（<${MIN_PUSH_INTERVAL}s），等待 ${wait_s}s 后再推送（防 GitHub 滥用冷却）…"
  sleep "$wait_s"
fi

# ---- HTTP/1.1 强制 ----
git config http.version HTTP/1.1 2>/dev/null || true

# ---- 推送主循环（指数退避） ----
echo "🚀 push 到 origin/$BRANCH（最多尝试 $MAX_ATTEMPTS 次）…"
delay=$BASE_DELAY
attempt=0
while [ "$attempt" -lt "$MAX_ATTEMPTS" ]; do
  attempt=$(( attempt + 1 ))
  echo "── 尝试 $attempt/$MAX_ATTEMPTS"
  if git push origin "$BRANCH" 2>&1 | tee /tmp/git-push-out.$$ ; then
    # 检查是否真的推送了（无输出时可能 Everything up-to-date，也算成功）
    if grep -q "Everything up-to-date" /tmp/git-push-out.$$ || grep -q "main -> main\|-> $BRANCH" /tmp/git-push-out.$$ || grep -q "push 成功\|推送成功" /tmp/git-push-out.$$; then
      echo "✅ push 成功"
      mkdir -p "$(dirname "$LOCK_FILE")"
      date +%s > "$LOCK_FILE"
      rm -f /tmp/git-push-out.$$
      exit 0
    fi
  fi
  # 检查是否已被推送（远端已包含本地 HEAD——可能是竞态窗口期实际成功）
  if git fetch origin "$BRANCH" --quiet 2>/dev/null && [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/$BRANCH 2>/dev/null)" ]; then
    echo "✅ 远端已包含本地 HEAD（实际已推送成功）"
    date +%s > "$LOCK_FILE"
    rm -f /tmp/git-push-out.$$
    exit 0
  fi
  if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
    echo "⚠️ push 失败/超时，${delay}s 后重试（指数退避）…"
    sleep "$delay"
    delay=$(( delay * 2 ))
    [ "$delay" -gt 120 ] && delay=120
  fi
done
echo "⛔ push 失败：$MAX_ATTEMPTS 次尝试后仍未成功。可能是 GitHub 滥用冷却或网络问题，建议 5-10 分钟后再试。"
rm -f /tmp/git-push-out.$$
exit 1
