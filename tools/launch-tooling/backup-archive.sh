#!/usr/bin/env bash
# One-News 归档目录 tar 备份脚本
# 用途：每周把 /workspace/One-News-archive/ 整目录 tar 备份到云盘
# 触发：cron 每周日 02:00（推荐），或手动执行
# 原则：零依赖（无 npm/无 python），用 OS 自带 tar + date + curl
# 备份位置：腾讯微云「One-News/Weekly-Backup/」目录（通过 weiyun-cli 上传）
# 作者：WorkBuddy (PM) · 2026-08-08

set -euo pipefail

# === 配置 ===
ARCHIVE_DIR="/workspace/One-News-archive"          # 归档源
BACKUP_DIR="/tmp/one-news-backups"                 # 本地临时备份
WEIYUN_REMOTE="/Applications/Weiyun.app/Contents/MacOS/weiyun-cli"  # 微云 CLI
WEIYUN_TARGET="One-News/Weekly-Backup"             # 微云目标目录
RETAIN_LOCAL=4                                    # 本地保留最近 4 份

# === 自检 ===
if [ ! -d "$ARCHIVE_DIR" ]; then
  echo "❌ 归档源不存在：$ARCHIVE_DIR"
  echo "   请确认 owner 机器上 /workspace/One-News-archive/ 是否存在"
  exit 1
fi

# === 1. 生成时间戳文件名 ===
TS=$(date +%Y%m%d-%H%M%S)
WEEK=$(date +%Y-W%V)                              # ISO 周编号
FILENAME="one-news-archive-${TS}.tar.gz"

mkdir -p "$BACKUP_DIR"
echo "📦 开始打包：$ARCHIVE_DIR → $BACKUP_DIR/$FILENAME"
echo "   （目录大小预估，请耐心等待...）"

# === 2. tar 打包（gzip 压缩） ===
tar -czf "$BACKUP_DIR/$FILENAME" \
  -C "$(dirname "$ARCHIVE_DIR")" \
  "$(basename "$ARCHIVE_DIR")"

LOCAL_SIZE=$(du -sh "$BACKUP_DIR/$FILENAME" | awk '{print $1}')
echo "✅ 打包完成：$LOCAL_SIZE"

# === 3. 校验完整性（MD5 写到同目录） ===
MD5_FILE="$BACKUP_DIR/$FILENAME.md5"
md5 -q "$BACKUP_DIR/$FILENAME" > "$MD5_FILE"
echo "🔐 MD5: $(cat "$MD5_FILE")"

# === 4. 上传到微云（如果有 weiyun-cli） ===
if [ -x "$WEIYUN_REMOTE" ]; then
  echo "☁️  上传至微云：$WEIYUN_TARGET/$FILENAME"
  "$WEIYUN_REMOTE" upload \
    --local "$BACKUP_DIR/$FILENAME" \
    --remote "$WEIYUN_TARGET/$FILENAME" || {
      echo "⚠️  微云上传失败，但本地备份已保留"
      echo "   手动上传：登录微云 → One-News/Weekly-Backup/ 目录 → 拖拽 $FILENAME"
    }
  echo "🔐 上传 MD5：$WEIYUN_TARGET/$FILENAME.md5"
  "$WEIYUN_REMOTE" upload \
    --local "$MD5_FILE" \
    --remote "$WEIYUN_TARGET/$FILENAME.md5" || true
else
  echo "⚠️  未检测到 weiyun-cli，跳过云端上传"
  echo "   安装方式：brew install --cask weiyun（macOS 应用，未必有 CLI）"
  echo "   替代方案：手动登录微云 → One-News/Weekly-Backup/ 目录 → 拖拽上传"
  echo "   文件位置：$BACKUP_DIR/$FILENAME"
fi

# === 5. 清理过老的本地备份（保留最近 N 份） ===
echo "🧹 清理本地旧备份（保留最近 $RETAIN_LOCAL 份）..."
ls -t "$BACKUP_DIR"/one-news-archive-*.tar.gz 2>/dev/null | \
  tail -n +$((RETAIN_LOCAL + 1)) | \
  xargs -r rm -f
ls -t "$BACKUP_DIR"/one-news-archive-*.tar.gz.md5 2>/dev/null | \
  tail -n +$((RETAIN_LOCAL + 1)) | \
  xargs -r rm -f

# === 6. 摘要 ===
echo ""
echo "=========================================="
echo "📋 本次备份摘要"
echo "=========================================="
echo "源目录：$ARCHIVE_DIR"
echo "包大小：$LOCAL_SIZE"
echo "文件名：$FILENAME"
echo "周编号：$WEEK"
echo "MD5：$(cat "$MD5_FILE")"
echo "本地路径：$BACKUP_DIR/$FILENAME"
echo "=========================================="
echo "✅ 备份完成"
