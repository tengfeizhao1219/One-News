/**
 * newsFetcher — Stage 0 统一抓取云函数（owner 8/13 架构重构）
 * ============================================================
 * 取代旧 rssFetcher：所有源（官方 RSS + juhe + tianxing）统一归一写 news_raw(pending)。
 *
 * 每个源 = 独立任务，编排器并行扇出（cloud.callFunction 自调，互不等待，
 * 复刻 refreshNews v8 DG-12 的 fire-and-forget 模式，避免 60s 墙）。
 * 单源内分批写库；若单源条目过多，fetch-source 内部续跑（hasMore）兜底。
 *
 * 入口（event.action）：
 *   'orchestrate' | 缺省  → 枚举所有源，扇出 fetch-source 任务后快速返回
 *   'fetch-source'        → 抓取单个源（event.source），归一写 news_raw
 *
 * 合规红线：官方 RSS 不缓存正文全文 → news_raw.content 留空，由 Stage 1 按需现抓。
 * 设计依据：docs/architecture-pipeline-redesign.md §1/§2/§3
 * ============================================================
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const apiFetch = require('./utils/apiFetch')
const rssParser = require('./utils/rssParser')
const filter = require('./utils/filter')
const validator = require('./utils/validator')
const feedStore = require('./utils/feedStore')
const newsRawStore = require('./utils/newsRawStore')
const { ensureSchema } = require('./utils/initSchema')
const { sendAlert } = require('./utils/notify')
const { fetchAllCategories: fetchAllJuhe } = require('./sources/juhe')
const { fetchAllCategories: fetchAllTian } = require('./sources/tianxing')
const config = require('./config')

// 官方 RSS 全局开关（红线：默认关，需明确开启）
const RSS_GLOBAL_ENABLED = String(process.env.OFFICIAL_RSS_ENABLED || 'false').toLowerCase() === 'true'

// 单源每类抓取条数
const PER_SOURCE_NUM = Math.max(5, Math.min(50, Number(process.env.FETCH_NUM || 15)))

// 聚合源分类（与 sources/*.js 的映射对齐；只取适配器已实现的分类）
const JUHE_CATS = ['recommend', 'tech', 'international', 'life']
const TIAN_CATS = ['recommend', 'tech', 'sports', 'international', 'life']

// owner 8/13：条目级栏目解析——IT之家等 RSS 条目自带 <category>（科学探索/科普…），
// 命中科学别名则归入「科学探索」tab（前端 id=sports，显示名=科学探索），其余沿用 feed.category。
function isScienceAlias(c) {
  if (!c) return false
  const n = String(c).trim().toLowerCase()
  if (n.includes('科学') || n.includes('科普') || n.includes('探索')) return true
  return ['science', 'sci', 'sicprobe'].includes(n)
}
function resolveItemCategory(feedCategory, itemCategory) {
  if (isScienceAlias(itemCategory)) return 'science'
  return feedCategory || 'tech'
}

// 规范化「官方 RSS 校验后的候选」→ news_raw doc（content 留空，红线：不缓存正文）
function normalizeOfficialItem(vItem, feed) {
  return {
    urlFp: vItem.urlFp,
    titleFp: vItem.titleFp,
    title: vItem.title,
    url: vItem.url,
    sourceUrl: vItem.url,
    summary: vItem.summary || '',
    content: '',
    sourceType: 'official_rss',
    sourceId: feed._id || feed.sourceId || feed.name,
    sourceName: feed.sourceName || feed.name || '',
    source: feed.sourceName || feed.name || '',
    id: `official_${vItem.urlFp}`,
    category: vItem.category || feed.category || 'tech',
    categoryName: '',
    pubDate: vItem.pubDate || vItem.fetchedAt || new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
  }
}

// 规范化「juhe/tian 格式化条目」→ news_raw doc；无 URL 则丢弃（无法去重/抓取）
function normalizeAggregateItem(raw, sourceType, category) {
  const url = String(raw.sourceUrl || '').trim()
  if (!url || !/^https?:\/\//i.test(url)) return null
  const title = validator.cleanTitle(raw.title || '')
  if (title.length < 4) return null
  const { sha256, normalizeUrl } = validator
  const urlFp = sha256(normalizeUrl(url))
  const titleFp = sha256(title)
  return {
    urlFp,
    titleFp,
    title,
    url,
    sourceUrl: url,
    summary: String(raw.summary || raw.title || ''),
    content: '',
    sourceType,
    sourceId: `${sourceType}_${category}`,
    sourceName: raw.source || (sourceType === 'juhe' ? '聚合数据' : '天行数据'),
    source: raw.source || (sourceType === 'juhe' ? '聚合数据' : '天行数据'),
    id: `${sourceType}_${category}_${urlFp.slice(0, 16)}`,
    category,
    categoryName: raw.categoryName || '',
    pubDate: String(raw.publishTime || new Date().toISOString()),
    fetchedAt: new Date().toISOString(),
  }
}

// 批内去重（urlFp/titleFp）
function dedupeInBatch(docs) {
  const seen = new Set()
  const out = []
  for (const d of docs) {
    if (!d || !d.urlFp) continue
    if (seen.has(d.urlFp) || seen.has(d.titleFp)) continue
    seen.add(d.urlFp)
    seen.add(d.titleFp)
    out.push(d)
  }
  return out
}

// ── 云函数入口 ──
exports.main = async (event = {}) => {
  const action = event.action || 'orchestrate'
  if (action === 'fetch-source') {
    return await runFetchSource(event.source || {})
  }
  return await runOrchestrate()
}

// ── 编排器：枚举所有源 → 每个源独立任务并行扇出 ──
async function runOrchestrate() {
  // 自愈建表
  try { await ensureSchema() } catch (e) {
    console.warn('[newsFetcher] ensureSchema 异常（放行）:', e.message)
  }
  // 启动自检：幂等播种 feed_meta（官方 RSS 源注册）
  try {
    const { seed } = require('./utils/seedFeeds')
    await seed()
  } catch (e) {
    console.warn('[newsFetcher] seed 异常（放行）:', e.message)
  }

  const plan = []

  // 1. 官方 RSS 到点源
  if (RSS_GLOBAL_ENABLED) {
    const now = Date.now()
    const due = await feedStore.listDueFeeds(now)
    for (const feed of due) plan.push({ kind: 'rss', feed })
  } else {
    console.log('[newsFetcher] OFFICIAL_RSS_ENABLED=false，跳过官方 RSS')
  }

  // 2. juhe 各类（key 存在才加）
  if (config.juhe.apiKey) {
    for (const cat of JUHE_CATS) plan.push({ kind: 'juhe', category: cat })
  } else {
    console.log('[newsFetcher] JUHE_API_KEY 未配置，跳过 juhe')
  }

  // 3. tianxing 各类
  if (config.tian.apiKey) {
    for (const cat of TIAN_CATS) plan.push({ kind: 'tian', category: cat })
  } else {
    console.log('[newsFetcher] TIAN_API_KEY 未配置，跳过 tianxing')
  }

  // 扇出：每个源独立云函数任务（fire-and-forget，互不等待，避免 60s 墙）
  // 复刻 refreshNews v8 DG-12：父函数立即返回「已触发」，子实例各自独立跑满预算。
  console.log(`[newsFetcher] 异步触发 ${plan.length} 个源任务（各自独立预算，后台执行）...`)
  plan.forEach((source) => {
    cloud.callFunction({
      name: 'newsFetcher',
      data: { action: 'fetch-source', source },
    })
  })

  // 接力：抓取写库后立即点燃流水线（Stage 1/2/3），缩短端到端时延；
  // 若本轮 callFunction 失败/延迟，仍有 selfHealScheduler(5min) 定时器兜底重跑 run()（幂等）。
  try {
    cloud.callFunction({ name: 'newsPipeline', data: { action: 'run' } }).catch(() => {})
  } catch (e) { /* 忽略 */ }

  return { ok: true, planned: plan.length, dispatched: plan.length }
}

// ── 单源抓取任务：归一写 news_raw ──
async function runFetchSource(source) {
  try { await ensureSchema() } catch (e) { /* 放行 */ }
  const { kind } = source
  try {
    if (kind === 'rss') return await fetchOfficialRss(source.feed)
    if (kind === 'juhe') return await fetchAggregate('juhe', source.category)
    if (kind === 'tian') return await fetchAggregate('tian', source.category)
    return { ok: false, reason: `unknown source kind: ${kind}` }
  } catch (e) {
    console.error('[newsFetcher] fetch-source 异常:', e.message, e.stack)
    return { ok: false, error: e.message }
  }
}

// 官方 RSS 单源抓取
async function fetchOfficialRss(feed) {
  const sourceId = feed._id || feed.sourceId || feed.name
  console.log(`[newsFetcher][rss] 抓取源: ${sourceId}`)

  // 1. 抓取（带上次缓存头，304 语义）
  let fetchRes
  try {
    fetchRes = await apiFetch.get(feed.baseUrl, {
      prev: { lastModified: feed.lastModified, etag: feed.etag },
    })
  } catch (e) {
    fetchRes = { ok: false, notModified: false, text: null, status: 0 }
  }

  if (fetchRes.notModified || fetchRes.status === 304) {
    await feedStore.updateFeed(sourceId, { lastFetchTime: new Date().toISOString(), lastFetchStatus: 'not_modified' })
    console.log(`[newsFetcher][rss] ${sourceId} 304 未变化，跳过`)
    return { ok: true, sourceId, status: 'not_modified', written: 0 }
  }
  if (!fetchRes.ok) {
    await feedStore.updateFeed(sourceId, { lastFetchStatus: 'fetch_error' })
    console.warn(`[newsFetcher][rss] ${sourceId} 抓取失败 status=${fetchRes.status}`)
    return { ok: true, sourceId, status: 'fetch_error', written: 0 }
  }

  // 2. 解析
  let parsed
  try {
    parsed = rssParser.parse(fetchRes.text)
  } catch (e) {
    await feedStore.updateFeed(sourceId, { lastFetchStatus: 'parse_error' })
    console.warn(`[newsFetcher][rss] ${sourceId} 解析失败:`, e.message)
    return { ok: true, sourceId, status: 'parse_error', written: 0 }
  }

  // 3. 过滤 + 校验 + 规范化
  const candidates = []
  let filtered = 0
  let invalid = 0
  for (const raw of parsed.items) {
    const effCat = resolveItemCategory(feed.category || 'tech', raw.category)
    const fCheck = filter.check(
      { category: effCat, title: raw.title },
      { allowCategories: feed.allowCategories, blockTitleKeywords: feed.blockTitleKeywords },
    )
    if (!fCheck.pass) { filtered++; continue }
    const vRes = validator.validate(
      { title: raw.title, url: raw.url, pubDate: raw.pubDate, summary: raw.desc, content: raw.content },
      { sourceId, sourceName: feed.sourceName || feed.name, category: effCat },
    )
    if (!vRes.ok) { invalid++; continue }
    candidates.push(normalizeOfficialItem(vRes.item, feed))
  }

  const uniq = dedupeInBatch(candidates)

  // 4. 写 news_raw
  const wr = await newsRawStore.writeRaw(uniq)

  // 5. 更新 feed_meta
  const prevStreak = Number(feed.errorStreak) || 0
  const newStreak = candidates.length === 0 ? prevStreak + 1 : 0
  await feedStore.updateFeed(sourceId, {
    lastFetchTime: new Date().toISOString(),
    lastFetchStatus: 'ok',
    lastCount: candidates.length,
    insertedCount: wr.written,
    duplicateCount: wr.duplicates,
    errorStreak: newStreak,
    lastModified: fetchRes.lastModified || feed.lastModified,
    etag: fetchRes.etag || feed.etag,
  })

  // 6. 连续空周期告警
  if (newStreak >= 3) {
    await feedStore.updateFeed(sourceId, { status: 'disabled' })
    await sendAlert(`源 **${sourceId}** 连续 ${newStreak} 周期入库 0，已自动暂停。`, { dedupKey: `rss-empty-${sourceId}` })
  }

  console.log(`[newsFetcher][rss] ${sourceId} 完成: total=${candidates.length} written=${wr.written} duplicates=${wr.duplicates} filtered=${filtered} invalid=${invalid}`)
  return { ok: true, sourceId, status: 'ok', written: wr.written, duplicates: wr.duplicates }
}

// 聚合源（juhe/tianxing）单类抓取
async function fetchAggregate(kind, category) {
  console.log(`[newsFetcher][${kind}] 抓取分类: ${category}`)
  let rawList = []
  try {
    if (kind === 'juhe') {
      const r = await fetchAllJuhe([category], PER_SOURCE_NUM)
      rawList = (r && r.news) || []
    } else {
      const r = await fetchAllTian([category], PER_SOURCE_NUM)
      rawList = (r && r.news) || []
    }
  } catch (e) {
    console.warn(`[newsFetcher][${kind}] ${category} 抓取失败:`, e.message)
    return { ok: false, kind, category, error: e.message }
  }

  const docs = []
  for (const raw of rawList) {
    const d = normalizeAggregateItem(raw, kind, category)
    if (d) docs.push(d)
  }
  const uniq = dedupeInBatch(docs)
  const wr = await newsRawStore.writeRaw(uniq)

  console.log(`[newsFetcher][${kind}] ${category} 完成: raw=${rawList.length} written=${wr.written} duplicates=${wr.duplicates}`)
  return { ok: true, kind, category, written: wr.written, duplicates: wr.duplicates }
}
