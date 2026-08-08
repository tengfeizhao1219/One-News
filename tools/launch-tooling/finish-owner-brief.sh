#!/usr/bin/env bash
# Owner 一键完成 Owner 简报 v1.0 接入的最后一步
# ================================
# 用途:把 commit b321267 推送到 GitHub,让 owner-brief.yml 在 GitHub Action 列表里出现
# 用法:在 WorkBuddy 项目根目录执行 ./tools/launch-tooling/finish-owner-brief.sh
# ================================
set -e

cd "$(dirname "$0")/../.."

echo "=== 当前 HEAD ==="
git log --oneline -1

echo ""
echo "=== 待推送 commit ==="
git log --oneline origin/main..HEAD

echo ""
echo "=== 推送 ==="
git push origin main

echo ""
echo "=== 验证 ==="
git log --oneline -2

echo ""
echo "✅ 完成。下一步:"
echo "1. 打开 https://github.com/tengfeizhao1219/One-News/actions"
echo "2. 在左侧列表找 'Owner Brief · 手动触发版'"
echo "3. 点 'Run workflow' 跑第一次(since=24h, push_to_notion=false)"
echo "4. 跑完看 artifact 里的 5 段是否齐全"
