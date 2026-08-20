// intelManualRun —— 手动全流程管线编排（owner 2026-08-20 策略）
// ============================================================
// 策略：保留 05/11/18 三个自动发布窗口；任何「手动触发」的数据更新不受自动发布
// 机制影响——只要触发，就按完整流程完成：抓取(intelFetch) → 处理(intelProcess)
// → 立即发布(intelDispatcher)，不等下一个定时窗口。
// 说明：
//   - intelFetch/intelProcess 均为 fire-and-forget（各自后台续跑），本函数按
//     抓取分片 60s 预算、处理 BATCH_LIMIT=10/批 的节奏做固定等待后接力。
//   - 超时配置 300s（见 config.json），总耗时 ≈ 90s(抓取) + 60s(处理) + 发布。
// 返回：{ ok, stages: { fetch, process, publish } }
// ============================================================
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

exports.main = async (event = {}) => {
  const start = Date.now()
  const stages = {}
  try {
    // 1) 触发抓取（编排模式：无 sourceId → 全源 self-fan-out，立即返回）
    const f = await cloud.callFunction({ name: 'intelFetch', data: {} })
    stages.fetch = (f && f.result && f.result.message) || 'fetch-triggered'

    // 2) 等待抓取完成（分片 60s 预算 + 余量；不阻塞精确，下一轮手动可补）
    await sleep(90000)

    // 3) 触发处理（self-fan-out 续跑消费 pending，立即返回）
    const p = await cloud.callFunction({ name: 'intelProcess', data: { force: true } })
    stages.process = (p && p.result && p.result.message) || 'process-triggered'

    // 4) 等待处理（BATCH_LIMIT=10/批 续跑）
    await sleep(60000)

    // 5) 立即发布（Dispatcher 组装当前 staged + released 并置 isCurrent，不依赖定时窗口）
    const d = await cloud.callFunction({ name: 'intelDispatcher', data: { force: true } })
    const dr = (d && d.result) || {}
    stages.publish = dr.published === false
      ? ('no-new-items' + (dr.note ? ':' + dr.note : ''))
      : ('published items=' + (dr.items ?? dr.itemCount ?? '?') + ' mode=' + (dr.mode || '?'))

    return { ok: true, stages, elapsedMs: Date.now() - start }
  } catch (e) {
    return { ok: false, stages, error: e.message, elapsedMs: Date.now() - start }
  }
}
