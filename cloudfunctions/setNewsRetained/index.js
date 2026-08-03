/**
 * setNewsRetained 云函数 — RQ-16 新闻存储保留机制（v7 改造）
 *
 * v7（TL-B12 / 2026-08-03）：操作集合从 news → news_cache（news 集合自 v5.1 已停写，
 * 原逻辑标记失效）。标记/取消标记新闻的 isRetained 状态，使 refreshNews 分级清理时跳过。
 *
 * 输入：{ newsId: string, retained: boolean, retainedBy?: 'favorite'|'share' }
 * 输出：{ code: 0, data: { newsId, isRetained, retainedBy, updated } }
 *
 * 语义（PRD §7.1）：
 *   - retained=true  : { isRetained:true, retainedAt:now, retainedBy, cacheExpire: now+30d }
 *   - retained=false : { isRetained:false, retainedAt:null, retainedBy:null, cacheExpire: now+7d }（不物理删除）
 *
 * v4.1 平铺自包含风格（不依赖 common/）
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 保留策略 TTL（与 refreshNews/config.js 对齐，平铺自包含）
const RETAINED_TTL = 30 * 24 * 60 * 60 * 1000 // 30 天
const NORMAL_TTL = 7 * 24 * 60 * 60 * 1000   // 7 天

exports.main = async (event) => {
  const { newsId, retained, retainedBy } = event

  // ── 参数校验 ──
  if (!newsId || typeof newsId !== 'string' || newsId.trim().length === 0) {
    return { code: -1, message: '缺少 newsId 参数' }
  }
  if (typeof retained !== 'boolean') {
    return { code: -1, message: 'retained 参数必须为 boolean' }
  }

  const now = Date.now()

  try {
    // v7：按 newsId 查找 news_cache 集合（不再查 news）
    const exist = await db.collection('news_cache').where({ id: newsId }).get()

    if (!exist.data || exist.data.length === 0) {
      // 文档不存在 — 可能是旧收藏，无需操作
      console.log(`[setNewsRetained] news_cache 文档不存在: ${newsId}`)
      return {
        code: 0,
        message: '文档不存在，无需操作',
        data: { newsId, isRetained: false, retainedBy: null, updated: false },
      }
    }

    const doc = exist.data[0]

    if (retained) {
      // 标记为保留（30 天）
      await db.collection('news_cache').doc(doc._id).update({
        data: {
          isRetained: true,
          retainedAt: now,
          retainedBy: retainedBy || 'favorite',
          cacheExpire: now + RETAINED_TTL,
          updatedAt: now,
        },
      })
      console.log(`[setNewsRetained] 已标记保留: ${newsId} (by=${retainedBy || 'favorite'})`)
      return {
        code: 0,
        message: '已标记为保留',
        data: { newsId, isRetained: true, retainedBy: retainedBy || 'favorite', updated: true },
      }
    } else {
      // 取消保留：不物理删除，仅复位标记并重置为普通 7 天 TTL
      // 注：取消收藏不自动取消保留（D1 语义：曾收藏/曾分享即保留），前端仅在显式取消时才传 retained=false
      await db.collection('news_cache').doc(doc._id).update({
        data: {
          isRetained: false,
          retainedAt: null,
          retainedBy: null,
          cacheExpire: now + NORMAL_TTL,
          updatedAt: now,
        },
      })
      console.log(`[setNewsRetained] 已取消保留: ${newsId}`)
      return {
        code: 0,
        message: '已取消保留',
        data: { newsId, isRetained: false, retainedBy: null, updated: true },
      }
    }
  } catch (err) {
    console.error(`[setNewsRetained] 操作失败 [${newsId}]:`, err.message)
    return {
      code: -1,
      message: `操作失败: ${err.message}`,
    }
  }
}
