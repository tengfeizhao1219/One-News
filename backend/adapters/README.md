# adapters/ — 适配器注册清单与四类适配器模板（T2.1）

> 作者：A（适配器）· 2026-08-18 · 对应 Phase 2 抓取层前置准备
> 输入依据：《AI信息源调研.md》§4 映射总表 + §5 公众号专章（2026-08-17 实测）
> 输出：25 源完整注册清单 + 四类适配器代码骨架（**模板**，非可运行实例）

## 目录

```
backend/adapters/
├── sources-manifest.json   # T2.1 核心：25 源完整注册数据
├── README.md               # 本文件
└── templates/
    ├── rssAdapter.js       # RSS 直连适配器模板（17 源）
    ├── apiAdapter.js       # API 适配器模板（HN / arXiv / Google News 兜底）
    ├── webAdapter.js       # 官网抓取适配器模板（5 源，规则表驱动）
    └── wechatAdapter.js    # 公众号适配器模板（本地 SQLite，云端解耦）
```

---

## 1. sources-manifest.json 字段定义

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 唯一短标识（英文），适配器路由键，也是 `intel_ingest.source_id` |
| `name` | string | 中文名 |
| `category` | enum | `AI公司动态 / 前沿研究 / 行业媒体 / 中文社区 / 监管政策`（五分类，供过滤/场景映射用） |
| `layer` | string | 调研 §2 分层：A 广度扫描 / B 深度阅读 / C 趋势判断 / D 社区信号 / E 工具发现 / F 中文补充 |
| `fetchType` | enum | `rss / api / web / wechat` —— **决定用哪个适配器模板** |
| `rssUrl` | string | fetchType=rss 时必填 |
| `apiConfig` | object | fetchType=api 时必填：`{ endpoint, params }`（分页/时间窗参数化） |
| `webConfig` | object | fetchType=web 时必填：`{ url, selectorRule }`（正文容器定位规则说明） |
| `wechatConfig` | object | fetchType=wechat 时必填：`{ account, localDb, approach, compliance }` |
| `fetchRate` | enum | 每天抓取档位 `high / normal / low`（映射到 worker 轮询频率） |
| `priority` | int 1–5 | 源优先级（1 最高；决定扇出分组顺序与异常时的保抓次序） |
| `sourceDocRef` | string | 调研文档回溯锚点（章节/条目），便于 Q 校验 |

**URL 可信度**：调研文档明确给出的端点（The Rundown beehiiv、TLDR、Google News、HN Algolia、arXiv、Reddit `.rss` 等）为**实测可信**；其余为按调研 §3.1/§4 模式推断，标注「待核验」，落地前二次核验（调研 §4 末尾注）。

## 2. 25 源统计

按 `fetchType` 分类：

| fetchType | 数量 | 源 |
|---|---|---|
| **rss** | 17 | The Rundown / TLDR / Ben's Bites / TechCrunch / VentureBeat / The Verge / MarkTechPost / Google News(兜底) / Import AI / Ahead of AI / Latent Space / OpenAI / DeepMind / Hugging Face / Reddit / Product Hunt / 量子位 |
| **web** | 5 | The Neuron / The Batch / Anthropic News / Meta AI Blog / 机器之心（**全部为实测确认无公开 RSS**） |
| **api** | 2 | Hacker News（Algolia）/ arXiv（官方 API） |
| **wechat** | 1 | 微信公众号（量子位 / 机器之心 / 数字生命卡兹克 等用户主动订阅号） |
| **合计** | **25** | 覆盖调研 §2 A–F 六层，§5.5「25/25 源抓取方式全部确认」 |

> 与调研 §5.5 实测清单的差异说明（在汇报中向 O 说明）：§5.5 一/二实测了 26 个端点
> （含 Ars Technica、MIT TR、新智元、One Useful Thing、SemiAnalysis 等），本项目默认清单取 25，
> 未纳入的源保留在调研 §6 全量候选清单，供用户初始化时按偏好加回；SemiAnalysis 标注「待验证」未入列。

## 3. 四类适配器如何选择（worker 路由）

`intelRssPoll` worker 按 `source.fetchType` 分发：

```
fetchType=rss    → templates/rssAdapter.js    （ETag/304、解析、去重、时间窗增量）
fetchType=api    → templates/apiAdapter.js    （分页/时间窗参数化，按 source.id 再路由）
fetchType=web    → templates/webAdapter.js    （SITE_RULES 规则表驱动，复用 contentFetcher）
fetchType=wechat → templates/wechatAdapter.js （本地 SQLite 解析 / 云端消费本地 API）
```

- 所有适配器统一接口：`fetch(source, opts) -> { items: Item[] }`（对齐设计 §5.1）。
- `Item` 字段统一写 `intel_ingest`（见 §4），去重键 = `item_guid`（urlFp + titleFp 派生）。
- 失败降级：单源失败返回 `{ items: [], error }`，worker 静默跳过 + 健康计数，不阻断整轮巡检（设计 §5.8）。
- 版权红线：所有 `raw_content` 仅作 AI 加工瞬时数据，不向用户展示、不持久化全文（复用审计 A.4/A.5 同款口径）。

## 4. intel_ingest 字段约定（T2.1 暂定，与 I 角色 seedSources 的衔接）

> ⚠️ **重要衔接**：I 角色 Phase 1 代码当前尚未落地（`backend/` 下仅有目录占位）。
> 本 manifest 与四个模板暂按以下字段约定（任务书默认方案），**I 角色 seedSources.json 落地后以此为对齐基准**：

```jsonc
// intel_ingest 集合暂存条目（抓取层 → 处理层的中转）
{
  "source_id":   "源 id（= manifest.id）",
  "item_guid":   "去重主键（源内唯一，urlFp+titleFp 派生 sha256）",
  "title":       "标题",
  "url":         "原文链接",
  "published_at":"发布时间 ISO8601",
  "raw_content": "正文（仅作 AI 加工源，不展示、不持久化）",
  "summary":     "摘要（≤300 字）",
  "fetch_method":"rss | api | web | wechat",
  "fetched_at":  "抓取时间",
  "meta":        "附加信号（HN points / arXiv 作者 / 公众号作者等，供质量门用）"
}
```

### 与 I 角色 `seedSources.json` 的衔接建议
1. **数据源同一**：两者都从《AI信息源调研.md》§4 取数，`id` 建议保持一致（本 manifest 已定 `id`，
   建议 I 的 seedSources 直接复用，避免双份 ID 对不齐）。
2. **seedSources 补充运行态字段**（I 角色职责，本 manifest 不重复）：`enabled`、`pollSeconds`、
   `lastSuccessCursor`、`health`（设计 §8.2 Source schema）。
3. **建议 I 从本 manifest 生成**：写一个幂等播种函数读取 `sources-manifest.json` 生成 `seedSources.json`，
   保证单点维护、Q 校验时两文件交叉核对（T6.2）。
4. **冲突处理**：若 I 的 seedSources 已有不同 `id`/字段名，以 I 落地代码为准并回写本 manifest；
   出现矛盾时按硬约束「I 是 intel_* 集合 schema 定义者」处理，A 适配器保持对齐。

### 与 I 角色 `backend/common/contentFetcher.js` 的衔接
- webAdapter 模板顶部 `require('../../common/contentFetcher')`（I 的 T1.3 产出位置）。
- 真实部署时删除模板内联的占位实现，改用 I 复制的 `fetchWebPage` / `extractContentFromHtml`。

## 5. 遗留风险（T2.2–T2.5 开工前注意）

1. **URL 待核验**：manifest 中未实测的 feed 地址（TechCrunch/VentureBeat/Verge/MarkTechPost/Substack 系等）落地前按调研 §4 末尾注二次核验。
2. **gzip**：MarkTechPost / 机器之心等返回 `Content-Encoding: gzip`，rssAdapter 已注释解压点（Z 工具），T2.2 实现时必做。
3. **HN 时间窗**：Algolia 必带 `created_at_i>`，否则返 2019 旧文（调研实测），模板已参数化。
4. **Reddit 出口**：本沙箱出口被网络风控拦截，源本身有效，落地到正常服务器即可（调研 §3.3 实测注记）。
5. **官网选择器（T2.4 已实测定论）**：webAdapter 的 `SITE_RULES` 为正则占位。T2.4 实测量 5 个官网源，**零依赖纯 Node（worker `scrape` 分支 + contentFetcher）下 4/5 不可达**：the_neuron 403 / meta 400（Cloudflare 反爬）、anthropic 是 JS 客户端渲染无静态文章列表、机器之心 200 但 12.6KB 降级壳（仅 PRO teaser）；仅 the_batch 能取 HTML 但无 issue-NNN 卡片（仅最新外部 teaser）。**结论：现代官网多为 JS 渲染 + 严格反爬，纯零依赖无法有效抓取，已按 owner 拍板「降级 + 补位」落地**——seedSources 将 4 源 defaultOn=false（不参与巡检、不误告警），保留 25 源清单完整性；抗干扰由已有 RSS 科技媒体覆盖，中文层由 qbitai（量子位 RSS）补位。待 Phase 3（LLM/授权）或换合规抓取路线再启用。
6. **公众号合规**：本地 SQLite 路径依赖用户设备微信客户端同步；不可达时静默降级（模板已内置）。
