/**
 * newsIngestStore.js — 统一多源聚合 · 瞬时中间集合 news_ingest（共享底座）
 * ============================================================
 * 对齐《统一多源新闻聚合技术架构方案》§4.1 / A.4 / A.5（2026-08-11 owner 确认）。
 *
 * ## 定位
 * 所有渠道（AI 搜索 / 聚合 juhe / 天行 tianxing / 官方 RSS / 未来新源）统一接入后的
 * 瞬时 staging 集合，供第②层 qualityGate（质量评分/去重/敏感过滤/精选）与
 * 第③层 AI 加工（清洗/摘要/解读）消费。
 *
 * ## 生命周期
 * - 它是「瞬时」集合：每条带 expireAt（TTL 3 天），且 A.4/A.5 规定官方 RSS 原文
 *   （content）仅作 AI 加工源数据，批次处理完成即清除，不留底。
 * - 本模块只提供「数据模型 + 自愈建表 + 写入 + 清理」的共享底座基础设施，
 *   不实现 qualityGate 的评分/敏感/精选逻辑（由独立角色负责）。
 *
 * ## 版权红线（A.4 重大修订，替代旧"不抓正文"表述）
 * - 官方 RSS【允许抓取原文全文 content】作为 AI 加工源数据；
 * - ❌ 不向用户展示原文　❌ 不持久化（批次后清除）。
 * - 落库 news_cache 的条目 contentSource=ai_interpretation，保留 sourceUrl 跳源站 H5。
 * ============================================================
 */

const cloud = require('wx-server-sdk')
const { sha256, normalizeUrl, cleanTitle } = require('./fingerprint')

// ── 常量 ──
// TTL：数据自写入起保留时长（方案 §4.1：如 3 天）。瞬时 staging，超期即可清除。
const TTL_MS = 3 * 24 * 60 * 60 * 1000
// 清理单次上限（避免一次删除过多拉高配额，消费方可循环多次分批清空）
const CLEAN_BATCH = 100

/** 集合访问器 */
function col() {
  return cloud.database().collection('news_ingest')
}

/**
 * ## 数据模型（对齐方案 §4.1 + A.4/A.5）
 *
 * | 字段          | 类型          | 说明 |
 * |---------------|---------------|------|
 * | sourceType    | string        | 'official_rss'/'ai_search'/'juhe'/'tianxing'/'new_source' |
 * | sourceName    | string        | 来源名（如 '新华社'/'中新网'） |
 * | title         | string        | 标题（已清洗） |
 * | summary       | string        | 源站自带摘要（无则 ''） |
 * | url           | string        | 原文链接（RSS/AI 有；聚合/天行可能空——A.2 无 URL 将在 qualityGate 丢弃） |
 * | content       | string|null   | 原文全文。官方 RSS 允许抓（A.5）；恒为瞬时源数据，批次后清除 |
 * | category      | string        | 源自身分类（如 finance/tech/社会…） |
 * | publishTime   | string        | 源站发布时间 |
 * | fetchedAt     | string        | 抓取/汇入时间（ISO） |
 * | titleFp       | string        | 标题归一化 sha256 指纹（跨源去重键） |
 * | urlFp         | string        | URL 归一化 sha256 指纹（跨源去重键） |
 * | qualityScore  | number/null   | 质量评分（qualityGate 产出；写入默认 null） |
 * | sensitive     | boolean/null  | 是否命中敏感词（qualityGate 产出；默认 null） |
 * | status        | string        | 'pending'/'processed'/'discarded' |
 * | expireAt      | string        | ISO 时间，=fetchedAt+TTL，超期可清理 |
 *
 * 说明：
 * - titleFp/urlFp 复用 validator.js 指纹工具，与 news_raw_official 口径一致，跨源去重键统一。
 * - qualityScore/sensitive 由第②层 qualityGate 回填；本模块只建字段、不计算。
 * - _id 用 `ingest_${urlFp}`（有 URL 时）或 `ingest_${sha256(titleFp+fetchedAt)}` 兜底，保证瞬时 staging 幂等可写。
 */

/**
 * 把一条统一原始条目（方案 §3.1 适配器输出形态）规整成 news_ingest 落库文档。
 * @param {Object} input - { sourceType, sourceName, title, summary, url, content, category, publishTime, fetchedAt }
 * @returns {Object} doc
 */
function buildInputDoc(input) {
  const now = new Date()
  const fetchedAt = input.fetchedAt || now.toISOString()
  const title = cleanTitle(input.title || '')
  const urlFp = sha256(normalizeUrl(input.url || ''))
  const titleFp = sha256(title)
  const expireAt = new Date(now.getTime() + TTL_MS).toISOString()

  const doc = {
    sourceType: String(input.sourceType || 'official_rss'),
    sourceName: String(input.sourceName || ''),
    title,
    summary: String(input.summary || ''),
    url: String(input.url || ''),
    // 原文全文：官方 RSS 允许抓取作为 AI 加工源数据；瞬时，批次后清除（A.4/A.5）
    content: input.content == null ? '' : String(input.content),
    category: String(input.category || ''),
    publishTime: String(input.publishTime || input.pubDate || ''),
    fetchedAt,
    titleFp,
    urlFp,
    // qualityGate 回填字段，写入时置空
    qualityScore: input.qualityScore != null ? input.qualityScore : null,
    sensitive: input.sensitive != null ? input.sensitive : null,
    status: 'pending',
    expireAt,
  }

  // _id：有真实 URL 时用 `ingest_${urlFp}`（幂等去重）；无 URL 时用 `ingest_${titleFp+fetchedAt}` 兜底
  // 注意 urlFp 恒为 64 位 hash（空串也 hash 成非空），故用「原始 url 是否非空」判断，而非 urlFp 是否非空。
  const hasRealUrl = !!(input.url && String(input.url).trim())
  doc._id = hasRealUrl
    ? `ingest_${urlFp}`
    : `ingest_${sha256(titleFp + fetchedAt)}`
  return doc
}

/**
 * 确保 news_ingest 集合存在并重建基础索引（幂等，可多次调用）。
 * 对齐 initSchema 的「日志内自愈建表」模式。
 * 注：createIndex 在 wx-server-sdk 新版不可用，索引建不上时依赖应用层去重兜底，不阻断主流程。
 * @returns {Promise<void>}
 */
async function ensureNewsIngest() {
  try {
    await db().createCollection('news_ingest')
    console.log('[newsIngestStore] 已创建集合 news_ingest')
  } catch (e) {
    if (isSoftErr(e)) {
      // 已存在，继续
    } else {
      console.warn('[newsIngestStore] 创建 news_ingest 失败（非阻塞）:', (e && e.message) || e)
    }
  }

  // 索引（幂等；建不上靠应用层兜底）。核心去重键 titleFp/urlFp，清理键 expireAt。
  const indexes = [
    { key: { expireAt: 1 }, name: 'expireAt', unique: false }, // TTL 清理扫描
    { key: { urlFp: 1 }, name: 'urlFp', unique: true },
    { key: { titleFp: 1 }, name: 'titleFp', unique: true },
    { key: { status: 1 }, name: 'status', unique: false },     // processed 批次清除扫描
    { key: { fetchedAt: 1 }, name: 'fetchedAt', unique: false },
  ]
  for (const idx of indexes) {
    try {
      await col().createIndex({ keys: idx.key, name: idx.name, unique: idx.unique })
      console.log(`[newsIngestStore] 索引 ${idx.name} 已就绪`)
    } catch (e) {
      if (isSoftErr(e)) {
        // 已存在
      } else {
        console.warn(`[newsIngestStore] 建索引 ${idx.name} 失败（非阻塞，应用层去重兜底）:`, (e && e.message) || e)
      }
    }
  }
}

/**
 * 批量写入统一原始条目（幂等：_id 冲突即跳过，视为已存在）。
 * @param {Array<Object>} items - 每条为 buildInputDoc 的输入形态（§3.1 统一原始条目）
 * @returns {Promise<{written:number, failed:number, total:number}>}
 */
async function pushItems(items) {
  let written = 0
  let failed = 0
  if (!items || !items.length) return { written, failed, total: 0 }

  for (const raw of items) {
    const doc = buildInputDoc(raw)
    try {
      await col().add({ data: doc })
      written++
    } catch (e) {
      const msg = (((e && (e.errMsg || e.message)) || '')).toString()
      if (msg.includes('duplicate') || msg.includes('already') || msg.includes('11000') || msg.includes('-502001')) {
        written++ // _id 冲突 = 已存在，幂等跳过
      } else {
        failed++
        console.warn(`[newsIngestStore] 写入失败(${doc.sourceType}/${doc.sourceName}):`, (e && e.message) || e)
      }
    }
  }
  return { written, failed, total: items.length }
}

/**
 * 清理过期（expireAt < now）的瞬时 staging 数据。TTL 自动清理的应用层实现。
 * 供消费方在批次处理结束后调用（A.5：处理即删），或由定时器周期调用。
 * @param {number} [maxDelete] 单次删除上限（默认 CLEAN_BATCH）
 * @returns {Promise<{deleted:number, remaining:number}>}
 */
async function cleanupExpired(maxDelete = CLEAN_BATCH) {
  const now = new Date().toISOString()
  let deleted = 0
  // 循环分批删除，命中上限即停，返回 remaining 供调用方决定是否继续
  for (;;) {
    let toDelete = []
    try {
      const res = await col()
        .where({ expireAt: cloud.database().command.lt(now) })
        .field({ _id: true })
        .limit(Math.min(maxDelete - deleted, CLEAN_BATCH))
        .get()
      toDelete = (res && res.data) || []
    } catch (e) {
      // 集合不存在等软错：视为无数据可清
      break
    }
    if (!toDelete.length) break
    for (const d of toDelete) {
      try {
        await col().doc(d._id).remove()
        deleted++
      } catch (e) {
        // 单条删除失败忽略，继续
      }
    }
    if (deleted >= maxDelete) break
  }
  return { deleted, remaining: Math.max(maxDelete - deleted, 0) }
}

/**
 * 移除指定 transient 条目 —— A.5「批次后统一删除源数据」的精确删口。
 * 供第②层 qualityGate / 第③层 AI 加工在批次写 news_cache 后，精准清除已消费的 staging 数据。
 *
 * 注意：doc._id 规则为 `ingest_${urlFp}`（优先 URL）或 `ingest_${sha256(titleFp+fetchedAt)}`（无 URL 兜底，
 * 含 fetchedAt，因缺少该信息无法仅凭 titleFp 逆推）。故本函数**只接受精确 _id 或 urlFp**，
 * titleFp 单独无法定位文档，调用方应传删除对象完整的 _id（或 urlFp 主分流）。
 * @param {Array<{_id?:string, urlFp?:string}>} keys
 * @returns {Promise<{removed:number, tried:number, skipped:number}>}
 */
async function removeByFingerprint(keys) {
  let removed = 0
  let tried = 0
  let skipped = 0
  if (!keys || !keys.length) return { removed, tried, skipped }

  for (const k of keys) {
    let targetId
    if (k && k._id) {
      targetId = k._id
    } else if (k && k.urlFp && String(k.urlFp).trim()) {
      targetId = `ingest_${k.urlFp}`
    } else {
      // 既无 _id 也无真实 urlFp：无法安全定位，跳过而非误删
      skipped++
      continue
    }
    tried++
    try {
      await col().doc(targetId).remove()
      removed++
    } catch (e) {
      // 不存在/已删：忽略
    }
  }
  return { removed, tried, skipped }
}

/** 复用 initSchema 的软错误判定（独立实现避免循环依赖） */
function isSoftErr(e) {
  const msg = (((e && (e.errMsg || e.message)) || '')).toString()
  return msg.includes('already exist')
    || msg.includes('collection already exists')
    || msg.includes('collection not exists')
    || msg.includes('DATABASE_COLLECTION_NOT_EXIST')
    || msg.includes('DATABASE_COLLECTION_ALREADY_EXISTS')
    || msg.includes('index already exist')
    || msg.includes('502005')
    || msg.includes('-501005')
}

// 云开发 db 单例（与 initSchema 一致）
function db() {
  return cloud.database()
}

module.exports = {
  TTL_MS,
  col,
  buildInputDoc,
  ensureNewsIngest,
  pushItems,
  cleanupExpired,
  removeByFingerprint,
}
