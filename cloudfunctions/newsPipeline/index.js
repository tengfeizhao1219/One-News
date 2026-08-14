/**
 * newsPipeline — 队列驱动 · 三段解耦流水线（Stage 1/2/3）
 * ============================================================
 * 取代 refreshNews 的「单函数单趟抢预算」模式。把采集与 AI 彻底解耦：
 *   - newsFetcher（Stage 0，独立函数）统一抓取所有源 → news_raw(pending)
 *   - 本函数三段，每段独立云函数实例、独立 60s 预算，跑不完留 pending 自续跑：
 *       Stage 1 process：news_raw(pending) → 补全正文 + 安全校验 → news_staging(aiStatus=pending)
 *       Stage 2 ai     ：news_staging(pending) → 纯 AI 摘要+解读（skipFetch，零抓取）→ 标 done
 *       Stage 3 publish：news_staging(done) → batchInsert 写 news_cache → 删 staging
 *   - 调度器 run()：检查全局队列，触发下一个该跑的阶段（幂等、可定时器/手动触发）
 *
 * 续跑机制：每个 Stage 内部 while(有活 && 剩余预算>阈值) 取一批处理；
 *          循环末若仍有 pending → callFunction(本函数, 同阶段) 再起实例接手；
 *          某阶段清空 → callFunction(run) 接力下一阶段。60s 只是「调度片」非「吞吐墙」。
 *
 * 设计依据：docs/architecture-pipeline-redesign.md
 * 状态机：news_raw.status(pending→consumed) / news_staging.aiStatus(pending→processing→done)
 * 合规红线：官方源全文只在 staging 瞬时存在，publish 时 content 清空（news_cache 只存 summary）。
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const rawStore = require('./newsRawStore')
const stagingStore = require('./utils/newsStagingStore')
const { fetchContentForItem, enrichNewsList, isInvalidDesc } = require('./utils/contentFetcher')
const { validateAndClean } = require('./validator')
const { SecurityCheck } = require('./securityCheck')
const { scoreAll } = require('./utils/qualityScorer')
const config = require('./config')

const BUDGET_MS = 55000          // 单次实例预算（< 60s 墙，留余量）
const STAGE_BATCH = { process: 20, ai: 12, publish: 10 }
const FETCH_TIMEOUT_MS = 12000
const STAGING_TTL_MS = 6 * 60 * 60 * 1000

// ─── 工具：分批并行（从 refreshNews 移植，语义一致）───
async function batchParallel(arr, fn, size) {
  for (let i = 0; i < arr.length; i += size) {
    const chunk = arr.slice(i, i + size)
    await Promise.all(chunk.map((x) => fn(x)))
  }
}

// ─── 自调度（fire-and-forget，不 await，父实例立即返回）───
function trigger(action) {
  try {
    cloud.callFunction({ name: 'newsPipeline', data: { action, _from: 'self' } }).catch(() => {})
  } catch (e) { /* 忽略 */ }
}

// ─── 续跑：低于阈值即停止（保写入、防整函数超时 0 写入）───
function hasBudget(deadline) {
  return Date.now() + 3000 <= deadline
}

// ====================================================================
// Stage 1 · process：news_raw(pending) → 补全正文 + 安全校验 → news_staging
// ====================================================================
async function stageProcess(deadline) {
  let written = 0
  let consumed = 0

  // 0. 自愈：把历史 consumed 残留（上次处理失败/字段缺失）重置为 pending，
  //    避免使用 _.or 复杂查询（该 SDK 版本不支持），改用简单等值 + 批量重置。
  try {
    let guard = 0
    while (guard++ < 30) {
      const res = await db.collection('news_raw').where({ status: 'consumed' }).limit(50).get()
      const list = (res && res.data) || []
      if (!list.length) break
      for (const d of list) {
        await db.collection('news_raw').doc(d._id).update({ data: { status: 'pending' } })
      }
    }
    console.log('[newsPipeline][process] 自愈重置 consumed→pending 完成')
  } catch (e) {
    console.warn('[newsPipeline][process] 自愈重置失败:', e.message)
  }

  while (hasBudget(deadline)) {
    const { items, hasMore } = await rawStore.pullPending({ limit: STAGE_BATCH.process, cursorSkip: 0 })
    if (!items.length) break

    // 1. 补全正文（官方源按 sourceUrl 抓源站；聚合 juhe 按 key / 网页抓）
    await Promise.all(items.map(async (it) => {
      if (!it.content || it.content.trim().length < 200) {
        try {
          const full = await Promise.race([
            fetchContentForItem(it),
            new Promise((res) => setTimeout(res, FETCH_TIMEOUT_MS)),
          ])
          if (full && full.trim().length >= 50) it.content = full
        } catch (e) { /* 忽略单条抓取失败 */ }
      }
    }))

    // 0. 兜底补全 source/id（兼容旧 raw 缺字段，自愈历史 consumed 条目）
    for (const it of items) {
      if (!it.source) it.source = it.sourceName || it.sourceId || it.sourceType || ''
      if (!it.id) it.id = `${it.sourceId || it.sourceType}_${(it.urlFp || '').slice(0, 16)}`
    }

    // 2. 基础校验 + 去重
    const { valid } = validateAndClean(items)

    // 3. 内容安全审核（合规不可省；config 无 security 段则放行）
    const securityEnabled = !!(config.security && config.security.enabled)
    let secPassed = valid
    if (securityEnabled) {
      try {
        const sec = new SecurityCheck({ enabled: true })
        const secRes = await sec.checkBatch(valid)
        secPassed = secRes.passed || []
      } catch (e) {
        console.warn('[newsPipeline][process] 安全审核异常，降级放行:', e.message)
        secPassed = valid
      }
    }

    // 4. 质量筛选（评分 + 门控）—— owner 拍板：先筛选再进 AI；
    //    被门控丢弃者（低质 / 噪音比超阈 / 合规硬黑名单命中）不写 staging、不进 AI、不展示。
    const scored = scoreAll(secPassed, {})
    const passed = scored.passed
    if (scored.rejected.length) {
      console.log(`[newsPipeline][process] 质量门丢弃 ${scored.rejected.length} 条:`,
        scored.rejected.slice(0, 5))
    }

    // 5. 写 news_staging（仅幸存者，含 finalScore/qualityScore/heatScore/eventId）
    const docs = passed.map((it) => ({
      _id: it._id,
      id: it.id,
      title: it.title,
      summary: it.summary || '',
      category: it.category,
      categoryName: it.categoryName || '',
      source: it.source,
      sourceName: it.sourceName || '',
      sourceUrl: it.sourceUrl || '',
      publishTime: it.publishTime,
      sourceType: it.sourceType,
      sourceId: it.sourceId,
      urlFp: it.urlFp,
      titleFp: it.titleFp,
      content: it.content || '',
      contentSource: it.contentSource || 'fetched',
      finalScore: it.finalScore ?? null,
      qualityScore: it.qualityScore ?? null,
      heatScore: it.heatScore ?? null,
      eventId: it.eventId || '',
      noiseRatio: it.noiseRatio ?? null,
      aiStatus: 'pending',
      createdAt: new Date().toISOString(),
      expireAt: new Date(Date.now() + STAGING_TTL_MS).toISOString(),
    }))
    const wr = await stagingStore.writeStaging(docs)
    written += wr.added + wr.updated

    // 5. 消费 news_raw（处理即删，不堆积；自愈历史 consumed 一并清理）
    for (const it of items) {
      await rawStore.removeRaw(it.urlFp)
      consumed++
    }

    if (!hasMore) break
  }

  // 续跑 / 接力
  const left = await rawStore.pullPending({ limit: 1, cursorSkip: 0 })
  if (left.items.length > 0) trigger('process')
  else trigger('run') // 让调度器决定是否进 ai

  return { stage: 'process', written, consumed }
}

// ====================================================================
// Stage 2 · ai：news_staging(pending) → 纯 AI 摘要+解读 → 标 done
// ====================================================================
async function writeBackEnriched(list) {
  for (const e of list) {
    if (!e || !e._id) continue
    try {
      await db.collection('news_staging').doc(e._id).update({
        data: {
          summary: e.summary || '',
          summarySource: e.summarySource || 'title',
          content: e.content || '',
          contentSource: e.contentSource || '',
          aiOpinion: typeof e.aiOpinion === 'string' ? e.aiOpinion : '',
          references: Array.isArray(e.references) ? e.references : [],
          aiAt: Date.now(),
        },
      })
    } catch (err) {
      console.warn(`[newsPipeline][ai] writeBack 失败 [${e._id}]:`, err && err.message)
    }
  }
}

async function stageAi(deadline) {
  let processed = 0
  while (hasBudget(deadline)) {
    const items = await stagingStore.claimPending(STAGE_BATCH.ai)
    if (!items.length) break

    // 纯 AI：skipFetch=true → 直接用 item.content（Stage 1 已补全）跑摘要+解读
    // deadline 给 enrichNewsList 内部守卫留 5s 余量
    const enriched = await enrichNewsList(
      items,
      3,            // concurrency：3 路并行，配合 STAGE_BATCH.ai=12 提升单实例吞吐
      true,         // skipFetch
      false,        // skipAiSummary
      Date.now() + (BUDGET_MS - 5000),
      null
    )

    const doneIds = []
    const pendingIds = []
    for (let i = 0; i < items.length; i++) {
      const e = enriched[i]
      if (!e) { pendingIds.push(items[i]._id); continue } // 被 deadline break 跳过 → 退回重跑
      await writeBackEnriched([e])
      doneIds.push(e._id)
    }
    if (doneIds.length) await stagingStore.markDone(doneIds)
    if (pendingIds.length) await stagingStore.markPending(pendingIds) // 退回未处理项
    processed += doneIds.length
  }

  // 续跑 / 接力
  const sp = await stagingStore.pendingCount()
  if (sp > 0) trigger('ai')
  else trigger('run')
  return { stage: 'ai', processed }
}

// ====================================================================
// Stage 3 · publish：news_staging(done) → batchInsert 写 news_cache → 删 staging
// （batchInsert 从 refreshNews 移植，news_cache schema 完全一致 → 前端零改动）
// ====================================================================
async function batchInsert(newsList) {
  const now = Date.now()
  const expireAt = now + ((config.cache && config.cache.dbCacheTTL) || 7 * 24 * 3600 * 1000)
  let inserted = 0
  let failed = 0

  const existMap = {}
  try {
    const ids = newsList.map((it) => it.id)
    for (let i = 0; i < ids.length; i += 20) {
      const chunk = ids.slice(i, i + 20)
      const res = await db.collection('news_cache').where({ id: db.command.in(chunk) }).get()
      res.data.forEach((doc) => { existMap[doc.id] = doc })
    }
  } catch (err) {
    console.warn('[newsPipeline][publish] 查询已有记录失败:', err.message)
  }

  await batchParallel(newsList, async (item) => {
    try {
      const existed = existMap[item.id]
      let summary = item.summary || ''
      let summarySource = item.summarySource || (!summary || summary === item.title ? 'title' : 'desc')
      if (existed) {
        const newIsAi = summarySource === 'ai'
        const oldSource = existed.summarySource || (existed.summary && existed.summary !== existed.title ? 'desc' : 'title')
        const oldIsAi = oldSource === 'ai'
        const descCtx = { title: item.title, source: item.source }
        const oldIsFake = !existed.summary || isInvalidDesc(existed.summary, descCtx)
        const oldHasQuality = !oldIsFake && existed.summary !== item.title
        if (oldIsAi && !newIsAi) {
          summary = existed.summary
          summarySource = 'ai'
        } else if (!oldIsAi && !newIsAi && oldHasQuality && existed.summary.length > summary.length) {
          summary = existed.summary
          summarySource = 'desc'
        }
      }

      let isRetained = false
      let retainedAt = null
      let cacheExpire = expireAt
      if (existed && existed.isRetained === true) {
        isRetained = true
        retainedAt = existed.retainedAt || now
        cacheExpire = retainedAt + ((config.cache && config.cache.retainedTTL) || 30 * 24 * 3600 * 1000)
      }

      let finalContentSource = item.contentSource || ''
      if (finalContentSource === 'fetched' && summarySource === 'ai' && summary) {
        finalContentSource = 'ai_summary'
      } else if (finalContentSource === 'fetched' && !(item.content || '').trim()) {
        finalContentSource = ''
      }

      const docData = {
        id: item.id,
        title: item.title,
        summary,
        summarySource,
        contentSource: finalContentSource,
        content: item.content || '',
        references: Array.isArray(item.references) ? item.references : [],
        category: item.category,
        categoryName: item.categoryName,
        source: item.source,
        sourceName: item.sourceName || '',
        sourceUrl: item.sourceUrl || '',
        publishTime: item.publishTime,
        picUrl: '',
        viewCount: 0,
        isRetained,
        retainedAt,
        cacheExpire,
        createdAt: now,
        finalScore: null,
        qualityScore: null,
        heatScore: null,
        eventId: item.eventId || '',
        noiseRatio: null,
        gatedReason: '',
        aiOpinion: typeof item.aiOpinion === 'string' ? item.aiOpinion : '',
      }

      if (existed && existed._id) {
        await db.collection('news_cache').doc(existed._id).update({ data: docData })
      } else {
        await db.collection('news_cache').add({ data: docData })
      }
      inserted++
    } catch (err) {
      if (err.errCode !== -1) {
        failed++
        console.warn(`[newsPipeline][publish] news_cache 写入失败 [${item.id}]:`, err && err.message)
      }
    }
  }, 10)

  return { inserted, failed }
}

async function stagePublish(deadline) {
  let published = 0
  while (hasBudget(deadline)) {
    const items = await stagingStore.claimDone(STAGE_BATCH.publish)
    if (!items.length) break
    const r = await batchInsert(items)
    await stagingStore.removeStaged(items.map((i) => i._id))
    published += r.inserted || 0
  }

  const sd = await stagingStore.doneCount()
  if (sd > 0) trigger('publish')
  else trigger('run') // 全部完成 → 调度器回到空闲
  return { stage: 'publish', published }
}

// ====================================================================
// 调度器 run()：幂等检查全局队列，触发下一个该跑的阶段
// ====================================================================
async function run() {
  const rawP = await rawStore.pullPending({ limit: 1, cursorSkip: 0 })
  if (rawP.items.length > 0) { trigger('process'); return { step: 'process', reason: 'news_raw 有 pending' } }
  const sp = await stagingStore.pendingCount()
  if (sp > 0) { trigger('ai'); return { step: 'ai', reason: 'staging 有 pending' } }
  const sd = await stagingStore.doneCount()
  if (sd > 0) { trigger('publish'); return { step: 'publish', reason: 'staging 有 done' } }
  return { step: 'idle' }
}

// ====================================================================
// 入口
// ====================================================================
exports.main = async (event = {}, context = {}) => {
  const action = (event && event.action) || 'run'
  const deadline = Date.now() + BUDGET_MS
  console.log(`[newsPipeline] action=${action}`)
  try {
    let result
    if (action === 'process') result = await stageProcess(deadline)
    else if (action === 'ai') result = await stageAi(deadline)
    else if (action === 'publish') result = await stagePublish(deadline)
    else result = await run()
    return { ok: true, action, ...result }
  } catch (err) {
    console.error(`[newsPipeline] action=${action} 异常:`, err && err.message)
    return { ok: false, action, error: err && err.message }
  }
}
