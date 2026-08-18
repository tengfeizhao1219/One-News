/**
 * seedSources.js — intel_sources 25 源注册表 + 幂等播种（T1.2 / I 基础设施）
 * ============================================================
 * 复用 One News rssFetcher/utils/seedFeeds.js 的幂等播种范式（非其业务），
 * 数据来源：AI信息源调研.md §2 默认清单 + §4 源→抓取方案映射总表 + §5.5 实测定论。
 * intel_* 命名空间隔离，可整体摘除。
 *
 * 幂等：种子源已存在则跳过（不覆盖运行期的灰度配置），可重跑。
 * 播种时机：intelRssPoll 启动自检调用（仿 rssFetcher），保证新接入源自动补齐。
 *
 * 源分类（layer）：
 *   A 广度扫描（日更通俗） / B 深度阅读（周更） / C 趋势判断（官方一手）
 *   D 社区信号 / E 工具发现 / F 中文补充层（默认不强制开启）
 * sourceType 五类 adapter：rss / api / scrape / news（Google News 兜底 RSS）/ wechat（T2.5 公众号本地 SQLite）
 * ============================================================
 */

const INTEL_SOURCE_COLLECTION = 'intel_sources'

/**
 * 25 源种子数据（字段对齐设计 §8.2 Source，_id = key 稳定 ID）。
 * 注：端点以调研文档实测为准，标注「待验证」者落地部署前需二次核验。
 */
const INTEL_SEED_SOURCES = [
  // ── A 层 · 广度扫描（日更，通俗，开箱即用）──
  {
    _id: 'the_rundown_ai',
    key: 'the_rundown_ai',
    name: 'The Rundown AI',
    layer: 'A',
    sourceType: 'rss',
    baseUrl: 'https://rss.beehiiv.com/feeds/2R3C6Bt5wj.xml',
    adapterConfig: { endpoint: 'https://rss.beehiiv.com/feeds/2R3C6Bt5wj.xml', timeoutMs: 8000, rateLimit: 'none' },
    pollSeconds: 21600, defaultOn: true, allowCategories: ['ai', 'tech'],
    blockTitleKeywords: ['sponsored', 'advertorial', '广告', '招聘'],
  },
  {
    _id: 'tldr_ai',
    key: 'tldr_ai',
    name: 'TLDR AI',
    layer: 'A',
    sourceType: 'rss',
    baseUrl: 'https://tldr.tech/api/rss/ai',
    adapterConfig: { endpoint: 'https://tldr.tech/api/rss/ai', timeoutMs: 8000, rateLimit: 'none' },
    pollSeconds: 21600, defaultOn: true, allowCategories: ['ai', 'tech'],
    blockTitleKeywords: ['sponsored', 'advertorial', '广告', '招聘'],
  },
  {
    _id: 'the_neuron',
    key: 'the_neuron',
    name: 'The Neuron',
    layer: 'A',
    sourceType: 'scrape', // T2.4 实测 403（Cloudflare 反爬），零依赖纯 Node 不可达；默认不开启避免白抓+误告警，内容可由 TechCrunch/Verge 等 RSS 覆盖
    baseUrl: 'https://www.theneurondaily.com/',
    adapterConfig: { endpoint: 'https://www.theneurondaily.com/', timeoutMs: 15000, rateLimit: 'polite' },
    pollSeconds: 21600, defaultOn: false, allowCategories: ['ai', 'tech'],
    blockTitleKeywords: ['sponsored', 'advertorial', '广告'],
  },
  {
    _id: 'bens_bites',
    key: 'bens_bites',
    name: "Ben's Bites",
    layer: 'A',
    sourceType: 'rss',
    baseUrl: 'https://bensbites.substack.com/feed',
    adapterConfig: { endpoint: 'https://bensbites.substack.com/feed', timeoutMs: 8000, rateLimit: 'none' },
    pollSeconds: 21600, defaultOn: true, allowCategories: ['ai', 'tech'],
    blockTitleKeywords: ['sponsored', 'advertorial', '广告'],
  },
  {
    _id: 'techcrunch_ai',
    key: 'techcrunch_ai',
    name: 'TechCrunch（AI 频道）',
    layer: 'A',
    sourceType: 'rss',
    baseUrl: 'https://techcrunch.com/category/artificial-intelligence/feed/',
    adapterConfig: { endpoint: 'https://techcrunch.com/category/artificial-intelligence/feed/', timeoutMs: 8000, rateLimit: 'none' },
    pollSeconds: 21600, defaultOn: true, allowCategories: ['ai', 'tech'],
    blockTitleKeywords: ['sponsored', 'advertorial', '广告', '招聘'],
  },
  {
    _id: 'venturebeat_ai',
    key: 'venturebeat_ai',
    name: 'VentureBeat（AI）',
    layer: 'A',
    sourceType: 'rss',
    baseUrl: 'https://venturebeat.com/category/ai/feed/',
    adapterConfig: { endpoint: 'https://venturebeat.com/category/ai/feed/', timeoutMs: 8000, rateLimit: 'none' },
    pollSeconds: 21600, defaultOn: true, allowCategories: ['ai', 'tech'],
    blockTitleKeywords: ['sponsored', 'advertorial', '广告'],
  },
  {
    _id: 'theverge_ai',
    key: 'theverge_ai',
    name: 'The Verge（AI）',
    layer: 'A',
    sourceType: 'rss',
    baseUrl: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
    adapterConfig: { endpoint: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', timeoutMs: 8000, rateLimit: 'none' },
    pollSeconds: 21600, defaultOn: true, allowCategories: ['ai', 'tech'],
    blockTitleKeywords: ['sponsored', 'advertorial', '广告'],
  },
  {
    _id: 'marktechpost',
    key: 'marktechpost',
    name: 'MarkTechPost',
    layer: 'A',
    sourceType: 'rss',
    baseUrl: 'https://www.marktechpost.com/feed/',
    adapterConfig: { endpoint: 'https://www.marktechpost.com/feed/', timeoutMs: 8000, rateLimit: 'none' },
    pollSeconds: 21600, defaultOn: true, allowCategories: ['ai', 'tech', 'research'],
    blockTitleKeywords: ['sponsored', 'advertorial', '广告'],
  },
  {
    _id: 'google_news_ai',
    key: 'google_news_ai',
    name: 'Google News RSS（AI 兜底聚合）',
    layer: 'A',
    sourceType: 'news', // 兜底聚合器：无密钥 RSS，~100 条上限、重定向链接、无 SLA
    baseUrl: 'https://news.google.com/rss/search?q=AI&hl=en-US&gl=US&ceid=US:en',
    adapterConfig: {
      endpoint: 'https://news.google.com/rss/search',
      params: { q: 'AI model release OR LLM agent', hl: 'en-US', gl: 'US', ceid: 'US:en' },
      timeoutMs: 8000, rateLimit: 'none',
    },
    pollSeconds: 21600, defaultOn: true, allowCategories: ['ai', 'tech'],
    blockTitleKeywords: [],
  },

  // ── B 层 · 深度阅读（周更，搞清为什么重要）──
  {
    _id: 'the_batch',
    key: 'the_batch',
    name: 'The Batch（DeepLearning.AI）',
    layer: 'B',
    sourceType: 'scrape', // T2.4 实测能取到 HTML，但列表页为 JS 渲染、无 issue-NNN 静态卡片，通用提取仅能取最新 teaser（外部 bit.ly 链接）；保守保留开启，正文待 Phase 3 深挖
    baseUrl: 'https://www.deeplearning.ai/the-batch/',
    adapterConfig: { endpoint: 'https://www.deeplearning.ai/the-batch/', timeoutMs: 15000, rateLimit: 'polite' },
    pollSeconds: 21600, defaultOn: true, allowCategories: ['ai', 'research'],
    blockTitleKeywords: ['sponsored', 'advertorial', '广告'],
  },
  {
    _id: 'import_ai',
    key: 'import_ai',
    name: 'Import AI（Jack Clark）',
    layer: 'B',
    sourceType: 'rss',
    baseUrl: 'https://jackclark.substack.com/feed',
    adapterConfig: { endpoint: 'https://jackclark.substack.com/feed', timeoutMs: 8000, rateLimit: 'none' },
    pollSeconds: 21600, defaultOn: true, allowCategories: ['ai', 'research', 'policy'],
    blockTitleKeywords: [],
  },
  {
    _id: 'ahead_of_ai',
    key: 'ahead_of_ai',
    name: 'Ahead of AI（Sebastian Raschka）',
    layer: 'B',
    sourceType: 'rss',
    baseUrl: 'https://magazine.sebastianraschka.com/feed',
    adapterConfig: { endpoint: 'https://magazine.sebastianraschka.com/feed', timeoutMs: 8000, rateLimit: 'none' },
    pollSeconds: 21600, defaultOn: true, allowCategories: ['ai', 'research'],
    blockTitleKeywords: [],
  },
  {
    _id: 'latent_space',
    key: 'latent_space',
    name: 'Latent Space',
    layer: 'B',
    sourceType: 'rss',
    baseUrl: 'https://www.latent.space/feed',
    adapterConfig: { endpoint: 'https://www.latent.space/feed', timeoutMs: 8000, rateLimit: 'none' },
    pollSeconds: 21600, defaultOn: true, allowCategories: ['ai', 'engineering'],
    blockTitleKeywords: [],
  },
  // ── C 层 · 趋势判断（官方一手）──
  {
    _id: 'openai_blog',
    key: 'openai_blog',
    name: 'OpenAI Blog / Research',
    layer: 'C',
    sourceType: 'rss', // RSS + 官方页（端点待验证）
    baseUrl: 'https://openai.com/news/rss.xml',
    adapterConfig: { endpoint: 'https://openai.com/news/rss.xml', timeoutMs: 8000, rateLimit: 'none' },
    pollSeconds: 21600, defaultOn: true, allowCategories: ['ai', 'official'],
    blockTitleKeywords: [],
  },
  {
    _id: 'anthropic_news',
    key: 'anthropic_news',
    name: 'Anthropic News',
    layer: 'C',
    sourceType: 'scrape', // T2.4 实测 414KB HTML 但文章卡片为 JS 客户端渲染，无静态列表；零依赖纯 Node 不可达，默认不开启，内容由 TechCrunch/Verge 等 RSS 覆盖
    baseUrl: 'https://www.anthropic.com/news',
    adapterConfig: { endpoint: 'https://www.anthropic.com/news', timeoutMs: 15000, rateLimit: 'polite' },
    pollSeconds: 21600, defaultOn: false, allowCategories: ['ai', 'official', 'safety'],
    blockTitleKeywords: [],
  },
  {
    _id: 'google_deepmind',
    key: 'google_deepmind',
    name: 'Google DeepMind Blog',
    layer: 'C',
    sourceType: 'rss', // RSS + 官方页（端点待验证）
    baseUrl: 'https://deepmind.google/blog/rss.xml',
    adapterConfig: { endpoint: 'https://deepmind.google/blog/rss.xml', timeoutMs: 8000, rateLimit: 'none' },
    pollSeconds: 21600, defaultOn: true, allowCategories: ['ai', 'official', 'research'],
    blockTitleKeywords: [],
  },
  {
    _id: 'meta_ai_blog',
    key: 'meta_ai_blog',
    name: 'Meta AI Blog',
    layer: 'C',
    sourceType: 'scrape', // T2.4 实测 400（Cloudflare 拒绝），零依赖纯 Node 不可达；默认不开启，内容由 TechCrunch/Verge 等 RSS 覆盖
    baseUrl: 'https://ai.meta.com/blog/',
    adapterConfig: { endpoint: 'https://ai.meta.com/blog/', timeoutMs: 15000, rateLimit: 'polite' },
    pollSeconds: 21600, defaultOn: false, allowCategories: ['ai', 'official', 'open_source'],
    blockTitleKeywords: [],
  },
  {
    _id: 'huggingface_blog',
    key: 'huggingface_blog',
    name: 'Hugging Face Blog',
    layer: 'C',
    sourceType: 'rss',
    baseUrl: 'https://huggingface.co/blog/feed.xml',
    adapterConfig: { endpoint: 'https://huggingface.co/blog/feed.xml', timeoutMs: 8000, rateLimit: 'none' },
    pollSeconds: 21600, defaultOn: true, allowCategories: ['ai', 'open_source'],
    blockTitleKeywords: [],
  },
  {
    _id: 'arxiv_ai',
    key: 'arxiv_ai',
    name: 'arXiv（cs.AI / cs.CL / cs.CV）',
    layer: 'C',
    sourceType: 'api', // 官方 API：3 秒限速、Atom XML、按 submittedDate 排序
    baseUrl: 'http://export.arxiv.org/api/query',
    adapterConfig: {
      endpoint: 'http://export.arxiv.org/api/query',
      params: { search_query: 'cat:cs.AI OR cat:cs.CL OR cat:cs.CV', sortBy: 'submittedDate', sortOrder: 'descending', max_results: 30 },
      timeoutMs: 10000, rateLimit: '3s',
    },
    pollSeconds: 21600, defaultOn: true, allowCategories: ['ai', 'research', 'paper'],
    blockTitleKeywords: [],
  },

  // ── D 层 · 社区信号（实时，草根/热度）──
  {
    _id: 'hacker_news',
    key: 'hacker_news',
    name: 'Hacker News（Algolia）',
    layer: 'D',
    sourceType: 'api', // Algolia Search API：无密钥；务必带 created_at_i> 时间窗（实测默认返 2019 旧文）
    baseUrl: 'https://hn.algolia.com/api/v1/search_by_date',
    adapterConfig: {
      endpoint: 'https://hn.algolia.com/api/v1/search_by_date',
      params: { tags: 'story', numericFilters: 'points>100' },
      timeoutMs: 10000, rateLimit: 'none',
    },
    pollSeconds: 21600, defaultOn: true, allowCategories: ['ai', 'community'],
    blockTitleKeywords: [],
  },
  {
    _id: 'reddit_singularity',
    key: 'reddit_singularity',
    name: 'Reddit（r/singularity）',
    layer: 'D',
    sourceType: 'rss', // 免密钥 .rss 直连（无评分/评论）；OAuth 商用需审批
    baseUrl: 'https://www.reddit.com/r/singularity/.rss',
    adapterConfig: { endpoint: 'https://www.reddit.com/r/singularity/.rss', timeoutMs: 10000, rateLimit: 'none' },
    pollSeconds: 21600, defaultOn: true, allowCategories: ['ai', 'community'],
    blockTitleKeywords: [],
  },

  // ── E 层 · 工具发现 ──
  {
    _id: 'product_hunt',
    key: 'product_hunt',
    name: 'Product Hunt',
    layer: 'E',
    sourceType: 'rss', // RSS / API（新 AI 产品首发）
    baseUrl: 'https://www.producthunt.com/feed',
    adapterConfig: { endpoint: 'https://www.producthunt.com/feed', timeoutMs: 8000, rateLimit: 'none' },
    pollSeconds: 21600, defaultOn: true, allowCategories: ['ai', 'tools', 'product'],
    blockTitleKeywords: ['sponsored', 'advertorial', '广告'],
  },

  // ── F 层 · 中文补充层（默认不强制开启，由初始化「语言偏好」决定）──
  {
    _id: 'jiqizhixin',
    key: 'jiqizhixin',
    name: '机器之心',
    layer: 'F',
    sourceType: 'scrape', // T2.4 实测 200 但仅 12.6KB 降级壳（只给 PRO 付费 teaser，免费列表不出现），RSS 已转付费订阅；默认不开启，中文层由 qbitai（量子位 RSS）补位
    baseUrl: 'https://www.jiqizhixin.com/',
    adapterConfig: { endpoint: 'https://www.jiqizhixin.com/', timeoutMs: 15000, rateLimit: 'polite' },
    pollSeconds: 21600, defaultOn: false, allowCategories: ['ai', 'tech', 'zh'],
    blockTitleKeywords: ['广告', '招聘'],
  },
  {
    _id: 'qbitai',
    key: 'qbitai',
    name: '量子位',
    layer: 'F',
    sourceType: 'rss',
    baseUrl: 'https://www.qbitai.com/feed',
    adapterConfig: { endpoint: 'https://www.qbitai.com/feed', timeoutMs: 10000, rateLimit: 'none' },
    pollSeconds: 21600, defaultOn: false, allowCategories: ['ai', 'tech', 'zh'],
    blockTitleKeywords: ['广告', '招聘'],
  },
  {
    _id: 'wechat_officials',
    key: 'wechat_officials',
    name: '微信公众号（量子位/机器之心/数字生命卡兹克 等）',
    layer: 'F',
    sourceType: 'wechat', // 本地 SQLite 解析（调研 §5）：云端只消费本地进程 HTTP API，路径失效静默降级
    baseUrl: '',
    adapterConfig: { endpoint: '{WECHAT_LOCAL_DATA_DIR}/wechat.db', timeoutMs: 15000, rateLimit: 'low', note: 'T2.5 落地 wechat adapter；云端不直连微信服务器' },
    pollSeconds: 21600, defaultOn: false, allowCategories: ['ai', 'zh'],
    blockTitleKeywords: ['广告'],
  },
]

/** 播种时补全的默认运行时字段（对齐设计 §8.2 Source） */
function withDefaults(src) {
  const defaults = {
    enabled: src.defaultOn === true,          // 默认开 A–E；F 层按需
    lastSuccessCursor: null,                  // §5.8 #3 增量检查点（跨 05/11/18 续传）
    lastFetchedAt: null,
    errorStreak: 0,
    status: 'active',
    health: { status: 'ok', consecutiveFails: 0, lastError: '' },
    createdAt: new Date().toISOString(),
  }
  return Object.assign({}, src, defaults)
}

/**
 * 幂等播种 intel_sources（已存在则跳过，不覆盖运行期灰度配置）。
 * 返回 { inserted, skipped } 计数。
 * @param {Object} [db] - 可选注入 db（默认 wx-server-sdk 自取）
 */
async function seed(db) {
  const cloud = require('wx-server-sdk')
  const _db = db || cloud.database()
  const col = _db.collection(INTEL_SOURCE_COLLECTION)

  let inserted = 0
  let skipped = 0

  for (const src of INTEL_SEED_SOURCES) {
    const srcId = src._id || src.key
    if (!srcId) continue
    let existing = null
    try {
      const res = await col.where({ _id: srcId }).limit(1).get()
      existing = (res.data && res.data[0]) || null
    } catch (e) {
      // 集合不存在或权限不足 → 交给 ensureSchema 自愈，本轮跳过播种
      console.warn(`[seedSources] 读取 ${srcId} 失败（放行）:`, e.message)
    }
    if (existing) {
      skipped++
      console.log(`[seedSources] 跳过 ${srcId}（已存在，不覆盖灰度配置）`)
      continue
    }
    const doc = withDefaults(src)
    try {
      await col.add({ data: doc })
      inserted++
      console.log(`[seedSources] 新建 ${srcId}: ${src.name} [${src.layer}/${src.sourceType}] → ${src.baseUrl}`)
    } catch (e) {
      console.warn(`[seedSources] 写入 ${srcId} 失败（幂等，可重跑）:`, e.message)
    }
  }

  console.log(`[seedSources] 播种完成：新增 ${inserted} 条，跳过 ${skipped} 条`)
  return { inserted, skipped }
}

module.exports = { seed, INTEL_SEED_SOURCES }
