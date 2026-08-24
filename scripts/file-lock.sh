#!/bin/bash
# ============================================================================
# file-lock.sh —— 文件级锁：防止多会话并发编辑同一文件互相覆盖
# ============================================================================
# 背景：多个 AI 会话 + 微信开发者工具共用同一本地工作目录（单副本编辑模式），
#       两个会话同时改同一文件 → 后写者静默覆盖先写者。git 只能事后发现。
# 做法：编辑文件前先 lock（写锁文件），编辑完 unlock；其他会话见锁即知"谁在改"，
#       等待或协商，避免并发覆盖。
#
# 用法：
#   bash scripts/file-lock.sh lock <相对路径> [session]     # 获取锁（TTL 30 分钟防崩溃残留）
#   bash scripts/file-lock.sh unlock <相对路径> [session]   # 释放锁（session 匹配才允许）
#   bash scripts/file-lock.sh force-unlock <相对路径>       # 强制解锁（确认无人在编辑时用）
#   bash scripts/file-lock.sh status                        # 查看所有活动锁
#
# 纪律（写入协作机制）：
#   1) 编辑任何文件前：bash scripts/file-lock.sh lock <file> <session>
#   2) 编辑完成后立即：bash scripts/file-lock.sh unlock <file> <session>
#   3) 锁被占用时：不要硬编辑，先与持有者协商或等其解锁
#   4) 锁文件位于 .git-auto/locks/（已 gitignore，不入库）
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCK_DIR="$ROOT/.git-auto/locks"
TTL_MS=1800000   # 30 分钟：会话崩溃后锁自动过期，防僵死
mkdir -p "$LOCK_DIR"

name_of() { echo "$1" | sed 's|^\./||; s|/|__|g'; }
now_ms()  { echo "$(( $(date +%s) * 1000 ))"; }

# 清理过期锁（幂等）
cleanup_expired() {
  for f in "$LOCK_DIR"/lock_*; do
    [ -f "$f" ] || continue
    local at ttl
    at=$(grep -o '"acquiredAt":[0-9]*' "$f" | cut -d: -f2)
    ttl=$(grep -o '"ttlMs":[0-9]*' "$f" | cut -d: -f2)
    if [ -n "$at" ] && [ -n "$ttl" ] && [ "$(now_ms)" -gt $((at + ttl)) ]; then
      echo "  (自动清理过期锁: $(basename "$f" | sed 's/^lock_//; s/__/\//g'))"
      rm -f "$f"
    fi
  done
}

case "${1:-}" in
  lock)
    file="${2:-}"; session="${3:-$(hostname)-$$}"
    [ -n "$file" ] || { echo "用法: lock <文件相对路径> [session]"; exit 2; }
    cleanup_expired
    lf="$LOCK_DIR/lock_$(name_of "$file")"
    if [ -f "$lf" ]; then
      owner=$(grep -o '"session":"[^"]*"' "$lf" | cut -d'"' -f4)
      at=$(grep -o '"acquiredAt":[0-9]*' "$lf" | cut -d: -f2)
      echo "❌ 文件已被锁定: $file"
      echo "   持有者: ${owner:-未知}"
      echo "   加锁于: ${at:-?} (ms)"
      echo "   请与持有者协商；确认无人在编辑可: bash scripts/file-lock.sh force-unlock $file"
      exit 1
    fi
    printf '{"file":"%s","session":"%s","acquiredAt":%s,"ttlMs":%s}\n' "$file" "$session" "$(now_ms)" "$TTL_MS" > "$lf"
    echo "✅ 已锁定: $file (session=$session, TTL=$((TTL_MS/60000)) 分钟)"
    # 顺带检查：目标文件在工作区是否已有他人未提交改动
    if git -C "$ROOT" status --porcelain -- "$file" 2>/dev/null | grep -q '^ M\|^M \|^??'; then
      echo "⚠️  注意: 该文件在工作区有未提交改动（可能来自其他会话）——先 git diff 确认基线再编辑"
    fi
    ;;
  unlock)
    file="${2:-}"; session="${3:-}"
    [ -n "$file" ] || { echo "用法: unlock <文件相对路径> [session]"; exit 2; }
    lf="$LOCK_DIR/lock_$(name_of "$file")"
    [ -f "$lf" ] || { echo "⚠️  该文件当前无锁（无需解锁）"; exit 0; }
    if [ -n "$session" ]; then
      owner=$(grep -o '"session":"[^"]*"' "$lf" | cut -d'"' -f4)
      if [ "$owner" != "$session" ]; then
        echo "❌ 锁属于 ${owner:-?}（你: $session）——不能解锁；确认无人在编辑可 force-unlock"
        exit 1
      fi
    fi
    rm -f "$lf"
    echo "✅ 已解锁: $file"
    ;;
  status)
    cleanup_expired
    count=0
    for f in "$LOCK_DIR"/lock_*; do
      [ -f "$f" ] || continue
      count=$((count+1))
      echo "  $(basename "$f" | sed 's/^lock_//; s/__/\//g') ← $(grep -o '"session":"[^"]*"' "$f" | cut -d'"' -f4)"
    done
    [ "$count" -eq 0 ] && echo "  (无活动锁)"
    ;;
  force-unlock)
    file="${2:-}"
    [ -n "$file" ] || { echo "用法: force-unlock <文件相对路径>"; exit 2; }
    lf="$LOCK_DIR/lock_$(name_of "$file")"
    if [ -f "$lf" ]; then
      owner=$(grep -o '"session":"[^"]*"' "$lf" | cut -d'"' -f4)
      rm -f "$lf"
      echo "✅ 已强制解锁: $file (原持有者: ${owner:-?})"
    else
      echo "⚠️  该文件无锁"
    fi
    ;;
  *)
    echo "用法: bash scripts/file-lock.sh {lock|unlock|status|force-unlock} [文件相对路径] [session]"
    exit 2
    ;;
esac
