#!/usr/bin/env bash
# Owner 简报预演：用仓库内 fixture 渲染一次
# 目的：FS 实施前/owner 验收前能立刻看到效果，无需等真源接好
# 数据源: test/fixtures/owner-brief/COMMLOG.md + TASK_BOARD.md
# 真源: owner 本地归档 ~/documents/其他/个人/One-News-archive/

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GEN_SCRIPT="$REPO_ROOT/scripts/gen-owner-brief.mjs"
FIXTURE_DIR="$SCRIPT_DIR/fixtures/owner-brief"

if [ ! -f "$GEN_SCRIPT" ]; then
  echo "❌ 找不到生成器: $GEN_SCRIPT"
  exit 1
fi

if [ ! -f "$FIXTURE_DIR/COMMLOG.md" ] || [ ! -f "$FIXTURE_DIR/TASK_BOARD.md" ]; then
  echo "❌ 找不到 fixture,请检查: $FIXTURE_DIR"
  exit 1
fi

OUT="$(mktemp -d)/owner-brief.md"

# 用 fixture 运行生成器
COMMLOG_PATH="$FIXTURE_DIR/COMMLOG.md" \
TASK_BOARD_PATH="$FIXTURE_DIR/TASK_BOARD.md" \
node "$GEN_SCRIPT" \
  --output="$OUT" \
  --since=24h

echo ""
echo "=== 渲染结果(前 80 行)==="
head -80 "$OUT"

# 清理
rm -rf "$(dirname "$OUT")"
