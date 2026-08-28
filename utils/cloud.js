/**
 * utils/cloud.js — 云函数调用封装 + 失败重试/同步队列（TL-B13 / TL-B14）
 *
 * 设计：
 *   - callCloudFunction(name, data): Promise 封装 wx.cloud.callFunction，code!==0 视为失败。
 *   - report(op): 非阻塞上报。成功 resolve；失败静默入队（不阻塞阅读主流程），下次 flush 重试。
 *   - flushQueue(): 应用启动时调用，把离线期间堆积的待同步操作（收藏/浏览上报）逐条重试。
 *   - 待同步队列容量 50，超限丢弃最旧（与 PRD §4.2/§4.4 一致）。
 *
 * 依赖：无（纯封装，前后端通用）。
 */

const SYNC_QUEUE_KEY = 'cloudSyncQueue'
const MAX_QUEUE = 50
// 2026-08-28 优化：flushQueue 重放离线堆积的收藏/浏览上报时，限制并发与单次条数，
// 避免长期断网导致队列膨胀后，应用启动/联网瞬间打一批请求触发 -501003 配额。
const FLUSH_CONCURRENCY = 3     // 最大并发重放数
const FLUSH_MAX_PER_RUN = 20    // 单次启动最多重放条数，其余留待下次 flush

/**
 * 基础云函数调用（Promise 化）
 * @param {string} name 云函数名
 * @param {Object} data 入参
 * @returns {Promise<Object>} res.result（code===0 时）
 */
function callCloudFunction(name, data) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({ name, data })
      .then((res) => {
        if (res && res.result && res.result.code === 0) resolve(res.result)
        else reject((res && res.result && res.result.message) || 'cloud call failed')
      })
      .catch(reject)
  })
}

// ── 同步队列（Storage 持久化，重启后仍可重试）──

let _queue = null

function loadQueue() {
  if (_queue) return _queue
  try { _queue = wx.getStorageSync(SYNC_QUEUE_KEY) || [] } catch (e) { _queue = [] }
  return _queue
}

function saveQueue(q) {
  _queue = q
  try { wx.setStorageSync(SYNC_QUEUE_KEY, q) } catch (e) { /* 满则忽略，内存仍可用 */ }
}

function enqueue(op) {
  const q = loadQueue()
  q.push(op)
  while (q.length > MAX_QUEUE) q.shift() // 超限丢弃最旧
  saveQueue(q)
}

/**
 * 刷新队列：逐条重试此前失败的操作（收藏/浏览上报）
 * 用于应用启动 / 网络恢复时调用。
 */
async function flushQueue() {
  const q = loadQueue()
  if (!q.length) return
  // 单次最多重放 FLUSH_MAX_PER_RUN 条，其余留队列下次（避免一次排空 50 条打爆配额）
  const batch = q.slice(0, FLUSH_MAX_PER_RUN)
  const rest = q.slice(FLUSH_MAX_PER_RUN)
  const failed = []
  let cursor = 0
  // 并发池：最多 FLUSH_CONCURRENCY 个 worker 同时重放，避免瞬时密集调用
  const worker = async () => {
    while (cursor < batch.length) {
      const op = batch[cursor++]
      try {
        await callCloudFunction(op.name, op.data)
      } catch (e) {
        failed.push(op) // 仍失败，下次重试
      }
    }
  }
  const workers = []
  const n = Math.min(FLUSH_CONCURRENCY, batch.length)
  for (let w = 0; w < n; w++) workers.push(worker())
  await Promise.all(workers)
  saveQueue(rest.concat(failed))
}

/**
 * 非阻塞上报：成功 resolve；失败静默入队，不抛错、不阻塞主流程。
 * @param {{name:string, data:Object}} op
 */
function report(op) {
  return callCloudFunction(op.name, op.data).catch(() => {
    enqueue(op)
  })
}

module.exports = { callCloudFunction, report, flushQueue, enqueue }
