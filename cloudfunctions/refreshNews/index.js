// 新闻自动刷新云函数 v5.0 — 天行 API 轻量列表缓存
// ============================================================
// v5.0 改造（2026-08-03）：
//   背景：微信云函数默认超时 3 秒，智谱/DeepSeek AI 调用需要 45s+，无法完成。
//   方案二：只缓存标题列表（标题+摘要+封面+原文链接），不抓正文。
//         详情页用户点击时再单独请求 getNewsDetail 抓取正文并清洗。
//   回滚标记：git tag v3-ai-dual-engine — 可随时切回 AI 双引擎方案。
//
// 数据源：天行数据 API（多分类接口）
// 写入集合：news_cache（列表）+ news（详情占位，content 为空，由 getNewsDetail 补写）
//
// 触发方式：
//   1. 定时触发器（每小时：0 * * * *）
//   2. 小程序手动调用（下拉刷新）
// ============================================================

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const config = require('./config')
const { fetchAllCategories } = require('./sources/tianxing')
const { validateAndClean } = require('./validator')
const { SecurityCheck } = require('./securityCheck')

// ─── 分类列表（天行支持的分类）───
const CATEGORIES = ['recommend', 'tech', 'sports', 'international', 'life', 'finance', 'entertainment']

// ─── 数据库操作 ─────────────────────────────────────

/**
 * 清除指定分类的旧缓存，但保留指定的 id 列表
 */
async function clearOldCacheExcept(category, keepIds) {
  try {
    const res = await db.collection('news_cache')
      .where({
        category,
        id: db.command.nin(keepIds),
      })
      .remove()
    return res.stats?.removed || 0
  } catch (err) {
    console.warn(`[refreshNews] 清除 ${category} 旧缓存失败:`, err.message)
    return 0
  }
}

/**
 * 批量写入新闻到云数据库（news_cache + news 双集合）
 * v5.0：content 留空，由 getNewsDetail 按需补写
 */
async function batchInsert(newsList) {
  const now = Date.now()
  const expireAt = now + config.cache.dbCacheTTL
  let inserted = 0
  let failed = 0

  for (const item of newsList) {
    try {
      // 1. 写入 news_cache（列表数据源 — 不含正文）
      await db.collection('news_cache').add({
        data: {
          id: item.id,
          title: item.title,
          summary: item.summary,
          content: '',  // v5.0：列表不存正文，由详情页按需抓取
          category: item.category,
          categoryName: item.categoryName,
          source: item.source,
          sourceUrl: item.sourceUrl || '',
          publishTime: item.publishTime,
          picUrl: item.picUrl || '',
          cacheExpire: expireAt,
          createdAt: now,
        },
      })

      // 2. 同步写入 news（详情占位 — content 为空，getNewsDetail 会补写）
      const exist = await db.collection('news').where({ id: item.id }).get()
      const doc = {
        id: item.id,
        title: item.title || '',
        summary: item.summary || '',
        content: '',  // v5.0：占位，getNewsDetail 抓取后补写
        category: item.category || 'recommend',
        categoryName: item.categoryName || '',
        source: item.source || '',
        sourceUrl: item.sourceUrl || '',
        picUrl: item.picUrl || '',
        publishTime: item.publishTime || '',
        updatedAt: now,
      }
      if (exist.data && exist.data.length > 0) {
        const existing = exist.data[0]
        if (existing.isRetained) {
          inserted++
          continue
        }
        await db.collection('news').doc(existing._id).update({ data: doc })
      } else {
        await db.collection('news').add({
          data: { ...doc, viewCount: 0, isRetained: false, createdAt: now },
        })
      }

      inserted++
    } catch (err) {
      if (err.errCode === -1) continue // 重复 ID 跳过
      failed++
      console.warn(`[refreshNews] 写入失败 [${item.id}]:`, err.message)
    }
  }

  return { inserted, failed }
}

// ─── 主函数 ─────────────────────────────────────────

exports.main = async (event) => {
  const startTime = Date.now()
  console.log('[refreshNews] ========== 开始刷新新闻缓存 (v5.0 天行API) ==========')

  // ── 手动触发冷却 ──
  const isManual = event && (event.source === 'manual' || event.trigger === 'manual')
  if (isManual) {
    try {
      const cooldownMs = config.rateLimit.manualCooldownMs || 10 * 60 * 1000
      const kvRes = await db.collection('system_kv').where({ key: 'ratelimit:lastRefresh' }).get()
      const lastRefresh = (kvRes.data && kvRes.data.length > 0 && kvRes.data[0].value)
        ? kvRes.data[0].value.lastRefreshAt || 0
        : 0
      const elapsed = Date.now() - lastRefresh
      if (elapsed < cooldownMs) {
        const remainSec = Math.ceil((cooldownMs - elapsed) / 1000)
        console.log(`[refreshNews] 手动触发冷却中，需等待 ${remainSec}s`)
        return {
          code: 0,
          message: `冷却中，请 ${remainSec} 秒后再刷新`,
          data: { skipped: true, cooldownRemainSec: remainSec },
        }
      }
    } catch (err) {
      console.warn('[refreshNews] 读取冷却时间失败，放行:', err.message)
    }
  }

  // ── 检查天行 API Key ──
  if (!config.tian.apiKey) {
    console.error('[refreshNews] TIAN_API_KEY 未配置！请在云函数环境变量中设置')
    return {
      code: -1,
      message: '天行 API Key 未配置，请设置 TIAN_API_KEY 环境变量',
      errorCode: 'API_KEY_INVALID',
    }
  }

  // 1. 调用天行 API 拉取所有分类列表（串行，3 秒内完成）
  let searchResult
  try {
    searchResult = await fetchAllCategories(CATEGORIES, 10)
  } catch (err) {
    console.error('[refreshNews] 天行 API 拉取失败:', err.message)
    return {
      code: -1,
      message: `新闻拉取失败: ${err.message}`,
      errorCode: 'API_NETWORK',
    }
  }

  console.log(`[refreshNews] 天行拉取完成: ${searchResult.news.length} 条`)
  console.log(`[refreshNews] 分类统计:`, JSON.stringify(searchResult.stats))

  if (searchResult.news.length === 0) {
    console.warn('[refreshNews] ⚠️ 天行 API 返回 0 条新闻，保留旧缓存')
    return {
      code: 0,
      message: '天行 API 未返回新闻，保留旧缓存',
      data: { total: 0, inserted: 0, retained: true, stats: searchResult.stats },
    }
  }

  // 2. 质量校验 + 去重
  const { valid, rejected, stats: validationStats } = validateAndClean(searchResult.news)
  console.log(`[refreshNews] 校验: ${validationStats.passed} 通过, ${validationStats.rejected} 拒绝, ${validationStats.duplicatesRemoved} 去重`)

  if (rejected.length > 0) {
    console.warn('[refreshNews] 拒绝详情:', JSON.stringify(rejected.slice(0, 3)))
  }

  // 3. 内容安全审核
  const security = new SecurityCheck()
  const secResult = await security.checkBatch(valid)
  const { passed: secPassed, blocked: secBlocked, stats: securityStats } = secResult

  console.log(`[refreshNews] 安全审核: ${secPassed.length} 通过, ${secBlocked.length} 拦截`)

  // 4. 有效新闻太少 → 保留旧缓存
  if (secPassed.length < 5) {
    console.warn(`[refreshNews] ⚠️ 有效新闻仅 ${secPassed.length} 条，保留旧缓存`)
    return {
      code: 0,
      message: `有效新闻不足(${secPassed.length}条)，保留旧缓存`,
      data: {
        total: valid.length,
        securityPassed: secPassed.length,
        securityBlocked: secBlocked.length,
        inserted: 0,
        retained: true,
        searchStats: searchResult.stats,
        validation: validationStats,
        security: securityStats,
      },
    }
  }

  // 5. 按分类分组写入
  const categories = {}
  secPassed.forEach(item => {
    const cat = item.category || 'unknown'
    if (!categories[cat]) categories[cat] = []
    categories[cat].push(item)
  })

  let totalInserted = 0
  let totalFailed = 0
  let totalCleared = 0

  for (const [category, items] of Object.entries(categories)) {
    const { inserted, failed } = await batchInsert(items)
    totalInserted += inserted
    totalFailed += failed

    if (inserted > 0) {
      const newIds = items.map(it => it.id)
      const cleared = await clearOldCacheExcept(category, newIds)
      totalCleared += cleared
    }

    console.log(`[refreshNews] ${category}: 写入 ${inserted} (失败 ${failed}) → 清理旧数据 ${totalCleared}`)
  }

  const elapsed = Date.now() - startTime

  // ── 写入刷新时间戳 ──
  try {
    await db.collection('system_kv').where({ key: 'ratelimit:lastRefresh' }).get().then(async res => {
      const now = Date.now()
      if (res.data && res.data.length > 0) {
        await db.collection('system_kv').doc(res.data[0]._id).update({
          data: { value: { lastRefreshAt: now }, updatedAt: now }
        })
      } else {
        await db.collection('system_kv').add({
          data: { key: 'ratelimit:lastRefresh', value: { lastRefreshAt: now }, createdAt: now, updatedAt: now }
        })
      }
    })
  } catch (err) {
    console.warn('[refreshNews] 写入刷新时间戳失败:', err.message)
  }

  // ── 清理过期非保留文档 ──
  let cleanedExpired = 0
  try {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
    const cleanRes = await db.collection('news')
      .where({
        isRetained: db.command.neq(true),
        createdAt: db.command.lt(cutoff),
      })
      .remove()
    cleanedExpired = cleanRes.stats?.removed || 0
    if (cleanedExpired > 0) {
      console.log(`[refreshNews] 清理 ${cleanedExpired} 条过期非保留文档`)
    }
  } catch (err) {
    console.warn('[refreshNews] 清理过期文档失败:', err.message)
  }

  console.log(`[refreshNews] ========== 刷新完成: ${totalInserted} 条, 耗时 ${elapsed}ms ==========`)

  return {
    code: 0,
    message: `刷新完成，共 ${totalInserted} 条新闻`,
    data: {
      total: valid.length,
      securityPassed: secPassed.length,
      securityBlocked: secBlocked.length,
      inserted: totalInserted,
      failed: totalFailed,
      cleared: totalCleared,
      cleanedExpired,
      categories: Object.fromEntries(
        Object.entries(categories).map(([k, v]) => [k, v.length])
      ),
      searchStats: searchResult.stats,
      validation: validationStats,
      security: securityStats,
      elapsedMs: elapsed,
      engine: 'tianxing',
    },
  }
}
