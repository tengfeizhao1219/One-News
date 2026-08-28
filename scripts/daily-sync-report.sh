#!/bin/bash
# ============================================================
# daily-sync-report.sh —— 生成每日同步结论并写入 COMMLOG
# ============================================================
# 由 .git-auto/daily-sync.bat 在同步完成后调用：
#   1) 收集本次同步结果（提交数 / push 状态 / 远端同步状态）
#   2) 在 intel-docs/COMMLOG.md 顶部插入一条结论行
#   3) 提交该行并推送（随每日同步一起进 GitHub，供各会话查看）
#
# 用法：bash scripts/daily-sync-report.sh
# ============================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

DATE_TAG=$(date '+%Y-%m-%d')
TIME_TAG=$(date '+%H:%M')
LOG_FILE=".git-auto/auto.log"
COMMLOG="intel-docs/COMMLOG.md"

# ---- 从 auto.log 提取本次同步结果 ----
# 最近一次 start 到 end 之间：收集 push 结果、commit 数、pull 结果
SYNC_BLOCK=$(awk '/=== OneNews daily sync start ===/{buf=""; inblock=1} inblock{buf=buf"\n"$0} /=== OneNews daily sync end ===/{if(inblock){print buf; exit}}' "$LOG_FILE" 2>/dev/null)
# 注意：脚本自身运行前的最后一次 start/end 块是本次同步

# 提交数（"已提交：chore(auto)..." 行）
COMMIT_LINE=$(echo "$SYNC_BLOCK" | grep '已提交：' | tail -1)
COMMIT_CNT=$(echo "$COMMIT_LINE" | sed -n 's/.*（\([0-9]*\) 个文件）.*/\1/p')
[ -z "$COMMIT_CNT" ] && COMMIT_CNT=0

# push 状态（"push 成功" 或 "远端已包含本地 HEAD" = 成功）
if echo "$SYNC_BLOCK" | grep -q 'push 成功\|远端已包含本地 HEAD（实际已推送成功）'; then
  PUSH_STATUS="✅ push 成功"
elif echo "$SYNC_BLOCK" | grep -q 'push 失败\|failed to push'; then
  PUSH_STATUS="⚠️ push 失败（见 auto.log）"
else
  PUSH_STATUS="— 无推送（无改动）"
fi

# pull 状态
if echo "$SYNC_BLOCK" | grep -q 'Already up to date'; then
  PULL_STATUS="✅ 远端已同步"
elif echo "$SYNC_BLOCK" | grep -q 'Fast-forward\|Updating'; then
  PULL_STATUS="🔄 已拉取远端新提交"
else
  PULL_STATUS="—"
fi

# 工作区状态
if [ -z "$(git status --porcelain)" ]; then
  WORK_STATUS="✅ 工作区干净"
else
  WORK_STATUS="⚠️ 有未提交改动（$(git status --porcelain | wc -l | tr -d ' ') 个）"
fi

# ---- 组装结论行 ----
SUMMARY="每日自动同步 $DATE_TAG $TIME_TAG：提交 ${COMMIT_CNT} 个文件；${PUSH_STATUS}；${PULL_STATUS}；${WORK_STATUS}。详情见 .git-auto/auto.log"
ROW="| $DATE_TAG | Auto | **$SUMMARY** | ✅ 已同步 |"

# ---- 插入 COMMLOG 顶部（表头之后） ----
if [ -f "$COMMLOG" ]; then
  # 找表头行（含 | 日期 | 角色 |）之后的第一行数据插入点
  HEADER_LINE=$(grep -n '^| 日期 |' "$COMMLOG" | head -1 | cut -d: -f1)
  if [ -n "$HEADER_LINE" ]; then
    # 表头下通常有分隔行，再下一行是第一条数据 → 在第一条数据前插入
    INSERT_AT=$((HEADER_LINE + 2))
    # 用 sed 在第 INSERT_AT 行前插入
    sed -i "${INSERT_AT}i\\$ROW" "$COMMLOG"
    echo "✅ COMMLOG 已更新（第 ${INSERT_AT} 行插入）：$SUMMARY"
  else
    echo "⚠️ COMMLOG 未找到表头，跳过插入"
    exit 1
  fi
else
  echo "⚠️ COMMLOG 不存在，跳过插入"
  exit 1
fi

# ---- 提交并推送 COMMLOG（让结论进 GitHub）----
# 注意：不 add -A（遵守协作规范），只 add COMMLOG
git add "$COMMLOG"
if git commit -m "docs(auto): 每日同步结论 $DATE_TAG（$COMMIT_CNT 个文件）" >/dev/null 2>&1; then
  echo "✅ 结论已提交"
  # 推送（复用 git_push.sh，--force 跳过间隔保护；失败则等待 60s 重试一次，
  # 因为 GitHub 写操作有 60s 冷却窗口）
  if [ -f "$REPO_ROOT/scripts/git_push.sh" ]; then
    if ! bash "$REPO_ROOT/scripts/git_push.sh" --force 2>&1 | tail -3; then
      echo "⚠️ 首次推送失败，60s 后重试（GitHub 写冷却窗口）…"
      sleep 60
      bash "$REPO_ROOT/scripts/git_push.sh" --force 2>&1 | tail -3
    fi
  else
    git push origin main 2>&1 | tail -3
  fi
else
  echo "⚠️ 结论提交失败（可能已被其他进程提交）"
fi
