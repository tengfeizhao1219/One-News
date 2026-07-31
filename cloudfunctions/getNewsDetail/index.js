// 获取新闻详情云函数 v4.2 — 纯 news 集合（refreshNews 写入），不降级兜底
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const { newsId } = event

  if (!newsId) {
    return { code: -1, message: '缺少 newsId 参数' }
  }

  // ── news 集合（refreshNews 双写，content 由大模型生成）──
  try {
    console.log('[getNewsDetail] 查询 where id=', newsId)
    const res = await db.collection('news').where({ id: newsId }).get()
    console.log('[getNewsDetail] 查询结果:', res.data ? res.data.length : 'null', '条')

    if (res.data && res.data.length > 0) {
      const doc = res.data[0]
      const realId = doc._id

      // 阅读数+1（非阻塞）
      db.collection('news').doc(realId).update({
        data: { viewCount: _.inc(1) },
      }).catch(() => {})

      return { code: 0, data: doc, meta: { source: 'news', engine: 'zhipu/deepseek' } }
    }
  } catch (e) {
    console.warn('[getNewsDetail] news 集合未命中:', newsId, e && e.message)
  }

  return {
    code: -1,
    message: '新闻不存在或已过期',
    errorCode: 'NO_DATA',
  }
}
