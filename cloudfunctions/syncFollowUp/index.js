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
 *     - list 为该模块（module）的完整本地列表；云端按此做差量合并：
 *         · 本地有云端无 → 新增（isActive=true）
 *         · 云端有本地无 → 软删除（isActive=false，保留更新历史）
 *         · 两者都有     → 更新 trackTime 等可变字段
 *   { action: 'get', module: 'onenews'|'intel'|'' }  返回云端关注列表（含 updates 更新历史）
 *
 * 输出：{ code: 0, data: { list, updatesByItem } }
 *   - list: 该用户当前活跃关注（isActive=true，倒序）
 *   - updatesByItem: { [itemId]: [ {date, summary, sourcesCount, read:false} ] } 检索更新历史
 *
 * 约束：
 *   - 单用户单模块上限 200（与前端 MAX_ITEMS 对齐）；超限拒绝新增。
 *   - updates 由 followUpCheck（定时检索）写入；本函数只同步关注关系本体。
 *   - 幂等：重复 sync 不产生重复记录（_openid+module+itemId 唯一）。
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

/** 差量同步一个模块的列表 */
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
  const incomingIds = new Set()
  let added = 0
  let updated = 0
  let removed = 0

  // 1) upsert 本地有的
  for (const it of incoming) {
    if (!it || !it.itemId) continue
    incomingIds.add(it.itemId)
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

  // 2) 软删除本地没有的（保留 updates 历史与文档）
  for (const d of exist) {
    if (!incomingIds.has(d.itemId) && d.isActive) {
      await db.collection('follow_up').doc(d._id).update({ data: { isActive: false, removedAt: now } })
      removed++
    }
  }

  return { module, added, updated, removed }
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

    // 默认 sync：按 module 分组逐模块差量
    const list = Array.isArray(event.list) ? event.list : []
    const byModule = {}
    list.forEach((it) => {
      if (!it || !it.itemId) return
      const m = it.module === 'intel' ? 'intel' : 'onenews'
      ;(byModule[m] = byModule[m] || []).push(it)
    })
    const modules = Object.keys(byModule)
    if (!modules.length) {
      // 空列表同步：两个模块都清空（用户清空了关注）
      const results = []
      for (const m of ['onenews', 'intel']) {
        results.push(await syncModule(openid, m, []))
      }
      return { code: 0, data: { synced: results } }
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
