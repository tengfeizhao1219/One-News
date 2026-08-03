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
 * 清除指定分类的旧缓存（旧策略，保留供兼容）
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
 * 清除指定分类的旧缓存，但保留指定的 id 列表（新策略：避免空窗期）
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
    console.warn(`[refreshNews] 清除 ${category} 旧缓存(保留${keepIds.length}条)失败:`, err.message)
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
      // B-16: 先查是否已存在（避免重复 + 保留保护）
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
        // B-16: 若已被收藏/分享引用 → 跳过，不覆盖
        const existing = exist.data[0]
        if (existing.isRetained) {
          console.log(`[refreshNews] 跳过保留文档: ${item.id}`)
          inserted++  // 计为成功（保留即成功）
          continue
        }
        // 更新（保留 viewCount）
        await db.collection('news').doc(existing._id).update({ data: doc })
      } else {
        // 新增（B-16: 默认 isRetained = false）
        await db.collection('news').add({
          data: { ...doc, viewCount: 0, isRetained: false, createdAt: now },
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
  console.log('[refreshNews] ========== 开始刷新新闻缓存 (v4.0 智谱+DeepSeek 双引擎) ==========')

  // ── B-12 策略5: 手动触发冷却（防突发叠加）──
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
        console.log(`[refreshNews] 手动触发冷却中，距上次刷新 ${Math.round(elapsed / 1000)}s，需等待 ${remainSec}s`)
        return {
          code: 0,
          message: `冷却中，请 ${remainSec} 秒后再刷新`,
          data: { skipped: true, cooldownRemainSec: remainSec },
        }
      }
    } catch (err) {
      console.warn('[refreshNews] 读取冷却时间失败，放行:', err.message)
      // 读失败时保守放行
    }
  }

  // 1. 调用大模型联网搜索所有分类（B-12: 传入 db 用于配额读写）
  let searchResult
  try {
    searchResult = await searchAllCategories(null, db)
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

  // 4. 如果有效新闻太少，先不要清空旧缓存，避免空窗期
  if (secPassed.length < 5) {
    console.warn(`[refreshNews] ⚠️ 有效新闻仅 ${secPassed.length} 条（安全审核后），保留旧缓存不刷新`)
    return {
      code: 0,
      message: `有效新闻不足(${secPassed.length}条)，保留旧缓存`,
      data: {
        total: valid.length,
        securityPassed: secPassed.length,
        securityBlocked: secBlocked.length,
        inserted: 0,
        failed: 0,
        cleared: 0,
        retained: true,
        searchStats: searchResult.stats,
        validation: validationStats,
        security: securityStats,
        quota: searchResult.quota || { zhipuCalls: 0, deepseekCalls: 0, deepseekCap: config.rateLimit.deepseekDailyCap },
      },
    }
  }

  // 5. 按分类分组写入（新策略：先写入新数据，成功后再清空旧缓存，避免空窗期）
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
    // 5.1 先写入新数据到临时位置（news_cache 直接用新数据覆盖，但先不清空，写失败还有旧数据）
    const { inserted, failed } = await batchInsert(items)
    totalInserted += inserted
    totalFailed += failed

    // 5.2 新数据写入成功后，再清理该分类下除本次写入 id 外的过期旧数据
    if (inserted > 0) {
      const newIds = items.map(it => it.id)
      const cleared = await clearOldCacheExcept(category, newIds)
      totalCleared += cleared
    }

    console.log(`[refreshNews] ${category}: 写入 ${inserted} (失败 ${failed}) → 清理旧数据 ${totalCleared}`)
  }

  const elapsed = Date.now() - startTime

  // ── B-12 策略5: 写入本次刷新时间戳（供下次冷却判断）──
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

  // ── B-16: 清理 30 天前的非保留文档（防 news 集合无限膨胀）──
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
      console.log(`[refreshNews] 清理 ${cleanedExpired} 条过期非保留文档（30天前）`)
    }
  } catch (err) {
    console.warn('[refreshNews] 清理过期文档失败:', err.message)
  }

  // 6. 返回结果（B-12: 追加 quota；B-16: 追加 cleanedExpired）
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
      quota: searchResult.quota || { zhipuCalls: 0, deepseekCalls: 0, deepseekCap: config.rateLimit.deepseekDailyCap },
      elapsedMs: elapsed,
    },
  }
}
