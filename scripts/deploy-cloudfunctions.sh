#!/usr/bin/env bash
#
# 部署云函数（自动打包 common 共享模块）
#
# 背景：云函数 index.js 以 `../common/xxx` 引用共享模块（monorepo 风格），
#       但 CloudBase 部署时只会把函数自身目录打进包，common 作为"兄弟目录"
#       不会被包含，导致运行时 `Cannot find module '../common/cache'` 崩溃。
#       本脚本在部署前把 common 复制进每个函数目录，并把入口的 `../common/`
#       改写为 `./common/`，使每个函数自包含、可直接部署。
#
# 用法：bash scripts/deploy-cloudfunctions.sh [函数名 ...]
#   不带参数：部署全部（getNewsList getNewsDetail refreshNews searchNews）
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ROOT/config/mcporter.json"
CLIENT=$(command -v mcporter || echo "npx --yes mcporter")

# 要部署的函数（顺序无所谓）
ALL_FUNCS=(getNewsList getNewsDetail refreshNews searchNews)
FUNCS=("${@:-${ALL_FUNCS[@]}}")

BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

echo "▶ 构建目录: $BUILD"

for fn in "${FUNCS[@]}"; do
  src="$ROOT/cloudfunctions/$fn"
  [ -d "$src" ] || { echo "跳过（不存在）: $fn"; continue; }

  pkg="$BUILD/$fn"
  mkdir -p "$pkg"

  # 复制函数自身文件（index.js / package.json）
  cp "$src/index.js" "$pkg/" 2>/dev/null || true
  cp "$src/package.json" "$pkg/" 2>/dev/null || true

  # 仅当函数引用了 ../common 时，才复制并改写（getNewsDetail 无依赖，跳过）
  if grep -q "\.\./common/" "$src/index.js"; then
    cp -r "$ROOT/cloudfunctions/common" "$pkg/common"
    sed -i 's#\.\./common/#./common/#g' "$pkg/index.js"
    echo "  • $fn: 已打包 common 并改写 require 路径"
  else
    echo "  • $fn: 无 common 依赖，直接部署"
  fi

  echo "▶ 部署 $fn ..."
  # updateFunctionCode 仅更新代码，保留已有的环境变量与定时触发器
  $CLIENT --config "$CONFIG" call cloudbase manageFunctions \
    action=updateFunctionCode functionRootPath="$pkg" functionName="$fn"
  echo "  ✅ $fn 部署完成"
done

echo ""
echo "全部指定函数部署完成。"
