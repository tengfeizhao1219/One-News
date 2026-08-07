/**
 * B-10 云函数单测 — securityCheck.js (AC-RQ10)
 * 覆盖 TC01~TC10：通过/拦截/降级/重置/空值/disabled/批量/统计/截断/reset
 * 运行：node test/b02-securitycheck-test.js
 */

// ── 自建 wx-server-sdk mock（一次性，运行前写入 node_modules）──
const fs = require('fs'), path = require('path')
const mockDir = path.join(__dirname, '..', 'node_modules', 'wx-server-sdk')
fs.mkdirSync(mockDir, { recursive: true })
fs.writeFileSync(path.join(mockDir, 'index.js'), `
const m = global.__mockWxSdk
module.exports = {
  init: () => {},
  database: () => ({}),
  DYNAMIC_CURRENT_ENV: 'test',
  openapi: { security: { msgSecCheck: m.msgSecCheck, imgSecCheck: m.imgSecCheck } },
}
`)

// ── 全局状态（供 /node_modules/wx-server-sdk/index.js 读取）──
let gErrCode = 0, gThrow = false, gCalls = 0
global.__mockWxSdk = {
  msgSecCheck: async () => { gCalls++; if (gThrow) throw new Error('NET'); return { errCode: gErrCode, errMsg: gErrCode===0?'ok':'risky' } },
  imgSecCheck: async () => { gCalls++; if (gThrow) throw new Error('NET'); return { errCode: gErrCode } },
}

const { SecurityCheck, STATE } = require('../cloudfunctions/refreshNews/securityCheck')

// ── 测试 ──────────────────────────────────────────────────
let passed = 0, failed = 0
function test(name, fn) {
  try {
    const r = fn()
    if (r && r.then) {
      return r.then(() => { passed++ }).catch(e => { failed++; console.error('  FAIL', name, e.message) })
    } else {
      passed++
    }
  } catch(e) { failed++; console.error('  FAIL', name, e.message) }
  return Promise.resolve()
}
function assert(c, m) { if (!c) throw new Error(m || 'assert') }
function assertEq(a, b, m) { if (a !== b) throw new Error(m || `${JSON.stringify(a)}!==${JSON.stringify(b)}`) }
function mock(errCode, thr) { gErrCode = errCode; gThrow = thr; gCalls = 0 }

console.log('=== B-10 securityCheck 单测 (AC-RQ10) ===\n')

// ── 按序执行（async 测试必须 await）───────────────────────
;(async () => {
  // TC01: 正常通过
  mock(0, false)
  await test('TC01: errCode=0 通过', async () => {
    const sc = new SecurityCheck()
    const r = await sc.checkText('正常标题')
    assert(r.pass); assertEq(r.risk, null); assertEq(sc.stats.totalChecked, 1)
  })

  // TC02: 违规拦截
  mock(87014, false)
  await test('TC02: errCode=87014 拦截', async () => {
    const sc = new SecurityCheck()
    const r = await sc.checkText('违规')
    assert(!r.pass); assertEq(r.risk, 'risky'); assertEq(sc.stats.totalBlocked, 1)
  })

  // TC03: 降级 (failThreshold=3)
  mock(0, true)
  await test('TC03: 连续失败→DEGRADED', async () => {
    const sc = new SecurityCheck({ failThreshold: 3 })
    await sc.checkText('a'); await sc.checkText('b')
    assertEq(sc.state, STATE.NORMAL)
    await sc.checkText('c')
    assertEq(sc.state, STATE.DEGRADED)
    const r = await sc.checkText('d')
    assert(r.pass); assertEq(r.risk, 'degraded')
  })

  // TC04: 成功重置 failCount
  mock(0, true)
  await test('TC04: 成功重置 failCount', async () => {
    const sc = new SecurityCheck({ failThreshold: 3 })
    await sc.checkText('f1'); await sc.checkText('f2')
    assertEq(sc._failCount, 2)
    mock(0, false); await sc.checkText('ok'); assertEq(sc._failCount, 0)
  })

  // TC05: 空内容
  mock(0, false)
  await test('TC05: 空/null 跳过', async () => {
    const sc = new SecurityCheck()
    assert((await sc.checkText('')).pass)
    assert((await sc.checkText(null)).pass)
    assertEq(sc.stats.totalChecked, 0)
  })

  // TC06: DISABLED
  await test('TC06: DISABLED 全放行（risk=disabled，区别于 degraded=API 降级）', async () => {
    const sc = new SecurityCheck()
    sc._state = STATE.DISABLED
    const r = await sc.checkText('x')
    assert(r.pass); assertEq(r.risk, 'disabled')
  })

  // TC07: reset
  test('TC07: reset 恢复', () => {
    const sc = new SecurityCheck()
    sc._state = STATE.DEGRADED; sc._failCount = 5; sc._totalChecked = 100
    sc.reset()
    assertEq(sc.state, STATE.NORMAL); assertEq(sc._failCount, 0); assertEq(sc._totalChecked, 0)
  })

  // TC08: 统计
  mock(0, false)
  await test('TC08: stats 准确', async () => {
    const sc = new SecurityCheck()
    await sc.checkText('a'); await sc.checkText('b')
    mock(87014, false); await sc.checkText('c')
    assertEq(sc.stats.totalChecked, 3); assertEq(sc.stats.totalBlocked, 1)
  })

  // TC09: 批量
  mock(0, false)
  await test('TC09: checkBatch', async () => {
    const sc = new SecurityCheck()
    const r = await sc.checkBatch([{ id:'1', title:'a' }, { id:'2', title:'b' }])
    assertEq(r.passed.length, 2); assertEq(r.blocked.length, 0)
    mock(87014, false)
    const r2 = await sc.checkBatch([{ id:'3', title:'bad' }])
    assertEq(r2.passed.length, 0); assertEq(r2.blocked.length, 1)
  })

  // TC10: 超长截断
  mock(0, false)
  await test('TC10: 1000字不抛错', async () => {
    const sc = new SecurityCheck()
    await sc.checkText('x'.repeat(1000))
    assert(true)
  })

  console.log(`\n=== ${passed} passed, ${failed} failed ===`)
  if (failed > 0) process.exit(1)
})()
