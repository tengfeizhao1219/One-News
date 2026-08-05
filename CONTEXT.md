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
6. **全员直连 GitHub** — 各角色对自己的职责范围内文件直接执行 `git pull/add/commit/push`（无 GM 代提交）。提交前先 `git pull --rebase`，DNS 修复见 `GITHUB_PUSH_AI_MANUAL.md`。

---

## 协作框架（必读文件）

| 文件 | 用途 |
|------|------|
| `docs/00-规划/项目初始化指南-新成员必读.md` | 🆕 **新角色接入第一读**（含 AI 协作规则、Token 用法、资料地图） |
| `CONTEXT.md`（本文件） | 项目速览 |
| `ROLE_CARDS.md` | 5 个角色的身份卡（权责清单 + 全员直连 git 权限） |
| `TASK_BOARD.md` | 🔥 任务看板（广播区 + 全部任务） |
| `COMMLOG.md` | 会话沟通记录（按时间倒序） |
| `COLLABORATION.md` | 多会话协作协议（含 §七 全员直连 GitHub + §九 资产库同步） |
| `RELAY.md` | 既定任务跟踪表 |
| `docs/00-规划/任务交接流转机制.md` | 任务流转规则权威源 |
| `docs/共享保险库使用指南.md` | GitHub Token 获取与使用 |
| `docs/00-规划/资产库同步速查-文件该放哪个目录.md` | 📦 **资产库同步速查**（每个角色该把文件放哪个目录） |
| `docs/00-规划/全栈开发初始化话术.md` | 全栈开发会话初始化话术 |
| `docs/00-规划/小程序前端开发初始化话术.md` | 🆕 **小程序前端开发初始化话术**（候补角色·按需激活） |

---

## 🔑 常用速查

### GitHub Token 获取
> 仓库公开，pull/clone 不需要 token；仅 push 需要。
- 途径①：找项目经理直接要
- 途径②：tdrive `vault/github_pat` → `tdrive file_download`
- 详见 `docs/共享保险库使用指南.md`

### GitHub 拉取失败（DNS 污染）
> `github.com` 被解析到 `198.18.0.x`，TLS 握手失败。
```bash
# 方案A（推荐）：用真实 IP 强制解析
git -c http.curloptResolve=github.com:443:20.205.243.166 pull --rebase

# 方案B：跑修复脚本
sudo python3 setup_github_dns.py && git pull --rebase

# 都不通 → 换 IP 重试（140.82.121.3 / 140.82.113.3）→ 等几分钟再试
```

### 资产库同步（Notion）
```bash
bash sync_to_asset_library.sh   # 一键：merge 文档 + 代码快照 → Notion
```
> 详见 `docs/00-规划/资产库同步速查-文件该放哪个目录.md`

---

## 当前待办（详见 TASK_BOARD.md）

> 阶段五 · 测试验收 🔴｜PM+PJM 于 2026-08-05 接手全权推进。

| 优先级 | 任务 | 负责人 | 状态 |
|--------|------|--------|:---:|
| 🔴 | V5-FS-02 数据清洗 6 项修复 | 全栈开发（代码✅） | ⏳ 待云端部署+验证（owner） |
| 🔴 | 重新部署云函数 v6.3（refreshNews+getNewsDetail） | owner | ⏳ 阻塞解除前置 |
| 🔴 | Q-02/Q-03 测试执行 | 产品经理 | 🔄 进行中（**Q-07 TL-B13 补充已 ✅ 33/33**） |
| 🔴 | BUG-PD-017/018 二次验收闭环 | 产品设计师 | ⏳ 待 PD 验收 |
| 🟡 | Q-05 产品验收 | 产品经理 | ⏳ 等 Q-03 + FE-A1 翻页复测 |
| 🟡 | RQ-18「AI 搜索更多」技术评估 | 全栈开发 | 🆕 待 FS 出结论 |
| ❓ | AI 摘要详情页是否展示导语 | owner | 待裁定 |
| 🟢 | detail.wxml boundary-chip 死代码清理（UX-SIMPLIFY 遗留） | FS/FE | 🆕 低优 |

---

> **最后更新**：2026-08-05 | **更新者**：PM | **关联**：Q-07 TL-B13 前端展示专项测试通过（33/33）、v7 断言同步 UX-SIMPLIFY 口径、F-07 云端合并口径裁定、boundary-chip 死代码清理项登记
