# AI 情报官 · 复用审计（Reuse Audit）

> 目的：在写后端 Phase 1 之前，把 One News 克隆仓库中**可复用的抓取/处理基础设施**逐一定位、评估复用方式，产出一份「复用映射表 + 可抄代码骨架」，作为 A（适配器）/ I（基础设施）角色的直接输入。
> 审计对象：已克隆的 `One-News` 仓库（`/root/.codebuddy/artifact/onenews-clone`）。
> 硬前提（不可动摇）：One News 原有代码**一律不改**；复用项必须 `intel_*` 命名空间隔离、可整体摘除。

---

## 一、结论速览

| 维度 | 结论 |
|---|---|
| 超时规避范式 | ✅ **直接复用** `refreshNews` 的 self-fan-out 分片（已实测验证 60s 墙下可用） |
| 按源抓取范式 | ✅ **直接复用** `rssFetcher` 的 per-source worker（开关/自愈/调度/告警全齐） |
| 官网正文抓取 | ✅ **直接复用** `common/contentFetcher.js`（`fetchWebPage`+`extractContentFromHtml`，零依赖、含 GBK 解码，比 cheerio 更轻） |
| 去重/校验/质量门 | 🟡 **部分复用** `fingerprint`/`filter`/`validator`/`securityCheck`/`qualityScorer` |
| LLM 引擎链 | 🟡 **复用模式不复用实例**：「混元→智谱→Qwen→DeepSeek」降级链写法可抄，但走独立 `intelProcess` + 独立 Key |
| 25 源注册表 | 🆕 **自研**（仿 `seedFeeds` 幂等播种范式），覆盖 RSS/API/官网/公众号四类 adapter |
| LLM 处理（SOP 五步） | 🆕 **自研** `intelProcess`（采集→筛选→关联→生成→推送），与 One News 摘要/解读职责不同 |
| 数据集合 | 🆕 **新建** `intel_*` 独立集合（不复用 `news_cache`/`news_ingest`） |
| 定时触发器 | ✅ **复用** config.json `triggers` 格式（05/11/18 三档，错峰排期） |

**一句话**：One News 已经把「云函数 60s 硬超时下如何完整抓取」这件事踩平了（self-fan-out + 按源 worker），情报官直接站在它肩膀上，只改命名空间、不碰它的业务数据。

---

## 二、One News 现有资产盘点（已读真码）

| 文件 | 职责 | 情报官复用价值 |
|---|---|---|
| `cloudfunctions/refreshNews/index.js` | 编排器/worker 双模 + self-fan-out 分片 + 写库幂等 + 分级清理 + 备份快照 | **架构范式核心** |
| `cloudfunctions/rssFetcher/index.js` | 官方 RSS 按源 worker：全局/单源开关、自愈建表、幂等播种、`listDueFeeds` 调度、四类告警 | **按源抓取范式核心** |
| `common/contentFetcher.js` | `fetchWebPage`（UA+重定向+2MB+GBK）、`extractContentFromHtml`/`locateBodyHtml`、`fetchContentForItem`、`isInvalidDesc`、`enrichNewsList` | **官网抓取 + 正文清洗核心** |
| `cloudfunctions/rssFetcher/utils/{apiFetch,rssParser,filter,fingerprint,feedStore,newsStore,newsIngestStore,initSchema,notify,qualityScorer,seedFeeds}.js` | RSS 抓取各子能力 | 按源 worker 配套 |
| `cloudfunctions/refreshNews/{validator,securityCheck,utils/qualityScorer,utils/newsIngestStore,config}.*` | 校验、安全审核、质量评分、入库暂存、配置 | 质量门/安全/配置范式 |
| `config.json`（各云函数） | `timeout/memorySize/triggers(timer)` | 触发器格式 |

---

## 三、复用映射表（核心交付）

> 复用方式图例：🟢 直接复用（复制并改 `intel_` 命名空间）｜🟡 改写法复用（复用函数但改调用上下文/集合）｜🔴 仅复用模式（自研，借鉴写法）｜🆕 自研

| # | 情报官需求 | One News 对应项 | 复用方式 | 隔离标记 |
|---|---|---|---|---|
| 1 | 60s 超时下完整抓取 | `refreshNews` self-fan-out（`main` 编排模式 fire-and-forget 调自身 N 次） | 🟢 直接复用 | `intelFetch` 独立云函数 |
| 2 | 按源隔离+并发+单源超时重试 | `rssFetcher.runWorker` per-source 模式 | 🟢 直接复用 | `intelRssPoll` 独立云函数 |
| 3 | 官网正文抓取（Anthropic/Meta/The Batch/The Neuron/机器之心） | `common/contentFetcher.js` `fetchWebPage`+`extractContentFromHtml` | 🟢 直接复用（零依赖） | 复制到 `intel/common/contentFetcher.js` |
| 4 | 增量游标续传（跨巡检） | `feed_meta.lastFetchTime/etag/lastModified` + `listDueFeeds(now)` | 🟢 直接复用 | `intel_source_meta` 集合 |
| 5 | guid/url 幂等去重 | `rssFetcher/utils/fingerprint`（urlFp/titleFp）+ `newsStore.filterDuplicates` | 🟢 直接复用 | 改写入 `intel_ingest` |
| 6 | 栏目/标题过滤 | `rssFetcher/utils/filter` + `validator` | 🟡 改写法复用 | 改 allowCategories 为情报相关度配置 |
| 7 | 内容安全审核 | `refreshNews/securityCheck` | 🟡 改写法复用 | 独立 `intelSecurityCheck` 调用 |
| 8 | 质量/噪音评分 | `refreshNews/utils/qualityScorer` | 🟡 改写法复用 | 仅借用打分骨架，阈值按情报调 |
| 9 | 假摘要检测 | `contentFetcher.isInvalidDesc` | 🟢 直接复用 | 同 3 一并复制 |
| 10 | LLM 引擎降级链 | `summarizeWithZhipu`/`interpretNews` 的「混元→智谱→Qwen→DeepSeek」链 + 半开连接强制超时兜底 | 🔴 仅复用模式 | 独立 `intelProcess` + 独立 Key |
| 11 | 写库幂等 upsert | `refreshNews.batchInsert`（按 id 存在则 update 保留 _id/createdAt） | 🟢 直接复用 | 改写入 `intel_cache` |
| 12 | 发布闸门（staged→isCurrent） | 无直接对应（One News 无"定时发布"概念） | 🆕 自研 | `intel_cache.isCurrent` 指针 |
| 13 | 25 源注册表 | `rssFetcher/utils/seedFeeds.js` + `seedFeeds.json` 幂等播种 | 🆕 自研（仿范式） | `intel_source_meta` 集合 |
| 14 | 健康度/告警 | `rssFetcher` 四类告警（空周期/重复率/批量/质量门）+ `system_kv` 自检 | 🟡 改写法复用 | `intel_health` 集合 |
| 15 | 定时触发器 | `config.json` `triggers:[{type:"timer",config:"0 0 * * * * *"}]` | 🟢 直接复用格式 | 3 个独立 trigger（05/11/18） |
| 16 | 备份兜底 | `refreshNews.backupToCacheBackup` 快照 | 🟢 直接复用 | 改写入 `intel_cache_backup` |

---

## 四、关键范式移植说明

### 4.1 self-fan-out 分片（对应设计 §5.8）
`refreshNews/main` 的判定逻辑（已实测）：
- `event.category` 存在 → **worker 模式**：跑单源/单组完整流水线，独占 60s。
- 否则 → **编排模式**：`CATEGORIES.forEach(c => cloud.callFunction({name:'refreshNews', data:{category:c, shard:true}}))`（fire-and-forget，不 await），立即返回「已触发」。
- worker 各自独立实例写库，编排器只做全局清理 + 写刷新时间戳。

情报官 `intelFetch` 完全照搬：把 `CATEGORIES` 换成 `intel_SOURCE_GROUPS`（按 25 源分 5–15 组，每组 ≤15s），编排器并行扇出 worker。

### 4.2 按源 worker（对应设计「按源隔离 + 单源超时重试」）
`rssFetcher.runWorker` 已包含：304/etag 复用、`listDueFeeds` 频率调度、`filterDuplicates` 去重、双写暂存、四类告警。情报官 `intelRssPoll` 照搬结构，但：
- 写库目标改为 `intel_ingest`（不复用 `news_ingest`）。
- 四类 adapter（RSS/API/官网/公众号）在 worker 内按 `sourceType` 分支。

### 4.3 官网正文抓取（零依赖，比 cheerio 更轻）
`common/contentFetcher.js` 的 `fetchWebPage` + `extractContentFromHtml` 已含：UA 伪装、301/302 跟随、2MB 上限、GBK/GB2312 解码（`TextDecoder`/`iconv-lite` 兜底）、`locateBodyHtml`（多站点正文容器正则）+ `trimExtraneousContent`（截断"延伸阅读"噪音）。**直接复制到 `intel/common/contentFetcher.js` 即可**，官网抓取不再需要 cheerio 依赖。

### 4.4 LLM 引擎链（仅复用模式）
One News 的降级链写法值得抄：有序 providers 列表 + 每引擎 2–3 次重试 + 独立强制超时兜底（防半开连接永久挂起）。但情报官**不复用其 `config.zhipuSummary` 等 Key**，改走独立 `intelProcess` 云函数 + 独立 `INTEL_LLM_*` 环境变量（设计 §6 要求「独立 key、分账核算」）。

---

## 五、可抄代码骨架（A/I 角色直接照抄）

### 5.1 目录结构（全部独立 `intel/` 命名空间）
```
cloudfunctions/
├── intelFetch/              # 编排器+worker 双模（仿 refreshNews self-fan-out）
│   ├── index.js             # 复用 §4.1 判定骨架
│   ├── config.js            # 独立配置（不含 One News 任何 Key）
│   └── utils/
│       ├── contentFetcher.js# 从 common/contentFetcher.js 复制（零依赖）
│       ├── sourceStore.js   # 从 rssFetcher/utils/newsIngestStore.js 改写入 intel_ingest
│       └── idempotent.js    # 从 refreshNews batchInsert 复制（按 id upsert）
├── intelRssPoll/            # 按源 worker（仿 rssFetcher，写 intel_ingest）
│   ├── index.js
│   ├── utils/{apiFetch,rssParser,filter,fingerprint,feedStore,seedFeeds,notify}.js
│   └── seedSources.json     # 25 源注册表（仿 seedFeeds.json）
├── intelProcess/            # LLM 处理（自研 SOP 五步）
│   ├── index.js
│   └── config.js            # 独立 INTEL_LLM_* Key
├── intelPush/               # 推送/发布闸门（自研 §5.9）
└── common/
    └── contentFetcher.js    # 与 intelFetch 共用（或直接引用 One News 的，只读不写）
```

### 5.2 `intelFetch/index.js` 编排器骨架（复用 refreshNews 判定）
```js
// INTEL-MODULE: 情报抓取编排器/worker（最小可摘除，仿 refreshNews v8 self-fan-out）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const { INTEL_SOURCE_GROUPS } = require('./config')   // 25 源分组（每组 ≤15s）

exports.main = async (event) => {
  // worker 模式：event.group 存在 → 跑单组流水线（独占 60s）
  if (event && event.group) {
    const r = await runGroupPipeline(event.group)
    return { code: 0, group: event.group, ...r }
  }
  // 编排模式：并行扇出（fire-and-forget，不 await）
  console.log('[intelFetch] 触发', INTEL_SOURCE_GROUPS.length, '组（后台执行）')
  INTEL_SOURCE_GROUPS.forEach(g =>
    cloud.callFunction({ name: 'intelFetch', data: { group: g } })
      .then(res => console.log(`[intelFetch][${g}] 完成`, res.result))
      .catch(err => console.warn(`[intelFetch][${g}] RPC 超时（实例仍在后台运行）`, err.message))
  )
  return { code: 0, message: '情报抓取已触发', async: true }
}
```

### 5.3 `intelRssPoll/utils/seedSources.json` 范式（复用 seedFeeds 幂等播种）
```json
[
  { "_id": "intel_anthropic", "name": "Anthropic News", "sourceType": "official_site",
    "baseUrl": "https://www.anthropic.com/news", "enabled": true,
    "pollSeconds": 21600, "category": "ai_research", "allowCategories": ["AI","研究"] }
  // ... 其余 24 源（RSS/API/官网/公众号 四类）
]
```
> 播种逻辑照搬 `seedFeeds.js`：已存在则跳过（不覆盖灰度配置），保证可重跑、可摘除。

### 5.4 定时触发器（复用 config.json 格式）
`cloudfunctions/intelFetch/config.json`：
```json
{
  "timeout": 120, "memorySize": 256,
  "triggers": [
    { "name": "intel0500", "type": "timer", "config": "0 50 4 * * * *" },
    { "name": "intel1050", "type": "timer", "config": "0 50 10 * * * *" },
    { "name": "intel1745", "type": "timer", "config": "0 45 17 * * * *" }
  ]
}
```
> 与 One News 的 `hourlyRefresh`/`rssPoll` 错峰排期、独立失败隔离（设计 §5.8）。

---

## 六、隔离落地清单（可整体摘除）

| 隔离项 | 做法 |
|---|---|
| 命名空间 | 所有情报官云函数/集合/变量以 `intel_` 前缀；调用 One News 复制品时加注释「复用 One News X，非其业务」 |
| 数据集合 | 新建 `intel_ingest` / `intel_cache` / `intel_cache_backup` / `intel_source_meta` / `intel_user_profile` / `intel_push_task` / `intel_health`，**不复用** `news_cache`/`news_ingest`/`feed_meta` |
| 触发器 | 独立 `intel0500/1050/1745`，与 One News 触发器无交集 |
| LLM Key | 独立 `INTEL_LLM_*` 环境变量，`intelProcess` 专享，与 One News `ZHIPU_API_KEY` 等分账 |
| 故障隔离 | 情报源故障（403/超时/官网抓取卡顿）静默降级，绝不向上游 One News 同步抛错或拖慢 |
| 摘除 | 删 `cloudfunctions/intel*` + `intel_*` 集合 + 3 个 trigger → 仓库完全回到「只含 One News」 |

---

## 七、与既有设计文档对应关系

| 本审计结论 | 设计文档 |
|---|---|
| self-fan-out 分片 | §5.8 超时防护（已用真码强验证） |
| 按源 worker + 增量游标 | §5.8 解耦触发/按源隔离/检查点续传 |
| 准时发布 + 发布闸门 | §5.9 提前量 Δ + isCurrent 指针 |
| 独立 intelProcess + 独立 Key | §6 处理层（LLM 与 One News 分账） |
| 四类 adapter（RSS/API/官网/公众号） | 调研文档 §3 差异化抓取 |
| 复用须标记隔离、可摘除 | §5.7 隔离硬约束 |

---

## 八、下一步（Phase 1 可直接开干）

按本审计，Phase 1 基础设施（T1.1–T1.4）可**直接写真码**，无遗留疑问：
1. T1.1 建 `intel_*` 集合 + 自愈建表（仿 `ensureSchema`）。
2. T1.2 写 `seedSources.json` 25 源注册表 + 幂等播种。
3. T1.3 复制 `contentFetcher.js` → `intel/common/`，官网抓取零依赖就绪。
4. T1.4 落地 `intelFetch` self-fan-out + `intelRssPoll` 按源 worker + 3 个定时器。

唯一仍待用户：T0.2 Notion token（仅影响 Phase 7 文档同步）。
