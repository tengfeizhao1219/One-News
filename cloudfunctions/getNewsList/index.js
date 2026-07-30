// 获取新闻列表云函数 — 天行实时第一优先级
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const cache = require('../common/cache')
const aiNews = require('../common/aiNewsService')
const config = require('../common/config')

// ─── 外部 API 降级（终极兜底）───
const { callTianApi } = require('../common/tianApi')
const { callJuheApi } = require('../common/juheApi')
const { adaptNewsList, APP_TO_TIAN_ENDPOINT, APP_TO_JUHE_TYPE, CATEGORY_NAMES } = require('../common/adapter')

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
  const endpoint = APP_TO_TIAN_ENDPOINT[category] || 'generalnews'
  const fetchSize = Math.max(pageSize, config.pagination.apiFetchSize)
  const apiData = await callTianApi({ endpoint, page: pageNum, num: fetchSize })
  const adapted = adaptNewsList(apiData.list, 'tian', category)
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

// ─── 写入 news 集合（供 getNewsDetail 查询详情）────────────
// 天行免费接口不返回正文全文，仅提供 description（导语）。
// 这里把列表项（含摘要/图片/来源/链接）落地到 news 集合，
// 使 getNewsDetail 能按天行 id 查到数据，避免详情页永远 NO_DATA。
// 采用「先 update 保留 viewCount，文档不存在则 add 创建」的 upsert 策略。
// 注意：doc() 的 id 参数在微信云开发中对应文档 _id 字段，
//       如果传入自定义 id 会创建失败。这里改用 where + update / add。
async function syncNewsToCollection(list) {
  if (!Array.isArray(list) || list.length === 0) return
  console.log('[syncNewsToCollection] 开始，共', list.length, '条')
  const now = Date.now()
  for (const item of list) {
    const itemId = item.id || item._id
    if (!itemId) { console.warn('[syncNewsToCollection] 跳过空 id'); continue }
    const doc = {
      id: itemId,
      title: item.title || '',
      summary: item.summary || '',
      content: item.content || item.summary || '',
      category: item.category || 'recommend',
      categoryName: item.categoryName || '',
      source: item.source || '',
      sourceUrl: item.sourceUrl || '',
      picUrl: item.picUrl || '',
      publishTime: item.publishTime || '',
      updatedAt: now,
    }
    try {
      console.log('[syncNewsToCollection] 查询 where id=', itemId)
      const exist = await db.collection('news').where({ id: itemId }).get()
      console.log('[syncNewsToCollection] 查询结果:', exist.data ? exist.data.length : 0, '条')
      if (exist.data && exist.data.length > 0) {
        const realId = exist.data[0]._id
        console.log('[syncNewsToCollection] 更新 _id=', realId)
        await db.collection('news').doc(realId).update({ data: doc })
        console.log('[syncNewsToCollection] 更新成功')
      } else {
        console.log('[syncNewsToCollection] 新增')
        await db.collection('news').add({ data: { ...doc, viewCount: 0, createdAt: now } })
        console.log('[syncNewsToCollection] 新增成功')
      }
    } catch (e) {
      console.error('[syncNewsToCollection] 写入失败 id=', itemId, e && e.message, e && e.stack)
    }
  }
  console.log('[syncNewsToCollection] 完成')
}

// ─── 主函数 ─────────────────────────────────────────

exports.main = async (event) => {
  const category = event.category || 'all'
  const pageNum = Math.max(1, parseInt(event.pageNum) || 1)
  const pageSize = Math.min(config.pagination.maxPageSize, Math.max(1, parseInt(event.pageSize) || config.pagination.defaultPageSize))

  console.log(`[getNewsList] category=${category} page=${pageNum} size=${pageSize}`)

  // ── L1：天行实时 API（第一优先级，每次直连）──
  try {
    const result = await fetchFromTianApi(category, pageNum, pageSize)
    const responseData = { list: result.list, total: result.total, hasMore: result.hasMore }
    console.log(`[getNewsList] L1 天行 API 成功，返回 ${result.list.length} 条`)
    // 同步落地到 news 集合（写入 ~100ms），供 getNewsDetail 使用
    console.log('[getNewsList] 开始同步写入 news 集合...')
    await syncNewsToCollection(result.list)
    console.log('[getNewsList] news 集合同步写入完成')
    return { code: 0, data: responseData, meta: { source: 'tian_api', synced: true } }

  } catch (tianErr) {
    console.warn('[getNewsList] 天行 API 失败:', tianErr.message)

    // ── L2：内存缓存（天行失败后尝试）──
    const memoryKey = `news:list:${category}:${pageNum}`
    const memoryCached = cache.get(memoryKey)
    if (memoryCached) {
      console.log('[getNewsList] L2 内存缓存命中')
      return { code: 0, data: memoryCached, meta: { source: 'memory_cache' } }
    }

    // ── L3：云数据库缓存（refreshNews 写入，TTL 10min）──
    const dbCached = await getFromDbCache(category, pageNum, pageSize)
    if (dbCached && dbCached.list.length > 0) {
      console.log(`[getNewsList] L3 DB 缓存命中，返回 ${dbCached.list.length} 条`)
      return { code: 0, data: dbCached, meta: { source: 'db_cache' } }
    }

    // ── L4：聚合数据降级（可选，需 JUHE_API_KEY）──
    try {
      const fallbackResult = await fetchFromJuheApi(category, pageNum, pageSize)
      const responseData = { list: fallbackResult.list, total: fallbackResult.total, hasMore: fallbackResult.hasMore }
      console.log(`[getNewsList] L4 聚合 API 降级成功，返回 ${fallbackResult.list.length} 条`)
      return { code: 0, data: responseData, meta: { source: 'juhe_fallback' } }

    } catch (juheErr) {
      console.warn('[getNewsList] 聚合 API 也失败:', juheErr.message)

      // ── L5：AI 静态缓存（终极兜底）──
      const aiResult = aiNews.getByCategory(category, pageNum, pageSize)
      const aiStats = aiNews.getStats()

      if (aiResult.list.length > 0) {
        console.log(`[getNewsList] L5 AI 静态缓存兜底，返回 ${aiResult.list.length} 条`)
        const responseData = { list: aiResult.list, total: aiResult.total, hasMore: aiResult.hasMore }
        return {
          code: 0, data: responseData,
          meta: { source: 'ai_cache', cacheVersion: aiStats.version, cacheGeneratedAt: aiStats.generatedAt },
        }
      }

      // 全部数据源不可用
      console.error('[getNewsList] 所有数据源均不可用')
      return {
        code: -1,
        message: '新闻服务暂时不可用，请稍后重试',
        errorCode: config.errorCodes.ALL_DOWN,
      }
    }
  }
}
