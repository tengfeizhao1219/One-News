/**
 * initSchema.js — 建表 + 建索引（启动自愈）
 * ============================================================
 * Stage 0 统一抓取（newsFetcher）：
 *   news_raw     —— 所有源归一后的原始条目（官方RSS/juhe/tianxing），status=pending/consumed
 *   news_staging —— Stage 1 过质量门后的 AI 待处理条目，aiStatus=pending/done
 *   feed_meta    —— 官方 RSS 源配置/状态（与旧 rssFetcher 共享同一集合）
 * 设计依据：docs/architecture-pipeline-redesign.md §2
 * 采用「日志内自愈建表」：函数启动时 ensureSchema()，集合/索引不存在则建，失败可忽略（非阻塞）。
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

async function ensureCollection(name, indexes) {
  try {
    await db.createCollection(name)
    console.log(`[initSchema] 已创建集合 ${name}`)
  } catch (e) {
    if (!isSoftErr(e)) {
      console.warn(`[initSchema] 创建 ${name} 失败（非阻塞）:`, e.message)
    }
  }
  const col = db.collection(name)
  for (const idx of (indexes || [])) {
    try {
      await col.createIndex({ keys: idx.key, name: idx.name, unique: idx.unique })
      console.log(`[initSchema] ${name} 索引 ${idx.name} 已就绪`)
    } catch (e) {
      if (!isSoftErr(e)) {
        console.warn(`[initSchema] 建索引 ${name}.${idx.name} 失败（非阻塞）:`, e.message)
      }
    }
  }
}

/**
 * 一键初始化全部 schema（幂等，可多次调用）。
 */
function ensureSchema() {
  if (!_ensurePromise) {
    _ensurePromise = (async () => {
      await ensureCollection('news_raw', [
        { key: { urlFp: 1 }, name: 'urlFp', unique: true },
        { key: { titleFp: 1 }, name: 'titleFp', unique: true },
        { key: { status: 1 }, name: 'status', unique: false },
        { key: { fetchedAt: 1 }, name: 'fetchedAt', unique: false },
        { key: { sourceType: 1 }, name: 'sourceType', unique: false },
      ])
      await ensureCollection('news_staging', [
        { key: { aiStatus: 1 }, name: 'aiStatus', unique: false },
        { key: { category: 1 }, name: 'category', unique: false },
        { key: { fetchedAt: 1 }, name: 'fetchedAt', unique: false },
        { key: { urlFp: 1 }, name: 'urlFp', unique: false },
      ])
      // C-6：news_cache 组合索引自愈（此前靠云控制台手动建，缺失时 getNewsList 链式
      // orderBy 查询失败被 catch 静默降级 backup，主路径失效难以发现）
      await ensureCollection('news_cache', [
        { key: { category: 1, cacheExpire: 1 }, name: 'cat_expire', unique: false },
        { key: { category: 1, createdAt: 1 }, name: 'cat_createdAt', unique: false },
        { key: { finalScore: 1, publishTime: 1 }, name: 'finalScore_publishTime', unique: false },
        { key: { dedupKey: 1 }, name: 'dedupKey', unique: false },
        { key: { id: 1 }, name: 'id', unique: false },
      ])
      await ensureCollection('feed_meta', [])
    })()
  }
  return _ensurePromise
}

module.exports = { ensureSchema, isSoftErr }
