// 获取新闻列表云函数 v4.2 — 纯智谱/DeepSeek，不降级不兜底，全是真实数据
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const config = require('./config')

// ─── 分类名称映射（本地常量，无需 adapter）───
const CATEGORY_NAMES = {
  recommend: '推荐', tech: '科技', sports: '体育',
  international: '国际', life: '生活',
}

// ─── 缓存查询 ────────────────────────────────────────

/**
 * 从云数据库 news_cache 读取（智谱/DeepSeek refreshNews 每小时写入）
 */
async function getFromDbCache(category, pageNum, pageSize) {
  try {
    const now = Date.now()
    const where = category && category !== 'all'
      ? { category, cacheExpire: db.command.gt(now) }
      : { cacheExpire: db.command.gt(now) }

    const res = await db.collection('news_cache')
      .where(where)
      .orderBy('publishTime', 'desc')
      .skip((pageNum - 1) * pageSize)
      .limit(pageSize)
      .get()

    if (res.data && res.data.length > 0) {
      const totalRes = await db.collection('news_cache')
        .where(where)
        .count()

      return {
        list: res.data.map(item => ({
          id: item.id, _id: item._id,
          title: item.title, summary: item.summary,
          category: item.category, categoryName: item.categoryName || CATEGORY_NAMES[item.category] || '',
          source: item.source, sourceUrl: item.sourceUrl || '', publishTime: item.publishTime,
        })),
        total: totalRes.total,
        hasMore: (pageNum * pageSize) < totalRes.total,
      }
    }
    return null
  } catch (err) {
    console.warn('[getNewsList] DB 缓存读取失败:', err.message)
    return null
  }
}

// ─── 主函数 v4.2：纯 news_cache（智谱/DeepSeek），不降级不兜底 ──

// ─── 主函数 v4.2：纯 L1 news_cache（智谱/DeepSeek），不降级不兜底，全是真实数据 ──

exports.main = async (event) => {
  const category = event.category || 'all'
  const pageNum = Math.max(1, parseInt(event.pageNum) || 1)
  const pageSize = Math.min(config.pagination.maxPageSize, Math.max(1, parseInt(event.pageSize) || config.pagination.defaultPageSize))

  console.log(`[getNewsList] v4.2 category=${category} page=${pageNum} size=${pageSize}`)

  // ── L1：云数据库 news_cache（智谱/DeepSeek refreshNews 每小时生成）──
  const dbCached = await getFromDbCache(category, pageNum, pageSize)
  if (dbCached && dbCached.list.length > 0) {
    console.log(`[getNewsList] L1 news_cache 命中，返回 ${dbCached.list.length} 条`)
    return { code: 0, data: dbCached, meta: { source: 'news_cache', engine: 'zhipu/deepseek' } }
  }

  // news_cache 为空 → 不降级，诚实返回空
  console.warn('[getNewsList] news_cache 无数据，请触发 refreshNews 后再试')
  return {
    code: 0,
    data: { list: [], total: 0, hasMore: false },
    meta: { source: 'empty', hint: 'news_cache 尚未填充，请部署 refreshNews 并手动触发一次' },
  }
}
