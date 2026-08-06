/**
 * ⚠️ DEPRECATED（2026-08-06 · DG-01 数据治理）
 * owner 09:48 决策：历史/收藏改纯本地存储（wx.Storage），此云函数停用。
 * 代码保留供回滚参考；前端已停止调用（DG-02 detail 去云端化 / DG-04 页面纯本地化）。
 * 不再部署新版本即可；已部署实例收到调用将直接返回停用提示。
 */
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
  // ⚠️ DG-01 停用：历史/收藏已纯本地化（owner 2026-08-06 09:48 决策）
  console.warn('[DEPRECATED] 该云函数已停用（DG-01 数据治理，历史/收藏纯本地存储），收到调用直接返回')
  return { code: 0, deprecated: true, message: '该云函数已停用，历史/收藏已迁移纯本地存储' }

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
