// 情报查询云函数 intelGetList（前端连调 · 只读）
// ============================================================
// 职责：给前端 intel/home 提供情报列表。
//   - 优先读 intel_current（发布闸门 T4.1 置 isCurrent 指针后的用户可见当期快照）
//   - 为空/未落地则回退读 intel_staged（status=staged/released，按 processedAt desc）
// 自包含：仅依赖 wx-server-sdk，无 common/ 共享模块，可独立部署。
// 返回：{ code:0, data:{ list:[...], total, source:'current'|'staged' } }
// ============================================================

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const INTEL_CURRENT = 'intel_current'
const INTEL_STAGED = 'intel_staged'

/** staged/current 文档 → 前端列表项（字段对齐 pages/intel/home wxml） */
function toListItem(doc) {
  const sop = doc.sop || {}
  const src = sop.source || {}
  return {
    id: doc.itemId || doc._id || '',
    title: doc.title || doc.sourceName || '',
    desc: sop.definition || doc.summary || doc.minAction || '',
    src: src.name || doc.sourceId || doc.sourceName || '',
    time: doc.processedAt || src.publishedAt || doc.publishedAt || '',
    url: doc.url || src.url || '',
    relevance: doc.relevance || doc.sceneHits || '',
    sceneTags: Array.isArray(doc.sceneTags) ? doc.sceneTags : [],
    tryable: doc.tryable === true,
    status: doc.status || ''
  }
}

exports.main = async (event = {}) => {
  const pageNum = Math.max(1, Number(event.pageNum) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(event.pageSize) || 20))
  const skip = (pageNum - 1) * pageSize

  // 说明：intel_current 存储的是 Brief Markdown 快照（items[].card 文本），结构化转换
  //   由 getIntelBrief 云函数（Channels 层 OneNewsChannel.render）负责；本函数专供
  //   详情页/备用列表，直接读结构化的 intel_staged（status=staged/released）。
  // 1) intel_staged（处理后待发布/已发布，结构化）
  try {
    const res = await db.collection(INTEL_STAGED)
      .where({ status: _.in(['staged', 'released']) })
      .orderBy('processedAt', 'desc')
      .skip(skip).limit(pageSize)
      .get()
    return {
      code: 0,
      data: { list: (res.data || []).map(toListItem), total: res.data ? res.data.length : 0, source: 'staged' }
    }
  } catch (e) {
    console.error('[intelGetList] intel_staged 读取失败:', e.message)
    return { code: -1, message: '读取情报列表失败：' + e.message, errorCode: 'DB_ERROR', data: { list: [], total: 0 } }
  }
}
