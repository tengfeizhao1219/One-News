#!/usr/bin/env bash
# 任务看板解析 & 接力棒状态速览
# 用法：
#   scripts/pending-tasks.sh              # 一次性快照
#   scripts/pending-tasks.sh --watch      # 每 60 秒轮询，有变化时输出 diff
#   scripts/pending-tasks.sh --quiet      # 静默模式，有变化才输出
#
# GitHub Actions 用法：
#   scripts/pending-tasks.sh --github     # 输出 GitHub Actions 格式摘要
#
# 输出 JSON 摘要到 stdout 最后一行，方便 Monitor / CI 解析。

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_FILE="/tmp/pending-tasks-state.txt"
POLL_SEC=60
MODE="snapshot"   # snapshot | watch | quiet | github
VERBOSE=true

# ─── 解析命令行参数 ───────────────────────
for arg in "$@"; do
  case "$arg" in
    --watch)   MODE="watch" ;;
    --quiet)   MODE="quiet"; VERBOSE=false ;;
    --github)  MODE="github"; VERBOSE=false ;;
    *)         echo "未知参数: $arg"; exit 1 ;;
  esac
done

# ─── 刷新仓库 ────────────────────────────
refresh_repo() {
  cd "$REPO_DIR"
  git pull origin main --quiet 2>/dev/null || true
}

# ─── 解析 TASK_BOARD.md ─────────────────
parse_board() {
  local board="$REPO_DIR/TASK_BOARD.md"
  [ -f "$board" ] || return

  # 按负责人分组统计 📋 和 🔄 和 🚫
  local owner="" task_id="" status=""
  declare -A PENDING IN_PROGRESS BLOCKED

  while IFS= read -r line; do
    # 匹配表格行：| A-01 | 或 | R-01 | 等（严格要求 ID 后有空格+管道符）
    if [[ "$line" =~ ^\|[[:space:]]+[ARDTBQLM]-[0-9]+[[:space:]]+\| ]]; then
      IFS='|' read -r _col0 task_id task_name owner_raw status_raw _rest <<< "$line"
      task_id=$(echo "$task_id" | xargs)
      owner=$(echo "$owner_raw" | xargs)
      status=$(echo "$status_raw" | xargs)

      case "$status" in
        "📋") PENDING["$owner"]="${PENDING[$owner]:-} $task_id" ;;
        "🔄") IN_PROGRESS["$owner"]="${IN_PROGRESS[$owner]:-} $task_id" ;;
        "🚫") BLOCKED["$owner"]="${BLOCKED[$owner]:-} $task_id" ;;
      esac
    fi
  done < "$board"

  # 统计总数
  local pending_total=0 progress_total=0 blocked_total=0
  for owner in "${!PENDING[@]}"; do
    pending_total=$((pending_total + $(echo "${PENDING[$owner]}" | wc -w)))
  done
  for owner in "${!IN_PROGRESS[@]}"; do
    progress_total=$((progress_total + $(echo "${IN_PROGRESS[$owner]}" | wc -w)))
  done
  for owner in "${!BLOCKED[@]}"; do
    blocked_total=$((blocked_total + $(echo "${BLOCKED[$owner]}" | wc -w)))
  done

  # 输出
  local ts
  ts=$(date '+%Y-%m-%d %H:%M:%S')

  $VERBOSE && echo "===== TASK_BOARD @ $ts ====="

  # ── 当前活跃项（从 RELAY 流水线提取 🔴📋 标记）──
  local relay_file="$REPO_DIR/RELAY.md"
  local baton_info=""
  if [ -f "$relay_file" ]; then
    # 从流水线提取 [角色] + 🔴/📋 片段，去 ASCII 画线，取前三
    baton_info=$(grep -oP '\[[A-Z]+\][^\[\n]{0,60}[🔴📋][^\n]{0,30}' "$relay_file" 2>/dev/null | \
      sed 's/[│├─┐┘└]//g; s/  */ /g; s/^ *//; s/ *$//' | head -3 | paste -sd ' ; ' - || echo "?")
    [ -z "$baton_info" ] && baton_info="(暂无活跃接力项)"
  fi
  $VERBOSE && echo "🔴 活跃接力：${baton_info}"

  # ── 待认领 ──
  if [ "$pending_total" -gt 0 ]; then
    $VERBOSE && echo "📋 待认领 ($pending_total 项)："
    for owner in "${!PENDING[@]}"; do
      local ids="${PENDING[$owner]}"
      local count=$(echo "$ids" | wc -w)
      $VERBOSE && echo "   $owner: $(echo $ids | tr ' ' ',') ($count 项)"
    done
  else
    $VERBOSE && echo "📋 待认领：无 (🎉)"
  fi

  # ── 进行中 ──
  if [ "$progress_total" -gt 0 ]; then
    $VERBOSE && echo "🔄 进行中 ($progress_total 项)："
    for owner in "${!IN_PROGRESS[@]}"; do
      local ids="${IN_PROGRESS[$owner]}"
      $VERBOSE && echo "   $owner: $(echo $ids | tr ' ' ',')"
    done
  fi

  # ── 阻塞 ──
  if [ "$blocked_total" -gt 0 ]; then
    $VERBOSE && echo "🚫 阻塞中 ($blocked_total 项)："
    for owner in "${!BLOCKED[@]}"; do
      local ids="${BLOCKED[$owner]}"
      $VERBOSE && echo "   $owner: $(echo $ids | tr ' ' ',')"
    done
  fi

  $VERBOSE && echo "============================="

  # ── JSON 摘要（最后一行，给 Monitor / CI 解析）──
  local json_pending="{}" json_progress="{}" json_blocked="{}"
  local sep=""
  json_pending="{"
  sep=""
  for owner in "${!PENDING[@]}"; do
    json_pending+="$sep\"$owner\":$(echo "${PENDING[$owner]}" | wc -w | xargs)"
    sep=","
  done
  json_pending+="}"

  json_progress="{"
  sep=""
  for owner in "${!IN_PROGRESS[@]}"; do
    json_progress+="$sep\"$owner\":$(echo "${IN_PROGRESS[$owner]}" | wc -w | xargs)"
    sep=","
  done
  json_progress+="}"

  echo "{\"ts\":\"$ts\",\"active\":\"${baton_info}\",\"pending\":$json_pending,\"in_progress\":$json_progress,\"pending_total\":$pending_total,\"progress_total\":$progress_total,\"blocked_total\":$blocked_total}"
}

# ─── 模式：GitHub Actions ────────────────
if [ "$MODE" == "github" ]; then
  refresh_repo
  SUMMARY=$(parse_board 2>/dev/null || true)
  # 取 JSON 行
  JSON_LINE=$(echo "$SUMMARY" | tail -1)
  PENDING_TOTAL=$(echo "$JSON_LINE" | python3 -c "import sys,json; print(json.load(sys.stdin)['pending_total'])" 2>/dev/null || echo "0")
  BATON=$(echo "$JSON_LINE" | python3 -c "import sys,json; print(json.load(sys.stdin)['active'])" 2>/dev/null || echo "?")

  echo "## 📊 任务看板状态"
  echo "| 指标 | 值 |"
  echo "|------|----|"
  echo "| 活跃接力项 | $BATON |"
  echo "| 待认领任务 | $PENDING_TOTAL 项 |"

  if [ "$PENDING_TOTAL" -gt 0 ]; then
    echo ""
    echo "### ⚠️ 待认领任务明细"
    echo ""
    echo "$SUMMARY" | grep "^   " || true
  fi

  if [ "$PENDING_TOTAL" -eq 0 ]; then
    echo ""
    echo "✅ 所有任务已完成或进行中，无待认领项。"
  fi

  exit 0
fi

# ─── 模式：snapshot（一次性） ─────────────
if [ "$MODE" == "snapshot" ]; then
  refresh_repo
  parse_board
  exit 0
fi

# ─── 模式：watch / quiet ──────────────────
echo "[pending-tasks] 启动轮询，间隔 ${POLL_SEC}s，模式=$MODE ..."
LAST_HASH=""
while true; do
  refresh_repo
  CURRENT=$(parse_board | tail -1)   # 只取 JSON 行做 diff
  CURRENT_HASH=$(echo "$CURRENT" | md5sum | cut -d' ' -f1)

  if [ "$CURRENT_HASH" != "$LAST_HASH" ]; then
    if [ -n "$LAST_HASH" ]; then
      $VERBOSE && echo ""
      $VERBOSE && echo ">>> 状态变化！<<<"
      parse_board 2>/dev/null || true
    else
      parse_board 2>/dev/null || true
    fi
    echo "$CURRENT" > "$STATE_FILE"
    LAST_HASH="$CURRENT_HASH"
  fi

  sleep "$POLL_SEC"
done
