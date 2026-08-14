/**
 * newsRawStore.js — news_raw 落库（Stage 0 抓取输出，Stage 1 消费输入）
 * ============================================================
 * 取代旧 news_raw_official + news_ingest：所有源（官方 RSS / juhe / tianxing）
 * 归一后写入 news_raw(status=pending)。urlFp/titleFp 全局去重（跨源同文只留一条）。
 * 6h TTL 兜底消费失败残留（正常路径由 Stage 1 消费后置 consumed/删除）。
 *
 * 设计依据：docs/architecture-pipeline-redesign.md §2 / §5.2
 */
const cloud = require('wx-server-sdk')
const { sha256, normalizeUrl } = require('./validator')

const TTL_MS = 6 * 60 * 60 * 1000

function col() {
  return cloud.database().collection('news_raw')
}

/**
 * 批量写入归一化原始条目（幂等去重）。
 * @param {Array<Object>} items - 已含 urlFp/titleFp 的归一 doc（业务字段齐）
 * @returns {Promise<{written:number, duplicates:number, failed:number}>}
 */
async function writeRaw(items) {
  if (!items || !items.length) return { written: 0, duplicates: 0, failed: 0 }
  let written = 0
  let duplicates = 0
  let failed = 0

  const B = 50
  for (let i = 0; i < items.length; i += B) {
    const batch = items.slice(i, i + B)
    const urlFps = batch.map((it) => it.urlFp)
    const titleFps = batch.map((it) => it.titleFp)

    let existing = []
    try {
      const res = await col()
        .where({ urlFp: cloud.database().command.in(urlFps) })
        .field({ urlFp: true, titleFp: true })
        .limit(B)
        .get()
      existing = res.data || []
    } catch (e) {
      existing = [] // 集合不存在等 → 交由 createCollection 自愈，本批按无重复写
    }

    const exUrls = new Set(existing.map((r) => r.urlFp))
    const exTitles = new Set(existing.map((r) => r.titleFp))

    for (const it of batch) {
      if (!it || !it.urlFp) { failed++; continue }
      if (exUrls.has(it.urlFp) || exTitles.has(it.titleFp)) {
        duplicates++
        continue
      }
      const doc = Object.assign({}, it, {
        _id: `raw_${it.urlFp}`,
        status: 'pending', // pending → (Stage1 消费) consumed
        fetchedAt: new Date().toISOString(),
        expireAt: new Date(Date.now() + TTL_MS).toISOString(),
      })
      try {
        await col().add({ data: doc })
        written++
      } catch (e) {
        const msg = (((e && (e.errMsg || e.message)) || '')).toString()
        if (msg.includes('duplicate') || msg.includes('already') || msg.includes('11000') || msg.includes('-502001')) {
          written++ // 并发下另一实例已写入，视为已存在
        } else {
          failed++
          console.warn('[newsRawStore] 写入失败:', e.message)
        }
      }
    }
  }
  return { written, duplicates, failed }
}

/**
 * 标记单条为 consumed（Stage 1 成功处理后调用）。
 */
async function markConsumed(urlFp) {
  if (!urlFp) return
  try {
    await col().doc(`raw_${urlFp}`).update({ data: { status: 'consumed', consumedAt: new Date().toISOString() } })
  } catch (e) { /* 忽略 */ }
}

/**
 * 消费即删（自愈模式 + 防堆积）：处理成功后直接移除 raw 条目，
 * 避免 consumed 残留导致 pullPending 反复拉取同一批。
 */
async function removeRaw(urlFp) {
  if (!urlFp) return
  try {
    await col().doc(`raw_${urlFp}`).remove()
  } catch (e) { /* 忽略 */ }
}

/**
 * 拉取待处理批次（Stage 1 消费用）。带游标续跑。
 * @param {Object} [opts] - { limit, cursorSkip }
 */
async function pullPending(opts = {}) {
  const limit = opts.limit || 50
  const skip = opts.cursorSkip || 0
  try {
    const res = await col()
      .where({ status: 'pending' })
      .orderBy('fetchedAt', 'asc')
      .skip(skip)
      .limit(limit)
      .get()
    const data = res.data || []
    return { items: data, hasMore: data.length === limit, nextSkip: skip + data.length }
  } catch (e) {
    return { items: [], hasMore: false, nextSkip: skip }
  }
}

module.exports = { writeRaw, markConsumed, pullPending, removeRaw }
