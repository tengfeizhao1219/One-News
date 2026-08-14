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
        await col().add({ data: doc })
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
async function claimPending(limit) {
  const now = Date.now()
  const res = await col()
    .where(_.or([
      { aiStatus: 'pending' },
      _.and([{ aiStatus: 'processing' }, { claimedAt: _.lt(now - STALE_MS) }]),
    ]))
    .orderBy('createdAt', 'asc')
    .limit(limit)
    .get()
  const items = (res && res.data) || []
  if (items.length > 0) {
    const ids = items.map((i) => i._id)
    await col().where({ _id: _.in(ids) }).update({ data: { aiStatus: 'processing', claimedAt: now } })
  }
  return items
}

async function markDone(ids) {
  if (!ids || !ids.length) return
  await col().where({ _id: _.in(ids) }).update({ data: { aiStatus: 'done', aiAt: Date.now() } })
}

async function markPending(ids) {
  if (!ids || !ids.length) return
  await col().where({ _id: _.in(ids) }).update({ data: { aiStatus: 'pending' } })
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
  claimDone,
  removeStaged,
  pendingCount,
  doneCount,
}
