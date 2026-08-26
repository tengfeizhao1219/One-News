/**
 * followUp.js — 「关注后续」关注关系本地存储（纯本地，对齐 intelFavorites.js / favorites）
 * ============================================================
 * 跨 One News + AI 情报官：按 module 分两个 key 隔离（lc:followUp / lc:intelFollowUp），
 * 读取时合并为统一 Feed（前端零额外改造即可跨模块聚合，对齐需求文档 §5.5）。
 *
 * 存储：
 *   - One News key:  followUp       (lc: 前缀，与 favorites 隔离)
 *   - 情报官 key:    intelFollowUp  (lc: 前缀，与 intelFavorites 隔离)
 *   - value: Array<{ module, itemId, title, source, category, categoryName, picUrl,
 *                     trackTime, createdAt, lastCheckedDate, updates:[] }>
 *   - 容量上限 200（对齐收藏）；写入 ttl:0（条目级状态由前端逻辑控制）
 *
 * 依赖：utils/localCache.js 全局单例（与 detail/favorites/history 同源）
 *
 * 说明：本期纯前端，后端每日 AI 定时检索未实现（需求文档 §九）。addUpdate 为演示用，
 *       仅手动触发生成 mock update，不放自动 mock（尊重 intel「前端不放假数据」约定）。
 */

const { localCache } = require('./localCache')

const KEY_ON = 'followUp'        // One News
const KEY_INTEL = 'intelFollowUp' // 情报官
const MAX_ITEMS = 200

/** module → 存储 key */
function _keyOf(module) {
  return module === 'intel' ? KEY_INTEL : KEY_ON
}

/** 读取某模块关注列表（容错） */
function _read(module) {
  return (localCache.get(_keyOf(module)) || []).filter(Boolean)
}

/** 写回某模块关注列表 */
function _write(module, list) {
  localCache.set(_keyOf(module), list, { ttl: 0 })
}

/** 合并两模块，按 createdAt 倒序，每条带 module 字段（聚合 Feed 用） */
function getFollows() {
  const on = _read('onenews').map(function (it) { return Object.assign({ module: 'onenews' }, it) })
  const intel = _read('intel').map(function (it) { return Object.assign({ module: 'intel' }, it) })
  return on.concat(intel).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0) })
}

/** 是否已关注某条 */
function isFollowed(module, itemId) {
  if (!itemId) return false
  return _read(module).some(function (it) { return it.itemId === itemId })
}

/** 关注一条（幂等；容量上限） */
function addFollow(module, item) {
  if (!item || !item.itemId) return { followed: false, list: getFollows() }
  const list = _read(module)
  if (list.some(function (it) { return it.itemId === item.itemId })) {
    return { followed: true, list: getFollows() } // 已关注，幂等返回
  }
  if (list.length >= MAX_ITEMS) {
    return { followed: false, full: true, list: getFollows() }
  }
  const now = Date.now()
  list.unshift({
    itemId: item.itemId,
    title: item.title || '',
    source: item.source || item.sourceName || '',
    category: item.category || '',
    categoryName: item.categoryName || '',
    picUrl: item.picUrl || '',
    trackTime: item.trackTime || '12:00',
    createdAt: now,
    lastCheckedDate: '',
    updates: [],
  })
  _write(module, list)
  return { followed: true, list: getFollows() }
}

/** 取消关注 */
function removeFollow(module, itemId) {
  if (!itemId) return getFollows()
  const list = _read(module).filter(function (it) { return it.itemId !== itemId })
  _write(module, list)
  return getFollows()
}

/** 对单条做映射修改并回写 */
function _mapOne(module, itemId, fn) {
  const list = _read(module)
  let changed = false
  const next = list.map(function (it) {
    if (it.itemId !== itemId) return it
    changed = true
    return fn(it)
  })
  if (changed) _write(module, next)
  return getFollows()
}

/** 标记某条全部更新已读（读完转绿） */
function markRead(module, itemId) {
  return _mapOne(module, itemId, function (it) {
    const updates = (it.updates || []).map(function (u) { return Object.assign({}, u, { read: true }) })
    return Object.assign({}, it, { updates: updates })
  })
}

/** 全部标为已读（顶部一键清标） */
function markAllRead() {
  ;['onenews', 'intel'].forEach(function (m) {
    const list = _read(m).map(function (it) {
      return Object.assign({}, it, {
        updates: (it.updates || []).map(function (u) { return Object.assign({}, u, { read: true }) }),
      })
    })
    _write(m, list)
  })
  return getFollows()
}

/** 模拟一次 AI 检索更新（演示用：仅手动触发，不放自动 mock） */
function addUpdate(module, itemId, update) {
  const u = update || {}
  const entry = {
    date: u.date || _todayStr(),
    summary: u.summary || '今日全网检索到与该话题相关的新进展，AI 已为你汇总要点。',
    sourcesCount: u.sourcesCount || (1 + Math.floor(Math.random() * 4)),
    read: false,
  }
  return _mapOne(module, itemId, function (it) {
    const updates = (it.updates || []).slice()
    updates.unshift(entry)
    return Object.assign({}, it, { updates: updates, lastCheckedDate: entry.date })
  })
}

/** 改追踪时间（08:00 / 12:00 / 18:00 / 21:00） */
function setTrackTime(module, itemId, time) {
  return _mapOne(module, itemId, function (it) {
    return Object.assign({}, it, { trackTime: time })
  })
}

function _todayStr() {
  const d = new Date()
  const mm = ('0' + (d.getMonth() + 1)).slice(-2)
  const dd = ('0' + d.getDate()).slice(-2)
  return d.getFullYear() + '-' + mm + '-' + dd
}

module.exports = {
  getFollows,
  isFollowed,
  addFollow,
  removeFollow,
  markAllRead,
  markRead,
  addUpdate,
  setTrackTime,
}
