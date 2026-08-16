#!/usr/bin/env bash
#
# 同步公共层共享模块到各云函数副本
#
# 背景：CloudBase 云函数以单函数目录为根打包，不含兄弟目录（common/）。
#       故公共共享模块必须在每个用到它的函数目录内有一份【平铺副本】，
#       部署时函数才自包含（不会 Cannot find module；详见 scripts/deploy-cloudfunctions.sh v4.1）。
#
# 本脚本实现「权威真相源 = common/ ，各处副本为生成物」：
#   - 只修改 common/ 下的权威文件；
#   - 跑本脚本把权威文件复制到各目标函数目录；
#   - 目标函数仍用 require 引用本函数自带的副本，部署形态不变。
#
# 用法：
#   bash tools/sync-common.sh                  # 预览（diff 出哪些副本与权威源不一致）
#   bash tools/sync-common.sh --apply          # 实际同步（不一致的副本被覆盖）
#   bash tools/sync-common.sh --apply --force  # 全部覆盖（忽略 diff，重写所有副本）
#
# 新增一个公共共享文件：
#   1) 在 common/ 下放权威文件 xx.js；
#   2) 在下方 COMMON_FILES 加入 "xx.js:<func>:<相对目录>" 映射
#      （<相对目录> 相对 cloudfunctions/<func>/，默认 utils，根目录用 "."，sources 目录用 "sources"）；
#   3) 已 copy 过去替换写死副本的 require 为 require 本函数自带的副本。
#
# Phase B（2026-08-16）扩展：登记全部重复家族（newsCleaner/interpretLens/contentFetcher/
#   qualityScorer/filter/apiFetch/feedStore/notify/rssParser/seedFeeds/securityCheck/
#   validator/fingerprint/juhe/tianxing/seedFeeds.json/sensitiveWords）。
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

# 共享文件映射：  <authority 文件名>:<目标函数目录(相对 cloudfunctions/)>:<目标相对目录>
# 追加新共享文件时在此登记。
COMMON_FILES=(
  # ── utils/ 落点 ──
  "sensitiveWords.js:newsPipeline:utils"
  "sensitiveWords.js:feedback-create:utils"
  "newsCleaner.js:newsPipeline:utils"
  "newsCleaner.js:newsFetcher:utils"
  "newsCleaner.js:getNewsList:utils"
  "newsCleaner.js:getNewsDetail:utils"
  "interpretLens.js:newsPipeline:utils"
  "interpretLens.js:newsFetcher:utils"
  "contentFetcher.js:newsPipeline:utils"
  "qualityScorer.js:newsPipeline:utils"
  "filter.js:newsFetcher:utils"
  "filter.js:rssFetcher:utils"
  "apiFetch.js:newsFetcher:utils"
  "apiFetch.js:rssFetcher:utils"
  "feedStore.js:newsFetcher:utils"
  "feedStore.js:rssFetcher:utils"
  "notify.js:newsFetcher:utils"
  "notify.js:rssFetcher:utils"
  "rssParser.js:newsFetcher:utils"
  "rssParser.js:rssFetcher:utils"
  "seedFeeds.js:newsFetcher:utils"
  "seedFeeds.js:rssFetcher:utils"
  "fingerprint.js:newsFetcher:utils"
  "fingerprint.js:rssFetcher:utils"
  # ── 根目录落点 ──
  "securityCheck.js:newsPipeline:."
  "validator.js:newsPipeline:."
  # ── sources/ 落点 ──
  "juhe.js:newsFetcher:sources"
  "juhe.js:refreshNews:sources"
  "tianxing.js:newsFetcher:sources"
  "tianxing.js:refreshNews:sources"
  # ── 数据文件 ──
  "seedFeeds.json:newsFetcher:."
  "seedFeeds.json:rssFetcher:."
)

changed=0
for entry in "${COMMON_FILES[@]}"; do
  fname="${entry%%:*}"
  rest="${entry#*:}"
  func="${rest%%:*}"
  subdir="${rest#*:}"
  [ -z "$subdir" ] && subdir="utils"
  src="$SRC_DIR/$fname"
  if [ "$subdir" = "." ]; then
    dst_dir="$ROOT/cloudfunctions/$func"
  else
    dst_dir="$ROOT/cloudfunctions/$func/$subdir"
  fi
  dst="$dst_dir/$fname"

  [ -f "$src" ] || { echo "!! 权威源缺失: $src (跳过)"; continue; }
  if [ ! -d "$ROOT/cloudfunctions/$func" ]; then
    echo "!! 目标函数不存在: $func (跳过)"; continue
  fi
  mkdir -p "$dst_dir"

  if [ "$FORCE" = true ] || [ "$APPLY" = true ]; then
    cp "$src" "$dst"
    echo "  [OK] 同步  $func/$subdir $fname"
  else
    if [ -f "$dst" ] && diff -q "$src" "$dst" >/dev/null 2>&1; then
      echo "  [=] 一致    $func/$subdir $fname"
    else
      echo "  [X] 漂移    $func/$subdir $fname : 权威源 common/$fname 与副本不一致"
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
  echo "提示：改公共文件流程 = 改 common/<file> 一处 → bash tools/sync-common.sh --apply → 重新部署受影响云函数。"
else
  echo "完成。改公共文件后记得重新部署受影响云函数。"
fi
