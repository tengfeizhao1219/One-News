# 一页（One-News）— 项目速览

> **角色**：新会话的「项目记忆外挂」。任何 AI 会话的第一份必读文件。
> **维护**：每个会话结束时必须更新。谁改谁负责。

---

## 基本信息

| 项 | 值 |
|---|-----|
| 项目名 | 一页（One-News） |
| 定位 | 微信小程序 · AI 新闻速览 |
| 仓库 | `github.com/tengfeizhao1219/One-News` |
| 技术栈 | 微信小程序原生 + WXS + Mock 数据（JavaScript） |
| 当前分支 | `main` |
| 最新提交 | `713a2d8` — PJM: TASK_BOARD v2.4（A-12d ✅ + A-08 ✅ + 评审 4/4 完成） |

---

## 当前状态

| 模块 | 状态 | 备注 |
|------|------|------|
| 首页（卡片滑动 + 侧边栏） | ✅ 已完成 | WXS 手势、暗色模式、8 分类（constants 实际 all/recommend/tech/international/sports/life/agriculture/science） |
| 详情页（基础展示） | ✅ 已完成 | 单条新闻查看 |
| 详情页（阅读模式） | 🔵 部分落地 | **同分类上下滑翻页已完成**（detail.js pageTo）；仅缺"跨分类衔接"（RQ-01，T-01） |
| 搜索页 | ❌ 未实现 | 整体缺失：无 `pages/search`、无 `searchNews` 云函数、request.js 无接口；CONTEXT 原"✅"为误标（见 RQ-13） |
| 真实数据接入 | ✅ 已完成 | getNewsList 五层降级：天行 L1→内存 L2→云库(news_cache) L3→聚合 L4→AI 兜底 L5 |
| 自动更新 refreshNews | ✅ 已上线 | **v3＝阿里百炼 DeepSeek 联网搜索→质量校验→写 news_cache**（定时 6/11/20 点 + 手动）；非 GitHub news.json |
| 聚合数据源（Juhe） | ✅ 已接入 | L4 降级 + 分类透传（v12）；API Key 已注入环境变量 |
| 卡片摘要补全 | ✅ 已实现 | 空摘要自动抓正文首段兜底（v13 enrichMissingSummaries） |
| 标题截断加固 | ✅ 已完成 | CSS word-break + 摘要限 3 段（v13） |
| Mock 数据 | ✅ 已完成 | 36 条，5 分类，带正文 |
| 暗色模式 | ✅ 已完成 | 全局 `!important` 覆盖 |

---

## 技术架构速览

```
cloudfunctions/
  getNewsList/    — 新闻列表（L1 天行→L2 内存→L3 云库→L4 聚合→L5 AI 兜底）
  getNewsDetail/  — 新闻详情（零依赖正文抓取 contentExtractor）
  common/         — 共享：adapter（分类映射）/ juheApi / config / contentExtractor
pages/
  home/          — 首页（卡片、侧边栏、WXS 手势）
    touch.wxs    — ⚠️ 纯 ES5！不支持 try/catch/let/const/箭头函数
  detail/        — 详情页（同分类上下滑翻页已完成；跨分类衔接待 RQ-01/T-01）
  （无 search/ 页面 — 搜索整体缺失，见 RQ-13）
cloudfunctions/
  refreshNews/   — v3：阿里百炼 DeepSeek 联网搜索 → validateAndClean → 写 news_cache
  common/validator.js — 质量校验（字段/来源白名单/垃圾词/URL 占位符；**未含**微信内容安全 API，见 RQ-10）
data/
  news.json      — 遗留文件，当前未被 refreshNews 实时使用（真实源为阿里百炼）
test/
  v4-regression-data-layer.js — 数据层回归测试套件（178 用例）
utils/
  constants.js / request.js / util.js
```

---

## 关键开发红线（⚠️ 踩过坑）

1. **WXS 必须纯 ES5** — 不支持 `try/catch`、`let`、`const`、箭头函数、模板字符串
2. **WXS 不要 `return false`** — 会阻止子元素 `bindtap` 事件
3. **`scroll-view` 在 flex 容器中** — 用 `flex: 1` + `min-height: 0`，不用 `height: 100%`
4. **`getApp()` 不能放模块顶层** — 必须在方法内部调用并做 null 检查
5. **commit message 要简短** — 中文长消息会导致推送 400 错误

---

## 协作框架

| 文件 | 用途 |
|------|------|
| `ROLE_CARDS.md` | 8 个角色的身份卡（权限、参与阶段） |
| `RELAY.md` 🔥 | **接力棒** — 当前该谁做什么，启动指令 |
| `CONTEXT.md`（本文件） | 项目速览，新会话第一读 |
| `COLLABORATION.md` | 多会话协作协议（v2.2） |
| `TASK_BOARD.md` | 任务看板（当前任务、进行中、已完成） |
| `docs/00-规划/任务交接流转机制.md` | ⭐ 任务流转规则权威源（所有角色必读） |
| `docs/00-规划/项目整体计划.md` | 项目整体路线图 |
| `docs/index.html` | 项目整体看板（**在线实时版** · GitHub Pages 托管，每 60s 自动拉取约定文件刷新） |
| `COMMLOG.md` | 会话沟通记录（交接用） |
| `docs/项目日志.md` | 完整项目历史 |
| `docs/SOP-软件开发流程基准.md` | 开发规范与流程 |
| `docs/01-需求规划/需求梳理与审查报告.md` | 🆕 需求梳理 + 文档审查发现（2026-07-30） |
| `docs/02-产品设计/PRD-阶段二功能增强.md` | 🆕 D-01 阶段二功能增强 PRD（补全 RQ-01/03/04/07/10 设计） |

---

## 待办优先级

| # | 任务 | 优先级 | 依赖 |
|---|------|--------|------|
| 1 | **D-02 交互设计**：跨分类衔接交互 + 字体设置面板 + 收藏/分享交互原型 | 🔴 高 | D-01 ✅ + A-12b ✅ |
| 2 | **T-01 技术选型**：基于 A-12a 三定案（方案A/msgSecCheck/本地存储）出技术选型说明 | 🔴 高 | D-01 ✅ + A-12a ✅ |
| 3 | **D-03 视觉设计**：字号变量 + 按钮样式 + 分享卡片兜底 + 暗色模式兼容 | 🔴 高 | D-02（部分可基于 A-12c 提前启动） |
| 4 | **D-04 设计评审**：产品经理汇总 A-12 评审结论 + D-02/D-03 → 设计评审纪要 | 🔴 高 | D-02 + D-03 |
| 5 | RQ-10 内容合规审核（接微信内容安全 API） | 🔴 高 | T-01 方案（A-12a），P0 |
| 6 | RQ-04 字体大小调节 | 🟡 中 | D-02/D-03 设计 |
| 7 | RQ-03 收藏 + RQ-07 分享 | 🟡 中 | D-02/D-03 + T-01 存储方案 |
| 8 | A-12 待确认事项闭环（Q-B1~B5 + Q-01~06） | 🟡 中 | 产品经理 + 技术负责人 |
| 9 | 聚合独立分类 tab：**已取消**（用户决策保留 8 分类） | — | ✅ A-09 |
| 10 | 搜索重建：**已砍掉**（用户决策不做搜索） | — | ❌ A-10 |
| 11 | 清理 home.js 诊断 console.log | 🟢 低 | 无 |
| 12 | SOP 更新（WXS 红线 + return false 禁令） | 🟢 低 | 无 |
| 13 | ~~百炼 Key 轮换~~ | — | 已搁置 |

> 📋 **完整计划见** `docs/00-规划/项目整体计划.md` v2.0（阶段一闭环、阶段二细分、阶段三~六框架、A-12 评审系列、风险清单更新）

---

> **最后更新**：2026-07-30 | **更新者**：项目经理 | **关联**：TASK_BOARD v2.4、A-12 评审全量闭环、D-02/T-01 并行启动
