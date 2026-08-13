// 新闻自动刷新云函数 v8 — 拆分架构（按分类并行云函数，彻底绕开 60s 限制）
// ============================================================
// v8 改造（2026-08-12，路线1 统一数据源）：owner 拍板「不再用 AI 抓取新闻」。
//   ① 删除智谱 AI 搜索作为数据源（zhipuSearch 不再用于抓取）；
//   ② juhe + 天行并行抓取（原"AI 搜索主力→聚合/天行兜底"反转为主力并行）；
//   ③ 官方 RSS（中新/人民/央视/新华）由 rssFetcher 独立抓取 → news_ingest staging →
//      refreshNews 消费 → qualityGate + AI 摘要/解读 → 汇入 news_cache 主列表；
//   ④ 前端首页/详情/新闻列表统一展示"最终筛选后的高质量数据源"。
//   数据流：三方接口统一抓取 → news_ingest → qualityGate → AI 统一处理 → news_cache。
//   摘要优先级（owner 拍板）：AI 摘要 > 源摘要 > 正文第一段 > 标题。
//   版权红线（A.4/A.5）：官方源正文仅作 AI 加工源数据，落库 news_cache 只存 summary，
//   content=''，contentSource='official_rss'，详情页跳源站 H5。
//
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
// 数据源（v8）：聚合 API（juhe）+ 天行 API（tianxing）并行 + 官方 RSS（news_ingest 消费）
// AI 角色：仅统一后处理（正文抓取清洗 + AI 摘要 + 独立解读 + 观点卡），不再负责抓取新闻
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
const { enrichNewsList, isInvalidDesc } = require('./utils/contentFetcher')
const { validateAndClean } = require('./validator')
const { SecurityCheck } = require('./securityCheck')
const qualityScorer = require('./utils/qualityScorer')

// ─── 分类列表（聚合支持的分类）───
// v7（TL-B11）：与 frontend utils/constants.js CATEGORIES 对齐（保留 recommend=头条，喂给 all 视图）。
const CATEGORIES = ['recommend', 'tech', 'sports', 'international', 'life']

// v8 路线1：分类中文名映射（官方源汇入 news_cache 时 categoryName 展示用，与前端 CATEGORY_MAP 一致）
const CATEGORY_NAMES = {
  recommend: '推荐',
  tech: '科技',
  sports: '科学探索',
  international: '国际',
  life: '社会',
}

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
        // FS-05 v2（2026-08-09 owner 拍板）：老 summary 也要过假 desc 校验,
        // 否则"老假 desc"（20-50 字日期/来源名）会赢过新首段,前端继续展示垃圾。
        const descCtx = { title: item.title, source: item.source }
        const oldIsFake = !existed.summary
          || isInvalidDesc(existed.summary, descCtx)
        const oldHasQuality = !oldIsFake && existed.summary !== item.title
        if (oldIsAi && !newIsAi) {
          // 旧值已是 AI 摘要，新值非 AI → 保留旧 AI
          summary = existed.summary
          summarySource = 'ai'
        } else if (!oldIsAi && !newIsAi && oldHasQuality && (existed.summary.length > summary.length)) {
          // FS-05 v2: 双方均非 AI 且老值真合格(过假 desc 校验)且更长 → 保留老
          summary = existed.summary
          summarySource = 'desc'
        }
        // 其余情况（新 AI 覆盖旧非 AI / 新 AI 覆盖旧 AI / 老假 desc）→ 使用新摘要
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
        contentSource: item.contentSource || '',  // 'ai_interpretation' | 'fetched'（版权策略：区分 AI 解读 vs 抓取原文）
        content: item.content || '',   // v6：refreshNews 已直接抓正文
        // B-COMPLIANCE-1 S1（2026-08-10 owner 拍板）：references 字段入库（智谱/AI 搜索链的来源 URL 列表）。
        // 缺省/非 AI 源（聚合/天行）= 空数组 → 详情页"原文回源"按钮自动隐藏。已有记录 update 也会覆盖。
        references: Array.isArray(item.references) ? item.references : [],
        category: item.category,
        categoryName: item.categoryName,
        source: item.source,
        sourceName: item.sourceName || '',   // v8 路线1：官方源来源名（前端 metaSource 用）
        sourceUrl: item.sourceUrl || '',
        publishTime: item.publishTime,
        // FS-02（2026-08-07 owner 决策）：新闻中不含任何图片 → picUrl 一律置空，不再入库
        picUrl: '',
        viewCount: 0,
        isRetained,
        retainedAt,
        cacheExpire,
        createdAt: now,
        // ─── FS-质量把控 v1（2026-08-12）：6 维评分 + 热度 + FinalScore + eventId 落库 ───
        // qualityScorer 已对 secPassed 评分并 attach 到 item；enriched 通过展开运算符保留这些字段。
        // 失败兜底（qualityScorer 异常时）：null/空串由 getNewsList 排序兜底（不参与排序，不影响历史数据）。
        finalScore: typeof item.finalScore === 'number' ? item.finalScore : null,
        qualityScore: typeof item.qualityScore === 'number' ? item.qualityScore : null,
        heatScore: typeof item.heatScore === 'number' ? item.heatScore : null,
        eventId: item.eventId || '',
        noiseRatio: typeof item.noiseRatio === 'number' ? item.noiseRatio : null,
        gatedReason: item._gated || (item._gatedReason || ''),  // 写入时已经过质量门，此处仅为留痕
        // owner 2026-08-12 拍板：把【一页说】观点拆为独立字段，前端做独立卡片。
        // 仅 AI 独立解读通道（contentSource='ai_interpretation'）且 withOpinion=true 时非空；其余一律 ''。
        aiOpinion: typeof item.aiOpinion === 'string' ? item.aiOpinion : '',
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

/**
 * juhe 抓取包装（带 label，供 Promise.allSettled 判定来源）
 * v8 路线1：juhe 从"兜底"变为主力源之一（与天行并行，不再等 AI 搜索失败）。
 */
async function juheFetch(category) {
  const { fetchAllCategories: fetchAllJuhe } = require('./sources/juhe')
  const r = await fetchAllJuhe([category], 8)
  return r
}
juheFetch.label = 'juhe'

/**
 * 天行抓取包装（带 label）
 */
async function tianFetch(category) {
  const { fetchAllCategories: fetchAllTian } = require('./sources/tianxing')
  const r = await fetchAllTian([category], 8)
  return r
}
tianFetch.label = 'tianxing'

/**
 * 统一收集某分类的原始新闻条目（owner 8/13 拍板：聚合 API + 官方 RSS 合并为单一处理链路）
 * 并行拉取 juhe + tianxing（聚合接口，仅返回标题+链接）+ news_ingest（官方RSS staging），
 * 全部归一为同形状 item（id/title/summary/content/contentSource/source/sourceUrl/category/_ingestId），
 * 下游正文抓取 / 质量门控 / AI 解读 / 写库统一处理，不再分两个链。
 * @returns {Promise<{items:Array, ingestIds:Array<string>, engine:string}>}
 */
async function collectCategoryItems(category) {
  const items = []
  const ingestIds = []
  const engLabels = []

  // 聚合 API（juhe + tianxing）并行抓取（仅标题/链接，正文后续统一抓）
  const sourceJobs = []
  if (config.juhe.apiKey) sourceJobs.push(juheFetch(category))
  if (config.tian.apiKey) sourceJobs.push(tianFetch(category))
  if (sourceJobs.length > 0) {
    const settled = await Promise.allSettled(sourceJobs)
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value && r.value.news && r.value.news.length > 0) {
        r.value.news.forEach((it) => items.push({
          id: it.id,
          title: it.title,
          summary: it.summary || '',
          content: it.content || '',        // 聚合只给标题/链接，正文后续统一抓
          contentSource: 'fetched',
          category: it.category,
          categoryName: it.categoryName,
          source: it.source || '聚合数据',
          sourceName: it.sourceName || it.source || '聚合数据',
          sourceUrl: it.sourceUrl || '',
          picUrl: '',
          publishTime: it.publishTime || '',
        }))
        engLabels.push(sourceJobs[i].label)
      }
    })
  }

  // 官方 RSS（news_ingest，rssFetcher 每小时轮询写入，status=pending）
  try {
    const { fetchPendingByCategory } = require('./utils/newsIngestStore')
    const officialDocs = await fetchPendingByCategory(category, 8)
    if (officialDocs.length > 0) {
      officialDocs.forEach((d) => {
        items.push({
          id: `official_${d.urlFp}`,
          title: d.title,
          summary: d.summary || '',
          content: d.content || '',         // 仅 AI 加工源数据，落库前按版权清空
          contentSource: 'official_rss',
          category: d.category,              // 已由 rssFetcher 映射为前端分类
          categoryName: CATEGORY_NAMES[d.category] || d.category,
          source: d.sourceName || '官方源',
          sourceName: d.sourceName || '官方源',
          sourceUrl: d.url || '',
          picUrl: '',
          publishTime: d.publishTime || '',
          _ingestId: d._id,
        })
        ingestIds.push(d._id)
      })
      engLabels.push('official_rss')
    }
  } catch (ingestErr) {
    console.warn(`[refreshNews][${category}] news_ingest 消费失败（官方源跳过）:`, ingestErr.message)
  }

  const engine = engLabels.length > 0 ? engLabels.join('+') : 'none'
  return { items, ingestIds, engine }
}

async function runCategoryPipeline(category, quotaBaseline) {
  const catStart = Date.now()
  const baseZ = (quotaBaseline && quotaBaseline.zhipuCalls) || 0
  const baseD = (quotaBaseline && quotaBaseline.deepseekCalls) || 0
  const quotaRef = { zhipuCalls: baseZ, deepseekCalls: baseD }

  // 1. 统一收集（owner 8/13 拍板：聚合 API 与官方 RSS 合并为单一处理链路，逻辑完全一致，不再分两个链）
  //    collectCategoryItems 内部并行拉取 juhe+tianxing（聚合）+ news_ingest（官方RSS），
  //    全部归一为同形状 item；下游正文抓取 / 质量门控 / AI 解读 / 写库统一处理。
  const collected = await collectCategoryItems(category)
  let news = collected.items
  let ingestIds = collected.ingestIds
  let engine = collected.engine

  // 1c. 全部源无数据 → 保留旧缓存（不清理、不写入）
  if (news.length === 0) {
    console.warn(`[refreshNews][${category}] juhe+天行+官方源均无数据，保留旧缓存`)
    return {
      category,
      inserted: 0,
      skipped: true,
      engine: 'none',
      quotaDelta: { zhipuCalls: quotaRef.zhipuCalls - baseZ, deepseekCalls: quotaRef.deepseekCalls - baseD },
      elapsedMs: Date.now() - catStart,
    }
  }

  // 2. 统一正文补全（A2，所有来源通用）
  //    owner 8/13 拍板：无论官方RSS还是聚合API，都必须先抓到正文——列表型源站（RSS/聚合仅给标题+链接）
  //    按 sourceUrl 逐条抓源站正文（fetchContentForItem 已实现：juhe 正文接口 + 通用网页抓取）。
  //    正文缺失/过短(<200)才补抓；质量门控与 AI 解读都基于真实正文，最终展示的是「正文→AI 解读文档」。
  const ITEM_TIMEOUT_MS = 12000
  const shortOnes = news.filter((it) => !it.content || it.content.trim().length < 200)
  if (shortOnes.length > 0) {
    const { fetchContentForItem } = require('./utils/contentFetcher')
    await Promise.all(shortOnes.map(async (it) => {
      try {
        const full = await Promise.race([
          fetchContentForItem(it),
          new Promise((res) => setTimeout(res, ITEM_TIMEOUT_MS)),
        ])
        if (full && full.trim().length >= 200) {
          it.content = full
          console.log(`[refreshNews][${category}] 正文补全成功（${full.length}字）: ${it.title}`)
        } else {
          console.warn(`[refreshNews][${category}] 正文补全失败/过短（${(full || '').length}字）: ${it.title}`)
        }
      } catch (e) {
        console.warn(`[refreshNews][${category}] 正文补全异常: ${it.title} - ${e && e.message}`)
      }
    }))
  }
  console.log(`[refreshNews][${category}] 统一收集: ${news.length} 条（${engine}），正文补全后进入校验`)

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

  // 3.5 多维质量评分 + 热度融合 + 质量门控（FS-质量把控核心 2026-08-12 落地）
  //   - clusterEvent 跨源事件聚合算 eventId/eventHeat（基于 title 聚类，不依赖 content）
  //   - topicHeat/engagement 算热度
  //   - QualityScore = 0.25·来源 + 0.20·完整 + 0.15·时效 + 0.15·文本 + 0.10·去重（合规为硬门禁）
  //   - FinalScore = 0.6·Quality + 0.4·Heat；Quality<40 或 噪音比>0.4 或 合规命中 → 不入新闻池
  //   - 接入点：enrich 前对 secPassed 评分，attach 到 item；enrich 通过 spread {...item, ...} 保留字段；
  //     batchInsert 落库 finalScore/eventId；getNewsList 排序按 FinalScore。
  //   - 安全网：scoreAll 失败不阻塞流程（catch → 全部放行，沿用旧逻辑）→ 已落地 finalScore=null。
  let qualityPassed = secPassed
  let qualityBlocked = []
  try {
    // ⚠️ 2026-08-12 修复（FS-质量把控 遗留 bug，658f8d3 引入）：
    // scoreAll 实际返回 { passed, rejected, stats }，此前误解构 { scored, gated }
    // → scored 恒 undefined → 抛错走降级 → finalScore 从未落库、质量门形同虚设。
    // 正确解构：passed（通过者，含 finalScore/eventId/heatScore）、rejected（拒者列表）。
    const { passed: scoredPassed, rejected: gatedRejected } = qualityScorer.scoreAll(secPassed, { category })
    qualityPassed = scoredPassed
    qualityBlocked = gatedRejected.map(x => ({ _gatedReason: x.reason, title: x.item }))
  } catch (qsErr) {
    console.warn(`[refreshNews][${category}] ⚠️ qualityScorer 失败，沿用旧逻辑: ${qsErr.message}`)
  }
  console.log(`[refreshNews][${category}] 质量评分: ${qualityPassed.length} 通过, ${qualityBlocked.length} 拒`)
  if (qualityBlocked.length > 0) {
    const reasons = qualityBlocked.reduce((m, it) => {
      const r = it._gatedReason || 'unknown'
      m[r] = (m[r] || 0) + 1
      return m
    }, {})
    console.log(`[refreshNews][${category}] 拒因: ${JSON.stringify(reasons)}`)
  }

  // 4. 质量门控后 0 条通过 → 保留旧缓存（不清旧、不写入）
  // v8 路线1 + owner 8/13 合并链路：不再区分 official_rss / 三方源两条写库路径，
  // 所有来源过门后统一进入 enrich + 写库；1-2 条时增量补写（不清旧），≥MIN_PER_CATEGORY 全量刷新（清旧）。
  if (qualityPassed.length === 0) {
    console.warn(`[refreshNews][${category}] 质量门控后 0 条通过，保留旧缓存`)
    return {
      category,
      inserted: 0,
      skipped: true,
      engine,
      quotaDelta: { zhipuCalls: quotaRef.zhipuCalls - baseZ, deepseekCalls: quotaRef.deepseekCalls - baseD },
      elapsedMs: Date.now() - catStart,
    }
  }
  console.log(`[refreshNews][${category}] 质量门控通过: ${qualityPassed.length} 条（统一链路，不再拆分官方/三方）`)

  // 5. 正文抓取 + AI 摘要（v8 路线1：所有源统一抓正文 + AI 摘要/解读；官方源 content 自带、落库前清空）
  // P0-2：enrich 硬期限 = catStart + 55s（保留 5s 给 DB 写入/清理）——search 吃预算后 enrich
  // 不再按 12s/条串行顶爆 60s；预算不足自动跳过 AI 摘要保正文（详情页缓存命中依赖 content）。
  const enrichStart = Date.now()
  const enrichDeadline = catStart + 55000
  // FS-CF3（2026-08-10 owner 确认方案A「先快返回+分批增量」）：
  // 传 onEnriched 回调 → 每完成一条成功 enrich 立即单条写库（createdAt = 各自完成时刻），
  // 供前端短轮询 getNewsDelta 按 createdAt 增量读到"逐条新数据"，实现"列表逐条增加"。
  // 失败/被跳过条目不回调（不入库，避免无正文壳文档）。兜底见下。
  // v8 路线1 修订：官方源（即使 <3 条）与三方源合并 enrich + 写库，但 clearOldCacheExcept 只清三方源旧缓存。
  const enrichPool = qualityPassed
  let incrementalInserted = 0
  let incrementalFailed = 0
  const writtenIds = new Set() // 已由回调单条写库成功的 id 集合
  const enriched = await enrichNewsList(
    enrichPool, 8, false, false, enrichDeadline,
    async (item) => {
      // 单条写库：batchInsert 内部按 id 幂等（已存在 update 保留 _id / retained，新记录 add）
      const r = await batchInsert([item])
      incrementalInserted += r.inserted
      incrementalFailed += r.failed
      if (r.inserted > 0) writtenIds.add(item.id) // 仅成功项才标记已写，避免兜底重复
    }
  )
  const enrichedCount = enriched.filter(it => it.content && it.content.length > 30).length
  const aiSummaryCount = enriched.filter(it => it.summary && it.summary !== it.title && it.summary.length >= 30).length
  console.log(`[refreshNews][${category}] 正文抓取: ${enrichedCount}/${enriched.length} 条, AI 摘要: ${aiSummaryCount} 条, 耗时 ${Date.now() - enrichStart}ms, 增量单条写入 ${incrementalInserted}/${incrementalFailed}`)

  // 6. 写入 news_cache：已成功回调的写库项不再重复；仅未写成功的（漏写/临时 DB 故障）走整批兜底，
  //    避免全分类写库失败后 clearOldCacheExcept 把旧缓存清空（分类空页）。兜底项 createdAt 为整批时刻，仍 ≥ since 可被增量读到。
  const pendingForBatch = enriched.filter(it => !writtenIds.has(it.id))
  let inserted = incrementalInserted
  let failed = incrementalFailed
  if (pendingForBatch.length > 0) {
    const r2 = await batchInsert(pendingForBatch)
    inserted += r2.inserted
    failed += r2.failed
  }
  // 兜底整批写过的 id 也计入已写集合（供 clearOldCacheExcept 判断，语义见第 7 步）
  pendingForBatch.forEach(it => writtenIds.add(it.id))

  // 6b. 消费 news_ingest（A.5 处理即删）：仅删除已成功写库的官方源条目
  // 只删 writtenIds 中属于官方源（带 _ingestId）的条目——enrich 失败/被质量门拦的留 pending 下轮重试
  let ingestConsumed = 0
  if (ingestIds.length > 0) {
    try {
      const { consumeByKeys } = require('./utils/newsIngestStore')
      const consumedIds = enriched
        .filter(it => it._ingestId && writtenIds.has(it.id))
        .map(it => it._ingestId)
      if (consumedIds.length > 0) {
        const cr = await consumeByKeys(consumedIds)
        ingestConsumed = cr.removed || 0
      }
    } catch (ingestErr) {
      console.warn(`[refreshNews][${category}] news_ingest 消费删除失败（幂等，下轮 TTL 兜底）:`, ingestErr.message)
    }
  }

  // 7. 清理该分类旧缓存（保留新 ids）——统一链路：有效条数 ≥ MIN_PER_CATEGORY 视为一次完整刷新（清旧），
  //    否则增量补写（不清旧，保留历史条目，避免把分类降级为少量新内容）。
  if (qualityPassed.length >= MIN_PER_CATEGORY) {
    const newIds = enriched.map(it => it.id)
    const cleared = await clearOldCacheExcept(category, newIds)
    console.log(`[refreshNews][${category}]: 完整刷新，清理旧数据 ${cleared} 条`)
  } else {
    console.log(`[refreshNews][${category}]: 有效 ${qualityPassed.length} 条(<${MIN_PER_CATEGORY})，增量补写（保留旧缓存）`)
  }

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
    ingestConsumed,
    quotaDelta: { zhipuCalls: quotaRef.zhipuCalls - baseZ, deepseekCalls: quotaRef.deepseekCalls - baseD },
    elapsedMs,
  }
}

// ─── 主函数（v7：编排 / 工人 双模式）─────────────────

exports.main = async (event) => {
  const startTime = Date.now()

  // ── B-13 v8 + owner 8/13 合并链路：官方 RSS 是独立数据源 ──
  // 路线1（2026-08-12 owner 拍板）：不再用 AI 搜索抓数据，全部三方接口抓取。
  // 可用聚合数据源 = juhe + tianxing（并行抓取）；官方 RSS 由 rssFetcher 独立写入 news_ingest，
  // refreshNews 只消费，无需额外 Key —— 故即使无三方 Key，worker 仍可消费官方源 staging，不再短路跳过整轮。
  // ⚠️ AI Key（智谱等）仍用于 enrich 阶段的摘要/解读处理，但不再是"抓取源"判据。
  const availableSources = []
  if (config.juhe.apiKey) availableSources.push('juhe')
  if (config.tian.apiKey) availableSources.push('tianxing')
  if (availableSources.length === 0) {
    console.warn('[refreshNews] 未配置 juhe/tianxing Key，本轮仅消费官方 RSS staging（聚合源缺位）')
  } else {
    console.log(`[refreshNews] 可用聚合数据源: ${availableSources.join(' + ')}（${availableSources.length} 个）；官方 RSS 始终参与`)
  }

  // 工人模式：event.category 存在 → 只跑单分类流水线
  if (event && (event.category || event.shard)) {
    const category = event.category
    const wxCtxW = cloud.getWXContext() || {}
    console.log(`[refreshNews] ===== 单分类工作模式: ${category} =====（SOURCE=${wxCtxW.SOURCE || 'unknown'}）`)
    try {
      const result = await runCategoryPipeline(category, event.quotaBaseline || { zhipuCalls: 0, deepseekCalls: 0 })
      // DG-12：异步编排下 worker 自报当日配额（编排器不再同步等待聚合，
      // 改由 worker 完成后原子自增，避免并发覆盖导致 DeepSeek 日配额熔断失效）
      try {
        const { incDailyQuota } = require('./zhipuSearch')
        await incDailyQuota(db, result.quotaDelta || { zhipuCalls: 0, deepseekCalls: 0 })
      } catch (err) {
        console.warn(`[refreshNews][${category}] worker 写回当日配额失败:`, err.message)
      }
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

  // FS-01（2026-08-07）：可观测性——打印调用来源，区分「定时器触发」与「小程序手动调用」。
  // 排查「每小时自动刷新不生效」时，只需看云函数日志里 SOURCE=wx_trigger 的编排记录是否每小时出现。
  const wxCtx = cloud.getWXContext() || {}
  console.log(`[refreshNews] 触发来源: SOURCE=${wxCtx.SOURCE || 'unknown'}（wx_trigger=定时器 / wx_client=小程序调用 / wx_server=其他云函数）`)

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

  // ── FS-01 定时器健康自检：距上次刷新 > 2h → 每小时定时触发器疑似未生效 ──
  // 正常情况：定时器每小时触发一次 → lastRefresh 距今 ≤ 1h。
  // 若 > 2h：触发器可能未在云端创建/被删（部署时未上传触发器是常见坑），
  // 或定时器触发后数据源全故障导致未更新（后者 worker 日志会有 skipped 标记）。
  try {
    const kvRes = await db.collection('system_kv').where({ key: 'ratelimit:lastRefresh' }).get()
    const lastRefreshAt = (kvRes.data && kvRes.data.length > 0 && kvRes.data[0].value)
      ? kvRes.data[0].value.lastRefreshAt || 0
      : 0
    const sinceH = lastRefreshAt ? ((Date.now() - lastRefreshAt) / 3600000).toFixed(1) : 'N/A'
    if (!lastRefreshAt || (Date.now() - lastRefreshAt) > 2 * 3600000) {
      console.warn(`[refreshNews] ⚠️ 定时器健康自检：距上次刷新 ${sinceH} 小时（>2h）。每小时定时触发器疑似未生效 → 请到云开发控制台核对：云函数 → refreshNews → 触发器 → hourlyRefresh 是否存在且启用（部署时未上传触发器是常见坑）`)
    } else {
      console.log(`[refreshNews] 定时器健康自检：距上次刷新 ${sinceH} 小时，正常`)
    }
  } catch (err) {
    console.warn('[refreshNews] 定时器健康自检失败（非阻塞）:', err.message)
  }

  // ── 异步自扇出（DG-12）：fire-and-forget 触发每分类独立云函数调用 ──
  // 背景：云函数间 cloud.callFunction RPC 硬超时 ~15s（官方文档确认服务端 config 仅支持 env，
  // 无法调长 timeout）。worker 在 AI 引擎全故障时需 30-50s（DG-11 已压到 ~36s），
  // 同步等待必然全部 callFunction:fail request timeout（23:41 实测 5 分片全 shard_error，
  // 但 life 分片实际运行 36.3s 成功写入 5 条 → 编排器误报 0 且前端 15s 超时）。
  // 改为：编排器立即触发 5 个 worker（独立实例继续运行并写 news_cache + backup），
  // 随后做全局清理/时间戳后立即返回「已触发」。worker 结果由 getNewsList 自然读到。
  console.log(`[refreshNews] 异步触发 ${CATEGORIES.length} 个分类（各自独立 60s 预算，后台执行）...`)
  CATEGORIES.forEach(category => {
    cloud.callFunction({
      name: 'refreshNews',
      data: { category, shard: true, quotaBaseline },
    })
      .then(res => {
        const r = res.result || {}
        console.log(`[refreshNews][${category}] worker 完成: inserted=${r.inserted || 0} engine=${r.engine || 'none'} elapsedMs=${r.elapsedMs || 0}`)
      })
      .catch(err => {
        // 注：worker 实例会继续跑完并写库，这里仅记录 RPC 层超时，不影响数据
        console.warn(`[refreshNews][${category}] worker RPC 超时（实例仍在后台运行）: ${err.message}`)
      })
  })

  // ── 全局分级清理（过期普通/retained 记录；不依赖 worker 结果）──
  const cleanup = await gradedCleanup()

  // DG-12：不再做「全空→续期」——getNewsList 已有三层兜底（news_cache → cache_backup → 内置精选），
  // 且每个 worker 自带 per-category 清理 + backup 快照，全源失败也不会白屏。

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
  console.log(`[refreshNews] ========== 刷新已触发(编排/异步): 后台更新中, 编排耗时 ${elapsed}ms ==========`)

  return {
    code: 0,
    message: '刷新已触发，正在后台更新',
    data: {
      async: true,
      total: 0,
      inserted: 0,
      failed: 0,
      categories: {},
      cleanup: {
        removedNormal: cleanup.removedNormal,
        removedRetained: cleanup.removedRetained,
        durationMs: cleanup.durationMs,
      },
      renewed: 0,
      engineCounts: {},
      zhipuQuota: { zhipuCalls: quotaBaseline.zhipuCalls || 0, deepseekCalls: quotaBaseline.deepseekCalls || 0 },
      elapsedMs: elapsed,
      shards: [],
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
    contentSource: doc.contentSource || '',
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
