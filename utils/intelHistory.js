/**
 * intelHistory.js — AI 情报官浏览历史（纯本地，owner 2026-08-21 拍板）
 * ============================================================
 * 对齐 One News 浏览历史（pages/detail _recordBrowse / pages/history）：
 * 本地数组存储 + 按 id 去重、刷新 viewedAt 置顶 + 30 天滚动清除 + LRU 上限。
 *
 * 存储：
 *   - key: intelBrowseHistory（lc: 前缀，与 One News browseHistory 隔离）
 *   - value: Array<{ id, title, src, time, desc, viewedAt, expireAt }>
 *   - 容量上限 200；条目过期读取时惰性剔除 + 回写（滚动清除落地）
 *
 * 依赖：utils/localCache.js 全局单例（与收藏/One News 同源）
 */

const { localCache } = require('./localCache')

const KEY = 'intelBrowseHistory'
const HISTORY_TTL = 30 * 24 * 60 * 60 * 1000 // 30 天滚动清除（owner 2026-08-21）
const MAX_ITEMS = 200

/**
 * 读取浏览历史（已剔除过期条目，按 viewedAt 倒序）
 * @returns {Array<Object>} 浏览历史数组
 */
function getHistory() {
  const list = (localCache.get(KEY) || []).filter(Boolean)
  const now = Date.now()
  const alive = list.filter((it) => !it.expireAt || now < it.expireAt)
  // 有过期条目 → 回写清理（滚动清除落地）
  if (alive.length !== list.length) {
    localCache.set(KEY, alive, { ttl: 0 })
  }
  return alive.sort((a, b) => (b.viewedAt || 0) - (a.viewedAt || 0))
}

/**
 * 记录浏览（按 id 去重：已存在刷新 viewedAt 置顶 + 刷新 30 天 TTL；不存在则新增）
 * @param {Object} item - { id, title, src, time, desc }
 */
function recordView(item) {
  if (!item || !item.id) return getHistory()
  const now = Date.now()
  let list = getHistory()
  const idx = list.findIndex((it) => it.id === item.id)
  if (idx >= 0) {
    list.splice(idx, 1) // 移除旧条目再置顶（保持倒序）
  }
  list.unshift({
    id: item.id,
    title: item.title || '',
    src: item.src || item.srcName || '',
    time: item.time || item.pubTime || '',
    desc: item.desc || item.descText || '',
    viewedAt: now,
    expireAt: now + HISTORY_TTL,
  })
  if (list.length > MAX_ITEMS) list = list.slice(0, MAX_ITEMS) // LRU 淘汰最旧
  localCache.set(KEY, list, { ttl: 0 })
  return list
}

/**
 * 移除一条浏览记录（列表页删除用）
 * @param {string} id
 */
function removeHistory(id) {
  if (!id) return getHistory()
  const list = getHistory().filter((it) => it.id !== id)
  localCache.set(KEY, list, { ttl: 0 })
  return list
}

/** 清空浏览历史 */
function clearHistory() {
  localCache.set(KEY, [], { ttl: 0 })
  return []
}

/** 容量上限（供 UI 提示） */
function maxItems() {
  return MAX_ITEMS
}

module.exports = { getHistory, recordView, removeHistory, clearHistory, maxItems }
