#!/usr/bin/env bash
# Owner 简报预演：mock 数据下渲染一次
# 目的：FS 实施前能立刻看到效果，无需等真源接好

# 定位到脚本所在目录（不动 cd，避免与脚本内 ROOT 常量冲突）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 准备 mock 数据（让脚本认为 COMMLOG/TASK_BOARD 存在）
MOCK_DIR="$(mktemp -d)"
mkdir -p "$MOCK_DIR/docs"

cat > "$MOCK_DIR/COMMLOG.md" <<'COMMLOG_EOF'
## [2026-08-08 10:10] Owner 简报机制上线 + token 三层备份 | 会话：[项目总控(PJM)]
机制层：Owner 简报由 PM 维护，每 4 小时刷新
- Notion token 拿到即备份到 tdrive 保险库

## [2026-08-08 09:30] AI 解读代码完成，请 owner 决策是否部署（FS-08） | 会话：[全栈开发(FS)]
AI 独立解读已写入 refreshNews/aiExplainer.js
- 风险：版权剽窃嫌疑
- 建议：暂缓部署
- 是否启动需要 owner 拍板

## [2026-08-07 16:00] RQ-22 反馈留言板全链路交付 | 会话：[小程序前端开发(FE)]
留言板 + 文明公约页全部完成
- 待 owner 真机回归
- 请登录小程序测试 AC-01 ~ AC-12

## [2026-08-07 12:00] RQ-22 部署清单就绪，请 owner 部署云函数 | 会话：[全栈开发(FS)]
feedback-create / feedback-list / feedback-delete 已推送 GitHub
- owner 需要在 CloudBase 控制台手动部署

## [2026-08-07 09:00] 上线前最后整理：仓库代码/文档分离完成 | 会话：[One-News GM]
全部协作文档移出到本地归档
- 远程仓库只留 143 文件

## [2026-08-08 11:00] 请 owner 登录小程序后台，配置类目 | 会话：[全栈开发(FS)]
微信小程序后台需要配置「信息速览」类目
- 请 owner 登录 mp.weixin.qq.com → 设置 → 类目管理
- 选择「新闻 / 阅读」类目
- 提交后截图回传以推进提交审核
COMMLOG_EOF

cat > "$MOCK_DIR/TASK_BOARD.md" <<'BOARD_EOF'
# 任务看板

| 任务 ID | 名称 | owner | 优先级 | 状态 | 备注 |
|---------|------|-------|--------|------|------|
| RQ-22 | 意见反馈留言板 | FE | P0 | ✅ | 8/7 全绿 |
| FS-08 | AI 独立解读 | FS | P1 | ⏳ | 待 owner 决策 |
| FS-05 | 上线前检查 | GM | P0 | ✅ | 8/7 完成 |
| BUG-20260807-002 | category-wheel 索引覆盖 | FE | P1 | ✅ | 已修 |
| RQ-23 | 留言板运营规范 | PM | P1 | 🔄 | owner 关注 |
| RQ-24 | 部署到 PROD | FS | P0 | 🚫 | 等 owner 部署云函数 |
BOARD_EOF

# 用 mock 数据运行生成器（脚本与本测试在同一目录）
COMMLOG_PATH="$MOCK_DIR/COMMLOG.md" \
TASK_BOARD_PATH="$MOCK_DIR/TASK_BOARD.md" \
node "$SCRIPT_DIR/gen-owner-brief.mjs" \
  --output="$MOCK_DIR/owner-brief.md" \
  --since=24h

echo ""
echo "=== 渲染结果（前 80 行）==="
head -80 "$MOCK_DIR/owner-brief.md"

# 清理
rm -rf "$MOCK_DIR"
