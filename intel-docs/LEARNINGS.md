# LEARNINGS · AI 情报官教训库

> **目的**：让每个踩过的坑都变成可检索的经验，**同一个坑绝不踩第二次**。
> **规则**：任何修复/返工（≥2 次尝试或 ≥1 小时）完成后，当次必须追加一条；新阶段/新模块开工前必读。
> 本库由 ai-collab v2 升级时（2026-08-19）从 COMMLOG 历史提炼，后续由修复者本人维护。

---

### [2026-08-21] 逐批清理逻辑被并行覆盖丢失（多 AI 协作/流程）

- **症状**：历史数据（旧 staged/ingest/current 多版本）持续累积，旧数据混入新 brief（今天 brief 混入 5 条英文旧定义）；intel_current 残留 v16/v23/v4 三版。
- **根因**：08-19 已实现「逐批只留本批」清理（b172858：process 清旧 staged/非本批 ingest、dispatcher 清旧 brief 只留一版），但**多 AI 并行改同一文件 intelProcess/index.js**——另一分支基于无清理的旧版本开发，合并/rebase 后**清理代码被静默覆盖**。且**删除/清理类逻辑缺失不报错**（无测试、无存在性校验），丢失无人察觉，直到数据累积暴露。
- **正确做法**：
  1. **关键静默逻辑（清理/翻译/兜底）必须有存在性校验**——已落地 `scripts/check_intel.sh`（purgeDone/isMostlyEnglish/purgeOldBriefs 等关键字检查）+ `.git/hooks/pre-push`（push 自动拦截，任何 AI 无法绕过）。
  2. 共享文件（intelProcess/intelDispatcher/intelFetch 等）改动后，push 前自查清理逻辑是否仍在。
  3. 部署后验证生效（触发一次看数据变化），不信"部署成功"。
- **涉及角色**：I / P / O / 所有并行 AI

### [2026-08-20] 云函数时区坑：SCF 环境是 UTC，本地时间读取错 8 小时（时间/时区）

- **症状**：首页"数据截至 01:36"但新闻已 2 点后——数据其实最新（北京 09:36 抓取），纯显示错位。
- **根因**：云函数（腾讯 SCF/CloudBase）运行环境时区 = **UTC**。`new Date().getHours()`、`getFullYear()`/`getMonth()`/`getDate()` 返回的是 **UTC 值**（比北京时间慢 8h）。在云函数里做时间"显示"或"判断"（调度档位、配额日切、日期归组）都会错 8 小时。
- **正确做法**：① **存储一律 UTC**（`toISOString()`/epoch ms）；② **显示与北京时间判断一律用 `backend/common/beijingTime.js`**（beijingNow/beijingDateKey/beijingHour/formatHHMM，内部按东八区投影）；③ 前端小程序运行时区=用户手机（中国 +8），本地即北京，前端 `new Date(iso).getHours()` 正确；④ 新写云函数代码一律 `require('./beijingTime')`，禁止裸用 getHours/getFullYear。
- **涉及角色**：I / P / Q

### [2026-08-20] LLM 输出分段被解析压平 + 英文标题未翻译（数据处理/解析）

- **症状**：详情页「发生了什么」只有一段（观感少）；英文源标题未翻译。
- **根因**：① SOP 解析 secBlock 用 `replace(/\n{2,}/g,'\n')` 把 LLM 输出的段落分隔（空行）压成单换行，前端按空行分段只剩 1 段；② LLM prompt 未要求输出中文标题，`title` 保持英文原文。
- **正确做法**：① 解析保留段落分隔（`\n{3,}→\n\n`），前端对无换行长文做智能分段兜底（按句号断句每 2 句一段）；② 处理层（intelProcess）prompt 要求 LLM 输出 `titleCn`（中文标题）存为主标题、原文存 `sop.source.titleEn`，展示层零改动。
- **涉及角色**：P / D / Q

## 教训条目（倒序，最新在上）

### [2026-08-20] 重跑数据处理必须先清 staged（否则 already-staged 跳过）（流程）

- **症状**：重置 ingest 为 pending 后触发 intelProcess，条目不重新生成（staged 内容不变）。
- **根因**：processOne 开头 `findStaged(itemId)`——条目已在 intel_staged 则直接 `skip: already-staged`，不重跑 SOP。重置 ingest 状态无效。
- **正确做法**：重跑某批数据 = ① 删对应 intel_staged（where publishDay/title）→ ② 重置 ingest → pending → ③ 触发 intelProcess（会重新生成）→ ④ 触发 intelDispatcher 重组装。
- **涉及角色**：I / P


### [2026-08-19] 三元表达式空指针：`profile && a ? b : (profile.c ? …)`（代码）

- **症状**：intelDispatcher 发布崩溃 `Cannot read properties of null (reading 'depth')`，今日 18:00 批次卡在 staged 未发布。
- **根因**：`const highTh = profile && profile.depth === 'deep' ? 3 : (profile.depth === 'lite' ? 5 : 4)`——profile 为 null 时第一个分支为 false，但 else 分支仍访问 `profile.depth` → 空指针。
- **正确做法**：三元表达式若前置条件含 null 判断，else 分支必须重复判空：`profile && profile.depth === 'deep' ? 3 : (profile && profile.depth === 'lite' ? 5 : 4)`；或改用 if/else。调用方 `score(d, null)` 传 null 是合法场景，被调用方必须容错。
- **错误路径**：以为是部署问题反复重试（部署后旧实例未刷新的干扰）；实际先看堆栈定位代码逻辑。
- **涉及角色**：I / P


### [2026-08-19] 部署"成功"≠"生效"：首次部署未生效，需验证后确认（部署/验证）

- **症状**：cloudbase 部署 intelFetch 后日志仍是旧格式（`staged=3 brief=1`），功能未生效。
- **根因**：部署动作完成 ≠ 新代码实际加载；无生效验证步骤就标记完成。
- **正确做法**：部署后必须验证生效（看新格式日志/接口实测/对比输出），验证通过才算完成；"部署成功"只算"已提交"。
- **错误路径**：第一次部署后直接信"部署成功"，第二次重部署才发现问题。
- **涉及角色**：I / Q

### [2026-08-19] 历史数据清理漏了 raw 层（intel_ingest），跨天旧文复活（数据）

- **症状**：首页显示"今天 22:00"，实际是昨天（8/18）的数据。
- **根因**：两层问题——① 显示层 `formatLabel` 无条件返回"今天 HH:MM"，忽略 publishedAt 实际日期；② 数据层历史清理只清 `intel_staged`+`intel_current`，**漏清 `intel_ingest`（raw 层）**，旧文仍被 `freshnessDays:7` 窗口捞进本轮 brief。
- **正确做法**：清理/改动涉及多数据层时列「影响面清单」（raw/staged/current/brief 全链路）；显示层做日期边界处理（当天→"今天 HH:MM"，跨天→"MM-DD HH:MM"）。
- **涉及角色**：P / D / I

### [2026-08-19] 首页底部遮挡：修了 4 次才找到根因（前端/微信小程序）

- **症状**：首页滚动到底，最后卡片被底部遮挡。
- **根因链**：① `scroll-view` 的 `padding-bottom` 是已知坑——不撑开可滚动区域（前 2 次白修）；② 换普通 `view`+padding 后仍遮挡——真正根因是 `.intel-home` 用 `height:100vh`，iOS 会把底部手势条安全区计入，内容落到系统区之下。
- **正确做法**：微信小程序容器高度用 `windowHeight`（`--page-h`，One News 首页同款做法），不用 `100vh`；滚动容器用普通 `view` + `overflow-y:auto` 而非 `scroll-view`（需要时可加实体 spacer 双保险）。
- **错误路径**：加 padding → 加 spacer → 换 scroll-view，全是症状级修复。
- **涉及角色**：D

### [2026-08-19] position:fixed + transform 元素仍部分可见（前端/微信 WebView）

- **症状**：首页一打开有米白底部遮罩，改透明度只解决窄条。
- **根因**：微信 WebView 中 `position:fixed` + `transform:translateX(-100%)` 的元素仍部分可见，遮罩根源是覆盖层本身。
- **正确做法**：非激活态用 `visibility:hidden` + `pointer-events:none`（配 transition 延迟切换，进入立即 visible、退出等动画结束再 hidden）。
- **涉及角色**：D

### [2026-08-19] 占位卡"（定义待补充）"：下游兜底掩盖上游缺陷（数据处理）

- **症状**：首页出现 4 条「（定义待补充）」占位卡（rank 4/10/11/12）。
- **根因**：处理层写 staged 前不校验「一句话定义」，空 SOP 仍入库 → 调度层用占位文案兜底，掩盖了上游缺陷。
- **正确做法**：**质量闸门前置**——写 staged 前强校验 `parsed.definition` 必填，空则 `markIngest rejected{reason:'definition-empty'}` 留痕、不进今日关注；调度层再做降级剔除双保险（`degraded` 标记）。
- **涉及角色**：P / D

### [2026-08-18] 分支策略定晚：intel-officer 退役并入 main，三副本手动同步（Git/流程）

- **症状**：分支切换后 WorkBuddy / Desktop / One-News-latest 三副本全要手动切 main。
- **根因**：分支策略（main vs feature）未尽早拍板，feature 分支积累后才迁移。
- **正确做法**：分支策略在 Phase 0 就 owner 拍板写入 ADR；多副本场景靠 git 守护 + 统一 remote，减少手动同步。
- **涉及角色**：O / I

### [2026-08-18] GitHub DNS 劫持：沙箱内 github.com 被解析到错误 IP（环境）

- **症状**：git clone/push 到 github.com TLS 失败。
- **根因**：DNS 将 github.com 解析到错误地址（劫持/污染）。
- **正确做法**：`/etc/hosts` 写入真实 IP（140.82.113.4 github.com codeload.github.com api.github.com）或 `git -c http.curloptResolve=github.com:443:140.82.113.4`；注意沙箱重启会还原 hosts。
- **涉及角色**：I / O

### [2026-08-18] intel-stage 字体档位不跟随：isolated 下父级 CSS 变量穿透失败（前端）

- **症状**：用户改字号档位，情报屏不跟随。
- **根因**：组件 `isolated` 隔离下父级 `--font-scale` 变量穿透不进来。
- **正确做法**：组件加 properties（fontScaleValue/metaScaleValue）+ observer 显式传值，不依赖 CSS 变量穿透。
- **涉及角色**：D

## 2026-08-20 MiniMax 接入收官
- **per-source minContent**：官方动态（MiniMax 官方 blog）summary 仅 30 字，被空壳闸门（minContent 60）拒。官方一手信息价值 > 空壳风险，源级配 minContent 20 放行。实现：intelRssPoll 抓取时 meta 带 minContent → ingest 写 minContent；intelProcess gateCfg 优先 item.minContent。
- **per-source freshnessDays 必须贯穿到 dispatcher**：intelProcess 用 freshnessDays=30 放行 8/3 的 MiniMax H3，但 intelDispatcher passFreshness 硬编码 7 天把它挡在 brief 外——低频官方源语义断链。修复：staged 透传 freshnessDays，passFreshness 优先 d.freshnessDays，默认仍 7 天。
- **跨函数未定义变量**：processOne 引用 parsedTitleCn（parseSopOut 的局部变量）→ ReferenceError 崩溃。parseSopOut 需显式 return 该字段。
- **旧 rejected ingest 挡新抓取**：guid 查重跳过，重抓前必须删旧 ingest + 清 lastSuccessCursor（或重置 pending）。

## 2026-08-20 社区源接入（HN 恢复 + LessWrong）
- **HN quality 0 根因**：Algolia 全量高赞故事（points>100）10 条全 low 与场景无关 → 自动退休。恢复：`query=AI&tags=story&numericFilters=points>50&hitsPerPage=12`，AI 命中率大幅提升（written 7）。HN 泛技术内容命中率仍低（1 medium/21），但比 0 好。
- **LessWrong 接入**：`lesswrong.com/feed.xml` 原生 RSS，AI 安全/理性深度内容，10 条/次全 medium，质量高。但单日 10 条太占 Brief → SOURCE_CAP 限流 3 条（与 arxiv 5 条同机制）。
- **Reddit 放弃**：SCF 数据中心 IP 被 Reddit 429（本地 200 云端 timeout）；r/LocalLLaMA、r/MachineLearning 均 429；redlib/RSSHub 公共实例全挂。V2EX API 已死。
- **intel_sources 有 8 个空壳文档**（只有 _id 无 key）：之前 SDK 不带 {data:} 包装静默失败残留，已清理。
- **doc(id).set 不能含 _id 字段**（INVALID_PARAM），注册新源用 key 作 doc id、文档内 key 字段。

## 2026-08-20 手动全链路验证 + marktechpost 403 修复
- **手动数据链**：intelFetch(17 源分片, runId 2026-08-20_18:00) → intelProcess(无待处理=增量语义正确) → intelDispatcher(summary v17, 21 条/3 tryable)。19:26 手动跑按北京时间落 summary 档（MODE_HOURS 5/11=increment, 18=summary, 其余兜底 summary）。
- **marktechpost 403 根因**：Cloudflare 拦截自定义 UA `IntelOfficer/1.0`（浏览器 UA 200 / 自定义 UA 403）。修复：intelRssPoll RSS 分支支持 `adapterConfig.headers` 透传 + 源配浏览器 UA 覆盖。验证：403 → not_modified → 清缓存后 status ok。

## 2026-08-20 四项优化实施
- **海外源停用决策依据**：intel_sources 文档含 health/status/errorStreak/lastFetchStatus，停用前先读库甄别——timeout 类（bens_bites/google_news_ai/huggingface_blog/import_ai/reddit_singularity）与 disabled 类（errorStreak 连击触发自动暂停）是云端不可达；status=retired 是质量分<6 自动退休（非网络问题）；marktechpost/the_batch/simon_willison 云端 lastFetchStatus=ok/not_modified 说明可达，保留。
- **改数据库源 enabled 必须同步 seedSources.js defaultOn**：intelRssPoll 每次启动自检会播种，若 seed 里 defaultOn=true 而库里手动禁用，重播种不覆盖（幂等跳过已存在），但新环境/重建集合时会复活——两处必须一致。
- **mcporter cloudbase 有 writeNoSqlDatabaseContent**（action=insert/update/delete，update 用 $set + query），管理端改库不需要专门写云函数。
- **.then 链内插缓存失败教训**：在 `return {...}` 对象后追加独立 `.then()` 会破坏 return 表达式（`})` 结束语句后再 `.then` 语法错误）。正确姿势：先 `const data = {...}`，写缓存，再 `return data`，全程在同一个 .then 回调内。

## 2026-08-20 强制重抓（手机无变化排查）
- **增量语义 = 手机无变化的主因**：游标续传 + guid 去重 + ETag 304，两次抓取间隔内无新内容 → brief 内容不变。手动触发数据链（intelFetch→intelProcess→intelDispatcher）在增量语义下不会产生可见变化。
- **强制重抓流程**：① 清所有 active 源 lastSuccessCursor/lastModified/etag；② 删 freshnessDays 窗口内旧 ingest（guid 去重不拦；注意时间字段是 fetchedAt 非 createdAt）；③ 删已发布 staged（防 already-staged skip）；④ intelFetch 全量重抓 → intelProcess(force) → intelDispatcher。
- **教训：重抓前别删 staged 历史**——窗口内无新条目的源（arxiv/techcrunch/theverge/hn）内容会从 brief 消失。重抓后应与归档版合并（按 itemId 去重）+ 重新应用 SOURCE_CAP，再写回 intel_current 升级版本。
- **归档恢复**：intel_current_archive 按 date+version 存历史版，合并用 v17(21条)+v18(11条)→v19(24条)→cap 后 v20(22条)。

## 2026-08-20 历史数据覆盖清理（用户反馈"数据包含历史数据"）
- **问题确认**：手动合并 v17+v18 生成 v20 时绕过了 dispatcher 的 freshness 过滤，把 8/19 的 arxiv/techcrunch/theverge/hn（部分源已 retired/disabled）并进 brief。
- **数据审计发现**：ingest 133 条中 112 条来自已删除/retired/disabled 源（infoq_cn 13、qbitai 22、hacker_news 30、techcrunch 12、theverge 4、arxiv 30、the_rundown 1）；staged 18 条全部为 8 个 active 源最新抓取。
- **清理动作**：① 归档 v20 备份；② 删除 112+3 条停用源 ingest 残留；③ dispatcher 重跑生成干净 v21/v22（11 条，仅 active 源，SOURCE_CAP 生效）。
- **经验**：手动合并/应急操作必须重新走 dispatcher 的 renderBrief（freshness + SOURCE_CAP），不能绕过；停用源的 ingest 残留应定期清理（可加定时任务）。

## 2026-08-20 情报收藏（纯本地）
- **收藏纯本地 vs 云端的取舍**：One News 在 DG-01 已定「历史/收藏纯本地化」——wx.Storage 无后端成本、无隐私争议、天然离线。情报收藏沿用此约定，不新增云函数。
- **半年滚动清除的实现**：localCache 条目级 TTL（expireAt=addedAt+180 天），getFavorites 每次读取过滤过期并回写（惰性滚动清除），不依赖定时器。
- **与 One News 收藏隔离**：key 用 intelFavorites（lc: 前缀），避免与 One News favorites（newsId 结构）混存导致详情页错配。
- **并行会话提交风险**：编辑中途另一会话 git add -A 提交会把未完成文件卷入（本次 6efb6c2 带入收藏 detail 部分）。应对：提交前 git status 甄别自己的文件集合，只 add 自己的，并行会话改动留工作树。

## 2026-08-21 正文乱码（U+FFFD）根因与修复
- **现象**：部分详情正文出现「深度」→「���」（3 个 U+FFFD），如 OpenAI AI 未来专栏。
- **根因**：intelLLM.js HTTP 响应用 `data += c` 逐 chunk 字符串拼接——当多字节 UTF-8 字符（如中文）恰好被 TCP 分包切在中间，逐 chunk toString() 把半截字节解成 U+FFFD。偶发（只有字符跨包时才发生），与源无关（ingest 原文干净英文）。
- **修复**：改用 `chunks.push(c)` + `Buffer.concat(chunks).toString('utf8')` 统一解码。同类问题 wechatAdapter.js:176 一并修复。
- **存量修复**：staged 6 条乱码（全在 whatHappened 字段）→ 删 staged + 重置 ingest pending → 重跑 intelProcess 重新生成（乱码不可逆，只能重跑）。
- **教训**：Node 里收集 HTTP body 永远用 Buffer 数组，不要 `+=`；部署副本（cloudfunctions/intelProcess/common/intelLLM.js）需同步。

## 2026-08-20 收藏入口位置（owner 反馈）
- **自定义导航页别放右上角**：微信小程序右上角是原生胶囊（…）固定区域，自定义导航布局时右侧会被胶囊遮挡——按钮只能放左侧（与返回同侧）或正文区。
- **meta 行条件渲染陷阱**：收藏入口放「时间后面」时，meta 行若带 `wx:if="{{srcName || pubTime}}"`，无来源/时间时整个 meta（含收藏）消失。应让 meta 行在真实数据块内始终显示，来源/时间各自 wx:if。

## 2026-08-21 mcporter createFunctionTrigger 整体替换语义（踩坑）
- **createFunctionTrigger 传 triggers 列表 = 全量覆盖**：该函数已有的其它触发器会被清空，只剩本次传入的。必须一次传该函数**全部**触发器（早/午/晚 3 档一起），不能逐档创建。
- **修复漂移触发器流程**：deleteFunctionTrigger 需 confirm=true（危险操作确认）；删旧 → createFunctionTrigger 一次性全量重建 → queryFunctions 验证 3 档齐全。
- **线上触发器可能被并行会话直接改**（不经 git）：定时器漂移排查以 mcporter 实查为准，别信 cloudbaserc 或本地 config.json 一定是线上值；改动线上后应同步 cloudbaserc/config.json 并提交。

## 2026-08-21 SCF 定时触发器 cron 时区 = 北京时间（定论）
- **判定依据**（官方文档未直接写明时区，用项目内证据定论）：
  ① intelDispatcher `MODE_HOURS={5:increment,11:increment,18:summary}` + 触发器 05:30/11:30/18:00 的小时位（5/11/18）与北京小时完全吻合——若 cron 按 UTC，早间档 resolveMode 全落 summary，与设计矛盾。
  ② COMMLOG 权威时间表"早间 05:10/05:15/05:20/05:30" = cron `0 10 5`/`0 15 5`/`0 20 5`/`0 30 5` 直接对应北京时间。
  ③ intelCleanup "每日 03:00 清理" = cron `0 0 3`，凌晨清理是北京语义。
- **踩坑**：5561cd2 把 `0-14,22-23` 当 UTC 写（以为停北京 23:00-05:00），实际按北京时间解析 = 停北京 15:00-21:00，完全相反。**写 cron 前先确认时区语义**；改后必须用 queryFunctions 核验线上 cron，并对照"意图时段 vs 实际时段"自查。

## 2026-08-21 详情页失效根因：逐批只留本批 vs 详情数据源
- **现象**：用户反馈详情页"UI 完全失效/结构不对"。
- **根因链**：① 08-19 owner 拍板「逐批只留本批」（intelProcess 每次处理清空旧 staged + 非 pending ingest）；② 08-21 并行 agent 恢复该逻辑（26c500c）；③ 定时 process 跑后 staged 从 27 条被清到 1 条 → intelGetDetail 只查 staged/current 按 itemId → 其余条目详情查不到 → 前端 fallback 空态/结构错乱。
- **用户拍板方案**：详情改读 brief 数据——intelDispatcher 写 brief 时 items 自包含完整 sop（sop/references/tryable/research/processedAt 等）；intelGetDetail 优先 staged，兜底 intel_current isCurrent 的 items 数组按 itemId 查，终极兜底 archive。
- **验证**：强制重抓（清 10 源游标+窗口 ingest+staged）→ 19 pending → 9 staged（全 medium，8/9 带 blocks）→ brief v7（9/9 带完整 sop）→ 详情接口 code 0 命中。
- **经验**：staged 清空不影响详情页（brief 自包含）；并行 agent 恢复"逐批只留"时未评估详情页依赖 staged——此类跨函数数据依赖改动前必须全链路验证。

## 2026-08-21 截断时机（owner 决策）
- **两处分类上限要分清**：
  ① stageAi 前 `truncateStagingByCategory` = **物理删除 staging pending**（AI 前收敛）→ 已移除（owner：时机不对，会静默丢弃够格内容）
  ② publish 时 `applyCategoryCaps` = **注入 cache 前软截断**（仅不写入，不删 staging）→ 保留（保证展示 ≤47）
- **教训**：截断要放在"最终展示前"而非"加工前"——加工阶段应尽量保留候选，展示层再按 cap 收敛，避免内容被早期静默丢弃。

## 2026-08-21 owner 拍板：回退「逐批只留本批」清理逻辑 + 并行变更处置纪律
- **回退**：intelProcess 移除「清空旧 staged + 清非本批 ingest」逻辑（曾清空数据、破坏详情页）。详情数据已随 brief 自包含，staged 增量保留不清理。已部署。
- **门禁同步**：check_intel.sh 改为 require/forbid 双模式——purgeDone/清空 staged 逻辑 forbid（禁止出现），翻译兜底/purgeOldBriefs/sourceId require（必须存在）。
- **协作纪律（owner 拍板）**：今后发现他人（并行 agent）的任何变更/改动，默认**不做任何处理**；先记录、汇报 owner，经 owner 确认后再决定处理动作。

## 2026-08-21 详情页 7 问题系统修复
- **问题①11点窗口未更新**：非故障——11:10 定时器正常触发（lastFetchedAt 03:10 UTC），但增量游标下源站无新文章 → 无新 ingest → brief 不变（时间停 09:57 = 最近一次有内容的批次）。源站产出决定，非链路问题。
- **问题②状态条**：已去掉（用户明确不要「情报官已完成梳理」提示条）。
- **问题③⑥发生了什么格式**：正文自然段落；「（AI 预测）」识别为独立块 → 浅灰底+段尾小字「AI 预测」UI 提示（非正文文字）；「大白话/定义」归为普通段落不显示标签。prompt 改为**基于原文客观转述**，禁止「专业语气/大白话/他做了」等介绍腔。
- **问题④两段式加载**：去掉 card 预渲染分支，统一等云函数完整数据再渲染（期间 loading）。
- **问题⑤语气**：prompt 强制「严格基于情报原文客观转述发生了什么」，禁止介绍者视角。
- **问题⑦只有简单正文**：medium 轻量路径设计使然（观点/学术类 practice/minAction 输出「无」合理）。owner 拍板保持轻量、只修前端——前端已按字段存在性显示/隐藏区块。
- **解析器加强**：SEP_RE 支持无星号行首标记（（AI 预测））；内容起点用标记后紧邻冒号（防误定位 JSON 冒号）；截断含 JSON 起始/空行。

## 2026-08-21 质量分机制优化（owner 拍板：两周平均分判断）
- **误停排查**：5 个 retired 源逐一核对——仅 **arxiv_ai 误停**（avg 9.3，某轮解析失败全 rejected 触发单轮 0 分）；techcrunch(avg 2.1)/theverge(avg 1.8)/hacker_news(avg 0.1)/qbitai(avg 0) 为真低质不恢复。arxiv 已恢复。
- **机制优化**：停用判断从「单轮分 <6」改为「近 42 次评分（每天3批×两周）平均分 <6」，且**至少累计 5 次评分才启用停用判断**（新源/刚恢复源先积累样本）。单轮低分（重抓/解析失败/批次波动）不再直接误杀。
- **验证**：部署后新逻辑生效；历史真低质源的旧 0 分仍在窗口内，若重新启用会按 avg 正确停用（符合预期）。

## 2026-08-21 补：lesswrong/marktechpost/simon_willison 误停证据核对
- **三个均确认为误伤**（重抓副作用：单轮条目重复/解析波动 → staged 骤降 → 旧机制单轮<6停用）：
  - lesswrong：历史 [8.4,8.7,10,3.3,7.5] avg 7.6，10条/轮稳定进 brief → 误伤
  - marktechpost：历史 [10,0,7.5]，被停轮 4 条全重复 → 误伤
  - simon_willison：8/20 brief 出现 48 条（archive 证据），被停前两轮 rejected 是重抓副作用 → 误伤
- **旧机制缺陷**：单轮分<6直接停、不看历史均分、不识别重抓/重复轮。新机制（42次平均+≥5次才判）下三者均不会被误停。
- **已恢复**：三者 status=active enabled=true，分数清空重新积累。

## 2026-08-21 intelSearch 依赖保护（并行 agent 覆盖教训）
- **现象**：并行 agent 部署 intelSearch 不带 InstallDependency: TRUE → 云端无 wx-server-sdk → 线上搜索 `Cannot find module` 全挂（当天 4 次）。
- **自我保护**：scripts/fix-intel-search-dep.js——校验 InstallDependency/CodeSize，异常自动重部署（installDependency=TRUE）。实测：检测 FALSE → 自动修复 → 7.0MB 正常。
- **提醒**：AI情报官_协作机制.md 新增"部署 intelSearch 必须带依赖安装"章节（含标准部署流程 + 排查清单）。
- **教训**：任何部署类操作必须校验依赖安装状态，不能只信部署 API 返回成功。

## 2026-08-22 One News 推荐空根因（自动暂停 + 夜间停跑叠加）
- **status=disabled 是"自动暂停"而非"不可用"**：newsFetcher 连续 3 轮入库 0 → errorStreak≥3 → status=disabled → listDueFeeds 永久跳过。**恢复 = 直接改库**（writeNoSqlDatabaseContent $set status=active,errorStreak=0），无需改代码。
- **排查推荐空先查 feed_meta**：`status/errorStreak/lastFetchTime/lastCount` 一眼定位——lastFetchTime=2020-01-01 占位 + streak≥3 = 自动暂停；本地 curl 200 但云端 0 条 = 过滤/解析问题（本次是暂停）。
- **36氪 RSS 已死**：`36kr.com/feed*` 全返回 17KB HTML（JS challenge 反爬），任何 UA 都绕不过；官方 RSS 中心（ad.36kr.com/rss-center）列的地址全部失效。判断 RSS 源可用性别信官方页面，直接 curl 看 Content-Type。
- **夜间停跑设计 vs 用户感知**：`0 0 6-22` 停 23:00-05:00 是 owner 拍的省资源设计，但用户会以为"推送失败"。排查推送问题时先核对定时器窗口再下结论。
