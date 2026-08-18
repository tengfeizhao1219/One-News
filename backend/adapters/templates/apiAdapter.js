/**
 * apiAdapter.js — API 适配器模板（T2.3）
 * ============================================================
 * 角色：A（适配器）· T2.1 交付的代码骨架
 * 覆盖源（见 sources-manifest.json fetchType=api 的源）：
 *   - Hacker News：Algolia Search API（无密钥）—— 实测必带 created_at_i> 时间窗，否则返 2019 旧文
 *   - arXiv：export.arxiv.org 官方 API（无密钥）—— 3 秒限速；Atom XML 返回
 *   - Google News RSS：属 NewsRSSAdapter（兜底聚合器，RSS 协议但差异化逻辑放本类实现）
 * 范式来源：原生 fetch 零依赖；去重/写库字段与 rssAdapter 完全一致，统一走 intel_ingest 约定。
 *
 * 本文件是「模板/骨架」：
 *   - 以 HN + arXiv 两个真实端点为例，展示「分页/时间窗参数化」的写法；
 *   - 【真实部署替换】处需按各源 API 的实际返回结构调整解析逻辑。
 */

// ── 各源 API 解析器：一个源一个 fetch 函数，统一返回归一化条目 ──

/**
 * Hacker News（Algolia search_by_date）
 * 文档：https://hn.algolia.com/api
 * 关键：numericFilters 里必须带 created_at_i>START_TS（时间窗），否则返回历史旧文（调研 §3.2 实测）。
 * @param {Object} cfg - manifest 中 apiConfig
 * @param {Object} opts - { since: Date, page: number }
 * @returns {Promise<Array>} 归一化条目
 */
async function fetchHackerNews(cfg, opts = {}) {
  const sinceTs = opts.since ? Math.floor(new Date(opts.since).getTime() / 1000) : null
  // 时间窗参数化：since 缺省时回退 24h（或按 priority 调大），page 用于翻页
  const startTs = sinceTs || Math.floor(Date.now() / 1000) - 24 * 3600
  const page = opts.page || 0
  const params = new URLSearchParams({
    tags: 'story',
    numericFilters: `points>100,created_at_i>${startTs}`, // ⚠️ points 阈值可按「与用户相关度」调，100 为默认
    hitsPerPage: '50',
    page: String(page),
  })
  if (cfg.params && cfg.params.query) params.set('query', cfg.params.query) // 按基线监控词注入

  const res = await fetch(`${cfg.endpoint}?${params.toString()}`)
  if (!res.ok) throw new Error(`HN API HTTP ${res.status}`)
  const data = await res.json()
  const hits = (data && data.hits) || []
  return hits
    .filter((h) => h.title && h.url && h.objectID)
    .map((h) => ({
      source_id: 'hacker-news',
      item_guid: `hacker-news:${h.objectID}`,
      title: h.title,
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      published_at: new Date(h.created_at).toISOString(),
      raw_content: (h.story_text || h.title || '').slice(0, 5000), // 版权红线：仅作 AI 加工瞬时数据
      summary: h.story_text ? h.story_text.replace(/<[^>]+>/g, ' ').slice(0, 300) : '',
      fetch_method: 'api',
      fetched_at: new Date().toISOString(),
      meta: { points: h.points || 0, num_comments: h.num_comments || 0 }, // 社区热度信号，供质量门用
    }))
}

/**
 * arXiv 官方 API
 * 文档：https://info.arxiv.org/help/api/user-manual.html
 * 关键：3 秒限速；submittedDate:[YYYYMMDDHHMM TO YYYYMMDDHHMM] 时间窗；Atom XML 返回。
 * 【真实部署替换】Atom XML 解析建议复用 rssAdapter.parseRss（同为 XML，arXiv 返回兼容 Atom 结构），
 *                或引入 fast-xml-parser 同款解析。此处给出等价的内联解析。
 * @param {Object} cfg - manifest 中 apiConfig
 * @param {Object} opts - { since: Date }
 * @returns {Promise<Array>} 归一化条目
 */
async function fetchArxiv(cfg, opts = {}) {
  const since = opts.since || new Date(Date.now() - 24 * 3600 * 1000)
  // 时间窗参数化：YYYYMMDDHHMM
  const pad = (n) => String(n).padStart(2, '0')
  const fmt = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`
  const searchQuery = `${cfg.params.search_query} AND submittedDate:[${fmt(since)} TO ${fmt(new Date())}]`

  const params = new URLSearchParams({
    search_query: searchQuery,
    sortBy: cfg.params.sortBy || 'submittedDate',
    sortOrder: cfg.params.sortOrder || 'descending',
    max_results: String(cfg.params.max_results || 50),
  })
  const res = await fetch(`${cfg.endpoint}?${params.toString()}`)
  if (!res.ok) throw new Error(`arXiv API HTTP ${res.status}`)
  const xml = await res.text()
  // 【真实部署替换】正式实现建议直接调 rssAdapter.parseRss(xml)（Atom 兼容）；此处内联保证零依赖
  const entries = xml.split(/<entry>|<entry /i).slice(1)
  const items = []
  for (const block of entries) {
    const get = (tag) => {
      const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block)
      if (!m) return ''
      return m[1]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    }
    const title = get('title')
    const linkM = /<link[^>]*href\s*=\s*["']([^"']+)["']/i.exec(block)
    const url = linkM ? linkM[1] : ''
    const idM = /<id>([^<]+)<\/id>/i.exec(block)
    const guid = idM ? idM[1] : url
    if (!title || !url) continue
    items.push({
      source_id: 'arxiv',
      item_guid: `arxiv:${guid}`,
      title,
      url,
      published_at: get('published'),
      raw_content: get('summary').slice(0, 5000), // 摘要即正文来源（arXiv 不返回全文）
      summary: get('summary').slice(0, 300),
      fetch_method: 'api',
      fetched_at: new Date().toISOString(),
      meta: { authors: get('author') }, // 【真实部署替换】多作者需要更细粒度解析
    })
  }
  return items
}

/**
 * Google News RSS（兜底聚合器）—— 差异化逻辑放本类
 * 与 rssAdapter 的差别：query 是关键词模板，需要注入「基线监控词」，并处理重定向链接。
 * 【真实部署替换】RSS 解析建议直接复用 rssAdapter.parseRss。
 */
async function fetchGoogleNews(cfg, opts = {}) {
  // 基线监控词：来自 UserProfile.topics（P 角色/初始化采集），缺省给一组通用词
  const keywords = (opts.keywords && opts.keywords.length) ? opts.keywords : ['AI model release', 'LLM agent']
  // 【真实部署替换】多关键词建议拆多次请求（每次 1 个 query），避免单请求结果被稀释
  const query = keywords[0]
  const params = new URLSearchParams({
    q: `${query} when:7d`,
    hl: cfg.params.hl || 'en-US',
    gl: cfg.params.gl || 'US',
    ceid: cfg.params.ceid || 'US:en',
  })
  const res = await fetch(`${cfg.endpoint}?${params.toString()}`)
  if (!res.ok) throw new Error(`Google News HTTP ${res.status}`)
  const xml = await res.text()
  const rss = require('./rssAdapter')
  const rawItems = rss.parseRss(xml)
  return rawItems.map((it) => ({
    source_id: 'google-news-ai',
    item_guid: `google-news-ai:${require('crypto').createHash('sha256').update(it.url).digest('hex')}`,
    title: it.title,
    // ⚠️ Google News 链接为重定向（news.google.com/rss/articles/...），真实部署需保留原样并去重时用 urlFp 归一
    url: it.url,
    published_at: it.pubDate,
    raw_content: it.content || '',
    summary: it.summary,
    fetch_method: 'api',
    fetched_at: new Date().toISOString(),
    meta: { note: '兜底聚合，无 SLA' },
  }))
}

/**
 * 统一适配器接口：fetch(source, opts) -> items[]
 * 按 source.id 路由到对应 API 解析器。
 * @param {Object} source - sources-manifest.json 源定义（apiConfig 必填）
 * @param {Object} opts - { since: Date, page: number }
 */
async function fetch(source, opts = {}) {
  const cfg = source.apiConfig || {}
  switch (source.id) {
    case 'hacker-news':
      return fetchHackerNews(cfg, opts)
    case 'arxiv':
      // 遵守 3 秒限速：连续抓多个分类时调用方应串行 + 至少间隔 3s
      return fetchArxiv(cfg, opts)
    case 'google-news-ai':
      return fetchGoogleNews(cfg, opts)
    default:
      throw new Error(`[apiAdapter] 未知 API 源: ${source.id}`)
  }
}

module.exports = { fetch, fetchHackerNews, fetchArxiv, fetchGoogleNews }
