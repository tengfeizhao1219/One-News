// 情报详情查询云函数 intelGetDetail（前端连调 · 只读）
// ============================================================
// 职责：给前端 intel/detail 提供单条情报详情。
//   - 按 itemId 查 intel_staged（优先）→ intel_current 兜底
//   - 输出字段对齐 detail 页叙事弧线：标题 / 发生了什么(definition) /
//     落到你这里(sceneMapping) / 了解更多(minAction+源链接) / 上手试试(practice)
// 自包含：仅依赖 wx-server-sdk，无 common/ 共享模块，可独立部署。
// 返回：{ code:0, data:{...} } | { code:-1, errorCode:'NOT_FOUND'|'DB_ERROR' }
// ============================================================

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const INTEL_CURRENT = 'intel_current'
const INTEL_STAGED = 'intel_staged'

/** staged/current 文档 → 前端详情（字段对齐 pages/intel/detail wxml） */
function toDetail(doc) {
  const sop = doc.sop || {}
  const src = sop.source || {}
  return {
    id: doc.itemId || doc._id || '',
    title: doc.title || '',
    url: doc.url || src.url || '',
    srcName: src.name || doc.sourceId || '',
    sourceUrl: src.url || doc.url || '',
    publishedAt: src.publishedAt || '',
    // 发生了什么（正文，可能含换行，前端按段渲染）
    definition: sop.definition || '',
    // 发生了什么（科普向详细叙事，多段；无则前端回退 definition）
    whatHappened: sop.whatHappened || '',
    // 2026-08-20 v5：结构化块（后端解析产物 [{type,text}]；旧数据无则前端兜底解析）
    whatHappenedBlocks: Array.isArray(sop.whatHappenedBlocks) ? sop.whatHappenedBlocks : [],
    // 落到你这里（场景映射散文 + 命中场景标签）
    sceneMapping: sop.sceneMapping || '',
    sceneTags: Array.isArray(doc.sceneTags) ? doc.sceneTags : [],
    relevance: doc.relevance || '',
    // 了解更多（最小行动 + 参考链接）
    minAction: sop.minAction || '',
    references: Array.isArray(doc.references) ? doc.references : [],
    // 上手试试（可落地实操）
    practice: sop.practice || '',
    tryable: doc.tryable === true,
    research: doc.research || { status: 'todo' },
    processedAt: doc.processedAt || '',
    modelUsed: doc.modelUsed || '',
    cost: doc.cost || 0
  }
}

exports.main = async (event = {}) => {
  const id = String((event && event.id) || '')
  if (!id) return { code: -1, message: '缺少参数 id', errorCode: 'BAD_PARAM' }

  // 1) 优先 intel_staged
  try {
    const r1 = await db.collection(INTEL_STAGED).where({ itemId: id }).limit(1).get()
    if (r1.data && r1.data[0]) return { code: 0, data: toDetail(r1.data[0]) }
  } catch (e) {
    console.warn('[intelGetDetail] intel_staged 读取失败:', e.message)
  }

  // 2) 兜底 intel_current（2026-08-21：brief items 自包含完整 sop，从 items 数组按 itemId 查；
  //    staged 逐批清理不影响详情页）
  try {
    const r2 = await db.collection(INTEL_CURRENT).where({ isCurrent: true }).limit(1).get()
    if (r2.data && r2.data[0]) {
      const items = r2.data[0].items || []
      const hit = items.find((it) => it && it.itemId === id)
      if (hit) return { code: 0, data: toDetail(hit) }
    }
  } catch (e) {
    console.warn('[intelGetDetail] intel_current 读取失败:', e.message)
  }

  // 3) 终极兜底：历史 brief 归档（items 同样自包含 sop）
  try {
    const r3 = await db.collection('intel_current_archive')
      .where({ 'items.itemId': id }).limit(1).get()
    if (r3.data && r3.data[0]) {
      const hit = (r3.data[0].items || []).find((it) => it && it.itemId === id)
      if (hit) return { code: 0, data: toDetail(hit) }
    }
  } catch (e) {
    console.warn('[intelGetDetail] intel_current_archive 读取失败:', e.message)
  }

  return { code: -1, message: '未找到该情报', errorCode: 'NOT_FOUND' }
}
