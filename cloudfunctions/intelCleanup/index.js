// intelCleanup —— 历史数据滚动清理（owner 2026-08-20 拍板）
// ============================================================
// 策略：intel_ingest / intel_staged / intel_current_archive 三个集合
// 统一「保留近 7 天，滚动物理清除」。
//   - intel_ingest           原始抓取：fetchedAt < 7天前 删除
//   - intel_staged           处理产物：processedAt < 7天前 删除
//   - intel_current_archive  历史 brief 归档：archivedAt < 7天前 删除
// 物理删除（按 _id remove，避免 where().remove() 批量限制），分页取删。
// 触发：每天 03:00 定时（cloudbaserc triggers '0 0 3 * * * *'）。
// 幂等：重复执行安全（已删的不再匹配）。
// ============================================================
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const KEEP_MS = 7 * 24 * 3600 * 1000

const TARGETS = [
  { name: 'intel_ingest', timeField: 'fetchedAt' },
  { name: 'intel_staged', timeField: 'processedAt' },
  { name: 'intel_current_archive', timeField: 'archivedAt' },
]

/** 分页取「时间 < cutoff」的文档并物理删除（每批 100，循环至清空） */
async function removeOld(collectionName, timeField, cutoffIso) {
  const col = db.collection(collectionName)
  let removed = 0
  while (true) {
    const cond = {}
    cond[timeField] = _.lt(cutoffIso)
    const res = await col.where(cond).limit(100).get()
    const docs = res.data || []
    if (!docs.length) break
    await Promise.all(docs.map((d) => col.doc(d._id).remove().catch(() => {})))
    removed += docs.length
    if (docs.length < 100) break
  }
  return { removed }
}

exports.main = async () => {
  const cutoff = new Date(Date.now() - KEEP_MS).toISOString()
  const result = {}
  for (const t of TARGETS) {
    try {
      result[t.name] = await removeOld(t.name, t.timeField, cutoff)
    } catch (e) {
      result[t.name] = { error: e.message }
      console.warn(`[intelCleanup] ${t.name} 清理失败:`, e.message)
    }
  }
  console.log(`[intelCleanup] 完成 cutoff=${cutoff}`, JSON.stringify(result))
  return { ok: true, cutoff, keepDays: 7, result }
}
