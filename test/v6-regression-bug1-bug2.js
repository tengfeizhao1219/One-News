/**
 * v6 回归测试 —— Bug1（手势楔死）& Bug2（边界加载更多 / 刷新）
 *
 * 背景（根因）：
 *   Bug1：此前 touch.wxs 的 handleTouchEnd 在 callMethod('onWxsTouchEnd') 之后才重置
 *         touchState.isDragging；一旦 JS 回调抛错，重置不执行，isDragging 永久卡 true，
 *         卡片停在拖拽偏移位且禁用 transition —— 表现为“滑到某条突然卡死，滑两条又恢复”。
 *   Bug2：列表末/首条继续滑动没有反馈，应路由到加载更多 / 刷新。
 *
 * 本测试从“架构不变量”层面锁死修复，防止同类问题复发。
 * 运行：node test/v6-regression-bug1-bug2.js
 */

const fs = require('fs')
const path = require('path')
const { TextDecoder } = require('util')
const simulator = require('../mock/simulator')

const ROOT = path.resolve(__dirname, '..')
const files = {
  wxs: path.join(ROOT, 'pages/home/touch.wxs'),
  js: path.join(ROOT, 'pages/home/home.js'),
  sim: path.join(ROOT, 'mock/simulator.js'),
}

let pass = 0
let fail = 0
const failures = []

function check(name, cond, detail) {
  if (cond) {
    pass++
    console.log('  [PASS] ' + name)
  } else {
    fail++
    failures.push(name + (detail ? ' :: ' + detail : ''))
    console.log('  [FAIL] ' + name + (detail ? ' :: ' + detail : ''))
  }
}

function read(p) { return fs.readFileSync(p, 'utf-8') }

function isStrictUtf8(buf) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf)
    return true
  } catch (e) {
    return false
  }
}

// ===== 静态检查：touch.wxs 异常安全（Bug1 根因防护）=====
console.log('\n【静态】touch.wxs 手势层异常安全（Bug1 根因防护）')
{
  const wxs = read(files.wxs)
  const idxReset = wxs.indexOf('touchState.isDragging = false')
  const idxCall = wxs.indexOf("callMethod('onWxsTouchEnd'")
  check('handleTouchEnd 先无条件重置 isDragging 再回调',
    idxReset > -1 && idxCall > -1 && idxReset < idxCall,
    'reset@' + idxReset + ' call@' + idxCall)
  const tryCatchAroundCall = /try\s*\{[\s\S]*callMethod\('onWxsTouchEnd'[\s\S]*?\}\s*catch/.test(wxs)
  check('callMethod 被 try/catch 隔离（JS 异常不楔住手势层）', tryCatchAroundCall)
  const catchCount = (wxs.match(/catch \(e\)/g) || []).length
  check('三个 handler 均含 try/catch 隔离', catchCount >= 3, 'catch 数=' + catchCount)
}

// ===== 静态检查：home.js 架构不变量（Bug1 / Bug2 防护）=====
console.log('\n【静态】home.js 架构不变量')
{
  const js = read(files.js)
  check('含 onWxsTouchStart', js.includes('onWxsTouchStart(data)'))
  check('含 onWxsTouchMove', js.includes('onWxsTouchMove(data)'))
  check('含 onWxsTouchEnd', js.includes('onWxsTouchEnd(data)'))
  const lm = (js.match(/async loadMoreNews\(/g) || []).length
  const rc = (js.match(/async refreshCurrentCategory\(/g) || []).length
  check('loadMoreNews 唯一定义（无重复）', lm === 1, '出现 ' + lm + ' 次')
  check('refreshCurrentCategory 唯一定义（无重复）', rc === 1, '出现 ' + rc + ' 次')
  check('onWxsTouchEnd 边界路由 -> loadMoreNews', js.includes('this.loadMoreNews()'))
  check('onWxsTouchEnd 边界路由 -> refreshCurrentCategory', js.includes('this.refreshCurrentCategory()'))
  const endTryCatch = /onWxsTouchEnd\(data\)\s*\{[\s\S]*?try\s*\{[\s\S]*?\}\s*catch \(e\)\s*\{\s*console\.error\('onWxsTouchEnd error', e\)/.test(js)
  check('onWxsTouchEnd 整体被 try/catch 包裹', endTryCatch)
  const finallyCount = (js.match(/finally\s*\{\s*this\._isAnimating = false/g) || []).length
  check('动画 setTimeout 用 finally 重置 _isAnimating（3 处）', finallyCount === 3, 'finally 数=' + finallyCount)
  const cpReset = (js.match(/currentPage: 1/g) || []).length
  check('切换 / 加载分类均重置 currentPage（>=5 处）', cpReset >= 5, '出现 ' + cpReset + ' 次')
}

// ===== 静态检查：编码合规 =====
console.log('\n【静态】关键文件编码合规（UTF-8，非 GBK）')
{
  const targets = [files.wxs, files.js, files.sim, path.join(ROOT, 'utils/request.js')]
  let allUtf8 = true
  const bad = []
  for (const p of targets) {
    if (!isStrictUtf8(fs.readFileSync(p))) {
      allUtf8 = false
      bad.push(path.relative(ROOT, p))
    }
  }
  check('关键源码文件均为合法 UTF-8', allUtf8, bad.join(', '))
}

// ===== 运行时检查：simulator 无限延伸（Bug2 Mock 支撑）=====
console.log('\n【运行时】simulator 无限延伸加载（Bug2 在 Mock 模式下可演示）')
const mockNews = []
const cats = ['tech', 'sports', 'life', 'international']
for (let i = 0; i < 12; i++) {
  mockNews.push({
    id: 'n' + i, _id: 'n' + i,
    title: '新闻' + i, summary: '摘要' + i,
    category: cats[i % cats.length], source: 'mock', time: '2026-07-28'
  })
}
function runSim(cat, pageNum, pageSize) {
  return simulator.simulateGetNewsList(mockNews, cat, pageNum, pageSize)
}

async function runRuntime() {
  // 1) 原始数据内分页：有限
  const p1 = await runSim('all', 1, 5)
  check('原始分页第1页返回 5 条且 hasMore=true', p1.list.length === 5 && p1.hasMore === true, 'len=' + p1.list.length)
  const p3 = await runSim('all', 3, 5)
  check('原始分页末页返回剩余条目且 hasMore=false（有限）', p3.list.length === 2 && p3.hasMore === false, 'len=' + p3.list.length)
  check('原始分页条目不带“延伸阅读”标记', !p3.list[0].title.includes('延伸阅读'))

  // 2) 超出原始数据：无限延伸生成
  const big = await runSim('all', 100, 5)
  check('超大页码触发无限延伸并返回数据', big.list.length === 5, 'len=' + big.list.length)
  check('无限延伸场景下 hasMore=true', big.hasMore === true)
  check('延伸生成的新闻标题带“延伸阅读”标记', big.list.every(function (it) { return it.title.includes('延伸阅读') }))
  check('延伸生成的新闻 id 唯一且非空', new Set(big.list.map(function (it) { return it.id })).size === big.list.length)
  check('延伸生成的新闻携带 category / source 字段', big.list.every(function (it) { return it.category && it.source }))

  // 3) 不存在的分类：空（不生成）
  const none = await runSim('nonexistent', 100, 5)
  check('不存在分类返回空列表（不生成）', none.list.length === 0 && none.hasMore === false)

  // 4) empty 场景：空
  simulator.SIMULATE.scenario = 'empty'
  const emp = await runSim('all', 1, 5)
  check('empty 场景返回空列表', emp.list.length === 0 && emp.hasMore === false)
  simulator.SIMULATE.scenario = 'normal'
}

runRuntime().then(function () {
  console.log('\n==============================================')
  console.log('v6 回归测试（Bug1/Bug2）：通过 ' + pass + ' / 失败 ' + fail)
  console.log('==============================================')
  if (fail > 0) {
    console.log('\n失败项：')
    failures.forEach(function (f) { console.log('  - ' + f) })
    process.exit(1)
  } else {
    console.log('\n全部不变量校验通过 [OK]')
    process.exit(0)
  }
}).catch(function (err) {
  console.error('v6 测试运行异常:', err)
  process.exit(2)
})
