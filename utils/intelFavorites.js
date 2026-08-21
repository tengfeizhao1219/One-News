/**
 * intelFavorites.js — AI 情报官收藏（纯本地，owner 2026-08-20 拍板）
 * ============================================================
 * 对齐 One News 收藏逻辑（pages/detail B-04）：localCache 数组存储 +
 * 条目级 TTL 读取过滤（滚动清除），云函数不参与。
 * 差异：与 One News 一致，TTL=30 天滚动清除（owner 2026-08-21：统一 30 天）。
 *
 * 存储：
 *   - key: intelFavorites（lc: 前缀，与 One News 的 favorites 隔离）
 *   - value: Array<{ id, title, src, time, desc, addedAt, expireAt }>
 *   - 容量上限 200（对齐 One News）；条目过期后读取时惰性剔除 + 回写
 *
 * 依赖：utils/localCache.js 全局单例（与 One News detail/favorites 同源）
 */

const { localCache } = require('./localCache')

const KEY = 'intelFavorites'
const FAVORITES_TTL = 30 * 24 * 60 * 60 * 1000 // 30 天滚动清除（owner 2026-08-21：与 One News 统一）
const MAX_ITEMS = 200

/**
 * 读取收藏（已剔除过期条目，并按 addedAt 倒序）
 * @returns {Array<Object>} 收藏数组
 */
function getFavorites() {
  const list = (localCache.get(KEY) || []).filter(Boolean)
  const now = Date.now()
  const alive = list.filter((it) => !it.expireAt || now < it.expireAt)
  // 有过期条目 → 回写清理（滚动清除落地）
  if (alive.length !== list.length) {
    localCache.set(KEY, alive, { ttl: 0 }) // 0 = 永不过期（条目级 TTL 由 expireAt 控制）
  }
  return alive.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
}

/**
 * 是否已收藏某条情报
 * @param {string} id - 情报 itemId
 * @returns {boolean}
 */
function isFavorited(id) {
  if (!id) return false
  return getFavorites().some((it) => it.id === id)
}

/**
 * 切换收藏状态
 * @param {Object} item - { id, title, src, time, desc }（字段对齐详情页/卡片）
 * @returns {{ favorited: boolean, list: Array }} 新状态 + 新列表（供调用方渲染）
 */
function toggleFavorite(item) {
  if (!item || !item.id) return { favorited: false, list: getFavorites() }
  const list = getFavorites()
  const idx = list.findIndex((it) => it.id === item.id)
  let favorited = false
  if (idx >= 0) {
    // 取消收藏
    list.splice(idx, 1)
  } else {
    // 添加收藏（容量上限）
    if (list.length >= MAX_ITEMS) {
      return { favorited: false, list, full: true }
    }
    const now = Date.now()
    list.unshift({
      id: item.id,
      title: item.title || '',
      src: item.src || item.srcName || '',
      time: item.time || item.pubTime || '',
      desc: item.desc || item.descText || '',
      addedAt: now,
      expireAt: now + FAVORITES_TTL, // 30 天滚动清除
    })
    favorited = true
  }
  localCache.set(KEY, list, { ttl: 0 })
  return { favorited, list }
}

/**
 * 直接移除一条收藏（收藏列表页取消用）
 * @param {string} id
 */
function removeFavorite(id) {
  if (!id) return getFavorites()
  const list = getFavorites().filter((it) => it.id !== id)
  localCache.set(KEY, list, { ttl: 0 })
  return list
}

/** 容量上限（供 UI 提示） */
function maxItems() {
  return MAX_ITEMS
}

module.exports = { getFavorites, isFavorited, toggleFavorite, removeFavorite, maxItems }
