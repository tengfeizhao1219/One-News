/**
 * syncFollowUp 云函数 — 「关注后续」关注关系云端增量同步（§九 后端）
 * ============================================================
 * 背景：关注功能前端已完成（纯本地 localCache，utils/followUp.js），
 *       后端「每日 AI 定时检索」需要知道用户关注了什么 → 关注关系须上云。
 * 本函数：前端每次关注/取消/进入关注页时调用，把本地列表全量增量同步到
 *        follow_up 集合（按 _openid + module + itemId 幂等 upsert）。
 *
 * 输入（event）：
 *   { action: 'sync', list: [{ module, itemId, title, source, category,
 *                               categoryName, picUrl, trackTime, createdAt }] }
 *     - list 为该模块（module）的完整本地列表；云端按此做增量合并（纯增量，不删）：
 *         · 本地有云端无 → 新增（isActive=true）
 *         · 两者都有     → 更新 trackTime 等可变字段
 *     - ⚠️ owner 2026-09-08：本地列表不再作为「删除依据」（旧版把云端有本地无的记录软删，
 *       存在多设备/清缓存后本地列表不完整 → 一同步就把云端关注全灭的覆盖风险）。
 *       删除只能走显式 remove 动作。
 *   { action: 'remove', module: 'onenews'|'intel', itemId }
 *     - 取消关注：按 _openid+module+itemId **物理删除**云端文档（不再软删保留——
 *       owner 2026-09-08：取消关注后云端与本地缓存都不再保留该记录）
 *
 * 输出：
 *   sync   → { code: 0, data: { synced: [{ module, added, updated }] } }
 *   remove → { code: 0, data: { removed: 0|1 } }
 *   get    → { code: 0, data: { list, updatesByItem } }
 *   - updatesByItem: { [itemId]: [ {date, summary, sourcesCount, read:false} ] } 检索更新历史
 *
 * 约束：
 *   - 单用户单模块上限 200（与前端 MAX_ITEMS 对齐）；超限拒绝新增。
 *   - updates 由 followUpCheck（定时检索）写入；本函数只同步关注关系本体。
 *   - 幂等：重复 sync/remove 不产生副作用。
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const MAX_ITEMS = 200

/** 按 _openid+module+itemId 查单条（软删除也算，保留历史） */
async function findOne(openid, module, itemId) {
  const res = await db.collection('follow_up')
    .where({ _openid: openid, module, itemId })
    .limit(1)
    .get()
  return res.data && res.data[0] ? res.data[0] : null
}

/** 差量同步一个模块的列表（纯增量：只新增/更新，不删除） */
async function syncModule(openid, module, list) {
  const incoming = Array.isArray(list) ? list.filter(Boolean) : []
  if (incoming.length > MAX_ITEMS) {
    return { module, error: 'list exceeds max ' + MAX_ITEMS }
  }

  // 现有活跃记录（该模块全量，含软删除的以便恢复）
  const existRes = await db.collection('follow_up')
    .where({ _openid: openid, module })
    .limit(1000)
    .get()
  const exist = existRes.data || []
  const existByItem = {}
  exist.forEach((d) => { existByItem[d.itemId] = d })

  const now = Date.now()
  let added = 0
  let updated = 0

  // 1) upsert 本地有的
  for (const it of incoming) {
    if (!it || !it.itemId) continue
    const old = existByItem[it.itemId]
    if (old) {
      // 已存在：软删除恢复 + 更新可变字段
      const patch = {
        isActive: true,
        trackTime: it.trackTime || old.trackTime || '12:00',
        title: it.title || old.title || '',
        source: it.source || old.source || '',
        category: it.category || old.category || '',
        categoryName: it.categoryName || old.categoryName || '',
        picUrl: it.picUrl || old.picUrl || '',
        knownSummary: it.knownSummary || old.knownSummary || '', // 关注时已知内容基线（检索判新用）
        updatedAt: now,
      }
      await db.collection('follow_up').doc(old._id).update({ data: patch })
      updated++
    } else {
      // 新增
      await db.collection('follow_up').add({
        data: {
          _openid: openid,
          module,
          itemId: it.itemId,
          title: it.title || '',
          source: it.source || '',
          category: it.category || '',
          categoryName: it.categoryName || '',
          picUrl: it.picUrl || '',
          trackTime: it.trackTime || '12:00',
          knownSummary: it.knownSummary || '', // 关注时已知内容基线（检索判新用）
          isActive: true,
          createdAt: it.createdAt || now,
          addedAt: now,
          updatedAt: now,
          updates: [],           // 更新历史由 followUpCheck 写入
          lastCheckedDate: '',   // 最近一次检索日期（YYYY-MM-DD）
          lastCheckedTime: 0,    // 最近一次检索时间戳（防同天重复检索）
        },
      })
      added++
    }
  }

  // owner 2026-09-08：移除「云端有本地无 → 软删」的差量删除逻辑——
  // 本地列表可能不完整（清缓存/多设备），以它为删除依据会把云端关注误灭（覆盖风险）。
  // 删除只能由用户显式取消关注触发（action:'remove' 物理删除）。

  return { module, added, updated }
}

/** 物理删除一条关注（owner 2026-09-08：取消关注 → 云端不留记录，不再软删） */
async function removeFollowRecord(openid, module, itemId) {
  const old = await findOne(openid, module, itemId)
  if (!old) return 0
  await db.collection('follow_up').doc(old._id).remove()
  return 1
}

/** 读取某用户关注列表（活跃），附带 updates 历史 */
async function getFollows(openid, module) {
  const where = { _openid: openid, isActive: true }
  if (module) where.module = module
  const res = await db.collection('follow_up')
    .where(where)
    .orderBy('addedAt', 'desc')
    .limit(MAX_ITEMS)
    .get()
  const list = (res.data || []).map((d) => ({
    module: d.module,
    itemId: d.itemId,
    title: d.title || '',
    source: d.source || '',
    category: d.category || '',
    categoryName: d.categoryName || '',
    picUrl: d.picUrl || '',
    trackTime: d.trackTime || '12:00',
    createdAt: d.createdAt || d.addedAt || 0,
    lastCheckedDate: d.lastCheckedDate || '',
    knownSummary: d.knownSummary || '', // 已知内容基线（前端补传/展示用）
  }))
  const updatesByItem = {}
  ;(res.data || []).forEach((d) => {
    if (Array.isArray(d.updates) && d.updates.length) {
      updatesByItem[d.itemId] = d.updates
    }
  })
  return { list, updatesByItem }
}

exports.main = async (event = {}) => {
  const action = event.action || 'sync'
  const openid = cloud.getWXContext().OPENID
  if (!openid) return { code: -1, message: '无法获取用户身份（OPENID 为空）' }

  try {
    if (action === 'get') {
      const data = await getFollows(openid, event.module || '')
      return { code: 0, data }
    }

    if (action === 'remove') {
      // 取消关注 → 云端物理删除（owner 2026-09-08：云端与本地缓存都不再保留该记录）
      const removed = await removeFollowRecord(openid, event.module === 'intel' ? 'intel' : 'onenews', String(event.itemId || ''))
      return { code: 0, data: { removed } }
    }

    // 默认 sync：按 module 分组逐模块纯增量合并（不删除）
    const list = Array.isArray(event.list) ? event.list : []
    const byModule = {}
    list.forEach((it) => {
      if (!it || !it.itemId) return
      const m = it.module === 'intel' ? 'intel' : 'onenews'
      ;(byModule[m] = byModule[m] || []).push(it)
    })
    const modules = Object.keys(byModule)
    if (!modules.length) {
      // 空列表 = 无可增量内容，直接返回（不再视为「清空全部关注」——
      // 本地列表可能不完整，以此清空云端会误删其他设备的关注）
      return { code: 0, data: { synced: [] } }
    }
    const results = []
    for (const m of modules) {
      results.push(await syncModule(openid, m, byModule[m]))
    }
    return { code: 0, data: { synced: results } }
  } catch (err) {
    console.error('[syncFollowUp] 异常:', err && err.message)
    return { code: -1, message: '同步失败: ' + (err && err.message) }
  }
}
