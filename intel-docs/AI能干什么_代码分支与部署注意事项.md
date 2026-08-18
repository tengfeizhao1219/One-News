# AI能干什么（AI 情报官）· 代码分支与部署注意事项 v2.0

> 本文件供**任何接手本项目的新 AI** 使用：读完即可正确拉取代码、理解结构、遵守约束、完成部署。
> 项目 = 「AI 情报官」小程序模块（One News 的子模块，独立命名空间，随时可整体摘除）。
> 编写：O 主控 2026-08-18（v2.0：新增连调状态、7 云函数自包含部署器、GitHub 推送自愈方案）。

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
│   ├── home/   情报首页（右滑进入的第一屏；数据源：云函数 getIntelBrief）
│   ├── detail/ 情报详情页（叙事弧线；真实数据源：云函数 intelGetDetail，无数据时保留占位）
│   └── mine/   「我的」页（FAB 落地页）
├── utils/intelApi.js               ← 前端数据层（intelGetList/intelGetDetail 封装；另一 AI 另有 utils/intelRequest.js 封装 getIntelBrief）
├── backend/                        ← ★ AI 情报官后端（云函数源码，唯一事实来源）
│   ├── intelFetch/       self-fan-out 编排器（60s 超时规避，仿 One News refreshNews）
│   ├── intelRssPoll/     按源 worker（25 源差异化抓取，写 intel_ingest）
│   ├── intelProcess/     处理引擎（分层路由 + SOP 五步 + multi-engine LLM，写 intel_staged）
│   ├── intelDispatcher/  发布调度（T4.1 指针升级，写 intel_current）
│   ├── intelBrief/       Brief 渲染（Channels 层 OneNewsChannel → 今日关注 payload）
│   ├── intelGetList/     ★ 列表查询（读 intel_current 优先 / intel_staged 回退）——前端连调用
│   ├── intelGetDetail/   ★ 详情查询（按 itemId 读单条）——前端连调用
│   ├── common/           ensureSchema/intelLLM/intelRouter/contentFetcher/channels/
│   ├── seedSources.js    25 源幂等注册（唯一事实来源）
│   └── adapters/         25 源 manifest + 四类适配器模板
├── cloudfunctions/intel*/          ← ★ 自包含部署副本（tools/gen-intel-deploy.sh 生成，勿手改）
├── intel-docs/                     ← ★ 全部项目文档
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

### 5.2 我们的 backend → 部署（★ 已自动化，勿再手动重组）

`backend/` 下函数引用了 `../common/*`、`../seedSources`、`../common/channels`——直接按现状部署会 404。**用仓库内生成器自动产出自包含副本**（依赖复制进副本 + require 改写为 `./common/*`）：

```bash
bash tools/gen-intel-deploy.sh          # 生成 cloudfunctions/ 下 7 个 intel 函数副本
```

生成后 `cloudfunctions/intel*/` 即为可部署目录（含 `package.json`）。**backend/ 是源码唯一真相源，改动后端后重跑本脚本再部署。**

### 5.3 cloudbaserc.json（已注册 7 个 intel 函数）

`cloudbaserc.json` 已注册：`intelFetch`（05:10/11:10/17:55 抓取）、`intelRssPoll`（05:15/11:15/18:00 兜底）、`intelProcess`（05:20/11:20/18:10 处理）、`intelDispatcher`（05:30/11:30/18:30 发布）、`intelBrief`（无触发器，前端调用）、`intelGetList`、`intelGetDetail`（无触发器，前端调用）。新增函数请沿用同格式追加。

### 5.4 环境变量 / 开关
- `INTEL_RSS_POLL_ENABLED`：默认 **false**，上线时置 **true**（防止未就绪误抓）
- `INTEL_FETCH_ENABLED`：编排器总开关，同样默认 false
- **LLM Key（T0.3 🚫 待 owner）**：`intelProcess` 依赖 `intelChat` 多引擎（混元前置→智谱→Qwen→DeepSeek），Key 在云开发控制台该函数环境变量配置。**未配 Key 时 intelProcess 静默降级跳过处理 → intel_staged 无数据 → 前端显示空态**。这是当前"后端有抓取但前端无情报"的头号原因，配好 Key 后处理链即可通。

### 5.5 数据模型（六集合，`ensureSchema` 自愈建表，幂等可重跑）
| 集合 | 作用 |
|---|---|
| `intel_sources` | 25 源注册表（seedSources.js 幂等播种，含 `lastSuccessCursor` 增量游标） |
| `intel_ingest` | 原始抓取（guid 幂等去重：`intel_<源id>_sha256(guidRaw)`） |
| `intel_staged` | 处理后待发布（Phase 3 写入） |
| `intel_current` | 已发布（发布闸门 T 时刻置 `isCurrent` 指针，Phase 4 实现） |
| `intel_health` | 源健康度（连续失败计数、告警） |
| `intel_profile` | 用户画像（Phase 5 初始化写入） |

### 5.7 前后端连调状态（2026-08-18 19:00 实测结论）

| 环节 | 状态 | 说明 |
|---|---|---|
| 首页列表 | ✅ 已连调（另一 AI 的 getIntelBrief） | `utils/intelRequest.js` → 云函数 `intelBrief` → `intel_current` 当期 Brief |
| 详情页 | ✅ 已连调（本提交 495a70d） | `utils/intelApi.js` → 云函数 `intelGetDetail` → `intel_staged/intel_current`；后端无数据时保留占位不打扰 |
| 数据链路 | ⚠️ 依赖 LLM Key | 抓取（intel_ingest）→ 处理（intel_staged，需 Key）→ 发布（intel_current）→ 前端 |
| 云函数部署 | ⚠️ 待 owner 上传 | cloudbaserc 已注册 7 函数，副本已生成，开发者工具上传 `cloudfunctions/intel*/` 即可 |
| 已知坑 | ⚠️ | intelProcess 未配 Key 时静默降级 → 前端空态；这是"后端有数据前端看不到"的最常见原因 |

> 排查顺序：① 云开发控制台确认 7 个 intel 函数已部署；② 确认 `intel_ingest` 有数据（抓取通）；③ 确认 `intel_staged` 有数据（处理通，需 LLM Key）；④ 确认 `intel_current` 有 `isCurrent:true` 当期（发布通）；⑤ 前端 Console 看 `getIntelBrief` / `intelGetDetail` 返回值。

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
- **GitHub 推送自愈（2026-08-18 已全局安装，所有 AI 会话免配置）**：
  - 根因：沙箱 DNS 对 github.com 的解析会随机命中被拦截的 Azure 段（20.x.x.x），git 报 `gnutls_handshake failed` / `TLS non-properly terminated`。**问题不是 GitHub 被墙，是解析到了坏 IP**。
  - 已安装 `gh-fix`（探测可用 IP 并写 `/etc/hosts` + `~/.user_hosts`）与 git wrapper（失败自动 `gh-fix` 重试一次）。**git push/fetch/clone 遇到 TLS 错误会自动修复并重试，无需手动干预**。
  - 手动排查：`gh-fix --dry-run --verbose` 看各端点候选 IP 探测结果；`curl --resolve github.com:443:<ip> https://github.com/` 单测。可用段：140.82.112.x–121.x（原生）、185.199.x.x（raw）；不可用段：20.x.x.x（Azure，被沙箱拦截）。
  - 需手动验证的端点：`api.github.com` 必须用专属 IP（.5/.6 等），用 github.com 的 IP 会被 301 劫持。

---

## 七、当前进度与下一步（新 AI 接棒点）

- 已完成：Phase 0 协作就绪 ✅ / Phase 1 基础设施 ✅ / Phase 2 前置（T2.1 manifest + 四类模板）✅ / Phase 2 抓取层（T2.2–T2.5 intelRssPoll 真码 + gzip 解压 + 公众号双模 + 官网实测定论）✅ / Phase 3 处理层（T3.1–T3.4 intelProcess + intelRouter + intelLLM + 定时器）✅ / **前后端连调（首页 getIntelBrief + 详情 intelGetDetail + 7 云函数部署注册）✅（2026-08-18）**
- **当前最大阻塞：LLM Key（T0.3 🚫）**——intelProcess 未配 Key 时静默降级跳过处理，`intel_staged`/`intel_current` 无数据，前端显示空态。owner 配置 Key 后整条链即通。
- 待办：T3.4 上手试试链接校验落地（research.status=todo）→ 发布闸门 T4.1 打磨 → Phase 5 画像（intel_profile 初始化）
- 里程碑：M3 首个真实情报产出（需 Phase 3 + LLM key）→ M4 常态化每日三档情报

### 新 AI 启动流程（前 5 分钟）
1. `git clone -b intel-officer https://github.com/tengfeizhao1219/One-News.git`
2. 依次读：`intel-docs/CONTEXT.md` → `ROLE_CARDS.md` → `TASK_BOARD.md` → `COMMLOG.md` → `RELAY.md` → `AI情报官_协作机制.md`
3. 确认角色（O 主控 / I 基础设施 / A 适配器 / P 处理 / D 前端UI / Q 校验 / K 文档）
4. 认领任务后按 §三 硬约束 + §五 部署规范开工；GitHub 推送遇 TLS 错误先 `gh-fix`（或直接重试，wrapper 会自动修）
