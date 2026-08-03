/**
 * setNewsRetained 云函数 — B-16 新闻存储保留机制
 *
 * 当用户收藏或分享新闻时，标记该新闻在 news 集合中为「保留」状态，
 * 防止 refreshNews 刷新时覆盖该文档。30 天后非保留文档由 refreshNews 自动清理。
 *
 * 输入：{ newsId: string, retained: boolean }
 * 输出：{ code: 0, data: { newsId, isRetained, updated } }
 *
 * v4.1 平铺自包含风格（不依赖 common/）
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { newsId, retained } = event

  // ── 参数校验 ──
  if (!newsId || typeof newsId !== 'string' || newsId.trim().length === 0) {
    return { code: -1, message: '缺少 newsId 参数' }
  }
  if (typeof retained !== 'boolean') {
    return { code: -1, message: 'retained 参数必须为 boolean' }
  }

  const now = Date.now()

  try {
    // 按 newsId 查找 news 集合
    const exist = await db.collection('news').where({ id: newsId }).get()

    if (!exist.data || exist.data.length === 0) {
      // 文档不存在 — 可能是旧收藏，无需操作
      console.log(`[setNewsRetained] 文档不存在: ${newsId}`)
      return {
        code: 0,
        message: '文档不存在，无需操作',
        data: { newsId, isRetained: false, updated: false },
      }
    }

    const doc = exist.data[0]

    if (retained) {
      // 标记为保留
      await db.collection('news').doc(doc._id).update({
        data: {
          isRetained: true,
          retainedAt: now,
          updatedAt: now,
        },
      })
      console.log(`[setNewsRetained] 已标记保留: ${newsId}`)
      return {
        code: 0,
        message: '已标记为保留',
        data: { newsId, isRetained: true, updated: true },
      }
    } else {
      // 取消保留
      await db.collection('news').doc(doc._id).update({
        data: {
          isRetained: false,
          retainedAt: null,
          updatedAt: now,
        },
      })
      console.log(`[setNewsRetained] 已取消保留: ${newsId}`)
      return {
        code: 0,
        message: '已取消保留',
        data: { newsId, isRetained: false, updated: true },
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
