/**
 * setUserFavorite 云函数 — RQ-03 收藏上云（v7 / TL-B13）
 *
 * 按 _openid + newsId upsert 收藏记录到 favorites 集合（软删除语义）。
 *
 * 输入：{ newsId, title, category, categoryName, source, picUrl, favorited: boolean }
 * 输出：{ code: 0, data: { newsId, favorited } }
 *
 * v4.1 平铺自包含风格（不依赖 common/）
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { newsId, title, category, categoryName, source, picUrl, favorited } = event

  if (!newsId || typeof newsId !== 'string') {
    return { code: -1, message: '缺少 newsId 参数' }
  }
  if (typeof favorited !== 'boolean') {
    return { code: -1, message: 'favorited 参数必须为 boolean' }
  }

  const openid = cloud.getWXContext().OPENID
  if (!openid) {
    return { code: -1, message: '无法获取用户身份（OPENID 为空）' }
  }

  const now = Date.now()

  try {
    const coll = db.collection('favorites')

    if (favorited) {
      // upsert：已存在则更新字段 + isActive=true，否则新增
      const exist = await coll.where({ _openid: openid, newsId }).get()
      if (exist.data && exist.data.length > 0) {
        await coll.doc(exist.data[0]._id).update({
          data: {
            isActive: true,
            title: title || '',
            category: category || '',
            categoryName: categoryName || '',
            source: source || '',
            picUrl: picUrl || '',
            addedAt: now,
            updatedAt: now,
          },
        })
      } else {
        await coll.add({
          data: {
            _openid: openid,
            newsId,
            title: title || '',
            category: category || '',
            categoryName: categoryName || '',
            source: source || '',
            picUrl: picUrl || '',
            isActive: true,
            addedAt: now,
            createdAt: now,
            updatedAt: now,
          },
        })
      }
      return { code: 0, data: { newsId, favorited: true } }
    } else {
      // 取消收藏：软删除（isActive=false），不物理删除（保留可恢复）
      const exist = await coll.where({ _openid: openid, newsId }).get()
      if (exist.data && exist.data.length > 0) {
        await coll.doc(exist.data[0]._id).update({
          data: { isActive: false, updatedAt: now },
        })
      }
      return { code: 0, data: { newsId, favorited: false } }
    }
  } catch (err) {
    console.error(`[setUserFavorite] 失败 [${newsId}]:`, err.message)
    return { code: -1, message: `操作失败: ${err.message}` }
  }
}
