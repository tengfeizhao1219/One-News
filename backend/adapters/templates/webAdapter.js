/**
 * webAdapter.js — 官网抓取适配器模板（T2.4）
 * ============================================================
 * 角色：A（适配器）· T2.1 交付的代码骨架
 * 覆盖源（见 sources-manifest.json fetchType=web 的 5 源，全部为「实测确认无公开 RSS」）：
 *   - Anthropic News   https://www.anthropic.com/news
 *   - Meta AI Blog     https://ai.meta.com/blog/
 *   - The Batch        https://www.deeplearning.ai/the-batch/（issue-NNN 结构）
 *   - The Neuron       https://www.theneurondaily.com/（/p/ 文章）
 *   - 机器之心           https://www.jiqizhixin.com/（RSS 已转付费订阅，免费走官网）
 *
 * 范式来源：**复用 One News `common/contentFetcher.js` 的 fetchWebPage + extractContentFromHtml**
 *   （复用审计 #3 🟢直接复制到 `backend/common/contentFetcher.js`）：
 *   - fetchWebPage：UA 伪装、301/302 跟随、2MB 上限、GBK 解码（TextDecoder/iconv 兜底）
 *   - extractContentFromHtml：locateBodyHtml 多站点正文容器正则 + trimExtraneousContent 截断延伸阅读
 *
 * 设计要点：**规则表驱动** —— 各站差异（列表页卡片定位、正文容器正则、日期解析）全部收敛到
 *   SITE_RULES 表，新增站点只改表不动代码。骨架里 RULE_* 是占位，真实部署时用
 *   站点的实际 DOM class/结构替换。
 */

// ── 复用 contentFetcher（真实部署路径：backend/common/contentFetcher.js）──
// 本地模板为了可独立语法校验，做轻量注入；【真实部署替换】改为：
//   const { fetchWebPage, extractContentFromHtml } = require('../../common/contentFetcher')
let contentFetcher = null
try {
  contentFetcher = require('../../common/contentFetcher')
} catch (e) {
  // 模板运行环境无 I 角色 common/ 代码：内联一份最小实现占位（真实部署以上方 require 为准）
  contentFetcher = {
    fetchWebPage: (url) => Promise.resolve(null),
    extractContentFromHtml: (html) => (html ? String(html).slice(0, 200) : null),
  }
}

// ── 站点规则表（规则驱动核心；新增站点在此加一行）──
// 字段说明：
//   baseUrl        列表页/首页 URL
//   cardLinkRe     「列表页 → 文章详情页 URL」提取正则（捕获组 1 = 相对/绝对路径）
//   dateRe         列表页或详情页中的日期提取正则
//   bodySelectors  详情页正文定位（传给 extractContentFromHtml 的 locateBodyHtml 兜底正则，可为空=用通用模式）
const SITE_RULES = {
  'anthropic-news': {
    baseUrl: 'https://www.anthropic.com/news',
    // 【真实部署替换】Anthropic 列表卡片 class 以实际 DOM 为准，下面为正则示意
    cardLinkRe: /<a[^>]+href\s*=\s*["']([^"']*\/news\/[^"']+)["'][^>]*>/gi,
    dateRe: /(\d{4}-\d{2}-\d{2})/,
    bodySelectors: [],
  },
  'meta-ai-blog': {
    baseUrl: 'https://ai.meta.com/blog/',
    // 【真实部署替换】Meta 博客卡片 class 以实际 DOM 为准
    cardLinkRe: /<a[^>]+href\s*=\s*["']([^"']*\/blog\/[^"']+)["'][^>]*>/gi,
    dateRe: /([A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4})/,
    bodySelectors: [],
  },
  'the-batch': {
    baseUrl: 'https://www.deeplearning.ai/the-batch/',
    // issue-NNN 结构：https://www.deeplearning.ai/the-batch/issue-123/
    cardLinkRe: /href\s*=\s*["']([^"']*\/the-batch\/issue-\d+[^"']*)["']/gi,
    dateRe: /(\d{4}-\d{2}-\d{2})/,
    bodySelectors: [],
  },
  'the-neuron': {
    baseUrl: 'https://www.theneurondaily.com/',
    // /p/ 文章结构
    cardLinkRe: /href\s*=\s*["']([^"']*\/p\/[^"']+)["']/gi,
    dateRe: /([A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4})/,
    bodySelectors: [],
  },
  'jiqizhixin': {
    baseUrl: 'https://www.jiqizhixin.com/',
    // 【真实部署替换】机器之心首页文章卡片结构以实际 DOM 为准
    cardLinkRe: /<a[^>]+href\s*=\s*["']([^"']*\/articles\/[^"']+)["'][^>]*>/gi,
    dateRe: /(\d{4}-\d{2}-\d{2})/,
    bodySelectors: [],
  },
}

// ── HTML 小工具（去标签；正文段落提取交给 extractContentFromHtml）──
function stripTags(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 从列表页 HTML 提取「文章卡片」：{ url, title, date }
 * @param {string} html - 列表页 HTML
 * @param {Object} rule - SITE_RULES[source.id]
 * @returns {Array<{url:string,title:string,date:string}>}
 */
function extractCards(html, rule) {
  const cards = []
  const links = new Map() // href 去重
  let m
  while ((m = rule.cardLinkRe.exec(html)) !== null) {
    let href = m[1]
    // 相对路径 → 绝对 URL
    if (href.startsWith('/')) href = new URL(href, rule.baseUrl).toString()
    if (!links.has(href) && /^https?:\/\//i.test(href)) {
      // 标题就近取：链接附近 400 字符内的标题文本（真实部署按卡片结构精确化）
      const around = html.slice(Math.max(0, m.index - 400), m.index + m[0].length + 200)
      const titleM = /<[^>]*title\s*=\s*["']([^"']+)["']|<h\d[^>]*>([\s\S]{4,200}?)<\/h\d>/i.exec(around)
      const title = titleM ? stripTags(titleM[1] || titleM[2] || '') : ''
      const dateM = rule.dateRe.exec(around)
      links.set(href, { url: href, title, date: dateM ? dateM[1] : '' })
    }
  }
  links.forEach((v) => cards.push(v))
  return cards
}

/**
 * 详情页 → 正文纯文本（复用 contentFetcher.extractContentFromHtml）
 * 返回 null 表示抓取失败/无正文。
 */
async function extractArticleBody(detailUrl, bodySelectors) {
  const html = await contentFetcher.fetchWebPage(detailUrl)
  if (!html) return null
  // 通用正文提取（locateBodyHtml：article/正文容器正则，多站点兼容）
  const body = contentFetcher.extractContentFromHtml(html)
  // 【真实部署替换】若通用提取对某站效果差，可按 bodySelectors 追加该站专属正则，
  //   实现与 locateBodyHtml 相同的「正则列表顺序尝试」逻辑。
  return body
}

/**
 * 统一适配器接口：fetch(source, opts) -> items[]
 * 流程：抓列表页 → 提取卡片（url/title/date）→ 逐条抓详情页正文 → 归一化。
 * 并发与预算：真实部署时由 worker 控制（建议 Promise.all 并发 ≤4，单源总预算 ≤15s，设计 §5.8）。
 * @param {Object} source - sources-manifest.json 源定义（webConfig 必填）
 * @param {Object} opts - { since: Date, maxCards: number }
 */
async function fetch(source, opts = {}) {
  const cfg = source.webConfig || {}
  const rule = SITE_RULES[source.id]
  if (!rule) throw new Error(`[webAdapter] 未知官网源: ${source.id}`)
  const baseUrl = (cfg.url && cfg.url.startsWith('http')) ? cfg.url : rule.baseUrl

  const listHtml = await contentFetcher.fetchWebPage(baseUrl)
  if (!listHtml) return { items: [], error: '列表页抓取失败' }

  const sinceTs = opts.since ? new Date(opts.since).getTime() : 0
  const maxCards = opts.maxCards || 10 // 官网源多为不定期更新，每日取前 N 条足够

  const cards = extractCards(listHtml, rule).slice(0, maxCards)
  const items = []
  for (const card of cards) {
    // 时间窗过滤（无日期信息则放行，宁多勿漏；去重由 guid 保证）
    const t = card.date ? new Date(card.date).getTime() : 0
    if (sinceTs && t && t < sinceTs) continue
    // 详情页正文（best-effort：失败不阻断该源，正文留空由下游 AI 加工回填）
    const body = await extractArticleBody(card.url, rule.bodySelectors)
    items.push({
      source_id: source.id,
      item_guid: `${source.id}:${require('crypto').createHash('sha256').update(card.url).digest('hex')}`,
      title: card.title || `[${source.name}] ${card.date || ''}`.trim(),
      url: card.url,
      published_at: card.date || new Date().toISOString(),
      raw_content: body || '', // 版权红线：仅作 AI 加工瞬时数据，不持久化展示全文
      summary: body ? body.slice(0, 300) : '',
      fetch_method: 'web',
      fetched_at: new Date().toISOString(),
    })
  }
  return { items, listFetchedAt: new Date().toISOString() }
}

module.exports = { fetch, SITE_RULES, extractCards }
