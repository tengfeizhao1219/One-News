/**
 * ⚠️ DEPRECATED（2026-08-06 · DG-01 数据治理）
 * owner 09:48 决策：历史/收藏改纯本地存储（wx.Storage），此云函数停用。
 * 代码保留供回滚参考；前端已停止调用（DG-02 detail 去云端化 / DG-04 页面纯本地化）。
 * 不再部署新版本即可；已部署实例收到调用将直接返回停用提示。
 */
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
  // ⚠️ DG-01 停用：历史/收藏已纯本地化（owner 2026-08-06 09:48 决策）
  console.warn('[DEPRECATED] 该云函数已停用（DG-01 数据治理，历史/收藏纯本地存储），收到调用直接返回')
  return { code: 0, deprecated: true, message: '该云函数已停用，历史/收藏已迁移纯本地存储' }

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
