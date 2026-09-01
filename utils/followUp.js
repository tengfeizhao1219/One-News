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

/** 合并两模块，按 createdAt 倒序，每条带 module 字段（聚合 Feed 用）
 *  2026-09-01 两版演进：
 *   - 前版：§九 后端未实现，updates 仅来自演示 mock → 读取时清除，恢复纯关注态；
 *   - 本版：§九 后端已上线，updates 来自云端真实检索（followUpCheck 写入，带 checkedAt 标记）。
 *     clean 只清除「演示 mock 更新」（无 checkedAt），保留真实检索更新（前端红点/时间线数据源）。 */
function getFollows() {
  const clean = function (it) {
    const c = Object.assign({}, it)
    if (Array.isArray(c.updates)) {
      // 真实检索更新带 checkedAt；mock（addUpdate）没有 → 仅 mock 清除
      c.updates = c.updates.filter(function (u) { return u && u.checkedAt })
      if (!c.updates.length) delete c.updates
    }
    if (c.unreadCount !== undefined) delete c.unreadCount
    if (c.lastCheckedDate) delete c.lastCheckedDate
    return c
  }
  const on = _read('onenews').map(function (it) { return clean(Object.assign({ module: 'onenews' }, it)) })
  const intel = _read('intel').map(function (it) { return clean(Object.assign({ module: 'intel' }, it)) })
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
    knownSummary: item.knownSummary || '', // 关注时已知内容基线（云端 followUpCheck 判新用）
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

/**
 * 合并云端检索更新（§九 后端：followUpCheck 写入云端 → 前端拉取合并）。
 * 去重指纹 = date + summary 前 20 字；已存在则跳过（保留本地已读状态）。
 * @returns {boolean} 是否新增了更新
 */
function mergeUpdate(module, itemId, update) {
  if (!itemId || !update || !update.date || !update.summary) return false
  const entry = {
    date: String(update.date || ''),
    summary: String(update.summary || ''),
    sourcesCount: Number(update.sourcesCount) || 1,
    read: false,
    checkedAt: Number(update.checkedAt) || Date.now(), // 云端真实检索标记（getFollows 据此保留）
  }
  const fp = entry.date + '|' + entry.summary.slice(0, 20)
  let added = false
  _mapOne(module, itemId, function (it) {
    const updates = (it.updates || []).slice()
    const dup = updates.some(function (u) {
      return (u.date + '|' + String(u.summary || '').slice(0, 20)) === fp
    })
    if (dup) return it
    added = true
    updates.unshift(entry)
    return Object.assign({}, it, { updates: updates, lastCheckedDate: entry.date })
  })
  return added
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
  const hh = ('0' + d.getHours()).slice(-2)
  const mi = ('0' + d.getMinutes()).slice(-2)
  return d.getFullYear() + '-' + mm + '-' + dd + ' ' + hh + ':' + mi
}

/** 关注列表时间显示（2026-08-31）：带具体时分——
 *  今天 → 「今天 HH:MM」；昨天 → 「昨天 HH:MM」；更早 → 「MM-DD HH:MM」
 *  兼容旧数据（date 只有 YYYY-MM-DD 无时分 → 补 00:00）
 */
function formatFollowTime(dateStr) {
  if (!dateStr) return ''
  const s = String(dateStr).trim()
  // 解析（兼容 无时分 / 空格或T分隔 / 完整 ISO 带秒）
  let d
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    d = new Date(s + 'T00:00:00')              // YYYY-MM-DD
  } else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(s)) {
    d = new Date(s.replace(' ', 'T') + ':00')   // YYYY-MM-DD HH:MM
  } else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(s)) {
    d = new Date(s.replace(' ', 'T'))           // YYYY-MM-DD HH:MM:SS
  } else {
    d = new Date(s)
  }
  if (isNaN(d.getTime())) return s
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const hh = ('0' + d.getHours()).slice(-2)
  const mi = ('0' + d.getMinutes()).slice(-2)
  const hm = hh + ':' + mi
  // 旧数据 date 只有 YYYY-MM-DD（无时分）→ 只显示日期，不硬补 00:00
  const hasTime = /\d{2}:\d{2}/.test(s)
  const dayDiff = Math.round((startOfToday - startOfDay) / 86400000)
  if (dayDiff === 0) return hasTime ? '今天 ' + hm : '今天'
  if (dayDiff === 1) return hasTime ? '昨天 ' + hm : '昨天'
  const mm = ('0' + (d.getMonth() + 1)).slice(-2)
  const dd = ('0' + d.getDate()).slice(-2)
  return hasTime ? mm + '-' + dd + ' ' + hm : mm + '-' + dd
}

module.exports = {
  getFollows,
  formatFollowTime,
  isFollowed,
  addFollow,
  removeFollow,
  markAllRead,
  markRead,
  addUpdate,
  mergeUpdate,
  setTrackTime,
}
