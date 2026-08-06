// 新闻自动刷新云函数 v7 — 拆分架构（按分类并行云函数，彻底绕开 60s 限制）
// ============================================================
// v7 改造（2026-08-05）：拆分云函数架构
//   将"全分类在单次 60s 调用内串行完成"改为"每个分类独立占用一次 60s 调用、5 个并行"。
//   实现方式：refreshNews 自扇出（self-fan-out）—— 同一函数既是"编排器"也是"单分类工人"，
//   通过 event.category 区分：
//     - 编排模式（event 无 category）：手动冷却 → 并行 cloud.callFunction 自调 5 次
//       （每分类一次）→ 全局 gradedCleanup → 全空续期 → 写刷新时间戳 → 聚合返回。
//     - 工人模式（event.category 存在）：执行该分类完整流水线并返回统计。
//   收益：
//     ① 每个分类独占 60s，单分类智谱超时从 30s 放开回 50s，AI 覆盖更全；
//     ② 故障隔离 + 按分类降级：某分类智谱/DeepSeek 失败只该分类降级聚合/天行，不连累其他；
//     ③ 并行墙钟 ≈ 最慢单分类（而非 5 倍求和）。
//   对调用方零改动：前端 wx.cloud.callFunction({name:'refreshNews', data:{}}) 与定时器空参触发，
//   编排器仍返回 {code, data:{inserted,...}}。
//
// v6.6（已并入）：智谱 AI 搜索主力 + 聚合/天行兜底；PER_CATEGORY_COUNT=5；skipFetch+skipAiSummary 双跳。
// v6.0（已并入）：owner 将 refreshNews 超时从 3s 调至 60s，函数内直接抓取正文 + AI 摘要。
// v5.9（已并入）：双数据源降级 + 续期；getNewsList stale 兜底。
//
// 数据源：智谱 AI 搜索（主）+ DeepSeek（智谱降级）+ 聚合 API（备）+ 天行 API（兜底）
// 写入集合：news_cache（列表 + content + AI 摘要）
//
// 触发方式：
//   1. 定时触发器（每小时：0 0 * * * *）
//   2. 小程序手动调用（下拉刷新，data:{}）
//   3. 自扇出工人调用（data:{category, shard:true, quotaBaseline}）
// ============================================================

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const config = require('./config')
const { enrichNewsList } = require('./utils/contentFetcher')
const { validateAndClean } = require('./validator')
const { SecurityCheck } = require('./securityCheck')

// ─── 分类列表（聚合支持的分类）───
// v7（TL-B11）：与 frontend utils/constants.js CATEGORIES 对齐（保留 recommend=头条，喂给 all 视图）。
const CATEGORIES = ['recommend', 'tech', 'sports', 'international', 'life']

// 单分类流水线写库阈值：通过校验+安全审核的有效条数 ≥ 此值才覆盖该分类旧缓存；
// 否则视为该分类本次刷新偏弱，保留旧缓存（不清旧、不写入），不影响其他分类。
const MIN_PER_CATEGORY = 3

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

// ─── 单分类流水线（v7 工人模式核心）────────────────────
// 执行单个分类的完整流程：搜索（按分类降级）→ 校验 → 安全 → enrich → 写库 → 清理 → 备份
// @param {string} category - 分类 ID
// @param {object} quotaBaseline - 编排器传入的当日配额基线 {zhipuCalls, deepseekCalls}
// @returns {Promise<object>} 该分类统计 {category, inserted, engine, skipped, quotaDelta, elapsedMs}
async function runCategoryPipeline(category, quotaBaseline) {
  const catStart = Date.now()
  const baseZ = (quotaBaseline && quotaBaseline.zhipuCalls) || 0
  const baseD = (quotaBaseline && quotaBaseline.deepseekCalls) || 0
  const quotaRef = { zhipuCalls: baseZ, deepseekCalls: baseD }

  // 1. 搜索（按分类降级：智谱/DeepSeek → 聚合 → 天行）
  let news = []
  let engine = 'none'
  let skipFetch = false
  let skipAiSummary = false

  // DG-03：任一 AI 搜索 key（智谱/通义）即可进搜索分支（内部含三级降级：智谱→Qwen→DeepSeek）
  const aiKey = process.env.ZHIPU_API_KEY || config.zhipu?.apiKey || process.env.DASHSCOPE_API_KEY || config.qwen?.apiKey || ''
  if (aiKey) {
    const { searchNewsByCategory } = require('./zhipuSearch')
    try {
      const r = await searchNewsByCategory(category, db, quotaRef)
      if (r.news && r.news.length > 0) {
        news = r.news
        engine = r.engine // 'zhipu' | 'qwen' | 'deepseek'
        skipFetch = true       // AI 源已自带 content（500-800 字正文）
        skipAiSummary = true   // 已内联 summary（AI 来源）
        console.log(`[refreshNews][${category}] AI 搜索命中: ${news.length} 条 (engine=${engine})`)
      } else {
        console.warn(`[refreshNews][${category}] AI 搜索无结果，降级聚合/天行`)
      }
    } catch (err) {
      console.error(`[refreshNews][${category}] 智谱搜索异常:`, err.message)
    }
  }

  // 1b. 聚合兜底（智谱/DeepSeek 空/未配置/失败）
  if (news.length === 0) {
    skipFetch = false
    skipAiSummary = false
    const { fetchAllCategories: fetchAllJuhe } = require('./sources/juhe')
    if (!config.juhe.apiKey) {
      console.warn(`[refreshNews][${category}] JUHE_API_KEY 未配置，跳过聚合`)
    } else {
      try {
        const r = await fetchAllJuhe([category], 5)
        if (r.news && r.news.length > 0) {
          news = r.news
          engine = 'juhe'
          console.log(`[refreshNews][${category}] 聚合兜底: ${news.length} 条`)
        }
      } catch (err) {
        console.error(`[refreshNews][${category}] 聚合失败:`, err.message)
      }
    }
  }

  // 1c. 天行兜底（聚合也失败/空）
  if (news.length === 0) {
    skipFetch = false
    skipAiSummary = false
    const { fetchAllCategories: fetchAllTian } = require('./sources/tianxing')
    if (!config.tian.apiKey) {
      console.warn(`[refreshNews][${category}] TIAN_API_KEY 未配置，跳过天行`)
    } else {
      try {
        const r = await fetchAllTian([category], 5)
        if (r.news && r.news.length > 0) {
          news = r.news
          engine = 'tianxing'
          console.log(`[refreshNews][${category}] 天行兜底: ${news.length} 条`)
        }
      } catch (err) {
        console.error(`[refreshNews][${category}] 天行失败:`, err.message)
      }
    }
  }

  // 1d. 三源全失败 → 保留旧缓存（不清理、不写入）
  if (news.length === 0) {
    console.warn(`[refreshNews][${category}] 智谱+聚合+天行均无数据，保留旧缓存`)
    return {
      category,
      inserted: 0,
      skipped: true,
      engine: 'none',
      quotaDelta: { zhipuCalls: quotaRef.zhipuCalls - baseZ, deepseekCalls: quotaRef.deepseekCalls - baseD },
      elapsedMs: Date.now() - catStart,
    }
  }

  // 2. 质量校验 + 去重
  const { valid, rejected, stats: validationStats } = validateAndClean(news)
  console.log(`[refreshNews][${category}] 校验: ${validationStats.passed} 通过, ${validationStats.rejected} 拒绝, ${validationStats.duplicatesRemoved} 去重`)

  // 3. 内容安全审核
  const security = new SecurityCheck({ enabled: config.security.enabled })
  if (config.security.enabled === false) {
    console.warn(`[refreshNews][${category}] ⚠️ 内容安全检测已禁用，全部新闻直接放行`)
  }
  const secResult = await security.checkBatch(valid)
  const { passed: secPassed, blocked: secBlocked } = secResult
  console.log(`[refreshNews][${category}] 安全审核: ${secPassed.length} 通过, ${secBlocked.length} 拦截`)

  // 4. 有效新闻过少 → 保留旧缓存（不清旧，避免把分类清空/降级为少量低质内容）
  if (secPassed.length < MIN_PER_CATEGORY) {
    console.warn(`[refreshNews][${category}] ⚠️ 有效新闻仅 ${secPassed.length} 条(<${MIN_PER_CATEGORY})，保留旧缓存`)
    return {
      category,
      inserted: 0,
      skipped: true,
      engine,
      quotaDelta: { zhipuCalls: quotaRef.zhipuCalls - baseZ, deepseekCalls: quotaRef.deepseekCalls - baseD },
      elapsedMs: Date.now() - catStart,
    }
  }

  // 5. 正文抓取 + AI 摘要（智谱/DeepSeek 源 skipFetch + skipAiSummary；聚合/天行源照常抓+摘要）
  // P0-2：enrich 硬期限 = catStart + 55s（保留 5s 给 DB 写入/清理）——search 吃预算后 enrich
  // 不再按 12s/条串行顶爆 60s；预算不足自动跳过 AI 摘要保正文（详情页缓存命中依赖 content）。
  const enrichStart = Date.now()
  const enrichDeadline = catStart + 55000
  const enriched = await enrichNewsList(secPassed, 8, skipFetch, skipAiSummary, enrichDeadline)
  const enrichedCount = enriched.filter(it => it.content && it.content.length > 30).length
  const aiSummaryCount = enriched.filter(it => it.summary && it.summary !== it.title && it.summary.length >= 30).length
  console.log(`[refreshNews][${category}] 正文抓取: ${enrichedCount}/${enriched.length} 条, AI 摘要: ${aiSummaryCount} 条, 耗时 ${Date.now() - enrichStart}ms`)

  // 6. 按分类写入 news_cache
  const { inserted, failed } = await batchInsert(enriched)

  // 7. 清理该分类旧缓存（保留新 ids）
  const newIds = enriched.map(it => it.id)
  const cleared = await clearOldCacheExcept(category, newIds)
  console.log(`[refreshNews][${category}]: 清理旧数据 ${cleared} 条`)

  // 8. 备份快照
  await backupToCacheBackup({ [category]: enriched })

  const elapsedMs = Date.now() - catStart
  console.log(`[refreshNews][${category}] ===== 完成: 写入 ${inserted} 条, 耗时 ${elapsedMs}ms =====`)

  return {
    category,
    inserted,
    failed,
    count: enriched.length,
    engine,
    skipped: false,
    quotaDelta: { zhipuCalls: quotaRef.zhipuCalls - baseZ, deepseekCalls: quotaRef.deepseekCalls - baseD },
    elapsedMs,
  }
}

// ─── 主函数（v7：编排 / 工人 双模式）─────────────────

exports.main = async (event) => {
  const startTime = Date.now()

  // ── B-13: 数据源可用性显式短路（百炼 Key 搁置期保护）──
  // 检测当前可用数据源：智谱（主力）→ 聚合 → 天行。
  // 若三者均未配置 Key（仅剩旧版百炼 DASHSCOPE_API_KEY 等搁置配置），
  // 直接快速返回，避免每次刷新白跑三源检查 + 浪费配额查询与日志。
  // 覆盖 编排模式 与 工人模式（单分类）两种入口。
  // ⚠️ 注意（历史裁定 2026-08-02）：DeepSeek 不单独作为可用源——
  //    它仅作智谱的降级（index.js 298 行 zhipuKey 为空则整个智谱分支跳过），
  //    单独配置 DEEPSEEK_API_KEY 无法产出数据，故不纳入检测（防旧 B-13 误伤双引擎）。
  const availableSources = []
  if (process.env.ZHIPU_API_KEY || config.zhipu?.apiKey) availableSources.push('zhipu')
  if (process.env.DASHSCOPE_API_KEY || config.qwen?.apiKey) availableSources.push('qwen')  // DG-03
  if (config.juhe.apiKey) availableSources.push('juhe')
  if (config.tian.apiKey) availableSources.push('tianxing')
  if (availableSources.length === 0) {
    const hint = process.env.DASHSCOPE_API_KEY
      ? '（检测到已搁置的百炼 DASHSCOPE_API_KEY，当前数据源已切换智谱，请配置 ZHIPU_API_KEY / JUHE_API_KEY / TIAN_API_KEY）'
      : ''
    console.warn(`[refreshNews] 无可用的新闻数据源（ZHIPU/JUHE/TIAN 均未配置）${hint}，显式短路跳过刷新`)
    return {
      code: 0,
      message: '无可用的新闻数据源，跳过刷新',
      data: { skipped: true, reason: 'no_source_configured', hint },
    }
  }
  console.log(`[refreshNews] 可用数据源: ${availableSources.join(' + ')}（${availableSources.length} 个）`)

  // 工人模式：event.category 存在 → 只跑单分类流水线
  if (event && (event.category || event.shard)) {
    const category = event.category
    console.log(`[refreshNews] ===== 单分类工作模式: ${category} =====`)
    try {
      const result = await runCategoryPipeline(category, event.quotaBaseline || { zhipuCalls: 0, deepseekCalls: 0 })
      return { code: 0, category, ...result }
    } catch (err) {
      console.error(`[refreshNews][${category}] 流水线异常:`, err.message)
      return {
        code: 0,
        category,
        inserted: 0,
        skipped: true,
        engine: 'error',
        error: err.message,
        quotaDelta: { zhipuCalls: 0, deepseekCalls: 0 },
        elapsedMs: Date.now() - startTime,
      }
    }
  }

  // ── 编排模式（前端/定时器触发，event 无 category）──
  console.log('[refreshNews] ========== 开始刷新新闻缓存 (v7 拆分架构: 5 分类并行) ==========')

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

  // ── 读当日配额基线（一次）──
  let quotaBaseline = { zhipuCalls: 0, deepseekCalls: 0 }
  try {
    const { readDailyQuota } = require('./zhipuSearch')
    quotaBaseline = await readDailyQuota(db)
    console.log(`[refreshNews] 当日配额基线: 智谱=${quotaBaseline.zhipuCalls}, DeepSeek=${quotaBaseline.deepseekCalls}`)
  } catch (err) {
    console.warn('[refreshNews] 读取当日配额失败，从 0 计:', err.message)
  }

  // ── 并行自扇出：每分类一次独立云函数调用 ──
  console.log(`[refreshNews] 并行拉取 ${CATEGORIES.length} 个分类（各自独立 60s 预算）...`)
  const shards = await Promise.all(
    CATEGORIES.map(category =>
      cloud.callFunction({
        name: 'refreshNews',
        data: { category, shard: true, quotaBaseline },
      })
        .then(res => res.result || {})
        .catch(err => ({
          category,
          inserted: 0,
          skipped: true,
          engine: 'shard_error',
          error: err.message,
          quotaDelta: { zhipuCalls: 0, deepseekCalls: 0 },
          elapsedMs: 0,
        }))
    )
  )

  // ── 汇总各分类结果 ──
  const categories = {}
  let totalInserted = 0
  let totalFailed = 0
  let totalZhipu = 0
  let totalDeepseek = 0
  let allEmpty = true
  const engineCounts = {}
  const shardDetails = []
  for (const r of shards) {
    const cat = r.category || 'unknown'
    const ins = r.inserted || 0
    categories[cat] = ins
    totalInserted += ins
    totalFailed += (r.failed || 0)
    if (ins > 0) allEmpty = false
    totalZhipu += (r.quotaDelta?.zhipuCalls || 0)
    totalDeepseek += (r.quotaDelta?.deepseekCalls || 0)
    if (r.engine) engineCounts[r.engine] = (engineCounts[r.engine] || 0) + 1
    shardDetails.push({
      category: cat,
      inserted: ins,
      engine: r.engine,
      elapsedMs: r.elapsedMs || 0,
      skipped: !!r.skipped,
      error: r.error || null,
    })
  }
  console.log(`[refreshNews] 各分类结果:`, JSON.stringify(shardDetails))

  // ── 全局分级清理（过期普通/retained 记录）──
  const cleanup = await gradedCleanup()

  // ── 全分类均无新数据 → 续期旧缓存（避免 TTL 过期后列表空白）──
  let renewed = 0
  if (allEmpty) {
    console.warn('[refreshNews] ⚠️ 全部分类均无新数据，保留旧缓存并续期 cacheExpire')
    renewed = await renewCacheExpire()
  }

  // ── 写回当日配额（仅一次，避免并发写竞争）──
  try {
    const { writeDailyQuota } = require('./zhipuSearch')
    await writeDailyQuota(db, {
      zhipuCalls: (quotaBaseline.zhipuCalls || 0) + totalZhipu,
      deepseekCalls: (quotaBaseline.deepseekCalls || 0) + totalDeepseek,
    })
  } catch (err) {
    console.warn('[refreshNews] 写回当日配额失败:', err.message)
  }

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

  const elapsed = Date.now() - startTime
  console.log(`[refreshNews] ========== 刷新完成(编排): 总计 ${totalInserted} 条, 耗时 ${elapsed}ms ==========`)

  return {
    code: 0,
    message: `刷新完成，共 ${totalInserted} 条新闻`,
    data: {
      total: totalInserted,
      inserted: totalInserted,
      failed: totalFailed,
      categories,
      cleanup: {
        removedNormal: cleanup.removedNormal,
        removedRetained: cleanup.removedRetained,
        durationMs: cleanup.durationMs,
      },
      renewed,
      engineCounts,
      zhipuQuota: { zhipuCalls: totalZhipu, deepseekCalls: totalDeepseek },
      elapsedMs: elapsed,
      shards: shardDetails,
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
