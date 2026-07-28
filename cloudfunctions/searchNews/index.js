// 搜索新闻云函数 — 云数据库优先，AI 静态缓存兜底
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const cache = require('../common/cache')
const aiNews = require('../common/aiNewsService')
const config = require('../common/config')

// ─── 外部 API 降级 ───────────────────────────────────
const { callTianApi } = require('../common/tianApi')
const { adaptNewsList } = require('../common/adapter')

// ─── 搜索实现 ────────────────────────────────────────

/**
 * 从云数据库全量拉取并客户端过滤搜索（第2层）
 */
async function searchFromDb(keyword, pageNum, pageSize) {
  try {
    const now = Date.now()
    // 全量拉取所有未过期的缓存（最多 50 条，避免超量）
    const res = await db.collection('news_cache')
      .where({ cacheExpire: db.command.gt(now) })
      .orderBy('publishTime', 'desc')
      .limit(50)
      .get()

    if (!res.data || res.data.length === 0) return null

    // 客户端过滤
    const kw = keyword.trim().toLowerCase()
    const filtered = res.data.filter(item =>
      (item.title || '').toLowerCase().includes(kw) ||
      (item.summary || '').toLowerCase().includes(kw)
    )

    if (filtered.length === 0) return null

    // 分页
    const total = filtered.length
    const start = (pageNum - 1) * pageSize
    const paged = filtered.slice(start, start + pageSize)

    return {
      list: paged.map(item => ({
        id: item.id, _id: item._id,
        title: item.title, summary: item.summary,
        category: item.category, categoryName: item.categoryName,
        source: item.source, publishTime: item.publishTime,
      })),
      total,
    }
  } catch (err) {
    console.warn('[searchNews] DB 搜索失败:', err.message)
    return null
  }
}

/**
 * 通过天行 API 搜索（第4层降级）
 */
async function searchViaTianApi(keyword, pageNum, pageSize) {
  const apiData = await callTianApi({
    col: null,
    word: keyword,
    page: pageNum,
    num: pageSize,
  })
  const adapted = adaptNewsList(apiData.list, 'tian', null)
  return { list: adapted, total: apiData.allnum }
}

// ─── 主函数 ─────────────────────────────────────────

exports.main = async (event) => {
  const keyword = (event.keyword || '').trim()
  const pageNum = Math.max(1, parseInt(event.pageNum) || 1)
  const pageSize = Math.min(config.pagination.maxPageSize, Math.max(1, parseInt(event.pageSize) || config.pagination.defaultPageSize))

  console.log(`[searchNews] keyword="${keyword}" page=${pageNum}`)

  // 参数校验
  if (!keyword) {
    return { code: -1, message: '请输入搜索关键词' }
  }

  // ── 第1层：内存缓存 ──
  const cacheKey = `news:search:${keyword}:${pageNum}`
  const cached = cache.get(cacheKey)
  if (cached) {
    console.log('[searchNews] L1 内存缓存命中')
    return { code: 0, data: cached, meta: { source: 'memory_cache' } }
  }

  // ── 第2层：云数据库全量拉取 + 过滤搜索（主力）──
  const dbResult = await searchFromDb(keyword, pageNum, pageSize)
  if (dbResult && dbResult.list.length > 0) {
    console.log(`[searchNews] L2 DB 搜索命中，返回 ${dbResult.list.length} 条 (共 ${dbResult.total} 条)`)
    cache.set(cacheKey, dbResult, { ttl: config.cache.searchTTL })
    return { code: 0, data: dbResult, meta: { source: 'db_cache' } }
  }

  // ── 第3层：AI 静态缓存全文搜索（兜底）──
  const aiResult = aiNews.search(keyword, pageNum, pageSize)
  if (aiResult.list.length > 0) {
    console.log(`[searchNews] L3 AI 静态缓存命中，返回 ${aiResult.list.length} 条`)
    cache.set(cacheKey, aiResult, { ttl: config.cache.searchTTL })
    return { code: 0, data: aiResult, meta: { source: 'ai_cache' } }
  }

  // ── 第4层：外部 API 搜索（可选）──
  console.log('[searchNews] 前三层无匹配，尝试外部 API')

  try {
    const apiResult = await searchViaTianApi(keyword, pageNum, pageSize)
    cache.set(cacheKey, apiResult, { ttl: config.cache.searchTTL })
    console.log(`[searchNews] L4 天行 API 搜索成功，返回 ${apiResult.list.length} 条`)
    return { code: 0, data: apiResult, meta: { source: 'tian_api' } }

  } catch (apiErr) {
    console.warn('[searchNews] 外部 API 搜索也失败:', apiErr.message)
    return {
      code: 0,
      data: { list: [], total: 0 },
      meta: { source: 'no_match' },
    }
  }
}
