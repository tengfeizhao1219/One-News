#!/bin/bash
# ============================================================================
# check_intel.sh —— AI 协作门禁检查（push/部署前必跑）
# 目的：技术强制约束所有 AI（无论用什么客户端）——
#  1) 关键逻辑存在性：清理/翻译等"缺失不报错"的静默逻辑，防止被并行覆盖（2026-08-21 事件）
#  2) 冲突标记扫描：防止误推 <<<<<<<（2026-08-20 WorkBuddy 误推事件）
#  3) 语法检查：intel 云函数 node --check
#  4) WIP 警告：有未提交改动时提示（不拦截，多 AI 并行允许 WIP）
#
# 用法：
#   bash scripts/check_intel.sh [cloudfunctions|backend|all]
#   默认 all（两个副本都查）
#   退出码 0 = 通过；1 = 有阻断项（push/部署应被拒绝）
#
# 挂载：.git/hooks/pre-push 自动调用（任何 push 触发）
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# node 路径（macOS 常见位置；可在环境变量覆盖）
NODE_BIN="${NODE_BIN:-}"
if [ -z "$NODE_BIN" ]; then
  for cand in /usr/local/bin/node /opt/homebrew/bin/node /usr/bin/node; do
    [ -x "$cand" ] && NODE_BIN="$cand" && break
  done
fi
NODE_BIN="${NODE_BIN:-node}"

# 需要校验关键逻辑存在/禁止的函数/文件（防止静默逻辑被并行覆盖/误引入）
# 格式：文件|needle|描述|mode（require=必须存在 / forbid=禁止出现）
declare -a CRITICAL_CHECKS=(
  # intelProcess：翻译兜底（isMostlyEnglish/translateZh）——必须存在
  "cloudfunctions/intelProcess/index.js|isMostlyEnglish|intelProcess 翻译兜底(isMostlyEnglish)|require"
  "cloudfunctions/intelProcess/index.js|translateZh|intelProcess 翻译兜底(translateZh)|require"
  # 2026-08-21 owner 拍板回退：禁止「清空旧 staged/非本批 ingest」清理逻辑（曾清空数据破坏详情页）
  "cloudfunctions/intelProcess/index.js|清空旧 staged|intelProcess 清空 staged 清理逻辑|forbid"
  "cloudfunctions/intelProcess/index.js|purgeDone|intelProcess 逐批清理(purgeDone)|forbid"
  # intelDispatcher：发布后清旧 brief（purgeOldBriefs）——仅清旧 brief 文档，不影响详情数据，保留
  "cloudfunctions/intelDispatcher/index.js|purgeOldBriefs|intelDispatcher 清旧 brief(purgeOldBriefs)|require"
  # intelRssPoll：按源手动触发能力（sourceId）——必须存在
  "cloudfunctions/intelRssPoll/index.js|event.sourceId|intelRssPoll 单源触发(event.sourceId)|require"
)

FAIL=0
MODE="${1:-all}"

# ── 1) 关键逻辑存在/禁止校验 ─────────────────────────────────────────────
echo "── [1/4] 关键逻辑校验（require=必须存在 / forbid=禁止出现）──"
for entry in "${CRITICAL_CHECKS[@]}"; do
  # 用 sed 按 | 逐字段提取（bash 3.2 对中文 + ${var%%|*} 参数扩展有 unbound 缺陷）
  file=$(printf '%s' "$entry" | sed 's/|.*//')
  rest=$(printf '%s' "$entry" | sed 's/^[^|]*|//')
  needle=$(printf '%s' "$rest" | sed 's/|.*//')
  rest2=$(printf '%s' "$rest" | sed 's/^[^|]*|//')
  desc=$(printf '%s' "$rest2" | sed 's/|.*//')
  mode=$(printf '%s' "$rest2" | sed 's/^[^|]*|//')
  mode="${mode:-require}"
  # MODE 过滤：only backend / only cloudfunctions
  case "$MODE" in
    cloudfunctions) [[ "$file" == cloudfunctions/* ]] || continue ;;
    backend)        [[ "$file" == backend/* ]] || continue ;;
  esac
  # 校验 backend 副本（若存在）
  bfile=$(printf '%s' "$file" | sed 's|^cloudfunctions/|backend/|')
  for target in "$file" "$bfile"; do
    if [ -f "$target" ]; then
      if [ "$mode" = "forbid" ]; then
        if grep -q "$needle" "$target"; then
          echo "  ❌ $target 含「${desc:-}」——已回退/禁止，请移除后再 push！"
          FAIL=1
        else
          echo "  ✅ $target 无「${desc:-}」（符合回退要求）"
        fi
      else
        if grep -q "$needle" "$target"; then
          echo "  ✅ $target 含「${desc:-}」"
        else
          echo "  ❌ $target 缺失「${desc:-}」——可能被并行覆盖，禁止 push/部署！"
          FAIL=1
        fi
      fi
    fi
  done
done

# ── 2) 冲突标记扫描 ───────────────────────────────────────────────────
echo "── [2/4] 冲突标记扫描 ──"
DIRS=("cloudfunctions" "backend" "pages" "components" "utils" "common" "intel-docs")
FOUND_CONFLICT=0
for d in "${DIRS[@]}"; do
  [ -d "$d" ] || continue
  hits=$(grep -rln '^<<<<<<<\|^>>>>>>>\|^=======$' "$d" --include="*.js" --include="*.wxml" --include="*.wxss" --include="*.json" --include="*.md" 2>/dev/null | grep -v "/node_modules/" | head -10)
  if [ -n "$hits" ]; then
    echo "  ❌ 冲突标记残留："
    echo "$hits" | sed 's/^/     /'
    FAIL=1
    FOUND_CONFLICT=1
  fi
done
[ "$FOUND_CONFLICT" = "0" ] && echo "  ✅ 无冲突标记"

# ── 3) 语法检查（intel 云函数）───────────────────────────────────────
echo "── [3/4] 语法检查 ──"
for f in cloudfunctions/intelProcess/index.js cloudfunctions/intelDispatcher/index.js \
         cloudfunctions/intelFetch/index.js cloudfunctions/intelRssPoll/index.js \
         cloudfunctions/intelGetDetail/index.js; do
  if [ -f "$f" ]; then
    if "$NODE_BIN" --check "$f" >/dev/null 2>&1; then
      echo "  ✅ $(basename "$(dirname "$f")")"
    else
      echo "  ❌ 语法错误：$f"
      FAIL=1
    fi
  fi
done

# ── 4) WIP 警告（不拦截）────────────────────────────────────────────
echo "── [4/4] WIP 检查 ──"
if [ -n "$(git status --porcelain 2>/dev/null | head -5)" ]; then
  echo "  ⚠️ 有未提交改动（WIP）——push 前请确认是否应提交："
  git status --porcelain 2>/dev/null | head -5 | sed 's/^/     /'
else
  echo "  ✅ 工作区干净"
fi

# ── 汇总 ─────────────────────────────────────────────────────────────
echo ""
if [ "$FAIL" = "1" ]; then
  echo "❌ 检查未通过——禁止 push/部署（见上方阻断项）"
  exit 1
else
  echo "✅ 检查通过，可 push/部署"
  exit 0
fi
