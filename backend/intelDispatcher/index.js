// 情报发布闸门 intelDispatcher（T4.1 / I · 推送编排）
// ============================================================
// ⚠️ 复用 intelProcess / intelRssPoll 的 self-fan-out 分批范式（非其业务）：
//    全局开关 + 自愈建表 + 读已处理完未发布的 intel_staged → 三层巡检编排 →
//    组装 rolling daily brief → 升级 isCurrent 指针。intel_* 命名空间隔离。
//
// 数据流（设计 §1.1 / § 7.2 / §7.4）：
//   intel_staged(ProcessedItem, releasedAt=空)  → 发布闸门 T 时刻
//     组装 Brief → 写 intel_current(isCurrent) 指针 → 用户端「AI 情报」页可见。
//
// 三次巡检编排（设计 §7.3）：
//   05:00 增量  取上次发布后新增且处理完 items → 写/更新当日 brief 初版（version=1）
//   11:00 增量  追加 05→11 新增 items 到当日 brief（version=2）；无新增不发布
//   18:00 汇总结案 从累积库组装全天汇总：今日关注=当日高/中相关，本周可试用清单=
//                 当周 tryable 滚动去重；升级为当日终版（version=3）；18 后锁定
//   无新增 → 不发布、不刷屏（"有则汇报、无则不打扰"）
//   次日 05:00 起新建一份（按北京日滚转，单日一份 Brief）
//
// 模式判定：默认按当前北京时刻自动落 05/11/18 档；也允许 event.mode 覆盖
//   （联调 / 手动 / 重试补发用，对齐 self-fan-out 触发编排的方式）。
//
// 输出组装（设计 §7.5 + §6.3 固定模板）：
//   - 🔹 今日关注：当日高/中相关 items，逐条 SOP 五步卡片，按场景命中强度排序；
//     合同/接口变更条目（§6.7 已广播 commlog）置顶呈现。
//   - 🔹 本周可试用清单：当周 tryable=true 的 items 滚动去重，渲染为可勾选清单。
//
// 健康度兜底（设计 §7.7）：
//   - 源当日全失败 → brief 顶部标「部分源今日未更新（待验证）」
//   - 处理层大面积失败 → 出「今日无可靠更新」占位，避免空页
//   - 指针升级失败 → 重试；仍失败则告警，下一期补发（下轮巡检自动纳入）
//
// 部署注意：本函数 require('../common/ensureSchema') 与 require('../common/intelRouter')，
//   部署云函数时需将 backend/common/ 一并上传。
// ============================================================

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const { ensureSchema } = require('../common/ensureSchema')
const router = require('../common/intelRouter')

// ─── 集合名（intel_* 命名空间）───
const INTEL_STAGED = 'intel_staged'      // 处理层产物（status=staged/released, releasedAt）
const INTEL_CURRENT = 'intel_current'    // 用户可见 Brief（isCurrent 指针，§8.2/§7.2）
const INTEL_CURRENT_ARCHIVE = 'intel_current_archive' // 2026-08-19 复盘：历史 Brief 归档（版本可追溯/回滚）
const INTEL_SOURCES = 'intel_sources'    // 源注册表 + 健康度（sourceHealth 快照）
const INTEL_CONFIG = 'intel_config'      // 全局开关 / 指针记录

// ─── 阈值（对齐 intelProcess / intelRssPoll 分批范式）───
const BATCH_LIMIT = 30        // 单批纳入 brief 的条目数（防单实例串行超 60s）
const MODE_HOURS = { 5: 'increment', 11: 'increment', 18: 'summary' }

// ─── 时段判定基准：本系统为北京时区（定时器按北京时间触发）───
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/** 北京时区的本地时钟（用于日/周/时段判定，不改变真实存储时间） */
function beijingNow() {
  return new Date(Date.now() + BEIJING_OFFSET_MS)
}

/** 北京日期 YYYY-MM-DD */
function beijingDateKey(d = beijingNow()) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 将存储的 ISO 时间还原为北京时刻的 Date（用于跨时区比较） */
function fromIsoBeijing(iso) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : new Date(t + BEIJING_OFFSET_MS)
}

/** ISO 转北京日期字符串 */
function beijingDateOfIso(iso) {
  const d = fromIsoBeijing(iso)
  return d ? beijingDateKey(d) : ''
}

/** 本周（北京，周一为一周之始）起始的 ISO UTC 时间戳 */
function weekStartIso() {
  const now = beijingNow()
  // getUTCDay(): 0=Sun..6=Sat；周一=1
  let dow = now.getUTCDay()
  if (dow === 0) dow = 7 // 周日归上周
  const start = new Date(now.getTime() - (dow - 1) * 86400000)
  start.setUTCHours(0, 0, 0, 0)
  return new Date(start.getTime() - BEIJING_OFFSET_MS).toISOString()
}

/** 依据当前北京小时判定默认 mode；EVENT.mode 可覆盖（联调/重试） */
function resolveMode(event) {
  if (event && typeof event.mode === 'string' && ['increment', 'summary'].includes(event.mode)) {
    return event.mode
  }
  const h = beijingNow().getUTCHours()
  return MODE_HOURS[h] || 'summary' // 非三档默认按汇总结案兜底（避免漏发）
}

/** 读全局开关（对齐 intelProcess：intel_config 文档 on=false 时跳过，force 强制执行） */
async function readSwitch(docId, force) {
  try {
    const cfg = await db.collection(INTEL_CONFIG).doc(docId).get().catch(() => null)
    if (cfg && cfg.data && cfg.data.on === false && !force) {
      return false
    }
  } catch (e) { /* 无开关则默认开 */ }
  return true
}

// ─── 读已处理完、未发布的 staged 条目（releasedAt 空 + high/medium）───
async function fetchUnreleased(limit) {
  const _ = db.command
  try {
    const res = await db.collection(INTEL_STAGED)
      .where({
        status: 'staged',
        releasedAt: _.exists(false), // releasedAt 字段不存在（尚未发布）
        relevance: _.in(['high', 'medium']),
      })
      .orderBy('processedAt', 'asc') // 先处理先生效，保证 05→11 追加顺序
      .limit(limit)
      .get()
    return res.data || []
  } catch (e) {
    // releasedAt:exists(false) 在部分版本可能需要 or 查询，改用显式空值兜底
    try {
      const res = await db.collection(INTEL_STAGED)
        .where({ status: 'staged', relevance: _.in(['high', 'medium']) })
        .orderBy('processedAt', 'asc')
        .limit(limit)
        .get()
      const out = (res.data || []).filter((d) => !d.releasedAt)
      return out
    } catch (e2) {
      console.warn('[intelDispatcher] 读 unreleased staged 失败:', e2.message)
      return []
    }
  }
}

// ─── 读取【今日】已纳入 brief 的全部高/中相关 items（用于 18 汇总结案 / 增量追加）───
async function fetchTodayReleasedItems(dayKey) {
  const _ = db.command
  try {
    // releasedAt 落在今天的 staged（已发布的、今日的）→ 今日关注
    const res = await db.collection(INTEL_STAGED)
      .where({ status: 'released', relevance: _.in(['high', 'medium']) })
      .orderBy('processedAt', 'asc')
      .limit(200)
      .get()
    return (res.data || []).filter((d) => beijingDateOfIso(d.releasedAt || d.processedAt) === dayKey)
  } catch (e) {
    return []
  }
}

// ─── 本周可试用清单：当周 tryable=true 滚动去重（周一清零）───
async function fetchWeekTryable() {
  const _ = db.command
  const weekStart = weekStartIso()
  try {
    const res = await db.collection(INTEL_STAGED)
      .where({ status: 'released', tryable: true, releasedAt: _.gte(weekStart) })
      .orderBy('releasedAt', 'asc')
      .limit(200)
      .get()
    const seen = new Set()
    const out = []
    for (const d of res.data || []) {
      if (seen.has(d.itemId)) continue
      seen.add(d.itemId)
      out.push(d)
    }
    return out
  } catch (e) {
    console.warn('[intelDispatcher] 读本周可试用清单失败:', e.message)
    return []
  }
}

// ─── 标记已发布：置 releasedAt + status=released（§7.2 发布闸门）───
async function markReleased(stagedItems, dayKey) {
  const releasedAt = new Date().toISOString()
  for (const d of stagedItems) {
    try {
      await db.collection(INTEL_STAGED)
        .where({ itemId: d.itemId })
        .update({ data: { status: 'released', releasedAt, publishDay: dayKey } })
    } catch (e) { /* 非阻塞 */ }
  }
}

// ─── sourceHealth 快照（设计 §7.7）：今日在产源的健康度，失败源标「待验证」───
async function snapshotSourceHealth(dayKey) {
  try {
    const res = await db.collection(INTEL_SOURCES).limit(100).get()
    const arr = res.data || []
    return arr.map((s) => {
      const h = (s && s.health) || {}
      const status = String(h.status || 'ok')
      const degraded = status === 'failed' || (h.consecutiveFails || 0) > 0
      return {
        key: s.key || '',
        name: s.name || s.key || '',
        layer: s.layer || '',
        status,
        consecutiveFails: h.consecutiveFails || 0,
        lastError: h.lastError || '',
        // 失败源 → 用户可见「待验证」
        banner: degraded ? '待验证' : 'ok',
      }
    }).filter((s) => s.key)
  } catch (e) {
    console.warn('[intelDispatcher] 快照源健康度失败:', e.message)
    return []
  }
}

/** 计算源健康标签：有失败/待验证源 → 顶部提示；全失败 → 强提示 */
function healthSummary(sourceHealth) {
  if (!sourceHealth || !sourceHealth.length) return { flag: 'none', banner: '' }
  const failed = sourceHealth.filter((s) => s.banner === '待验证').length
  const total = sourceHealth.length
  if (failed === total) {
    return { flag: 'all-failed', banner: '部分源今日未更新（待验证）' }
  }
  if (failed > 0) {
    return { flag: 'partial', banner: '部分源今日未更新（待验证）' }
  }
  return { flag: 'none', banner: '' }
}

// ─── 排序：合同/接口变更置顶，其余按场景命中强度降序 ───
function rankItems(items) {
  const pinned = []
  const normal = []
  for (const d of items) {
    let contract = Boolean(d.contract)
    if (!contract) {
      // 用 router 信号词对已完成条目标题/溯源再判一次（兼容阶段未显式打标）
      const hit = router.score(d, null) || {}
      contract = Boolean(hit.contract)
    }
    if (contract) { d.contract = true; pinned.push(d); continue } // 写回打标，供渲染置顶
    normal.push(d)
  }
  const byStrength = (a, b) => {
    const ah = Number(a.sceneHits || 0)
    const bh = Number(b.sceneHits || 0)
    if (bh !== ah) return bh - ah
    return a.publishedAt && b.publishedAt ? (new Date(b.publishedAt) - new Date(a.publishedAt)) : 0
  }
  normal.sort(byStrength)
  pinned.sort(byStrength)
  return pinned.concat(normal)
}

/** 将单条 ProcessedItem 渲染为 §6.3 固定模板片段 */
function renderItemCard(d) {
  const s = (d && d.sop) || {}
  const src = (s.source) || {}
  const link = d.url || src.url || ''
  const linkText = link ? `[${link}](${link})` : '无链接'
  const definition = s.definition ? String(s.definition).trim() : ''
  const sceneMapping = s.sceneMapping ? String(s.sceneMapping).trim() : ''
  const practice = s.practice ? String(s.practice).trim() : ''
  const minAction = s.minAction ? String(s.minAction).trim() : ''
  const pinned = Boolean(d.contract) ? '\n> ⭐ 合同 / 接口变更 · 需重点关注' : ''
  return (
`### ${d.title || '（无标题）'}${pinned}
- **溯源**：${src.name || d.sourceId || '未知来源'} · ${src.publishedAt || d.publishedAt || ''} · ${linkText}
- **一句话**：${definition}
- **对老赵的意义**：${sceneMapping}
- **可以怎么做**：${practice}
- **最小行动**：${minAction}`
  )
}

/** 2026-08-19 复盘：brief 只收录近 7 天内容——官方源（DeepSeek 等）历史全量不进今日关注 */
function passFreshness(d) {
  const raw = d.publishedAt || (d.sop && d.sop.source && d.sop.source.publishedAt) || ''
  if (!raw) return true // 无日期不拦截（交由 relevance 把关）
  const t = new Date(raw).getTime()
  if (Number.isNaN(t)) return true
  return Date.now() - t <= 7 * 24 * 3600 * 1000
}

/** 组装最终 Brief 的 items[]（今日关注）+ tryable[]（本周可试用） */
function renderBrief(todayItems, weekTryable) {
  // 今日关注 = 今日全部高/中相关 items（05 初版+11 追加+18 汇总），合同置顶、按场景排序
  const rank = rankItems(todayItems.filter(passFreshness))
  const items = rank.map((d, i) => ({
    rank: i + 1,
    itemId: d.itemId,
    title: d.title,
    url: d.url,
    sourceId: d.sourceId,
    sourceName: (d.sop && d.sop.source && d.sop.source.name) || (d.sourceId ? String(d.sourceId).replace(/_+/g, ' ') : '未知来源'),
    publishedAt: d.publishedAt || (d.sop && d.sop.source && d.sop.source.publishedAt) || '',
    relevance: d.relevance,
    sceneTags: d.sceneTags || [],
    sceneHits: d.sceneHits || 0,
    contract: Boolean(d.contract),
    card: renderItemCard(d), // §6.3 固定模板已渲染片段
    degraded: !(d.sop && d.sop.definition && String(d.sop.definition).trim()), // 定义缺失标记，供剔除/展示降级(2026-08-19 治理)
  })).filter(function (it) { return !it.degraded }) // 定义缺失条目剔除，不显示占位文案

  // 本周可试用清单 = 当周 tryable 滚动去重
  const tryable = weekTryable.map((d) => ({
    itemId: d.itemId,
    title: d.title,
    url: d.url,
    sourceId: d.sourceId,
    minAction: (d.sop && d.sop.minAction) || (d.sop && d.sop.definition) || '试一下',
    releasedAt: d.releasedAt,
  }))

  return { items, tryable }
}

/** 写或升级当日 Brief：clear 旧 isCurrent → 写新 Brief(isCurrent=true) 到 intel_current */
async function persistBrief(dayKey, brief) {
  let docId = ''
  // ① 旧的当日 brief 若存在并已在 isCurrent → 清掉 isCurrent（指针迁移）
  try {
    await db.collection(INTEL_CURRENT).where({ isCurrent: true }).update({ data: { isCurrent: false } })
  } catch (e) { /* 无则忽略 */ }

  // ② 若当日已有 doc（同一天多次巡检：05→11→18）→ 覆盖该 doc 的版本字段
  const found = await findTodayBrief(dayKey)
  if (found && found._id) {
    docId = found._id
    // 2026-08-19 复盘：覆盖前把旧版快照归档，历史 Brief 可追溯/回滚
    try {
      const archive = Object.assign({}, found, { archivedAt: new Date().toISOString(), archiveNote: `superseded-by-v${brief.version}` })
      delete archive._id
      await db.collection(INTEL_CURRENT_ARCHIVE).add({ data: archive }).catch(() => {})
    } catch (e) { /* 归档失败不阻塞发布 */ }
    try {
      await db.collection(INTEL_CURRENT).doc(found._id).update({ data: brief })
      console.log(`[intelDispatcher] 更新当日 brief v${brief.version} (${dayKey})`)
      return docId
    } catch (e) {
      console.warn('[intelDispatcher] 更新当日 brief 失败，改为新增:', e.message)
    }
  }
  // ③ 新增
  const add = await db.collection(INTEL_CURRENT).add({ data: brief })
  docId = add._id || ''
  console.log(`[intelDispatcher] 新建当日 brief v${brief.version} (${dayKey})`)
  return docId
}

/** 查找当日 Brief（用于 05→11→18 同一份的追加升级） */
async function findTodayBrief(dayKey) {
  const _ = db.command
  try {
    const res = await db.collection(INTEL_CURRENT)
      .where({ date: _.eq(dayKey) })
      .orderBy('version', 'desc')
      .limit(1)
      .get()
    return (res.data && res.data[0]) || null
  } catch (e) {
    return null
  }
}

/** 升级指针记录（§7.2 currentIssueId；写 intel_config 供用户端/运维 O(1) 读取 + §7.7 补发） */
async function upgradePointer(dayKey, docId, version, mode) {
  const data = { currentIssueId: docId, date: dayKey, version, mode, upgradedAt: new Date().toISOString() }
  // 重试（§7.7）：指针升级失败先重试 2 次
  for (let i = 0; i < 3; i++) {
    try {
      await db.collection(INTEL_CONFIG).doc('intel_current_issue').set({ data })
      console.log(`[intelDispatcher] 指针升级 OK → doc=${docId} v${version} (${dayKey})`)
      return { ok: true, docId }
    } catch (e) {
      console.warn(`[intelDispatcher] 指针升级第 ${i + 1} 次失败:`, e.message)
    }
  }
  // 仍失败 → §7.7 告警；isCurrent 已置 true，下期巡检 findTodayBrief 也会自动纳入补发
  console.error('[intelDispatcher] ⚠️ 指针升级失败（已重试3次），告警 + 下期巡检自动补发')
  return { ok: false, docId }
}

// ─── 巡检编排：增量 05 / 11 与 汇总结案 18（设计 §7.3）───
async function runInspection(mode, dayKey) {
  if (mode === 'increment') {
    return await runIncremental(dayKey)
  }
  return await runSummary(dayKey)
}

/** 增量巡检（05 初版 / 11 追加）：取本次新增且已处理完未发布的 items，无新增不发布 */
async function runIncremental(dayKey) {
  const newItems = await fetchUnreleased(BATCH_LIMIT)

  if (!newItems.length) {
    console.log(`[intelDispatcher] ${dayKey} 增量无新增，本轮不发布`)
    return { ok: true, published: false, note: 'no-new-items', dayKey }
  }

  // 找出当日已有 brief（存在则追加，否则新建初版）
  const prior = await findTodayBrief(dayKey)
  const priorVersion = (prior && prior.version) || 0

  // 新增 items 组装进当日 brief（今日关注 = 老 items + 新 items 重排）
  const merged = [...priorItemsMapped(prior), ...newItems]
  const todayReleased = await fetchTodayReleasedItems(dayKey)
  const allRank = rankItems(mergeByItemId(todayReleased, merged))
  const weekTryable = await fetchWeekTryable()
  const sourceHealth = await snapshotSourceHealth(dayKey)
  const health = healthSummary(sourceHealth)

  const rendered = renderBrief(allRank, weekTryable)
  const version = priorVersion + 1
  // owner 2026-08-19：数据截至展示「批次抓取时间」——从 intel_health 最新 inspection 记录读
  let batchFetchedAt = new Date().toISOString()
  try {
    const hq = await db.collection('intel_health').where({ kind: 'inspection' }).orderBy('createdAt', 'desc').limit(1).get()
    if (hq.data && hq.data[0] && hq.data[0].createdAt) batchFetchedAt = hq.data[0].createdAt
  } catch (e) { console.warn('[intelDispatcher] 读批次抓取时间失败，回退 now:', e.message) }
  const brief = {
    date: dayKey,
    version,
    mode: 'increment',
    batchFetchedAt,
    items: rendered.items,
    tryable: rendered.tryable,
    generatedAt: new Date().toISOString(),
    sourceHealth,
    healthFlag: health.flag,
    banner: health.banner,
    isCurrent: true,
  }

  const docId = await persistBrief(dayKey, brief)
  await markReleased(newItems, dayKey) // 发布后置 releasedAt（§7.2）

  const pointer = await upgradePointer(dayKey, docId, version, 'increment')

  // self-fan-out：仍有很多未发布 → 续跑补齐（对齐 intelProcess 范式，防 60s 超时）
  const remaining = await countUnreleased()
  if (remaining > 0 && !eventRef.disableFanout) {
    console.log(`[intelDispatcher] 仍有 ${remaining} 条未发布，自我分片续跑`)
    cloud.callFunction({ name: 'intelDispatcher', data: { mode: 'increment', disableFanout: true } })
      .then(() => {}).catch(() => {})
  }

  return { ok: true, published: true, mode: 'increment', version, added: newItems.length, remaining, pointer, dayKey }
}

/** 汇总结案（18:00）：从累积库组装全天汇总，出当日终版；18 后锁定 */
async function runSummary(dayKey) {
  // 全天高/中相关已发布 items（今日关注）
  const todayItems = await fetchTodayReleasedItems(dayKey)
  // 本周可试用清单（当周 tryable 滚动去重）
  const weekTryable = await fetchWeekTryable()
  const sourceHealth = await snapshotSourceHealth(dayKey)
  const health = healthSummary(sourceHealth)
  // owner 2026-08-19：数据截至展示「批次抓取时间」——从 intel_health 最新 inspection 记录读
  let batchFetchedAt = new Date().toISOString()
  try {
    const hq = await db.collection('intel_health').where({ kind: 'inspection' }).orderBy('createdAt', 'desc').limit(1).get()
    if (hq.data && hq.data[0] && hq.data[0].createdAt) batchFetchedAt = hq.data[0].createdAt
  } catch (e) { console.warn('[intelDispatcher] 读批次抓取时间失败，回退 now:', e.message) }

  // 处理层大面积失败 → 出「今日无可靠更新」占位（§7.7）
  const todayNew = await fetchUnreleased(BATCH_LIMIT)
  if (!todayItems.length && !todayNew.length && health.flag === 'all-failed') {
    const brief = {
      date: dayKey,
      version: 0,
      mode: 'summary',
      batchFetchedAt,
      items: [],
      tryable: [],
      generatedAt: new Date().toISOString(),
      sourceHealth,
      healthFlag: 'all-failed',
      banner: '今日无可靠更新 · 部分源今日未更新（待验证）', // §7.7 占位，不静默丢弃也不伪造
      placeholder: true,
      isCurrent: true,
    }
    const docId = await persistBrief(dayKey, brief)
    await upgradePointer(dayKey, docId, 0, 'summary')
    return { ok: true, published: true, mode: 'summary', placeholder: true, dayKey }
  }

  // 当日全无可发布内容 → 不发布、不刷屏
  if (!todayItems.length && !todayNew.length) {
    return { ok: true, published: false, note: 'no-content', dayKey }
  }

  const prior = await findTodayBrief(dayKey)
  const priorVersion = (prior && prior.version) || 0
  // 汇总结案须纳入：当日已发布 items + 最新窗口尚未纳入 brief 的未发布 items（含 05/11 no-op 情形）
  const allToday = mergeByItemId(todayItems, todayNew)
  const rendered = renderBrief(allToday, weekTryable)

  // 汇总结案 = 当日终版（version 递增，mode=summary）
  const version = priorVersion + 1
  const brief = {
    date: dayKey,
    version,
    mode: 'summary',
    batchFetchedAt,
    items: rendered.items,
    tryable: rendered.tryable,
    generatedAt: new Date().toISOString(),
    sourceHealth,
    healthFlag: health.flag,
    banner: health.banner,
    locked: true,     // §7.3 18:00 后当日 brief 锁定
    isCurrent: true,
  }

  const docId = await persistBrief(dayKey, brief)
  await markReleased(todayNew, dayKey)
  const pointer = await upgradePointer(dayKey, docId, version, 'summary')

  return { ok: true, published: true, mode: 'summary', version, items: rendered.items.length, tryable: rendered.tryable.length, pointer, dayKey }
}

/** 造出今日关注合并列表（供增量排重用）——从 prior.items 还原为「原始 ProcessedItem」占位 */
function priorItemsMapped(prior) {
  if (!prior || !Array.isArray(prior.items)) return []
  // 增量时 prior.items 已渲染为对象（含 itemId/title/url/relevance...），
  // 直接作为「已入 brief」参与合并去重与重排（不再调用 LLM）
  return prior.items.filter((d) => d && d.itemId)
}

/** 按 itemId 合并去重（新数据优先覆盖旧数据） */
function mergeByItemId(listA, listB) {
  const map = new Map()
  for (const d of listA) if (d && d.itemId) map.set(d.itemId, d)
  for (const d of listB) if (d && d.itemId) map.set(d.itemId, d)
  return Array.from(map.values())
}

/** 统计仍未发布的 staged 高/中相关条目数 */
async function countUnreleased() {
  const _ = db.command
  try {
    const c = await db.collection(INTEL_STAGED).where({ status: 'staged', relevance: _.in(['high', 'medium']) }).count()
    // 粗计数（含已发布但暂态标签滞后的），仅用于是否续跑判据
    return (c && c.total) || 0
  } catch (e) {
    return 0
  }
}

// 运行时 event 引用：供 self-fan-out 分支读取 disableFanout
let eventRef = {}

/**
 * 主入口 = 发布闸门编排。
 * event.mode 可选（increment/summary），省略则按当前北京时刻自动落 05/11/18 档。
 * event.force 强制执行；event.disableFanout 关闭自我分片（联调）。
 */
exports.main = async (event = {}) => {
  eventRef = event
  const now = new Date().toISOString()
  const force = event.force === true
  const mode = resolveMode(event)
  const dayKey = beijingDateKey()

  // 全局开关（对齐 intelProcess / worker：intel_config 文档 on=false 跳过）
  const on = await readSwitch('intel_dispatcher_switch', force)
  if (!on) {
    console.log('[intelDispatcher] 全局已关闭，本轮跳过')
    return { ok: true, skipped: true, reason: 'global-off' }
  }

  await ensureSchema()

  console.log(`[intelDispatcher] 巡检 mode=${mode} day=${dayKey} @ ${now}`)
  const result = await runInspection(mode, dayKey)
  return { ok: true, mode, dayKey, ...result }
}

// 导出纯逻辑助手便于本地单测（云函数仅需 exports.main）
module.exports = { main: exports.main, beijingDateKey, weekStartIso, resolveMode, rankItems, renderItemCard, renderBrief, healthSummary, beijingDateOfIso }
