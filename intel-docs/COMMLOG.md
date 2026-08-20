# COMMLOG · AI 情报官沟通交接记录

> 倒序（最新在上）。每条：日期 | 角色 | 事项 | 状态/去向。子 Agent 交付后必须在此留痕。
> 详细过程留痕于各交付文档；这里只记「交接点」。

---

| 日期 | 角色 | 事项 | 状态 |
|---|---|---|---|
| 2026-08-19 | O/owner | **记录待办：周报功能**（后续迭代）。目前只有每日 3 次巡检 + 「本周可试用清单」（周维度区块），无独立周报。设计需求：① 本周重点回顾（high 相关条目主题聚合）② 可试用清单复盘（勾选完成/效果）③ 趋势洞察（高频关键词/主题）④ 数据质量周报（抓取成功率/过滤统计，反哺源管理）。实现路径：intelWeekly 云函数 + 周一定时器 + brief 渠道扩展。已记 TASK_BOARD T8.1 | 📋 待办 |
| 2026-08-19 | I | **增量抓取严格化完成（commit 增量修复 + 时区修正）**。intelRssPoll：① 无游标（首次/丢失）→ 用档位窗口起点兜底（05档=昨18点/11档=今5点/18档=今11点，北京时区），不再全量拉旧文；② pubDate 无效条目不放过（防 publishedAt=fetchedAt 绕过窗口过滤）。验证：techcrunch_ai empty（窗口内无新增）、geekpark_ai filtered 2 旧文/0 写入——**每次抓取只收两次抓取之间发布的**。部署注意：部署副本 require 全用 ./（common/ + seedSources.js） | ✅ 已推 |
| 2026-08-19 | I/P | **窗口过滤 + 新 prompt 全链路验证（owner 语义：两次抓取间隔）**。① filterByBatchWindow 已部署：按档位窗口（05档=昨18点/11档=今5点/18档=今11点）过滤 publishedAt；② 重跑 71 条 ingest 验证：新评分（owner 版：取消三重身份，AI 底线+议题）筛掉 base<2 全 low；staged 新条目「黑鲸鱼 DSH」whatHappened 514 字多段 + 试试看不硬造（新 prompt 生效实证）；③ v16 重组装 items 0——今天抓的增量 publishedAt 多为 8/13–8/18 旧文，**窗口过滤正确地把历史全滤掉**（0 残留），暴露**增量抓取未严格按窗口**（lastSuccessCursor 后仍捞旧文）——待优化点：intelRssPoll 增量需按「上次抓取后发布」过滤 | ✅ 已推 |
| 2026-08-19 | I/O | **历史数据删除确认 + 手动全流程验证（commit 1fc6aed，已部署 v15）**。① 确认：brief v14 16 条中 13 条为 8/13–8/18 历史（freshness 7 天捞入），已按 owner 拍板删除——intelProcess 新鲜度 7→1 天 + Dispatcher filterTodayOnly（brief 只含当天 publishedAt）；重组装 v15 仅剩当天 1 条。② 手动全流程：intelRssPoll 单源抓取（techcrunch_ai/the_rundown_ai 各 written 1）→ intelProcess 处理（质量闸门拦截 low/rejected 正常）→ Dispatcher 发布（version 15）。今日增量少+聚合/质量/当天三层过滤致 brief 少属正常，明日 17:40 批次生效后观察 | ✅ 已推 |
| 2026-08-19 | I/P | **后端三项优化落地（commit 95b1cbc，已部署 + 重组装 v14）**。① 聚合类资讯过滤：intelClean qualify 加 `multi-news-aggregate`（标题含「；」多新闻揉合/综述词 → rejected 丢弃），今日已剔 6 条（极客早报类），brief 22→16 条；② 试试看语气：SOP prompt 改**轻松引导口吻**（禁止「本周X前/必须/请尽快」命令式）——明日批次生效；③ 数据截至：Dispatcher 组装 brief 记 `batchFetchedAt`（读 intel_health 最新巡检时间），channel 优先展示批次抓取时间（当前 17:55，明日 17:40）。部署注意：部署副本 require 必须 `./common/`（backend 用 `../common/`），用 base64 zip 打包含 common/ | ✅ 已推 |
| 2026-08-19 | I/O | **intelDispatcher 发布崩溃修复 + 今日 18:00 批次手动补发**。① 根因：intelRouter.js:66 三元表达式 `profile && … ? 3 : (profile.depth… )` 在 `score(d, null)` 时访问 null.depth 崩溃（index.js:245 传 null）；修复为 `profile && profile.depth === 'lite'`。② 已重新部署 intelDispatcher（部署后首触发仍旧实例，8s 后重试成功）。③ 手动触发 summary 发布：version 12→13，items 22，tryable 21，upgradedAt 19:04。真机刷新可见。**教训：部署后需验证新实例生效（LEARNINGS 部署验证条目）** | ✅ 已推 |
| 2026-08-19 | O/Owner | **拍板：18:00 批次提前，6 点准时发布**（ADR-10）。intelFetch 17:55→**17:40** / intelRssPoll 18:00→**17:45** / intelProcess 18:10→**17:50** / intelDispatcher 18:30→**18:00**。触发器已远程更新部署（4 个函数已验证），cloudbaserc.json 已同步。**所有涉及调度角色留意** | ✅ 已推 |
| 2026-08-19 | D/Owner | **拍板：删除首页导航副标题「情报官已为你梳理今日值得关注的进展」**（纯属多余）。已从 components/intel-stage/intel-stage.wxml 移除，导航只留 ‹ 返回 + AI 情报 | ✅ 已推 |
| 2026-08-19 | D/Owner | **拍板：详情页「想试试」→「试试看」+ 引导语气**。① 标签改名已落地（detail.wxml）；② 内容须为轻松引导式推荐（"想体验的话可以试试…"），**非命令式步骤/催促**——前端结构已就绪（.try-guide 浅底容器），文案语气由 P 角色在 intelProcess SOP 生成 minAction 时遵循（COMMLOG 交接，无需改前端）。三页 UI v6 已全部落地（b3bc50e/3c9902a + 本次）：首页卡片流+对你最重要tag+浅蓝底+去来源时间+去今日关注标题、详情页去状态条+来源前置+落到你这里浅蓝底、我的页精简画像+合规；FAB 未动、零新增 hex | ✅ 已推 |
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

## 2026-08-20 · 全系统时间统一北京时间（UTC+8）治理

- **背景**：owner 反馈首页"数据截至 01:36"但新闻已 2 点后——经云端数据库实测，真实抓取是北京时间 09:36，显示成 UTC 01:36（慢 8h）。不是数据问题，是**时区显示 bug**。
- **根因**：云函数（SCF/CloudBase）运行环境时区为 UTC，`getHours()`/`getFullYear()` 等本地读取拿到 UTC 值；此前"数据截至"在云函数端格式化（慢 8h），而新闻卡片时间在前端本地化（正确），造成观感矛盾。
- **治理（统一管理）**：新增 `backend/common/beijingTime.js` 为唯一权威北京时间工具（beijingNow/beijingDateKey/beijingHour/formatHHMM），**存储一律 UTC、显示与北京时间判断一律走 beijingTime**；前端（手机本地=北京）无需转换。
- **修复清单**：① oneNewsChannel dataAsOf 显示（formatHHMM → beijingTime）；② intelFetch 调度档位判断 + 批次日期键（原来错 8h 会误判档位）；③ zhipuSearch 配额日切键（北京 00-08 点配额归错天）；④ newsFetcher/newsPipeline 静默时段（原 Intl 内联实现 → 统一 beijingTime）；⑤ mine 页 consentAt 授权时间（原直接显示 UTC 原始串 → 北京时间格式化）。intelDispatcher 的简报日期归组原本已用北京日期（确认无误）。
- **部署**：intelBrief / intelFetch / refreshNews / newsFetcher / newsPipeline / intelDispatcher（后三者含建索引 intel_current.itemId，顺带落地"详情页慢"治理）。
- **下游**：此后新增时间处理一律走 beijingTime（见 LEARNINGS）。

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
