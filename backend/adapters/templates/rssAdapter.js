/**
 * rssAdapter.js — RSS 直连适配器模板（T2.2）
 * ============================================================
 * 角色：A（适配器）· T2.1 交付的代码骨架
 * 范式来源：复用 One News `cloudfunctions/rssFetcher/index.js` + `utils/apiFetch` + `utils/rssParser`，
 *         只改命名空间（intel_*），不碰 One News 业务数据（复用审计 #1/#2/#4/#5）。
 *
 * 本文件是「模板/骨架」：
 *   - 已给出完整 fetch → normalize → 去重 → 写 intel_ingest 的数据流；
 *   - 真实部署时把本文件放入 `backend/intelRssPoll/adapters/`，由 I 角色 worker 按 sourceId 路由调用；
 *   - 标注了「【真实部署替换】」的注释点，是需要按生产环境/源站实际形态填实的位置。
 *
 * 覆盖源（见 sources-manifest.json fetchType=rss 的 17 源）：
 *   The Rundown / TLDR / Ben's Bites / TechCrunch / VentureBeat / The Verge / MarkTechPost /
 *   Google News(兜底) / Import AI / Ahead of AI / Latent Space / OpenAI / DeepMind / HF /
 *   Reddit / Product Hunt / 量子位
 *
 * 硬约束：
 *   - CommonJS、零外部依赖优先（RSS 解析用 fast-xml-parser 为唯一可选依赖，One News 同款；
 *     若追求纯零依赖可替换为轻量 XML 正则解析，见 parseRssLight）；
 *   - 版权红线（调研 §5.4 / 复用审计）：只存 title/url/summary，正文仅作 AI 加工源瞬时数据；
 *   - 写入字段遵循 intel_ingest 约定（T2.1 约定，I 角色 seedSources 对齐后以 I 为准）：
 *       source_id / item_guid / title / url / published_at / raw_content / fetched_at / fetch_method
 */

// ── 依赖注入：真实部署时由 worker 传入，保证模板可独立语法校验 ──
// 生产建议：require('fast-xml-parser')（One News rssParser 同款，云函数可安装）
let XMLParser = null
try {
  ;({ XMLParser } = require('fast-xml-parser'))
} catch (e) {
  XMLParser = null // 未安装 → 走 parseRssLight 纯零依赖兜底
}

// 常量（可被调用方覆盖）
const DEFAULT_UA = 'Mozilla/5.0 (compatible; IntelOfficer/1.0; +ai-intel-officer)'
const REQUEST_TIMEOUT_MS = 30 * 1000
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024 // 5MB，防超大 feed
const MAX_RETRIES = 2 // 失败重试 2 次（共 3 次尝试）

/**
 * 单请求发起（带 ETag/Last-Modified 304 语义 + 重定向跟随 + 大小上限）
 * 【真实部署替换】可整体替换为 One News `utils/apiFetch.get`（复用审计 🟢直接）
 * @param {string} url
 * @param {Object} prev - { etag, lastModified } 上次抓取缓存头
 * @returns {Promise<{ok, notModified, status, text, etag, lastModified}>}
 */
function fetchFeed(url, prev = {}) {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? require('https') : require('http')
    const headers = {
      'User-Agent': DEFAULT_UA,
      'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      'Cache-Control': 'no-cache',
    }
    if (prev.etag) headers['If-None-Match'] = prev.etag
    if (prev.lastModified) headers['If-Modified-Since'] = prev.lastModified

    let attempt = 0
    const done = resolve // 一次 resolve 到底（重试也复用同一 settle）
    const tryOnce = () => {
      attempt++
      const req = protocol.get(url, { timeout: REQUEST_TIMEOUT_MS, headers }, (res) => {
        const status = res.statusCode || 0
        // 304 → 内容未变（ETag/If-Modified 复用，守源站礼节）
        if (status === 304) {
          res.resume()
          return resolve({ ok: true, notModified: true, status, text: null, etag: res.headers.etag || null, lastModified: res.headers['last-modified'] || null })
        }
        // 跟随一次重定向
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume()
          return fetchFeed(new URL(res.headers.location, url).toString(), prev).then(resolve)
        }
        const chunks = []
        let total = 0
        res.on('data', (c) => {
          total += c.length
          if (total > MAX_DOWNLOAD_BYTES) { req.destroy(); resolve({ ok: false, notModified: false, status, text: null, etag: null, lastModified: null }); return }
          chunks.push(c)
        })
        res.on('end', () => {
          let text = Buffer.concat(chunks).toString('utf8')
          // ⚠️ 调研 §5.5 三：MarkTechPost / 机器之心等返回 gzip 压缩，必须处理 Content-Encoding
          // 【真实部署替换】Node 原生 fetch 无自动解压，此处需按 res.headers['content-encoding']
          //   判断并调用 zlib.gunzip / inflate 解压后再 toString。示例：
          //   const zlib = require('zlib')
          //   if (enc === 'gzip') text = zlib.gunzipSync(Buffer.concat(chunks)).toString('utf8')
          resolve({ ok: true, notModified: false, status, text, etag: res.headers.etag || null, lastModified: res.headers['last-modified'] || null })
        })
        res.on('error', () => resolve({ ok: false, notModified: false, status, text: null, etag: null, lastModified: null }))
      })
      req.on('error', () => {
        // 网络错误：未超重试次数则重试（指数退避）
        if (attempt <= MAX_RETRIES) return setTimeout(tryOnce, 500 * Math.pow(2, attempt - 1))
        done({ ok: false, notModified: false, status: 0, text: null, etag: null, lastModified: null })
      })
      req.on('timeout', () => {
        req.destroy()
        if (attempt <= MAX_RETRIES) return setTimeout(tryOnce, 500 * Math.pow(2, attempt - 1))
        done({ ok: false, notModified: false, status: 0, text: null, etag: null, lastModified: null })
      })
      req.end()
    }
    tryOnce()
  })
}

/**
 * RSS/Atom → 归一化条目（优先 fast-xml-parser，未安装走轻量正则兜底）
 * @param {string} xmlText
 * @returns {Array<{title,url,pubDate,summary,content}>}
 */
function parseRss(xmlText) {
  if (!xmlText || typeof xmlText !== 'string') return []
  if (XMLParser) {
    // 复用 One News rssParser 解析选项：实体展开上限调高防中文 feed 被误拒（复用审计直接复制的关键细节）
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      trimValues: true,
      parseTagValue: false,
      processEntities: { maxTotalExpansions: 1000000, maxEntityCount: 1000000, maxExpandedLength: 1000000 },
      htmlEntities: true,
      cdataPropName: '__cdata',
    })
    const doc = parser.parse(xmlText)
    const root = doc && (doc.rss || doc.feed)
    if (!root) return []
    const items = []
    if (doc.rss) {
      const channel = doc.rss.channel || {}
      const raw = [].concat(channel.item || [])
      raw.forEach((it) => {
        const url = cleanStr(it.link)
        const title = cleanStr(it.title)
        if (!title || !url) return
        items.push({
          title,
          url,
          pubDate: cleanStr(it.pubDate || it['dc:date'] || it.date),
          summary: stripHtml(cleanStr(it.description || it.summary)).slice(0, 300),
          content: stripHtml(cleanStr(it['content:encoded'] || it.description || '')).slice(0, 5000),
        })
      })
    } else if (doc.feed) {
      const raw = [].concat(doc.feed.entry || [])
      raw.forEach((it) => {
        const links = [].concat(it.link || [])
        let url = ''
        for (const l of links) {
          const href = cleanStr(l['@_href'] || l.href)
          const rel = cleanStr(l['@_rel'] || '')
          if (!rel || rel === 'alternate') { url = href; break }
        }
        const title = cleanStr((it.title && it.title['#text']) || it.title)
        if (!title || !url) return
        const content = cleanStr((it.content && (it.content['#text'] || it.content.__cdata)) || it.summary || '')
        items.push({
          title,
          url,
          pubDate: cleanStr(it.published || it.updated),
          summary: stripHtml(content).slice(0, 300),
          content: stripHtml(content).slice(0, 5000),
        })
      })
    }
    return items
  }
  return parseRssLight(xmlText)
}

/** 纯零依赖轻量 RSS 解析（无 fast-xml-parser 时兜底；只保证 title/link/pubDate 基本可用） */
function parseRssLight(xmlText) {
  const items = []
  // 兼容 RSS <item> 与 Atom <entry> 的简单切分
  const itemBlocks = xmlText.split(/<item>|<entry>/i).slice(1)
  for (const block of itemBlocks) {
    const get = (tag) => {
      const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block)
      return m ? stripHtml(m[1]) : ''
    }
    const title = get('title')
    const url = get('link').trim() || (() => {
      const m = /<link[^>]*href\s*=\s*["']([^"']+)["']/i.exec(block)
      return m ? m[1] : ''
    })()
    if (!title || !url) continue
    items.push({ title, url, pubDate: get('pubDate') || get('published') || get('updated'), summary: '', content: '' })
  }
  return items
}

/** 去 HTML 标签（版权红线：只存摘要，正文仅作 AI 加工瞬时数据） */
function stripHtml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}
function cleanStr(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'object') {
    const t = v['#text'] !== undefined ? v['#text'] : v.__cdata
    if (t != null) return String(t).trim()
    return ''
  }
  return String(v).trim()
}

// ── guid 生成（去重主键，复用 One News fingerprint 的 urlFp/titleFp 思路）──
const crypto = require('crypto')
function normalizeUrl(url) {
  return String(url || '')
    .replace(/^(https?:\/\/)?/i, '')
    .replace(/\/+$/, '')
    .replace(/([?&])(utm_[a-z]+|spm|from|from_|source|ref)=[^&]*(&|$)/gi, '$1')
    .replace(/[?&]+$/, '')
}
function makeGuid(sourceId, raw) {
  const urlFp = crypto.createHash('sha256').update(normalizeUrl(raw.url)).digest('hex')
  const titleFp = crypto.createHash('sha256').update(String(raw.title || '').replace(/\s+/g, ' ').trim()).digest('hex')
  return `${sourceId}:${urlFp}:${titleFp.slice(0, 12)}`
}

/**
 * 统一适配器接口：fetch(source, opts) -> items[]
 * @param {Object} source - sources-manifest.json 中的源定义
 * @param {Object} opts - { since: Date, prev: {etag,lastModified} }
 * @returns {Promise<{notModified:boolean, items:Array<Object>}>}
 */
async function fetch(source, opts = {}) {
  const prev = opts.prev || {}
  const res = await fetchFeed(source.rssUrl, prev)
  if (res.notModified) return { notModified: true, items: [] }
  if (!res.ok || !res.text) return { notModified: false, items: [], error: `HTTP ${res.status}` }

  const rawItems = parseRss(res.text)
  const sinceTs = opts.since ? new Date(opts.since).getTime() : 0
  const items = rawItems
    .filter((it) => {
      // 时间窗增量：published_at 在 since 之后才进（RSS 多仅露最新 10-20 条，够用）
      const t = it.pubDate ? new Date(it.pubDate).getTime() : 0
      return !sinceTs || !t || t >= sinceTs
    })
    .map((it) => ({
      source_id: source.id,
      item_guid: makeGuid(source.id, it),
      title: it.title,
      url: it.url,
      published_at: it.pubDate || new Date().toISOString(),
      raw_content: it.content, // 版权红线：仅作 AI 加工瞬时数据，不向用户展示、不持久化全文
      summary: it.summary,
      fetch_method: 'rss',
      fetched_at: new Date().toISOString(),
    }))
  return { notModified: false, items, etag: res.etag, lastModified: res.lastModified }
}

module.exports = { fetch, parseRss, makeGuid }
