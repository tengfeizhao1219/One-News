# AI能干什么（AI 情报官）· 代码分支与部署注意事项 v1.0

> 本文件供**任何接手本项目的新 AI** 使用：读完即可正确拉取代码、理解结构、遵守约束、完成部署。
> 项目 = 「AI 情报官」小程序模块（One News 的子模块，独立命名空间，随时可整体摘除）。
> 编写：O 主控 2026-08-18。相关文档见 `intel-docs/`（16 篇）与 Notion 库「AI 情报官项目资料」（挂在「AI能干什么」页面下）。

---

## 一、分支基线（最重要，先看这条）

**所有后续改动一律基于远端分支 `intel-officer`，绝不动 `master`/`main`。**

- 远端仓库：`https://github.com/tengfeizhao1219/One-News.git`
- 分支：`intel-officer`（**完整可运行版**：One News 全量源码 + AI 情报官全部改动）
- 获取方式（任选其一）：
  ```bash
  # 方式 A（推荐）：全新 clone
  git clone -b intel-officer https://github.com/tengfeizhao1219/One-News.git

  # 方式 B（已有 One-News 仓库）：
  git fetch origin intel-officer
  git checkout -b intel-officer origin/intel-officer
  ```
- 微信开发者工具导入时：仓库填上面的 URL，**分支务必选 `intel-officer`**（不要选 master/main）。
- 提交纪律：改前 `git pull --rebase`；改后立即 `git add <本职责文件> && git commit && git push origin intel-officer`。小步快推。

> ⚠️ 该分支 2026-08-18 曾被 force push 过一次（孤儿历史 → 完整历史）。若本地已有旧引用：`git fetch origin && git reset --hard origin/intel-officer`。

---

## 二、仓库目录地图

```
One-News/（intel-officer 分支）
├── app.json / app.js / theme.json / pages/home / pages/detail / cloudfunctions/ …  ← One News 原有（只读，勿改）
├── pages/intel/                    ← ★ AI 情报官前端（本项目的核心交付物）
│   ├── home/   情报首页（右滑进入的第一屏，右下角悬浮按钮 =「我的」入口）
│   ├── detail/ 情报详情页（叙事弧线：状态条→结论标题→发生了什么→落到你这里→了解更多→上手试试）
│   └── mine/   「我的」页（FAB 落地页，后端联调后填充）
├── backend/                        ← ★ AI 情报官后端（云函数源码，尚未并入 One News cloudfunctions/）
│   ├── intelFetch/    self-fan-out 编排器（60s 超时规避，仿 One News refreshNews）
│   ├── intelRssPoll/  按源 worker（25 源差异化抓取，写 intel_ingest）
│   ├── common/        ensureSchema.js（六集合自愈建表）+ contentFetcher.js（官网正文抓取）
│   ├── seedSources.js 25 源幂等注册（唯一事实来源）
│   └── adapters/      25 源 manifest + 四类适配器模板（T2.1 已交付）
├── intel-docs/                     ← ★ 全部项目文档（16 篇，含本文件）
└── one-news-bridge/INTEL-BRIDGE.md ← 前端桥接的 2 处最小改动的精确说明与摘除指南
```

---

## 三、硬约束（红线，违反即返工）

1. **不改 One News 原有逻辑**：`pages/home`、`pages/detail`、`cloudfunctions/*`（除下述 2 处桥接）一律只读。
2. **桥接仅 2 处**（已落地，带 `INTEL-BRIDGE` 标记，可整段摘除）：
   - `app.json`：注册 `pages/intel/home`、`pages/intel/detail`、`pages/intel/mine` 三个页面
   - `pages/home/home.js`：`onTouchEnd` 内右滑跳转（阈值常量 `INTEL_ENTER_SWIPE_THRESHOLD = 60`，总开关 `_intelBridgeEnabled`，置 false 即摘除）
3. **UI 100% 复用 `theme.json` 设计令牌，禁止新增任何 hex 色值**；图标复用现成资产（如 `assets/icons/settings.svg`），不新增。
4. **后端全部 `intel_*` 命名空间**：集合名（`intel_ingest/intel_staged/intel_current/intel_sources/intel_health/intel_profile`）、字段、常量，与 One News 数据零耦合。
5. **入口交互定稿**（用户已确认，勿改）：One News 首页**右滑**进入 AI 情报首页；情报首页右下角悬浮按钮（复刻 `.floating-more` 风格）是「我的」唯一入口；情报首页卡片**不打场景标签**，场景关联在详情页「落到你这里」展开。
6. 情报详情页「上手试试」内容**禁止瞎编**：必须真实调研后生成，链接只放已验证可达的官方/权威源。

---

## 四、前端部署与开发要点

- 页面结构：`pages/intel/<page>/` 四件套（`.wxml/.wxss/.js/.json`），导航 `navigationStyle: custom`，主题跟随 `app.globalData.themeClass`（根节点 `class="page {{themeClass}}"`）。
- 主题机制：页面根节点挂 `page--light` / `page--dark`（由 `app.applyTheme()` 注入），WXSS 用 `var(--xxx)` 引用 `theme.json` 令牌。
- 详情页「了解更多/上手试试」展开用 `wx:if` 切换；复制链接用 `wx.setClipboardData`（个人主体小程序无 `web-view`，不依赖内置浏览器）。
- 验证路径：预览 → One News 首页 → 右滑 → AI 情报首页 → 悬浮按钮 → 「我的」；点卡片 → 详情页。

---

## 五、后端部署注意事项（★ 最容易踩坑）

### 5.1 One News 的云函数部署方式（先理解这个）
- `cloudbaserc.json`：`functionRoot: cloudfunctions`，每个函数一个目录，独立部署。
- **云函数自包含**：共享代码（如 `contentFetcher.js`）是**复制到每个函数目录内的 `utils/`**（见 `cloudfunctions/refreshNews/utils/contentFetcher.js`），云函数部署只上传 `cloudfunctions/<函数名>/` 目录，**`../common/` 这种仓库级共享不会被上传**。

### 5.2 我们的 backend → 正式部署前的重组（必须做）
`backend/intelRssPoll/index.js` 引用了 `../common/ensureSchema`、`../common/contentFetcher`、`../seedSources`——**直接按现状部署会 404**。按 One News 自包含范式重组：

1. 在 `cloudfunctions/` 下新建 `intelFetch/`、`intelRssPoll/` 两个目录
2. 把 `backend/intelRssPoll/index.js`、`config.json`、`package.json` 放入 `cloudfunctions/intelRssPoll/`
3. 把 `backend/common/ensureSchema.js`、`backend/common/contentFetcher.js`、`backend/seedSources.js` **复制**进 `cloudfunctions/intelRssPoll/utils/`
4. 修改 `cloudfunctions/intelRssPoll/index.js` 顶部 require：
   ```js
   const { ensureSchema } = require('./utils/ensureSchema')
   const { seed } = require('./utils/seedSources')
   const { fetchWebPage, extractContentFromHtml } = require('./utils/contentFetcher')
   ```
5. `intelFetch/` 仅依赖 `wx-server-sdk`，直接放入即可
6. `package.json` 依赖：`wx-server-sdk` + `fast-xml-parser`（`installDependency: true`）

### 5.3 cloudbaserc.json 新增两个函数定义（示例）
```json
{
  "name": "intelRssPoll",
  "path": "intelRssPoll",
  "runtime": "Nodejs18.15",
  "handler": "index.main",
  "installDependency": true,
  "triggers": [
    { "name": "intelRssPoll-05", "type": "timer", "config": "0 15 5 * * * *" },
    { "name": "intelRssPoll-11", "type": "timer", "config": "0 15 11 * * * *" },
    { "name": "intelRssPoll-18", "type": "timer", "config": "0 0 18 * * * *" }
  ]
},
{
  "name": "intelFetch",
  "path": "intelFetch",
  "runtime": "Nodejs18.15",
  "handler": "index.main",
  "installDependency": true,
  "triggers": [
    { "name": "intelFetch-05", "type": "timer", "config": "0 10 5 * * * *" },
    { "name": "intelFetch-11", "type": "timer", "config": "0 10 11 * * * *" },
    { "name": "intelFetch-17", "type": "timer", "config": "0 55 17 * * * *" }
  ]
}
```
> 错峰逻辑：intelFetch（编排器）先跑 5 分钟，intelRssPoll（worker）后跑；18:00 发布档提前 15 分钟（17:55 触发编排）→ 准时发布。与 One News 现有触发器零交集。

### 5.4 环境变量 / 开关
- `INTEL_RSS_POLL_ENABLED`：默认 **false**，上线时置 **true**（防止未就绪误抓）
- `INTEL_FETCH_ENABLED`：编排器总开关，同样默认 false
- 不需要任何第三方 API key（RSS/API 源均无密钥）；LLM Key 属 Phase 3（`intelProcess` 独立云函数、独立 key、分账核算）

### 5.5 数据模型（六集合，`ensureSchema` 自愈建表，幂等可重跑）
| 集合 | 作用 |
|---|---|
| `intel_sources` | 25 源注册表（seedSources.js 幂等播种，含 `lastSuccessCursor` 增量游标） |
| `intel_ingest` | 原始抓取（guid 幂等去重：`intel_<源id>_sha256(guidRaw)`） |
| `intel_staged` | 处理后待发布（Phase 3 写入） |
| `intel_current` | 已发布（发布闸门 T 时刻置 `isCurrent` 指针，Phase 4 实现） |
| `intel_health` | 源健康度（连续失败计数、告警） |
| `intel_profile` | 用户画像（Phase 5 初始化写入） |

### 5.6 25 源权威清单（唯一事实来源 = `backend/seedSources.js`，与 `backend/adapters/sources-manifest.json` 的 id 必须一致，当前已 100% 对齐）
- 分层：**A9**（广度扫描）+ **B4**（深度阅读）+ **C6**（趋势官方）+ **D2**（社区）+ **E1**（工具发现）+ **F3**（中文：机器之心/量子位/公众号，默认不强制开启）
- 四类适配器：`rss`×17 / `web`×5（The Neuron/The Batch/Anthropic/Meta/机器之心，官网抓取复用 contentFetcher.js，零 cheerio）/ `api`×2（HN Algolia、arXiv 官方 API，必带时间窗）/ `wechat`×1（本地 SQLite，T2.5 实现，云端只消费本地进程 HTTP API）

---

## 六、文档与代码双通道同步纪律

| 通道 | 内容 | 机制 |
|---|---|---|
| GitHub `intel-officer` 分支 | 代码 + `intel-docs/` 文档 | 改后立即 commit+push；沙箱另有每 60s 自动守护 |
| Notion 库「AI 情报官项目资料」（「AI能干什么」页面下） | 全部文档 | `/workspace/*.md` 变更后 60s 内自动同步 |

- 文档优先改 `/workspace/`（自动同步 Notion），如需进代码分支再复制到 `intel-docs/` 提交。
- 协作文件（`TASK_BOARD/COMMLOG/RELAY/ROLE_CARDS/CONTEXT`）是跨会话通信载体：**认领任务、交付、记录决策都写这里**。
- 沙箱 GitHub 偶发 TLS 抖动：`/etc/hosts` 写可用 IP（如 `140.82.114.3 github.com`），并同步 `~/.user_hosts` 持久化；IP 失效时用 `curl --resolve github.com:443:<ip>` 批量探测可用 IP（常见段：140.82.112.x–121.x、20.205.x、20.27.x）。

---

## 七、当前进度与下一步（新 AI 接棒点）

- 已完成：Phase 0 协作就绪 ✅ / Phase 1 基础设施 ✅ / Phase 2 前置（T2.1 manifest + 四类模板）✅
- **下一步：T2.2–T2.5 适配器真码**（基于 `backend/adapters/templates/` 四类模板填充 25 源规则，重点：5 个 web 源的真实 DOM selector 校准、api 时间窗参数、公众号 wechat adapter）
- 里程碑：M3 首个真实情报产出（需 Phase 3 + LLM key）

### 新 AI 启动流程（前 5 分钟）
1. `git clone -b intel-officer https://github.com/tengfeizhao1219/One-News.git`
2. 依次读：`intel-docs/CONTEXT.md` → `ROLE_CARDS.md` → `TASK_BOARD.md` → `COMMLOG.md` → `RELAY.md` → `AI情报官_协作机制.md`
3. 确认角色（O 主控 / I 基础设施 / A 适配器 / P 处理 / D 前端UI / Q 校验 / K 文档）
4. 认领任务后按 §三 硬约束 + §五 部署规范开工
