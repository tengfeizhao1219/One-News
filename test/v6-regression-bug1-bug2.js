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

const ROOT = path.resolve(__dirname, '..')
const files = {
  wxs: path.join(ROOT, 'pages/home/touch.wxs'),
  js: path.join(ROOT, 'pages/home/home.js'),
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
// 架构事实：WXS 仅支持 ES5 子集，禁止 try/catch、let/const、箭头函数、模板字符串、
//          解构等语法；一旦使用，整模块编译失败，所有触摸回调与样式绑定全部失效
//          （正是 191ba57 推送后“侧边栏打不开 + 新闻不能滑动”的根因）。
//          因此 WXS 层无法用 try/catch，Bug1 的异常安全只能靠“先无条件重置再回调”的顺序保证，
//          真正的异常隔离在 JS 层 onWxsTouchEnd 内部 try/catch 完成。
console.log('\n【静态】touch.wxs 手势层异常安全（Bug1 根因防护）')
{
  const wxs = read(files.wxs)
  const idxReset = wxs.indexOf('touchState.isDragging = false')
  const idxCall = wxs.indexOf("callMethod('onWxsTouchEnd'")
  check('handleTouchEnd 先无条件重置 isDragging 再回调',
    idxReset > -1 && idxCall > -1 && idxReset < idxCall,
    'reset@' + idxReset + ' call@' + idxCall)

  // 仅对“代码”做非法语法扫描（剔除 // 行注释，避免误判注释文字）
  const codeOnly = wxs.split('\n').map(function (l) {
    return l.replace(/\/\/.*$/, '')
  }).join('\n')
  const forbidden = [
    ['try/catch', /\btry\s*\{|\bcatch\s*\(/],
    ['let', /\blet\s+/],
    ['const', /\bconst\s+/],
    ['箭头函数 =>', /=>/],
    ['模板字符串 `', /`/],
  ]
  let illegal = []
  forbidden.forEach(function (pair) {
    if (pair[1].test(codeOnly)) illegal.push(pair[0])
  })
  check('touch.wxs 代码为纯 ES5（不含 try/catch/let/const/箭头/模板字符串）',
    illegal.length === 0, '命中: ' + illegal.join(','))
  check('touch.wxs 绝不含 try/catch（否则整模块编译失败）',
    !/\btry\s*\{|\bcatch\s*\(/.test(codeOnly))

  // 三个 handler 均定义并导出
  const hasStart = /function handleTouchStart\(/.test(wxs) && /handleTouchStart: handleTouchStart/.test(wxs)
  const hasMove = /function handleTouchMove\(/.test(wxs) && /handleTouchMove: handleTouchMove/.test(wxs)
  const hasEnd = /function handleTouchEnd\(/.test(wxs) && /handleTouchEnd: handleTouchEnd/.test(wxs)
  check('三个触摸 handler 均定义并导出', hasStart && hasMove && hasEnd)
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
  // BUG-20260802-004 后：切分类入口已收敛为 loadCategory -> loadNews，
  // 原「currentPage: 1 出现 >=5 次」的计数启发式随之失效，改为直接校验各入口的不变量本身
  function resetsCurrentPage(fnName) {
    const m = js.match(new RegExp(fnName + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n  \\},'))
    return !!m && m[0].includes('currentPage: 1')
  }
  check('loadCategory 重置 currentPage', resetsCurrentPage('loadCategory'))
  check('loadNews 重置 currentPage', resetsCurrentPage('async loadNews'))
  check('refreshCurrentCategory 重置 currentPage', resetsCurrentPage('async refreshCurrentCategory'))
}

// ===== 静态检查：编码合规 =====
console.log('\n【静态】关键文件编码合规（UTF-8，非 GBK）')
{
  const targets = [files.wxs, files.js, path.join(ROOT, 'utils/request.js')]
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

// ===== 总结 =====
// 注：原“运行时 simulator 无限延伸”检查依赖 mock/simulator.js，v5 清理 Mock 后移除；
//     Bug1/Bug2 的防护已由上方架构不变量（静态检查）覆盖。
console.log('\n==============================================')
console.log('v6 回归测试（Bug1/Bug2 架构不变量）：通过 ' + pass + ' / 失败 ' + fail)
console.log('==============================================')
if (fail > 0) {
  console.log('\n失败项：')
  failures.forEach(function (f) { console.log('  - ' + f) })
  process.exit(1)
} else {
  console.log('\n全部不变量校验通过 [OK]')
  process.exit(0)
}
