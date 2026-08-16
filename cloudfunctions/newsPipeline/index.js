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

const BUDGET_MS = 110000          // 单次实例预算（函数超时已调至 120s，110s 预算充分榨取实例能力，提升 AI 摘要/解读单轮覆盖率）
const STAGE_BATCH = { process: 20, ai: 12, publish: 10 }
const FETCH_TIMEOUT_MS = 12000
const STAGING_TTL_MS = 6 * 60 * 60 * 1000
const MAX_PAGE_ROUNDS = 50       // C-6：全表翻页循环的迭代上限（防异常数据导致无限循环）
const CONTENT_MIN_FOR_AI = 100   // AI 能力门槛（owner 2026-08-16）：正文 ≥100 字才进 AI 阶段（摘要需内容、解读需 ≥50 字）

// C-6：publishTime 统一归一为数字毫秒时间戳（此前混存字符串/数字，orderBy 分区排序不可靠）
// 新鲜度门禁（owner 2026-08-16）：修复"旧闻滞留/部分分类不刷新"
const FRESH_MAX_AGE_MS = 48 * 3600 * 1000   // 旧闻阈值：publishTime 超过 48h 不入库
const FRESH_MAX_FUTURE_MS = 3600 * 1000     // 未来时间容差：超过 1h 视为脏数据
const FRESHNESS_PENALTY_PER_HOUR = 1.0      // 缓存淘汰：每老 1h 扣 1 分（旧闻自然沉底，新闻上位）

function parseTs(v) {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim()
  if (!s || s === 'None' || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') return null
  const t = new Date(s).getTime()
  return Number.isFinite(t) ? t : null
}

function toTs(v) {
  const t = parseTs(v)
  return t == null ? 0 : t
}

// 缓存淘汰用"新鲜度衰减分"：finalScore - 每老 1h 扣 1 分（publishTime 缺失回退 createdAt）
function effCacheScore(it, now) {
  const fs = (typeof it.finalScore === 'number') ? it.finalScore : -1
  const t = parseTs(it.publishTime) || parseTs(it.createdAt) || now
  const ageH = Math.max(0, (now - t) / 3600000)
  return fs - ageH * FRESHNESS_PENALTY_PER_HOUR
}

// ─── 工具：分批并行（从 refreshNews 移植，语义一致）───
async function batchParallel(arr, fn, size) {
  for (let i = 0; i < arr.length; i += size) {
    const chunk = arr.slice(i, i + size)
    await Promise.all(chunk.map((x) => fn(x)))
  }
}

// ─── 自调度（fire-and-forget，不 await，父实例立即返回）───
// 触发冷却 15s：仅去抖"同一时刻多个实例同时结束"的重复触发；
// 不阻断正常续跑链（实例运行 ~110s >> 15s，下一实例触发时锁必然已过期）。
async function trigger(action) {
  try {
    const now = Date.now()
    const kv = db.collection('system_kv')
    let last = 0
    try {
      const d = await kv.doc('pipeline_trigger_lock').get()
      last = (d && d.data && d.data.ts) || 0
    } catch (e) { last = 0 }
    if (last && (now - Number(last)) < 15 * 1000) return // 冷却中
    try {
      await kv.doc('pipeline_trigger_lock').set({ data: { ts: now } })
    } catch (e) {
      try { await kv.add({ data: { _id: 'pipeline_trigger_lock', ts: now } }) } catch (e2) { /* 忽略 */ }
    }
    cloud.callFunction({ name: 'newsPipeline', data: { action, _from: 'self' } }).catch(() => {})
  } catch (e) { /* 忽略 */ }
}

// ─── 续跑：低于阈值即停止（保写入、防整函数超时 0 写入）───
function hasBudget(deadline) {
  return Date.now() + 3000 <= deadline
}

// 静默时段（owner 2026-08-16）：凌晨 01:00-05:00 不跑抓取/AI 加工，省资源。
// 函数运行于 ap-shanghai（UTC+8），getHours() 即北京时间。
const QUIET_START_HOUR = 1
const QUIET_END_HOUR = 5 // 左闭右开：01:00 ≤ h < 05:00
function isQuietHours(now) {
  const h = new Date(now || Date.now()).getHours()
  return h >= QUIET_START_HOUR && h < QUIET_END_HOUR
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

    // 0. 兜底补全 source/id（兼容旧 raw 缺字段，自愈历史 consumed 条目）
    for (const it of items) {
      if (!it.source) it.source = it.sourceName || it.sourceId || it.sourceType || ''
      if (!it.id) it.id = `${it.sourceId || it.sourceType}_${(it.urlFp || '').slice(0, 16)}`
    }

    // 0.5 新鲜度门禁（owner 2026-08-16）：publishTime 解析归一 + 时效过滤。
    //     旧闻（>48h）/未来时间（>1h）/无法解析 的条目直接丢弃——不抓正文、不进 AI、不落库。
    //     修复"几小时前的新闻一直滞留、部分分类不刷新"（实测有 2007 年文章入库）。
    const nowGate = Date.now()
    const freshItems = items.filter((it) => {
      let t = parseTs(it.publishTime)
      if (t == null) t = parseTs(it.fetchedAt)   // 源无日期 → 回退抓取时刻（仍按新鲜处理）
      if (t == null) t = nowGate
      it.publishTime = t                          // 归一为数字（下游排序一致）
      const age = nowGate - t
      return age >= -FRESH_MAX_FUTURE_MS && age <= FRESH_MAX_AGE_MS
    })
    if (freshItems.length < items.length) {
      console.log(`[newsPipeline][process] 新鲜度过滤丢弃 ${items.length - freshItems.length} 条（旧闻/无日期/未来时间）`)
    }
    if (!freshItems.length) continue

    // 1. 补全正文（官方源按 sourceUrl 抓源站；聚合 juhe 按 key / 网页抓）——仅在通过新鲜度门禁后抓取
    await Promise.all(freshItems.map(async (it) => {
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

    // 2. 基础校验 + 去重
    const { valid } = validateAndClean(freshItems)

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

    // 4. AI 能力门槛（owner 2026-08-16）：正文 ≥100 字才算"能 AI"（摘要需内容、解读需 ≥50 字）。
    //    不足者直接丢弃——不进评分、不进 AI 阶段、不落库（杜绝"无 AI 摘要/解读"的入库新闻）。
    const aiCapable = secPassed.filter((it) => (it.content || '').trim().length >= CONTENT_MIN_FOR_AI)
    if (aiCapable.length < secPassed.length) {
      console.log(`[newsPipeline][process] 正文过短丢弃 ${secPassed.length - aiCapable.length} 条（<${CONTENT_MIN_FOR_AI}字，无法 AI 摘要/解读）`)
    }

    // 5. 质量筛选（评分 + 门控）—— owner 拍板：先筛选再进 AI；
    //    被门控丢弃者（低质 / 噪音比超阈 / 合规硬黑名单命中）不写 staging、不进 AI、不展示。
    const scored = scoreAll(aiCapable, {})
    const passed = scored.passed
    if (scored.rejected.length) {
      console.log(`[newsPipeline][process] 质量门丢弃 ${scored.rejected.length} 条:`,
        scored.rejected.slice(0, 5))
    }

    // 6. 写 news_staging（仅幸存者，含 finalScore/qualityScore/heatScore/eventId）
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

// ====================================================================
// 方案 A（2026-08-15）· AI 前每类硬上限截断
// --------------------------------------------------------------------
// 验收标准：单次抓取落库 news_cache 总量 <=47（推荐类 <=15、其余类各 <=8）。
// 背景：newsFetcher 对每「源x分类」抓 PER_SOURCE_NUM 条无上限扇出，
//       newsPipeline 旧逻辑把 staging 全量送 AI、全量落库，致单轮常 79~297 条远超 47。
// 做法：在 stageAi 认领 pending 之前，对 news_staging 所有 pending 按 category 做 top-N，
//       排序键 = publishTime 倒序 + qualityScore 降序（新且质优优先），
//       超 cap 的条目直接从 staging 删除 —— 不进 AI、不进 cache，从源头收敛到 <=47。
//       被截条目对应的 news_raw 已在 Stage 1 消费删除，故彻底不进系统（方案 A 代价：截断新闻不展示）。
// ====================================================================
const CATEGORY_CAP = { recommend: 15 }
const DEFAULT_CAP = 8

async function truncateStagingByCategory() {
  // 全量拉取 pending（循环翻页，防超 1000 上限）
  let pending = []
  let skip = 0
  let rounds = 0
  while (++rounds <= MAX_PAGE_ROUNDS) { // C-6：迭代上限兜底（最多 MAX_PAGE_ROUNDS 轮）
    const res = await db.collection('news_staging').where({ aiStatus: 'pending' }).limit(1000).skip(skip).get()
    const list = (res && res.data) || []
    if (!list.length) break
    pending = pending.concat(list)
    if (list.length < 1000) break
    skip += 1000
  }
  if (!pending.length) return { total: 0, truncated: 0 }

  const byCat = {}
  for (const it of pending) {
    (byCat[it.category] = byCat[it.category] || []).push(it)
  }
  const toRemove = []
  let truncated = 0
  for (const cat of Object.keys(byCat)) {
    const items = byCat[cat]
    const cap = CATEGORY_CAP[cat] || DEFAULT_CAP
    if (items.length <= cap) continue
    // owner 2026-08-16：类内按 finalScore 降序取 top（评分高优先），平局 qualityScore → publishTime
    items.sort((a, b) => {
      const fa = (typeof a.finalScore === 'number') ? a.finalScore : -1
      const fb = (typeof b.finalScore === 'number') ? b.finalScore : -1
      if (fb !== fa) return fb - fa
      const qa = (a.qualityScore != null) ? a.qualityScore : -1
      const qb = (b.qualityScore != null) ? b.qualityScore : -1
      if (qb !== qa) return qb - qa
      const ta = new Date(a.publishTime || 0).getTime() || 0
      const tb = new Date(b.publishTime || 0).getTime() || 0
      return tb - ta // 新优先
    })
    const losers = items.slice(cap) // 超出硬上限的落败者
    for (const l of losers) toRemove.push(l._id)
    truncated += losers.length
  }
  if (toRemove.length) await stagingStore.removeStaged(toRemove)
  console.log(`[newsPipeline][方案A] 截断 ${truncated} 条（每类硬上限：recommend<=15/其余<=8，finalScore 降序保留），保留 ${pending.length - truncated} 条进 AI`)
  return { total: pending.length, truncated }
}

async function stageAi(deadline) {
  let processed = 0
  // P0-4：清扫历史遗留"耗尽重试但仍 pending"的条目 → discarded（部署前的旧数据）
  try { await stagingStore.discardExhausted() } catch (e) { /* 忽略 */ }
  // 方案 A：AI 前每类 top-N 截断，从源头收敛到 <=47（异常不阻断 AI 阶段）
  try {
    await truncateStagingByCategory()
  } catch (e) {
    console.warn('[newsPipeline][ai] 方案A截断异常（放行）:', e.message)
  }
  while (hasBudget(deadline)) {
    const items = await stagingStore.claimPending(STAGE_BATCH.ai)
    if (!items.length) break

    // C. 已解读即跳过重抓（2026-08-14）：cache 已有有效 ai_interpretation 的条目不再消耗混元配额做 AI 加工，
    // 直接标 done（publish 时 batchInsert 的 A 保护会保留既有解读，不重抓、不覆盖）。
    let needAi = items
    const skipIds = []
    try {
      const ids = items.map((it) => it.id)
      const res = await db.collection('news_cache').where({ id: db.command.in(ids) }).get()
      const now = Date.now()
      const interpreted = new Set()
      for (const d of (res.data || [])) {
        if (d.contentSource === 'ai_interpretation' && (d.cacheExpire || Infinity) > now) interpreted.add(d.id)
      }
      needAi = items.filter((it) => !interpreted.has(it.id))
      for (const it of items) if (interpreted.has(it.id)) skipIds.push(it._id)
    } catch (e) {
      console.warn('[newsPipeline][ai] 查已解读缓存失败，全部走 AI:', e.message)
    }
    if (skipIds.length) {
      await stagingStore.markDone(skipIds)
      processed += skipIds.length
    }
    if (!needAi.length) continue

    // 纯 AI：skipFetch=true → 直接用 item.content（Stage 1 已补全）跑摘要+解读
    // deadline 给 enrichNewsList 内部守卫留 5s 余量
    const enriched = await enrichNewsList(
      needAi,
      3,            // concurrency：3 路并行，配合 STAGE_BATCH.ai=12 提升单实例吞吐
      true,         // skipFetch
      false,        // skipAiSummary
      Date.now() + (BUDGET_MS - 5000),
      null
    )

    const doneIds = []
    const pendingIds = []
    for (let i = 0; i < needAi.length; i++) {
      const e = enriched[i]
      if (!e) { pendingIds.push(needAi[i]._id); continue } // 被 deadline break 跳过 → 退回重跑
      await writeBackEnriched([e])
      doneIds.push(e._id)
    }
    if (doneIds.length) await stagingStore.markDone(doneIds)
    // 解读覆盖优化（2026-08-16）：deadline 跳过是"预算不足"而非"引擎失败"，
    // 退回时不烧重试次数（此前误把预算跳过计为失败，3 轮后丢弃 → 文档永远无 AI 解读）
    if (pendingIds.length) await stagingStore.markPendingKeepRetry(pendingIds)
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

  // 去重键：link/sourceUrl 优先，空则标题归一化（与前端去重口径一致）。
  // 用 dedupKey 而非 item.id 做 upsert 匹配：无论 id 如何变化，同篇新闻（同 link/title）都合并为一条。
  const dkOf = (it) => {
    const lk = String(it.sourceUrl || it.link || it.url || '').trim()
    return lk || ('T:' + String(it.title || '').trim())
  }
  // 同批次内存去重：每组保留 AI 解读最全、质量最高者，避免并发/批内重复写入。
  const rankOf = (it) => {
    let r = 0
    if (it.contentSource === 'ai_interpretation') r = 3
    else if (it.contentSource === 'ai_summary') r = 2
    if (it.aiOpinion && String(it.aiOpinion).trim()) r += 0.5
    r += (Number(it.qualityScore) || 0) / 100
    return r
  }
  const bestByDk = new Map()
  for (const it of newsList) {
    const dk = dkOf(it)
    if (!dk) continue
    const prev = bestByDk.get(dk)
    if (!prev || rankOf(it) > rankOf(prev)) bestByDk.set(dk, it)
  }
  const dedupList = [...bestByDk.values()]

  const existMap = {}
  try {
    const dks = dedupList.map((it) => dkOf(it))
    for (let i = 0; i < dks.length; i += 20) {
      const chunk = dks.slice(i, i + 20)
      const res = await db.collection('news_cache').where({ dedupKey: db.command.in(chunk) }).get()
      res.data.forEach((doc) => { existMap[doc.dedupKey] = doc })
    }
  } catch (err) {
    console.warn('[newsPipeline][publish] 查询已有记录失败:', err.message)
  }

  await batchParallel(dedupList, async (item) => {
    try {
      const dk = dkOf(item)
      const existed = existMap[dk]
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

      // A. 保护已生成的 AI 解读（2026-08-14）：同 id 更新时，若 cache 旧记录已是真解读，
      // 本次更弱（ai_summary/fetched/空）则不降级覆盖——避免多波重抓把真解读坍缩成摘要。
      // 官方源 official_rss 为独立合法态，不在此保护范围内（保持「出处 ↗」）。
      let finalContent = item.content || ''
      let finalAiOpinion = (typeof item.aiOpinion === 'string') ? item.aiOpinion : ''
      if (existed && existed.contentSource === 'ai_interpretation' && finalContentSource !== 'ai_interpretation' && finalContentSource !== 'official_rss') {
        finalContent = (typeof existed.content === 'string' && existed.content) ? existed.content : finalContent
        finalContentSource = 'ai_interpretation'
        finalAiOpinion = (typeof existed.aiOpinion === 'string' && existed.aiOpinion) ? existed.aiOpinion : finalAiOpinion
      }

      const docData = {
        id: item.id,
        dedupKey: dk,
        title: item.title,
        summary,
        summarySource,
        contentSource: finalContentSource,
        content: finalContent,
        references: Array.isArray(item.references) ? item.references : [],
        category: item.category,
        categoryName: item.categoryName,
        source: item.source,
        sourceName: item.sourceName || '',
        sourceUrl: item.sourceUrl || '',
        publishTime: toTs(item.publishTime),
        picUrl: '',
        viewCount: 0,
        isRetained,
        retainedAt,
        cacheExpire,
        createdAt: now,
        finalScore: typeof item.finalScore === 'number' ? item.finalScore : null,
        qualityScore: typeof item.qualityScore === 'number' ? item.qualityScore : null,
        heatScore: typeof item.heatScore === 'number' ? item.heatScore : null,
        eventId: item.eventId || '',
        noiseRatio: typeof item.noiseRatio === 'number' ? item.noiseRatio : null,
        gatedReason: item.gatedReason || item._gatedReason || (item._gated ? 'gated' : ''),
        aiOpinion: finalAiOpinion,
      }

      if (existed && existed._id) {
        // P1-2 修复：update 不覆盖 createdAt（保留首写时刻），避免热新闻 createdAt 被刷成
        // "本轮时刻"导致 getNewsDelta 将其误判为本轮新增
        delete docData.createdAt
        docData.updatedAt = now
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

// ====================================================================
// 方案 A 兜底（2026-08-15）· publish 末端每类硬上限淘汰
// --------------------------------------------------------------------
// 背景：方案 A 的 staging 截断在「并行 AI 阶段」下存在竞态——多实例同时
//       claimPending 把 pending→processing 后，只删 pending 的截断够不着已
//       认领的超额条目，导致单轮 cache 仍可能 >47。
// 做法：publish 全部完成后，对 news_cache 按 category 做全局硬上限，
//       每类只保留最新 N 条（publishTime 倒序），超出的旧记录直接删除。
//       这样无论上游 AI 阶段如何、是否多轮累积，cache 总量恒定 <=47。
// 排序键 = publishTime 倒序（新优先，淘汰旧的）。
// ====================================================================
async function enforceCategoryCapOnCache() {
  let all = []
  let skip = 0
  let rounds = 0
  while (++rounds <= MAX_PAGE_ROUNDS) { // C-6：迭代上限兜底（最多 MAX_PAGE_ROUNDS 轮）
    const res = await db.collection('news_cache').limit(1000).skip(skip).get()
    const list = (res && res.data) || []
    if (!list.length) break
    all = all.concat(list)
    if (list.length < 1000) break
    skip += 1000
  }
  if (!all.length) return { trimmed: 0 }

  const byCat = {}
  for (const it of all) {
    (byCat[it.category] = byCat[it.category] || []).push(it)
  }
  const toRemove = []
  let trimmed = 0
  for (const cat of Object.keys(byCat)) {
    const items = byCat[cat]
    const cap = CATEGORY_CAP[cat] || DEFAULT_CAP
    if (items.length <= cap) continue
    // P0-3 修复：收藏（isRetained=true）条目豁免淘汰，只从普通条目中淘汰超出上限者
    const _retained = items.filter(it => it.isRetained === true)
    const normal = items.filter(it => it.isRetained !== true)
    if (normal.length <= cap) continue
    // owner 2026-08-16：淘汰用"新鲜度衰减分"= finalScore - 每老1h扣1分——
    // 高分旧闻会随时间沉底，新进新闻（同分或略低）也能上位，解决"旧闻滞留不刷新"
    const _now = Date.now()
    normal.sort((a, b) => {
      const ea = effCacheScore(a, _now)
      const eb = effCacheScore(b, _now)
      if (eb !== ea) return eb - ea
      const ta = parseTs(a.publishTime) || parseTs(a.createdAt) || 0
      const tb = parseTs(b.publishTime) || parseTs(b.createdAt) || 0
      return tb - ta // 新优先
    })
    const losers = normal.slice(cap) // 超出硬上限的旧记录（收藏豁免）
    for (const l of losers) toRemove.push(l._id)
    trimmed += losers.length
  }
  for (const id of toRemove) {
    try { await db.collection('news_cache').doc(id).remove() } catch (e) { /* 忽略 */ }
  }
  console.log(`[newsPipeline][方案A兜底] cache 每类硬上限淘汰 ${trimmed} 条，cache 总量收敛到 ${all.length - trimmed}`)
  return { trimmed }
}

// ====================================================================
// TTL 物理清理（2026-08-15 补）· 删除 cacheExpire 已过期记录
// --------------------------------------------------------------------
// 背景：此前 TTL 物理删除只写在未部署的 refreshNews 里，线上无函数做过期
//       清理 → 过期记录物理滞留库（虽被 getNewsList 的 cacheExpire>now 过滤
//       隐藏，仍为垃圾堆积、且数量口径失真）。本函数在每次 publish / 调度 tick
//       兜底清理，让 cache 真正自清、只保留近 7 天（保留项 30 天）数据。
// 删除键 = cacheExpire < now；保留项(cacheExpire=retainedAt+30d)自然豁免。
// ====================================================================
async function cleanupExpiredCache() {
  const now = Date.now()
  let removed = 0
  try {
    const res = await db.collection('news_cache').where({ cacheExpire: _.lt(now) }).remove()
    removed = (res && res.stats && (res.stats.removed || res.stats.removedCount)) || 0
  } catch (e) {
    console.warn('[newsPipeline][TTL清理] 过期记录删除异常（放行）:', e.message)
  }
  if (removed > 0) console.log(`[newsPipeline][TTL清理] 删除 ${removed} 条过期(cacheExpire<now)记录`)
  return { removed }
}

// 质量评分（与 batchInsert 内 rankOf 同口径，module 级共享）：AI 解读 > AI 摘要 > 其它，
// 叠加 aiOpinion 完整性、qualityScore。用于去重兜底时"每组只留最好那条"。
function rankOfItem(it) {
  let r = 0
  if (it.contentSource === 'ai_interpretation') r = 3
  else if (it.contentSource === 'ai_summary') r = 2
  if (it.aiOpinion && String(it.aiOpinion).trim()) r += 0.5
  r += (Number(it.qualityScore) || 0) / 100
  return r
}

// ====================================================================
// 去重兜底（2026-08-15 补）· 按 dedupKey 合并跨批次竞态副本
// --------------------------------------------------------------------
// 背景：batchInsert 已按 dedupKey upsert，但 CloudBase NoSQL 存在读写延迟，
//       两轮独立 publish 时，后一轮的 existMap 查询可能漏判前一轮刚写入的记录
//       → 同 dedupKey 被 add 成两份副本（实测 47 条里出现 6 对）。这类重复
//       getNewsList 会原样返回给前端，用户仍看到重复。
// 做法：publish / 调度 tick 末端再扫一遍，按 dedupKey 分组，每组只留
//       rankOfItem 最高（同档留最新 publishTime）那条，其余物理删除。
// ====================================================================
async function dedupByDkSweep() {
  let all = []
  let skip = 0
  let rounds = 0
  while (++rounds <= MAX_PAGE_ROUNDS) { // C-6：迭代上限兜底（最多 MAX_PAGE_ROUNDS 轮）
    const res = await db.collection('news_cache').limit(1000).skip(skip).get()
    const list = (res && res.data) || []
    if (!list.length) break
    all = all.concat(list)
    if (list.length < 1000) break
    skip += 1000
  }
  if (!all.length) return { deduped: 0 }

  const byDk = {}
  for (const it of all) {
    const dk = it.dedupKey || (it.sourceUrl || it.link || it.url) || ('T:' + (it.title || ''))
    if (!dk) continue
    ;(byDk[dk] = byDk[dk] || []).push(it)
  }
  const toRemove = []
  let deduped = 0
  for (const dk of Object.keys(byDk)) {
    const items = byDk[dk]
    if (items.length <= 1) continue
    // P0-3 修复：收藏条目不参与去重淘汰（保留用户可见副本）
    const _retained = items.filter(it => it.isRetained === true)
    const normal = items.filter(it => it.isRetained !== true)
    if (normal.length <= 1) continue
    normal.sort((a, b) => {
      const ra = rankOfItem(a)
      const rb = rankOfItem(b)
      if (rb !== ra) return rb - ra
      const ta = new Date(a.publishTime || 0).getTime() || 0
      const tb = new Date(b.publishTime || 0).getTime() || 0
      return tb - ta
    })
    for (const loser of normal.slice(1)) toRemove.push(loser._id)
    deduped += normal.length - 1
  }
  for (const id of toRemove) {
    try { await db.collection('news_cache').doc(id).remove() } catch (e) { /* 忽略 */ }
  }
  if (deduped > 0) console.log(`[newsPipeline][去重兜底] 按 dedupKey 合并 ${deduped} 条跨批次重复副本`)
  return { deduped }
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

  // 方案 A 兜底：publish 后强制每类硬上限，cache 总量恒定 <=47
  let capRes = { trimmed: 0 }
  try {
    capRes = await enforceCategoryCapOnCache()
  } catch (e) {
    console.warn('[newsPipeline][publish] 每类硬上限兜底异常（放行）:', e.message)
  }

  // TTL 物理清理：删除 cacheExpire 已过期(>7天)记录，只保留近 7 天数据
  let ttlRes = { removed: 0 }
  try {
    ttlRes = await cleanupExpiredCache()
  } catch (e) {
    console.warn('[newsPipeline][publish] TTL 清理异常（放行）:', e.message)
  }

  // 去重兜底：合并跨批次竞态产生的同 dedupKey 副本，避免前端看到重复
  let dupRes = { deduped: 0 }
  try {
    dupRes = await dedupByDkSweep()
  } catch (e) {
    console.warn('[newsPipeline][publish] 去重兜底异常（放行）:', e.message)
  }

  const sd = await stagingStore.doneCount()
  if (sd > 0) trigger('publish')
  else trigger('run') // 全部完成 → 调度器回到空闲
  return { stage: 'publish', published, ...capRes }
}

// ====================================================================
// 调度器 run()：幂等检查全局队列，触发下一个该跑的阶段
// ====================================================================
async function run() {
  // TTL 物理清理：每次调度 tick 兜底，过期记录随时被清，防堆积
  try { await cleanupExpiredCache() } catch (e) { /* 放行 */ }
  // 去重兜底：调度 tick 也兜底合并跨批次重复副本
  try { await dedupByDkSweep() } catch (e) { /* 放行 */ }
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
  // 静默时段（01:00-05:00）：跳过全部重活（抓取/AI/落库），实例立即返回，
  // 自调度链在静默时段自然终止（每 5 分钟 selfHeal 仍会轻量唤醒并快速返回）
  if (isQuietHours()) {
    console.log(`[newsPipeline] 静默时段（${QUIET_START_HOUR}:00-${QUIET_END_HOUR}:00）跳过 action=${action}`)
    return { ok: true, action, step: 'quiet', reason: 'quiet hours' }
  }
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
