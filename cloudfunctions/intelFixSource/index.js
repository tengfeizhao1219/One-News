// 一次性运维函数 v2：修复 intel_sources 嵌套源 + 恢复指定源（doc.set 指定 _id）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event = {}) => {
  const fixed = []
  const removed = []
  // 1) 遍历修复嵌套源
  const res = await db.collection('intel_sources').limit(1000).get()
  for (const f of res.data || []) {
    if (!(f.data && typeof f.data === 'object' && f.data.key)) continue
    const inner = f.data
    const realId = inner._id || inner.key
    const flat = {}
    for (const k of Object.keys(inner)) { if (k !== '_id') flat[k] = inner[k] }
    // 外层自动 id ≠ 真实 id → 先删外层，再用 doc(realId).set 写回
    if (f._id !== realId) {
      try { await db.collection('intel_sources').doc(f._id).remove(); removed.push(f._id) } catch (e) {}
    }
    try {
      await db.collection('intel_sources').doc(realId).set({ data: flat })
      fixed.push(realId)
    } catch (e) { console.warn('set 失败:', realId, e.message || e) }
  }
  // 2) 恢复缺失源（event.restore = {id, doc}）
  if (event.restore && event.restore.id && event.restore.doc) {
    const flat = {}
    for (const k of Object.keys(event.restore.doc)) { if (k !== '_id') flat[k] = event.restore.doc[k] }
    try {
      await db.collection('intel_sources').doc(event.restore.id).set({ data: flat })
      fixed.push('restore:' + event.restore.id)
    } catch (e) { console.warn('restore 失败:', e.message || e) }
  }
  return { ok: true, fixed, removed }
}
