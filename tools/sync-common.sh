#!/usr/bin/env bash
#
# 同步公共层共享模块到各云函数 utils/ 副本
#
# 背景：CloudBase 云函数以单函数目录为根打包，不含兄弟目录（common/）。
#       故公共共享模块必须在每个用到它的函数目录内有一份【平铺副本】，
#       部署时函数才自包含（不会 Cannot find module；详见 scripts/deploy-cloudfunctions.sh v4.1）。
#
# 本脚本实现「权威真相源 = common/ ，各处副本为生成物」：
#   - 只修改 common/ 下的权威文件；
#   - 跑本脚本把权威文件复制到各目标函数 utils/ 目录；
#   - 目标函数仍用 require('./utils/xxx') 引用本函数自带的副本，部署形态不变。
#
# 用法：
#   bash tools/sync-common.sh                  # 预览（diff 出哪些副本与权威源不一致）
#   bash tools/sync-common.sh --apply          # 实际同步（不一致的副本被覆盖）
#   bash tools/sync-common.sh --apply --force  # 全部覆盖（忽略 diff，重写所有副本）
#
# 新增一个公共共享文件：
#   1) 在 common/ 下放权威文件 xx.js；
#   2) 在下方 COMMON_FILES 加入 "xx.js:/path/to/funcA:/path/to/funcB" 映射；
#   3) 已 copy 过去替换写死副本的 require 为 require('./utils/xx')。
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT/common"
APPLY=false
FORCE=false
for a in "$@"; do
  case "$a" in
    --apply) APPLY=true ;;
    --force) FORCE=true ;;
    *) echo "未知参数: $a（支持 --apply / --force）"; exit 2 ;;
  esac
done

# 共享文件映射：  <authority 文件名>:<目标函数目录(相对 cloudfunctions/)>:<目标 utils 子路径>
# 追加新共享文件时在此登记。
COMMON_FILES=(
  "sensitiveWords.js:newsPipeline"
  "sensitiveWords.js:feedback-create"
)

changed=0
for entry in "${COMMON_FILES[@]}"; do
  fname="${entry%%:*}"
  rest="${entry#*:}"
  func="${rest%%:*}"
  src="$SRC_DIR/$fname"
  dst_dir="$ROOT/cloudfunctions/$func/utils"
  dst="$dst_dir/$fname"

  [ -f "$src" ] || { echo "!! 权威源缺失: $src (跳过)"; continue; }
  if [ ! -d "$ROOT/cloudfunctions/$func" ]; then
    echo "!! 目标函数不存在: $func (跳过)"; continue
  fi
  mkdir -p "$dst_dir"

  if [ "$FORCE" = true ] || [ "$APPLY" = true ]; then
    cp "$src" "$dst"
    echo "  [OK] 同步  $func utils $fname"
  else
    if [ -f "$dst" ] && diff -q "$src" "$dst" >/dev/null 2>&1; then
      echo "  [=] 一致    $func utils $fname"
    else
      echo "  [X] 漂移    $func utils $fname : 权威源 common/$fname 与副本不一致"
      changed=$((changed+1))
    fi
  fi
done

if [ "$APPLY" = false ] && [ "$FORCE" = false ]; then
  echo ""
  if [ "$changed" -eq 0 ]; then
    echo "全部一致，无需同步。"
  else
    echo "发现 $changed 处漂移。执行：bash tools/sync-common.sh --apply 同步；--force 全量覆盖。"
  fi
  echo "提示：改词流程 = 改 common/<file> 一处 → bash tools/sync-common.sh --apply → 重新部署受影响云函数。"
else
  echo "完成。改词后记得重新部署受影响云函数。"
fi
