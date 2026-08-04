#!/bin/bash
# 同步到项目资产库（Notion）— 与 GM/GitHub 完全解耦
# 用法：bash sync_to_asset_library.sh
# 前提：NOTION_TOKEN 环境变量已设置，或 .notion_token 文件已存在
# 产出：docs/产品文档统一库.md（本地）+ Notion 知识库（远程）
# 说明：任何角色改完文件即可运行，不依赖 GM 提交流程，不依赖 GitHub 连通性
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "📦 [1/2] 合并产品文档 + 代码快照 → 统一文档..."
python3 merge_docs.py

echo ""
echo "☁️  [2/2] 同步到 Notion 资产库..."
python3 notion_sync.py

echo ""
echo "✅ 资产库同步完成 — 文档 + 代码双保险已就位"
echo "   GitHub: https://github.com/tengfeizhao1219/One-News"
echo "   Notion: 一页 One-News · 产品文档统一库"
