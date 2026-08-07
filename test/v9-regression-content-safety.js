#!/usr/bin/env node
// test/v9-regression-content-safety.js
// AC-RQ10 内容安全审核回归测试 — 7 条用例
// 来源：Q-05 口径审查 🔴 阻断项 → Q-新11
// 策略：Mock wx-server-sdk，覆盖正常/违规/降级/恢复全链路

// ── Mock wx-server-sdk ──────────────────────────────
// 在 require securityCheck 之前注入 Mock
let mockErrCode = 0       // 0=通过, 87014=违规
let mockThrowError = false
let mockCallCount = 0

const mockWxServerSdk = function () {
  return {
    openapi: {
      security: {
        msgSecCheck: async ({ content }) => {
          mockCallCount++
          if (mockThrowError) {
            const err = new Error('ECONNREFUSED: mock API down')
            err.code = 'ECONNREFUSED'
            throw err
          }
          return { errCode: mockErrCode, errMsg: mockErrCode === 0 ? 'ok' : 'risky content' }
        },
        imgSecCheck: async () => {
          mockCallCount++
          if (mockThrowError) throw new Error('ECONNREFUSED')
          return { errCode: mockErrCode }
        }
      }
    }
  }
}

// Inject into require cache
const Module = require('module')
const origRequire = Module.prototype.require
Module.prototype.require = function (id) {
  if (id === 'wx-server-sdk') return mockWxServerSdk()
  return origRequire.apply(this, arguments)
}

// ── 测试 ────────────────────────────────────────────
const path = require('path')
const { SecurityCheck } = require(path.join(__dirname, '..', 'cloudfunctions/refreshNews/securityCheck'))

const STATE = { NORMAL: 'normal', DEGRADED: 'degraded', DISABLED: 'disabled' }

let passed = 0, failed = 0
function assert(cond, label) {
  if (cond) { passed++; console.log('  [PASS] ' + label) }
  else { failed++; console.log('  [FAIL] ' + label) }
}

async function runAll() {
  // CS-02: 正常内容通过
  console.log('\n═══════════════════════════════════════════')
  console.log('CS-02: 正常内容通过')
  mockErrCode = 0; mockThrowError = false; mockCallCount = 0
  const sc2 = new SecurityCheck()
  const r2 = await sc2.checkText('正常新闻标题')
  assert(r2.pass === true, 'pass=true')
  assert(r2.risk === null, 'risk=null')
  assert(sc2.stats.totalChecked === 1, 'totalChecked=1')
  assert(sc2.stats.totalBlocked === 0, 'totalBlocked=0')
  assert(sc2.stats.failCount === 0, 'failCount=0（成功后重置）')

  // CS-01: 违规内容拦截
  console.log('\nCS-01: 违规内容命中拦截')
  mockErrCode = 87014; mockThrowError = false; mockCallCount = 0
  const sc1 = new SecurityCheck()
  const r1 = await sc1.checkText('包含违规内容')
  assert(r1.pass === false, 'pass=false')
  assert(r1.risk === 'risky', "risk='risky'")
  assert(sc1.stats.totalBlocked === 1, 'totalBlocked=1')
  assert(sc1.stats.totalChecked === 1, 'totalChecked=1')

  // CS-04: 空内容直接放行
  console.log('\nCS-04: 空内容直接放行')
  mockCallCount = 0; mockThrowError = false
  const sc4 = new SecurityCheck()
  const r4a = await sc4.checkText('')
  const r4b = await sc4.checkText('   ')
  const r4c = await sc4.checkText(null)
  assert(r4a.pass === true && r4a.risk === null, '空字符串放行')
  assert(r4b.pass === true && r4b.risk === null, '纯空格放行')
  assert(r4c.pass === true && r4c.risk === null, 'null放行')
  // 空内容不调 API，mockCallCount 仍为 0
  assert(sc4.stats.totalChecked === 0, '空内容不累计 totalChecked')

  // CS-03: API 连续失败 → 降级放行
  console.log('\nCS-03: API 连续失败 → 降级放行')
  mockThrowError = true; mockCallCount = 0
  const sc3 = new SecurityCheck({ failThreshold: 3 })
  const r3a = await sc3.checkText('a')
  const r3b = await sc3.checkText('b')
  assert(r3a.pass === true && r3a.risk === 'degraded', '第1次失败: pass=true, risk=degraded')
  assert(r3b.pass === true && r3b.risk === 'degraded', '第2次失败: pass=true, risk=degraded')
  assert(sc3.state === STATE.NORMAL, '前2次失败后状态仍为 NORMAL')
  const r3c = await sc3.checkText('c')
  assert(r3c.pass === true && r3c.risk === 'degraded', '第3次失败: pass=true, risk=degraded')
  assert(sc3.state === STATE.DEGRADED, '第3次失败后状态变为 DEGRADED')
  assert(sc3.stats.failCount === 3, 'failCount=3')
  // 降级后不再调 API
  const callBeforeDegrade = mockCallCount
  await sc3.checkText('d')
  assert(mockCallCount === callBeforeDegrade, '降级后不再调用 API')

  // CS-05: 批量检测
  console.log('\nCS-05: 批量检测 — 混合通过/拦截')
  mockErrCode = 0; mockThrowError = false
  let batchIdx = 0
  const batchResults = [0, 87014, 0]  // 第1条通过, 第2条拦截, 第3条通过
  const sc5 = new SecurityCheck()
  // Override checkText for batch test
  const origCheckText = sc5.checkText.bind(sc5)
  sc5.checkText = async function(content) {
    mockErrCode = batchResults[batchIdx++] || 0
    return origCheckText(content)
  }
  const items = [
    { id: '1', title: '正常新闻', summary: '' },
    { id: '2', title: '违规内容', summary: '' },
    { id: '3', title: '正常新闻2', summary: '' },
  ]
  const batchResult = await sc5.checkBatch(items)
  assert(batchResult.passed.length === 2, 'passed=2条')
  assert(batchResult.blocked.length === 1, 'blocked=1条')
  assert(batchResult.blocked[0].id === '2', "blocked[0].id='2'")
  assert(batchResult.blocked[0]._risk === 'risky', "blocked[0]._risk='risky'")
  assert(batchResult.stats.totalChecked === 3, 'batch totalChecked=3')
  assert(batchResult.stats.totalBlocked === 1, 'batch totalBlocked=1')

  // CS-06: 命中率告警（通过 _checkAlert 私有方法）
  console.log('\nCS-06: 命中率告警（hitRate > 20%）')
  const sc6 = new SecurityCheck()
  // 手动设置统计达到告警阈值
  sc6._totalChecked = 5
  sc6._totalBlocked = 2   // 2/5 = 0.4 > 0.2
  sc6._checkAlert()       // 应触发告警日志（不会抛异常即为通过）
  const hr = parseFloat(sc6.stats.hitRate)
  assert(hr > 0.2, 'hitRate=' + hr + ' > 0.2（应触发告警）')
  assert(hr === 0.4, 'hitRate=0.4 (2/5)')

  // CS-07: 降级后手动恢复
  console.log('\nCS-07: 降级后手动恢复')
  const sc7 = new SecurityCheck()
  sc7._state = STATE.DEGRADED
  sc7._failCount = 5
  sc7._totalChecked = 10
  sc7._totalBlocked = 3
  sc7.reset()
  assert(sc7.state === STATE.NORMAL, "reset后 state='normal'")
  assert(sc7.stats.failCount === 0, 'reset后 failCount=0')
  assert(sc7.stats.totalChecked === 0, 'reset后 totalChecked=0')
  assert(sc7.stats.totalBlocked === 0, 'reset后 totalBlocked=0')

  // ── 结果 ────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════')
  console.log('AC-RQ10 内容安全审核回归测试：通过 ' + passed + ' / 失败 ' + failed)
  console.log('═══════════════════════════════════════════')

  if (failed > 0) {
    console.log('\n失败项: ' + failed)
    process.exit(1)
  }
}

runAll().catch(err => {
  console.error('测试执行异常:', err)
  process.exit(1)
})
