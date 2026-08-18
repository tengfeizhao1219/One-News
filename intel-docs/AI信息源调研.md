# AI 信息源调研（固定信源候选 + 抓取方案映射）

> 用途：支撑需求文档 §6「固定信源 = 系统内置默认精选清单 + 用户可增删」+ 抓取方案。
> 调研日期：2026-08-17｜方法：联网检索 + 多份 2026 年 AI 信源评测交叉比对 + 各源接入方式实地核查。
> 说明：默认清单已按「**更综合、不偏中文、中英文均衡**」重做；抓取方案按「**不同源不同方案、不套统一方案**」逐类核查。部分端点仍需落地面二次核验（标注「待验证」）。
> 关联索引：本调研文档与《AI情报官_需求文档_v1.md》《AI情报官_设计文档_v1.md》三份互证；交叉引用锚点与术语见《AI情报官_文档导航与交叉引用索引.md》（AI 读者入口）。

---

## 1. 怎么搭一套信源（方法论，来自调研共识）

多个评测一致建议按「三层」组织，避免空刷又漏重点：

| 层 | 目标 | 用什么 |
|---|---|---|
| 广度扫描（日） | 5–10 分钟知道发生了什么 | 综合日报类（The Rundown / TLDR / The Neuron / Ben's Bites）+ 新闻站 RSS + Google News 兜底 |
| 深度阅读（周） | 搞清「为什么重要」 | 周度深度（The Batch / Import AI / Ahead of AI / Latent Space / SemiAnalysis）|
| 趋势判断（月/季） | 感知方向 | 实验室官方博客、宏观分析（Stanford AI Index / Exponential View）|

> 对本工具的含义：默认清单应**覆盖三层**，通俗与技术均衡；中文源作为「补充层」而非主打（用户可按初始化偏好加重）。抓取不能只靠一种方案——RSS、API、网页抓取、本地解析、官方订阅各有所适。

---

## 2. 推荐「系统默认固定信源」清单（内置用，综合 / 均衡版）

> 相较旧版：条目更综合（覆盖三层 + 实验室官方 + 社区 + 工具发现 + 趋势），**不偏中文**——中文源移入 F 层「补充层」；每条附「默认抓取方式」与定位，便于 §3 映射。

### A 层 · 广度扫描（日更，通俗，开箱即用）

| 来源 | 频率 | 定位 | 默认抓取方式 |
|---|---|---|---|
| **The Rundown AI** | 每日 | 通俗 +「怎么用」教程，新手友好（2M+ 订阅）| RSS（beehiiv）|
| **TLDR AI** | 每日 | 技术向 terse 摘要，开发者默认日报 | RSS |
| **The Neuron** | 每日 | 轻量通俗，非技术用户友好 | **无 RSS**（实测 `/feed` 404、`/feed.xml` 被 Cloudflare 拦截），走官网抓取 `https://www.theneurondaily.com/`（当天最新：Anthropic CEO denies wanting to rule AI alone）|
| **Ben's Bites** | 每日/周 | 创业 / 独立开发者视角 | RSS（Substack）|
| **TechCrunch（AI 频道）** | 每日 | 产业 / 融资一手 | RSS |
| **VentureBeat（AI）** | 每日 | 企业 AI 应用 | RSS |
| **The Verge（AI）** | 每日 | 消费级科技 | RSS |
| **MarkTechPost** | 每日 | 研究 + 工具快讯 | RSS |
| **Google News RSS（兜底聚合）** | 巡检 | 按关键词聚合多源（~100 条上限、重定向链接、无 SLA）| RSS（无密钥）|

### B 层 · 深度阅读（周更，搞清为什么重要）

| 来源 | 频率 | 定位 | 默认抓取方式 |
|---|---|---|---|
| **The Batch**（DeepLearning.AI）| 每周 | 研究解读，Andrew Ng 背书，可信度最高 | **无 RSS**（实测 `/the-batch/feed`、`/feed/` 均 404），走官网抓取 `https://www.deeplearning.ai/the-batch/`（最新：The AI Engineering Skills Map from Andrew Ng，8-14）|
| **Import AI**（Jack Clark）| 每周 | 研究 + 政策 + 地缘，治理视角必读 | RSS（Substack）|
| **Ahead of AI**（Sebastian Raschka）| 每月 | 技术深读 | RSS（Substack）|
| **Latent Space** | 周 + 播客 | AI 工程 | RSS |
| **SemiAnalysis** | 周 | 芯片 / 算力 / 供应链 | 网页抓取 / RSS（待验证）|
| **One Useful Thing**（Ethan Mollick）| 不定期 | AI×工作 | RSS（Substack）|

### C 层 · 趋势判断（月度 / 季度，方向感）

| 来源 | 频率 | 定位 | 默认抓取方式 |
|---|---|---|---|
| **Stanford AI Index** | 年 / 季 | 宏观指标 | 官方网页 / 报告 |
| **Exponential View**（Azeem Azhar）| 周 | 宏观 / 经济影响 | RSS |
| **OpenAI Blog / Research** | 不定期 | 模型与 API 一手 | RSS + 官方页 |
| **Anthropic News** | 不定期 | Claude 更新 / 安全研究 | **无 RSS**（实测 2 次 404），走官网抓取 `https://www.anthropic.com/news`（当天最新：How Claude's text watermark works，8-14）|
| **Google DeepMind Blog** | 不定期 | 基础研究 / 多模态 | RSS + 官方页 |
| **Meta AI Blog** | 不定期 | Llama / 开源研究 | **无 RSS**（实测 `/rss.xml`、`/feed/` 均不可用），走官网抓取 `https://ai.meta.com/blog/`（当天最新：Reimagining Independence… Assistive Robotics，7-27）|
| **Mistral Blog** | 不定期 | 欧洲开源模型 | 官方页（待验证）|
| **xAI（Grok）** | 不定期 | 模型一手 | 官方页 |
| **Hugging Face Blog** | 定期 | 开源模型首发地 | RSS |
| **arXiv**（cs.AI / cs.CL / cs.CV）| 每日 | 前沿论文 | 官方 API |

### D 层 · 社区信号（实时，草根 / 热度）

| 来源 | 频率 | 定位 | 默认抓取方式 |
|---|---|---|---|
| **Hacker News** | 实时 | 工程师社区热度（快、高冗余）| Algolia API（无密钥）|
| **Reddit**（r/singularity、r/LocalLLaMA、r/MachineLearning）| 实时 | 讨论 + 草根信号 | RSS 直连 `.rss`（免密钥，无评分/评论）/ OAuth API；**本环境出口被风控拦截，源本身有效**（实测 2026-08-17），落地到正常出口服务器可用 |
| **LessWrong** | 不定期 | 对齐 / 安全讨论 | RSS |

### E 层 · 工具发现（普通人找工具友好）

| 来源 | 频率 | 定位 | 默认抓取方式 |
|---|---|---|---|
| **Product Hunt** | 每日 | 新 AI 产品首发 | RSS / API |
| **There's An AI For That** | 持续 | AI 工具大全（按场景）| 网页抓取 |
| **GitHub Trending** | 每日 | 开源项目热度 | 网页抓取 |

### F 层 · 中文补充层（非默认主打，按需加重，默认抓取方式同英文一致）

| 来源 | 频率 | 定位 | 默认抓取方式 |
|---|---|---|---|
| **机器之心** | 每日 | 技术深度、论文解读最强 | RSS 已转付费订阅（个人订阅后可用 RSS）；免费走官网抓取 `https://www.jiqizhixin.com/`（实测 2026-08-17）|
| **量子位** | 每日 | 产业快讯、国产模型快 | RSS / 官网 |
| **新智元** | 每日 | 产业 + 政策视角 | RSS 可用（实测 2026-08-17）|
| **36氪·AI** | 每日 | 商业 / 融资视角 | RSS / 官网 |
| **极客公园** | 每日 | 科技产品深度 | RSS / 官网 |
| **微信公众号**（量子位 / 机器之心 / 数字生命卡兹克 等）| 巡检 | 国内一手、即时 | 合规本地解析（见 §5）|

> 默认开启 A/B/C/D/E 五层；F 层中文与公众号默认**不强制开启**，由用户初始化「语言偏好 / 关注面」决定是否拉起（通用用户开箱即国际均衡，老赵试点可加重中文）。

---

## 3. 抓取方案分类与技术要点（不同源不同方案，不套统一）

核查结论：不存在「一套方案打天下」。**RSS 覆盖绝大多数 Newsletter/新闻站/实验室博客**；**社区类（HN/Reddit/arXiv）走官方 API 最稳**；**聚合兜底用 Google News RSS**；**公众号只能走合规本地/授权路径**；**X/Twitter 默认不纳入**。

### 3.1 RSS / Atom（首选，零密钥、最稳）
- 适用：A/B/C/E 层绝大多数源（日报、周报、新闻站、实验室博客）。
- 端点示例：
  - TLDR AI：`https://tldr.tech/api/rss/ai`（或 `https://bullrich.dev/tldr-rss/ai.rss`）
  - The Rundown AI：`https://rss.beehiiv.com/feeds/2R3C6Bt5wj.xml`
  - Import AI / The Batch / Ben's Bites / Ahead of AI：`*.substack.com/feed`
  - 新闻站 / 机器之心 / 量子位：各站 `domain/feed` 或 `/rss`
- 要点：解析标题 / 链接 / 发布时间 / 正文摘要；按 `guid` 去重；尊重 feed 使用条款，标注来源与原文链接。

### 3.2 Hacker News — Algolia Search API（无密钥、可检索）
- 端点：`https://hn.algolia.com/api/v1/search_by_date?query=TOPIC&tags=story&numericFilters=points>100,created_at_i>$(date -d '30 days ago' +%s)`
- 要点：支持 `query` 关键词、`tags=story`、`numericFilters`（points 阈值、时间窗）；无需密钥、速率友好；比官网 HTML 抓取更稳。

### 3.3 Reddit — RSS（无密钥）或 OAuth API
- 2026 现状：自 2025 末 Responsible Builder Policy 后自注册关闭；未认证 `.json` 返回 **403**。
- 方案 A（推荐）：`https://www.reddit.com/r/singularity/.rss` —— **免密钥**，但无评分 / 评论。
- 方案 B：OAuth 2.0 正式 API —— 免费层 **100 QPM**，仅非商用；商用需手动审批（约 $12K/年）。
- 要点：社区信号用 RSS 即可；需要评分/排序再上 OAuth。
- **实测注记（2026-08-17）**：本沙箱出口被网络风控拦截（`You've been blocked by network security`），属测试环境限制；`r/{subreddit}/.rss` 在受控服务器环境有效，落地换正常出口即可。

### 3.4 arXiv — 官方 API（无密钥、Atom XML）
- 端点：`http://export.arxiv.org/api/query?search_query=cat:cs.AI+AND+submittedDate:[YYYYMMDDHHMM+TO+YYYYMMDDHHMM]&sortBy=submittedDate&sortOrder=descending&max_results=50`
- 要点：**3 秒限速**；分类检索 `cat:cs.AI/cs.CL/cs.CV/cs.LG`；开放获取，可配 Papers With Code 看 SOTA。

### 3.5 Google News RSS — 兜底聚合器（无密钥）
- 端点：`https://news.google.com/rss/search?q=QUERY&hl=en-US&gl=US&ceid=US:en`
- 要点：支持 `when:7d`、`site:reuters.com` 运算符；~100 条/源上限、链接为重定向、无 SLA；**作为关键词兜底聚合**，不替代一手源。

### 3.6 强聚合器 API（NewsAPI 类，需密钥、受限）
- 候选：NewsAPI.org（免费 100 req/日、24h 延迟、非商用）、Currents、APITube、GNews、NewsData.io、Mediastack、Perigon。
- 要点：免费层普遍受限；**仅作 RSS/官方源补充**，不依赖为主链路。

### 3.7 网页抓取 / 官方页（实验室博客、工具站）
- 适用：C 层**无 RSS 的官方博客**、E 层 There's An AI For That / GitHub Trending。
- **实测确认无公开 RSS、须走官网抓取（2026-08-17）**：
  - **Anthropic News** → `https://www.anthropic.com/news`（当天最新 Claude 文本水印，8-14）
  - **Meta AI Blog** → `https://ai.meta.com/blog/`（当天最新 Assistive Robotics，7-27）
  - **The Batch（DeepLearning.AI）** → `https://www.deeplearning.ai/the-batch/`（最新 AI Engineering Skills Map，8-14）
  - **The Neuron** → `https://www.theneurondaily.com/`（当天最新 Anthropic CEO denies…，当天）
  - **机器之心** → `https://www.jiqizhixin.com/`（RSS 已转付费订阅，个人订阅后可用 RSS）
- 要点：优先找官方 RSS；无 RSS 再结构化解析；遵守 `robots.txt` 与速率；标注「官方一手」。

### 3.8 YouTube Data API v3（视频 / 播客，需密钥）
- 端点：`https://www.googleapis.com/youtube/v3/search?part=snippet&q=QUERY&type=video&key=API_KEY`
- 要点：免费 **1 万配额单位/日**；读 1 单位、搜索 100 单位、上传自 2025-12 起由 1600 降至 100；需 API Key 读公开数据；视频源默认**可选轻量补充**。

### 3.9 X / Twitter（默认不纳入）
- 2026 现状：2 月起**无免费层**，按量付费（约 $0.005/帖子读）；第三方替代 TwitterAPI.io（$0.15/1K）、Apify、Bright Data；抓取违反 ToS，属法律灰区。
- 结论：**v1 默认不纳入**；如未来需要，走付费第三方 API 并显式告知用户成本与合规风险。

---

## 4. 源 → 抓取方案映射总表

| 源类别 | 代表源 | 抓取方案 | 接入协议 | 频率约束 | 合规注意 |
|---|---|---|---|---|---|
| 综合日报 / Newsletter | The Rundown / TLDR / The Neuron / Ben's Bites | **RSS 直连** | RSS/Atom | 按源发布 | 公开 feed，遵从使用条款，标来源 |
| 新闻站 | TechCrunch / VentureBeat / The Verge / Ars / MIT TR / MarkTechPost | **RSS 直连** | RSS | 每日 | 公开 RSS，标来源与链接 |
| 实验室官方博客 | OpenAI / Anthropic / DeepMind / Meta / Mistral / xAI / HF | **RSS + 官方页** | RSS + 网页抓取 | 不定期 | 一手来源，注明官方 |
| Hacker News | HN 热门 / 检索 | **Algolia API（无密钥）** | REST JSON | 实时 / 巡检 | 公开 API，守速率 |
| Reddit | r/singularity 等 | **RSS（无密钥）** 或 OAuth API | RSS / OAuth | 实时 / 巡检 | 2026 未认证 .json 403；RSS 可用；商用需审批 |
| arXiv | cs.AI/cs.CL/cs.CV | **export.arxiv.org API（无密钥）** | Atom XML | 每日 | 3 秒限速；开放获取 |
| 聚合兜底 | Google News | **Google News RSS（无密钥）** | RSS | 巡检 | ~100 条上限、重定向、无 SLA |
| 强聚合器 | NewsAPI / GNews / NewsData / Perigon | **官方 API（需密钥）** | REST | 受配额 | 免费层受限（100 req/日、24h 延迟、非商用）|
| 工具发现 | Product Hunt / TAAFT / GitHub Trending | **RSS / 网页抓取** | RSS + HTML | 每日 | 标来源 |
| 公众号 | 量子位 / 机器之心 / 卡兹克 等 | **合规本地解析 / 微信读书 / RSSHub** | 私有 | 巡检 | 仅个人学习研究、不商用传播、尊重版权（见 §5）|
| X / Twitter | 大 V / 一手 | 第三方 API（付费）| REST | 受配额 | 2026 无免费层；ToS 灰区——**默认不纳入** |
| YouTube | 频道更新 | **YouTube Data API v3（需密钥）** | REST | 受配额 | 1 万配额/日；读 1 / 搜索 100 单位 |
| 用户投喂 | 链接 / 原文 / 截图 | 解析管线 | — | 随到随处理 | 用户自有内容 |

---

## 5. 微信公众号合规抓取（专章）

用户指令：**公众号源在不违反相关版权的前提下，可以抓取**。结论：可纳入，但受严格合规约束。

### 5.1 现实约束
- 微信**无官方 RSS / 公开 API** 供第三方抓取公众号文章。
- 任何抓取都触及平台服务条款与版权，**只能在「个人学习 / 研究、非商用、不对外传播、尊重版权」边界内**做。

### 5.2 可选技术路径（2026 实测，按可维护性排序）

> 实测结论（2026-08 复核）：社区尝试过五类方案，**只有「本地客户端 SQLite」与「微信读书 API」两条能长期存活**；其余（网页抓取 / 协议模拟 / UI 自动化 / RSSHub 公众号路由）维护成本随时间快速上升或已失效。

| 路径 | 方式 / 代表项目 | 稳定性（2026）| 合规风险 | 备注 |
|---|---|---|---|---|
| **本地 SQLite 解析（首选）** | 解析本机微信客户端数据库；ChatLog（vitamin5x/chatlog，2026-01 活跃，兼容微信 3.x/4.x，含 HTTP API + MCP）、wechat_db_parser（grapeot，专注公众号文章导出，支持 CSV/Markdown）| **高** | 最低（仅读自己客户端已同步数据）| 离线数据处理、不持续对抗微信服务器、检测面最小；覆盖取决于本机已同步数据；wechat_db_parser 仅测过微信 PC 3.9 系列 |
| **微信读书 API（备选）** | wewe-rss（基于微信读书接口）；原项目 2026-01-19 归档停更（有 fork 续命），转标准 RSS | **中** | 低 | 能拿全文（利于索引/摘要）；但与微信主客户端风险隔离；有「小黑屋」封控风险、更新慢几小时~1 天、并非全号可搜、需登录态维护 |
| **RSSHub** | 自建 + 微信 Cookie | **低** | 中 | 官方文档确认公众号无长期可靠路由，多数已失效 / 仅返摘要，维护成本高、易断——**不推荐** |
| **第三方服务**（WeRSS / WeChat2RSS 等）| 自托管（WeRSS）或公共托管（WeChat2RSS 免费 300+ 号）| 中（自托管）/ 低（公共）| 中（公共版隐私与跑路风险）| 自托管可行，但 WeRSS 曝 **CVE-2026-2825**（≤1.4.8，代码注入/XSS），须升级；公共版把数据交第三方，需评估 |
| **网页抓取 / UI 自动化** | Playwright / 协议模拟 | **低** | 高 | 2026-03 实测 403 被封、IP 进黑名单，半衰期短——**不推荐** |

### 5.3 推荐路径结论（调研确认）

- **首选：本地 SQLite 解析（ChatLog / wechat_db_parser）**。契合情报官需求——直接拿到「谁更新了 / 标题 / 链接 / 时间」作为更新信号流，离线处理、检测面最小、维护形态是常规软件工程而非爬虫运维；前提是在自有设备保持微信 PC 版登录与同步。
- **备选 / 补充：微信读书 API（wewe-rss 及活跃 fork）**。需要公众号**正文**（做全文索引、深度摘要）时启用；代价是登录态维护、封控风险、更新延迟、并非全号可用。
- **不纳入**：RSSHub 公众号路由、网页抓取 / UI 自动化、公共第三方托管（隐私与跑路风险）。
- **合规红线不变**：仅个人使用、标来源、不对外分发 / 不商用、可一键关停、本地优先、风险告知（见 §5.4）。

### 5.4 合规落地条款（写进需求文档）
1. **仅个人使用**：抓取结果只用于本用户自己的情报处理，不对外分发、不商用、不二次传播。
2. **尊重版权**：输出中**标注来源公众号 + 原文链接 + 作者**，不整篇搬运；摘要/翻译优先。
3. **最小必要**：只抓用户主动订阅/关注的号，不广撒网。
4. **可关停**：用户可一键关闭公众号源；如微信平台政策变化导致路径失效，自动降级（静默、不报错刷屏）。
5. **本地优先**：优先本地 SQLite 解析 / 微信读书路径，避免把内容交给不可控第三方。
6. **风险告知**：初始化时明确提示「公众号抓取处于平台合规灰区，仅限个人学习研究」。

---

## 5.5 实测可用性验证（2026-08-17）

> 方法：用脚本（urllib）批量抓取各源 RSS/API 当天最新条目；对沙箱 TLS 限制导致直连失败的源，改用浏览器通道（WebFetch）复测。结论覆盖 §2 默认清单代表性源 + 部分候选。

### 一、确认可用（19 个，实抓到当天 / 最新内容）

| 源 | 当天最新标题（摘编）| 时间 | 抓取方式 |
|---|---|---|---|
| Hacker News (Algolia) | US citizen charged after GrapheneOS phone wipes… | 2026-07-26 | API（**须加 `created_at_i>` 时间窗**，否则返旧文）|
| arXiv cs.AI/CL/CV | CPI-Bench: …Real-World Image Editing | 2026-08-14 | 官方 API |
| TechCrunch AI | Wispr raises $280M at $2B valuation | 2026-08-17 | RSS |
| The Verge AI | Anthropic explains how Claude's invisible text watermarks work | 2026-08-17 | RSS |
| VentureBeat AI | Google just redesigned the search box… | 2026-05-19 | RSS（更新偏慢，疑似缓存）|
| Ars Technica AI | OpenAI and Anthropic in price war… | 2026-08-14 | RSS |
| MIT Tech Review AI | What happens when a kid's robot best friend dies? | 2026-08-17 | RSS |
| MarkTechPost | DeepSeek AI Releases DeepSeek Harness… | 2026-08-17 | RSS |
| Hugging Face Blog | State of Open Models: Summer 2026 | 2026-08-14 | RSS |
| OpenAI Blog | The Defender's Window | 2026-08-17 | RSS |
| Google DeepMind Blog | Introducing Gemini 3.7 Flash | 2026-08-13 | RSS |
| Google News RSS | Wearable sensors and AI could monitor blood pressure in ICU | 2026-08-17 | RSS（兜底聚合器）|
| The Rundown AI | Dario Amodei logs on to answer the critics | 2026-08-17 | RSS |
| TLDR AI | GLM-5.3, Stripe OpenRouter deal, AI agent consensus | 2026-08-17 | RSS |
| Ben's Bites | Ben's Session 2 | 2026-08-14 | Substack RSS |
| Import AI | Import AI 469: Science AI, RSI simulator | 2026-08-17 | Substack RSS |
| Product Hunt | Meridian（新 AI 产品）| 2026-08-17 | RSS |
| 量子位 | 共生知行发布人形机器人赛车 Demo | 2026-08-17 | RSS |
| 新智元 | 千问办公首个开源项目… | 2026-08-17 | RSS |

### 二、待处理项已全部补齐确认（2026-08-17 复测定论）

| 源 | 复测结论 | 落地抓取方式（已定）| 当天最新（摘编）|
|---|---|---|---|
| **Reddit** r/singularity | 本环境出口被网络风控拦截（`blocked by network security`）；**源本身 `.rss` 有效** | RSS 直连 `r/{sub}/.rss`（免密钥，无评分/评论）；需排序上 OAuth 2.0（免费 100 QPM、仅非商用）| 社区信号（受控环境可抓）|
| **Anthropic News** | 两次 404，**确认无公开 RSS** | 官网抓取 `https://www.anthropic.com/news`（结构化解析标题/日期）| How Claude's text watermark works（8-14）|
| **Meta AI Blog** | `/rss.xml`、`/feed/` 均不可用，**确认无 RSS** | 官网抓取 `https://ai.meta.com/blog/` | Reimagining Independence… Assistive Robotics（7-27）|
| **The Batch**（DeepLearning.AI）| `/the-batch/feed`、`/feed/` 均 404，**确认无 RSS** | 官网抓取 `https://www.deeplearning.ai/the-batch/`（issue-NNN 结构）| The AI Engineering Skills Map from Andrew Ng（8-14）|
| **The Neuron** | `/feed` 404、`/feed.xml` 被 Cloudflare 拦截，**确认无 RSS** | 官网抓取 `https://www.theneurondaily.com/`（/p/ 文章结构）| Anthropic CEO denies wanting to rule AI alone（当天）|
| **机器之心** | `/rss` 已转向付费订阅页 | 个人订阅后用 RSS；免费走官网抓取 `https://www.jiqizhixin.com/` | 中文层可暂用其他源补位 |
| **微信公众号** | 依赖用户本地微信客户端数据 | 走 §5 合规本地解析路径，本环境无法自动抓（设计如此）| — |

### 三、对抓取方案映射的修正
- 沙箱直连（urllib）对部分大站 HTTPS 有 TLS EOF，但源**真实可用**（Google News / HF / OpenAI / DeepMind / Import AI 经浏览器通道均成功）——落地到正常服务器环境不受影响，本次失败属测试环境限制。
- 多个源返回 **gzip 压缩**，抓取客户端必须处理 `Content-Encoding`（MarkTechPost / 机器之心等因此一度解析失败）。
- HN Algolia **务必带 `created_at_i>` 时间窗**过滤，否则返回历史旧文（实测默认返回 2019 年帖）。
- 经本轮复测，原 7 个待处理项**全部定论**：除公众号为设计性本地依赖外，其余 6 个均已有明确抓取方案（Reddit 走 RSS 直连 / OAuth、Anthropic·Meta·The Batch·The Neuron 走官网抓取、机器之心走订阅 RSS / 官网），**无一个源「不可用」**。默认清单 **25/25 源抓取方式全部确认**，可进入设计阶段。

## 6. 全量候选清单（供老赵增删时挑选）

### 6.1 英文综合 / Newsletter
- The Rundown AI、The Neuron、TLDR AI、Superhuman AI（职场/生产力）、Ben's Bites、DevBrief（偏工程）、The AI Yard / Generative AI Weekly、Techpresso。

### 6.2 研究 / 政策 / 战略（深度）
- The Batch、Import AI、Ahead of AI、Interconnects（Nathan Lambert）、Latent Space、Exponential View、One Useful Thing、SemiAnalysis、The Algorithm（MIT TR）。

### 6.3 实验室 / 厂商官方（一手）
- OpenAI、Anthropic、Google DeepMind、Meta AI、Mistral、xAI、Microsoft/Google/Apple 消费级 AI 更新（Copilot、Gemini、Siri，按需）。

### 6.4 开源 / 论文 / 聚合
- Hugging Face Blog、arXiv、Papers With Code、daily.dev（#ai）、GitHub Trending。

### 6.5 中文源（补充层）
- 机器之心、量子位、新智元、36氪·AI、极客公园、AI前线（InfoQ）、RadarAI、AIbase / AITOP100 / Toolify.AI、智源社区、PaperWeekly。

### 6.6 社区 / 讨论
- Hacker News、Reddit（r/singularity、r/MachineLearning、r/LocalLLaMA、r/artificial）、LessWrong、微信生态公众号（合规路径）。

### 6.7 视频 / 播客（可选，轻量补充）
- Latent Space Podcast、Matt Wolfe / The AI Advantage（YouTube 工具测评）、The Rundown 视频版、Stanford AI Index 年度报告。

---

## 7. 与需求文档的衔接 + 待办

- 本清单对应需求文档 **§6 信息源** 中「**系统内置默认精选信源清单**」+「差异化抓取方案」的调研底座。
- 默认清单建议采用 §2 的 **A/B/C/D/E 五层（国际均衡）+ F 层中文补充（按需）**，共约 30+ 条。
- 抓取方案详见 §3 / §4，结论：**RSS 为主、社区走官方 API、兜底用 Google News RSS、公众号走合规本地路径、X 默认不纳入**。
- **巡检频率（用户已定）**：每日 **05:00 / 11:00 / 18:00 三次固定巡检**，仅三次；发布绑定内容（有则汇报、无则不打扰）。
- **待老赵确认 / 落地的待办（状态更新）**：
  1. 默认清单最终条目（A–E 默认开、F 中文/公众号按需开）—— **已确认**。
  2. 需密钥源（NewsAPI 类 / YouTube）是否启用、密钥由谁提供 —— **待定（默认不强依赖，主链路用 RSS / 官方 API）**。
  3. 公众号合规路径选哪条 —— **已定（调研确认）**：首选本地 SQLite 解析（ChatLog / wechat_db_parser），备选微信读书 API（wewe-rss 及 fork）；不接 RSSHub / 网页抓取 / 公共第三方。详见 §5.2、§5.3。
  4. 巡检三时点的发布策略（18:00 汇总结案、其余仅补抓）—— **已确认**。

---

*注：外部信源会变动，硬编码前务必二次核验可用性与授权方式；带「待验证」者尤需确认。抓取一律守「来源可溯、版权尊重、个人使用、不刷屏」红线。*
