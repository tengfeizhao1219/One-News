/**
 * initSchema.js — 建表 + 建索引（启动自愈）
 * ============================================================
 * 对齐方案 §2/§3：news_raw_official（12 字段 + 5 索引）与 feed_meta（源配置表）。
 * 采用「日志内自愈建表」：index.js 启动时调用 ensureSchema()，
 * 集合不存在则 createCollection，索引缺失则 createIndex，失败可忽略（非阻塞）。
 * 参考 refreshNews L688 db.createCollection 先例。
 * ============================================================
 */

const cloud = require('wx-server-sdk')
const db = cloud.database()

let _ensurePromise = null

/** 判定「集合/索引已存在或权限不足」这类可忽略的软错误 */
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

/**
 * 确保 news_raw_official 集合存在并建好基础索引（urlFp/titleFp 唯一 + fetchTime/sourceId/status）。
 * 注：云开发 createIndex 需字段结构稳定；唯一索引若建不上，依赖应用层先查再插兜底去重，
 *     不阻断抓取主流程（日志打出 warning）。
 */
async function ensureNewsRawOfficial() {
  // 1. 集合存在性
  try {
    await db.createCollection('news_raw_official')
    console.log('[initSchema] 已创建集合 news_raw_official')
  } catch (e) {
    if (isSoftErr(e)) {
      // 已存在，继续
    } else {
      console.warn('[initSchema] 创建 news_raw_official 集合失败（非阻塞）:', e.message)
    }
  }

  // 2. 索引
  const col = db.collection('news_raw_official')
  const indexes = [
    { key: { urlFp: 1 }, name: 'urlFp', unique: true },
    { key: { titleFp: 1 }, name: 'titleFp', unique: true },
    { key: { fetchTime: 1 }, name: 'fetchTime', unique: false },
    { key: { sourceId: 1 }, name: 'sourceId', unique: false },
    { key: { status: 1 }, name: 'status', unique: false },
  ]
  for (const idx of indexes) {
    try {
      await col.createIndex({ keys: idx.key, name: idx.name, unique: idx.unique })
      console.log(`[initSchema] news_raw_official 索引 ${idx.name} 已就绪`)
    } catch (e) {
      if (isSoftErr(e)) {
        // 已存在，忽略
      } else {
        console.warn(`[initSchema] 建索引 ${idx.name} 失败（非阻塞，靠应用层去重兜底）:`, e.message)
      }
    }
  }
}

/**
 * 确保 feed_meta 集合存在（源配置与状态，见方案 §3）。
 */
async function ensureFeedMeta() {
  try {
    await db.createCollection('feed_meta')
    console.log('[initSchema] 已创建集合 feed_meta')
  } catch (e) {
    if (isSoftErr(e)) {
      // 已存在
    } else {
      console.warn('[initSchema] 创建 feed_meta 失败（非阻塞）:', e.message)
    }
  }
}

/**
 * 一键初始化全部 schema（幂等，可多次调用）。
 */
function ensureSchema() {
  if (!_ensurePromise) {
    _ensurePromise = (async () => {
      await ensureNewsRawOfficial()
      await ensureFeedMeta()
    })()
  }
  return _ensurePromise
}

module.exports = { ensureSchema, ensureNewsRawOfficial, ensureFeedMeta, isSoftErr }
