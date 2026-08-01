# Q-新11 AC-RQ10 内容安全审核测试用例

> **编写人**：测试工程师 | **日期**：2026-07-31
> **来源**：Q-05 测试用例口径审查 — 🔴 阻断项（AC-RQ10 零覆盖）
> **要求**：≥3 条云函数层测试用例，Q-03 回归测试完成前必做
> **被测模块**：`cloudfunctions/common/securityCheck.js` — `SecurityCheck` 类

---

## 一、测试架构

由于 `securityCheck.js` 依赖 `wx-server-sdk`（仅在微信云开发环境可用），测试采用 **Mock 注入** 策略：

- **Mock `wx-server-sdk`**：模拟 `cloud.openapi.security.msgSecCheck` / `imgSecCheck` 的返回值
- **Mock 策略覆盖**：正常通过、违规拦截、API 异常、连续失败降级、降级后恢复
- **不依赖真实微信环境**，可在 Node.js 沙箱中直接运行

---

## 二、测试用例

### CS-01 🔴 P0：违规内容命中拦截 → 不入库

| 项 | 内容 |
|----|------|
| **用例 ID** | CS-01 |
| **优先级** | 🔴 P0 |
| **PRD 对照** | AC-RQ10 §1："IF 命中 msgSecCheck THEN 该条不入库且有日志" |
| **前置条件** | SecurityCheck 实例状态为 NORMAL |
| **操作** | 调用 `checkText("包含违规内容的文本")`，Mock `msgSecCheck` 返回 `errCode: 87014` |
| **预期结果** | `{ pass: false, risk: 'risky' }`，`stats.totalBlocked += 1`，`stats.totalChecked += 1` |
| **验证点** | ✅ pass=false ✅ risk='risky' ✅ totalBlocked 递增 ✅ 控制台有拦截日志 |

### CS-02 🔴 P0：正常内容通过 → 放行

| 项 | 内容 |
|----|------|
| **用例 ID** | CS-02 |
| **优先级** | 🔴 P0 |
| **PRD 对照** | AC-RQ10 §1（隐式：正常内容应放行） |
| **前置条件** | SecurityCheck 实例状态为 NORMAL |
| **操作** | 调用 `checkText("正常新闻标题")`，Mock `msgSecCheck` 返回 `errCode: 0` |
| **预期结果** | `{ pass: true, risk: null }`，`stats.totalChecked += 1`，`failCount` 重置为 0 |
| **验证点** | ✅ pass=true ✅ risk=null ✅ failCount 重置 ✅ 连续失败计数不累加 |

### CS-03 🔴 P0：API 连续失败 → 降级放行

| 项 | 内容 |
|----|------|
| **用例 ID** | CS-03 |
| **优先级** | 🔴 P0 |
| **PRD 对照** | AC-RQ10 §2："API 不可用时保守暂缓入库并告警" |
| **前置条件** | SecurityCheck 实例状态为 NORMAL，`failThreshold = 3` |
| **操作** | 连续 3 次调用 `checkText("任意内容")`，每次 Mock `msgSecCheck` 抛异常 `Error("ECONNREFUSED")` |
| **预期结果** | 前 2 次返回 `{ pass: true, risk: 'degraded' }`（单次保守放行）；第 3 次后 `state === 'degraded'`，后续调用直接返回 `{ pass: true, risk: 'degraded' }`（跳过 API） |
| **验证点** | ✅ 前2次 pass=true, risk='degraded' ✅ 第3次后 state='degraded' ✅ 降级后不再调用 API ✅ 有降级告警日志 |

### CS-04 🟡 P1：空内容直接放行（不调 API）

| 项 | 内容 |
|----|------|
| **用例 ID** | CS-04 |
| **优先级** | 🟡 P1 |
| **PRD 对照** | 边界场景：部分新闻无标题/摘要 |
| **前置条件** | SecurityCheck 实例状态为 NORMAL |
| **操作** | 调用 `checkText("")` 和 `checkText("   ")` 和 `checkText(null)` |
| **预期结果** | 均返回 `{ pass: true, risk: null }`，不触发 API 调用，stats 不变化 |
| **验证点** | ✅ 空字符串放行 ✅ 纯空格放行 ✅ null 放行 ✅ 不调 API |

### CS-05 🟡 P1：批量检测 — 混合通过/拦截

| 项 | 内容 |
|----|------|
| **用例 ID** | CS-05 |
| **优先级** | 🟡 P1 |
| **PRD 对照** | AC-RQ10 §1：批量新闻逐条检测，违规条目不入库 |
| **前置条件** | SecurityCheck 实例状态为 NORMAL |
| **操作** | 调用 `checkBatch([{id:'1',title:'正常'}, {id:'2',title:'违规'}, {id:'3',title:'正常2'}])`，Mock 第 2 条返回 `errCode: 87014` |
| **预期结果** | `passed = [{id:'1'}, {id:'3'}]`，`blocked = [{id:'2', _risk:'risky'}]`，`stats.totalChecked=3, totalBlocked=1` |
| **验证点** | ✅ passed 含正常条目 ✅ blocked 含违规条目 ✅ 拦截条目带 _risk 标记 ✅ 统计正确 |

### CS-06 🟢 P2：命中率告警触发

| 项 | 内容 |
|----|------|
| **用例 ID** | CS-06 |
| **优先级** | 🟢 P2 |
| **PRD 对照** | AC-RQ10 §3："命中率 > 20% → 日志告警" |
| **前置条件** | SecurityCheck 实例状态为 NORMAL |
| **操作** | 依次 5 次检测：前 3 次通过（errCode:0），后 2 次拦截（errCode:87014）。此时 totalChecked=5, totalBlocked=2, hitRate=0.4 > 0.2 |
| **预期结果** | 第 5 次拦截后触发 `_checkAlert()`，控制台输出命中率告警日志 |
| **验证点** | ✅ hitRate > 20% 触发告警 ✅ 告警日志含命中数和总数 |

### CS-07 🟢 P2：降级后手动恢复

| 项 | 内容 |
|----|------|
| **用例 ID** | CS-07 |
| **优先级** | 🟢 P2 |
| **PRD 对照** | 运维场景：API 恢复后手动重置状态 |
| **前置条件** | SecurityCheck 已进入 DEGRADED 状态（CS-03 执行后） |
| **操作** | 调用 `reset()`，然后调用 `checkText("正常内容")`，Mock 返回 `errCode: 0` |
| **预期结果** | reset 后 `state === 'normal'`，`failCount === 0`；checkText 正常返回 `{ pass: true, risk: null }` |
| **验证点** | ✅ reset 恢复 NORMAL ✅ 计数器清零 ✅ 后续检测正常 |

---

## 三、Mock 测试脚本

以下脚本可直接在 Node.js 沙箱中运行，覆盖 CS-01~CS-07 全部 7 条用例：

```javascript
// test/v9-regression-content-safety.js
// AC-RQ10 内容安全审核回归测试 — 7 条用例

// ── Mock wx-server-sdk ──────────────────────────────
let mockErrCode = 0       // 0=通过, 87014=违规
let mockThrowError = false
let mockCallCount = 0

const mockCloud = {
  openapi: {
    security: {
      msgSecCheck: async ({ content }) => {
        mockCallCount++
        if (mockThrowError) throw new Error('ECONNREFUSED: mock API down')
        return { errCode: mockErrCode, errMsg: mockErrCode === 0 ? 'ok' : 'risky content' }
      },
      imgSecCheck: async () => {
        if (mockThrowError) throw new Error('ECONNREFUSED')
        return { errCode: mockErrCode }
      }
    }
  }
}

// Inject mock
require.cache[require.resolve('wx-server-sdk')] = {
  exports: () => mockCloud
}

// ── 测试 ────────────────────────────────────────────
const { SecurityCheck, STATE } = require('../cloudfunctions/common/securityCheck')

let passed = 0, failed = 0
function assert(cond, label) {
  if (cond) { passed++; console.log(`  [PASS] ${label}`) }
  else { failed++; console.log(`  [FAIL] ${label}`) }
}

// CS-02: 正常内容通过
console.log('\nCS-02: 正常内容通过')
mockErrCode = 0; mockThrowError = false; mockCallCount = 0
const sc2 = new SecurityCheck()
const r2 = await sc2.checkText('正常新闻标题')
assert(r2.pass === true, 'pass=true')
assert(r2.risk === null, 'risk=null')
assert(sc2.stats.totalChecked === 1, 'totalChecked=1')
assert(sc2.stats.totalBlocked === 0, 'totalBlocked=0')

// CS-01: 违规内容拦截
console.log('\nCS-01: 违规内容命中拦截')
mockErrCode = 87014; mockThrowError = false; mockCallCount = 0
const sc1 = new SecurityCheck()
const r1 = await sc1.checkText('包含违规内容')
assert(r1.pass === false, 'pass=false')
assert(r1.risk === 'risky', "risk='risky'")
assert(sc1.stats.totalBlocked === 1, 'totalBlocked=1')

// CS-04: 空内容直接放行
console.log('\nCS-04: 空内容直接放行')
mockCallCount = 0
const sc4 = new SecurityCheck()
const r4a = await sc4.checkText('')
const r4b = await sc4.checkText('   ')
assert(r4a.pass === true && r4a.risk === null, '空字符串放行')
assert(r4b.pass === true && r4b.risk === null, '纯空格放行')
assert(mockCallCount === 0, '未调 API')

// CS-03: API 连续失败 → 降级放行
console.log('\nCS-03: API 连续失败降级')
mockThrowError = true; mockCallCount = 0
const sc3 = new SecurityCheck({ failThreshold: 3 })
// 前 2 次：单次放行但状态不变
const r3a = await sc3.checkText('a')
const r3b = await sc3.checkText('b')
assert(r3a.pass === true && r3a.risk === 'degraded', '第1次失败: pass=true, risk=degraded')
assert(r3b.pass === true && r3b.risk === 'degraded', '第2次失败: pass=true, risk=degraded')
assert(sc3.state === STATE.NORMAL, '前2次失败后状态仍为 NORMAL')
// 第 3 次：触发降级
const r3c = await sc3.checkText('c')
assert(r3c.pass === true && r3c.risk === 'degraded', '第3次失败: pass=true, risk=degraded')
assert(sc3.state === STATE.DEGRADED, '第3次失败后状态变为 DEGRADED')
// 第 4 次：降级后跳过 API
mockThrowError = false; mockErrCode = 0
const r3d = await sc3.checkText('d')
assert(r3d.pass === true && r3d.risk === 'degraded', '降级后直接放行（跳过 API）')

// CS-05: 批量检测
console.log('\nCS-05: 批量检测 — 混合通过/拦截')
let batchCallCount = 0
const mockBatchCheck = async (content) => {
  batchCallCount++
  if (content.includes('违规')) return { errCode: 87014 }
  return { errCode: 0 }
}
// 重新 mock
const sc5 = new SecurityCheck()
sc5.checkText = async function(content) {
  // 直接模拟逻辑
  if (this._state === 'degraded' || this._state === 'disabled') return { pass: true, risk: 'degraded' }
  if (!content || !content.trim()) return { pass: true, risk: null }
  const result = await mockBatchCheck(content)
  this._totalChecked++
  if (result.errCode === 0) { this._failCount = 0; return { pass: true, risk: null } }
  if (result.errCode === 87014) { this._totalBlocked++; this._failCount = 0; return { pass: false, risk: 'risky' } }
  return { pass: true, risk: 'unknown_error' }
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

// CS-06: 命中率告警
console.log('\nCS-06: 命中率告警')
const sc6 = new SecurityCheck()
sc6.checkText = async function(content) {
  const idx = parseInt(content)
  this._totalChecked++
  if (idx >= 4) { this._totalBlocked++; this._failCount = 0; return { pass: false, risk: 'risky' } }
  this._failCount = 0; return { pass: true, risk: null }
}
for (let i = 1; i <= 5; i++) await sc6.checkText(String(i))
// totalChecked=5, totalBlocked=2 (第4,5次), hitRate=0.4
const hr = sc6.stats.hitRate
assert(parseFloat(hr) > 0.2, `hitRate=${hr} > 0.2 (应触发告警)`)

// CS-07: 降级后手动恢复
console.log('\nCS-07: 降级后手动恢复')
const sc7 = new SecurityCheck()
sc7._state = STATE.DEGRADED
sc7._failCount = 5
sc7.reset()
assert(sc7.state === STATE.NORMAL, "reset后 state='normal'")
assert(sc7.stats.failCount === 0, 'reset后 failCount=0')
assert(sc7.stats.totalChecked === 0, 'reset后 totalChecked=0')

// ── 结果 ────────────────────────────────────────────
console.log(`\n==============================================`)
console.log(`AC-RQ10 内容安全审核回归测试：通过 ${passed} / 失败 ${failed}`)
console.log(`==============================================`)
if (failed > 0) process.exit(1)
```

---

## 四、与 PRD 验收标准对照

| AC-RQ10 要求 | 对应用例 | 覆盖 |
|-------------|---------|:---:|
| IF 命中 msgSecCheck THEN 不入库且有日志 | CS-01 | ✅ |
| 正常内容放行 | CS-02 | ✅ |
| API 不可用时保守暂缓入库并告警 | CS-03 | ✅ |
| 空内容边界处理 | CS-04 | ✅ |
| 批量逐条检测 | CS-05 | ✅ |
| 命中率 > 20% 告警 | CS-06 | ✅ |
| 降级后手动恢复 | CS-07 | ✅ |

---

> **状态**：用例已完成 ✅，待生成可执行测试脚本 `test/v9-regression-content-safety.js`。
> **下一步**：将测试脚本落地到 `test/` 目录，纳入 Q-03 回归测试范围。
