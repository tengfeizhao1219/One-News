// 新闻自动刷新云函数 v3
// 调用阿里百炼 DeepSeek 联网搜索 → 质量校验 → 写入云数据库
//
// 触发方式：
//   1. 定时触发器（6:00 / 11:00 / 20:00）
//   2. 小程序手动调用（用户点击刷新按钮）

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const { searchAllCategories } = require('../common/llmSearch')
const { validateAndClean } = require('../common/validator')
const config = require('../common/config')

// ─── 数据库操作 ─────────────────────────────────────

/**
 * 清除指定分类的旧缓存
 */
async function clearOldCache(category) {
  try {
    const res = await db.collection('news_cache')
      .where({ category })
      .remove()
    return res.stats?.removed || 0
  } catch (err) {
    console.warn(`[refreshNews] 清除 ${category} 旧缓存失败:`, err.message)
    return 0
  }
}

/**
 * 批量写入新闻到云数据库
 */
async function batchInsert(newsList) {
  const now = Date.now()
  const expireAt = now + config.cache.dbCacheTTL
  let inserted = 0
  let failed = 0

  for (const item of newsList) {
    try {
      await db.collection('news_cache').add({
        data: {
          id: item.id,
          title: item.title,
          summary: item.summary,
          category: item.category,
          categoryName: item.categoryName,
          source: item.source,
          sourceUrl: item.sourceUrl || '',
          publishTime: item.publishTime,
          cacheExpire: expireAt,
          createdAt: now,
        },
      })
      inserted++
    } catch (err) {
      if (err.errCode === -1) {
        // 重复 ID，跳过
        continue
      }
      failed++
      console.warn(`[refreshNews] 写入失败 [${item.id}]:`, err.message)
    }
  }

  return { inserted, failed }
}

// ─── 主函数 ─────────────────────────────────────────

exports.main = async (event) => {
  const startTime = Date.now()
  console.log('[refreshNews] ========== 开始刷新新闻缓存 (v3 大模型搜索) ==========')

  // 1. 调用大模型联网搜索所有分类
  let searchResult
  try {
    searchResult = await searchAllCategories()
  } catch (err) {
    console.error('[refreshNews] 大模型搜索失败:', err.message)
    return {
      code: -1,
      message: `新闻搜索失败: ${err.message}`,
      errorCode: 'LLM_SEARCH_FAILED',
    }
  }

  console.log(`[refreshNews] 搜索完成: ${searchResult.news.length} 条原始结果`)
  console.log(`[refreshNews] 分类统计:`, JSON.stringify(searchResult.stats))

  // 2. 质量校验 + 去重
  const { valid, rejected, stats: validationStats } = validateAndClean(searchResult.news)

  console.log(`[refreshNews] 校验结果: ${validationStats.passed} 通过, ${validationStats.rejected} 拒绝, ${validationStats.duplicatesRemoved} 去重`)

  if (rejected.length > 0) {
    console.warn('[refreshNews] 拒绝详情:', JSON.stringify(rejected.slice(0, 5)))
  }

  // 3. 如果有效新闻太少，记录警告但继续
  if (valid.length < 5) {
    console.warn(`[refreshNews] ⚠️ 有效新闻仅 ${valid.length} 条，可能影响用户体验`)
  }

  // 4. 按分类分组写入
  const categories = {}
  valid.forEach(item => {
    const cat = item.category || 'unknown'
    if (!categories[cat]) categories[cat] = []
    categories[cat].push(item)
  })

  let totalInserted = 0
  let totalFailed = 0
  let totalCleared = 0

  for (const [category, items] of Object.entries(categories)) {
    const cleared = await clearOldCache(category)
    totalCleared += cleared

    const { inserted, failed } = await batchInsert(items)
    totalInserted += inserted
    totalFailed += failed

    console.log(`[refreshNews] ${category}: 清除 ${cleared} → 写入 ${inserted} (失败 ${failed})`)
  }

  const elapsed = Date.now() - startTime

  // 5. 返回结果
  return {
    code: 0,
    message: `刷新完成，共 ${totalInserted} 条新闻`,
    data: {
      total: valid.length,
      inserted: totalInserted,
      failed: totalFailed,
      cleared: totalCleared,
      categories: Object.fromEntries(
        Object.entries(categories).map(([k, v]) => [k, v.length])
      ),
      searchStats: searchResult.stats,
      validation: validationStats,
      elapsedMs: elapsed,
    },
  }
}
