/**
 * recordBrowse 云函数 — RQ-06 浏览记录云端兜底（v7 / TL-B14）
 *
 * 按 _openid + newsId upsert 浏览历史到 browse_history 集合。
 * 同 id 重复浏览刷新 viewedAt 并置顶（去重）；expireAt = now + 7 天（过期惰性清理）。
 *
 * 输入：{ newsId, title, category, categoryName, source }
 * 输出：{ code: 0 }
 *
 * v4.1 平铺自包含风格（不依赖 common/）
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const BROWSE_TTL = 7 * 24 * 60 * 60 * 1000 // 7 天

exports.main = async (event) => {
  const { newsId, title, category, categoryName, source } = event

  if (!newsId || typeof newsId !== 'string') {
    return { code: -1, message: '缺少 newsId 参数' }
  }

  const openid = cloud.getWXContext().OPENID
  if (!openid) {
    return { code: -1, message: '无法获取用户身份（OPENID 为空）' }
  }

  const now = Date.now()
  const expireAt = now + BROWSE_TTL

  try {
    const coll = db.collection('browse_history')
    const exist = await coll.where({ _openid: openid, newsId }).get()
    if (exist.data && exist.data.length > 0) {
      // 去重：刷新 viewedAt 置顶 + 更新过期时间 + 元信息快照
      await coll.doc(exist.data[0]._id).update({
        data: {
          viewedAt: now,
          expireAt,
          title: title || '',
          category: category || '',
          categoryName: categoryName || '',
          source: source || '',
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
          viewedAt: now,
          expireAt,
          createdAt: now,
          updatedAt: now,
        },
      })
    }
    return { code: 0 }
  } catch (err) {
    console.error(`[recordBrowse] 失败 [${newsId}]:`, err.message)
    return { code: -1, message: `操作失败: ${err.message}` }
  }
}
