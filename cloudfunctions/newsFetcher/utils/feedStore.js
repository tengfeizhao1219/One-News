/**
 * feedStore.js — feed_meta 源配置/状态读写
 * ============================================================
 * 对齐方案 §3/§4：每源独立频率(pollSeconds)、灰度启用(enabled)、
 * 连续空周期计数(errorStreak)、缓存头(304 语义)、上次抓取统计。
 * 只负责 feed_meta 的增删改查，不接触新闻数据。
 * ============================================================
 */

const cloud = require('wx-server-sdk')

function col() {
  return cloud.database().collection('feed_meta')
}

/**
 * 取所有源配置（可能为空集合 → 返回 []）。
 */
async function listFeeds() {
  try {
    const res = await col().limit(1000).get()
    return res.data || []
  } catch (e) {
    // 集合不存在时视为空，交由 ensureSchema 自愈
    return []
  }
}

/**
 * 取单个源配置；不存在返回 null。
 * @param {string} sourceId
 */
async function getFeed(sourceId) {
  if (!sourceId) return null
  try {
    const res = await col().where({ _id: sourceId }).limit(1).get()
    return (res.data && res.data[0]) || null
  } catch (e) {
    return null
  }
}

/**
 * 需抓取的源清单：enabled=true 且（从未抓过 或 now - lastFetchTime >= pollSeconds）。
 * @param {number} nowMs
 */
async function listDueFeeds(nowMs) {
  const feeds = await listFeeds()
  const due = []
  for (const f of feeds) {
    if (f.enabled !== true) continue               // 灰度未开
    if (f.status === 'disabled') continue          // 告警暂停
    const poll = Number(f.pollSeconds) || 3600
    const last = f.lastFetchTime ? new Date(f.lastFetchTime).getTime() : 0
    if (!last || (nowMs - last) >= poll * 1000) {
      due.push(f)
    }
  }
  return due
}

/**
 * 批量写 feed_meta 配置（幂等 upsert）。用于初始化源清单或 PM 手动调整。
 * @param {Array<Object>} feeds sourceId 为主键，enabled 默认 false（灰度关）
 */
async function upsertFeeds(feeds) {
  if (!feeds || !feeds.length) return
  for (const f of feeds) {
    const srcId = f._id || f.sourceId
    if (!srcId) continue
    const doc = Object.assign({}, f)
    if (doc.sourceId && !doc._id) doc._id = srcId
    delete doc.sourceId
    if (doc.enabled == null) doc.enabled = false
    if (doc.pollSeconds == null) doc.pollSeconds = 3600
    if (doc.errorStreak == null) doc.errorStreak = 0
    if (doc.status == null) doc.status = 'active'
    try {
      await col().doc(srcId).set({ data: doc })
    } catch (e) {
      try {
        await col().add({ data: Object.assign({ _id: srcId }, doc) })
      } catch (e2) {
        /* 并发下 set 失败可忽略 */
      }
    }
  }
}

/**
 * 更新单源抓取后的统计/状态/缓存头。
 * @param {string} sourceId
 * @param {Object} patch - { lastFetchTime, lastCount, lastFetchStatus, errorStreak, enabled?, status?, lastModified?, etag? }
 */
async function updateFeed(sourceId, patch) {
  if (!sourceId || !patch) return
  try {
    await col().doc(sourceId).update({ data: patch })
  } catch (e) {
    console.warn(`[feedStore] 更新 ${sourceId} 失败:`, e.message)
  }
}

module.exports = { listFeeds, getFeed, listDueFeeds, upsertFeeds, updateFeed }
