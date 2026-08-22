# COMMLOG · AI 情报官沟通交接记录

> 倒序（最新在上）。每条：日期 | 角色 | 事项 | 状态/去向。子 Agent 交付后必须在此留痕。
> 详细过程留痕于各交付文档；这里只记「交接点」。

---

| 日期 | 角色 | 事项 | 状态 |
|---|---|---|---|
| 2026-08-20 | A/I | **中文官方源接入：MiniMax 尝试**。注册 minimax_ai（scrape，urlPattern=/blog/），extractListLinks 加遍3（任意链接+锚文本）+ 上下文日期提取；仍有 filtered（日期提取未完全生效/实例缓存），待续调。**已建立的通用机制**：per-source freshnessDays、JSON API adapter（智谱模式）、富文本提取、列表提取遍3、arxiv 限流 5 条 | 🔄 |
| 2026-08-20 | I | **中文官方源首个打通 + 首页数据健康化**。① 智谱 GLM-5.3 全链路进 brief（JSON API + 富文本提取 + per-source freshnessDays=7，high 路由 747 字正文）；② arxiv 修复（Atom content 摘要兜底）+ brief 组装限流 5 条（论文不淹没新闻）；③ Simon Willison 接入（written 3）；④ brief v5 = 15 条：zhipu 1/arxiv 5/simon 3/techcrunch 3/theverge 2/openai 1——来源均衡 | ✅ 已推 |
| 2026-08-20 | A/I | **中文官方源接入进展**：✅ 智谱AI（zhipu_ai）打通全链路——JSON API（/api/articles → title_zh/createAt/content_zh 富文本提取），per-source freshnessDays=7 生效（周更源不被 1 天拒），抓取 written ✓ 处理 okCount ✓（GLM-5.3，7026 字正文）；⚠️ staged 写入静默失败待查（upsertStaged add 可能字段/大小问题）。✅ Simon Willison 已接入（written 3）。❌ 聚合 feed 内容滞后停用。待办：智谱 staged 写入修复、其余中文官方源（通义/火山/混元/MiniMax/Kimi JS 渲染 API 探测）、r/LocalLLaMA/V2EX 反爬 | 🔄 继续 |
| 2026-08-20 | A/I | **源接入第一批结果**：✅ Simon Willison（原生 Atom RSS）接入成功（written 3，正文 3473/1497/529 字完整）；❌ alan-turing-institute 聚合 feed（mistral/ai2/claude/cohere 等 7 个）**内容滞后**（条目 pubDate 保留原日期：mistral 最新 2023-09、claude 2026-04），与「两次抓取间隔/24h 增量」策略冲突全被过滤 → 已停用待源方更新机制确认；🔧 中文官方 6 源（通义/智谱/火山/混元/MiniMax/Kimi）为 JS 渲染需专用解析（Next.js API 端点），列入第二批；r/LocalLLaMA（Reddit 反爬）V2EX（API 空）待调。**教训：聚合 RSS 需先验证内容时效性再接入** | ✅ 已推 |
| 2026-08-20 | I/P | **medium 正文提级 + 重新处理（owner 反馈正文太短）**。① medium prompt：发生了什么 1-2 段 100 字 → **2-3 段 150-300 字** + maxTokens 400→520 + minAccept 15→60；② definition 解析失败时**用摘要/标题兜底**（不误拦截）；③ **重跑流程修正**：重置 ingest 不够——processOne 先查 staged 会 `already-staged` skip，必须**先删 today staged 再重置 ingest 再 process**；④ 已重新处理今天 5 条：正文 90→233 / 150→268 / 153→218 字，brief v3 已发布。**教训：重跑数据处理需清 staged**（记 LEARNINGS） | ✅ 已推 |
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

## 2026-08-21 · UI 基准页（GitHub Pages）建立——UI 改动唯一确认源

- **基准页**：https://tengfeizhao1219.github.io/One-News/（源 ui-demo/，Actions 自动部署）。
- **规则（owner 拍板）**：任何 UI 改动先改基准页 → 确认 → 再落地小程序；禁止临时单页 demo 推翻已确认方案。
- **设计标注**：基准页带标注模式（元素意图 + 代码位置 data-note/data-code），新增元素必须补标注。
- 已纳入《UI 设计准则》§6，Notion 已同步。

## 2026-08-21 · 逐批清理逻辑恢复并验证 + AI 协作门禁机制落地

- **恢复清理**：intelProcess 本批有数据先清旧 staged/非本批 ingest（purgeDone 防误清）、intelDispatcher 发布后清旧 brief 只留一版（purgeOldBriefs）；双副本同步。
- **验证**：手动触发（插测试 pending）→ staged 28→1、ingest 非 pending 33→1，逐批只留本批生效 ✅。
- **门禁机制（防并行覆盖）**：scripts/check_intel.sh（关键逻辑存在性 purgeDone/isMostlyEnglish/purgeOldBriefs + 冲突标记扫描 + 语法）+ .git/hooks/pre-push（push 自动拦截）；文件所有权与修改声明协议已写入协作机制。
- **LEARNINGS**：新增「清理逻辑被并行覆盖」教训条目。

## 2026-08-21 · 调度触发器统一 ADR-10 + 协作纪律确立

- **触发器统一**：config.json 此前未同步 ADR-10（rssPoll 18:00/process 18:10/dispatcher 18:30），已统一为 fetch 17:40 / poll 17:45 / process 17:50 / dispatch 18:00（对齐 cloudbaserc.json 权威 + ADR-10，提交 f5780e7）；已重新部署 3 函数同步云端触发器。
- **生效时间澄清**：新代码部署后对所有后续批次生效（非仅 17:40 档）；今晨 05:00 批次已用新代码（翻译+详情优化）。
- **调度时间表（权威）**：早间 05:10/05:15/05:20/05:30 · 中午 11:10/11:15/11:20/11:30 · 晚间 17:40/17:45/17:50/18:00（fetch/poll/process/dispatch）；intelCleanup 每日 03:00。手动触发：云开发控制台云端测试 或 cloudbase SDK callFunction。
- **协作纪律（owner 拍板）**：⚠️ 多 AI 并行工作——所有改动/调整必须先 `git pull` 拉线上最新、**以线上为准**，再动手；改后立即 commit+push，不留 WIP。

## 2026-08-20 · RSS 源抓取失败定位：云函数外网出口网络异常（非代码 bug）

- **现象**：14:33 后 RSS 源（techcrunch/theverge/reddit/hn/arxiv 等 10 个）全部抓取失败（20s/40s 超时跳过）；仅 7 个官网/中文源正常。批次 0 新增。
- **排查链**：分片触发分批（850f7ea）→ per-source timeoutMs 覆盖（31ae1d5）→ 超时 20s/40s 放宽——均无法让 RSS 完成；单源测试 worker 启动后无后续日志（网络请求挂起）。
- **决定性证据**：本地 curl RSS 源站 **1 秒内 200**（techcrunch 1.08s/theverge 0.98s/arxiv 0.58s）；云端 worker 40s 超时——**RSS 源站网络正常，微信云函数外网出口访问这些源站异常**（数据中心 IP 被限流/网络路径问题）。
- **现状**：7 个官网/中文源（minimax/zhipu/deepseek/the_batch/simon_willison/marktechpost）正常抓取；RSS 源待网络恢复或换通道。
- **已部署**：分批触发 + 超时取较大值 + 40s 超时（对官网源有效）。
- **待 owner 决策**：①接受现状（官网/中文源 + 手动刷新）②排查云环境网络/换源 ③RSS 源改代理通道。

## 2026-08-20 · 0 新增终极根因：worker 单源超时 8s 掐断 RSS（已修复）

- **排查链**：17:40/18:09 批次 0 新增 → 只有 7 个源完成（官网/中文源）→ RSS 大源从不跑 → intelRssPoll 日志显示 `[worker] xxx 超时（>8000ms），本轮跳过`。
- **根因**：`TIMEOUT_BY_TYPE.rss/news = 8000ms`（硬约束 #5 的 Promise.race 掐超时）——RSS 源下载+解析在 8 秒内完不成（网络慢/内容多/5MB 上限），被掐断跳过；api/scrape 15s 同理紧张。快速源（官网/中文）<8s 通过，所以只跑 7 个源。
- **修复**：rss/news/api/scrape 超时统一放宽到 **20s**（云函数 60s 预算内单 worker 处理 1 源，安全）。intelRssPoll 已部署。
- **联动**：intelFetch 分片触发已改分批(5/批)+重试（850f7ea），双管齐下。
- **验证**：需再触发一次手动刷新确认 RSS 源能抓（techcrunch/theverge/reddit/hn/arxiv 等 lastFetchedAt 更新 + ingest 新增）。

## 2026-08-20 · 18:00 批次 0 新增排查：分片触发不完整（owner 反馈"时间更新但无新数据"）

- **现象**：brief 更新到 v13（batch=17:40）但 items 仍 21 条（无新增）；17:40 抓取 0 新增 ingest。
- **根因**：intelFetch 编排一次性 fire 全部源分片（17 个并发 RPC），大量并发导致**部分分片未触发**——17 源只完成 7 个（minimax/zhipu/deepseek 等官网/中文源），**RSS 大源（techcrunch/theverge/hn/arxiv 等）全丢**；完成抓取的 7 源均无新内容 → 0 新增。此为长期存在的分片丢失隐患（历史批次部分源未跑，只是有足够新数据掩盖）。
- **修复**：intelFetch 分片触发改为**分批（每批 5 个并发）+ 失败重试 1 次 + 批间 1s 间隔**，避免瞬时并发打满。
- **部署**：intelFetch 已重新部署。
- **后续**：补跑手动刷新（intelManualRun）补齐 17:40 批次数据。

## 2026-08-20 · 详情页 5 项优化（owner 反馈）

- **① 隐藏侧边滚动条**：detail content 加 `::-webkit-scrollbar{display:none}` + scrollbar-width:none 双保险。
- **② 正文字号统一**：各模块正文（发生了什么/落到你这里/可以怎么做/试试看）统一 28rpx（以"试试看"正文为准）。
- **③ "发生了什么"三段式**：intelProcess prompt 重构——第一段专业解读 → 第二段大白话（是什么/有什么影响）→ 第三段「（AI 预测）」未来影响推测；语言风格贴合内容、句式多样化、脱离八股腔（high 300-550 字 / medium 180-320 字，段落空行分隔）。
- **④ "落到你这里"结构化**：prompt 要求先判断关联性（强相关才写，弱输出「无」前端隐藏），结构清晰（首行点明相关性 + 每行一个使用场景 + 关键加粗）；前端改 rich-text 渲染（支持 **加粗** 与换行分段）。
- **⑤ 乱码修复**：数据含 U+FFFD 替换符（12 条，黑菱形块/问号块）——源头抓取内容编码坏、LLM 照抄；修复=前端统一 cleanText 过滤（detail.js/intelApi.js）+ intelProcess LLM 输入前清洗；存量数据展示即净，新数据处理不再产生。
- **部署**：intelProcess（backend+cloudfunctions 已改）；前端需重新编译。

## 2026-08-20 · 详情页「发生了什么」为空修复（根因：前端字段未透传）

- **症状**：owner 反馈详情页介绍基本都没有（只显示一句话定义）。
- **根因**：`utils/intelApi.js` 的 `formatIntelDetail` 未透传 `whatHappened`（多段正文）——detail.js 新版读取 `d.whatHappened` 恒为 undefined → 前端回退显示 definition（一句话），多段详细叙事丢失。
- **修复**：formatIntelDetail 增加 `whatHappened` + `whatHappenedParagraphs` 透传。
- **附注（数据语义澄清）**：① "数据截至 HH:MM" = 抓取批次时间；条目 publishedAt 凌晨 1:53 = 内容发布时间（源凌晨发布、上午批次抓到），二者不矛盾；② MiniMax 08-03 数据是 per-source freshnessDays=30 故意放行（低频官方源），若需收紧可调。

## 2026-08-20 · 历史数据滚动清理策略落地（owner 拍板）

- **策略**：intel_ingest（fetchedAt）/ intel_staged（processedAt）/ intel_current_archive（archivedAt）三个集合**统一保留近 7 天，滚动物理清除**（按 _id remove 物理删除，非软删）。
- **实现**：新增云函数 `intelCleanup`——每天 03:00 定时触发（触发器 intelCleanupDaily，7 段 cron `0 0 3 * * * *`），分页取「时间字段 < 7天前」的文档（每批 100，循环至清空）逐条物理删除，幂等可重复执行。
- **边界**：intel_current（当前 brief）不在清理范围（同一天覆盖更新 + 旧版归档）；intel_current_archive 也在清理范围（保留 7 天历史归档）。
- **验证**：函数已创建（Active）、触发器已建、invoke 执行成功；当前模块数据均在 7 天内（8-17 启动），无过期数据可删（removed=0 属正常）。
- **部署**：cloudbaserc.json 已注册；intelCleanup 已创建+触发器已配。

## 2026-08-20 · 「发生了什么」内容少 + 英文标题翻译（owner 反馈）

- **问题①「发生了什么」内容少**：根因=`parseSopOut.secBlock` 把段落分隔 `\n{2,}` 压平成单 `\n`，且部分 LLM 输出本就单行——数据库 25 条全部 whatHappened 无换行（1 段），前端按段渲染只有 1 段，观感"非常少"。修复：① secBlock 改为 `\n{3,}→\n\n` 保留段落分隔；② 前端 detail.js 新增 `smartSplitParagraphs` 智能分段兜底（无换行长文按句号断句，每 2 句一段），历史数据立即多段展示。
- **问题② 英文源标题未翻译**：whatHappened/definition 已是中文，但 `title` 保持英文原文（25 条中 24 条英文标题）。修复：intelProcess 处理层在 LLM prompt 的 JSON 输出新增 `titleCn`（中文标题，medium+high 两路径都加），解析后 `staged.title = titleCn`（前端零改动显示中文标题），原文存 `sop.source.titleEn`。
- **部署**：intelProcess（backend+cloudfunctions 已改）需重新部署；前端 detail.js 需重新编译。
- **历史数据**：已存 25 条无 titleCn（标题仍英文）——前端智能分段已生效；待下次手动/自动管线处理新数据后标题自动中文。

## 2026-08-20 · 策略修正：下拉刷新不触发手动管线，手动刷新需 owner 明确指令

- **修正**：下拉刷新**只重新拉取最新 brief**（不触发抓取/处理/发布管线）；手动全量管线 `intelManualRun`（抓取→处理→立即发布）**仅在 owner 在对话中明确说「手动刷新/手动更新」时**由 AI/外部触发，不绑定任何前端手势。
- **原因**：下拉刷新触发完整管线会频繁抓取+LLM 处理（烧成本），且等待 2-3 分钟体验差；手动触发是低频、明确的意图操作。
- **实现**：home.js / intel-stage.js 的 onRefresh 恢复为仅 `_loadBrief()`；`intelManualRun` 云函数保留（超时 300s），供 owner 明确指令时调用。
- **用法**：owner 说「手动刷新」→ 调用 intelManualRun（完整流程，约 2-3 分钟）→ 完成后下拉或重新进入即见最新数据。

## 2026-08-20 · 手动全流程管线（intelManualRun）+ 下拉刷新策略升级（owner 拍板）

- **策略**：保留 05/11/18 三个自动发布窗口；任何「手动触发」的数据更新不受自动发布机制影响——只要触发就按完整流程完成：抓取(intelFetch) → 处理(intelProcess) → **立即发布**(intelDispatcher)，不等下一个定时窗口。
- **实现**：新增云函数 `intelManualRun`（编排：触发 fetch → 等 90s（分片 60s 预算）→ 触发 process(force) → 等 60s（BATCH_LIMIT=10/批）→ 调 dispatcher(force) 立即发布；超时 300s）。前端下拉刷新改为触发该管线 + 拉最新 brief，**5 分钟节流**防频繁下拉烧 LLM；两处（独立页面 + 右滑面板）同步。
- **发布闸门本质**：Dispatcher 定时触发（05:30/11:30/18:00）才是"发布窗口"；手动调 Dispatcher(force) 即立即发布当前已处理内容。
- **部署**：intelManualRun（新建）+ 前端重新编译。
- **下游**：手动触发后约 2-3 分钟数据全量更新；重复下拉在节流窗口内只拉 brief 不重复跑管线。

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
## 2026-08-20 · 四项成本/稳定性优化（owner 拍板执行）

- **① 停用海外受限源**（云环境国际出口慢/超时）：数据库 11 个源 enabled=false + retireReason 留痕（ahead_of_ai/bens_bites/google_deepmind/google_news_ai/huggingface_blog/import_ai/product_hunt/reddit_singularity/the_rundown_ai/tldr_ai/venturebeat_ai）；seedSources.js 两副本同步 15 个海外源 defaultOn=false（含此前已 retired 的 techcrunch/theverge/arxiv/hacker_news），防重播种复活。保留云端可达的海外源（marktechpost/the_batch/simon_willison/openai_blog/latent_space/lesswrong）。启用源从 22 → 11。
- **② seedSources 播种只读**：seed() 开头 `col.count()` 非空即跳过（return { inserted: 0, skipped: cnt.total }），省每 worker 28 次读（种子已存在时零成本）。
- **③ health 记录**：确认本就「仅异常写」（errorStreak 达标/高重复/批量/高过滤四类才写），无需改动。
- **④ 前端 brief 缓存**：utils/intelRequest.js getIntelBrief 加 5 分钟内存缓存 `_briefCache`（仅当期 date 缺省时命中；下拉刷新不破缓存，TTL 过期自动失效），省重复 Gateway 调用。首次注入破坏 .then 链（SyntaxError），重构为 const data 后写缓存再 return 修复。
- 产物：intelRssPoll 已重部署（含 seedSources 优化）；前端需微信开发者工具重编译。
- 下游：下一轮定时器（05:30/11:30/18:00）只抓 11 个启用源；海外源内容由国内/官网源 + 保留海外源覆盖。
## 2026-08-20 · 情报收藏功能（owner 拍板：对齐 One News 纯本地逻辑，半年滚动清除）

- **需求**：用户在情报详情页对感兴趣文章加入收藏夹；采用 One News 一样的逻辑——收藏到手机本地缓存（wx Storage），按半年区间滚动清除。
- **落地**：
  ① `utils/intelFavorites.js`（新增）：localCache 单例存储（key=intelFavorites，与 One News 的 favorites 隔离），数组 + 条目级 expireAt=半年（180 天），读取时惰性剔除过期并回写（滚动清除），容量上限 200（对齐 One News），API：getFavorites/isFavorited/toggleFavorite/removeFavorite。
  ② 详情页：导航栏右侧收藏按钮（♡/♥ 双态，favorite-fill 固定红心；空态/加载态隐藏），heartAnim 心跳动画复用 One News keyframes。
  ③ mine 页：新增「我的收藏」入口卡片（收藏数 + 半年保留说明）→ 收藏列表页。
  ④ `pages/intel/favorites/`（新增）：收藏列表（标题/来源/时间/摘要），点击进详情（复用 intelDetailCard 透传），红心取消收藏，空态引导。
  ⑤ app.json 注册新页面。
- **验证**：node 冒烟测试 7 项全过（空态/收藏/取消/倒序/半年过期滚动清除+回写/移除/容量满）。
- **注意**：并行会话 v5.1 提交（6efb6c2）把 detail 三件套 + intelFavorites.js + favorites 页 js/json/wxml 一并带入；本提交（8991706）补齐 mine 入口 + 列表页 wxss + app.json。前端需微信开发者工具重编译。
## 2026-08-20 · 收藏入口 v2：右上角 → meta 时间后（owner 反馈：右上角撞原生胶囊）

- **owner 反馈**：收藏按钮放详情页右上角会与微信原生胶囊重叠冲突；建议移到新闻详情页时间后面，做成不鲜艳的入口，样式参考 One News。
- **落地**：
  ① detail.wxml：删除导航栏右侧 nav-fav 按钮；meta 行（来源/时间）后新增收藏入口——One News 风格小图标(32rpx) + 小字 label；meta 行条件从 `{{srcName || pubTime}}` 改为始终显示（真实数据块内），保证无来源/时间时收藏入口仍在。
  ② detail.wxss：删 nav-fav 样式；新增 meta-fav——未收藏=主题色描边心(跟随深浅色)+灰字「收藏」，已收藏=固定红心+红字「已收藏」；hover 浅底；heartBeat 动画保留。
  ③ demo：`~/Desktop/Deepseek/ui-preview/detail-fav-demo.html` + 亮/暗 PNG（未收藏/已收藏 4 态，含原右上角冲突位置红字示意）。
- **未动**：detail.js 收藏逻辑（onToggleFavorite/_checkFavorite 与入口位置无关）。
- 下游：微信开发者工具重编译查看效果；demo 确认后合入。
## 2026-08-21 · 情报管线触发器漂移修复（owner 拍板：只修情报管线，其它展示不管）

- **漂移发现**（对比线上 mcporter 实查 vs cloudbaserc/config.json 权威）：intelProcess 早/午档被改成 05:25/11:25（权威 05:20/11:20）、intelDispatcher 被改成 05:40/11:40（权威 05:30/11:30），疑并行会话直接改线上未同步。
- **修复**：删除漂移触发器（intelProcess0525/1125、intelDispatcher0540/1140），按权威 cron 重建。**踩坑**：mcporter `createFunctionTrigger` 是整体替换语义（传列表会清掉该函数其它触发器），首两次单档重建导致晚间档 1800 丢失，最终一次性传全部 3 档（早/午/晚）重建成功。
- **线上最终（北京时间）**：intelProcess 05:20/11:20/17:50；intelDispatcher 05:30/11:30/18:00——与 cloudbaserc/config.json 一致。
- **未动**：newsFetcher/rssFetcher/newsPipeline 触发器（owner：其它展示不管）；intelFetch/intelRssPoll/intelCleanup 本已一致。
## 2026-08-21 · newsFetcher/rssFetcher 夜间停跑 cron 修复（owner 拍板：按北京时间）

- **背景**：并行会话 5561cd2 将主链路 cron 改为 `0 0 0-14,22-23` 意图"北京 23:00-05:00 夜间停跑"，但该 cron 是**按 UTC 换算**的；SCF 定时触发器实际**按北京时间解析**（依据：intelDispatcher MODE_HOURS={5,11,18} 与触发器小时位吻合 + COMMLOG 权威时间表 + intelCleanup 03:00 语义），导致实际停跑时段 = **北京 15:00-21:00（下午黄金时段断更）**，与意图相反。
- **修复**：cron 改为 `0 0 6-22 * * * *`（北京时间 06:00-22:00 每小时触发，23:00-05:00 夜间停跑）。
- **同步**：线上触发器已重建（newsFetcher hourlyFetch / rssFetcher rssPoll，09:29 生效）；cloudbaserc.json + cloudfunctions/rssFetcher/config.json 已同步；newsFetcher config.json 触发器本就为空（由 cloudbaserc 部署），无需改。
- **注意**：newsFetcher 代码内还有北京 01:00-05:00 静默时段兜底（QUIET），夜间停跑双保险。
- 下游：06:00 起恢复每小时抓取；23:00-05:00 完全停跑省资源。
## 2026-08-21 · 移除 AI 前截断（owner 决策：截断时机不对，先记下）

- **决策**：去掉 stageAi 前的 `truncateStagingByCategory` 物理截断（原逻辑在 AI 前按分类 top-N 删除 staging pending，recommend≤15/其余≤8，收敛 ≤47）。
- **理由（owner）**：截断不应发生在这个时间节点——质量门已筛选，此时物理删除会把"够格 AI 的内容"静默丢弃。
- **新逻辑**：全部过质量门的条目都进 AI 加工；最终由 publish 的 `applyCategoryCaps`（注入 news_cache 前软截断，recommend≤15/其余≤8）收敛到展示上限。cache 展示量不变（≤47），但 AI 加工范围扩大。
- **代码**：stageAi 移除调用（函数定义保留备用）；newsPipeline 已部署。
- **注意**：此改动后 staging 可容纳超过 47 条 pending（此前会被截断），AI 阶段工作量可能增大；publish 前 applyCategoryCaps 仍保证 cache ≤47。
## 2026-08-21 · 首页卡片时间改绝对时间（owner 决策）

- **需求**：首页卡片展示时间改为「新闻源抓取的绝对时间」，格式 月/日 时:分。
- **改动**：
  ① utils/util.js 新增 `formatAbsoluteTime(dateStr)` → "8/21 14:05"（MM/DD HH:mm，无效输入返回空串）；
  ② utils/request.js `time` 字段：`formatRelativeTime(item.createdAt || ...)`（相对时间，优先 createdAt 落库时刻）→ `formatAbsoluteTime(item.publishTime || item.createdAt || item.time)`（绝对时间，优先新闻源 publishTime）。
- **说明**：publishTime 在 newsPipeline Stage 1 已归一化为毫秒时间戳（优先源 pubDate，缺失回退抓取时间），前端按设备本地时区渲染（中国用户=北京时间）。
- 下游：微信开发者工具重编译后生效（纯前端改动，无需部署云函数）。
## 2026-08-21 · 恢复 AI 前分类 Top N 截断（owner 复核决策）

- **决策**：撤销 549e713 的移除，恢复 `truncateStagingByCategory` 在 stageAi 前执行（AI 前按分类 finalScore 降序截断：recommend≤15/其余≤8，超限物理删除 staging pending，收敛 ≤47）。
- **原因（owner 复核）**：截断仍需在 AI 加工前进行，控制进入 AI 与落库的量；549e713 的"改由 publish applyCategoryCaps 软截断"方案被否。
- **代码**：stageAi 恢复调用（含 try-catch 放行）；newsPipeline 已部署。
- **状态**：publish 的 applyCategoryCaps 仍保留（注入 cache 前二次软截断，双保险），但 AI 前截断为主机制。
## 2026-08-21 · 详情页首帧完整解读（方案A：列表透传全文）

- **问题**：进详情页先显示 AI 摘要，~0.5s 后刷新为 AI 解读——因为列表只带 summary，reading-engine 先用摘要秒开渲染，后台 getNewsDetail 返回完整 content 后 onDetailRefresh 覆盖。
- **方案 A（owner 拍板）**：getNewsList 透传完整 AI 解读正文 content + aiOpinion，reading-engine base.content 优先用列表全文 → 首帧即完整解读，无加载过程。
- **改动**：
  ① cloudfunctions/getNewsList：返回 content + aiOpinion（已部署）；
  ② utils/request.js：getNewsList 调 formatNewsItem(item, true)（列表带全文）；
  ③ pages/detail/reading-engine.js：base.content 用 cur.content（列表全文），aiOpinion 一并带入。
- **验证**：news_cache content 已是完整解读正文（如候鸟 399 字 vs summary 145 字）；resolveContentText 对 ai_interpretation 返回 content。
- 下游：前端需重编译；后台 getNewsDetail 刷新仍保留（补 references/合规字段增量）。
## 2026-08-22 · One News 推荐分类空 + 推送"失败"排查修复

- **现象**：① 推荐分类经常 0 条；② 22:40 后真机刷新无新数据。
- **排查**：
  ① news_cache 22:40 批次 recommend=0，来源仅 IT之家/中华/新华——推荐源被自动暂停（status=disabled + errorStreak 3~5），`listDueFeeds` 直接跳过，永不抓取；
  ② 定时器 `0 0 6-22`（北京 06:00-22:00 每小时）——23:00/00:00 不触发属设计（owner 拍的夜间停跑），非故障；
  ③ 36氪 RSS 全端点被 JS challenge 反爬（返回 17KB HTML 壳），本地 curl 各 UA 均无法绕过 → errorStreak=5 → disabled，**不可恢复**；
  ④ 虎扑 RSS 依赖第三方代理 decemberpei.cyou，间歇可用（恢复后抓到 9 条）。
- **修复**：数据库恢复 6 源 active + errorStreak=0（中新网 finance/edu/sports/culture/society + 虎扑）；手动触发 newsFetcher（42 源）→ 中新网全部正常（finance 30/edu 14/sports 30/culture 30/society 29）；推进 newsPipeline → publish 完成。
- **验证**：news_cache 47 条满配（recommend 15 / 其余各 8），第一条「美国政府紧急下场救市难解美债危局」，来源多样（中新网 15/IT之家 16/新华 4 等），staging 清空 idle。
- **遗留**：36氪 建议从源列表移除或标记永久停用；虎扑第三方代理不稳定需留意；"errorStreak 达上限即永久停用"的机制可考虑改为定时自动重试。
## 2026-08-22 · 话题搜索深挖功能平移至 One News 详情页

- **需求**：把 intel（AI 情报官）详情页的「联网搜索深挖」功能原模原样平移到 One News 详情页。
- **改动**：
  ① intelSearch 云函数：支持 `event.context`（{title, what, srcName}）——One News 新闻不在 intel_staged/intel_current，前端直接传新闻标题+摘要跳过查库；intel 场景无 context 回退原 itemId 查库（已部署）。
  ② pages/detail/detail.js：搜索方法全量平移（onToggleSearch/搜索面板手势/onDeepQuick/onSearchSubmit/_runSearch/_parseSearchAnswer/深挖历史 _loadDig/_saveDig/_pushDigEntry/onToggleDigGroup/onToggleEntrySources/onOpenSource）；_renderDetail 设 searchQuickTitle（一键深挖标题）；onTouchEnd 面板展开时只收起不翻页。
  ③ pages/detail/detail.wxml：搜索面板（一键深挖+搜索框+进度线+深挖历史分组+参考来源）+ FAB 悬浮搜索按钮。
  ④ pages/detail/detail.wxss：64 行搜索样式平移（含 nav-light/dark 双主题图标）。
- **适配点**：One News 无 itemId → context 传参；selector 用 .nav-bar 替代 .panel-header；深挖历史 key 用 news_dig_history_<id> 隔离。
- **依赖**：intelSearch 已部署且 env 齐全（Tavily/DeepSeek/智谱/DashScope）。
- 下游：微信开发者工具重编译验证。
## 2026-08-22 · One News 深挖报错修复（context 透传缺失）

- **现象**：One News 详情页深挖提示"缺少参数 itemId/query"。
- **根因**：utils/intelApi.js `searchIntelTopic({itemId, query})` 只透传 itemId/query，把前端传的 `context` 丢弃 → 云函数收到 {query} 无 itemId 无 context → BAD_PARAM。
- **修复**：wrapper 参数解构加 `context` 并透传（data: {itemId, query, context}）；云函数 context 分支此前已部署，无需改。
- 下游：前端重编译生效（utils 变更无需部署云函数）。
## 2026-08-22 · 【自主迭代 R1】newsFetcher 自动暂停源自动恢复机制

- **问题**：源连续 3 轮入库 0 → 自动暂停(disabled)后**永久不抓**（无恢复机制），本轮曾因推荐源 disabled 导致推荐分类空。
- **方案**：暂停时记录 `disabledAt`；`listDueFeeds` 对 disabled 源做冷却期(24h)判定——超过则重置 active+errorStreak=0 重新探测一轮，源恢复则重新接入、仍失败则再暂停（不无限重试）。
- **兼容**：旧数据无 disabledAt 回退 lastFetchTime；两者皆无视为暂停已久直接探测。
- **验证**：5 个边界用例全过（刚暂停不恢复/超冷却恢复/旧数据兼容/无时间直接探测）。
- **部署**：newsFetcher 已更新。
## 2026-08-22 · 【自主迭代 R2】停用 36氪 死源（RSS 反爬不可恢复）

- **问题**：36氪 RSS 全端点被 JS challenge 反爬（返回 17KB HTML 壳），每轮仍被抓取白耗资源。
- **处理**：seedFeeds.json kr36_tech enabled=false + retireReason 留痕；线上 feed_meta 同步停用。虎扑加注释（第三方代理间歇可用，靠 R1 自动恢复机制兜底）。
## 2026-08-22 · 【自主迭代 R3】翻页切新闻时重置搜索态

- **问题**：One News 详情页翻页（上滑/下滑）切到新新闻后，搜索面板的深挖历史仍是上一条的（数据串台）。
- **修复**：_swipeToNext 开头调 _resetSearchForPageChange——收起面板 + 清空 digGroups/searchQuery/hint/loading + 复位 _searching 标志。
## 2026-08-22 · 【自主迭代 R4】抓取/解析失败源冷却重试（防每轮白抓）

- **问题**：fetch_error/parse_error 分支只更新 lastFetchStatus 不更新 lastFetchTime → 失败源每轮 listDueFeeds 仍判 due → 每轮重试失败源（浪费云函数调用）。
- **修复**：失败分支更新 lastFetchTime（按 pollSeconds 冷却）+ errorStreak 累计；连续 3 次失败自动暂停（进入 R1 的 24h 冷却恢复机制，闭环）。
- **语义**：fetch/parse 失败（源不可达/格式坏）比"抓到但空内容"更重——前者 3 次即暂停，后者沿用 3 轮入库 0 暂停。
- **部署**：newsFetcher 已更新。
## 2026-08-22 · 【自主迭代 R5】rssFetcher 同步 R1/R4 修复

- **问题**：rssFetcher（One News 旧 RSS 链路）与 newsFetcher 同构但缺两处修复：①fetch_error 不更新 lastFetchTime → 失败源每轮重试；②disabled 无自动恢复。
- **修复**：feedStore.js 整体同步（含 R1 自动恢复机制）；fetch_error 更新 lastFetchTime 冷却（保留"网络失败不累计 errorStreak"原语义）；disabled 分支记录 disabledAt。
- **部署**：rssFetcher 已更新。
## 2026-08-22 · 【自主迭代 R6】brief 缓存失效接口 + 回首页自动失效

- **问题**：getIntelBrief 5 分钟内存缓存无失效接口——手动刷新（intelManualRun）完成后前端仍可能看到旧 brief，违背"手动触发即完整流程"语义。
- **修复**：intelRequest.js 导出 `invalidateIntelBrief()`（清 _briefCache）；intel home onShow 时调用（每次回首页强制拉最新，缓存仍防同页面高频重复请求）。
## 2026-08-22 · 【自主迭代 R7】深挖历史 storage 全局上限（防超限静默失效）

- **问题**：深挖历史每条新闻独立 storage key（news_dig_history_<id>/intel_dig_history_<id>），单条有 10 话题×10 次上限但**新闻数无上限**——翻页几百条后 storage 超 10MB，wx.setStorageSync 抛错被静默 catch，功能静默失效。
- **修复**：_saveDig 写入后做全局清理——保留当前 key + 最多 200 个深挖历史 key，超限删多余（One News + intel 两处）。
## 2026-08-22 · 【自主迭代 R8】publish 注入失败保留 staging 重试

- **问题**：stagePublish 先 wipeNewsCache 全清再 batchInsert——若 batchInsert 抛异常（集合异常等），cache 已空、staging 已删，数据双丢失，前端空首页。
- **修复**：batchInsert 外包 try/catch——失败时 staging 保留（不 removeStaged）+ trigger('publish') 下一轮用同批 done 重试，避免"cache 空 + staging 丢"。
- **部署**：newsPipeline 已更新。
## 2026-08-22 · 【自主迭代 R9】getNewsList 组合索引失败降级单字段排序

- **问题**：queryCache 组合索引（finalScore desc, createdAt desc）缺失/异常时链式 orderBy 抛错 → 整页查询失败；stale 兜底只覆盖"空结果"不覆盖"查询抛错"。
- **修复**：链式排序包 try/catch，失败降级单字段 createdAt desc（排序精度降级优于整页失败）。
- **部署**：getNewsList 已更新。
- **提醒**：news_cache 组合索引需云开发控制台手动建（wx-server-sdk 4.x 不支持 createIndex）；线上实测排序正常（索引已存在）。
## 2026-08-22 · 【自主迭代 R10】下滑翻页也重置搜索态（补 R3 遗漏）

- **问题**：R3 只在 _swipeToNext（上滑下一条）重置搜索态，_swipeToPrev（下滑上一条）遗漏——下滑翻页后深挖历史仍串台。
- **修复**：_swipeToPrev 开头同样调 _resetSearchForPageChange。
## 2026-08-22 · 【自主迭代 R11】深挖搜索上下文增强（摘要+正文）

- **问题**：One News 深挖传 `what: news.summary || news.content` 优先摘要——摘要过短时相关性判断（judgeRelevance）信息不足可能误判不相关。
- **修复**：摘要完整保留 + 正文补充至合计 ≤400 字（云函数再截断；优先保摘要）。
## 2026-08-22 · 时间格式统一为绝对时间（owner 拍板）

- **需求**：首页卡片已改绝对时间（MM/DD HH:mm），但详情页元信息行/收藏页/反馈页/intel 列表仍用相对时间——同一新闻多处时间显示不一致。
- **改动**（5 处全部 formatRelativeTime → formatAbsoluteTime）：
  ① pages/detail/reading-engine.js：详情页元信息行 time；
  ② pages/favorites/favorites.js：收藏列表 _time（收藏时刻）；
  ③ pages/feedback/feedback.js：反馈列表时间；
  ④ utils/intelApi.js：intel 列表项 time + 详情 processedTime。
- **保留**：utils/util.js 的 formatRelativeTime 定义（浏览记录等内部仍可能用，未删）。
- 下游：微信开发者工具重编译生效（纯前端）。
## 2026-08-22 · One News 深挖 UI 完全对齐 intel 版（4 处）

- **① 推上动画**：正文 scroll-view 加 `search-push-up`（translateY(-100%) 0.65s 推上）；js 改为**先量标题位置再推上**（避免 translateY 漂移导致面板 top 错位）。
- **② 输入框高度**：search-input 对齐 intel（padding 12rpx + line-height 2.1），按钮 56rpx，search-box gap 20rpx。
- **③ 搜索中动画**：search-btn.is-loading + search-blue 图标 + searchSweep 摆动动画（1.1s infinite）。
- **④ 深挖历史在正文底部**：正文 scroll-view 内新增 `#dig-history` 区（始终显示，含空态提示"还没有深挖记录"），与面板内 dig-list 并存（对齐 intel：面板展开看 dig-list，收起看正文 dig-history）。
- **样式**：搜索样式整段替换为 intel 版完整样式（含 .rest 推上 + nav-light/dark 主题切换）。
## 2026-08-22 · 深挖历史展开后触底翻页修正

- **问题**：One News 正文底部深挖历史展开时，内容变长但 `_isAtBottom` 标志残留（展开前触底置位）→ 展开后立即上滑就翻页，未滚到新页面底部。
- **修复**：onToggleDigGroup 展开分组时重置 `_isAtBottom=false` + `_needsSecondSwipe=true`——用户必须重新滚到新的页面底部才触发翻页（遵循"滑到页面底部才翻页"的既有语义）。
- **说明**：intel 版深挖历史在搜索面板内（面板滚动与正文翻页解耦），无此问题；One News 在正文内需此处理。
