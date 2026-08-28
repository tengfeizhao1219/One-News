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

const crypto = require('crypto')

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

// URL 路径日期（/20070426/、/2007/04/26/、/2007-04-26/）。源无 pubDate 时常把 2007 旧闻标成今天。
function parseDateFromUrl(url) {
  const s = String(url || '')
  let m = s.match(/\/((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:\/|$|[.?#])/)
  if (m) {
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3])
    return Number.isFinite(t) ? t : null
  }
  m = s.match(/\/((?:19|20)\d{2})[/\-](0?[1-9]|1[0-2])[/\-](0?[1-9]|[12]\d|3[01])(?:\/|$|[.?#])/)
  if (m) {
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3])
    return Number.isFinite(t) ? t : null
  }
  return null
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
// 防请求风暴三层防护（EXCEED_REQUEST_LIMIT 事故复盘 2026-08-17）：
//   ① 60s 触发冷却（去抖 + 兜底）
//   ② 每小时自触发预算上限（硬熔断 + 告警日志，正常 ~8 次/时，40 已很宽裕）
//   ③ 配合 claimablePendingCount（只认领"可认领"待办）不再空转
const MAX_SELF_TRIGGER_PER_HOUR = 40
async function trigger(action) {
  try {
    const now = Date.now()
    const kv = db.collection('system_kv')

    // ① 60s 冷却
    let last = 0
    try {
      const d = await kv.doc('pipeline_trigger_lock').get()
      last = (d && d.data && d.data.ts) || 0
    } catch (e) { last = 0 }
    if (last && (now - Number(last)) < 60 * 1000) return // 冷却中

    // ② 小时预算熔断
    const hourKey = 'pipeline_trigger_budget_' + Math.floor(now / 3600000)
    let count = 0
    try {
      const b = await kv.doc(hourKey).get()
      count = (b && b.data && b.data.count) || 0
    } catch (e) { count = 0 }
    if (count >= MAX_SELF_TRIGGER_PER_HOUR) {
      console.warn(`[newsPipeline] 自触发小时预算(${MAX_SELF_TRIGGER_PER_HOUR})已耗尽，暂停自调度（改由 selfHeal 兜底）——疑似异常续跑，请检查`)
      return
    }
    try {
      await kv.doc(hourKey).update({ data: { count: _.inc(1) } })
    } catch (e) {
      try { await kv.add({ data: { _id: hourKey, count: 1 } }) } catch (e2) { /* 忽略 */ }
    }

    // 写冷却锁 + 触发
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
// BUG 修复（2026-08-19）：SCF 容器实际跑在 UTC（getHours() 返回 UTC 小时数），
// 之前注释「getHours() 即北京时间」与实际不符——白天大部分时段被误判为静默时段跳过。
// 现改用 Intl.DateTimeFormat 解析北京时间，保持「北京凌晨 1-5 静默」原语义。
const QUIET_START_HOUR = 1
const QUIET_END_HOUR = 5 // 左闭右开：北京 01:00 ≤ h < 北京 05:00
const { beijingHour } = require('./beijingTime')
function isQuietHours(now) {
  const h = beijingHour(now || new Date())
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

    // 0.5 新鲜度门禁：日期归一 + 时效过滤。
    //     newsFetcher 写入的是 pubDate（不是 publishTime）；必须两边都读。
    //     URL 路径含明确年月日且已超 48h → 直接丢弃（防「无 pubDate 回填 fetchedAt=今天」的 2007 旧闻）。
    //     ★ 队列死锁修复（2026-08-28 事故，owner 提供观察通道确认）：被门禁判为"旧闻/未来"的条目此前
    //       只从本批剔除但【从未从 news_raw 移除】。raw 按 fetchedAt 升序拉取且 pullPending 恒用 skip=0，
    //       历史残留旧闻（2006 央视早期稿件、已过 48h 的 8-26 条目）永久躺在队头 → 每次 pull 同一批旧闻、
    //       freshItems 恒空、continue 跳过移除 → 新鲜新闻（8-28）永远轮不到，流水线"假活"。
    //       现改为：门禁未通过 = 永久丢弃，直接 removeRaw，让队列前进、新鲜条目能到队头。
    const nowGate = Date.now()
    const freshItems = []
    const staleItems = []
    for (const it of items) {
      const urlTs = parseDateFromUrl(it.sourceUrl || it.url || '')
      if (urlTs != null && (nowGate - urlTs) > FRESH_MAX_AGE_MS) { staleItems.push(it); continue }
      let t = parseTs(it.publishTime) || parseTs(it.pubDate)
      // 2026-08-20 修复：上游 pubDate 仅日期无时分（如 "2026-08-20"）→ new Date 解析为 UTC 0 点
      // → 北京 08:00，导致国际等分类时间全冻在 08:00。检测到日期型后回退用 fetchedAt（真实抓取时间），让时间散开。
      const rawPub = it.pubDate != null ? it.pubDate : it.publishTime
      const isDateOnly = typeof rawPub === 'string' && /^\d{4}-\d{2}-\d{2}([T ]00:00:00(\.\d+)?)?$/.test(String(rawPub).trim())
      if (t != null && isDateOnly) {
        const f = parseTs(it.fetchedAt)
        if (f != null) t = f
      }
      if (t == null && urlTs != null) t = urlTs
      if (t == null) t = parseTs(it.fetchedAt)
      if (t == null) t = nowGate
      it.publishTime = t
      const age = nowGate - t
      if (age < -FRESH_MAX_FUTURE_MS || age > FRESH_MAX_AGE_MS) { staleItems.push(it); continue }
      freshItems.push(it)
    }
    // 门禁未通过：立即从 news_raw 移除（永久丢弃），避免残留旧闻卡死队头、阻塞新鲜数据。
    if (staleItems.length) {
      await Promise.all(staleItems.map((it) => rawStore.removeRaw(it.urlFp)))
      console.log(`[newsPipeline][process] 新鲜度门禁丢弃并从 raw 移除 ${staleItems.length} 条（旧闻/无日期/未来时间）`)
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

  // 续跑 / 接力——公平调度（2026-08-19 优化）：process 不得无限接力抢占 60s 冷却锁，
  // 否则当 news_raw 持续进料时 AI 阶段（及发布）会被彻底饿死（朱雀三号事故复盘）。
  // 下游积压（done 待发布 / AI 待加工过量）时先让位，由 run() 的下游优先闸门交棒。
  try {
    const left = await rawStore.pullPending({ limit: 1, cursorSkip: 0 })
    // 只要有下游积压，交给 run() 决策（pub/ai 优先）；否则有 raw 直接续 process
    if (await hasDownstreamBacklog()) { trigger('run'); return { stage: 'process', written, consumed, yielded: true } }
    if (left.items.length > 0) trigger('process')
    else trigger('run')
  } catch (e) {
    trigger('run')
  }
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
  // 方案 A（2026-08-21 owner 恢复）：AI 前每类 top-N 截断，从源头收敛到 <=47。
  //   说明：此前曾移除（549e713 认为截断时机不对），owner 复核后决定恢复到原 stage 阶段执行——
  //   AI 前按分类 finalScore 降序保留 recommend<=15/其余<=8，超限直接从 staging 删除，
  //   控制进入 AI 加工与最终落库的量（异常不阻断 AI 阶段）。
  try {
    await truncateStagingByCategory()
  } catch (e) {
    console.warn('[newsPipeline][ai] 方案A截断异常（放行）:', e.message)
  }
  while (hasBudget(deadline)) {
    const items = await stagingStore.claimPending(STAGE_BATCH.ai)
    if (!items.length) break
    const needAi = items

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

  // 续跑 / 接力——修复请求风暴：只统计「可认领」的待办（claimablePendingCount），
  // 不把正在被其他实例处理的 processing 误判为待办，避免空转触发
  // 优先级修正（2026-08-18）：本批刚标 done，若有 done 待落库，优先触发 publish「收割」，
  // 避免已完成 AI 的新数据被新一轮 ai 挤占 + 60s 冷却窗口而饿死、迟迟不落库。
  const sp = await stagingStore.claimablePendingCount()
  if (sp > 0) trigger('ai')
  else {
    const inflight = await stagingStore.pendingCount()
    const sd = await stagingStore.doneCount()
    if (inflight === 0 && sd > 0) trigger('publish')
    else if (inflight > 0) trigger('ai')
    else trigger('run')
  }
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
        titleFp: normTitleFp(item.title || ''), // 2026-08-24：跨源同主题指纹，随注入落库供后续判重
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
        cacheExpire: expireAt,
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
// 注入前与现有 cache 比较去重（owner 2026-08-24 拍板）
// --------------------------------------------------------------------
// 背景：多源转载同一新闻（URL 不同）会以多条注入 news_cache，用户反复看到同一内容。
// 做法：publish 注入前，把当前批次与【现有 news_cache】数据比较——
//   同 URL（归一化）或同标题指纹（跨源同主题）命中 → 从当前批次剔除（本次不注入）；
//   然后仍按原逻辑全量替换注入。剔除后为空 → 本轮不发布、保留现有 cache
//   （避免全清后 stale 兜底把旧数据带回，反而继续「反复看到」旧新闻）。
// 判重双键（owner 拍板）：标题归一化指纹 + 归一化 URL，任一命中即视为重复。
// ====================================================================

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex')
}

/** URL 归一化：去协议/尾斜杠/常见跟踪参数（与 newsFetcher fingerprint 同构），用于跨源同文判重 */
function normalizeUrl(url) {
  if (!url) return ''
  let u = String(url).trim()
  u = u.replace(/^(https?:\/\/)?/i, '').replace(/\/+$/, '')
  u = u.replace(/([?&])(utm_[a-z]+|spm|from|from_|source|ref)=[^&]*(&|$)/gi, '$1').replace(/[?&]+$/, '')
  return u
}

/** 标题归一化文本：保留中英文/数字，剥来源/标签前缀 + 去标点空白 + 常见噪音词。
 *  不同源对同一新闻的标题差异（「量子位 | xxx」「【重磅】xxx」「独家 xxx」等）不影响判重。 */
function normTitleText(title) {
  let n = String(title || '').toLowerCase().trim()
  // 剥【】/[] 括号块（媒体名/标签，如【重磅】）
  n = n.replace(/^[【\[][^】\]]*[】\]]\s*/, '')
  // 剥 "来源名 | 标题" 管道符来源段（全角｜统一，取最右侧段）
  n = n.replace(/[|｜]/g, '|')
  const pipeIdx = n.lastIndexOf('|')
  if (pipeIdx > 0 && pipeIdx < n.length - 1) n = n.slice(pipeIdx + 1).trim()
  // 去标点空白（保留中英文/数字）
  n = n.replace(/[^\u4e00-\u9fa5a-z0-9]+/g, '')
  // 去常见噪音词前缀
  n = n.replace(/^(独家|快讯|最新|今日|热点|早报|晚报|日报|重磅|ainews|breaking|update)/, '')
  return n
}

/** 标题归一化指纹（跨源同主题）：normTitleText 前 20 字符 → sha256 */
function normTitleFp(title) {
  const n = normTitleText(title).slice(0, 20)
  return n ? sha256(n).slice(0, 24) : ''
}

/** 归一化标题包含关系判重：较长标题完整包含较短标题（且长度比 ≤1.5）视为同一新闻。
 *  例：「苹果发布新iphone手机」⊃「苹果发布新iphone」→ 重复；
 *      「苹果发布新iphone」 vs 「苹果发布新ipad」互不包含 → 不重复（比字符 Jaccard 更准）。 */
function titleContainsDup(a, b) {
  if (a.length < 8 || b.length < 8) return false // 过短不判，防误伤
  const [longer, shorter] = a.length >= b.length ? [a, b] : [b, a]
  return longer.length <= shorter.length * 1.5 && longer.includes(shorter)
}

/**
 * 当前批次 vs 现有 news_cache 去重：命中现有判重键的条目从本批剔除。
 * @param {Array} items 当前待注入批次（已 done 的 staging 条目）
 * @returns {Promise<{items:Array, removed:number}>}
 */
async function dedupAgainstCache(items) {
  if (!items || !items.length) return { items, removed: 0 }
  const urlSet = new Set()
  const fpSet = new Set()
  const normTitles = [] // 现有 cache 的归一化标题，供包含关系兜底
  // 读现有 cache 的判重键（cache 总量受分类 cap 约束 ≤47，通常 1 页；分页兜底）
  try {
    for (let rounds = 0; rounds < MAX_PAGE_ROUNDS; rounds++) {
      const res = await db.collection('news_cache')
        .field({ sourceUrl: true, title: true })
        .limit(100)
        .get()
      const list = (res && res.data) || []
      if (!list.length) break
      for (const d of list) {
        const u = normalizeUrl(d.sourceUrl || '')
        if (u) urlSet.add(u)
        const fp = normTitleFp(d.title || '')
        if (fp) fpSet.add(fp)
        const nt = normTitleText(d.title || '')
        if (nt) normTitles.push(nt)
      }
      if (list.length < 100) break
    }
  } catch (e) {
    console.warn('[newsPipeline][publish] 读现有 cache 判重键失败（降级为仅批内去重）:', e.message)
    return { items, removed: 0 }
  }
  if (!urlSet.size && !fpSet.size && !normTitles.length) return { items, removed: 0 }

  const kept = []
  let removed = 0
  for (const it of items) {
    const u = normalizeUrl(it.sourceUrl || it.url || '')
    const fp = normTitleFp(it.title || '')
    const nt = normTitleText(it.title || '')
    let dup = Boolean(u && urlSet.has(u)) || Boolean(fp && fpSet.has(fp))
    if (!dup && nt) {
      dup = normTitles.some((ex) => titleContainsDup(ex, nt))
    }
    if (dup) {
      removed++
      continue
    }
    kept.push(it)
  }
  if (removed) {
    console.log(`[newsPipeline][publish] 与现有 cache 比较去重剔除 ${removed} 条（同 URL/同主题已在展示库），保留 ${kept.length} 条待注入`)
  }
  return { items: kept, removed }
}

// 注入前分类上限：评分后仍超量才按「质量分+新鲜度衰减分」从低到高淘汰；低于上限有多少展示多少。
function applyCategoryCaps(list) {
  const byCat = {}
  for (const it of (list || [])) {
    const cat = it.category || ''
    ;(byCat[cat] = byCat[cat] || []).push(it)
  }
  const now = Date.now()
  const out = []
  let trimmed = 0
  for (const cat of Object.keys(byCat)) {
    const items = byCat[cat]
    const cap = CATEGORY_CAP[cat] || DEFAULT_CAP
    if (items.length <= cap) { out.push(...items); continue }
    items.sort((a, b) => {
      const ea = effCacheScore(a, now)
      const eb = effCacheScore(b, now)
      if (eb !== ea) return eb - ea
      const ta = parseTs(a.publishTime) || 0
      const tb = parseTs(b.publishTime) || 0
      return tb - ta
    })
    out.push(...items.slice(0, cap))
    trimmed += items.length - cap
  }
  return { items: out, trimmed }
}

async function wipeNewsCache() {
  let removed = 0
  let rounds = 0
  while (++rounds <= MAX_PAGE_ROUNDS) {
    const res = await db.collection('news_cache').limit(100).get()
    const list = (res && res.data) || []
    if (!list.length) break
    await Promise.all(list.map((d) => db.collection('news_cache').doc(d._id).remove().catch(() => {})))
    removed += list.length
    if (list.length < 100) break
  }
  console.log(`[newsPipeline][publish] 注入前全量清理 news_cache ${removed} 条`)
  return removed
}

async function stagePublish(deadline) {
  // 本轮批次替换：staging 还有 pending/processing 时不得动 cache（半批次清空会冲掉刚写入的新数据）。
  // 全部 done 且无在途 AI 时：先全量物理清理，再按分类上限注入。
  const inflight = await stagingStore.pendingCount()
  if (inflight > 0) {
    console.log(`[newsPipeline][publish] 本轮仍有 ${inflight} 条 pending/processing，暂缓清 cache`)
    trigger('ai')
    return { stage: 'publish', deferred: true, reason: 'batch inflight', inflight }
  }

  const collected = await stagingStore.listDone()
  if (!collected.length) {
    trigger('run')
    return { stage: 'publish', skipped: true, reason: 'no qualified data — keep cache' }
  }

  // 2026-08-24 owner 拍板：注入前先与【现有 news_cache】比较去重——
  // 同 URL / 同标题指纹（跨源同主题）的重复条目从当前批次剔除，
  // 避免多源转载同一新闻被反复注入、用户反复看到旧内容。
  const dedupRes = await dedupAgainstCache(collected)
  if (!dedupRes.items.length) {
    // 空批保护：本批全部与现有 cache 重复 → 不发布、不清空、保留现有展示数据。
    // 被剔除条目的数据已在展示库，staging 消费删除（不堆积、不反复重试）。
    await stagingStore.removeStaged(collected.map((i) => i._id))
    console.log(`[newsPipeline][publish] 当前批次 ${collected.length} 条全部与现有 cache 重复，本轮不发布、保留现有 cache`)
    trigger('run')
    return { stage: 'publish', skipped: true, reason: 'all-duplicate-with-cache', removed: dedupRes.removed, from: collected.length }
  }

  const capped = applyCategoryCaps(dedupRes.items)
  try {
    await wipeNewsCache()
  } catch (e) {
    console.warn('[newsPipeline][publish] 全量清理失败，暂缓注入以免新旧混写:', e.message)
    trigger('publish')
    return { stage: 'publish', deferred: true, reason: 'wipe failed' }
  }
  let r
  try {
    r = await batchInsert(capped.items)
  } catch (e) {
    // 2026-08-22：注入失败（如集合异常）→ cache 已空，staging 未删（保留数据）。
    // 下一轮 selfHeal/publish 会用同批 done 重试，避免"cache 空 + staging 也丢"双丢失。
    console.error('[newsPipeline][publish] batchInsert 异常，staging 保留待重试:', (e && e.message) || e)
    trigger('publish')
    return { stage: 'publish', deferred: true, reason: 'insert failed, staging kept', error: (e && e.message) || '' }
  }
  await stagingStore.removeStaged(collected.map((i) => i._id))
  trigger('run')
  console.log(`[newsPipeline][publish] 批次替换完成 inserted=${r.inserted} trimmed=${capped.trimmed} from=${collected.length}`)
  return { stage: 'publish', published: r.inserted || 0, trimmed: capped.trimmed, from: collected.length }
}

// ====================================================================
// 公平调度闸门（2026-08-19 优化）：判定是否存在「下游积压」，若存在则 process
// 应让位给 publish/ai，避免 news_raw 单向进料把 AI/发布阶段饿死（朱雀事故根因）。
// 阈值设计：
//   - 有 done（staging 已完成 AI 待落库）→ 立即让位发布（数据已就绪，不落库=白算）
//   - claimablePending 超过 AI 单实例一次能吃的 ~3 倍（36 条）→ 判定 AI 明显落后，
//     停止 process 进料，先让 AI 消化存量，防止 staging 无限堆积
// ====================================================================
const AI_BACKLOG_LATE_THRESHOLD = STAGE_BATCH.ai * 3 // 36：AI 单实例一批 12，连续 3 批都追不上即落后
async function hasDownstreamBacklog() {
  try {
    const sd = await stagingStore.doneCount()
    if (sd > 0) return true // 有 done 待发布
    const sp = await stagingStore.claimablePendingCount()
    if (sp >= AI_BACKLOG_LATE_THRESHOLD) return true // AI 明显落后
  } catch (e) { /* 放行，返回 false，保持 process 默认行为 */ }
  return false
}

// ====================================================================
// 调度器 run()：幂等检查全局队列，触发下一个该跑的阶段
// ====================================================================
async function run() {
  // 公平调度：批次替换要求 pending/processing 清空后才 publish。
  //   done 且无在途 AI → 整批替换 cache
  //   AI 落后 / 有 pending → 先消化 AI
  //   有 raw → process
  const inflight = await stagingStore.pendingCount()
  const sd = await stagingStore.doneCount()
  if (sd > 0 && inflight === 0) { trigger('publish'); return { step: 'publish', reason: '本轮 AI 完成，批次替换 cache' } }
  const sp = await stagingStore.claimablePendingCount()
  if (sp > 0 || inflight > 0) { trigger('ai'); return { step: 'ai', reason: '先完成当前批次 AI', backlog: sp || inflight } }
  const rawP = await rawStore.pullPending({ limit: 1, cursorSkip: 0 })
  if (rawP.items.length > 0) { trigger('process'); return { step: 'process', reason: 'news_raw 有 pending' } }
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
