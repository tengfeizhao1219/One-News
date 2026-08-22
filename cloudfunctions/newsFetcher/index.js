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
const validator = require('./utils/fingerprint')
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
const TIAN_CATS = ['recommend', 'tech', 'science', 'international', 'life']

// owner 8/13：条目级栏目解析——IT之家等 RSS 条目自带 <category>（科学探索/科普…），
// 命中科学别名则归入「科学探索」tab（前端 id=science，显示名=科学探索），其余沿用 feed.category。
function isScienceAlias(c) {
  if (!c) return false
  const n = String(c).trim().toLowerCase()
  if (n.includes('科学') || n.includes('科普') || n.includes('探索')) return true
  return ['science', 'sci', 'sicprobe'].includes(n)
}
function resolveItemCategory(feedCategory, itemCategory) {
  // P1-7 修复：科学别名归入「科学探索」tab（前端 id=science），与 rssFetcher OFFICIAL_CATEGORY_MAP 口径一致
  if (isScienceAlias(itemCategory)) return 'science'
  return feedCategory || 'tech'
}

// P1-7 修复：官方源站分类 → 前端 tab 分类（与 rssFetcher/utils/newsStore.js OFFICIAL_CATEGORY_MAP 同源）。
// 此前 newsFetcher 路径缺此映射，官方 RSS 以 science/finance/culture 等落库，前端 5 tab 全部查不到。
const OFFICIAL_CATEGORY_MAP = {
  tech: 'tech', digital: 'tech', auto: 'tech', it: 'tech',
  science: 'science', sci: 'science', sports: 'science',
  life: 'life', edu: 'life', culture: 'life', health: 'life', book: 'life',
  house: 'life', society: 'life', finance: 'life', economy: 'life', money: 'life',
  world: 'international', international: 'international', global: 'international',
  recommend: 'recommend',
}
function mapOfficialCategory(srcCategory) {
  const c = String(srcCategory || '').trim().toLowerCase()
  if (isScienceAlias(c)) return 'science'
  return OFFICIAL_CATEGORY_MAP[c] || 'life'
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
    category: mapOfficialCategory(vItem.category || feed.category || 'tech'),
    categoryName: '',
    pubDate: vItem.pubDate || vItem.fetchedAt || new Date().toISOString(),
    publishTime: vItem.pubDate || vItem.fetchedAt || new Date().toISOString(),
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
    // 去重键统一用完整 urlFp（去掉 sourceType/category 前缀）：同源转载的同篇新闻
    // 在不同 source/category 下生成同一 id，batchInsert 按 id upsert 自动合并，根治跨源重复。
    // 此前 `${sourceType}_${category}_${urlFp.slice(0,16)}` 因前缀+截断导致同篇多 id → 重复落库。
    id: urlFp,
    category,
    categoryName: raw.categoryName || '',
    pubDate: String(raw.publishTime || new Date().toISOString()),
    publishTime: String(raw.publishTime || new Date().toISOString()),
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

// ── 静默时段（owner 2026-08-16）：凌晨 01:00-05:00 不抓取，省资源 ──
// BUG 修复（2026-08-19）：SCF 容器实际跑在 UTC（getHours() 返回 UTC 小时数），
// 之前注释「getHours() 即北京时间」与实际不符——北京 10:09 = UTC 02:09，
// 误判为 UTC 1-5 静默时段跳过抓取 → 白天大部分时段被误判。
// 现改用 Intl.DateTimeFormat 解析北京时间，保持「北京凌晨 1-5 静默」原语义。
const QUIET_START_HOUR = 1
const QUIET_END_HOUR = 5 // 左闭右开：北京 01:00 ≤ h < 北京 05:00
const { beijingHour } = require('./beijingTime')
function isQuietHours(now) {
  const h = beijingHour(now || new Date())
  return h >= QUIET_START_HOUR && h < QUIET_END_HOUR
}

// ── 编排器：枚举所有源 → 每个源独立任务并行扇出 ──
async function runOrchestrate() {
  // 静默时段：定时器/下拉刷新触发的抓取全部跳过（缓存保留上次数据，05:00 起恢复）
  if (isQuietHours()) {
    console.log(`[newsFetcher] 静默时段（${QUIET_START_HOUR}:00-${QUIET_END_HOUR}:00）跳过抓取`)
    return { ok: true, quiet: true, planned: 0, dispatched: 0, reason: 'quiet hours' }
  }
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

  // 接力说明：流水线由每个 fetch-source 落库后各自点燃（见 runFetchSource），
  // 避免 orchestrate 末尾单次触发时 news_raw 尚未写满而空跑；selfHealScheduler(5min) 仍作终极兜底。
  return { ok: true, planned: plan.length, dispatched: plan.length }
}

// ── 单源抓取任务：归一写 news_raw ──
async function runFetchSource(source) {
  try { await ensureSchema() } catch (e) { /* 放行 */ }
  const { kind } = source
  let result
  try {
    if (kind === 'rss') result = await fetchOfficialRss(source.feed)
    else if (kind === 'juhe') result = await fetchAggregate('juhe', source.category)
    else if (kind === 'tian') result = await fetchAggregate('tian', source.category)
    else result = { ok: false, reason: `unknown source kind: ${kind}` }
  } catch (e) {
    console.error('[newsFetcher] fetch-source 异常:', e.message, e.stack)
    result = { ok: false, error: e.message }
  }
  // 接力：本源写完 news_raw 后点燃流水线——但做 60s 节流（复用 newsPipeline 的
  // pipeline_trigger_lock 锁），22 个源并发时最多每分钟触发 1 次，避免并发扇出引发调用风暴。
  if (result && result.ok && result.written > 0) {
    try { await throttledTriggerPipeline() } catch (e) { /* 忽略 */ }
  }
  return result
}

// 节流触发流水线：60s 内只放行一次（system_kv 原子占位），与 newsPipeline 自调度共用同一把锁
async function throttledTriggerPipeline() {
  const now = Date.now()
  const kv = cloud.database().collection('system_kv')
  const key = 'pipeline_trigger_lock'
  try {
    const d = await kv.doc(key).get()
    const last = (d && d.data && d.data.ts) || 0
    if (last && (now - Number(last)) < 60 * 1000) return // 冷却中，跳过本次触发
  } catch (e) { /* 锁不存在 → 放行 */ }
  try {
    await kv.doc(key).set({ data: { ts: now } })
  } catch (e) {
    try { await kv.add({ data: { _id: key, ts: now } }) } catch (e2) { /* 忽略 */ }
  }
  await cloud.callFunction({ name: 'newsPipeline', data: { action: 'run' } }).catch(() => {})
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
    // 2026-08-22 修复：失败也更新 lastFetchTime + errorStreak——
    // ① lastFetchTime 按 pollSeconds 冷却，避免失败源每轮重试（浪费调用）；
    // ② errorStreak 累计，连续失败可触发 R1 自动暂停/恢复机制。
    const prevStreak = Number(feed.errorStreak) || 0
    const newStreak = prevStreak + 1
    const patch = { lastFetchTime: new Date().toISOString(), lastFetchStatus: 'fetch_error', errorStreak: newStreak }
    if (newStreak >= 3) patch.status = 'disabled'
    await feedStore.updateFeed(sourceId, patch)
    if (newStreak >= 3) {
      console.warn(`[newsFetcher][rss] ${sourceId} 连续 ${newStreak} 次抓取失败，已自动暂停（R1 冷却后恢复探测）`)
    }
    return { ok: true, sourceId, status: 'fetch_error', written: 0 }
  }

  // 2. 解析
  let parsed
  try {
    parsed = rssParser.parse(fetchRes.text)
  } catch (e) {
    // 2026-08-22：同 fetch_error，更新 lastFetchTime 冷却 + errorStreak 累计（防每轮重试）
    const prevStreak = Number(feed.errorStreak) || 0
    const newStreak = prevStreak + 1
    const patch = { lastFetchTime: new Date().toISOString(), lastFetchStatus: 'parse_error', errorStreak: newStreak }
    if (newStreak >= 3) patch.status = 'disabled'
    await feedStore.updateFeed(sourceId, patch)
    if (newStreak >= 3) {
      console.warn(`[newsFetcher][rss] ${sourceId} 连续 ${newStreak} 次解析失败，已自动暂停（R1 冷却后恢复探测）`)
    }
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

  // 6. 连续空周期告警（记录 disabledAt：自动恢复机制依赖它做冷却期判定）
  if (newStreak >= 3) {
    await feedStore.updateFeed(sourceId, { status: 'disabled', disabledAt: new Date().toISOString() })
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
