// 新闻自动刷新云函数 v6.6 — 智谱 AI 搜索主力 + 聚合/天行兜底（超时安全版）
// ============================================================
// v6.6 改造（2026-08-05）：
//   数据源优先级：智谱 AI 搜索（主力）→ 聚合 API（备选）→ 天行 API（兜底）
//   超时安全：PER_CATEGORY_COUNT 5→5（对齐聚合量级），智谱 prompt 内联 summary/content，
//   skipFetch + skipAiSummary 双跳，省 ~35s。单次调用预计 ~35s（稳在 60s 内）。
//
// v6.5（已回退，超时 68s+）：
//   三数据源优先级，但 PER_CATEGORY_COUNT=15 导致 75 条 + 全量 AI 摘要 ≈ 90s 超时。
//
// v6.0 改造（2026-08-03）：
//   owner 将 refreshNews 超时从 3s 调至 60s，因此可在此函数内直接抓取正文：
//   拉取列表 → 校验 → 安全审核 → enrich（并行抓正文 + AI 摘要）→ 写 news_cache。
//   详情页 getNewsDetail 命中 content 直接返回，不再每次按需抓取。
//
// v5.9 改造（2026-08-03）：
//   1. 双数据源降级：聚合优先，失败/空 → 天行兜底
//   2. 双数据源均失败 → 保留旧缓存并续期 cacheExpire
//   3. getNewsList 增加 stale 兜底（未过期无数据 → 查历史数据）
//
// v5.0 改造（2026-08-03）：
//   背景：微信云函数默认超时 3 秒，智谱/DeepSeek AI 调用需要 45s+，无法完成。
//   回滚标记：git tag v3-ai-dual-engine / v5-tianxing / v5-juhe
//
// 数据源：智谱 AI 搜索（主）+ 聚合（备）+ 天行（兜底）
// 写入集合：news_cache（列表 + content + AI 摘要）
//
// 触发方式：
//   1. 定时触发器（每小时：0 * * * *）
//   2. 小程序手动调用（下拉刷新）
// ============================================================

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const config = require('./config')
const { enrichNewsList } = require('./utils/contentFetcher')
const { validateAndClean } = require('./validator')
const { SecurityCheck } = require('./securityCheck')

// ─── 分类列表（聚合支持的分类）───
// v7（TL-B11）：移除 v4.2 遗留的 finance/entertainment（前端无 tab、无数据源语义），
// 与 frontend utils/constants.js CATEGORIES 对齐（保留 recommend=头条，喂给 all 视图）。
const CATEGORIES = ['recommend', 'tech', 'sports', 'international', 'life']

// ─── 数据库操作 ─────────────────────────────────────

/**
 * 清除指定分类的旧缓存，但保留指定的 id 列表
 * v7（TL-B12）：不得删除 isRetained === true 的保留记录（无论是否在 keepIds）
 */
async function clearOldCacheExcept(category, keepIds) {
  try {
    const res = await db.collection('news_cache')
      .where({
        category,
        id: db.command.nin(keepIds),
        isRetained: db.command.neq(true), // 保留 retained 记录（RQ-16）
      })
      .remove()
    return res.stats?.removed || 0
  } catch (err) {
    console.warn(`[refreshNews] 清除 ${category} 旧缓存失败:`, err.message)
    return 0
  }
}

/**
 * 分级清理（v7 / TL-B12 / RQ-16 §5.2 E7）
 * 按 cacheExpire 过期清理：普通记录 7 天 / retained 记录 30 天。
 * v6.3(V5-FS-02-②): 修复 .limit().remove() 可能不生效问题 — 改用 .get()→按 _id.remove()
 * 分批 ≤ 100 条/批，单轮 ≤ 2s，避免云函数超时。
 * @returns {Promise<{removedNormal:number, removedRetained:number, durationMs:number}>}
 */
async function gradedCleanup() {
  const now = Date.now()
  const BATCH = 100
  const MAX_MS = 2000
  let removedNormal = 0
  let removedRetained = 0
  const startTime = Date.now()

  // v6.3(V5-FS-02-②): 分批辅助函数 — get IDs → remove by IDs
  // 微信云数据库 .limit().remove() 可能忽略 limit 删除全部匹配文档，
  // 改用 .get() 取 _id 列表再分批 .remove()，确保每批 ≤ BATCH
  async function batchCleanup(where, label) {
    let removed = 0
    while (Date.now() - startTime < MAX_MS) {
      // 先查一批 IDs
      const getRes = await db.collection('news_cache')
        .where(where)
        .field({ _id: true })
        .limit(BATCH)
        .get()
      const ids = (getRes.data || []).map(doc => doc._id)
      if (ids.length === 0) break

      // 按 IDs 精确删除
      const rmRes = await db.collection('news_cache')
        .where({ _id: db.command.in(ids) })
        .remove()
      const n = rmRes.stats?.removed || 0
      removed += n
      if (n < BATCH) break
    }
    return removed
  }

  try {
    // 1. 普通记录（isRetained !== true 且 cacheExpire < now）
    removedNormal = await batchCleanup({
      isRetained: db.command.neq(true),
      cacheExpire: db.command.lt(now),
    }, '普通')

    // 2. retained 记录（isRetained === true 且 cacheExpire < now，即 retainedAt + 30d 已到期）
    removedRetained = await batchCleanup({
      isRetained: true,
      cacheExpire: db.command.lt(now),
    }, 'retained')
  } catch (err) {
    console.warn('[refreshNews] 分级清理异常:', err.message)
  }

  const durationMs = Date.now() - startTime
  console.log(`[refreshNews] 分级清理完成：普通 ${removedNormal} 条 / retained ${removedRetained} 条，耗时 ${durationMs}ms`)
  return { removedNormal, removedRetained, durationMs }
}

/**
 * 续期所有 news_cache 记录的 cacheExpire（v5.9）
 * 当双数据源都拉不到新数据时调用，避免历史数据 TTL 过期后列表空白。
 * v7（TL-B12）：仅续期普通记录（isRetained !== true）；retained 记录保持自身 30 天到期。
 * 云数据库 update 支持多文档匹配批量更新（一次调用更新全部匹配文档）。
 * @returns {Promise<number>} 更新的文档数
 */
async function renewCacheExpire() {
  try {
    const now = Date.now()
    const expireAt = now + config.cache.dbCacheTTL
    // 只续期已过期或即将过期的普通记录（避免每次刷新都全量续期）；retained 记录保持自身到期
    const res = await db.collection('news_cache')
      .where({
        cacheExpire: db.command.lt(expireAt),
        isRetained: db.command.neq(true),
      })
      .update({
        data: { cacheExpire: expireAt, updatedAt: now },
      })
    const renewed = res.stats?.updated || 0
    console.log(`[refreshNews] 续期 ${renewed} 条历史缓存，新 cacheExpire=${expireAt}`)
    return renewed
  } catch (err) {
    console.warn('[refreshNews] 续期历史缓存失败:', err.message)
    return 0
  }
}

/**
 * 分批并行执行 Promise（控制并发，避免触发数据库限流）
 * @param {Array<T>} items
 * @param {function(T): Promise<void>} fn
 * @param {number} batchSize
 */
async function batchParallel(items, fn, batchSize = 10) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    await Promise.all(batch.map(fn))
  }
}

/**
 * 批量写入新闻到 news_cache（仅缓存集合，不再双写 news）
 * v5.7：写入前批量查询已有记录，若已存在高质量 summary（AI 摘要）则复用，不覆盖。
 *       解决：getNewsDetail 生成 AI 摘要后，refreshNews 刷新会用标题兜底覆盖。
 * v5.1：去掉 news 集合写入，只写 news_cache。news 集合由 getNewsDetail 按需写入。
 * 性能：一次批量查询（35 ids）+ 每批 10 条并行写入，约 1.7s（远低于 3s 超时）
 */
async function batchInsert(newsList) {
  const now = Date.now()
  const expireAt = now + config.cache.dbCacheTTL
  let inserted = 0
  let failed = 0

  // 0. 批量查询已有记录（一次 DB 查询，用于复用 AI 摘要 / content）
  const existMap = {}
  try {
    const ids = newsList.map(it => it.id)
    // 分块查询（db.command.in 单次上限约 20-30 个）
    for (let i = 0; i < ids.length; i += 20) {
      const chunk = ids.slice(i, i + 20)
      const res = await db.collection('news_cache').where({ id: db.command.in(chunk) }).get()
      res.data.forEach(doc => { existMap[doc.id] = doc })
    }
  } catch (err) {
    console.warn('[refreshNews] 查询已有记录失败，将不使用复用:', err.message)
  }

  // 只写 news_cache（每批 10 条并行）
  await batchParallel(newsList, async (item) => {
    try {
      const existed = existMap[item.id]
      // v6.1：summary 优先级修正（summarySource 标记来源）
      //   - AI 摘要（'ai'）为第一优先级：新 AI 覆盖旧非 AI；新 AI 覆盖旧 AI（重新生成更佳）
      //   - 非 AI 新值不覆盖已有 AI 摘要
      //   - 双方均非 AI → 保留更长的旧 description（若有）
      let summary = item.summary || ''
      let summarySource = item.summarySource || (!summary || summary === item.title ? 'title' : 'desc')
      if (existed) {
        const newIsAi = summarySource === 'ai'
        const oldSource = existed.summarySource || (existed.summary && existed.summary !== existed.title ? 'desc' : 'title')
        const oldIsAi = oldSource === 'ai'
        const oldHasQuality = existed.summary && existed.summary.length >= 30 && existed.summary !== existed.title

        if (oldIsAi && !newIsAi) {
          // 旧值已是 AI 摘要，新值非 AI → 保留旧 AI
          summary = existed.summary
          summarySource = 'ai'
        } else if (!oldIsAi && !newIsAi) {
          // 双方均非 AI → 保留更长的旧 description（若有）
          if (oldHasQuality && (existed.summary.length > summary.length)) {
            summary = existed.summary
            summarySource = 'desc'
          }
        }
        // 其余情况（新 AI 覆盖旧非 AI / 新 AI 覆盖旧 AI）→ 使用新 AI 摘要
      }

      // v7（TL-B12 / RQ-16 D2）：保留策略
      //   - 若已有记录被标记为 retained，刷新写入时不得覆盖 isRetained/retainedAt，
      //     cacheExpire 改为 retainedAt + 30d（而非普通 7d）。
      //   - 普通记录：cacheExpire = now + 7d（重置 TTL）。
      let isRetained = false
      let retainedAt = null
      let cacheExpire = expireAt
      if (existed && existed.isRetained === true) {
        isRetained = true
        retainedAt = existed.retainedAt || now
        cacheExpire = retainedAt + config.cache.retainedTTL
      }

      const docData = {
        id: item.id,
        title: item.title,
        summary,
        summarySource,        // v6.1：'ai' | 'desc' | 'title'（前端胶囊提示依赖）
        content: item.content || '',   // v6：refreshNews 已直接抓正文
        category: item.category,
        categoryName: item.categoryName,
        source: item.source,
        sourceUrl: item.sourceUrl || '',
        publishTime: item.publishTime,
        picUrl: item.picUrl || '',
        viewCount: 0,
        isRetained,
        retainedAt,
        cacheExpire,
        createdAt: now,
      }

      // v7（TL-B12）：已有记录则 update（保留 _id，避免重复插入相同 id 文档导致数据分叉），
      // 新记录则 add。
      if (existed && existed._id) {
        await db.collection('news_cache').doc(existed._id).update({ data: docData })
      } else {
        await db.collection('news_cache').add({ data: docData })
      }
      inserted++
    } catch (err) {
      if (err.errCode !== -1) {
        failed++
        console.warn(`[refreshNews] news_cache 写入失败 [${item.id}]:`, err.message)
      }
    }
  }, 10)

  return { inserted, failed }
}

// ─── 主函数 ─────────────────────────────────────────

exports.main = async (event) => {
  const startTime = Date.now()
  console.log('[refreshNews] ========== 开始刷新新闻缓存 (v6.6 智谱AI搜索) ==========')

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

  // ── 检查智谱 API Key（v6.6 主力数据源）──
  const zhipuKey = process.env.ZHIPU_API_KEY || config.zhipu?.apiKey || ''
  if (!zhipuKey) {
    console.warn('[refreshNews] ZHIPU_API_KEY 未配置，将跳过智谱搜索，直接使用聚合兜底')
  }

  // 1. 三数据源拉取（v6.6：智谱 AI 搜索优先 → 聚合备选 → 天行兜底）
  let searchResult = null
  let engine = 'juhe'  // 默认（智谱未配置/失败时）
  let zhipuQuota = { zhipuCalls: 0, deepseekCalls: 0 }
  let skipFetch = false
  let skipAiSummary = false

  // 1a. 智谱 AI 搜索（主力，v6.6）
  //     超时安全靠两点：① SEARCH_CONCURRENCY=5 全分类并行→单批而非两批
  //     ② 30s 硬预算兜底：天行兜底流水线需 ~25s（搜索3+enrich19+写入3），
  //        故智谱阶段最多占 30s，保证 30+25 < 60s 不触发 ret=-3
  if (zhipuKey) {
    const { searchAllCategories: zhipuSearchAll } = require('./zhipuSearch')
    const ZHIPU_BUDGET_MS = 30000
    try {
      const zhipuResult = await Promise.race([
        zhipuSearchAll(CATEGORIES, db),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`智谱搜索超时(>${ZHIPU_BUDGET_MS}ms)，降级天行兜底`)), ZHIPU_BUDGET_MS)
        ),
      ])
      zhipuQuota = zhipuResult.quota || zhipuQuota
      const zhipuCats = new Set(zhipuResult.news.map(n => n.category))
      // 覆盖阈值：≥3 个分类才采用智谱（避免"满屏同一分类"的稀薄结果），否则降级天行保覆盖
      if (zhipuResult.news.length >= 5 && zhipuCats.size >= 3) {
        searchResult = { news: zhipuResult.news, stats: zhipuResult.stats }
        engine = 'zhipu'
        skipFetch = true       // 智谱已自带 content（300-500 字正文）
        skipAiSummary = true   // 智谱 prompt 已内联 summary（AI 来源）
        console.log(`[refreshNews] 智谱 AI 搜索完成: ${searchResult.news.length} 条/${zhipuCats.size}分类, 分类统计:`, JSON.stringify(searchResult.stats))
      } else {
        console.warn(`[refreshNews] ⚠️ 智谱覆盖不足（${zhipuResult.news.length}条/${zhipuCats.size}分类），降级聚合/天行保覆盖`)
        searchResult = null    // 清空 → 走 1b/1c 兜底
      }
    } catch (err) {
      console.error('[refreshNews] 智谱 AI 搜索异常/超时:', err.message)
    }
  }

  // 1b. 聚合备选（智谱失败/空/未配置时）
  if (!searchResult || searchResult.news.length === 0) {
    skipFetch = false
    skipAiSummary = false
    const { fetchAllCategories: fetchAllJuhe } = require('./sources/juhe')
    if (!config.juhe.apiKey) {
      console.warn('[refreshNews] JUHE_API_KEY 未配置，跳过聚合')
    } else {
      try {
        searchResult = await fetchAllJuhe(CATEGORIES, 5)
        engine = 'juhe'
        console.log(`[refreshNews] 聚合拉取完成: ${searchResult.news.length} 条, 分类统计:`, JSON.stringify(searchResult.stats))
      } catch (err) {
        console.error('[refreshNews] 聚合 API 拉取异常:', err.message)
        searchResult = null
      }
    }
  }

  // 1c. 天行兜底（聚合也失败/空）
  if (!searchResult || searchResult.news.length === 0) {
    skipFetch = false
    skipAiSummary = false
    const { fetchAllCategories: fetchAllTian } = require('./sources/tianxing')
    console.warn('[refreshNews] ⚠️ 聚合未返回数据，尝试天行兜底')
    try {
      const tianResult = await fetchAllTian(CATEGORIES, 5)
      if (tianResult && tianResult.news.length > 0) {
        searchResult = tianResult
        engine = 'tianxing'
        console.log(`[refreshNews] 天行兜底成功: ${searchResult.news.length} 条, 分类统计:`, JSON.stringify(searchResult.stats))
      } else {
        console.warn('[refreshNews] ⚠️ 天行也未返回数据')
        searchResult = { news: [], stats: {} }
      }
    } catch (err) {
      console.error('[refreshNews] 天行兜底失败:', err.message)
      searchResult = { news: [], stats: {} }
    }
  }

  // 1d. 三数据源都失败 → 保留旧缓存 + 续期（v5.9：避免历史数据 TTL 过期后列表空白）
  if (searchResult.news.length === 0) {
    console.warn('[refreshNews] ⚠️ 智谱+聚合+天行均无数据，保留旧缓存并续期 cacheExpire')
    const renewed = await renewCacheExpire()
    return {
      code: 0,
      message: '智谱+聚合+天行均未返回新闻，保留旧缓存',
      data: {
        total: 0,
        inserted: 0,
        retained: true,
        renewed,
        stats: searchResult.stats,
        engine,
      },
    }
  }

  // 2. 质量校验 + 去重
  const { valid, rejected, stats: validationStats } = validateAndClean(searchResult.news)
  console.log(`[refreshNews] 校验: ${validationStats.passed} 通过, ${validationStats.rejected} 拒绝, ${validationStats.duplicatesRemoved} 去重`)

  if (rejected.length > 0) {
    console.warn('[refreshNews] 拒绝详情:', JSON.stringify(rejected.slice(0, 3)))
  }

  // 3. 内容安全审核
  const security = new SecurityCheck({ enabled: config.security.enabled })
  if (config.security.enabled === false) {
    console.warn('[refreshNews] ⚠️ 内容安全检测已禁用（SECURITY_CHECK_ENABLED=false，个人主体/手动关闭），全部新闻直接放行')
  }
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

  // 4.5 正文抓取 + AI 摘要（v6：60s 超时下直接抓正文写库，详情页免按需抓取）
  //     v6.6：智谱源 skipFetch + skipAiSummary（已自带 content + AI summary），省 ~35s
  //     聚合/天行源照常抓正文 + AI 摘要
  //     并发 8 控制外部 API 压力；单条失败保留原 summary，不影响写入
  const enrichStart = Date.now()
  const enriched = await enrichNewsList(secPassed, 8, skipFetch, skipAiSummary)
  const enrichedCount = enriched.filter(it => it.content && it.content.length > 30).length
  const aiSummaryCount = enriched.filter(it => it.summary && it.summary !== it.title && it.summary.length >= 30).length
  console.log(`[refreshNews] 正文抓取: ${enrichedCount}/${enriched.length} 条, AI 摘要: ${aiSummaryCount} 条, 耗时 ${Date.now() - enrichStart}ms`)
  // 注意：secPassed 是 const 解构变量，不能重新赋值；富化结果用新变量 finalList
  const finalList = enriched

  // 5. 按分类分组写入（v5.1：一次合并写入 + 并行清理，省去 7 次串行循环）
  const categories = {}
  const allItems = []
  finalList.forEach(item => {
    const cat = item.category || 'unknown'
    if (!categories[cat]) categories[cat] = []
    categories[cat].push(item)
    allItems.push(item)
  })

  // 5a. 一次批量写入全部新闻（内部按 10 条一批并行）
  const { inserted: totalInserted, failed: totalFailed } = await batchInsert(allItems)

  // 5b. 并行清理各分类旧缓存（保留新 ids）
  const clearResults = await Promise.all(
    Object.entries(categories).map(async ([category, items]) => {
      if (items.length === 0) return 0
      const newIds = items.map(it => it.id)
      const cleared = await clearOldCacheExcept(category, newIds)
      console.log(`[refreshNews] ${category}: 清理旧数据 ${cleared} 条`)
      return cleared
    })
  )
  const totalCleared = clearResults.reduce((sum, n) => sum + n, 0)

  // 5c. 分级清理（v7 / TL-B12 / RQ-16）：过期普通记录（7d）/ retained 记录（30d）
  const cleanup = await gradedCleanup()

  // 5d. 🆕 TL-B8 备份快照写入（ADR-003 §3.1）：按分类覆盖写入 news_cache_backup
  await backupToCacheBackup(categories)

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

  console.log(`[refreshNews] ========== 刷新完成: ${totalInserted} 条, 耗时 ${elapsed}ms ==========`)

  return {
    code: 0,
    message: `刷新完成，共 ${totalInserted} 条新闻`,
    data: {
      total: valid.length,
      securityPassed: finalList.length,
      securityBlocked: secBlocked.length,
      inserted: totalInserted,
      failed: totalFailed,
      cleared: totalCleared,
      cleanup: {
        removedNormal: cleanup.removedNormal,
        removedRetained: cleanup.removedRetained,
        durationMs: cleanup.durationMs,
      },
      categories: Object.fromEntries(
        Object.entries(categories).map(([k, v]) => [k, v.length])
      ),
      searchStats: searchResult.stats,
      validation: validationStats,
      security: securityStats,
      enrichedCount,
      aiSummaryCount,
      elapsedMs: elapsed,
      engine,
      zhipuQuota,   // v6.6：智谱/DeepSeek 当日调用统计
    },
  }
}

// ── 🆕 TL-B8 备份快照写入（ADR-003 §3.1）────────────────────

// 模块级共享 Promise：保证并发调用只创建一次集合，且所有调用方都等待创建完成后再重试
let _backupCollectionEnsurePromise = null

/**
 * 判断错误是否为「集合不存在」
 */
function isCollectionNotExist(err) {
  const msg = ((err && (err.errMsg || err.message)) || '').toString()
  return msg.includes('collection not exists')
    || msg.includes('DATABASE_COLLECTION_NOT_EXIST')
    || msg.includes('502005')
}

/**
 * 确保 news_cache_backup 集合存在（不存在则自动创建）
 * 使用共享 Promise：并发调用只创建一次，且所有调用方都等待创建完成后再重试
 * 集合已存在或权限不足会抛错，可忽略（非阻塞）
 */
async function ensureBackupCollection() {
  if (!_backupCollectionEnsurePromise) {
    _backupCollectionEnsurePromise = (async () => {
      try {
        await db.createCollection('news_cache_backup')
        console.log('[backupToCacheBackup] 已自动创建 news_cache_backup 集合')
      } catch (err) {
        // 集合已存在（-501001/-501005 等）或权限不足：可忽略
        console.warn('[backupToCacheBackup] 自动创建集合跳过（已存在或无权限）:', err.message)
      }
    })()
  }
  return _backupCollectionEnsurePromise
}

/**
 * 写入单个分类的快照（先删旧备份，再写前 20 条）
 */
async function writeBackupSnapshot(category, docs) {
  // 先删旧备份
  await db.collection('news_cache_backup')
    .where({ category })
    .remove()
  // 取前 20 条写入新快照
  const snapshot = docs.slice(0, 20).map(doc => ({
    id: doc.id,
    title: doc.title,
    summary: doc.summary,
    category: doc.category,
    categoryName: doc.categoryName || '',
    source: doc.source || '',
    sourceUrl: doc.sourceUrl || '',
    publishTime: doc.publishTime,
    content: doc.content || '',
    isRetained: doc.isRetained === true,
    _backupAt: Date.now(),
  }))
  await db.collection('news_cache_backup').add(
    snapshot.length === 1
      ? { data: snapshot[0] }
      : snapshot.map(d => ({ data: d }))
  )
  console.log(`[backupToCacheBackup] ${category}: 备份 ${snapshot.length} 条`)
}

/**
 * 将本次成功写入的新闻按分类覆盖写入 news_cache_backup
 * 每分类保留最多 20 条最新记录，用于 news_cache 为空时的一层兜底
 * 集合不存在时自动创建后重试一次；写入失败不阻塞主流程
 */
async function backupToCacheBackup(categories) {
  const backupPromises = Object.entries(categories).map(async ([category, docs]) => {
    if (!docs || docs.length === 0) return
    try {
      await writeBackupSnapshot(category, docs)
    } catch (err) {
      // 集合不存在 → 自动创建后重试一次
      if (isCollectionNotExist(err)) {
        await ensureBackupCollection()
        try {
          await writeBackupSnapshot(category, docs)
          return
        } catch (retryErr) {
          console.warn(`[backupToCacheBackup] ${category} 重试备份失败（非阻塞）:`, retryErr.message)
          return
        }
      }
      console.warn(`[backupToCacheBackup] ${category} 备份写入失败（非阻塞）:`, err.message)
    }
  })
  await Promise.all(backupPromises)
}
