/**
 * shareCard.js — 朋友圈单页模式分享卡打包/解析（owner 2026-09-07 拍板）
 * ============================================================
 * 背景：微信朋友圈单页模式（scene 1154）禁登录/云函数/本地存储不共用，
 *       落地页只能读到 onShareTimeline 打包进 query 的数据。
 * 方案：分享时（正常模式，可读完整卡片）把当前卡片内容打包进 query，
 *       单页打开时解析 query → 渲染完整首页卡片。
 *
 * query 字段（JSON 压缩后 encodeURIComponent）：
 *   { t:标题, c:分类名, s:来源, tm:时间, sum:摘要, ai:是否AI摘要, id:卡片id }
 * 注：摘要适度截断（默认 400 字），控制 query 长度在微信安全范围。
 */

const MAX_SUMMARY = 400

/**
 * 把新闻卡片对象打包成 query 字符串（供 onShareTimeline query 用）
 * @param {Object} news - 首页卡片/新闻对象（title/categoryName/source/time/summary/id/summarySource）
 * @returns {string} query（不含 ?，encodeURIComponent 后的 JSON）
 */
function buildCardQuery(news) {
  if (!news || !news.title) return ''
  const data = {
    t: String(news.title || '').slice(0, 80),
    c: String(news.categoryName || news.category || '').slice(0, 20),
    s: String(news.source || news.sourceName || '').slice(0, 30),
    tm: String(news.time || '').slice(0, 30),
    sum: String(news.summary || '').slice(0, MAX_SUMMARY),
    ai: news.summarySource === 'ai' || news.isAiSummary === true,
    id: String(news.id || ''),
  }
  return 'card=' + encodeURIComponent(JSON.stringify(data))
}

/**
 * 解析 onLoad query 里的卡片数据
 * @param {Object} query - onLoad 的 options
 * @returns {Object|null} 卡片数据 { title, categoryName, source, time, summary, isAi, id }
 */
function parseCardData(query) {
  if (!query || !query.card) return null
  try {
    const d = JSON.parse(decodeURIComponent(query.card))
    if (!d || !d.t) return null
    return {
      title: d.t,
      categoryName: d.c || '',
      source: d.s || '',
      time: d.tm || '',
      summary: d.sum || '',
      isAi: !!d.ai,
      id: d.id || '',
    }
  } catch (e) {
    return null
  }
}

module.exports = { buildCardQuery, parseCardData }
