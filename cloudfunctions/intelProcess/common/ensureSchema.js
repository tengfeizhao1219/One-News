/**
 * ensureSchema.js — intel_* 集合自愈建表（T1.1 / I 基础设施）
 * ============================================================
 * 复用 One News rssFetcher/utils/initSchema.js 的自愈建表范式（非其业务），
 * 命名空间整体隔离为 intel_*，随时可整体摘除。
 *
 * 数据流（设计 §1.1 / §7.2）：
 *   intel_ingest（原始）→ 质量门 → intel_staged（处理后）→ 发布闸门 T 时刻
 *   置 isCurrent 指针 → intel_current（用户可见）
 *
 * 集合清单：
 *   intel_ingest   原始条目（guid 幂等去重键 = 源id + item guid）
 *   intel_staged   处理层产物（Phase 3 intelProcess 写入，status=staged/released）
 *   intel_current  用户可见当期（发布闸门后快照 / isCurrent 指针）
 *   intel_sources  25 源注册表 + 健康度 + lastSuccessCursor 增量游标
 *   intel_health   巡检/健康度记录（InspectionRun + 源级告警）
 *   intel_profile  用户画像（初始化采集，Phase 5）
 *
 * 采用「日志内自愈建表」：index.js 启动时调用 ensureSchema()，
 * 集合不存在则 createCollection，索引缺失则 createIndex，失败可忽略（非阻塞）。
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
 * 确保单个集合存在。
 * @param {string} name
 */
async function ensureCollection(name) {
  try {
    await db.createCollection(name)
    console.log(`[ensureSchema] 已创建集合 ${name}`)
  } catch (e) {
    if (!isSoftErr(e)) {
      console.warn(`[ensureSchema] 创建 ${name} 失败（非阻塞）:`, e.message)
    }
  }
}

/**
 * 对单个集合建索引（唯一索引建不上时靠应用层先查再插兜底去重，不阻断主流程）。
 * @param {string} collection
 * @param {Array<{key:Object,name:string,unique:boolean}>} indexes
 */
async function ensureIndexes(collection, indexes) {
  const col = db.collection(collection)
  for (const idx of indexes) {
    try {
      await col.createIndex({ keys: idx.key, name: idx.name, unique: idx.unique })
      console.log(`[ensureSchema] ${collection} 索引 ${idx.name} 已就绪`)
    } catch (e) {
      if (!isSoftErr(e)) {
        console.warn(`[ensureSchema] 建索引 ${idx.name}（${collection}）失败（非阻塞，靠应用层去重兜底）:`, e.message)
      }
    }
  }
}

/**
 * intel_ingest：原始条目（去重键 guid + sourceId；status 标记消费进度）
 */
async function ensureIntelIngest() {
  await ensureCollection('intel_ingest')
  await ensureIndexes('intel_ingest', [
    { key: { guid: 1 }, name: 'intel_ingest_guid', unique: true },   // 幂等去重唯一键
    { key: { sourceId: 1 }, name: 'intel_ingest_sourceId', unique: false },
    { key: { fetchedAt: 1 }, name: 'intel_ingest_fetchedAt', unique: false },
    { key: { status: 1 }, name: 'intel_ingest_status', unique: false },
    { key: { targetTime: 1 }, name: 'intel_ingest_targetTime', unique: false },
  ])
}

/**
 * intel_staged：处理层产物（Phase 3 写入；发布闸门 T4.1 消费，置 releasedAt）
 */
async function ensureIntelStaged() {
  await ensureCollection('intel_staged')
  await ensureIndexes('intel_staged', [
    { key: { itemId: 1 }, name: 'intel_staged_itemId', unique: true },  // 关联 Item.guid，同篇不重处理
    { key: { status: 1 }, name: 'intel_staged_status', unique: false },
    { key: { relevance: 1 }, name: 'intel_staged_relevance', unique: false },
  ])
}

/**
 * intel_current：用户可见当期（发布闸门后置 isCurrent 指针，§7.2 currentIssue）
 */
async function ensureIntelCurrent() {
  await ensureCollection('intel_current')
  await ensureIndexes('intel_current', [
    { key: { date: 1, isCurrent: 1 }, name: 'intel_current_date_isCurrent', unique: false },
    { key: { version: 1 }, name: 'intel_current_version', unique: false },
  ])
  // 2026-08-19 复盘：brief 历史归档集合（persistBrief 覆盖前快照，可追溯/回滚）
  await ensureCollection('intel_current_archive')
}

/**
 * intel_sources：25 源注册表 + 健康度 + lastSuccessCursor 增量游标（§5.8 #3）
 */
async function ensureIntelSources() {
  await ensureCollection('intel_sources')
  await ensureIndexes('intel_sources', [
    { key: { key: 1 }, name: 'intel_sources_key', unique: true },  // 稳定 ID，配置热更新
    { key: { sourceType: 1 }, name: 'intel_sources_sourceType', unique: false },
    { key: { enabled: 1 }, name: 'intel_sources_enabled', unique: false },
  ])
}

/**
 * intel_health：巡检记录（InspectionRun）+ 源级健康度告警
 */
async function ensureIntelHealth() {
  await ensureCollection('intel_health')
  await ensureIndexes('intel_health', [
    { key: { kind: 1 }, name: 'intel_health_kind', unique: false },
    { key: { targetTime: 1 }, name: 'intel_health_targetTime', unique: false },
    { key: { date: 1 }, name: 'intel_health_date', unique: false },
    { key: { sourceId: 1 }, name: 'intel_health_sourceId', unique: false },
  ])
}

/**
 * intel_profile：用户画像（初始化采集，Phase 5 写入；§9.5 独立命名空间）
 */
async function ensureIntelProfile() {
  await ensureCollection('intel_profile')
  await ensureIndexes('intel_profile', [
    { key: { userId: 1 }, name: 'intel_profile_userId', unique: true },
  ])
}

/**
 * intel_config：intel_* 全局配置/指针表（单文档）——发布闸门 T4.1 在此记
 * `intel_current_issue` 文档（{ currentIssueId, date, version }，§7.4 currentIssue 指针）。
 * 新增于 T4.1 联调（Dispatcher 指针升级曾报 -502005 collection not exists）。
 */
async function ensureIntelConfig() {
  await ensureCollection('intel_config')
  await ensureIndexes('intel_config', [
    { key: { key: 1 }, name: 'intel_config_key', unique: true },
  ])
}

/**
 * 一键初始化全部 intel_* schema（幂等，可多次调用）。
 */
function ensureSchema() {
  if (!_ensurePromise) {
    _ensurePromise = (async () => {
      await ensureIntelIngest()
      await ensureIntelStaged()
      await ensureIntelCurrent()
      await ensureIntelSources()
      await ensureIntelHealth()
      await ensureIntelProfile()
      await ensureIntelConfig()
    })()
  }
  return _ensurePromise
}

module.exports = { ensureSchema, ensureIntelIngest, ensureIntelSources, isSoftErr }
