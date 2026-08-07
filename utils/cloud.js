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
  const remaining = []
  for (const op of q) {
    try {
      await callCloudFunction(op.name, op.data)
    } catch (e) {
      remaining.push(op) // 仍失败，保留下次重试
    }
  }
  saveQueue(remaining)
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
