// 获取新闻列表云函数 — 云数据库优先，AI 静态缓存兜底
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const cache = require('../common/cache')
const aiNews = require('../common/aiNewsService')
const config = require('../common/config')

// ─── 外部 API 降级（终极兜底）───
const { callTianApi } = require('../common/tianApi')
const { callJuheApi } = require('../common/juheApi')
const { adaptNewsList, APP_TO_TIAN_COL, APP_TO_JUHE_TYPE, CATEGORY_NAMES } = require('../common/adapter')

// ─── 缓存查询 ────────────────────────────────────────

/**
 * 从云数据库缓存读取（第2层 — 主力数据源）
 * 由 refreshNews 云函数定期从 GitHub 拉取写入
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

// ─── 外部 API 降级 ───────────────────────────────────

async function fetchFromTianApi(category, pageNum, pageSize) {
  const colId = APP_TO_TIAN_COL[category]
  const fetchSize = Math.max(pageSize, config.pagination.apiFetchSize)
  const apiData = await callTianApi({ col: colId, page: pageNum, num: fetchSize })
  const adapted = adaptNewsList(apiData.list, 'tian', colId)
  return {
    list: adapted.slice(0, pageSize),
    total: apiData.allnum,
    hasMore: apiData.list.length >= fetchSize || adapted.length >= pageSize,
  }
}

async function fetchFromJuheApi(category, pageNum, pageSize) {
  const type = APP_TO_JUHE_TYPE[category]
  const apiData = await callJuheApi({ type, page: pageNum, page_size: pageSize })
  const adapted = adaptNewsList(apiData.list, 'juhe')
  return {
    list: adapted.slice(0, pageSize),
    total: adapted.length,
    hasMore: apiData.list.length >= pageSize,
  }
}

// ─── 主函数 ─────────────────────────────────────────

exports.main = async (event) => {
  const category = event.category || 'all'
  const pageNum = Math.max(1, parseInt(event.pageNum) || 1)
  const pageSize = Math.min(config.pagination.maxPageSize, Math.max(1, parseInt(event.pageSize) || config.pagination.defaultPageSize))

  console.log(`[getNewsList] category=${category} page=${pageNum} size=${pageSize}`)

  // ── 第1层：内存缓存 ──
  const memoryKey = `news:list:${category}:${pageNum}`
  const memoryCached = cache.get(memoryKey)
  if (memoryCached) {
    console.log('[getNewsList] L1 内存缓存命中')
    return { code: 0, data: memoryCached, meta: { source: 'memory_cache' } }
  }

  // ── 第2层：云数据库缓存（主力数据源，由 refreshNews 定期更新）──
  const dbCached = await getFromDbCache(category, pageNum, pageSize)
  if (dbCached && dbCached.list.length > 0) {
    console.log(`[getNewsList] L2 DB 缓存命中，返回 ${dbCached.list.length} 条`)
    cache.set(memoryKey, dbCached, { ttl: config.cache.memoryTTL })
    return { code: 0, data: dbCached, meta: { source: 'db_cache' } }
  }

  // ── 第3层：AI 静态缓存（代码内置，兜底保证永远有数据）──
  const aiResult = aiNews.getByCategory(category, pageNum, pageSize)
  const aiStats = aiNews.getStats()

  if (aiResult.list.length > 0) {
    console.log(`[getNewsList] L3 AI 静态缓存命中，返回 ${aiResult.list.length} 条`)

    const responseData = {
      list: aiResult.list,
      total: aiResult.total,
      hasMore: aiResult.hasMore,
    }

    cache.set(memoryKey, responseData, { ttl: config.cache.memoryTTL })

    return {
      code: 0,
      data: responseData,
      meta: {
        source: 'ai_cache',
        cacheVersion: aiStats.version,
        cacheGeneratedAt: aiStats.generatedAt,
      },
    }
  }

  // ── 第4层：外部 API 降级（需要 API Key，可选）──
  console.log('[getNewsList] 前三层均无数据，尝试外部 API')

  try {
    const result = await fetchFromTianApi(category, pageNum, pageSize)
    const responseData = { list: result.list, total: result.total, hasMore: result.hasMore }
    cache.set(memoryKey, responseData, { ttl: config.cache.memoryTTL })
    console.log(`[getNewsList] L4 天行 API 成功，返回 ${result.list.length} 条`)
    return { code: 0, data: responseData, meta: { source: 'tian_api' } }

  } catch (primaryErr) {
    console.warn('[getNewsList] 天行 API 失败:', primaryErr.message)

    try {
      const fallbackResult = await fetchFromJuheApi(category, pageNum, pageSize)
      const responseData = { list: fallbackResult.list, total: fallbackResult.total, hasMore: fallbackResult.hasMore }
      cache.set(memoryKey, responseData, { ttl: config.cache.memoryTTL })
      console.log(`[getNewsList] L4 聚合 API 降级成功，返回 ${fallbackResult.list.length} 条`)
      return { code: 0, data: responseData, meta: { source: 'juhe_fallback' } }

    } catch (fallbackErr) {
      console.error('[getNewsList] 所有数据源均不可用:', fallbackErr.message)
      return {
        code: -1,
        message: '新闻服务暂时不可用，请稍后重试',
        errorCode: config.errorCodes.ALL_DOWN,
      }
    }
  }
}
