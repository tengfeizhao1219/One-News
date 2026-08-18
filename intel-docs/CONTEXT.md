# 项目速览（CONTEXT）

> 任何 AI 角色的「记忆外挂」，第一必读。由全员在会话结束时更新，谁改谁负责。

## ⚠️ 这是一个 AI 协作项目
本项目由 AI 多角色协作完成（O/I/A/P/D/Q/K），仅「用户（owner）」是真人。沟通介质是文件（TASK_BOARD、COMMLOG、RELAY），没有 IM、没有会议。协作机制见 `AI情报官_协作机制.md`。

## 基本信息
- **项目名**：AI 情报官（AI Intel Officer）—— 微信小程序「One News / 一页」内的 AI 情报模块
- **定位**：把 25 个信源当日内容，经 AI 梳理成「与你有关的结果」，用叙事化方式推给用户（而非罗列新闻）
- **硬前提（不可违背）**：
  1. One News 原有的一切**一律不改**；复用能力必须显式标记 + 命名空间隔离（`intel_*`），可整体摘除
  2. UI 100% 复用 One News `theme.json`，**禁止新增 hex 色值**
  3. 「上手试试」等操作指引必须基于真实联网调研、引用已验证官方链接，不得编造

## 当前状态（2026-08-18）
- ✅ 调研（25 源实测可用）、设计（v1）、实现任务拆解、文档交叉校验（AI 视角）
- ✅ 前端 demo（v0.4.3）+ 真实小程序模块 `pages/intel/`（12 文件落地）
- ✅ 复用审计（16 项映射表 + 可抄骨架）
- ✅ 协作机制落地（本文件 + ROLE_CARDS/TASK_BOARD/COMMLOG/RELAY）
- ✅ 文档已实时同步至 Notion「AI 情报官项目资料」库（9+ 篇）
- 🔴 待定：GitHub 代码仓库目标（owner 拍板）；Notion token 已就绪

## 技术架构速览
```
One News 仓库（不改原有逻辑）
├── pages/intel/          ← AI 情报模块（独立命名空间，可摘除）
│   ├── home/             ← 首页（One News 右滑进入，右下角 FAB→我的）
│   ├── detail/           ← 详情（叙事弧线：发生了什么→落到你这里→了解更多→上手试试）
│   └── mine/             ← 我的（FAB 落地页）
├── cloudfunctions/intel* ← 后端（Phase 1 待实现：intelFetch/intelRssPoll/定时触发器）
└── one-news-bridge/      ← 2 处最小桥接（INTEL-BRIDGE 标记，可整段删除）
```
- 抓取范式复用 One News `refreshNews` 的 self-fan-out 分片（60s 超时规避）
- 官网正文抓取复用 `common/contentFetcher.js`（零依赖，比 cheerio 轻）
- LLM 走独立 `intelProcess` 云函数 + 独立 Key（与 One News 阅读摘要分账）

## 协作框架（必读文件）
`CONTEXT.md`(本) · `ROLE_CARDS.md` · `TASK_BOARD.md` · `COMMLOG.md` · `RELAY.md` · `AI情报官_协作机制.md` · `AI情报官_文档导航与交叉引用索引.md`

## 🔑 常用速查
- **Notion 同步**：后台守护每 60s 运行 `notion_sync.py`（幂等，未变更跳过）
- **GitHub 同步**：`sync_all.sh`（代码 commit+push，目标仓库待定）
- **凭证**：GitHub PAT / Notion Token 存于沙箱 `secrets.env`（600，未入库）
- **GitHub DNS 修复**：`/etc/hosts` 写入 `140.82.113.4 github.com`；或 `git -c http.curloptResolve=github.com:443:140.82.113.4 pull --rebase`
