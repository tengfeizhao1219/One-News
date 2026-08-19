# AI 情报官 · 设计文档 v1（草案）

> 配套文档：《AI情报官_需求文档_v1.md》《AI信息源调研.md》。
> 关联索引：本文档与需求 v1、信息源调研三份互证；交叉引用锚点表与术语见《AI情报官_文档导航与交叉引用索引.md》（AI 读者入口），可经索引在三者间跳读。
> 状态：设计阶段已闭环，覆盖 §0–§10（总体架构 / 部署 / 技术栈 / 抓取层 / 处理层 / 推送层 / 数据模型运维 / 初始化采集 / 小结）。
> 日期：2026-08-17（定稿 2026-08-18）。

---

## 0. 设计目标与硬约束（来自需求 v1）

| 项 | 约束 |
|---|---|
| 内核 | 通用「普通人」内核；**初始化时**收集个人画像，不做身份硬绑定 |
| 产品定位 | **嵌入 One News** 作为首个 pilot 模块（决策 D1 已定）|
| 信息源 | 混合：**固定精选清单**（默认开 A–E 五层、F 中文按需）+ 实时检索 + 用户投喂 |
| 巡检 | 每日 **05:00 / 11:00 / 18:00 三次**，仅三次；**发布绑定内容**（有则汇报、无则不打扰）|
| 发布策略 | **18:00 当日汇总结案**，05:00 / 11:00 仅补抓增量 |
| 输出 | 固定模板（🔹今日关注 / 🔹本周可试用清单）+ SOP 五步（溯源→定义→场景映射→实操→最小行动）|
| 场景映射 | 须结合老赵三重身份：RCBC FRAML 合规 / One News 产品（AI 阅读引擎·RSS·theme.json）/ 装修·育儿·个人效率 |
| 公众号 | **合规本地解析**（ChatLog / wechat_db_parser 首选，微信读书备选）；不接 RSSHub / 网页抓取 / 公共第三方 |
| X / Twitter | 默认不纳入 |
| IM 渠道 | **仅小程序**（决策 D3：暂不做微信/WhatsApp 外推）|
| 红线 | 来源可溯、版权尊重、个人使用、不刷屏；合同/接口变更提醒先走 commlog 广播 |

---

## 1. 系统总体架构

### 1.1 数据流（一次巡检周期）

```
                          ┌─────────────────────────────────────────┐
   Cron 05/11/18  ───────▶│           调度器 Scheduler               │
                          └───────────────────┬─────────────────────┘
                                              │ 触发抓取任务（按源清单）
                                              ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │ 抓取层 Fetcher（差异化适配器，见 §5）                             │
   │  RSS 直连 │ API( HN/Reddit/arXiv )│ 官网抓取 │ Google News 兜底 │ 公众号本地 │
   └───────────────────────────────┬──────────────────────────────────┘
                                    │ 原始条目（标题/链接/时间/正文）
                                    ▼
                        解析归一化 Normalizer（去重 by guid/url、gzip 解压、时间窗过滤）
                                    │
                                    ▼
                              存储 Store（原始库 + 结果库）
                                    │ 新条目进入处理队列
                                    ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │ 处理引擎 Processor（LLM + SOP 模板）                              │
   │  溯源 → 一句话定义（含边界）→ 场景映射(工作/产品/家庭) → 实操案例 → 最小行动 │
   │  + 翻译（英文源→中文）+ 个性化过滤（用户画像/关注标签）           │
   └───────────────────────────────┬──────────────────────────────────┘
                                    ▼
                        推送编排 Dispatcher
            18:00：当日汇总结案  │  05/11：补抓增量（无新增则静默）
                                    │
                                    ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │ 渠道适配器 Channels（决策 D3：本期仅 One News 小程序）           │
   └──────────────────────────────────────────────────────────────────┘
```

### 1.2 模块划分

| 模块 | 职责 | 关键设计点 |
|---|---|---|
| **Scheduler 调度器** | 按 05/11/18 触发巡检；幂等、可重试、限频 | 仅三次；18:00 标记「结案」 |
| **Fetcher 抓取层** | 差异化适配器，按源类型调用对应抓取方式 | 见 §5；含 gzip 解压、时间窗、去重、降级 |
| **Normalizer 解析层** | 归一化字段、去重、质量初筛 | guid/url 去重；非 AI 噪声过滤 |
| **Store 存储** | 原始条目 + 处理结果 + 用户画像 + 推送记录 | 见后续「数据模型」部分 |
| **Processor 处理引擎** | LLM 调用 + SOP 模板 + 翻译 + 个性化 | 见后续「处理层」部分 |
| **Personalizer 个性化** | 用户画像 → 过滤/排序/场景映射强度 | 初始化收集；可迭代 |
| **Dispatcher 推送编排** | 决定何时发、发什么、发到哪 | 18:00 汇总 vs 05/11 增量 |
| **Channels 渠道适配器** | 多端渲染与投递 | 本期仅 One News 小程序（D3）|
| **Config 配置/画像** | 源清单、用户画像、巡检参数 | 可热更新 |

### 1.3 抓取层适配器（与 §5 一一对应）

| 适配器 | 覆盖源 | 方式 |
|---|---|---|
| RSSAdapter | A/B/C/E 层绝大多数 + 新闻站 | RSS/Atom 直连，处理 gzip |
| APIAdapter | Hacker News（Algolia）、arXiv（官方 API）、Reddit（OAuth/可选）| 无密钥/密钥 REST |
| ScrapeAdapter | Anthropic / Meta / The Batch / The Neuron / 机器之心 | 官网结构化解析（无 RSS）|
| NewsRSSAdapter | Google News RSS | 关键词兜底聚合 |
| WeChatAdapter | 公众号 | 本地 SQLite 解析 / 微信读书（合规）|

> 设计要点：每个适配器实现统一接口 `fetch(src) -> List[Item]`；失败按源降级（静默、不刷屏）；抓到的内容统一进 Normalizer。

---

## 2. 部署形态（**已定：方案 A**）

> 决策 D1（2026-08-17 拍板）：**嵌入 One News 小程序**，作为其中一个「AI 情报」模块。

- 复用现有 **AI 阅读引擎 / RSS 抓取引擎的「代码结构」/ theme.json 设计系统**；情报官作为 One News 内独立模块（新增「AI 情报」页/入口）。
- **复用的是后端基础设施代码，不是现有业务数据**：情报官跑**独立的 25 源信源集**，与用户订阅的 One News feed 完全隔离；现有文章列表 / 阅读体验 / 用户 RSS 订阅一字不改。
- 不单独建前端与外推体系，复用 One News 小程序渲染与现有用户体系。
- 影响：抓取层 / 处理层 / 推送层均在 One News 后端内以 module 实现，但走**独立 pipeline、独立速率预算、独立队列、独立配额核算**；IM 渠道本期不外接（见 §4 D3）。

## 3. 技术栈（**已定：由我推荐 Node.js + JavaScript (CommonJS) + 微信云开发**）

> 决策 D2（2026-08-17）：由我推荐。以下与「嵌入 One News + 复用 Node 栈」一致。

| 层 | 推荐 | 理由 |
|---|---|---|
| 语言/框架 | **Node.js + JavaScript (CommonJS) + 微信云开发（wx-server-sdk）**（校准 One News 真实代码，非 TypeScript）| 嵌入形态决定复用；云函数 CommonJS 模块 |
| 调度 | **平台定时触发器（05/11/18）→ 入队 → Worker 云函数按源分片执行**（见 §5.8）| 云函数有硬超时，禁止单实例全量抓取；触发与执行解耦、可重试、幂等 |
| 存储 | **微信云数据库 `cloud.database()`**（校准：One News 用云开发 DB，新增 `intel_*` 集合）| 不引入新存储依赖 |
| RSS 抓取 | `rss-parser` + 原生 fetch（处理 gzip）| 零密钥、最稳 |
| 官网抓取 | `cheerio`（服务端 HTML 解析，守 robots.txt）| Anthropic/Meta/The Batch/The Neuron/机器之心无 RSS |
| API 源 | 原生 fetch（HN Algolia / arXiv / Reddit OAuth）| 无密钥或标准 OAuth |
| LLM 网关 | **复用 One News 现有 LLM 调用封装（env key 模式）**；情报官用独立 `intelProcess` 云函数 + 独立 key + 配额账本 | 不重复造轮子，配额与阅读分账 |
| 前端 | One News 小程序内「AI 情报」页，复用 `theme.json` | 项目约束：禁止新增 hex 色值 |
| 公众号 | 本地进程（ChatLog 暴露 HTTP API / MCP），云端巡检按需消费，与云端隔离 | 合规本地解析，非云端爬虫 |

- 已知约束：One News 现有栈为小程序（前端）+ 后端服务；公众号本地解析为桌面/本地进程（与云端巡检分离，云端只消费其暴露的 API）。

## 4. 关键决策记录（2026-08-17 拍板）

| # | 决策 | 结论 |
|---|---|---|
| D1 | 部署形态 | **嵌入 One News**（复用现有栈，情报官作内部模块）|
| D2 | 技术栈 | **由我推荐 → Node.js + TypeScript 复用栈**（见 §3）|
| D3 | IM 渠道 | **仅小程序**（暂不做微信/WhatsApp 外推，只在 One News 内展示）|
| D4 | 需密钥源 | **暂不启用**（主链路用 RSS / 官方 API，密钥到位再开）|

> 结论影响：Channels 适配器本期只需实现「One News 小程序」一端；Fetcher 只需 RSS / API / 官网抓取 / 公众号本地四类适配器；不引入 NewsAPI / YouTube。
> 下一步：所有模块（§1–§9，其中 §9 初始化采集、§10 设计阶段小结）均已完成；设计文档 §0–§10 闭环，可进入实现期（见 §10）。

---

## 5. 抓取层设计（第 2 部分）

> 对应架构 §1.3 + 调研 §3。目标：以**统一接口**屏蔽各源差异，在「有则汇报」前提下做到稳定、低成本、可降级。

### 5.1 统一适配器接口
```
interface SourceAdapter {
  id: string
  fetch(since?: Date): Promise<Item[]>   // 返回归一化条目
}
interface Item {
  source: string
  title: string
  url: string
  publishedAt: Date
  author?: string
  summary?: string
  rawContent?: string
  guid: string            // 去重主键
  fetchMethod: 'rss' | 'api' | 'scrape' | 'wechat'
}
```
- 每个源 = 一个 adapter 实例（含端点 / 频率 / 解析规则）。
- 所有 adapter 输出统一 `Item` → 交给 Normalizer 去重入库。

### 5.2 RSSAdapter（覆盖 A/B/C/E 层 + 新闻站）
- 库：`rss-parser` + 原生 fetch；**必须处理 gzip/deflate**（`Content-Encoding`，实测 MarkTechPost / 机器之心因未解压一度失败）。
- 端点：The Rundown（beehiiv）、TLDR、Import AI / Ben's Bites、TechCrunch / VentureBeat / The Verge / Ars / MIT TR / MarkTechPost、量子位 / 新智元、Hugging Face。
- 增量：按 `publishedAt` 过滤已抓；去重：按 `guid` / `link`。

### 5.3 APIAdapter（社区 / 论文，无密钥或标准 OAuth）
- **Hacker News（Algolia）**：`search?query=&tags=story&numericFilters=points>阈值,created_at_i>起始时间戳`；**务必带 `created_at_i>` 时间窗**（否则返 2019 旧文，实测）。
- **arXiv**：`export.arxiv.org/api/query`，`cat:cs.AI/cs.CL/cs.CV`，**3 秒限速**，按 submittedDate 排序。
- **Reddit**（保留为 A 层候选源）：RSS `.rss` 免密钥（无评分）或 OAuth 100 QPM 非商用；源本身有效，落地换正常出口。

### 5.4 ScrapeAdapter（无 RSS 的官方博客）
- 库：`cheerio` 服务端解析，守 `robots.txt` 与速率；标注「官方一手」。
- 源与结构（实测 2026-08-17）：
  - **Anthropic News** → `anthropic.com/news`，列表含标题/日期/链接。
  - **Meta AI** → `ai.meta.com/blog/`，卡片列表。
  - **The Batch** → `deeplearning.ai/the-batch/`，`/the-batch/issue-NNN` 结构。
  - **The Neuron** → `theneurondaily.com/`，`/p/` 文章。
  - **机器之心** → `jiqizhixin.com/`（RSS 已转付费，个人订阅后可切 RSS）。

### 5.5 NewsRSSAdapter（Google News 兜底）
- `news.google.com/rss/search?q=QUERY`，支持 `when:7d` / `site:` 运算符；~100 条上限、重定向链接、无 SLA。
- 仅作关键词兜底聚合（如 "AI model release" / "LLM agent"），不替代一手源。

### 5.6 WeChatAdapter（公众号，合规本地）
- 本地进程（ChatLog / wechat_db_parser）解析本机微信 SQLite，暴露 HTTP API；**云端巡检只消费该 API**，不爬微信服务器。
- 备选：微信读书 API（需正文时）。
- 合规：仅个人订阅号、标来源、本地优先、可关停、路径失效静默降级。

### 5.7 横切关注点
- **去重 / 质量初筛**：Normalizer 按 guid/url 去重；过滤非 AI 噪声（如新闻站非 AI 频道混入）。
- **失败降级**：单源失败不影响整体巡检；失败源静默跳过 + 计数告警，不刷屏。
- **速率 / 礼貌**：RSS 用 ETag / If-Modified 复用；API 守各自限额；Scrape 限速。
- **时间窗**：HN / News / arXiv 均按时间窗拉增量，避免全量重抓。
- **与 One News 现有功能隔离（硬约束；2026-08-18 老赵明确大前提）**：
  - **底线：One News 原有的一切（页面、组件、云函数、配置、theme、阅读/订阅数据）一律不改、不污染、不复用其业务数据。** 情报官是叠加层，不是改造层。
  - 情报官的抓取/处理/存储一律**独立 pipeline + 命名空间隔离**（建议统一前缀 `intel_*`，如 `intel_sources` / `intel_issues` / `intel_profile`），与用户订阅的 One News RSS 同步、现有阅读数据解耦。
  - **复用能力必须显式标记 + 可分离**：凡复用 One News 的库代码 / 调用封装 / 基础设施，一律以 `intel` 命名空间或独立 module 包裹，调用处加注释标明「复用 One News X，非 One News 业务」，确保**随时可从当前架构整体摘除**，为后续彻底拆分做准备。
  - 复用 `rss-parser` 等库代码，但**不复用现有用户 feed 列表与队列**；情报官源故障（403/超时/官网抓取卡顿）静默降级，绝不向上游 One News 同步抛错或拖慢。
  - 新增 05/11/18 巡检 cron 与 One News 现有同步任务**错峰排期、独立失败隔离**。
  - LLM 阅读引擎以**独立「情报模式」**调用，prompt 与配额与正常阅读摘要**分账核算**，情报官跑满不挤占用户正常阅读。
  - 公众号本地进程零耦合，云端只消费其暴露的 API。

### 5.8 抓取完整性与超时防护（**serverless 适配，已定**）

> 背景（2026-08-18 确认）：**One News 后端为云函数，单次调用有硬超时上限**。因此**禁止在一次云函数调用内同步抓取全部 25 源**——会触发队头阻塞与整体超时，导致当日内容漏抓。

**核心架构：触发与执行解耦 + 按源分片**

```
[平台定时触发器 05/11/18]
        │ 极短云函数（仅生成任务 + 入队，毫秒级返回）
        ▼
   ┌──────────────────────────────┐
   │  消息队列 / 云函数异步调用     │  （每个源 = 1 条任务，或按适配器分组）
   └───────────────┬──────────────┘
                   │ 逐条触发（平台自动并发多实例）
                   ▼
   [Worker 云函数 ×N]   每实例只处理 1 个源，短生命周期
        fetch → normalize → 写 Store（带检查点）
```

- **触发器云函数**：仅做"生成当日巡检任务 + 入队/派发"，不触碰抓取，绝不超时。
- **Worker 云函数**：每实例处理**单个源**，时长 = 单源耗时（5–15s）<< 云函数超时上限，天然不超限。
- **总完成时间 = max(单源耗时) 而非 sum**——从架构上消除整体超时风险。

**五道完整性保障**：
1. **按源隔离 + 平台并发**：每实例 1 源，无队头阻塞。
2. **单源超时 + 重试**：RSS/API ≈ 5–8s、官网抓取 ≈ 10–15s、公众号本地 ≈ 5s；单源内重试 2 次（指数退避），仍失败则跳过本轮。
3. **每源增量检查点** `lastSuccessCursor`：每次只抓"上次成功之后"的新内容，跨 05/11/18 三次巡检自动续传。
4. **guid 幂等去重**：同一篇不重复、不漏。
5. **当日健康度**：某源当日三次全失败 → 18:00 小结标「待验证」+ 告警，绝不静默丢弃。

**⭐ owner 决策（2026-08-19 拍板，同步全员）：定时档位 = 固定节点无条件抓取**
- **每日 05/11/18 定时触发器一到，即无条件抓取全部启用源**（`intelFetch` 05:10/11:10/17:55 主编排 + `intelRssPoll` 05:15/11:15/18:00 兜底）。
- **不看 `lastFetchTime` / `pollSeconds` 间隔**：即使手动/其他途径刚抓过，定时档位到点仍照抓。手动抓取**不消费**定时档位的抓取机会。
- **反例（已废弃）**：先前 `intelRssPoll` 兜底用 `listDueFeeds` 按 `now - lastFetchTime ≥ pollSeconds(6h)` 判"到点才抓"，导致"手动抓过 → 定时档空转"的偏离。已改为 `listEnabledFeeds`（仅过滤 enabled + 非 disabled），移除间隔判定。（提交 `d85ae00`）
- **注意区分**：`lastSuccessCursor` 增量检查点（本条 #3）是**防重复**（只拉新内容、guid 去重），**不是**抓取节流开关——两者解开，互不冲突。
**⭐ 方案 A 落地（2026-08-19，RSS 增量兜底）**：`intelRssPoll` 的 rss/news 分支在 `fetchSource` 内，有 `lastSuccessCursor` 时把该游标转成 `sinceMs`，对解析出的 RSS 条目按 `pubDate` 过滤，只保留**游标之后的新增**，单源本轮最多取 `maxItems`（默认 30）条，历史旧文直接不进 ingest。触发仍无条件（fixed node），但**内容增量**——避免 `google_deepmind` 等源全量拉历史造成旧文淹没新文、空烧 LLM 额度。（提交 `d49441f`）


**完整性边界（写实）**：受源自身暴露量限制（RSS 多仅露最新 10–20 条、Google News ~100 上限、arXiv/HN 支持时间窗回溯），"当日完整"定义为**三次巡检成功结果的并集 + guid 去重**；超暴露上限部分标注为「尽力而为」。

**可观测**：每源记录 success/fail、延迟、lastSuccessAt、当日抓取条数；连续失败 N 次触发告警。

### 5.9 抓取提前量与准时发布（**已定**）

> 问题：目标节点（05/11/18）用户要"**准时看到内容**"，但抓取 + LLM 处理 + 渲染有耗时。若定时任务卡在 05:00 整触发，05:00 时内容还在 pipeline 里，看不到。

**方案：提前触发（lead time Δ） + 目标时刻发布闸门（release gate）**

1. **提前量 Δ（lead time）**：实际触发时间 = 目标时间 − Δ。
   - Δ 默认 **10 分钟**，按观测 p95 流水线耗时动态调（Δ = p95 + 缓冲）；18:00 汇总结案含"当日增量 + 汇总组装"，Δ 可略大（如 15 分钟）。
   - 05:00 窗口 → 触发器 ~**04:50**；11:00 → ~**10:50**；18:00 → ~**17:45–17:50**。
   - Δ 作为巡检参数存入 Config（§1.2），可热更新。

2. **发布闸门（Dispatcher 负责，见 §7）**：内容在 Δ 内提前处理完、落库并"**暂存**"；**到目标时刻 T 才置为可见 / 渲染到「AI 情报」页**。
   - T 前已完成 → 暂存，T 时刻准时呈现；
   - T 时仍未完成（极端超时）→ 完成后立即呈现并标「稍晚」+ 告警（不应发生，Δ 已留余量）；
   - 空内容 → 不发布（呼应"有则汇报、无则不打扰"）。

3. **流水线截止 SLA**：每个巡检设 deadline = 目标时间 T；监控 pipeline 实际耗时，超 p95 即告警并调大 Δ。

4. **新鲜度权衡（写实）**：提前触发意味着抓取截止点略早于 T（如 04:50 触发捕获到 04:50 的内容），损失 T 前几分钟的极少量新发。对每日情报场景可忽略；默认取"**准时优先**"。若追求极致新鲜，可把 Δ 压到 pipeline 实测最小值，但牺牲 deadline 余量——不推荐。

5. **与 §5.8 衔接**：提前触发仍走"触发器云函数（极短）→ 入队 → Worker 按源分片"，只是触发时刻前移 Δ；发布由 Dispatcher 在 T 时刻统一闸门，不在抓取层内联发布。

---

## 6. 处理层设计（第 3 部分）

> 对应架构 §1.2 的 Processor / Personalizer。目标：把归一化后的原始条目，转成符合 SOP 五步、带场景映射、中文可读的「今日关注 / 本周可试用清单」。这是情报官**唯一产生用户价值**的环节。

### 6.1 处理流程（一次巡检）

```
 新条目（Normalizer 去重后）
        │
        ▼
 ┌─────────────────────────────────────────────┐
 │ ① 相关性路由 Router（廉价模型 / 规则）       │
 │   按老赵画像 + 关注标签打分：高 / 中 / 低    │
 └──────────────┬──────────────┬───────────────┘
       高相关    │      中相关  │       低相关
        ▼        │       ▼      │        ▼
  ② 完整 SOP    │  ③ 轻量摘要  │   ④ 丢弃（仅入原始库，
  （强模型）     │  + 场景映射   │      不进今日关注）
        │        │       │      │
        └────────┴───┬───┘──────┘
                      ▼
  ⑤ 翻译（英文源→中文，术语统一）
  ⑥ 个性化过滤（画像 → 过滤/排序/场景强度）
  ⑦ 组装固定模板 → 入结果库（待 Dispatcher 编排）
```

> 设计要点：**不是每个条目都跑完整 SOP**。路由先筛，只把高相关跑强模型完整五步，中相关跑轻量版，低相关直接丢弃——这是成本与质量的平衡（详见 §6.6）。

### 6.2 SOP 五步（每个高相关条目的硬性结构）

| 步 | 名称 | 内容 | 约束 |
|---|---|---|---|
| 1 | **信息溯源** | 来源、发布时间、原文链接 | guid 可追溯；标注「待验证」若来源存疑 |
| 2 | **一句话定义** | 这东西是什么、能做什么、**能力边界** | 不夸大、不堆参数、不含糊其辞 |
| 3 | **场景映射** | 至少命中老赵三重身份之一（工作/产品/家庭）| 必须结合真实上下文，不空泛 |
| 4 | **可落地实操案例** | 工具 / 步骤 / 收益 / 坑点 | 老赵明天就能用 |
| 5 | **今日/本周最小行动** | 一个具体、可执行的下一步 | 可勾选、可复盘 |

### 6.3 固定输出模板（Markdown）

```markdown
🔹 今日关注

### [条目标题]
- **溯源**：[来源] · [发布时间] · [链接]
- **一句话**：[定义 + 能力边界]
- **对老赵的意义**：[工作/产品/家庭 至少一项映射]
- **可以怎么做**：[工具 + 步骤 + 收益 + 坑点]
- **最小行动**：[今日/本周可做的一件事]

🔹 本周可试用清单
- [ ] [条目 A]：5 分钟试一下 [具体动作]
- [ ] [条目 B]：把 [能力] 接到 [老赵的某个场景]
```

> 该模板同时是《项目指令》完整版的产出形态；极简版（字数受限字段）压缩为「标题 + 一句话 + 最小行动」三行。

### 6.4 场景映射（三重身份 → 信号权重）

| 身份 | 关注信号 | 映射示例 |
|---|---|---|
| **工作 · RCBC FRAML 合规 PM / TrustDecision 对接** | 监管/AML/制裁动态、AI 合规框架、供应商（TD）相关 AI 能力、数据/隐私合规 | 「某银行用 LLM 做交易监控」→ 映射到你做 FRAML 方案的合规边界 |
| **产品 · One News PD+FE / AI 阅读引擎 / RSS / theme.json** | AI 阅读/摘要增强、RSS 新能力、竞品、设计系统趋势 | 「某阅读器上线多视图摘要」→ 映射 One News AI 阅读引擎可借鉴点 |
| **家庭 · 装修 / 育儿 / 效率 / 自动化** | 智能家居、AI 育儿工具、个人自动化 | 「AI 布线/能耗规划」→ 映射你正在搞的装修；「自动化脚本」→ 个人效率 |

- **强度规则**：命中越多身份、越具体，排序越靠前；纯技术参数新闻若无法映射到任一身份 → 降级为低相关。
- **合同/接口变更特殊路由**（硬约束）：任何涉及「合同 / API / 接口 / 协议变更」的条目，在产出前**先走 `~/.workbuddy/whiteboard/commlog/` 广播**，再进入今日关注（见 §6.7）。

### 6.5 翻译策略

- 英文源 → 中文输出；**专有名词保留英文**（如 GPT-5、MCP、RAG），首现可括号注中文。
- 技术术语统一词表（如 agent=智能体、retrieval=检索、fine-tune=微调），避免一次一译。
- 不意译夸张措辞（"revolutionary" 不翻成"革命性"），保持务实基调。

### 6.6 LLM 调用、成本与缓存（分层路由）

> 这是对前文「是否每次全量跑完整 SOP」的决断：**采用分层路由，不全量跑**。理由：25 源每日新增量大，全跑强模型五步成本不可控；先廉价路由筛掉 70%+ 低相关，只对高相关上强模型。

| 层 | 动作 | 模型 | 成本 |
|---|---|---|---|
| Router 路由 | 相关性打分 + 提取关键事实 | 廉价模型 / 规则 | 极低 |
| 完整 SOP | 高相关条目走五步 + 场景 + 翻译 | 强模型（复用 One News 阅读引擎「情报模式」）| 主成本 |
| 轻量摘要 | 中相关：一句话 + 场景映射（跳过实操/最小行动展开）| 中模型 | 中 |
| 翻译 | 英文源术语统一翻译 | 随上层模型内联 | 摊薄 |

**缓存与节流**：
- **按 guid 缓存处理结果**：同一篇不重复处理（05/11 补抓、18:00 汇总都复用）。
- **增量处理**：每次巡检只进新条目；已处理的不再重跑。
- **批量**：同一巡检内多条合并为一次 prompt（few-shot / batch），降低调用次数。
- **成本预算**：单日 LLM 成本设硬上限（如 N 次强模型调用 / 日），超预算则降级为中模型或仅路由。
- **配额隔离**：走独立「情报模式」，与 One News 正常阅读摘要分账（呼应 §5.7）。

### 6.7 特殊路由：合同 / 接口变更 → commlog 广播

- 触发：Router 判定条目含「合同 / API / 接口 / 协议 / 价格 / SLA 变更」语义。
- 动作：**先于任何用户可见产出**，向 `~/.workbuddy/whiteboard/commlog/` 写一条广播（含来源、时间、变更摘要、影响面）。
- 目的：合同/接口变更属高敏、需可追溯，先留痕再呈现，避免遗漏与扯皮。

### 6.8 与现有 LLM 引擎的关系

- **无集中 LLM 网关**（校准：One News 各云函数经 `process.env.*_API_KEY` 各自调 LLM，如 qwen3.7-flash / zhipu glm-4-flash / deepseek）。情报官据此**新建独立 `intelProcess` 云函数**，复用同一套 LLM 调用封装但用独立 env key + 独立配额账本（即逻辑上的「情报模式」）：
  - 独立 system prompt（角色=AI 情报官+落地教练 + 老赵三重身份 + SOP 五步 + 固定模板）。
  - 独立配额与成本账（§6.6）。
  - 独立 prompt 版本管理，不与阅读摘要 prompt 互相污染。
- 处理失败（模型超时/限流）→ 该条目降级跳过，计入失败计数，不阻塞整次巡检。

---

## 7. 推送层设计（第 4 部分）

> 对应架构 §1.2 的 Dispatcher / Channels。目标：把处理层产出，**在正确的时间、以正确的形态**送到 One News「AI 情报」页。本期仅实现 One News 一端（决策 D3）。

### 7.1 职责边界

| 组件 | 职责 | 不负责 |
|---|---|---|
| **Dispatcher 推送编排** | 何时发（发布闸门）、发什么（增量/汇总）、组装 issue | 不抓取、不调 LLM |
| **Channels 渠道适配器** | 把 `RenderedIssue` 渲染到具体端 | 本期仅 One News 小程序 |

- Dispatcher 产出结构化 `RenderedIssue`（Markdown + 元数据）；Channel 只做"端适配"，便于将来接微信/WhatsApp 不重写 Dispatcher。

### 7.2 发布闸门（承接 §5.9）

- 处理层结果先 **staged**（落库、`releasedAt = null`）。
- 到目标时刻 T，Dispatcher 组装 issue 并升级 **`currentIssue` 指针**；「AI 情报」页只读 `currentIssue` → 用户准点看到。
- 升级前页面仍显示上一期（或空态），保证"未到点不剧透、到点准时出"。

### 7.3 三次巡检的编排差异

| 时点 | 模式 | 行为 |
|---|---|---|
| **05:00** | 增量 | 取 上次发布后新增且处理完的 items → 写/更新当日 brief 初版；无新增则不发布 |
| **11:00** | 增量 | 追加 05→11 新增 items 到当日 brief；无新增则不发布 |
| **18:00** | **汇总结案** | 从累积库组装**全天汇总**：今日关注 = 当日高/中相关 items；本周可试用清单 = 当周 tryable 滚动去重；升级为当日终版 |

- 18:00 后当日 brief 锁定；次日 05:00 起新建一份。
- 空内容（某次无新增）→ 不发布、不刷屏（呼应"有则汇报、无则不打扰"）。

### 7.4 滚动日报模型（rolling daily brief）

- 单日一份 `Brief`，由 `currentIssueId` 指针引用。
- 生命周期：05 初版 → 11 追加 → 18 全天汇总（终版）。
- 数据结构（详见 §8 数据模型）：`Brief { id, date, version, mode, items[], tryable[], generatedAt, sourceHealth[] }`。

### 7.5 输出组装：今日关注 + 本周可试用清单

- **🔹 今日关注**：当日高/中相关 items，逐条 SOP 五步卡片（溯源/一句话/场景映射/实操/最小行动），按场景命中强度排序。
- **🔹 本周可试用清单**：当周 `tryable=true` 的 items 滚动去重，渲染为可勾选清单（周一清零或按周滚转）。
- 模板严格复用 §6.3 固定格式；合同/接口变更条目（已在 §6.7 广播 commlog）在此作为高优先级置顶呈现。

### 7.6 Channels：本期仅 One News 小程序

- `RenderedIssue`（Markdown）→ `OneNewsChannel` → 「AI 情报」页渲染。
- **UI 约束**：复用 `theme.json` 设计令牌，**禁止新增 hex 色值**（项目硬约束）。
- **流程约束**：One News UI 须**先出方案确认再落地**（项目指令），故本设计只定义数据与渲染规范，像素级 UI 另出方案评审。
- 页面元素：今日关注卡片流 + 本周可试用清单 + 「数据截至 HH:MM」+ 源健康提示（失败源标「待验证」）。

### 7.7 健康度与兜底

- 源当日全失败 → 18:00 brief 顶部标「部分源今日未更新（待验证）」，不静默丢弃，也不伪造内容。
- 处理层大面积失败 → 出"今日无可靠更新"占位，避免空页。
- 发布失败（指针升级异常）→ 重试；仍失败则告警，下一期补发。

### 7.8 与后续扩展

- Channel 抽象已隔离：将来接微信/WhatsApp 只需新增 `WeChatChannel` / `WhatsAppChannel`，Dispatcher 与 issue 结构不变。
- 多端可独立开关（配置驱动），不影响本期 One News 主链路。

---

## 8. 数据模型、存储与运维（第 5 部分，收尾）

> 对应架构 §1.2 的 Store / Config。目标：把前面各模块的数据契约统一收口，并定义存储选型与运维告警。所有实体落在**独立命名空间**，与 One News 现有阅读数据物理隔离（呼应 §5.7）。

### 8.1 实体总览

| 实体 | 作用 | 关键字段 |
|---|---|---|
| **Source** | 信源配置 + 健康检查 | key, type, adapterConfig, lastSuccessCursor, health |
| **Item** | 抓取归一化后的原始条目 | guid, sourceId, url, publishedAt, rawContent |
| **ProcessedItem** | LLM 处理结果（SOP 五步）| relevance, sceneTags, sop, tryable, status |
| **Brief** | 当日滚动日报（发布单元）| date, version, mode, items, isCurrent |
| **UserProfile** | 用户画像（初始化收集）| identities, focusTags, locale |
| **InspectionRun** | 单次巡检执行记录 | targetTime, perSource[], durationMs, cost |
| **Config** | 全局配置 | schedule, leadTimeMin, costBudgetPerDay, flags |

### 8.2 实体 Schema（草案）

```ts
Source {
  key: string            // 稳定 ID，如 "tldr_ai"
  name: string
  layer: 'A'|'B'|'C'|'D'|'E'|'F'
  type: 'rss'|'api'|'scrape'|'news'|'wechat'
  adapterConfig: { endpoint, params, timeoutMs, rateLimit, headers? }
  defaultOn: boolean     // 默认清单是否开启
  enabled: boolean       // 用户可开关
  lastSuccessCursor: string|null   // §5.8 增量检查点
  lastFetchedAt: datetime|null
  health: { status:'ok'|'degraded'|'failed', consecutiveFails:int, lastError?:string }
}

Item {
  guid: string           // 去重主键（源内唯一）
  sourceId: string
  title, url, author?, summary?, rawContent?
  publishedAt: datetime
  fetchMethod: 'rss'|'api'|'scrape'|'wechat'
  fetchedAt: datetime
  contentHash?: string   // guid 不稳时辅助去重
}

ProcessedItem {
  itemId: string         // 关联 Item.guid
  relevance: 'high'|'medium'|'low'
  sceneTags: ('work_rcbc'|'product_onenews'|'life')[]
  sop: { source, definition, sceneMapping, practice, minAction }
  translated: boolean
  tryable: boolean       // 是否进「本周可试用清单」
  processedAt: datetime
  modelUsed: string
  cost: number
  status: 'staged'|'released'   // §7.2 发布闸门
  releasedAt?: datetime
}

Brief {                  // §7.4 滚动日报
  date: 'YYYY-MM-DD'
  version: int          // 05→11→18 递增
  mode: 'increment'|'summary'
  items: ProcessedItem[]    // 今日关注
  tryable: ProcessedItem[]  // 本周可试用清单（当周滚动）
  generatedAt: datetime
  sourceHealth: Source.health[]   // 快照，失败源标「待验证」
  isCurrent: boolean      // §7.2 currentIssue 指针
}

UserProfile {
  userId: string
  identities: { work, product, life }   // 三重身份（初始化收集，见需求 v1）
  focusTags: string[]
  locale: string
}

InspectionRun {
  targetTime: '05:00'|'11:00'|'18:00'
  triggerTime: datetime
  status: 'queued'|'running'|'done'|'partial'|'failed'
  perSource: [{ sourceId, status, itemCount, durationMs, error? }]
  durationMs: int
  cost: number
}

Config {
  schedule: ['05:00','11:00','18:00']
  leadTimeMin: 10        // §5.9 提前量（18:00 可 15）
  costBudgetPerDay: number
  flags: { wechatEnabled, newsRssEnabled, ... }
}
```

### 8.3 存储选型

- **复用 One News 现有数据库**（云数据库 / PG），新增独立命名空间集合/表（统一前缀 `intel_`，如 `intel_source` / `intel_item` / `intel_processed` / `intel_brief` / `intel_profile` / `intel_run` / `intel_config`）。
- 与现有阅读数据**物理隔离**（呼应 §5.7），不共享表、不共享队列；仅复用连接与鉴权基础设施。
- 消息队列（§5.8 按源分片）复用平台队列 / 云函数异步调用能力，任务载荷仅含 `sourceKey + targetTime`。

### 8.4 索引与去重

- `Item.guid` 唯一索引（源内）→ Normalizer 去重（§5.7）。
- `ProcessedItem.itemId` 唯一 → 按 guid 缓存、同篇不重处理（§6.6）。
- `Brief(date, isCurrent)` 索引 → 发布闸门 O(1) 指针升级（§7.2）。
- `Source.key` 唯一 → 配置热更新。
- `InspectionRun.targetTime` 索引 → 当日健康度聚合（§5.8）。

### 8.5 运维与监控

| 维度 | 指标 | 告警/动作 |
|---|---|---|
| 单源健康 | success/fail、延迟、lastSuccessAt、当日条数 | 连续失败 N 次 → 告警；超暴露上限标注「尽力而为」 |
| 巡检整体 | durationMs、cost、perSource 状态 | 超 deadline（§5.9）→ 调大 leadTime；成本超预算 → 降级中模型（§6.6）|
| 发布 | 指针升级成功否 | 失败 → 重试；仍失败 → 告警，下期补发（§7.7）|
| 公众号 | 本地解析进程存活 / API 可达 | 失效 → 静默降级，不阻塞（§5.6）|
| 合同/接口变更 | commlog 广播触发 | 业务留痕，先广播再呈现（§6.7），**非系统告警** |

- **监控面板**：每源当日成功率 + 当日 Brief 条目数 + LLM 成本日消耗。
- **降级总原则**：单点失败静默跳过、不刷屏；系统性失败出占位、给告警，不伪造内容。

### 8.6 与 One News 现有数据隔离（呼应 §5.7）

- 情报官全部读写落在 `intel_*` 命名空间；用户订阅的 One News RSS、阅读记录、摘要**完全不碰**。
- LLM 配额走独立「情报模式」账本（§6.6/§6.8），成本与正常阅读分账。
- 任何情报官故障（源 403/超时/官网抓取卡顿）→ 仅影响 `intel_*` 数据，绝不向上游 One News 同步抛错或拖慢。

---

## 9. 初始化与用户画像采集设计（第 6 部分）

> 对应需求文档硬约束：初始化个性化——「最终工具初始化时，需对个人具体信息作确认和收集」；默认取向「预设加自由」（决策：预设加自由、其它不补充）。目标：把"通用普通人内核 + 初始化个性化"落为一次性采集方案，驱动后续抓取（基线监控词）、处理（场景映射权重 §6.4）、推送（语言/渠道/深度）。本模块**不依赖 One News 现有代码**，是设计阶段可独立完成的一块。

### 9.1 采集时机
- 首次进入「AI 情报」模块触发**一次性初始化**；完成后写入 `UserProfile`，可随时在设置重改。
- 非阻塞：未初始化不报错，给"去设置"引导；未初始化时日报场景映射权重回退到**通用默认**（不报错、不出空页）。

### 9.2 采集内容（预设 + 自由）
| 组 | 字段 | 形式 |
|---|---|---|
| **A 身份角色** | `roles` | 多选预设 + 自定义：RCBC FRAML 合规 PM / TrustDecision 供应商对接 / One News PD+FE / 装修党 / 育儿 / 个人效率爱好者 |
| **B 关注领域** | `topics` | 多选预设 + 自由添加，驱动实时检索基线监控词（呼应 §6.4）：AI 合规与监管、AI 阅读/信息聚合产品、智能体 Agent、多模态、开源模型、家装智能化/家居自动化、育儿 AI 工具、个人效率/自动化、AI 安全与对齐…… |
| **C 语言与呈现** | `langPref` / `depth` / `wantTryable` | 输出语言：中文为主 / 中英均衡 / 保留英文原文；深度：轻量速览 / 标准 / 深度；是否要「本周可试用清单」 |
| **D 渠道与合规** | `channels` / `wechatOfficialEnabled` / `consentSigned` | 渠道开关（仅小程序默认开；微信/WhatsApp 预留关）；公众号本地解析启用勾选 + 个人使用合规告知确认 |

### 9.3 表单 → UserProfile 字段映射（呼应 §8.2）
```
UserProfile {
  userId, roles: string[], topics: string[],
  langPref: 'zh' | 'mixed' | 'en',
  depth: 'lite' | 'std' | 'deep',
  wantTryable: boolean,
  channels: { oneNews: true, wechat: false, whatsapp: false },
  wechatOfficialEnabled: boolean, consentSigned: boolean,
  updatedAt
}
```

### 9.4 与处理层衔接
- `roles` + `topics` → 注入 §1 实时检索**基线监控词**；并驱动 §6.4 场景映射权重（命中角色/领域则排序前移）。
- `langPref` → 决定 §6.5 翻译策略（zh 全译、mixed 保留术语、en 保留原文）。
- `depth` → 决定 §6.2 相关度路由后是否跑完整 SOP（lite 仅一句话+场景映射、deep 全 SOP+实操扩展）。
- `wantTryable` → 控制 §7.5「本周可试用清单」是否渲染。

### 9.5 存储与隔离
- `UserProfile` 落 `intel_user_profile`（独立命名空间，呼应 §5.7 / §8.3），与 One News 现有用户表隔离；读取走独立 query，不碰现有用户订阅数据。

### 9.6 合规告知（硬约束）
- 初始化首屏展示版权与隐私告知：公众号仅个人学习研究、不商用传播、内容标来源；`consentSigned` 勾选后才启用公众号本地解析（呼应 §6.4 六条合规）。

### 9.7 UI 约束
- 复用 `theme.json`、禁新增 hex（§7.6）；UI 先出方案确认再落地。

---

## 10. 设计阶段小结与下一步

- 本设计文档已覆盖：总体架构（§1）、部署形态（§2）、技术栈（§3）、抓取层（§5，含 §5.8 超时防护 / §5.9 准时发布）、处理层（§6）、推送层（§7）、数据模型与运维（§8）、初始化与用户画像采集（§9）。
- **设计阶段产出可交付实现**：所有模块边界、数据契约、可靠性与准时性保障、隔离约束、初始化个性化均已闭环；与需求文档 v1、信息源调研三份文档自洽。
- **下一步（进入实现期）**：① 信息源默认清单与适配器逐个落地联调；② One News「AI 情报」页 UI 方案评审（项目约束：先确认再落地、禁新增 hex）；③ commlog 广播接线（合同/接口变更先广播再呈现，硬约束）；④ 用 One News 真实代码/Notion 文档校准本设计中的假设项（见《OneNews_项目信息存档》第四节）。

