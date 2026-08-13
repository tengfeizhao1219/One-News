/**
 * newsIngestStore.js — 统一多源聚合 · 瞬时中间集合 news_ingest（refreshNews 消费端）
 * ============================================================
 * 对齐《统一多源新闻聚合技术架构方案》§4.1 / A.4 / A.5（2026-08-11 owner 确认）。
 *
 * ## 定位
 * 所有渠道（官方 RSS / juhe / tianxing / 未来新源）统一接入后的瞬时 staging 集合，
 * 供第②层 qualityGate（质量评分/去重/敏感过滤）与第③层 AI 加工（清洗/摘要/解读）消费。
 *
 * ## 本模块 = refreshNews 消费端（只读 + 删除）
 * - rssFetcher 侧有同名的写入端（pushItems/buildInputDoc），本文件只提供消费接口：
 *   - fetchPendingByCategory(category)：拉取该前端分类的 pending 官方源条目
 *   - consumeByKeys(keys)：批次消费成功后按 _id 删除（A.5 处理即删，不留底）
 *   - ensureNewsIngest() / cleanupExpired()：自愈建表 + TTL 清理
 * - 写入端（rssFetcher/utils/newsIngestStore.js）与本文档模型一致，字段口径统一。
 *
 * ## 版权红线（A.4/A.5）
 * - 官方 RSS 允许抓取原文全文 content 作为 AI 加工源数据；
 * - ❌ 不向用户展示原文　❌ 不持久化（批次处理完成即清除，不留底）。
 * - 落库 news_cache 的条目 contentSource='official_rss'（保留出处 ↗），
 *   content 不落库，仅 summary（AI 摘要）+ sourceUrl 跳源站 H5。
 * ============================================================
 */

const cloud = require('wx-server-sdk')

// ── 常量 ──
const TTL_MS = 3 * 24 * 60 * 60 * 1000
const CLEAN_BATCH = 100

/** 集合访问器 */
function col() {
  return cloud.database().collection('news_ingest')
}

/**
 * 确保 news_ingest 集合存在（幂等；索引建不上靠应用层兜底，不阻断主流程）。
 */
async function ensureNewsIngest() {
  try {
    await cloud.database().createCollection('news_ingest')
    console.log('[newsIngestStore] 已创建集合 news_ingest')
  } catch (e) {
    if (!isSoftErr(e)) {
      console.warn('[newsIngestStore] 创建 news_ingest 失败（非阻塞）:', (e && e.message) || e)
    }
  }
  const indexes = [
    { key: { expireAt: 1 }, name: 'expireAt', unique: false },
    { key: { status: 1 }, name: 'status', unique: false },
    { key: { category: 1 }, name: 'category', unique: false },
  ]
  for (const idx of indexes) {
    try {
      await col().createIndex({ keys: idx.key, name: idx.name, unique: idx.unique })
      console.log(`[newsIngestStore] 索引 ${idx.name} 已就绪`)
    } catch (e) {
      if (!isSoftErr(e)) {
        console.warn(`[newsIngestStore] 建索引 ${idx.name} 失败（非阻塞）:`, (e && e.message) || e)
      }
    }
  }
}

/**
 * 拉取指定前端分类的 pending 官方源条目（status=pending，category 已按前端 5 tab 映射）。
 * 字段已由 rssFetcher 写入端映射为前端分类（mapOfficialCategory），此处直接按 category 匹配。
 * @param {string} category - 前端分类 id（recommend/tech/international/sports/life）
 * @param {number} [limit=20] 单分类最多消费条数
 * @returns {Promise<Array<Object>>} news_ingest docs（含 _id）
 */
async function fetchPendingByCategory(category, limit = 20) {
  try {
    const res = await col()
      .where({
        status: 'pending',
        category: String(category),
      })
      .orderBy('fetchedAt', 'desc')
      .limit(limit)
      .get()
    return (res && res.data) || []
  } catch (e) {
    if (isSoftErr(e)) return []
    console.warn(`[newsIngestStore] 拉取 pending 官方源失败(${category}):`, (e && e.message) || e)
    return []
  }
}

/**
 * 批次消费成功后删除 news_ingest 条目（A.5：处理即删，不留底）。
 * 只接受精确 _id（fetchPendingByCategory 返回的 doc._id）。
 * @param {Array<string>} ids - news_ingest doc._id 列表
 * @returns {Promise<{removed:number, tried:number}>}
 */
/**
 * 拉取跨全部前端分类的 pending 官方源要闻（按 fetchedAt 倒序取最新 N）。
 * 用于 recommend「官方要闻精选」（owner 8/13 选项A）：recommend 自身无官方 RSS 栏目，
 * 故从全分类 pending 池取最新若干条作为推荐源。
 * ⚠️ 重要：推荐 worker 仅「借用」这些条目做展示，调用方不得将 _ingestId 加入 ingestIds
 * （不消费删除），否则会饿死各原生分类 worker 对同一条目的正常消费。
 * @param {number} [limit=16] 要闻条数
 * @returns {Promise<Array<Object>>} news_ingest docs（含 _id）
 */
async function fetchPendingHeadlines(limit = 16) {
  try {
    const res = await col()
      .where({ status: 'pending' })
      .orderBy('fetchedAt', 'desc')
      .limit(limit)
      .get()
    return (res && res.data) || []
  } catch (e) {
    if (isSoftErr(e)) return []
    console.warn(`[newsIngestStore] 拉取 pending 要闻失败:`, (e && e.message) || e)
    return []
  }
}

async function consumeByKeys(ids) {
  let removed = 0
  if (!ids || !ids.length) return { removed, tried: 0 }
  for (const id of ids) {
    try {
      await col().doc(id).remove()
      removed++
    } catch (e) {
      // 不存在/已删：忽略
    }
  }
  return { removed, tried: ids.length }
}

/**
 * 清理过期（expireAt < now）的瞬时 staging 数据（TTL 应用层兜底）。
 * @param {number} [maxDelete] 单次删除上限
 * @returns {Promise<{deleted:number, remaining:number}>}
 */
async function cleanupExpired(maxDelete = CLEAN_BATCH) {
  const now = new Date().toISOString()
  let deleted = 0
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
      break
    }
    if (!toDelete.length) break
    for (const d of toDelete) {
      try {
        await col().doc(d._id).remove()
        deleted++
      } catch (e) {
        // 单条失败忽略
      }
    }
    if (deleted >= maxDelete) break
  }
  return { deleted, remaining: Math.max(maxDelete - deleted, 0) }
}

/** 软错误判定（集合/索引已存在或不存在等） */
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

module.exports = {
  TTL_MS,
  col,
  ensureNewsIngest,
  fetchPendingByCategory,
  fetchPendingHeadlines,
  consumeByKeys,
  cleanupExpired,
  isSoftErr,
}
