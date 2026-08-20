// 情报按源 worker（T1.4b / I 基础设施）
// ============================================================
// ⚠️ 复用 One News rssFetcher 的 per-source worker 范式（非其业务）：
//    全局开关 + 自愈建表 + 幂等播种 + listEnabledFeeds（固定节点无条件抓全部启用源）+ 每源 fetch→解析→去重→
//    写 intel_ingest + 更新 lastSuccessCursor + 四类告警。intel_* 命名空间隔离。
//
// 数据流（§1.1 / §7.2）：intel_ingest（原始）→ 质量门 → intel_staged（处理后）
//    → 发布闸门 T 时刻置 isCurrent 指针 → intel_current（用户可见）。
//    T1.4 覆盖：intel_ingest 写入 + lastSuccessCursor 增量游标（跨 05/11/18 续传）。
//
// 增量游标续传（§5.8 #3）：
//   - intel_sources.lastSuccessCursor 记录「上次成功抓取到的最晚 publishedAt」；
//   - api 类源（HN/arXiv）把 cursor 转成 since 时间窗，避免重复拉旧数据；
//   - rss/scrape 类只露最新 10–20 条，不按 cursor 硬过滤（防漏），靠 guid 去重；
//   - 每次成功抓取后写回新 cursor，跨 05/11/18 三次巡检自动续传。
//
// guid 幂等去重（硬约束 #4）：唯一键 = 源 id + item guid（sha256），
//   先批量查 intel_ingest 已存在则跳过，另建唯一索引双保险。
//
// 单源超时 + 重试（硬约束 #5）：每源预算 5–15s（rss 8s / api 10s / scrape 15s），
//   apiFetch 内建 2 次重试，scrape 包一层 1 次重试，外层 Promise.race 掐超时；
//   所有路径不 await 出界 → 适配 60s 硬超时。
//
// 部署注意：本函数 require('../common/ensureSchema') 与 require('../seedSources')，
//   部署云函数时需将 backend/common/ 与 backend/seedSources.js 一并上传。
// ============================================================

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const crypto = require('crypto')
const { XMLParser } = require('fast-xml-parser')
const { ensureSchema } = require('../common/ensureSchema')
const { seed } = require('../seedSources')
const { fetchWebPage, extractContentFromHtml } = require('../common/contentFetcher')

// ─── 集合名（intel_* 命名空间）───
const INTEL_INGEST = 'intel_ingest'
const INTEL_SOURCES = 'intel_sources'
const INTEL_HEALTH = 'intel_health'

// ─── 阈值（仿 rssFetcher）───
const ERROR_STREAK_LIMIT = 3   // 连续 N 次入库=0 → 暂停 + 告警
const MAX_BATCH_INSERT = 200   // 单轮入库 ≥ 此值 → 大批量告警
const MAX_SERIAL_SOURCES = 3   // 无参编排下串行上限，超过则自我分片

// ─── 单源超时预算（硬约束 #5：5–15s）───
// 2026-08-19 复盘：arXiv api 类 10s 实测超时（export.arxiv.org 慢），api 预算放宽到 15s
// 2026-08-20 修复：rss/news 超时 8s→20s（RSS 源下载+解析 8s 完不成被 Promise.race 掐断 → 全部超时跳过、批次 0 新增；
//   api/scrape 15s→20s 同理）。云函数 60s 预算内单个 worker 处理 1 源，20s 安全。
const TIMEOUT_BY_TYPE = { rss: 20000, news: 20000, api: 20000, scrape: 20000, wechat: 5000 }

// ───────────────────────────
// 复用 One News rssFetcher/utils/apiFetch.js（非其业务）：HTTP 抓取 + 重试 + GBK 解码
// ───────────────────────────
const REQUEST_TIMEOUT_MS = 30 * 1000
const MAX_RETRIES = 2
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024
const DEFAULT_UA = 'Mozilla/5.0 (compatible; IntelOfficer/1.0; +intel.onenews.app)'

function _requestOnce(url, { headers = {}, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? require('https') : require('http')
    const req = protocol.get(url, {
      timeout: timeoutMs,
      headers: Object.assign({
        'User-Agent': DEFAULT_UA,
        'Accept': 'application/rss+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cache-Control': 'no-cache',
      }, headers),
    }, (res) => {
      const status = res.statusCode || 0
      if (status === 304) {
        res.resume()
        resolve({ status, notModified: true, rawBuffer: null, headers: res.headers })
        return
      }
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        const nextUrl = new URL(res.headers.location, url).toString()
        return _requestOnce(nextUrl, { headers, timeoutMs }).then(resolve)
      }
      const chunks = []
      let total = 0
      res.on('data', (chunk) => {
        total += chunk.length
        if (total > MAX_DOWNLOAD_BYTES) {
          req.destroy()
          resolve({ status, notModified: false, rawBuffer: Buffer.concat(chunks), headers: res.headers })
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => resolve({ status, notModified: false, rawBuffer: Buffer.concat(chunks), headers: res.headers }))
      res.on('error', () => resolve({ status, notModified: false, rawBuffer: null, headers: res.headers }))
    })
    req.on('error', () => resolve({ status: 0, notModified: false, rawBuffer: null, headers: {} }))
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, notModified: false, rawBuffer: null, headers: {} }) })
    req.end()
  })
}

function _decodeBuffer(buffer, declaredEncoding) {
  const buf = Buffer.from(buffer)
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString('utf8')
  }
  const declared = (declaredEncoding || '').toLowerCase()
  const head = buf.slice(0, 200).toString('utf8')
  const em = /encoding\s*=\s*["']([^"']+)["']/i.exec(head)
  const enc = declared || (em ? em[1] : null)
  if (enc && enc !== 'utf-8' && enc !== 'utf8') {
    const canonical = enc.replace(/[-_]/g, '').toLowerCase()
    if (canonical === 'gbk' || canonical === 'gb2312' || canonical === 'gb18030') {
      if (typeof TextDecoder !== 'undefined') return new TextDecoder('gbk').decode(buf)
      try { const iconv = require('iconv-lite'); return iconv.decode(buf, 'gbk') } catch (e) { /* 回退 UTF-8 */ }
    }
  }
  return buf.toString('utf8')
}

/** 抓取 URL → { ok, text, notModified, status, lastModified, etag }（304 语义 + 2 次重试） */
async function intelHttpGet(url, options = {}) {
  const prev = options.prev || {}
  const cacheHeaders = {}
  if (prev.lastModified) cacheHeaders['If-Modified-Since'] = prev.lastModified
  if (prev.etag) cacheHeaders['If-None-Match'] = prev.etag

  let resp = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    resp = await _requestOnce(url, { headers: Object.assign(cacheHeaders, options.headers || {}) })
    if (resp.status === 200 || resp.status === 304) break
    if (resp.status >= 400 && resp.status < 500) break
  }
  const lastModified = resp.headers['last-modified'] || null
  const etag = resp.headers['etag'] || null
  if (resp.notModified) return { ok: true, notModified: true, text: null, status: 304, lastModified, etag }
  if (resp.status !== 200 || !resp.rawBuffer) {
    return { ok: false, notModified: false, text: null, status: resp.status, lastModified, etag }
  }
  const rawText = Buffer.from(resp.rawBuffer).slice(0, 200).toString('utf8')
  const em = /encoding\s*=\s*["']([^"']+)["']/i.exec(rawText)
  return {
    ok: true, notModified: false,
    text: _decodeBuffer(resp.rawBuffer, em ? em[1] : ''),
    status: 200, lastModified, etag,
  }
}

// ───────────────────────────
// 复用 One News rssFetcher/utils/rssParser.js（非其业务）：XML/RSS/Atom → 条目
// ───────────────────────────
const PARSE_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  arrayMode: false,
  cdataPropName: '__cdata',
  processEntities: { maxTotalExpansions: 1000000, maxEntityCount: 1000000, maxExpandedLength: 1000000 },
  htmlEntities: true,
}

function _cleanStr(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'object') {
    const txt = v['#text'] !== undefined ? v['#text'] : v.__cdata
    if (txt != null) return String(txt).trim()
    for (const k of Object.keys(v)) {
      if (k.startsWith('@_')) continue
      const r = _cleanStr(v[k])
      if (r) return r
    }
    return ''
  }
  return String(v).trim()
}

/** 提取完整分类列表（RSS <category> 可多个；Atom category@term）。2026-08-19 复盘：量子位噪音需按全部分类过滤 */
function _categoryList(v) {
  if (v == null) return []
  const arr = Array.isArray(v) ? v : [v]
  const out = []
  for (const c of arr) {
    let s = ''
    if (typeof c === 'string') s = c.trim()
    else if (c && typeof c === 'object') {
      if (typeof c['@_term'] === 'string') s = c['@_term'].trim()
      else s = _cleanStr(c)
    }
    if (s) out.push(s)
  }
  return out
}

function _cleanSummary(v) {
  const s = _cleanStr(v)
  if (!s) return ''
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
}

function _cleanContent(v) {
  const s = _cleanStr(v)
  if (!s) return ''
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, 5000)
}

function _toArray(v) {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

/** 智谱富文本（draft-js 风格 root.children[]）递归提取纯文本 */
function extractZhipuContent(contentZh) {
  if (!contentZh || !contentZh.root || !Array.isArray(contentZh.root.children)) return ''
  const out = []
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (typeof n === 'string') { out.push(n); continue }
      if (n && Array.isArray(n.children)) walk(n.children)
      else if (n && typeof n.text === 'string') out.push(n.text)
    }
  }
  walk(contentZh.root.children)
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** 解析 RSS/Atom XML → { items:[{title,url,pubDate,guid,category,desc,content}], channelTitle } */
function intelParseXml(xmlText) {
  const out = { items: [], channelTitle: null }
  if (!xmlText || typeof xmlText !== 'string') return out
  let doc
  try {
    doc = new XMLParser(PARSE_OPTIONS).parse(xmlText)
  } catch (err) {
    throw new Error(`XML 解析失败: ${err.message}`)
  }
  const root = doc && (doc.rss || doc.feed)
  if (!root) return out

  if (doc.rss) {
    const channel = doc.rss.channel
    if (!channel) return out
    out.channelTitle = _cleanStr(channel.title) || null
    out.items = _toArray(channel.item)
      .map((it) => ({
        title: _cleanStr(it.title),
        url: _cleanStr(it.link),
        pubDate: _cleanStr(it.pubDate || it['dc:date'] || it.date),
        guid: _cleanStr(it.guid) || _cleanStr(it.link),
        category: _cleanStr(it.category),
        categoryAll: _categoryList(it.category),
        desc: _cleanSummary(it.description || it.summary || it['content:encoded'] || ''),
        content: _cleanContent(it['content:encoded'] || it.description || it.summary || ''),
      }))
      .filter((it) => it.title && it.url)
    return out
  }

  if (doc.feed) {
    out.channelTitle = (doc.feed.title && doc.feed.title['#text']) || _cleanStr(doc.feed.title) || null
    out.items = _toArray(doc.feed.entry).map((it) => {
      let url = ''
      const links = _toArray(it.link)
      for (const l of links) {
        const href = (l && (l['@_href'] || l.href)) || ''
        const rel = (l && (l['@_rel'] || l.rel)) || ''
        if (!rel || rel === 'alternate') { url = href; break }
      }
      if (!url && links.length) url = (links[0]['@_href'] || links[0].href) || ''
      const atomContent = (it.content && (it.content['#text'] || it.content.__cdata || _cleanStr(it.content))) || ''
      // 2026-08-20 修复：arXiv 等 Atom 源只有 <summary> 无 <content>——content 用摘要兜底（否则空壳闸门全拒）
      const atomSummary = (it.summary && (it.summary['#text'] || it.summary.__cdata || _cleanStr(it.summary))) || ''
      return {
        title: _cleanStr((it.title && it.title['#text']) || it.title),
        url: _cleanStr(url),
        pubDate: _cleanStr(it.published || it.updated || ''),
        guid: _cleanStr(it.id) || _cleanStr(url),
        category: _cleanStr((it.category && (it.category['@_term'] || it.category['#text'])) || it.category),
        categoryAll: _categoryList(it.category),
        desc: _cleanSummary(atomSummary || atomContent),
        content: _cleanContent(atomContent || atomSummary),
      }
    }).filter((it) => it.title && it.url)
    return out
  }
  return out
}

// ───────────────────────────
// 复用 One News rssFetcher/utils/fingerprint.js 的指纹范式（非其业务）
// ───────────────────────────
function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex')
}

function normalizeUrl(url) {
  if (!url) return ''
  let u = String(url).trim()
  u = u.replace(/^(https?:\/\/)?/i, '').replace(/\/+$/, '')
  u = u.replace(/([?&])(utm_[a-z]+|spm|from|from_|source|ref)=[^&]*(&|$)/gi, '$1').replace(/[?&]+$/, '')
  return u
}

/** P0 优化（2026-08-19）：标题归一化指纹——去标点/空白/大小写与聚合前缀，取前 20 字符，
 *  用于「跨源同主题去重」（同一新闻在量子位/极客公园等多源重复，只保留一条最完整版本，省 LLM） */
function normTitleFp(title) {
  const n = String(title || '').toLowerCase()
    .replace(/[\s\W_]+/g, '')
    .replace(/^(ainews|今日热点|热点|早报|晚报|日报)/, '')
    .slice(0, 20)
  return n ? sha256(n).slice(0, 24) : ''
}

/** P0 跨源同主题去重：同批内按 normTitleFp 合并（保留 content 更长者）；再查库，
 *  已有同主题且为 pending、新内容明显更完整 → 升级已有条目内容（保留原 guid，不重复入库） */
async function crossSourceDedup(items) {
  if (!items || !items.length) return items
  // ① 同批内合并
  const byFp = {}
  const noFp = []
  for (const it of items) {
    const fp = it.normTitleFp || ''
    if (!fp) { noFp.push(it); continue }
    const prev = byFp[fp]
    if (!prev) byFp[fp] = it
    else if (String(it.content || '').length > String(prev.content || '').length) byFp[fp] = it
  }
  const uniq = [...Object.values(byFp), ...noFp]
  // ② 查库去重（分 20 一批）
  const fps = [...new Set(uniq.map((c) => c.normTitleFp).filter(Boolean))]
  const existMap = {}
  try {
    for (let i = 0; i < fps.length; i += 20) {
      const chunk = fps.slice(i, i + 20)
      const res = await db.collection(INTEL_INGEST)
        .where({ normTitleFp: db.command.in(chunk) })
        .field({ _id: true, normTitleFp: true, content: true, summary: true, status: true, sourceId: true })
        .limit(20).get()
      ;(res.data || []).forEach((d) => { existMap[d.normTitleFp] = d })
    }
  } catch (e) {
    console.warn('[worker] 跨源去重查库失败（降级为全部写入）:', e.message)
  }
  const out = []
  for (const it of uniq) {
    const fp = it.normTitleFp || ''
    const ex = fp ? existMap[fp] : null
    if (!ex) { out.push(it); continue }
    const exLen = String(ex.content || ex.summary || '').length
    const newLen = String(it.content || it.summary || '').length
    if (ex.status === 'pending' && newLen > exLen + 200) {
      // 已有条目尚未处理且新内容明显更完整 → 升级已有条目（内容/标题/来源），保留原 guid
      try {
        await db.collection(INTEL_INGEST).doc(ex._id).update({
          data: { content: it.content, summary: it.summary, title: it.title, sourceId: it.sourceId, sourceName: it.sourceName },
        })
        console.log(`[worker] 跨源升级 ${ex.sourceId}→${it.sourceId}: ${String(it.title).slice(0, 30)}`)
      } catch (e) { /* 非阻塞 */ }
    }
    // 否则丢弃重复主题（已有更完整/已处理版本）
  }
  return out
}

function cleanTitle(title) {
  return String(title || '').replace(/\s+/g, ' ').replace(/^[【\[]+|[】\]]+$/g, '').trim()
}

/** guid 幂等去重键（硬约束 #4）：源 id + item guid → 唯一键 */
function makeGuid(sourceId, guidRaw) {
  return `intel_${sourceId}_${sha256(normalizeUrl(guidRaw))}`
}

/**
 * 校验并规整一条候选条目（对齐设计 §5.1 Item + 版权红线：不落正文全文至 current）。
 * @returns {{ok:boolean, item?:Object, reason?:string}}
 */
function validateIntelItem(raw, meta) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: '候选条目为空' }
  const title = cleanTitle(raw.title)
  const rawUrl = String(raw.url || '').trim()
  if (!title) return { ok: false, reason: '缺标题' }
  if (!rawUrl) return { ok: false, reason: '缺 URL' }
  if (!/^https?:\/\//i.test(rawUrl)) return { ok: false, reason: `URL 非 http(s)：${rawUrl.slice(0, 40)}` }
  if (title.length < 4) return { ok: false, reason: `标题过短(${title.length}字)` }
  if (title.length > 300) return { ok: false, reason: `标题过长(${title.length}字)` }
  const pubDate = raw.pubDate || ''
  const fetchedAt = new Date().toISOString()
  const guidRaw = raw.guid || rawUrl
  const item = {
    guid: makeGuid(meta.sourceId, guidRaw),
    guidRaw: String(guidRaw).slice(0, 512),
    sourceId: String(meta.sourceId),
    sourceName: String(meta.sourceName || meta.sourceId),
    layer: meta.layer || '',
    sourceType: meta.sourceType || '',
    targetTime: meta.targetTime || '',
    freshnessDays: meta.freshnessDays || undefined, // 2026-08-20：per-source 新鲜度（intelProcess 用）
    minContent: meta.minContent || undefined, // 2026-08-20：per-source 空壳阈值（官方动态摘要短可放宽）
    title,
    url: rawUrl,
    urlFp: sha256(normalizeUrl(rawUrl)),
    // P0 优化（2026-08-19）：归一化标题指纹，跨源同主题去重用（去标点/空白/大小写，取前 20 字符）
    normTitleFp: normTitleFp(title),
    titleFp: sha256(title),
    summary: String(raw.desc || raw.summary || ''),
    // 版权红线：content 仅作 AI 加工源数据（瞬时 staging），intel_current 不落全文
    content: String(raw.content || ''),
    publishedAt: pubDate || fetchedAt,
    fetchedAt,
    status: 'pending', // 待质量门 → intelProcess 消费（Phase 3）
  }
  return { ok: true, item }
}

/** 标题过滤（仿 rssFetcher/filter.js：blockTitleKeywords） */
function passTitleFilter(title, extraKeywords) {
  const t = String(title || '').toLowerCase()
  const keywords = ['直播', '专题', '招聘', '商务合作', '广告', '免责声明', 'sponsored', 'advertorial']
    .concat(extraKeywords || [])
    .filter(Boolean)
  for (const kw of keywords) {
    if (t.includes(kw)) return false
  }
  return true
}

/** 分类过滤（2026-08-19 新增）：feed.blockCategoryKeywords 命中的分类直接剔除。
 *  例：量子位 RSS 全站内容，「智能车参考/车圈/比亚迪/吉利」等分类为汽车/商业噪音。 */
function passCategoryFilter(raw, extraKeywords) {
  const kws = (extraKeywords || []).map((k) => String(k).toLowerCase()).filter(Boolean)
  if (!kws.length) return true
  const cats = (raw && raw.categoryAll && raw.categoryAll.length ? raw.categoryAll : [raw && raw.category])
    .map((c) => String(c || '').toLowerCase())
    .filter(Boolean)
  for (const c of cats) {
    for (const k of kws) {
      if (c.includes(k)) return false
    }
  }
  return true
}

/** 标题清洗（2026-08-19 新增）：剥离聚合源前缀噪音，如 Latent Space AINews 的 "AINews] " */
function cleanItemTitle(title) {
  const t = String(title || '').trim()
  if (!t) return t
  const cleaned = t.replace(/^AINews\]\s*/i, '').trim()
  return cleaned || t
}

// ───────────────────────────
// 抓取适配器（四类：rss / news / api / scrape）
// ───────────────────────────

/** 拼接 GET URL（baseUrl + params） */
function buildUrl(baseUrl, params) {
  if (!params || !Object.keys(params).length) return baseUrl
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${qs}`
}

/**
 * 抓取单源 → 归一化条目列表 [{title,url,pubDate,guid,desc,content}]。
 * @param {Object} feed intel_sources 文档
 * @param {Object} ctx { sinceMs } 增量游标（api 类用）
 */
/** owner 2026-08-19：档位窗口起点——无游标（首次/丢失）时兜底，只收「上次抓取点之后」发布的。
 * 05:00 档→昨天18:00；11:00 档→今天05:00；18:00 档→今天11:00（北京时区）。
 * @param {number} [now] 当前时刻（ms），默认 Date.now()
 */
function batchWindowStartMs(now) {
  const n = now || Date.now()
  const d = new Date(n)
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const bh = (d.getUTCHours() + 8) % 24 // 北京小时
  if (bh < 8) return day - 14 * 3600 * 1000   // 05 档：昨天 18:00 北京 = UTC 昨天 10:00
  if (bh < 15) return day - 3 * 3600 * 1000   // 11 档：今天 05:00 北京 = UTC 昨天 21:00
  return day + 3 * 3600 * 1000                // 18 档：今天 11:00 北京 = UTC 今天 03:00
}

async function fetchSource(feed, ctx = {}) {
  const type = feed.sourceType || 'rss'
  const cfg = (feed.adapterConfig || {})
  const endpoint = cfg.endpoint || feed.baseUrl
  if (!endpoint) return { items: [], cursor: ctx.sinceMs || null }

  if (type === 'rss' || type === 'news') {
    // RSS / Google News RSS：直接解析 XML（apiFetch 内建重试 + 304 缓存语义靠 etag/lastModified）
    const res = await intelHttpGet(endpoint, { prev: { lastModified: feed.lastModified, etag: feed.etag } })
    if (res.notModified) return { items: [], cursor: ctx.sinceMs || null, notModified: true }
    if (!res.ok || !res.text) throw new Error(`RSS 抓取失败 status=${res.status}`)
    const parsed = intelParseXml(res.text)
    // 增量兜底（§5.8 owner 08-19 决策，方案 A）：RSS 全量拉最近 N 篇，但有 lastSuccessCursor
    // 时只保留「上次游标之后」的新增，历史旧文直接不进 ingest，避免旧文淹没新文、空烧 LLM。
    let items = parsed.items || []
    if (ctx.sinceMs) {
      const limit = Number(cfg.maxItems || 0) || 30
      const sorted = items.slice().sort((a, b) => {
        const ta = a.pubDate ? new Date(a.pubDate).getTime() : 0
        const tb = b.pubDate ? new Date(b.pubDate).getTime() : 0
        return tb - ta
      })
      const filtered = []
      for (const it of sorted) {
        const t = it.pubDate ? new Date(it.pubDate).getTime() : 0
        if (!t || t <= ctx.sinceMs) continue       // owner 2026-08-19：pubDate 无效或早于游标 → 跳过（防旧文/无时间戳混入）
        filtered.push(it)
        if (limit > 0 && filtered.length >= limit) break  // 单源本轮最多取最新 N 条
      }
      items = filtered
    }
    return { items, cursor: ctx.sinceMs || null, lastModified: res.lastModified, etag: res.etag }
  }

  if (type === 'api') {
    // 时间窗续传：api 类把 lastSuccessCursor 转成 since 毫秒（§5.8 #3）
    let params = Object.assign({}, cfg.params || {})
    if (ctx.sinceMs) {
      if (feed.key === 'hacker_news') {
        const nf = String(params.numericFilters || '')
        // 2026-08-19 复盘：HN 时间窗放宽到 24h 回看（原严格 since 只出 1-2 条），
        // 多拉候选靠 guid 去重，提高单轮候选量
        const sinceSec = Math.max(0, Math.floor((ctx.sinceMs - 24 * 3600 * 1000) / 1000))
        params.numericFilters = `points>100,created_at_i>${sinceSec}`
        if (nf && !nf.includes('created_at_i')) params.numericFilters = `${nf},created_at_i>${sinceSec}`
      } else if (feed.key === 'arxiv_ai') {
        // arXiv 时间窗：submittedDate:[YYYYMMDDHHMM TO YYYYMMDDHHMM]
        const toTs = Date.now()
        const fmt = (t) => {
          const d = new Date(t)
          const p = (n) => String(n).padStart(2, '0')
          return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`
        }
        params.search_query = `(cat:cs.AI OR cat:cs.CL OR cat:cs.CV) AND submittedDate:[${fmt(ctx.sinceMs)} TO ${fmt(toTs)}]`
      }
    }
    const url = buildUrl(endpoint, params)
    const res = await intelHttpGet(url)
    if (!res.ok || !res.text) throw new Error(`API 抓取失败 status=${res.status}`)
    const text = res.text.trim()
    // XML（arXiv Atom）→ rssParser；JSON（HN Algolia）→ 映射
    if (text.startsWith('<')) {
      const parsed = intelParseXml(text)
      return { items: parsed.items, cursor: ctx.sinceMs || null }
    }
    let json
    try { json = JSON.parse(text) } catch (e) { throw new Error(`API JSON 解析失败: ${e.message}`) }
    // HN Algolia hits 结构映射
    if (Array.isArray(json.hits)) {
      const items = json.hits
        .filter((h) => h.title && h.url)
        .map((h) => ({
          title: _cleanStr(h.title),
          url: _cleanStr(h.url),
          pubDate: _cleanStr(h.created_at) || '',
          guid: _cleanStr(h.objectID) || _cleanStr(h.url),
          desc: _cleanStr(h.story_text || h.title),
          content: _cleanStr(h.story_text || ''),
        }))
      return { items, cursor: ctx.sinceMs || null }
    }
    // MiniMax 官方（2026-08-20 接入）：/api/news → data[]（title/summary/publishDate ms/slug）
    if (Array.isArray(json.data) && feed.key === 'minimax_ai') {
      const items = json.data
        .filter((d) => d.title)
        .map((d) => ({
          title: _cleanStr(d.title),
          url: d.slug ? `https://www.minimaxi.com/blog/${d.slug}` : 'https://www.minimaxi.com/blog',
          pubDate: (d.publishDate && !Number.isNaN(Number(d.publishDate))) ? new Date(Number(d.publishDate)).toISOString() : '',
          guid: `minimax:${d.newsId || d.slug || d.title}`,
          desc: _cleanStr(d.summary || d.title),
          content: _cleanStr(d.summary || d.title),
          category: _cleanStr((d.tags || []).join(',')) || '',
        }))
      return { items, cursor: ctx.sinceMs || null }
    }
    // 智谱 AI 官方（2026-08-20 接入）：/api/articles → docs[]（title_zh/createAt/content_zh 富文本）
    if (Array.isArray(json.docs) && feed.key === 'zhipu_ai') {
      const items = json.docs
        .filter((d) => d.title_zh || d.title_en)
        .map((d) => ({
          title: _cleanStr(d.title_zh || d.title_en),
          url: `https://www.zhipuai.cn/zh/research/${d.id}`,
          pubDate: _cleanStr(d.createAt) || '',
          guid: `zhipu:${d.id}`,
          desc: _cleanStr(d.resume_zh || d.title_zh || d.title_en),
          content: extractZhipuContent(d.content_zh) || _cleanStr(d.resume_zh || ''),
          category: _cleanStr(d.category || ''),
        }))
      return { items, cursor: ctx.sinceMs || null }
    }
    throw new Error(`API 响应结构未知 key=${feed.key}`)
  }

  if (type === 'scrape') {
    // 官网正文/列表抓取（零依赖 contentFetcher；Phase 2 A 角色按源细化解析规则）
    const html = await fetchWebPage(endpoint)
    if (!html) throw new Error(`官网抓取失败 endpoint=${endpoint}`)
    // P2 优化：页面哈希缓存——页面未变直接 notModified，省重复解析/去重
    const pageHash = sha256(html)
    if (feed.lastPageHash && feed.lastPageHash === pageHash) {
      return { items: [], cursor: ctx.sinceMs || null, notModified: true, pageHash }
    }
    // 2026-08-19 复盘：entryMode=changelog（Docusaurus 更新日志单页）走专用提取；
    // 否则通用列表启发式（<h><a> 标题 + 可选 urlPattern 卡片式第二遍）
    let items = []
    if (cfg.entryMode === 'changelog') {
      items = extractChangelogEntries(html, { base: endpoint })
    } else {
      items = extractListLinks(html, { base: endpoint, urlPattern: cfg.urlPattern })
    }
    // 兜底：抓取整页正文（如无列表结构）
    if (items.length === 0) {
      const body = extractContentFromHtml(html)
      if (body) {
        items.push({ title: cleanTitle(feed.name || '官网'), url: endpoint, pubDate: '', guid: endpoint, desc: body.slice(0, 300), content: body })
      }
    }
    return { items, cursor: ctx.sinceMs || null, pageHash }
  }

  if (type === 'wechat') {
    // 公众号本地解析（T2.5）：云端 worker 只消费本地进程暴露的 HTTP API。
    // 物理通道未落地（本地进程不在此网络）→ 静默降级（degraded），绝不 throw 阻塞整轮巡检，
    // 也不累加 errorStreak（返空 + degraded，由 runWorker 的 empty 分支轻量处理）。
    const base = (cfg.localApiBase) || process.env.WECHAT_LOCAL_API_BASE || 'http://127.0.0.1:8787'
    try {
      const sinceSec = ctx.sinceMs ? Math.floor(ctx.sinceMs / 1000) : 0
      const url = buildUrl(`${base}/api/items`, { since: String(sinceSec), limit: String(cfg.maxItems || 30) })
      const res = await intelHttpGet(url, { headers: { Accept: 'application/json' } })
      if (!res.ok || !res.text) return { items: [], cursor: ctx.sinceMs || null, degraded: true }
      let json
      try { json = JSON.parse(res.text) } catch (e) { return { items: [], cursor: ctx.sinceMs || null, degraded: true } }
      const list = Array.isArray(json) ? json : (json.items || [])
      const items = list
        .filter((r) => r.title || r.url || r.link)
        .map((r) => ({
          title: _cleanStr(r.title) || '(无标题)',
          url: _cleanStr(r.url || r.link || r.app_msg_url) || '',
          pubDate: _cleanStr(r.published_at || r.publish_time) || '',
          guid: _cleanStr(r.guid) || `wechat:${sha256(r.url || r.link || r.title + r.published_at)}`,
          desc: _cleanStr(r.summary || r.digest || r.content || r.title),
          content: _cleanStr(r.content || r.digest || ''),
          category: _cleanStr(r.author || ''),
        }))
      return { items, cursor: ctx.sinceMs || null, degraded: items.length === 0 }
    } catch (e) {
      // 合规红线：本地进程不可达 → 静默降级，不向云端抛错
      console.warn(`[worker] ${feed.key || feed._id} 公众号本地进程不可达，静默降级:`, e.message)
      return { items: [], cursor: ctx.sinceMs || null, degraded: true }
    }
  }

  throw new Error(`未支持的 sourceType=${type}`)
}

/**
 * 官网列表页通用链接提取（标题级链接启发式，供 scrape 类源使用）。
 * 2026-08-19 复盘增强：
 *  - 原实现只认 <h\d><a>标题</a></h\d>；多数现代官网是「卡片式 <a><h2-6>标题</h2-6><p>描述</p></a>」
 *  - 新增第二遍 anchor-block 扫描：仅当 adapterConfig.urlPattern 提供时启用（不改变既有源行为），
 *    从 <a> 块内提取 h2-h6 标题 + 中文/ISO 日期 + 首个 <p> 描述
 * @param {string} html
 * @param {Object} [opts] { base, urlPattern, maxItems }
 */
function extractListLinks(html, opts = {}) {
  const items = []
  const seen = new Set()
  const base = opts.base || 'https://x'
  const maxItems = opts.maxItems || 30
  const resolve = (u) => (/^https?:\/\//i.test(u) ? u : new URL(u, base).toString())

  // 遍 1：<h\d><a>标题</a></h\d>（既有行为保留）
  const re = /<h([1-4])[^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h\1>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    const title = m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    let url = resolve(m[2].trim())
    if (!title || title.length < 4) continue
    if (opts.urlPattern && !new RegExp(opts.urlPattern, 'i').test(url)) continue
    const fp = sha256(url)
    if (seen.has(fp)) continue
    seen.add(fp)
    items.push({ title, url, pubDate: '', guid: url, desc: '', content: '' })
    if (items.length >= maxItems) break
  }
  if (items.length >= maxItems) return items

  // 遍 3（2026-08-20）：urlPattern 匹配的任意 <a href><文本>（覆盖 MiniMax 等非 h/a 结构列表）
  if (opts.urlPattern && items.length < maxItems) {
    const anyRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{2,300}?)<\/a>/gi
    while ((m = anyRe.exec(html)) !== null) {
      const rawUrl = m[1].trim()
      if (rawUrl.startsWith('#') || rawUrl.startsWith('javascript:') || rawUrl.startsWith('mailto:')) continue
      if (!new RegExp(opts.urlPattern, 'i').test(rawUrl)) continue
      let url = resolve(rawUrl)
      const title = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      if (!title || title.length < 6) continue
      // 2026-08-20：从链接上下文（锚文本后 300 字符）提取日期作为 pubDate（MiniMax 等列表页无标准日期标签）
      let pubDate = ''
      const ctx = html.slice(m.index, m.index + m[0].length + 300)
      const dm = ctx.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/) || ctx.match(/(\d{1,2})[-/](\d{1,2})[-/](20\d{2})/)
      if (dm) {
        const y = dm[1].length === 4 ? dm[1] : dm[3]
        const mo = dm[1].length === 4 ? dm[2] : dm[1]
        const d = dm[1].length === 4 ? dm[3] : dm[2]
        pubDate = `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}T00:00:00+08:00`
      }
      const fp2 = sha256(url)
      if (seen.has(fp2)) continue
      seen.add(fp2)
      items.push({ title, url, pubDate, guid: url, desc: '', content: '' })
      if (items.length >= maxItems) break
    }
  }

  // 遍 2：卡片式 <a href><h2-6>标题…</h2-6>…</a>（仅 urlPattern 源启用，避免影响既有源）
  if (opts.urlPattern) {
    const anchorRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,6000}?)<\/a>/gi
    while ((m = anchorRe.exec(html)) !== null) {
      const rawUrl = m[1].trim()
      const inner = m[2]
      if (rawUrl.startsWith('#') || rawUrl.startsWith('javascript:')) continue
      let url = resolve(rawUrl)
      if (!new RegExp(opts.urlPattern, 'i').test(url)) continue
      if (inner.length < 60) continue
      const h = inner.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)
      if (!h) continue
      const title = h[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      if (title.length < 4) continue
      let pubDate = ''
      const dm = inner.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/) ||
        inner.match(/(\d{4})-(\d{1,2})-(\d{1,2})/) ||
        inner.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/)
      if (dm) pubDate = `${dm[1]}-${String(dm[2]).padStart(2, '0')}-${String(dm[3]).padStart(2, '0')}`
      let desc = ''
      const ps = inner.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || []
      for (const p of ps) {
        const t = p.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        // 跳过纯日期/栏目行（如「动态 2026 年 4 月 24 日」）
        if (t.length > 10 && t !== title && !/^(动态|新闻|公告|更新|资讯)?\s*\d{4}\s*[年\/\-]/.test(t)) {
          desc = t.slice(0, 300); break
        }
      }
      const fp = sha256(url)
      if (seen.has(fp)) continue
      seen.add(fp)
      items.push({ title, url, pubDate, guid: url, desc, content: desc })
      if (items.length >= maxItems) break
    }
  }
  return items
}

/**
 * Docusaurus 风格更新日志提取（2026-08-19 新增，deepseek_changelog 用）：
 * 单页结构：<h2>Date: YYYY-MM-DD</h2> <h3>标题</h3> 正文…
 * 按日期 h2 切块，取每块 h3 标题 + 正文摘要 + 页面锚点 URL。
 */
function extractChangelogEntries(html, opts = {}) {
  const items = []
  const base = opts.base || 'https://x'
  const dateRe = /<h2[^>]*>\s*Date:\s*(\d{4})-(\d{1,2})-(\d{1,2})/gi
  let m = dateRe.exec(html)
  if (!m) return items
  const blocks = []
  let lastStart = m.index
  let lastDate = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
  while ((m = dateRe.exec(html)) !== null) {
    blocks.push({ date: lastDate, html: html.slice(lastStart, m.index) })
    lastStart = m.index
    lastDate = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
  }
  blocks.push({ date: lastDate, html: html.slice(lastStart) })
  const seen = new Set()
  for (const b of blocks) {
    const h3 = b.html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)
    if (!h3) continue
    const title = h3[1].replace(/<[^>]+>/g, ' ').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim()
    if (title.length < 4) continue
    const content = b.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
    const slug = title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '') || sha256(title).slice(0, 12)
    const url = `${base}#${slug}`
    const fp = sha256(url)
    if (seen.has(fp)) continue
    seen.add(fp)
    items.push({ title, url, pubDate: b.date, guid: url, desc: content.slice(0, 300), content })
    if (items.length >= 30) break
  }
  return items
}

/** 正向关键词过滤（2026-08-19 新增）：requireTitleKeywords 任一命中才放行（媒体全站 feed 用，省 LLM token） */
function passRequireKeywords(title, requireKeywords) {
  const kws = (requireKeywords || []).map((k) => String(k).toLowerCase()).filter(Boolean)
  if (!kws.length) return true
  const t = String(title || '').toLowerCase()
  for (const k of kws) {
    if (t.includes(k)) return true
  }
  return false
}

/** 综合新闻过滤（2026-08-19 owner 拍板）：标题用「；/;」分隔出多个主题（如"AI xx；比亚迪 xx；明星 xx"）
 *  时，任一主题段不命中 AI 关键词即视为「综合新闻（AI+B/C 混排）」→ 一律过滤，只留 AI 专题文章。
 *  仅对配置了 requireTitleKeywords 的源生效（避免误伤单主题长标题）。 */
function passPureAiFilter(title, requireKeywords) {
  const kws = (requireKeywords || []).map((k) => String(k).toLowerCase()).filter(Boolean)
  if (!kws.length) return true
  const t = String(title || '')
  const segs = t.split(/[；;]/).map((s) => s.trim()).filter(Boolean)
  if (segs.length <= 1) return true // 单主题 → 交给关键词/相关性把关
  for (const seg of segs) {
    const ls = seg.toLowerCase()
    const ok = kws.some((k) => ls.includes(k))
    if (!ok) return false
  }
  return true
}

// ───────────────────────────
// 去重 + 写 intel_ingest
// ───────────────────────────

/** 批量查已存在 guid（db.command.in 分批 ≤20）→ existMap */
async function queryExistingGuids(guids) {
  const exist = new Set()
  try {
    for (let i = 0; i < guids.length; i += 20) {
      const chunk = guids.slice(i, i + 20)
      const res = await db.collection(INTEL_INGEST).where({ guid: db.command.in(chunk) }).field({ guid: true }).limit(20).get()
      ;(res.data || []).forEach((d) => exist.add(d.guid))
    }
  } catch (e) {
    console.warn(`[worker] 查询已存在 guid 失败（降级为全量写入）:`, e.message)
  }
  return exist
}

/** 批量写 intel_ingest（每批 10 并行 add；已存在跳过） */
async function batchInsertIngest(items) {
  let written = 0
  const failed = []
  const BATCH = 10
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH)
    await Promise.all(batch.map(async (item) => {
      try {
        await db.collection(INTEL_INGEST).add({ data: item })
        written++
      } catch (e) {
        // 唯一索引冲突 = 重复（幂等安全）；其他错误计数
        if (String(e && (e.errMsg || e.message) || '').includes('duplicate')) {
          // guid 已存在，视为去重命中
        } else {
          failed.push(item.guid)
        }
      }
    }))
  }
  return { written, failed }
}

// ───────────────────────────
// 源状态更新（lastSuccessCursor 续传）+ 告警
// ───────────────────────────

async function updateSource(sourceId, patch) {
  try {
    await db.collection(INTEL_SOURCES).doc(sourceId).update({ data: patch })
  } catch (e) {
    console.warn(`[worker] 更新源 ${sourceId} 失败:`, e.message)
  }
}

/** 计算本批最新 publishedAt → 新的增量游标（ISO 字符串） */
function computeCursor(items, fallbackNow) {
  // fix(2026-08-19): rawItems 只有 pubDate（无 publishedAt），fresh 为空回退 rawItems 时
  // 旧逻辑读不到 publishedAt → 游标退化成抓取时刻，失去增量基线意义（openai_blog cursor 变 now）。
  // 改为同时读 publishedAt || pubDate，解析失败的条目跳过。
  let maxTs = 0
  for (const it of items) {
    const src = it.publishedAt || it.pubDate || ''
    const t = src ? new Date(src).getTime() : 0
    if (t && t > maxTs) maxTs = t
  }
  return maxTs ? new Date(maxTs).toISOString() : new Date(fallbackNow).toISOString()
}

/** 写健康度/告警记录到 intel_health（不依赖外部 webhook key，落库可查询） */
async function writeHealthRecord(rec) {
  try {
    await db.collection(INTEL_HEALTH).add({ data: Object.assign({ kind: 'alert', createdAt: Date.now() }, rec) })
  } catch (e) {
    console.warn('[worker] 写 intel_health 告警失败（非阻塞）:', e.message)
  }
}

// ───────────────────────────
// 每源 worker（仿 rssFetcher.runWorker）
// ───────────────────────────
async function runWorker(feed, now, ctx = {}) {
  const sourceId = feed._id || feed.key
  console.log(`[worker] 开始抓取源: ${sourceId} [${feed.sourceType}] baseUrl=${feed.baseUrl || feed.key}`)

  const summarize = (patch) => Object.assign({}, patch)
  const nowIso = new Date(now).toISOString()

  // 1. 抓取（单源超时兜底：Promise.race 掐超时，硬约束 #5）
  //    增量游标续传（§5.8 #3）：lastSuccessCursor → sinceMs，api 类源（HN/arXiv）
  //    按时间窗拉增量；rss/scrape 类只露最新 N 条，靠 guid 去重不硬过滤。
  const timeoutMs = (feed.adapterConfig && feed.adapterConfig.timeoutMs) || TIMEOUT_BY_TYPE[feed.sourceType] || 10000
  // owner 2026-08-20：无游标（首次/丢失）回看窗口 = 源 freshnessDays（低频官方源配 7 天能抓到周更内容；
  //   新闻源默认 1 天；24h 对周更源太紧会空抓）
  const fd = Number(feed.freshnessDays) > 0 ? Number(feed.freshnessDays) : 1
  const sinceMs = feed.lastSuccessCursor
    ? new Date(feed.lastSuccessCursor).getTime()
    : Date.now() - fd * 24 * 3600 * 1000
  let fetched
  try {
    fetched = await Promise.race([
      fetchSource(feed, Object.assign({}, ctx, { sinceMs })),
      new Promise((resolve) => setTimeout(() => resolve({ items: [], timedOut: true }), timeoutMs)),
    ])
  } catch (e) {
    console.warn(`[worker] ${sourceId} 抓取异常:`, e.message)
    await updateSource(sourceId, { lastFetchStatus: 'fetch_error', lastFetchedAt: nowIso })
    await writeHealthRecord({ sourceId, targetTime: ctx.targetTime || '', level: 'error', message: `抓取异常: ${e.message}` })
    return summarize({ sourceId, status: 'fetch_error', inserted: 0 })
  }

  if (fetched.timedOut) {
    console.warn(`[worker] ${sourceId} 超时（>${timeoutMs}ms），本轮跳过`)
    await updateSource(sourceId, { lastFetchStatus: 'timeout' })
    return summarize({ sourceId, status: 'timeout', inserted: 0 })
  }
  if (fetched.notModified) {
    await updateSource(sourceId, { lastFetchStatus: 'not_modified', lastFetchedAt: nowIso })
    return summarize({ sourceId, status: 'not_modified', inserted: 0 })
  }

  const rawItems = fetched.items || []
  if (rawItems.length === 0) {
    // 2026-08-19 复盘：区分「无新增」与「源本身空/解析失败」，便于告警归因
    console.warn(`[worker] ${sourceId} 解析后 0 条${fetched.timedOut ? '（超时）' : ''}（可能停更、无新增或解析规则待调，cursor=${sinceMs}）`)
    await updateSource(sourceId, { lastFetchStatus: 'empty' })
    return summarize({ sourceId, status: 'empty', inserted: 0 })
  }

  // 2. 过滤 + 校验 → 候选
  const meta = {
    sourceId,
    sourceName: feed.name || sourceId,
    layer: feed.layer || '',
    sourceType: feed.sourceType || '',
    targetTime: ctx.targetTime || '',
    freshnessDays: (Number(feed.freshnessDays) > 0 ? Number(feed.freshnessDays) : 1),
    minContent: (Number(feed.minContent) > 0 ? Number(feed.minContent) : 60),
  }
  const candidates = []
  let filtered = 0
  let invalid = 0
  // 2026-08-19 owner 拍板：严格「两批次间」窗口——只收 (上一批次 cursor, 当前时间] 发布的数据，
  // 无有效日期/超窗条目一律过滤（防历史全量/旧闻灌入；首次运行无 cursor 回看 24h 引导）
  const windowStart = sinceMs > 0 ? sinceMs : (Date.now() - 24 * 3600 * 1000)
  for (const raw of rawItems) {
    if (!passTitleFilter(raw.title, feed.blockTitleKeywords)) { filtered++; continue }
    if (!passRequireKeywords(raw.title, feed.requireTitleKeywords)) { filtered++; continue }
    if (!passCategoryFilter(raw, feed.blockCategoryKeywords)) { filtered++; continue }
    // 综合新闻过滤：标题多主题（；分隔）且任一段非 AI → 一律过滤（只留 AI 专题）
    if (!passPureAiFilter(raw.title, feed.requireTitleKeywords)) { filtered++; continue }
    // 严格窗口：pubDate 必须有效且落在 (windowStart, now]
    const t = raw.pubDate ? new Date(raw.pubDate).getTime() : NaN
    if (Number.isNaN(t) || t <= windowStart || t > Date.now()) { filtered++; continue }
    // 2026-08-19 复盘：剥离聚合源标题前缀（AINews]），避免噪音直达前端
    raw.title = cleanItemTitle(raw.title)
    const vRes = validateIntelItem({ title: raw.title, url: raw.url, pubDate: raw.pubDate, desc: raw.desc, content: raw.content, guid: raw.guid }, meta)
    if (!vRes.ok) { invalid++; continue }
    candidates.push(vRes.item)
  }

  // 3. guid 幂等去重（查已有 + 唯一索引兜底）
  const existingGuids = await queryExistingGuids(candidates.map((c) => c.guid))
  const fresh = candidates.filter((c) => !existingGuids.has(c.guid))

  // P0 优化：跨源同主题去重（同批 + 库内），只保留最完整版本，省重复 LLM
  const deduped = await crossSourceDedup(fresh)
  const duplicates = candidates.length - fresh.length

  // 4. 批量写 intel_ingest（P0：跨源去重后的 deduped）
  let written = 0
  if (deduped.length) {
    const wr = await batchInsertIngest(deduped)
    written = wr.written
    if (wr.failed.length) {
      console.warn(`[worker] ${sourceId} ${wr.failed.length} 条写入失败（幂等，下轮重试）`)
    }
  }

  // 5. 更新源状态：lastSuccessCursor 续传（§5.8 #3）+ 健康度
  const prevStreak = Number(feed.errorStreak) || 0
  const total = candidates.length
  // 2026-08-19 复盘：仅「完全无产出」（抓取空/解析失败/全无效）才计失败连击；
  // 条目被正常过滤（过旧/噪音/去重）不算失败——低频官方源（DeepSeek 月更）不会被误暂停
  const newStreak = (total === 0 && filtered === 0 && invalid === 0) ? prevStreak + 1 : 0
  const cursor = computeCursor(fresh.length ? fresh : rawItems, now)
  const patch = {
    lastFetchTime: nowIso,
    lastFetchedAt: nowIso,
    lastFetchStatus: 'ok',
    lastCount: total,
    insertedCount: written,
    duplicateCount: duplicates,
    errorStreak: newStreak,
    lastSuccessCursor: cursor,           // 增量游标：下次巡检续传起点
    lastModified: fetched.lastModified || feed.lastModified,
    etag: fetched.etag || feed.etag,
    // P2 优化：scrape 源页面哈希缓存（页面未变则下轮直接 notModified 跳过）
    lastPageHash: fetched.pageHash || feed.lastPageHash,
    health: { status: 'ok', consecutiveFails: 0, lastError: '', lastSuccessAt: nowIso },
  }
  await updateSource(sourceId, patch)

  // 6. 四类告警（写 intel_health）
  const alerts = []
  if (newStreak >= ERROR_STREAK_LIMIT) {
    await updateSource(sourceId, { status: 'disabled' })
    await writeHealthRecord({ sourceId, targetTime: ctx.targetTime || '', level: 'error', message: `连续 ${newStreak} 周期入库 0，已自动暂停，请检查源站` })
    alerts.push('disabled-empty')
  }
  if (total > 0 && duplicates / total > 0.5) {
    await writeHealthRecord({ sourceId, targetTime: ctx.targetTime || '', level: 'warn', message: `本轮重复率 ${(duplicates / total * 100).toFixed(0)}%（${duplicates}/${total}），疑似停更或 URL 漂移` })
    alerts.push('high-duplicate')
  }
  if (written >= MAX_BATCH_INSERT) {
    await writeHealthRecord({ sourceId, targetTime: ctx.targetTime || '', level: 'warn', message: `单轮入库 ${written} 条（≥${MAX_BATCH_INSERT}），请复核是否需要限流` })
    alerts.push('bulk-insert')
  }
  if (total > 0 && (filtered + invalid) / total > 0.5) {
    await writeHealthRecord({ sourceId, targetTime: ctx.targetTime || '', level: 'info', message: `过滤/校验拦截 ${filtered + invalid}/${total} 条（过滤词或字段不全），检查源口径` })
    alerts.push('high-filter')
  }

  console.log(`[worker] ${sourceId} 完成: total=${total} written=${written} duplicates=${duplicates} filtered=${filtered} invalid=${invalid} streak=${newStreak} cursor=${cursor.slice(0, 19)}`)
  return summarize({ sourceId, status: 'ok', parsed: total, written, duplicates, filtered, invalid, streak: newStreak, alerts })
}

// ───────────────────────────
// listEnabledFeeds（固定节点无条件抓取全部启用源）
// ───────────────────────────
// 注：按 owner 2026-08-19 拍板，定时档位一到就抓所有启用源；P2 优化（同日晚些）：
//     尊重 per-source pollSeconds——低频源（官方博客周更）未到间隔则跳过，省抓取请求。
async function listEnabledFeeds(nowMs) {
  let feeds = []
  try {
    const res = await db.collection(INTEL_SOURCES).limit(1000).get()
    feeds = res.data || []
  } catch (e) {
    return []
  }
  const due = []
  for (const f of feeds) {
    if (f.enabled !== true) continue
    if (f.status === 'disabled') continue
    // P2 低频源降频：最近一次抓取距现在 < pollSeconds（默认 6h）→ 跳过
    const pollMs = (Number(f.pollSeconds) || 21600) * 1000
    const last = f.lastFetchedAt ? new Date(f.lastFetchedAt).getTime() : 0
    if (last && nowMs - last < pollMs) continue
    due.push(f)
  }
  return due
}

// ───────────────────────────
// 云函数入口
// ───────────────────────────
exports.main = async (event = {}) => {
  // L1 全局开关：默认关闭，未启用情报抓取时直接跳过（仿 rssFetcher OFFICIAL_RSS_ENABLED）
  const globalEnabled = String(process.env.INTEL_RSS_POLL_ENABLED || 'false').toLowerCase() === 'true'
  if (!globalEnabled) {
    console.log('[intelRssPoll] INTEL_RSS_POLL_ENABLED=false，跳过本轮抓取')
    return { ok: true, skipped: 'global-disabled' }
  }

  // 自愈建表（幂等）
  try {
    await ensureSchema()
  } catch (e) {
    console.warn('[intelRssPoll] ensureSchema 异常（放行）:', e.message)
  }

  // 幂等播种 intel_sources（新接入源在此自动补齐）
  try {
    const seedRes = await seed()
    console.log(`[intelRssPoll] intel_sources 播种完成：新增 ${seedRes.inserted} 条，跳过 ${seedRes.skipped} 条`)
  } catch (e) {
    console.warn('[intelRssPoll] seed 异常（放行）:', e.message)
  }

  const now = Date.now()
  const ctx = { targetTime: event.targetTime || '' }

  // ── worker 模式：指定单源（被 intelFetch 分片委派）──
  if (event.sourceId) {
    let feed = null
    try {
      const res = await db.collection(INTEL_SOURCES).where({ _id: event.sourceId }).limit(1).get()
      feed = (res.data && res.data[0]) || null
    } catch (e) { feed = null }
    if (!feed) {
      console.warn(`[intelRssPoll] 源不存在或读取失败: ${event.sourceId}`)
      return { ok: false, sourceId: event.sourceId, status: 'source-not-found' }
    }
    const r = await runWorker(feed, now, ctx)
    return { ok: true, sourceId: event.sourceId, targetTime: ctx.targetTime, ...r }
  }

  // ── 编排模式（intelRssPoll 定时器 05:15/11:15/18:00 兜底触发，与 intelFetch 错峰）──
  // 注：owner 2026-08-19 拍板——固定节点无条件抓所有启用源，不看 lastFetchTime 间隔。
  console.log('[intelRssPoll] ========== 兜底巡检（固定节点，无条件抓取全部启用源）==========')
  const dueFeeds = await listEnabledFeeds(now)
  if (!dueFeeds.length) {
    console.log('[intelRssPoll] 无启用源，本轮结束')
    return { ok: true, scanned: 0 }
  }

  // 启用源过多时自我分片（防单实例串行超 60s）；≤3 源直接串行
  if (dueFeeds.length > MAX_SERIAL_SOURCES) {
    console.log(`[intelRssPoll] ${dueFeeds.length} 源超过串行上限，自我分片（fire-and-forget）`)
    for (const feed of dueFeeds) {
      const sourceId = feed._id || feed.key
      cloud.callFunction({
        name: 'intelRssPoll',
        data: { sourceId, targetTime: ctx.targetTime, shard: true },
      })
        .then((res) => {
          const r = res.result || {}
          console.log(`[intelRssPoll][${sourceId}] worker 完成: status=${r.status || r.skipped || 'ok'} inserted=${r.inserted || 0}`)
        })
        .catch((err) => {
          console.warn(`[intelRssPoll][${sourceId}] RPC 超时（实例仍在后台运行）: ${err.message}`)
        })
    }
    return { ok: true, scanned: dueFeeds.length, sharded: true }
  }

  // 串行执行（≤3 源，每源 5–15s，最坏 ~45s < 60s）
  const results = []
  for (const feed of dueFeeds) {
    results.push(await runWorker(feed, now, ctx))
  }
  return { ok: true, scanned: results.length, results }
}
