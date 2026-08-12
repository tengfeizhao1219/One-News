/**
 * rssFetcher — 官方 RSS 源直连 · 抓取云函数（#35 / FS）
 * ============================================================
 * 对齐 FS 实施方案 §5 主流程：
 *   trigger → main 编排器 → 查到点源 → 每源 worker 抓取/过滤/校验/去重/落库/更新/告警
 *
 * 双层开关（§4）：
 *   L1 全局  云环境变量 OFFICIAL_RSS_ENABLED（默认 false，=false 整体不抓取）
 *   L2 单源  feed_meta.enabled（灰度，逐源启停）
 *
 * 频率（§4）：config.json 用 1 个小时级 trigger + 编排器按 feed_meta.pollSeconds
 *   判断每源是否到点，避免 4 个 trigger 拉高配额。
 *
 * 版权红线：只存 title/url/summary，不存正文全文。
 * ============================================================
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const apiFetch = require('./utils/apiFetch')
const rssParser = require('./utils/rssParser')
const filter = require('./utils/filter')
const validator = require('./utils/validator')
const newsStore = require('./utils/newsStore')
const feedStore = require('./utils/feedStore')
const { ensureSchema } = require('./utils/initSchema')
const { sendAlert } = require('./utils/notify')

// 空周期确认阈值（连续 N 次入库=0 → error/告警暂停）
const ERROR_STREAK_LIMIT = 3
// 大批量告警阈值
const MAX_BATCH_INSERT = 200

// ── 云函数入口 ──
exports.main = async (event = {}) => {
  // L1 全局开关：默认关闭，未开启官方 RSS 抓取时直接跳过
  const globalEnabled = String(process.env.OFFICIAL_RSS_ENABLED || 'false').toLowerCase() === 'true'
  if (!globalEnabled) {
    console.log('[rssFetcher] OFFICIAL_RSS_ENABLED=false，跳过本轮抓取')
    return { ok: true, skipped: 'global-disabled' }
  }

  // 自愈建表（幂等）
  try {
    await ensureSchema()
  } catch (e) {
    console.warn('[rssFetcher] ensureSchema 异常（放行，后续操作容错）:', e.message)
  }

  const now = Date.now()
  const dueFeeds = await feedStore.listDueFeeds(now)
  if (!dueFeeds.length) {
    console.log('[rssFetcher] 无到点源，本轮结束')
    return { ok: true, scanned: 0 }
  }

  const results = []
  for (const feed of dueFeeds) {
    const r = await runWorker(feed, now)
    results.push(r)
  }

  return { ok: true, scanned: results.length, results }
}

// ── 每源 worker ──
async function runWorker(feed, now) {
  const sourceId = feed._id || feed.sourceId || feed.name
  console.log(`[worker] 开始抓取源: ${sourceId} baseUrl=${feed.baseUrl}`)

  const summarize = (patch) => Object.assign({}, patch) // 统一返回结构

  // 1. 抓取（带上次缓存头，304 语义）
  let fetchRes
  try {
    fetchRes = await apiFetch.get(feed.baseUrl, {
      prev: { lastModified: feed.lastModified, etag: feed.etag },
    })
  } catch (e) {
    fetchRes = { ok: false, notModified: false, text: null, status: 0 }
  }

  // 304 → 内容未变，更新 lastFetchTime 即可
  if (fetchRes.notModified || fetchRes.status === 304) {
    await feedStore.updateFeed(sourceId, { lastFetchTime: new Date(now).toISOString(), lastFetchStatus: 'not_modified' })
    console.log(`[worker] ${sourceId} 304 未变化，本轮跳过`)
    return summarize({ sourceId, status: 'not_modified', inserts: 0 })
  }

  if (!fetchRes.ok) {
    await feedStore.updateFeed(sourceId, { lastFetchStatus: 'fetch_error' })
    console.warn(`[worker] ${sourceId} 抓取失败 status=${fetchRes.status}`)
    // 网络失败不累计 errorStreak（不算「空周期」，可能临时抖动）
    return summarize({ sourceId, status: 'fetch_error', inserts: 0 })
  }

  // 2. 解析
  let parsed
  try {
    parsed = rssParser.parse(fetchRes.text)
  } catch (e) {
    await feedStore.updateFeed(sourceId, { lastFetchStatus: 'parse_error' })
    console.warn(`[worker] ${sourceId} 解析失败:`, e.message)
    return summarize({ sourceId, status: 'parse_error', inserts: 0 })
  }

  // 3~4. 过滤 + 校验（栏目白名单 + 标题过滤 + 6 字段校验）
  const meta = { sourceId, sourceName: feed.sourceName || feed.name, category: feed.category || 'tech' }
  const candidates = []
  let filtered = 0
  let invalid = 0
  for (const raw of parsed.items) {
    // 栏目用 feed_meta 显式指定（不依赖 RSS item 自带 category，避免中文无法匹配）
    const fCheck = filter.check({ category: feed.category, title: raw.title }, {
      allowCategories: feed.allowCategories,
      blockTitleKeywords: feed.blockTitleKeywords,
    })
    if (!fCheck.pass) { filtered++; continue }
    const vRes = validator.validate(
      { title: raw.title, url: raw.url, pubDate: raw.pubDate, summary: raw.desc, content: raw.content },
      meta,
    )
    if (!vRes.ok) { invalid++; continue }
    candidates.push(vRes.item)
  }

  // 5. 去重（urlFp/titleFp）
  const { inserts, duplicates, dupSamples } = await newsStore.filterDuplicates(candidates)

  // 6. 批量写库（含质量门：未过门不落库）
  // v1.2 路线1 双写：
  //   a) news_raw_official —— 归档双写（保留，仅 title/url/summary，无 content）
  //   b) news_ingest —— 统一 staging（sourceType=official_rss，status=pending，含 content 供 AI 加工），
  //      由 refreshNews 消费 → qualityGate → AI 摘要 → 汇入 news_cache 主列表
  let written = 0
  let qualityRejected = 0
  const qualityRejectedSamples = []
  let ingestWritten = 0
  if (inserts.length) {
    const wr = await newsStore.batchInsert(inserts)
    written = wr.written
    if (wr.rejectedCount) {
      qualityRejected = wr.rejectedCount
      qualityRejectedSamples.push(...(wr.rejected || []).slice(0, 3))
    }
    // 双写 news_ingest（失败不阻断主流程，归档仍完成）
    try {
      const ig = await newsStore.batchInsertToIngest(inserts)
      ingestWritten = ig.written || 0
    } catch (ingestErr) {
      console.warn(`[worker] ${sourceId} news_ingest 双写失败（归档不受影响）:`, ingestErr.message)
    }
  }

  // 7. 更新 feed_meta（统计 + 缓存头 + errorStreak）
  const prevStreak = Number(feed.errorStreak) || 0
  const total = candidates.length
  let newStreak = prevStreak
  if (total === 0) {
    newStreak = prevStreak + 1          // 空周期累计
  } else {
    newStreak = 0                       // 有入库 → 清零
  }
  await feedStore.updateFeed(sourceId, {
    lastFetchTime: new Date(now).toISOString(),
    lastFetchStatus: 'ok',
    lastCount: total,
    insertedCount: written,
    duplicateCount: duplicates,
    gateRejectedCount: qualityRejected,
    errorStreak: newStreak,
    lastModified: fetchRes.lastModified || feed.lastModified,
    etag: fetchRes.etag || feed.etag,
  })

  // 8. 告警判定
  const alerts = []

  // 8a. 连续空周期 → error/disable + 告警
  if (newStreak >= ERROR_STREAK_LIMIT) {
    await feedStore.updateFeed(sourceId, { status: 'disabled' })
    console.warn(`[worker] ${sourceId} 连续 ${newStreak} 周期入库=0，暂停`)
    await sendAlert(`源 **${sourceId}** 连续 ${newStreak} 周期入库 0，已自动暂停。请检查源站是否停更或 feed 地址失效。`, { dedupKey: `rss-empty-${sourceId}` })
    alerts.push('disabled-empty')
  }

  // 8b. 重复率 >50% → 告警（检查是否停更）
  if (total > 0 && duplicates / total > 0.5) {
    await sendAlert(`源 **${sourceId}** 本轮重复率 ${(duplicates / total * 100).toFixed(0)}%（${duplicates}/${total}），疑似停更或 URL 漂移。样本：${(dupSamples || []).join('；').slice(0, 120)}`, { dedupKey: `rss-dup-${sourceId}` })
    alerts.push('high-duplicate')
  }

  // 8c. 入库量异常偏高 → 监控
  if (written >= MAX_BATCH_INSERT) {
    await sendAlert(`源 **${sourceId}** 单轮入库 ${written} 条（≥${MAX_BATCH_INSERT}），请复核是否需要限流。`, { dedupKey: `rss-batch-${sourceId}` })
    alerts.push('bulk-insert')
  }

  // 8d. 质量门拦截率过高（>30% 或 >50 条）→ 告警，疑似源站异常/口径误伤
  const gatedTotal = qualityRejected
  if (gatedTotal > 0 && (gatedTotal / Math.max(1, total) > 0.3 || gatedTotal >= 50)) {
    await sendAlert(`源 **${sourceId}** 本轮质量门拦截 ${gatedTotal}/${total} 条（${
      (gatedTotal / Math.max(1, total) * 100).toFixed(0)
    }%）。样条：${qualityRejectedSamples.join('；').slice(0, 120) || '无'}`, { dedupKey: `rss-gate-${sourceId}` })
    alerts.push('high-quality-reject')
  }

  console.log(`[worker] ${sourceId} 完成: total=${total} written=${written} ingest=${ingestWritten} duplicates=${duplicates} filtered=${filtered} invalid=${invalid} gateRejected=${qualityRejected} streak=${newStreak}`)
  return summarize({ sourceId, status: 'ok', parsed: total, written, ingestWritten, duplicates, filtered, invalid, gateRejected: qualityRejected, streak: newStreak, alerts })
}
