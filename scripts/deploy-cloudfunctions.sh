#!/usr/bin/env bash
#
# 部署云函数（v4.1 起：每个函数自包含，无需共享 common 打包）
#
# 背景：早期用 monorepo 风格，index.js 以 `../common/xxx` 引用兄弟目录的共享模块，
#       但 CloudBase 部署只打包函数自身目录，common 作为兄弟目录不会被包含，
#       导致运行时 `Cannot find module '../common/xxx'` 崩溃。
#       现（v4.1）已将共享模块「平铺」到每个函数根目录（require('./xxx')），
#       函数完全自包含 —— 可直接用微信开发者工具「上传并部署」，
#       也可本脚本经 mcporter 批量部署。无需任何预处理/打包步骤。
#
# 注意：修改共享逻辑时，需同步改到各函数根目录下的对应文件
#       （getNewsList/config.js、newsPipeline/zhipuSearch.js 等），它们是各自独立的副本。
#       ⚠️ refreshNews 已于 2026-08-28 退役删除（被 newsFetcher + newsPipeline 替代），不要再引用。
#
# 用法：bash scripts/deploy-cloudfunctions.sh [函数名 ...]
#   不带参数：部署全部（getNewsList getNewsDetail searchNews）
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ROOT/config/mcporter.json"
CLIENT=$(command -v mcporter || echo "npx --yes mcporter")

# 要部署的函数（顺序无所谓）
ALL_FUNCS=(getNewsList getNewsDetail searchNews)   # refreshNews 已退役(2026-08-28)，勿加回
FUNCS=("${@:-${ALL_FUNCS[@]}}")

BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

echo "▶ 构建目录: $BUILD"

for fn in "${FUNCS[@]}"; do
  src="$ROOT/cloudfunctions/$fn"
  [ -d "$src" ] || { echo "跳过（不存在）: $fn"; continue; }

  pkg="$BUILD/$fn"
  mkdir -p "$pkg"

  # 复制整个函数目录（含平铺的共享模块：cache.js / config.js / zhipuSearch.js ...）
  # 早期版本只拷贝 index.js + package.json 并单独打包 common，现无需此步骤。
  cp -r "$src"/. "$pkg"/

  echo "▶ 部署 $fn ..."
  # updateFunctionCode 仅更新代码，保留已有的环境变量与定时触发器
  $CLIENT --config "$CONFIG" call cloudbase manageFunctions \
    action=updateFunctionCode functionRootPath="$pkg" functionName="$fn"
  echo "  ✅ $fn 部署完成"
done

echo ""
echo "全部指定函数部署完成。"
