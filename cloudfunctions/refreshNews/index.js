// 新闻自动刷新云函数 v4.0 — 智谱+DeepSeek 双引擎
// 智谱 GLM-4-Flash 联网搜索(主力) → DeepSeek API(降级) → 质量校验 → 内容安全审核 → 写入 news_cache
// B-02: 接入微信 msgSecCheck（命中拦截 + API 不可用保守放行 + 告警）
//
// 触发方式：
//   1. 定时触发器（每小时：0 * * * *）
//   2. 小程序手动调用（用户点击刷新按钮）
//
// v4.0 改造：百炼→智谱+DeepSeek 双引擎，每分类 15 条，每小时刷新

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const { searchAllCategories } = require('./zhipuSearch')
const { validateAndClean } = require('./validator')
const { SecurityCheck } = require('./securityCheck')
const config = require('./config')

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
 * 批量写入新闻到云数据库（news_cache + news 双集合）
 * news_cache：供 getNewsList 列表查询
 * news：供 getNewsDetail 详情查询
 */
async function batchInsert(newsList) {
  const now = Date.now()
  const expireAt = now + config.cache.dbCacheTTL
  let inserted = 0
  let failed = 0

  for (const item of newsList) {
    try {
      // 1. 写入 news_cache（列表数据源）
      await db.collection('news_cache').add({
        data: {
          id: item.id,
          title: item.title,
          summary: item.summary,
          content: item.content || '',  // 🆕 L4 详情正文（大模型已生成）
          category: item.category,
          categoryName: item.categoryName,
          source: item.source,
          sourceUrl: item.sourceUrl || '',
          publishTime: item.publishTime,
          cacheExpire: expireAt,
          createdAt: now,
        },
      })

      // 2. 🆕 同步写入 news（详情数据源）
      // 先查是否已存在（避免重复）
      const exist = await db.collection('news').where({ id: item.id }).get()
      const doc = {
        id: item.id,
        title: item.title || '',
        summary: item.summary || '',
        content: item.content || item.summary || '',  // 🆕 优先用大模型生成的完整正文
        category: item.category || 'recommend',
        categoryName: item.categoryName || '',
        source: item.source || '',
        sourceUrl: item.sourceUrl || '',
        picUrl: item.picUrl || '',
        publishTime: item.publishTime || '',
        updatedAt: now,
      }
      if (exist.data && exist.data.length > 0) {
        // 更新（保留 viewCount）
        await db.collection('news').doc(exist.data[0]._id).update({ data: doc })
      } else {
        // 新增
        await db.collection('news').add({
          data: { ...doc, viewCount: 0, createdAt: now },
        })
      }

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

  // 3. 内容安全审核（B-02：微信 msgSecCheck，命中拦截 + API 不可用保守放行）
  const security = new SecurityCheck()
  const secResult = await security.checkBatch(valid)
  const { passed: secPassed, blocked: secBlocked, stats: securityStats } = secResult

  console.log(`[refreshNews] 安全审核: ${secPassed.length} 通过, ${secBlocked.length} 拦截`)
  if (secBlocked.length > 0) {
    console.warn('[refreshNews] 拦截详情:', JSON.stringify(secBlocked.map(b => ({ id: b.id, title: b.title?.slice(0, 40) }))))
  }

  // 4. 如果有效新闻太少，记录警告但继续
  if (secPassed.length < 5) {
    console.warn(`[refreshNews] ⚠️ 有效新闻仅 ${secPassed.length} 条（安全审核后），可能影响用户体验`)
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
    const cleared = await clearOldCache(category)
    totalCleared += cleared

    const { inserted, failed } = await batchInsert(items)
    totalInserted += inserted
    totalFailed += failed

    console.log(`[refreshNews] ${category}: 清除 ${cleared} → 写入 ${inserted} (失败 ${failed})`)
  }

  const elapsed = Date.now() - startTime

  // 6. 返回结果
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
      categories: Object.fromEntries(
        Object.entries(categories).map(([k, v]) => [k, v.length])
      ),
      searchStats: searchResult.stats,
      validation: validationStats,
      security: securityStats,
      elapsedMs: elapsed,
    },
  }
}
