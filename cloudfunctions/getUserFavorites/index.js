/**
 * getUserFavorites 云函数 — RQ-03 收藏上云（v7 / TL-B13）
 *
 * 按 _openid 返回收藏列表（isActive=true，倒序），分页（pageSize ≤ 50）。
 *
 * 输入：{ pageNum?, pageSize? }
 * 输出：{ code: 0, data: { list: [...], total } }
 *
 * v4.1 平铺自包含风格（不依赖 common/）
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID
  if (!openid) {
    return { code: -1, message: '无法获取用户身份（OPENID 为空）' }
  }

  const pageSize = Math.min(50, Math.max(1, event.pageSize || 50))
  const pageNum = Math.max(1, event.pageNum || 1)

  try {
    const coll = db.collection('favorites')
    const listRes = await coll
      .where({ _openid: openid, isActive: true })
      .orderBy('addedAt', 'desc')
      .skip((pageNum - 1) * pageSize)
      .limit(pageSize)
      .get()

    const totalRes = await coll.where({ _openid: openid, isActive: true }).count()

    const list = listRes.data.map(item => ({
      newsId: item.newsId,
      title: item.title,
      category: item.category,
      categoryName: item.categoryName,
      source: item.source,
      picUrl: item.picUrl,
      addedAt: item.addedAt,
    }))

    return { code: 0, data: { list, total: totalRes.total } }
  } catch (err) {
    console.error('[getUserFavorites] 失败:', err.message)
    return { code: -1, message: `查询失败: ${err.message}` }
  }
}
