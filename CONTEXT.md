# 一页（One-News）— 项目速览

> **角色**：新会话的「项目记忆外挂」。任何 AI 会话的第一份必读文件。
> **维护**：每个会话结束时必须更新。谁改谁负责。

---

## ⚠️ 重要：这是一个 AI 协作项目

本项目由 AI 多角色协作完成，只有「用户」是真人。沟通介质是文件（TASK_BOARD、COMMLOG），没有 IM、没有会议。详见 `docs/00-规划/项目初始化指南-新成员必读.md`。

---

## 基本信息

| 项 | 值 |
|---|-----|
| 项目名 | 一页（One-News） |
| 定位 | 微信小程序 · AI 新闻速览 |
| 仓库 | `https://github.com/tengfeizhao1219/One-News`（公开仓库，clone/pull 无需 token） |
| 技术栈 | 微信小程序原生 + WXS + CloudBase 云开发 |
| AI 引擎 | 智谱 GLM-4-Flash（联网搜索）+ DeepSeek API（降级） |
| 当前分支 | `main` |
| 当前阶段 | 阶段五 🔴（测试验收） |

---

## 当前状态（2026-08-01）

| 阶段 | 状态 |
|------|:---:|
| 阶段一：需求规划 | ✅ |
| 阶段二：产品设计 | ✅ |
| 阶段三：技术方案 | ✅ |
| 阶段四：开发实现 | ✅ |
| 阶段五：测试验收 | 🔴 进行中 |
| 阶段六：上线复盘 | ⏳ |

### 关键进度

| 模块 | 状态 | 备注 |
|------|:---:|------|
| 前端（UX-BUG01~14 + UX-IMPROVE + UX-FIX） | ✅ | **全部完成，前端待办清零** |
| 后端（B-01~B-07） | ✅ | 核心开发完成 |
| 云函数引擎（ADR-002 智谱+DeepSeek） | ✅ | 代码 + 部署均已完成 |
| 云函数 v4.1 平铺自包含 | ✅ | 根治 Cannot find module |
| **DEP-01 云函数部署** | ✅ | 2026-08-01 完成，上线唯一硬阻断解除 |
| 测试（Q-02/Q-03） | 🔄 | 执行中 |
| 后端自查（B-08/B-10/B-11/B-14） | 📋 | 待后端开发认领 |
| 视觉/交互收尾 | 📋 | UX-IMPROVE01~03 + D-05.3 / UX-IMPROVE08 |

---

## 技术架构速览

```
cloudfunctions/                  — 云函数（v4.1 平铺自包含，无 common/ 目录）
  getNewsList/                   — 新闻列表（全链路只走智谱/DeepSeek）
  getNewsDetail/                 — 新闻详情（content 字段贯通）
  refreshNews/                   — 定时刷新（每小时，写 news + news_cache）
pages/
  home/                          — 首页（卡片滑动 + 侧边栏 + WXS 手势）
    touch.wxs                    — ⚠️ 纯 ES5！不支持 try/catch/let/const/箭头函数
  detail/                        — 详情页（跨分类连续阅读 + 预加载并行化）
    reading-engine.js            — 阅读引擎（快速通道 + 后台补拉）
components/                      — 字体面板、收藏按钮、分享卡片
utils/                           — constants.js / request.js / localCache.js
test/                            — 自动化测试套件
theme.json                       — 主题变量（浅色/暗色）
```

---

## 关键开发红线（⚠️ 踩过坑）

1. **WXS 必须纯 ES5** — 不支持 `try/catch`、`let`、`const`、箭头函数、模板字符串
2. **WXS 不要 `return false`** — 会阻止子元素 `bindtap` 事件
3. **`scroll-view` 在 flex 容器中** — 用 `flex: 1` + `min-height: 0`，不用 `height: 100%`
4. **`getApp()` 不能放模块顶层** — 必须在方法内部调用并做 null 检查
5. **云函数已平铺自包含** — 无 `common/` 目录，`require('./X')` 非 `require('../common/X')`
6. **commit message 要简短** — 中文长消息会导致推送 400 错误

---

## 协作框架（必读文件）

| 文件 | 用途 |
|------|------|
| `docs/00-规划/项目初始化指南-新成员必读.md` | 🆕 **新角色接入第一读**（含 AI 协作规则、Token 用法、资料地图） |
| `CONTEXT.md`（本文件） | 项目速览 |
| `ROLE_CARDS.md` | 8 个角色的身份卡（权责清单） |
| `TASK_BOARD.md` | 🔥 任务看板（广播区 + 全部任务） |
| `COMMLOG.md` | 会话沟通记录（按时间倒序） |
| `COLLABORATION.md` | 多会话协作协议 |
| `RELAY.md` | 既定任务跟踪表 |
| `docs/00-规划/任务交接流转机制.md` | 任务流转规则权威源 |
| `docs/共享保险库使用指南.md` | GitHub Token 获取与使用 |

---

## 当前待办（详见 TASK_BOARD.md）

| 优先级 | 任务 | 负责人 |
|--------|------|--------|
| 🔴 | Q-02/Q-03 测试执行 | 测试工程师 |
| 🔴 | B-08/B-11 后端确定性 bug | 后端开发 |
| 🟡 | B-10/B-14 后端优化 | 后端开发 |
| 🟡 | B-09/B-12 需 TL 决策 | 技术负责人 |
| 🟡 | UX-IMPROVE01~03 + D-05.3 | 视觉设计师 |
| 🟡 | UX-IMPROVE08 | 交互设计师 |
| ⏳ | Q-05 产品验收（等 Q-03） | 产品经理 |

---

> **最后更新**：2026-08-01 | **更新者**：项目经理 | **关联**：TASK_BOARD v4.6、DEP-01 ✅、阶段五测试验收中
