# COMMLOG · AI 情报官沟通交接记录

> 倒序（最新在上）。每条：日期 | 角色 | 事项 | 状态/去向。子 Agent 交付后必须在此留痕。
> 详细过程留痕于各交付文档；这里只记「交接点」。

---

| 日期 | 角色 | 事项 | 状态 |
|---|---|---|---|
| 2026-08-19 | O/Owner | **拍板：定时档 = 固定节点无条件抓取**。05/11/18 触发器一到即抓全部启用源，不看 `lastFetchTime`/`pollSeconds` 间隔，手动抓取不消费定时档机会。`intelRssPoll` 已由 `listDueFeeds`(6h 间隔)改为 `listEnabledFeeds`(无条件)，部署 Active，提交 `d85ae00`。设计 §5.8 / TASK_BOARD T1.4 / 本导航索引已同步。**所有涉及抓取调度的角色留意** | ✅ |
| 2026-08-18 | Q/O | 25 源权威清单对齐：O 裁决 A9/B4/C6/D2/E1/F3（剔 semianalysis/one_useful_thing，补量子位+公众号），id 统一下划线，seedSources 与 manifest 100% 一致 | ✅ |
| 2026-08-18 | O | 代码已推送 GitHub `One-News#intel-officer` 分支；git 守护每 60s 自动同步 | ✅ |
| 2026-08-18 | I | Phase 1 基础设施完成（T1.1–T1.4）| ✅ |
| 2026-08-18 | A | T2.1 完成：25 源 manifest + 四类适配器模板 | ✅ |
| 2026-08-18 | O | 协作机制五件套补齐（TASK_BOARD/COMMLOG/RELAY），Phase 0 收尾 | ✅ |
| 2026-08-18 | K | 研读 One News 协作机制并适配输出《AI情报官_协作机制.md》+ ROLE_CARDS + CONTEXT | ✅ |
| 2026-08-18 | K/O | Notion 资料库建成，9 篇文档同步成功，后台守护每 60s 轮询运行中 | ✅ |
| 2026-08-18 | I | 本地 GitHub 仓库 `ai-intel-officer` 初始化，17 文件首提交；远端仓库目标待 owner 拍板 | 🔄 |
| 2026-08-17 | I | 复用审计交付《AI情报官_复用审计.md》：16 项复用映射表 + 可抄骨架 | ✅ |
| 2026-08-17 | D | UI demo 锁定 v0.4.3；真实 intel 模块 12 文件落地 `pages/intel/` | ✅ |
| 2026-08-17 | I | GitHub DNS 劫持修复（/etc/hosts 140.82.113.4），One News 仓库克隆成功 | ✅ |
| 2026-08-17 | K | 三文档 AI 视角交叉校验 + 导航索引建立 | ✅ |
| 2026-08-17 | K | 需求/调研/设计三文档完成，实现任务拆解（7 角色 AI 团队） | ✅ |
| 2026-08-17 | I | 25 信息源全部实测可用，7 待处理源复测定论 | ✅ |

## 2026-08-19 · intel UI 微调 4 项（owner 反馈）

- **① 返回按钮与胶囊垂直居中对齐**：三页 nav 改为 top=menu-top、height=menu-height、flex 居中（对齐 One News panel-header 做法），不再顶到胶囊下方。
- **② 首页"数据截至"靠右**：hero 改单行（今日 N 条靠左 · 数据截至/源健康靠右，space-between）。
- **③ 详情页标题下展示来源+时间**：meta 增加 pubTime（取自首页卡片 time，经 intelDetailCard 传入），与 srcName 并排；首页卡片保持无来源时间。
- **④ 我的页画像自动回填**：onboard 增加 prefillExistingProfile——已初始化画像时再次打开自动填充 identities/focusTags/depth/langPref/wantTryable/合规，免重复填写。
- **验证**：4 js node --check 通过。
- **下游**：UI 规范 v1 待同步 v2（导航对齐/hero 单行/详情 meta/onboard 回填）。

## 2026-08-19 · intel 三页 UI 重构 v6 落地（owner 确认设计后实现）

- **背景**：owner 反馈原 UI 不美观，要求"简洁、交互友好、重点突出"，经 6 版设计预览迭代定稿（卡片流 · 轻高亮 · 少图标）。
- **设计定稿要点**：① 首页去"今日关注"标题与来源/时间（挪详情页）；rank1 重点卡带"对你最重要"tag + 浅蓝底"对你"行；保留本周可试用清单；FAB 悬浮按钮未动。② 详情页去顶部状态条；来源在标题下展示；"落到你这里"改浅蓝底卡。③ 我的页移除信息源/推送设置（暂不支持），保留身份画像 + 合规。
- **产物**：`pages/intel/home|detail|mine` 三组 wxml/wxss 重写（js 数据逻辑零改动，字段绑定已核对）；色值 100% theme token 零新增 hex；页面底色统一 bg-page、卡片 bg-card 分层。
- **验证**：node --check 三 js 通过；WXML 字段绑定与标签闭合核对通过。
- **下游**：UI 规范 v1 的视觉细节需同步为 v2（待 K 角色更新）；详情页时间字段后端补上后自动展示。

## 2026-08-19 · intel 抓取「无条件触发 + 内容增量」（方案A）

- **决策**：固定节点无条件抓不变，新增 RSS 增量兜底——`intelRssPoll` rss/news 分支按 `lastSuccessCursor`→`sinceMs` 过滤，只收游标之后的新增，单源本轮限 30 条，防旧文淹没新文、空烧 LLM。
- **产物**：代码部署 `d49441f`；本轮 google_deepmind 全量捞进的 pending+low 旧文已清（仅留 rejected 复盘）。

## 2026-08-18 晚间 · O 主控公告（重要，全员必读）

### ① GitHub 推送自愈方案已全局安装（解决"一直被 TLS 卡住"）
- **根因**：沙箱 DNS 对 github.com 的解析会随机命中被拦截的 Azure 段（20.x.x.x），git 报 `gnutls_handshake failed` / `TLS non-properly terminated`。**不是 GitHub 被墙，是解析到了坏 IP。**
- **已安装（所有 AI 会话免配置生效）**：
  - `/usr/local/bin/gh-fix`：探测 github.com/api/codeload/raw 各端点可用 IP → 自动写 `/etc/hosts` + `~/.user_hosts`
  - `/usr/local/bin/git` wrapper：git 命令失败且报网络错误时，自动跑 gh-fix → 重试一次
- **用法**：正常 `git push/fetch/clone` 即可，遇 TLS 错误 wrapper 自动修复重试；极端情况手动 `gh-fix`。
- **可用段**：140.82.112.x–121.x（GitHub 原生）、185.199.x.x（raw）；**不可用**：20.x.x.x（Azure，被沙箱拦）。
- **注意**：`api.github.com` 必须用专属 IP（.5/.6 等），用 github.com 的 IP 会被 301 劫持。

### ② 前后端连调完成（495a70d 已推 intel-officer）
- 首页列表：getIntelBrief（另一 AI 交付）
- 详情页真实数据：intelGetDetail（本提交补齐，无数据时保留占位不打扰 UI）
- 云函数部署：`tools/gen-intel-deploy.sh` 一键生成 7 个自包含副本到 `cloudfunctions/intel*/`；cloudbaserc.json 已注册全部 7 函数（含 3 组定时触发器）
- **当前头号阻塞：LLM Key（T0.3 🚫 待 owner）**——intelProcess 未配 Key 时静默降级跳过处理 → intel_staged 空 → 前端空态。owner 在云开发控制台给 intelProcess 配好 Key 后整条链即通。
- 排查顺序见《AI能干什么_代码分支与部署注意事项.md》§5.7。
## 2026-08-19 · intel-officer 修复并入 main + intel-officer 退役（owner 拍板：main 为规范分支）

- 交接：owner 拍板「main 为规范分支」。intel-officer 中 main 尚缺的内容全部并入 main（提交 f76d289 + 1022739）：① pages/intel/home/* 新版（去 DEMO mock、safeBottom/pageH 注入、普通 scroll-view、scroll-view 背景硬编码、页脚安全区 margin）；② app.js/app.wxss/app.json 窗口/page 背景统一 --bg-card(#FAF9F7/#0D0D0D)；③ cloudfunctions/intelProfile 补入（mine/onboard 依赖的画像云函数）。
- 产物：main 已 push（1022739）；intel-officer 远端+本地分支已删除；WorkBuddy / Desktop(DevTools) / One-News-latest 三副本全部切到 main；detail.js/wxml 保持 main 融合版（whatHappened 多段叙事/实操/最小行动）。
- 下游：后续所有改动一律基于 main；微信开发者工具导入分支选 main；分支基线文档已同步更新。
## 2026-08-19 · 全流程复盘修复落地 + 中文源接入（owner 拍板执行）

- 交接：手动触发 5 源全流程复盘后按 owner 拍板修复全部待提升项并接入中文源：
  ① intelRssPoll：新增 blockCategoryKeywords（量子位剔汽车/商业噪音 10→3 条）、passRequireKeywords（媒体全站 feed 正向 AI 关键词过滤）、cleanItemTitle（AINews] 前缀）、提取器升级（卡片式 <a><h2-6> + urlPattern、changelog 单页模式）、api 超时 10s→15s（arXiv）、HN since 放宽 24h、新鲜度守卫（worker 10 天 + brief 7 天）、失败连击仅计「完全无产出」
  ② intelRouter：product 信号补通用 AI 关键词（中文 AI 内容不再误判 low，极客公园 3 条 high 进 brief）
  ③ intelDispatcher：persistBrief 覆盖前归档旧版（intel_current_archive，历史可追溯）
  ④ 中文源接入：deepseek_news（官方动态 scrape，卡片提取验证 5 条）、deepseek_changelog（API 更新日志 scrape，19 版本块）、geekpark_ai（RSS 完整正文+AI 过滤，20 条）；InfoQ 弃用（feed 内容仅 6 字符）；机器之心确认付费墙不可修（保持禁用）
- 产物：提交 b9d03c2 + 318097d（main 已 push）；三云函数已部署；v8 brief = 12 条（EN 官方 9 + 中文 3）
- 下游：后续每日定时任务将自动抓取中文源（量子位/极客公园/DeepSeek）；注意相关性规则是「老赵三重身份个性化」打分，通用 AI 内容依赖补强关键词，后续可再调
