// 情报抓取编排器/worker 双模（T1.4a / I 基础设施）
// ============================================================
// ⚠️ 复用 One News refreshNews v8 的 self-fan-out 分片范式（非其业务），
//    intel_* 命名空间隔离，可整体摘除。intelFetch 只做「编排 + 分片」，
//    实际抓取委派给 intelRssPoll 按源 worker（每个源独立实例，独占 60s 预算）。
//
// 模式区分（仿 refreshNews v7 event.category 判定）：
//   - worker 模式（event.sourceId 存在）：编排器自扇出的实例，把该源委派给
//     intelRssPoll（fire-and-forget，RPC 15s 超时不影响实例继续后台执行），立即返回。
//   - 编排模式（event 无 sourceId，定时器/手动触发）：读 intel_sources 启用的源清单，
//     写 InspectionRun 巡检记录，按源 fire-and-forget 自扇出 → 立即返回「已触发」。
//
// 收益（同 refreshNews v7）：
//   ① 每源独占 60s，单源耗时 5–15s << 60s，天然不超限（§5.8）；
//   ② 故障隔离 + 按源降级：单源失败只影响该源，不连累整轮巡检；
//   ③ 并行墙钟 ≈ 最慢单源（而非 25 倍求和）。
//
// 定时触发器（config.json）：05:10 / 11:10 / 17:55（提前量 Δ，§5.9；
//   18:00 档用 17:55 保证汇总结案前抓完最后一波）。
// ============================================================

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const INTEL_SOURCE_COLLECTION = 'intel_sources'
const INTEL_HEALTH_COLLECTION = 'intel_health'

// 按当前小时推断目标档位（配置的触发时刻 05:10/11:10/17:55 属于哪一档）
function resolveTargetTime(now = new Date()) {
  const h = now.getHours()
  if (h >= 15 || h < 5) return '18:00'   // 17:55 档 → 当日 18:00 汇总结案
  if (h >= 8) return '11:00'             // 11:10 档 → 11:00 增量
  return '05:00'                         // 05:10 档 → 05:00 增量
}

function todayStr(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/** 读取启用中的情报源清单（enabled=true 且非 disabled） */
async function listEnabledSources() {
  try {
    const res = await db.collection(INTEL_SOURCE_COLLECTION)
      .where({ enabled: true, status: db.command.neq('disabled') })
      .limit(100)
      .get()
    return res.data || []
  } catch (e) {
    console.warn('[intelFetch] 读取 intel_sources 失败（集合可能未建，交给自愈）:', e.message)
    return []
  }
}

/** 写一条 InspectionRun 巡检记录（§8.2，健康度聚合基础） */
async function recordInspection(targetTime, sourceCount, runId) {
  try {
    await db.collection(INTEL_HEALTH_COLLECTION).add({
      data: {
        kind: 'inspection',
        runId,
        date: todayStr(),
        targetTime,
        triggerTime: new Date().toISOString(),
        status: 'running',
        sourceCount,
        perSource: [],
        durationMs: 0,
        createdAt: Date.now(),
      },
    })
  } catch (e) {
    console.warn('[intelFetch] 写 InspectionRun 失败（非阻塞）:', e.message)
  }
}

// ── 云函数入口 ──
exports.main = async (event = {}) => {
  const startTime = Date.now()
  const wxCtx = cloud.getWXContext() || {}
  console.log(`[intelFetch] 触发来源: SOURCE=${wxCtx.SOURCE || 'unknown'}`)

  // ── worker 模式：event.sourceId 存在 → 委派 intelRssPoll 处理单源 ──
  if (event.sourceId) {
    const targetTime = event.targetTime || resolveTargetTime()
    console.log(`[intelFetch][worker] 分片委派: source=${event.sourceId} targetTime=${targetTime}（后台执行）`)
    // fire-and-forget：RPC 15s 超时只影响此处响应，实例会跑完并写库（DG-12 范式）
    cloud.callFunction({
      name: 'intelRssPoll',
      data: { sourceId: event.sourceId, targetTime, shard: true },
    })
      .then((res) => {
        const r = res.result || {}
        console.log(`[intelFetch][worker][${event.sourceId}] intelRssPoll 完成: status=${r.status || r.skipped || 'ok'} inserted=${r.inserted || 0}`)
      })
      .catch((err) => {
        console.warn(`[intelFetch][worker][${event.sourceId}] RPC 超时（intelRssPoll 实例仍在后台运行）: ${err.message}`)
      })
    return { code: 0, message: '单源已委派', sourceId: event.sourceId, targetTime, async: true }
  }

  // ── 编排模式（定时器/手动触发）──
  console.log('[intelFetch] ========== 开始情报巡检编排（self-fan-out 分片）==========')
  const targetTime = event.targetTime || resolveTargetTime()
  const sources = await listEnabledSources()
  if (sources.length === 0) {
    console.warn('[intelFetch] 无启用源（intel_sources 为空或全关），本轮结束')
    return { code: 0, message: '无启用源，跳过', targetTime, scanned: 0 }
  }

  // 写巡检记录（幂等：同 runId 允许重复写入，由 health 聚合去重）
  const runId = `${todayStr()}_${targetTime}_${Date.now()}`
  await recordInspection(targetTime, sources.length, runId)

  // 异步自扇出：每个源一个独立 worker 实例（fire-and-forget，互不阻塞）
  console.log(`[intelFetch] 异步触发 ${sources.length} 个源（各自独立 60s 预算，后台执行），targetTime=${targetTime}`)
  for (const src of sources) {
    const sourceId = src._id || src.key
    cloud.callFunction({
      name: 'intelFetch',
      data: { sourceId, targetTime, shard: true },
    })
      .then((res) => {
        const r = res.result || {}
        console.log(`[intelFetch][${sourceId}] 分片已触发: ${r.message || ''}`)
      })
      .catch((err) => {
        // worker 实例会继续跑完并写库，这里仅记录 RPC 层超时，不影响数据
        console.warn(`[intelFetch][${sourceId}] 分片 RPC 超时（实例仍在后台运行）: ${err.message}`)
      })
  }

  const elapsed = Date.now() - startTime
  console.log(`[intelFetch] ========== 巡检已触发（编排/异步）: 后台更新中, 编排耗时 ${elapsed}ms ==========`)
  return {
    code: 0,
    message: '情报巡检已触发，后台按源执行',
    data: { async: true, targetTime, runId, shards: sources.length, elapsedMs: elapsed },
  }
}
