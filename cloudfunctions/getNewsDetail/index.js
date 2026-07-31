// 获取新闻详情云函数 v3
// v3: 主源 news 集合（由 getNewsList L1 天行成功时同步写入）。
//     查询用 where({ id: newsId })（id 是自定义字段，非 CloudBase 的 _id）。
//     若正文 content 为空（天行仅给摘要），则同步抓取原文 URL 获取完整正文，
//     失败时用 summary 兜底；AI 静态缓存作为终极兜底。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const aiNews = require('./aiNewsService')
const { extractContent } = require('./contentExtractor')

/**
 * 同步抓取原文正文并更新 news 集合（3s 超时保护）。
 * 成功后返回正文字符串，失败返回 null。
 */
async function fetchAndPersistContent(realId, sourceUrl) {
  if (!sourceUrl) return null
  try {
    const paras = await extractContent(sourceUrl)
    if (!paras || paras.length === 0) return null
    const content = paras.join('\n')
    db.collection('news').doc(realId).update({
      data: { content, contentFetchedAt: Date.now() },
    }).catch(() => {})
    return content
  } catch (_) {
    return null
  }
}

exports.main = async (event) => {
  const { newsId } = event

  if (!newsId) {
    return { code: -1, message: '缺少 newsId 参数' }
  }

  // ── L1：news 集合（where id=newsId，id 是自定义字段）──
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

      const data = { ...doc }

      // 正文为空时：同步抓原文 → 拿到完整正文或 summary 兜底
      if (!data.content || data.content.length < 30) {
        const fetched = await fetchAndPersistContent(realId, data.sourceUrl)
        data.content = fetched || data.summary || ''
      }

      return { code: 0, data, meta: { source: 'db_news' } }
    }
  } catch (e) {
    console.log('[getNewsDetail] news 集合未命中 newsId=', newsId, e && e.message)
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
