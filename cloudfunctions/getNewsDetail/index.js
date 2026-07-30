// 获取新闻详情云函数 v2
// v2: 主源 news 集合（由 getNewsList L1 天行成功时异步写入），
//     降级到 AI 静态缓存（终极兜底）。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const aiNews = require('../common/aiNewsService')

exports.main = async (event) => {
  const { newsId } = event

  if (!newsId) {
    return { code: -1, message: '缺少 newsId 参数' }
  }

  // ── L1：news 集合（由 getNewsList 天行成功后异步写入）──
  try {
    const res = await db.collection('news').doc(newsId).get()

    if (res.data) {
      // 阅读数+1（非阻塞）
      db.collection('news').doc(newsId).update({
        data: { viewCount: _.inc(1) }
      }).catch(() => {})

      return { code: 0, data: res.data, meta: { source: 'db_news' } }
    }
  } catch (_) {
    console.log('[getNewsDetail] news 集合未命中 newsId=', newsId)
  }

  // ── L2：AI 静态缓存兜底 ──
  const aiItem = aiNews.getById(newsId)
  if (aiItem) {
    console.log('[getNewsDetail] AI 缓存兜底命中')
    return { code: 0, data: aiItem, meta: { source: 'ai_cache' } }
  }

  // 全部未命中
  return {
    code: -1,
    message: '新闻不存在或已过期',
    errorCode: 'NO_DATA',
  }
}
