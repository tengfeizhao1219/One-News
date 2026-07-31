#!/usr/bin/env bash
# 任务看板解析 & 接力棒状态速览 & 角色待办过滤 & 广播区提取
# 用法：
#   scripts/pending-tasks.sh                    # 一次性快照（全量）
#   scripts/pending-tasks.sh --role=前端开发     # 只看某个角色的待办
#   scripts/pending-tasks.sh --role=me          # 同上（兼容旧习惯）
#   scripts/pending-tasks.sh --broadcast         # 只看广播区
#   scripts/pending-tasks.sh --watch            # 每 60 秒轮询，有变化时输出 diff
#   scripts/pending-tasks.sh --quiet            # 静默模式，有变化才输出
#   scripts/pending-tasks.sh --github           # GitHub Actions 格式摘要
#
# 输出 JSON 摘要到 stdout 最后一行，方便 Monitor / CI 解析。

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_FILE="/tmp/pending-tasks-state.txt"
POLL_SEC=60
MODE="snapshot"   # snapshot | watch | quiet | github
VERBOSE=true
ROLE_FILTER=""    # 空 = 全量；非空 = 仅此角色

# ─── 解析命令行参数 ───────────────────────
for arg in "$@"; do
  case "$arg" in
    --watch)         MODE="watch" ;;
    --quiet)         MODE="quiet"; VERBOSE=false ;;
    --github)        MODE="github"; VERBOSE=false ;;
    --broadcast)     MODE="broadcast";;
    --role=*)        ROLE_FILTER="${arg#*=}" ;;
    --role)          ;;  # 忽略（后续参数）
    *)               echo "未知参数: $arg"; exit 1 ;;
  esac
done

# ─── 刷新仓库 ────────────────────────────
refresh_repo() {
  cd "$REPO_DIR"
  git pull origin main --quiet 2>/dev/null || true
}

# ─── 提取广播区 ──────────────────────────
extract_broadcast() {
  local board="$REPO_DIR/TASK_BOARD.md"
  [ -f "$board" ] || return

  awk '/^## 📢 广播区/{found=1; next} found && /^---/{exit} found' "$board"
}

# ─── 依赖激活检查 ────────────────────────
# 扫描已完成任务，找到依赖它们的下游任务（状态 ⏳），输出建议
check_dependency_activation() {
  local board="$REPO_DIR/TASK_BOARD.md"
  [ -f "$board" ] || return

  local issues=()

  # B-06 ✅ → B-01/B-04 依赖 B-06
  if grep -qE "^\| B-06 .*\|.*✅" "$board" 2>/dev/null; then
    for dep in B-01 B-04; do
      if grep -qE "^\| ${dep} .*\|.*📋" "$board" 2>/dev/null; then
        issues+=("✅ $dep 依赖 B-06 已满足且状态为 📋，可以认领")
      elif grep -qE "^\| ${dep} .*\|.*⏳" "$board" 2>/dev/null; then
        issues+=("⚠️ $dep 依赖 B-06 已满足但仍为 ⏳，建议激活为 📋")
      fi
    done
  fi

  # B-02/B-03 ✅ + B-05 未完成 → 代码评审待激活
  if grep -qE "^\| B-02 .*\|.*✅" "$board" 2>/dev/null && grep -qE "^\| B-03 .*\|.*✅" "$board" 2>/dev/null; then
    if grep -qE "^\| B-05 .*\|.*⏳" "$board" 2>/dev/null; then
      issues+=("⚠️ B-05 代码评审：B-02/B-03 已 ✅，建议激活 B-05 ⏳→📋")
    fi
  fi

  # 阶段四核心 B-01~B-07 全 ✅ → 阶段五
  local b_done=true
  for id in B-01 B-02 B-03 B-04 B-05 B-06 B-07; do
    if grep -qE "^\| ${id} .*\|.*✅" "$board" 2>/dev/null; then
      :
    else
      b_done=false
      break
    fi
  done
  if $b_done; then
    if grep -q 'Q-01.*⏳' "$board" 2>/dev/null; then
      issues+=("🚨 阶段四 B-01~B-07 全 ✅！应激活阶段五 Q-01~Q-06 ⏳→📋，并通知 PM 关口检查")
    fi
  fi

  if [ ${#issues[@]} -gt 0 ]; then
    echo "🔗 依赖激活检查："
    for issue in "${issues[@]}"; do
      echo "   $issue"
    done
  fi
}

# ─── 解析 TASK_BOARD.md ─────────────────
parse_board() {
  local board="$REPO_DIR/TASK_BOARD.md"
  [ -f "$board" ] || return

  local owner="" task_id="" status="" priority="" task_name=""
  declare -A PENDING IN_PROGRESS BLOCKED PENDING_DETAIL

  while IFS= read -r line; do
    if [[ "$line" =~ ^\|[[:space:]]+[ARDTBQLM]-[0-9]+[[:space:]]+\| ]]; then
      IFS='|' read -r _col0 task_id task_name owner_raw priority_raw status_raw _rest <<< "$line"
      task_id=$(echo "$task_id" | xargs)
      task_name=$(echo "$task_name" | xargs)
      owner=$(echo "$owner_raw" | xargs)
      status=$(echo "$status_raw" | xargs)
      priority=$(echo "$priority_raw" | xargs)

      # 角色过滤
      if [ -n "$ROLE_FILTER" ] && [ "$owner" != "$ROLE_FILTER" ]; then
        continue
      fi

      case "$status" in
        "📋")
          PENDING["$owner"]="${PENDING[$owner]:-} $task_id"
          PENDING_DETAIL["$task_id"]="$priority|$task_name"
          ;;
        "🔄") IN_PROGRESS["$owner"]="${IN_PROGRESS[$owner]:-} $task_id" ;;
        "🚫") BLOCKED["$owner"]="${BLOCKED[$owner]:-} $task_id" ;;
      esac
    fi
  done < "$board"

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

  local ts
  ts=$(date '+%Y-%m-%d %H:%M:%S')

  # ── 角色模式：精简输出 ──
  if [ -n "$ROLE_FILTER" ]; then
    $VERBOSE && echo "===== $ROLE_FILTER 任务速览 @ $ts ====="

    if [ "$pending_total" -gt 0 ]; then
      $VERBOSE && echo "📋 待认领 ($pending_total 项)："
      for owner in "${!PENDING[@]}"; do
        for tid in ${PENDING[$owner]}; do
          local detail="${PENDING_DETAIL[$tid]:-|}"
          local prio=$(echo "$detail" | cut -d'|' -f1)
          local tname=$(echo "$detail" | cut -d'|' -f2)
          $VERBOSE && echo "   [$prio] $tid: $tname"
        done
      done
    else
      $VERBOSE && echo "📋 待认领：无 (🎉)"
    fi

    if [ "$progress_total" -gt 0 ]; then
      $VERBOSE && echo "🔄 进行中 ($progress_total 项)："
      for owner in "${!IN_PROGRESS[@]}"; do
        $VERBOSE && echo "   $owner: $(echo ${IN_PROGRESS[$owner]} | tr ' ' ',')"
      done
    fi

    $VERBOSE && echo "============================="

    echo "{\"ts\":\"$ts\",\"role\":\"$ROLE_FILTER\",\"pending_total\":$pending_total,\"progress_total\":$progress_total}"
    return
  fi

  # ── 全量模式 ──
  $VERBOSE && echo "===== TASK_BOARD @ $ts ====="

  # ── 广播区 ──
  local broadcast_text
  broadcast_text=$(extract_broadcast 2>/dev/null || true)
  if [ -n "$broadcast_text" ]; then
    $VERBOSE && echo "📢 广播区："
    $VERBOSE && echo "$broadcast_text"
    $VERBOSE && echo "---"
  fi

  # ── 依赖激活检查 ──
  check_dependency_activation

  # ── 当前活跃项（从 RELAY 流水线提取）──
  local relay_file="$REPO_DIR/RELAY.md"
  local baton_info=""
  if [ -f "$relay_file" ]; then
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
      $VERBOSE && echo "   $owner: $(echo ${IN_PROGRESS[$owner]} | tr ' ' ',')"
    done
  fi

  # ── 阻塞 ──
  if [ "$blocked_total" -gt 0 ]; then
    $VERBOSE && echo "🚫 阻塞中 ($blocked_total 项)："
    for owner in "${!BLOCKED[@]}"; do
      $VERBOSE && echo "   $owner: $(echo ${BLOCKED[$owner]} | tr ' ' ',')"
    done
  fi

  $VERBOSE && echo "============================="

  # ── JSON 摘要 ──
  local json_pending="{}" json_progress="{}"
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

# ─── 模式：broadcast ─────────────────────
if [ "$MODE" == "broadcast" ]; then
  refresh_repo
  echo "===== 📢 广播区 ====="
  extract_broadcast
  echo ""
  check_dependency_activation
  exit 0
fi

# ─── 模式：GitHub Actions ────────────────
if [ "$MODE" == "github" ]; then
  refresh_repo
  SUMMARY=$(parse_board 2>/dev/null || true)
  JSON_LINE=$(echo "$SUMMARY" | tail -1)
  PENDING_TOTAL=$(echo "$JSON_LINE" | python3 -c "import sys,json; print(json.load(sys.stdin)['pending_total'])" 2>/dev/null || echo "0")
  BATON=$(echo "$JSON_LINE" | python3 -c "import sys,json; print(json.load(sys.stdin)['active'])" 2>/dev/null || echo "?")

  echo "## 📊 任务看板状态"
  echo "| 指标 | 值 |"
  echo "|------|----|"
  echo "| 活跃接力项 | $BATON |"
  echo "| 待认领任务 | $PENDING_TOTAL 项 |"

  # 广播区
  echo ""
  echo "### 📢 广播区"
  extract_broadcast

  # 依赖激活
  echo ""
  echo "### 🔗 依赖激活检查"
  check_dependency_activation

  # 按角色分组待办
  if [ "$PENDING_TOTAL" -gt 0 ]; then
    echo ""
    echo "### ⚠️ 按角色分组待认领"
    echo ""
    echo "$SUMMARY" | grep "^   " || true
  fi

  exit 0
fi

# ─── 模式：snapshot ──────────────────────
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
  CURRENT=$(parse_board | tail -1)
  CURRENT_NOTS=$(echo "$CURRENT" | sed 's/"ts":"[^"]*"//')
  CURRENT_HASH=$(echo "$CURRENT_NOTS" | md5sum | cut -d' ' -f1)

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
