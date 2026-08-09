#!/usr/bin/env bash
# new-session.sh — 开新会话窗口的注册工具
# 用法：tools/session-log.sh <role> [purpose]
# role: PM|PD|FS|FE|PJM
# 自动生成 22 字符 sid (YYYYMMDD-12位 Crockford base32)
# 注册到 ~/.workbuddy/whiteboard/registry.json
# 创建本会话私有空间 ~/.workbuddy/sessions/<sid>/

set -euo pipefail

ROLE="${1:-}"
PURPOSE="${2:-未填写}"
WORKSPACE="$(pwd)"
TODAY="$(date +%Y%m%d)"
NOW_ISO="$(date +%Y-%m-%dT%H:%M:%S+08:00)"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [[ -z "$ROLE" ]]; then
  echo -e "${RED}❌ 用法: tools/session-log.sh <PM|PD|FS|FE|PJM> [purpose]${NC}"
  exit 1
fi

# Crockford base32 字符集 (去 i/l/o/u 避免歧义)
C32="0123456789ABCDEFGHJKMNPQRSTVWXYZ"

# 生成 12 位短码（用 /dev/urandom 取随机字节映射到 C32）
gen_short() {
  local code=""
  for i in {1..12}; do
    local r=$((RANDOM % 32))
    code+="${C32:$r:1}"
  done
  echo "$code"
}

# 检查 sid 唯一性（workbuddy 级）
check_unique() {
  local sid="$1"
  local reg="$HOME/.workbuddy/whiteboard/registry.json"
  if [[ -f "$reg" ]]; then
    if grep -q "\"sid\": \"$sid\"" "$reg"; then
      return 1
    fi
  fi
  return 0
}

# 生成 sid（重试最多 5 次）
SID=""
for attempt in {1..5}; do
  CANDIDATE="${TODAY}-$(gen_short)"
  if check_unique "$CANDIDATE"; then
    SID="$CANDIDATE"
    break
  fi
  echo -e "${YELLOW}⚠️ 碰撞: $CANDIDATE, 重试 ($attempt/5)${NC}"
done

if [[ -z "$SID" ]]; then
  echo -e "${RED}❌ 5 次重试仍碰撞,请手动指定 sid${NC}"
  exit 2
fi

echo -e "${GREEN}✅ 生成 sid: $SID${NC}"
echo "  角色: $ROLE"
echo "  用途: $PURPOSE"
echo "  workspace: $WORKSPACE"

# 创建私有空间
SESSION_DIR="$HOME/.workbuddy/sessions/$SID"
mkdir -p "$SESSION_DIR/scratch"
echo "  私有空间: $SESSION_DIR"

# 写 context.md 模板
cat > "$SESSION_DIR/context.md" <<EOF
# Session Context · $SID

> **本文件 = 本会话私有上下文**，只本窗口读，**不进共享白板**。
> 跨窗口交接请写到 \`~/.workbuddy/whiteboard/commlog/YYYY-MM-DD.md\`。

## 身份

- **sid**：\`$SID\`
- **角色**：$ROLE
- **workspace**：\`$WORKSPACE\`
- **opened_at**：$NOW_ISO
- **owner**：michaelzhao

## 本会话主任务

1. （待填：本会话要解决的核心问题）
2. （待填：拆解的子任务）

## 当前在做什么

- [ ] （待填：todo list）

## 不要做的事

- ❌ 写"我/本会话"等第一称谓到共享白板
- ❌ 改本角色禁区的文件
- ❌ 直连 github.com（走 SSH）

## 相关链接

- 用户级 MEMORY：\`/Users/michaelzhao/.workbuddy/MEMORY.md\`
- 项目级 MEMORY：\`{workspace}/.workbuddy/memory/MEMORY.md\`
- 全局 registry：\`/Users/michaelzhao/.workbuddy/whiteboard/registry.json\`
EOF

# 写 decisions.md 模板
cat > "$SESSION_DIR/decisions.md" <<EOF
# Decision Log · $SID

> **本会话的决策链**，只本窗口读，**不升白板**（除非需要跨窗口同步）。

---

## $NOW_ISO — 本会话身份

- sid = \`$SID\`
- 角色 = $ROLE
- 拍板: owner 当面指定
EOF

# 注册到全局 registry（用 python 操作 JSON 避免转义问题）
REGISTRY="$HOME/.workbuddy/whiteboard/registry.json"
python3 <<PY
import json, os
reg_path = "$REGISTRY"
if os.path.exists(reg_path):
    with open(reg_path) as f:
        reg = json.load(f)
else:
    reg = {"version": "1.0.0", "sessions": []}

new_entry = {
    "sid": "$SID",
    "role": "$ROLE",
    "workspace": "$WORKSPACE",
    "opened_at": "$NOW_ISO",
    "last_seen": "$NOW_ISO",
    "status": "active",
    "owner": "michaelzhao",
    "purpose": "$PURPOSE",
    "context_path": "$SESSION_DIR/context.md",
    "scratch_path": "$SESSION_DIR/scratch/"
}

reg.setdefault("sessions", []).append(new_entry)
reg["updated_at"] = "$NOW_ISO"

with open(reg_path, "w") as f:
    json.dump(reg, f, ensure_ascii=False, indent=2)
print(f"✅ 已注册到 {reg_path}")
PY

echo ""
echo -e "${GREEN}🎉 会话窗口就绪${NC}"
echo "  你的 sid: $SID"
echo "  下次新窗口前: tools/session-log.sh <role>"
echo "  关闭时: 手动把 registry.json 里 status 改为 'closed'"
