#!/usr/bin/env bash
# =============================================================================
# gen-intel-deploy.sh — AI 情报官云函数「自包含化」生成脚本
# -----------------------------------------------------------------------------
# 背景：intel 云函数源码在 backend/，依赖 backend/common/ 与 backend/seedSources.js
#       （require('../common/*')）。微信云开发部署要求函数目录自包含，因此本脚本
#       生成 cloudfunctions/ 下的可部署副本（依赖复制进副本、require 改写为相对路径）。
#
# 用法：
#   bash tools/gen-intel-deploy.sh            # 生成全部 5 个函数副本
#   bash tools/gen-intel-deploy.sh intelProcess  # 只生成指定函数
#
# 生成后：在微信开发者工具「云开发控制台」→ 云函数 → 上传部署 cloudfunctions/ 下
#         对应目录即可（或右键目录 → 上传并部署：云端安装依赖）。
# 注意：backend/ 是源码唯一真相源，改动后端后需重跑本脚本再部署。
# =============================================================================

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/cloudfunctions"

# 每个函数的依赖映射：副本相对路径 <- 源文件
# 语法：函数名|源文件:副本路径 源文件:副本路径 ...
# 注意：源为目录时（如 backend/common/channels）自动递归复制。
declare -a SPECS=(
  "intelFetch|backend/intelFetch/index.js:index.js|backend/intelFetch/config.json:config.json"
  "intelGetList|backend/intelGetList/index.js:index.js|backend/intelGetList/config.json:config.json"
  "intelGetDetail|backend/intelGetDetail/index.js:index.js|backend/intelGetDetail/config.json:config.json"
  "intelRssPoll|backend/intelRssPoll/index.js:index.js|backend/intelRssPoll/config.json:config.json|backend/common/ensureSchema.js:common/ensureSchema.js|backend/common/contentFetcher.js:common/contentFetcher.js|backend/seedSources.js:seedSources.js"
  "intelProcess|backend/intelProcess/index.js:index.js|backend/intelProcess/config.json:config.json|backend/common/ensureSchema.js:common/ensureSchema.js|backend/common/intelLLM.js:common/intelLLM.js|backend/common/intelRouter.js:common/intelRouter.js|backend/common/intelClean.js:common/intelClean.js"
  "intelBrief|backend/intelBrief/index.js:index.js|backend/intelBrief/config.json:config.json|backend/common/ensureSchema.js:common/ensureSchema.js|backend/common/channels:common/channels"
  "intelDispatcher|backend/intelDispatcher/index.js:index.js|backend/intelDispatcher/config.json:config.json|backend/common/ensureSchema.js:common/ensureSchema.js|backend/common/intelRouter.js:common/intelRouter.js"
)

# 各函数 package.json 依赖（npm 包）
declare -A DEPS=(
  [intelFetch]="wx-server-sdk"
  [intelGetList]="wx-server-sdk"
  [intelGetDetail]="wx-server-sdk"
  [intelRssPoll]="fast-xml-parser iconv-lite wx-server-sdk"
  [intelProcess]="wx-server-sdk"
  [intelBrief]="wx-server-sdk"
  [intelDispatcher]="wx-server-sdk"
)

gen_one() {
  local name="$1" spec deps
  spec=$(printf '%s\n' "${SPECS[@]}" | grep "^$name|" || true)
  [ -z "$spec" ] && { echo "❌ 未知函数: $name"; return 1; }
  deps="${DEPS[$name]}"
  local dir="$OUT/$name"
  rm -rf "$dir" && mkdir -p "$dir/common"
  # 复制文件/目录（源:副本；目录自动递归）
  local i
  IFS='|' read -ra parts <<< "$spec"
  for (( i=1; i<${#parts[@]}; i++ )); do
    local pair="${parts[$i]}" src rel
    src="${pair%%:*}" rel="${pair#*:}"
    if [ -d "$ROOT/$src" ]; then
      mkdir -p "$dir/$(dirname "$rel")"
      cp -r "$ROOT/$src" "$dir/$rel"
    else
      mkdir -p "$dir/$(dirname "$rel")"
      cp "$ROOT/$src" "$dir/$rel"
    fi
  done
  # require 路径改写：../common/ → ./common/，../seedSources → ./seedSources
  sed -i "s#require('\.\./common/#require('./common/#g; s#require(\"\.\./common/#require(\"./common/#g" "$dir/index.js"
  sed -i "s#require('\.\./seedSources')#require('./seedSources')#g" "$dir/index.js"
  # package.json（用 python 生成，避免 heredoc 转义问题）
  python3 - "$dir" "$name" "$deps" << 'PYEOF'
import json, os, sys
dirp, name, deps = sys.argv[1], sys.argv[2], sys.argv[3]
deps_list = [d.strip() for d in deps.split() if d.strip()]
pkg = {
    "name": name,
    "version": "1.0.0",
    "description": f"AI 情报官 · {name}（自包含部署副本，由 tools/gen-intel-deploy.sh 生成，勿手改；源码见 backend/）",
    "main": "index.js",
    "dependencies": {p: "latest" for p in deps_list},
}
with open(os.path.join(dirp, "package.json"), "w") as f:
    json.dump(pkg, f, indent=2, ensure_ascii=False)
    f.write("\n")
PYEOF
  echo "✅ $name → $dir（自包含）"
}

if [ $# -gt 0 ]; then
  gen_one "$1"
else
  for spec in "${SPECS[@]}"; do
    gen_one "${spec%%|*}"
  done
fi

echo ""
echo "== 完成。生成的文件："
ls "$OUT"/intelFetch "$OUT"/intelGetList "$OUT"/intelGetDetail "$OUT"/intelRssPoll "$OUT"/intelProcess 2>/dev/null | head -40
echo ""
echo "== 部署：开发者工具云开发控制台 → 云函数 → 上传部署对应目录（云端安装依赖）"
