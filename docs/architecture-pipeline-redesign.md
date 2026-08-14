# 一页 One News · 采集-加工-发布流水线架构重构设计（v2.0）

> 状态：设计评审稿（待 owner 拍板后实施）
> 作者：FS 窗口 20260809-8K3MX4Q9V2N7
> 日期：2026-08-13
> 关联：Notion《统一多源新闻聚合技术架构方案》、COMMLOG 2026-08-13

---

## 0. 背景与目标

### 0.1 现状痛点（根因）
当前 `refreshNews` 把 **抓源 + 补正文(≤12s/条) + 校验 + 安全 + 质量 + AI摘要 + AI解读** 全塞进「每分类 1 次 120s worker」抢同一笔预算：

- `enrichDeadline = catStart + 55s`；正文一抓紧 → `Date.now()+3000 > deadline` 整条 `break`、摘要被 `Date.now()+8000 <= deadline` 跳过 → **漏网**。
- juhe/tianxing 抓取内联在 `refreshNews`（`sources/index.js` 注册表），官方 RSS 抓取在独立 `rssFetcher` —— **两处抓取、两套迭代**，扩源成本高。
- 加函数超时只是把墙推远，不解决「环节挤同一窗口」的本质。

### 0.2 目标（owner 8/13 拍板）
1. **完全解耦**：每个环节拆成独立任务，互不等靠。
2. **分批续跑**：单次任务处理不完 → 续跑批次，直到清空；**不再因 60s 中断**。
3. **统一抓取**：juhe/tianxing 完全移入抓取函数（改名 `newsFetcher`），每个源可独立成任务。
4. **100% AI 覆盖**：所有落库数据都经 AI 摘要 + AI 解读处理。
5. **`refreshNews` 退役**：前端下拉刷新改调 `newsFetcher`。

### 0.3 非目标
- ❌ 不靠「增大函数超时」解决吞吐。
- ❌ 不改 `news_cache` schema（前端零改动）。

---

## 1. 架构总览

```
┌─────────────┐  每个源 1 个独立 FETCH 任务（可并行扇出）
│  数据源      │  官方RSS(feed_meta) · juhe(各类) · tianxing(各类)
│ RSS/聚合API  │
└──────┬──────┘
       │ 归一化原始条目
       ▼
┌──────────────────────────────────────────────────────────────┐
│ Stage 0 · Fetch（newsFetcher，统一抓取）                       │
│  · 枚举所有源 → 每源 fan-out 成独立任务                         │
│  · 拉取 → 过滤/校验/去重 → 批量写 news_raw(status=pending)      │
│  · 单源过多带 cursor 续跑                                      │
└──────────────┬───────────────────────────────────────────────┘
               │ 消费 news_raw
               ▼
┌──────────────────────────────────────────────────────────────┐
│ Stage 1 · Process（newsProcessor，补全正文+质量门）            │
│  · 分批消费 news_raw(pending)                                  │
│  · 补全正文(fetchContent ≤12s/条) → 安全审核 → 质量评分+门控 → 去重  │
│  · pass → 写 news_staging(aiStatus=pending, 含 content)        │
│  · recommend 跨类借 top 组装(rec_，不消费原件)                  │
│  · 预算将尽自续跑                                              │
└──────────────┬───────────────────────────────────────────────┘
               │ 消费 news_staging
               ▼
┌──────────────────────────────────────────────────────────────┐
│ Stage 2 · AI（newsAI，纯 AI 零抓取）                           │
│  · 分批消费 news_staging(aiStatus=pending)                     │
│  · 混元前置：AI摘要 + AI解读 + 一页说观点                       │
│  · 官方源 AI 跑在原文上；raw 原文不落库，解读正文/短导语保留（合规） │
│  · 单条独占预算，跑不完留 pending 下轮重试                      │
└──────────────┬───────────────────────────────────────────────┘
               │ aiStatus=done
               ▼
┌──────────────────────────────────────────────────────────────┐
│ Stage 3 · Publish（newsPublisher，落库）                       │
│  · 取 aiStatus=done 的 staging → 现有 batchInsert 写 news_cache│
│  · 增量发布；发布后删 staging；gradedCleanup TTL 维持新鲜       │
└──────────────┬───────────────────────────────────────────────┘
               ▼
         ┌─────────────┐
         │  news_cache  │ ← getNewsList / getNewsDetail / getNewsDelta 读取（schema 不变）
         └─────────────┘

续跑机制：每个 Stage 内部 while(有活 && 剩余预算>阈值){取一批处理}；
          循环结束前若仍有 pending → cloud.callFunction(本函数,{continuation:true}) 再起实例接手。
          60s = 调度片，不是吞吐墙。状态机(pending/done)保证幂等、重跑不重复。
```

---

## 2. 集合（DB）角色重划

| 集合 | 角色 | 说明 | 取代 |
|---|---|---|---|
| `news_raw` | 抓取输出（瞬时） | 所有源归一后的原始条目，`status=pending/consumed`，6h TTL 兜底 | `news_ingest` + `news_raw_official` |
| `news_staging` | AI 待处理（瞬时） | 过质量门条目，`aiStatus=pending/done`，带 `content`（AI 原料），6h TTL | （新增） |
| `news_cache` | 已发布（持久） | 前端读取，**schema 完全不动** | — |
| `news_ingest` | **删除** | 合并进 `news_raw` | — |
| `news_raw_official` | **删除** | 合并进 `news_raw` | — |

---

## 3. 四个 Stage 详细设计

### 3.0 Stage 0 · Fetch（newsFetcher，统一抓取）

**职责**：接管官方 RSS + juhe + tianxing，统一归一后写 `news_raw`。

**拆分粒度（满足「每个源独立任务」）**：
- `event.mode = 'orchestrate'`：枚举所有「到点源」（官方 `feedStore.listDueFeeds` + juhe 各类 + tianxing 各类），对每个源 `cloud.callFunction('newsFetcher', { mode:'fetch-source', source })` **并行扇出**；编排器快速返回。
- `event.mode = 'fetch-source'`：抓**单个源**，归一化，批量写 `news_raw(pending)`；单源返回过多带 `cursor` 续跑。

**源适配器统一**：复用现有 `refreshNews/sources/index.js` 的 `SOURCE_ADAPTERS` 注册表（juhe/tianxing），官方 RSS 走 `rssFetcher/utils/*`。三套源归一为同一 shape：

```
{ sourceType, sourceId, sourceName, category, categoryName,
  title, url, urlFp, titleFp, summary, content(可选), publishTime }
```

**合规**：官方 RSS 在 Fetch 阶段**只写 title/url/summary**（不抓全文，与现有 `news_raw_official` 一致）；全文抓取移到 Stage 1（瞬时、发布即删）。

### 3.1 Stage 1 · Process（newsProcessor，补全正文 + 质量门）

**职责**：`news_raw(pending)` → 补全正文 → 安全审核 → 质量评分+门控 → `news_staging(aiStatus=pending)`。

- 分批拉 `news_raw(pending)`（游标/cursor 保证续跑不重复）。
- 逐条：`fetchContentForItem`（≤12s/条，仅当正文缺失时抓源站 HTML）→ 安全审核 → **质量评分+门控**（qualityScorer.scoreAll，见 3.1.1）→ 去重(urlFp/titleFp)。
- pass：写 `news_staging`（含 `content` 作 AI 原料）+ 标 `news_raw` 为 `consumed`。
- `recommend`：正常条目 staging 后，跨类借 top 组装 `rec_` 前缀条目（**借用不消费**原件，避免饿死原生分类）。
- 预算将尽（`Date.now()+SLICE > deadline`）→ 自续跑。

### 3.1.1 质量筛选旋钮与 ⑥ 合规门禁（2026-08-14 owner 终值）

质量筛选在 Stage 1 安全审核之后调用 `qualityScorer.scoreAll()`，按 `passed` 分流：
- **幸存者** → 写 `news_staging`（带 `finalScore/qualityScore/heatScore/eventId`），进 Stage 2 AI；
- **被门控丢弃者**（低质 / 噪音比超阈 / 合规硬黑名单命中）→ 不写 staging、不进 AI、不展示。

旋钮终值（与 qualityScorer.js 常量一致，owner 拍板维持/确认）：
- 门控阈值：`minQuality=40`、`maxNoiseRatio=0.4`（维持现状）。
- 5 维权重：来源权威 0.25 / 内容完整 0.20 / 时效 0.15 / 文本质量 0.15 / 去重唯一 0.10（不调整）。
- 来源权威表 `SOURCE_AUTHORITY`：四家央媒(中新/人民/央视/新华)=100、聚合 `DEFAULT_AGG=60` 等，确认覆盖现有源（无需额外调整）。
- 热度融合：保留 `HeatScore = (eventHeat + topicHeat + engagement) × 衰减`，`FinalScore = 0.6·Quality + 0.4·Heat`。
- 评分位置：安全审核之后（owner 同意）。
- 丢弃语义：门控丢弃者彻底不进 AI、不展示（省预算 + 符合「前端只展示已过 AI 条目」诉求）。

⑥ 合规门禁（2026-08-14 拆分为软/硬两类）：
- **硬黑名单** `COMPLIANCE_HARD_BLACKLIST` = 早先整理的**敏感词汇过滤表** `SENSITIVE_WORDS`（PRD §4.4 五大类：涉黄/涉政/暴力/辱骂/广告spam），命中即丢弃，不进评分、不进 news_cache，不进 AI。与 `feedback-create` 共用同一权威源。
  - **维护口径（公共层）**：权威单一真相源 = `common/sensitiveWords.js`；`newsPipeline`/`feedback-create` 各函数 `utils/sensitiveWords.js` 为 `tools/sync-common.sh` 生成的**平铺副本**（CloudBase 只打包函数自身目录，不做运行时跨函数 require）。**只改 common/ 一处** → `bash tools/sync-common.sh --apply` → 重新部署受影响云函数。
- **软信号** `COMPLIANCE_SOFT_SIGNALS`（版权搬运/纯导流弱信号，如 `全文转载`/`未经授权转载`/`授权转载请联系`/`不得转载`、本站独家/原创、`点击下方关注`/`关注我们`/`后台回复`/`公众号内回复` 等）：保留检测，**不硬丢弃**，进入评分并降权（`COMPLIANCE_SOFT_PENALTY=15`），由整体质量门决定是否展示。
- 敏感词的 AI 语义层（涉政大语境）由 `msgSecCheck`（securityCheck，联网审核）另行处理；本表只负责可客观判定的敏感词本地硬拦截（秒级、无网络依赖、兜底）。

### 3.2 Stage 2 · AI（newsAI，纯 AI 零抓取）

**职责**：`news_staging(aiStatus=pending)` → AI 摘要 + AI 解读 + 一页说。

- **混元前置引擎链**（已验证）：混元 → 智谱 → Qwen → DeepSeek。
- 摘要先于解读执行（列表关键）；解读 25s 独立预算 + best-effort 守卫。
- 官方源：`contentSource` 保持 `official_rss`（前端「出处 ↗」），AI 跑在原文上；**raw 原文不落库，解读正文/短导语均保留**（合规红线，2026-08-14 修订）。
- 纯 AI、零网络抓取 → 不再被「补正文」挤预算；单条独占预算，跑不完留 `pending` 下轮重试。
- 写回 `aiStatus=done` + `summary`/`summarySource='ai'`/`aiOpinion`/`contentSource`。

### 3.3 Stage 3 · Publish（newsPublisher，落库）

**职责**：`news_staging(aiStatus=done)` → 现有 `batchInsert` 写 `news_cache` → 删 staging。

- 复用现有 `batchInsert`（幂等 update/add + 旧 AI 摘要优先逻辑），**schema 零改动**。
- 增量发布；`gradedCleanup` TTL 维持新鲜度。
- 可独立成任务，也可在 Stage 2 每批内联（推荐内联以减少一次云函数跳转；若严格「每环节独立任务」则单列）。

### 3.4 recommend 处理
`recommend` 无原生 RSS 栏目，在 Stage 1 末尾跨类借 top 组装 `rec_` 条目进 `news_staging`，与正常条目走同一 AI + 发布链路（不重复消费原件）。

---

## 4. 续跑 / 分批机制（解决 60s 的根本方案）

每个 Stage 函数内部统一骨架（伪代码）：

```js
const SLICE_MS = 8000          // 预留给续跑实例启动的缓冲
exports.main = async (event) => {
  const deadline = Date.now() + BUDGET_MS - SLICE_MS
  let pending = true
  while (pending && Date.now() < deadline) {
    const batch = await pullBatch(event.cursor)   // 按 status 拉一批
    if (!batch.items.length) break
    await processBatch(batch.items)               // 本 stage 业务逻辑
    event.cursor = batch.nextCursor
    pending = batch.hasMore
  }
  if (pending) {
    await cloud.callFunction({ name: process.env.THIS_FUNC, data: { ...event, continuation: true } })
  }
  return { ok: true, done: !pending }
}
```

- **状态机**：`news_raw.status = pending → consumed`；`news_staging.aiStatus = pending → done`。天然幂等、重跑不重复。
- **drain 兜底 trigger**：每 Stage 除续跑链外，再加一个定时「drain」触发器（如每 3 分钟），捞残留 `pending` 兜底消费，防止续跑链异常中断导致堆积。
- **60s = 调度片**：单实例只处理一批切片，队列清空才算完 → 100% 覆盖。

---

## 5. 字段契约

### 5.1 `news_cache`（不变，前端契约）
沿用现有 `batchInsert` 落库字段：`id / title / url / summary / summarySource('ai'|'desc'|'title'|'content') / content / contentSource / category / categoryName / source / sourceUrl / publishTime / aiOpinion / references` 等。**前端零改动。**

### 5.2 `news_raw`（新增，取代 news_ingest + news_raw_official）
| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | 文档 id |
| `sourceType` | string | `official_rss` / `juhe` / `tianxing` |
| `sourceId` | string | 源标识（feed._id 或 `juhe`/`tianxing`） |
| `sourceName` | string | 展示名 |
| `category` | string | 前端分类 id |
| `categoryName` | string | 分类展示名 |
| `title` | string | 标题 |
| `url` | string | 源站链接 |
| `urlFp` / `titleFp` | string | 去重指纹 |
| `summary` | string | 源站导语（RSS 自带 / 聚合返回） |
| `content` | string? | 全文（仅聚合源有；官方源 Stage1 补；瞬时） |
| `publishTime` | string | 发布时间 |
| `status` | string | `pending` / `consumed` |
| `fetchedAt` | string | 入库时间 |
| `expireAt` | string | 6h TTL |

### 5.3 `news_staging`（新增，AI 待处理）
| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | 文档 id（与 news_raw 同源可追溯） |
| `...源字段` | — | 继承 news_raw 全部业务字段 + `content` |
| `aiStatus` | string | `pending` / `done` |
| `summary` | string | AI 摘要（Stage2 写） |
| `summarySource` | string | `ai` |
| `aiOpinion` | string | 一页说观点（Stage2 写） |
| `contentSource` | string | 发布时官方源=`official_rss`，其余=`ai_interpretation`/`ai_summary` |
| `expireAt` | string | 6h TTL |

---

## 6. 合规红线（不变）

- 官方源 raw 全文只在 `news_raw` + `news_staging` **瞬时**存在（抓取即删）；`news_cache` 存 `summary` + **解读正文/短导语**（`content` 保留，红线下只禁 raw 全文），不长期缓存源站全文。
- 不展示原文、不缓存 raw 全文、只跳源站 H5（与现有 A.4/A.5 一致）。

---

## 7. 函数接口与事件 schema

| 函数 | event.mode | 说明 |
|---|---|---|
| `newsFetcher` | `orchestrate` | 枚举到点源 → 并行扇出 `fetch-source` |
| `newsFetcher` | `fetch-source` | 抓单个源 → 写 `news_raw(pending)`，多则 `cursor` 续跑 |
| `newsProcessor` | `run` / `continuation` | `news_raw → news_staging` |
| `newsAI` | `run` / `continuation` | `news_staging → aiStatus=done` |
| `newsPublisher` | `run` / `continuation` | `news_staging(done) → news_cache` |

> `refreshNews` 退役；前端下拉刷新调用 `newsFetcher({ mode:'orchestrate' })`。

---

## 8. 配置 / 触发器 / 环境变量

- **环境变量开关**（灰度切流）：
  - `OFFICIAL_RSS_ENABLED`（已有，官方 RSS 抓取总开关）
  - `JUHE_API_KEY` / `TIAN_API_KEY`（已有，juhe/tianxing 启用判定）
  - `PIPELINE_MODE = 'legacy' | 'new'`（切流开关：new=新流水线接管；legacy=旧 refreshNews 仍跑对比）
  - AI 引擎 key（`HUNYUAN_*` / `ZHIPU_*` / `DASHSCOPE_*` / `DEEPSEEK_*`）沿用现有注入
- **触发器**：
  - `newsFetcher(orchestrate)`：每小时（编排器按各源 `pollSeconds` 判定到点）
  - `newsProcessor` / `newsAI` / `newsPublisher`：续跑链 + 每 3 分钟 `drain` 兜底
  - 过渡期：`refreshNews` 保留 `legacy` 模式并行跑，对比验证后关闭

---

## 9. 迁移路线（重核验 · 4 步，每步带开关 + 双写可回滚）

1. **统一抓取（Stage 0）**：扩展 `rssFetcher` → `newsFetcher`，抓官方+juhe+tianxing → 写 `news_raw`；旧 `refreshNews` 暂并行（双写对比）。✅ 可独立验证：看 `news_raw` 是否全源归一。
2. **上 `newsProcessor`（Stage 1）**：`news_raw → news_staging`；`PIPELINE_MODE` 控制是否接管 AI 上游。
3. **上 `newsAI` + `newsPublisher`（Stage 2/3）**：`staging → news_cache`，混元前置 + 续跑；开关控制。
4. **切流**：关 `legacy` 模式、清 `news_ingest`/`news_raw_official`、前端改调 `newsFetcher`、COMMLOG 广播。

每步可独立回滚（关开关即回退旧链路）。

---

## 10. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 续跑链异常中断 → 堆积 | drain 兜底 trigger 每 3 分钟捞残留；6h TTL 自动过期 |
| 新流水线 AI 质量波动 | `PIPELINE_MODE=legacy` 并行双写对比，达标再切 |
| 官方源合规误判 | raw 原文不落库（news_raw 抓取即删）；news_cache 只存 AI 解读/短导语，绝不存 raw 全文 |
| 云函数配额升高（扇出增多） | 每源独立任务天然限流；drain 低频兜底 |

---

## 11. 验收标准

- [ ] 所有源（官方 RSS + juhe + tianxing）经 `newsFetcher` 统一抓取进 `news_raw`。
- [ ] `news_cache` 中 `summarySource='ai'` 覆盖率 = 100%（有正文条目）；`ai_interpretation` / `aiOpinion` 全量覆盖。
- [ ] 无因 60s 超时导致的「整条跳过 / 摘要缺失」；队列清空即完成。
- [ ] `news_ingest` / `news_raw_official` 已删除；`news_cache` schema 零改动、前端无回归。
- [ ] 续跑链 + drain 兜底稳定运行 24h 无堆积。
