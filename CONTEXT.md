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
| 最新提交 | `e0b1e61` — chore: issue ad-hoc self-check tasks A-01~A-08 to all roles (req 2081936012125908992-response-9ao021810e4) |

---

## 当前状态

| 模块 | 状态 | 备注 |
|------|------|------|
| 首页（卡片滑动 + 侧边栏） | ✅ 已完成 | WXS 手势、暗色模式、5 分类 |
| 详情页（基础展示） | ✅ 已完成 | 单条新闻查看 |
| 详情页（阅读模式） | ❌ 待开发 | 上下滑跨分类切换新闻（T-01） |
| 搜索页 | ✅ 已完成 | 关键词搜索 |
| 真实数据接入 | ✅ 已完成 | 天行实时 L1 + 聚合降级 L4 + 云库缓存 L3 + AI 兜底 L5（main，v11-v13） |
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
  detail/        — 详情页（当前为基础版，待升级阅读模式）
  search/        — 搜索页
mock/
  ai-news-cache.js  — Mock 新闻数据（36 条 × 5 分类）
  simulator.js      — 模拟分页加载
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
| `COMMLOG.md` | 会话沟通记录（交接用） |
| `docs/项目日志.md` | 完整项目历史 |
| `docs/SOP-软件开发流程基准.md` | 开发规范与流程 |

---

## 待办优先级

| # | 任务 | 优先级 | 依赖 |
|---|------|--------|------|
| 1 | 阅读模式（详情页上下滑跨分类切换） | 🔴 高 | 无 |
| 2 | 清理 home.js 诊断 console.log | 🟢 低 | 无 |
| 3 | 切换真实数据（云函数 + 数据源） | ✅ 已完成 | 已在 main（v11-v13）落地 |
| 4 | SOP 更新（WXS 红线 + return false 禁令） | 🟢 低 | 无 |
| 5 | 遗留：聚合开放独立分类 tab（体育/生活等） | 🟡 中 | 待用户决策 |
| 6 | ~~百炼 Key 轮换~~ | — | 已搁置（2026-07-30 用户决策） |

---

> **最后更新**：2026-07-30 | **更新者**：项目经理
