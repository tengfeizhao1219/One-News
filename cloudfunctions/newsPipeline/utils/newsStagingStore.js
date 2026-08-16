/**
 * newsStagingStore.js — news_staging 落库（Stage 1 输出 / Stage 2-3 输入）
 * ============================================================
 * Stage 1 (process) 把过质量门的条目写入 news_staging(aiStatus=pending, 含 content)。
 * Stage 2 (ai) 把 pending 认领→AI 加工→标 done。
 * Stage 3 (publish) 把 done 认领→落 news_cache→删 staging。
 * 状态机保证幂等、可续跑、防重复处理。
 *
 * 设计依据：docs/architecture-pipeline-redesign.md §2 / §5
 */
const cloud = require('wx-server-sdk')
const db = cloud.database()
const _ = db.command

const COLLECTION = 'news_staging'
const STALE_MS = 5 * 60 * 1000 // processing 卡死 5min 后可重认领

// P0-4：AI 重试熔断参数——重试上限 + 冷却期，防止引擎故障期无限重试链（费用失控）
const MAX_AI_RETRY = 3
const RETRY_COOLDOWN_MS = 10 * 60 * 1000

function col() { return db.collection(COLLECTION) }

// Stage 1：写入 staging（幂等，按 _id upsert）
async function writeStaging(docs) {
  let added = 0, updated = 0, failed = 0
  for (const doc of docs) {
    if (!doc || !doc._id) { failed++; continue }
    try {
      const ex = await col().doc(doc._id).get().catch(() => null)
      if (ex && ex.data) {
        await col().doc(doc._id).update({ data: doc })
        updated++
      } else {
        // 新增时初始化重试字段（update 路径不重置，避免已消耗的重试次数被清零）
        await col().add({ data: Object.assign({ aiStatus: 'pending', aiRetry: 0, aiFailAt: 0 }, doc) })
        added++
      }
    } catch (e) {
      const msg = ((e && (e.errMsg || e.message)) || '').toString()
      if (msg.includes('duplicate') || msg.includes('already') || msg.includes('11000')) added++
      else { failed++; console.warn('[newsStagingStore] writeStaging 失败:', msg) }
    }
  }
  return { added, updated, failed }
}

// Stage 2：认领一批待 AI 加工（pending 或卡死的 processing）
// P0-5：原子认领——条件更新（只改仍可认领的）+ claimToken 回读实际归属，
//       并发实例不会重复认领同一批（消除重复 AI 调用）。
// P0-4：pending 且未耗尽重试（aiRetry<3）且不在冷却期（aiFailAt>10min 前）才可认领。
async function claimPending(limit) {
  const now = Date.now()
  const token = Math.random().toString(36).slice(2) + '_' + now.toString(36)
  const res = await col()
    .where(_.or([
      { aiStatus: 'pending' },
      _.and([{ aiStatus: 'processing' }, { claimedAt: _.lt(now - STALE_MS) }]),
    ]))
    .orderBy('createdAt', 'asc')
    .limit(limit)
    .get()
  const candidates = (res && res.data) || []
  // 熔断过滤（aiRetry/aiFailAt 缺失视为 0/未失败）
  const claimable = candidates.filter((it) => {
    const retry = Number(it.aiRetry) || 0
    if (retry >= MAX_AI_RETRY) return false
    const failAt = Number(it.aiFailAt) || 0
    if (failAt && (now - failAt) < RETRY_COOLDOWN_MS) return false
    return true
  })
  if (!claimable.length) return []
  const ids = claimable.map((i) => i._id)
  try {
    await col().where(_.or([
      { _id: _.in(ids), aiStatus: 'pending' },
      _.and([{ _id: _.in(ids), aiStatus: 'processing' }, { claimedAt: _.lt(now - STALE_MS) }]),
    ])).update({ data: { aiStatus: 'processing', claimedAt: now, claimToken: token } })
  } catch (e) {
    console.warn('[newsStagingStore] claimPending 认领更新失败:', (e && e.message) || e)
    return []
  }
  // 回读本实例实际认领到的（claimToken 唯一标识本次认领）
  const claimedRes = await col().where({ _id: _.in(ids), claimToken: token }).limit(limit).get()
  return (claimedRes && claimedRes.data) || []
}

async function markDone(ids) {
  if (!ids || !ids.length) return
  await col().where({ _id: _.in(ids) }).update({ data: { aiStatus: 'done', aiAt: Date.now() } })
}

// 解读覆盖优化（2026-08-16）：deadline 预算跳过 ≠ 引擎失败，退回时不烧重试次数，
// 让文档能跨实例继续被处理（否则 3 轮预算跳过即被丢弃 → 永远无 AI 摘要/解读）。
async function markPendingKeepRetry(ids) {
  if (!ids || !ids.length) return
  await col().where({ _id: _.in(ids) }).update({ data: { aiStatus: 'pending' } })
}

// P0-4：退回 pending 时自增重试计数 + 记录失败时间；耗尽重试上限 → 转 discarded（不再进 AI）
async function markPending(ids) {
  if (!ids || !ids.length) return
  const now = Date.now()
  await col().where({ _id: _.in(ids) }).update({ data: { aiStatus: 'pending', aiRetry: _.inc(1), aiFailAt: now } })
  const over = await col().where({ _id: _.in(ids), aiRetry: _.gte(MAX_AI_RETRY) }).get()
  const overIds = ((over && over.data) || []).map((d) => d._id)
  if (overIds.length) {
    await col().where({ _id: _.in(overIds) }).update({ data: { aiStatus: 'discarded', discardedAt: now } })
    console.warn(`[newsStagingStore] ${overIds.length} 条 AI 重试耗尽 → discarded（熔断）`)
  }
}

// P0-4：清扫历史遗留的"已耗尽重试但仍 pending"的条目（部署前旧数据）→ discarded
async function discardExhausted() {
  try {
    const r = await col().where({ aiStatus: 'pending', aiRetry: _.gte(MAX_AI_RETRY) }).get()
    const ids = ((r && r.data) || []).map((d) => d._id)
    if (ids.length) {
      await col().where({ _id: _.in(ids) }).update({ data: { aiStatus: 'discarded', discardedAt: Date.now() } })
      console.warn(`[newsStagingStore] 清扫 ${ids.length} 条耗尽重试的 pending → discarded`)
    }
    return ids.length
  } catch (e) { return 0 }
}

// Stage 3：认领一批已 done（batchInsert 幂等 + 删 staging 即终态，无需中间态防卡死）
async function claimDone(limit) {
  const res = await col().where({ aiStatus: 'done' }).orderBy('createdAt', 'asc').limit(limit).get()
  return (res && res.data) || []
}

async function removeStaged(ids) {
  for (const id of (ids || [])) {
    try { await col().doc(id).remove() } catch (e) { /* 忽略 */ }
  }
}

async function pendingCount() {
  const r = await col().where(_.or([{ aiStatus: 'pending' }, { aiStatus: 'processing' }])).count().catch(() => ({ total: 0 }))
  return r.total || 0
}
async function doneCount() {
  const r = await col().where({ aiStatus: 'done' }).count().catch(() => ({ total: 0 }))
  return r.total || 0
}

module.exports = {
  COLLECTION,
  writeStaging,
  claimPending,
  markDone,
  markPending,
  markPendingKeepRetry,
  discardExhausted,
  claimDone,
  removeStaged,
  pendingCount,
  doneCount,
}
