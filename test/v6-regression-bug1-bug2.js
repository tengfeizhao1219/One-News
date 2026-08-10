/**
 * v6 回归测试 —— Bug1（手势楔死）& Bug2（边界加载更多 / 刷新）
 *
 * 背景（根因）：
 *   Bug1：此前 touch.wxs 的 handleTouchEnd 在 callMethod('onWxsTouchEnd') 之后才重置
 *         touchState.isDragging；一旦 JS 回调抛错，重置不执行，isDragging 永久卡 true，
 *         卡片停在拖拽偏移位且禁用 transition —— 表现为"滑到某条突然卡死，滑两条又恢复"。
 *   Bug2：列表末/首条继续滑动没有反馈，应路由到加载更多 / 刷新。
 *
 * v5.9 更新：touch.wxs 已删除，卡片页改为 JS 线程 flick-only 手势。
 *   Bug1 防护（WXS isDragging 顺序）已不适用，改为 JS 层防护：
 *     - onTouchEnd 首行 `if (this._isAnimating) return`（动画锁）
 *     - loadMoreNews 首行 `if (this.data.loadingMore) return`（加载锁）
 *     - refreshCurrentCategory 首行 `if (this.data.isRefreshing) return`（重入锁，FS-CF3 升级）
 *     - _animateSwipeNext/Prev 内 finally 等效：setTimeout 链最后 `_isAnimating = false`
 *   Bug2 防护保留：边界路由 -> loadMoreNews/refreshCurrentCategory 断言不变。
 *
 * FS-CF3（2026-08-10）下拉刷新改造为分批增量（先快返回+逐条写库+getNewsDelta 短轮询）：
 *   - refreshCurrentCategory 改薄封装，直接调 _refreshWithIncrement；不再用 loadingMore 预置
 *     （避免与 _refreshWithIncrement 的 loadingMore 短路冲突），统一由 isRefreshing 守门。
 *   - currentPage 不在 refreshCurrentCategory 重置（增量刷新只 prepend 新条，currentPage
 *     是翻页用的"已读页码"，与首行刷新无关）；currentPage 重置职责只属于切分类（loadCategory
 *     /loadNews）。
 *
 * 本测试从"架构不变量"层面锁死修复，防止同类问题复发。
 * 运行：node test/v6-regression-bug1-bug2.js
 */

const fs = require('fs')
const path = require('path')
const { TextDecoder } = require('util')

const ROOT = path.resolve(__dirname, '..')
const files = {
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

// ===== 静态检查：home.js v5.9 JS flick-only 手势架构不变量（Bug1 根因防护）=====
// v5.9 架构事实：touch.wxs 已删除，卡片页迁移到 JS 线程 flick-only 手势。
// Bug1 防护不再依赖 WXS isDragging 重置顺序，改为 JS 层防护：
//   1) onTouchEnd 首行动画锁 `if (this._isAnimating) return` —— 动画期间拒绝新手势
//   2) loadMoreNews/refreshCurrentCategory 首行 `if (this.data.loadingMore) return` —— 重入锁
//   3) _animateSwipeNext/Prev 最后 `_isAnimating = false` —— 动画结束解锁
//   4) 无 WXS callMethod 回调 = 无跨线程异常传播风险
console.log('\n【静态】home.js v5.9 JS flick-only 手势架构不变量（Bug1 防护）')
{
  const js = read(files.js)

  // Bug1 防护 1: 动画锁 —— 首行拦截
  check('onTouchEnd 首行动画锁 _isAnimating',
    /onTouchEnd\(e\)\s*\{[\s\S]*?if\s*\(this\._isAnimating\)\s*return/.test(js),
    'onTouchEnd 首行必须 if (this._isAnimating) return')

  // Bug1 防护 2: 加载锁 —— loadMoreNews 重入保护
  check('loadMoreNews 首行加载锁 loadingMore',
    /async loadMoreNews\(\)\s*\{[\s\S]*?if\s*\(this\.data\.loadingMore\)\s*return/.test(js),
    'loadMoreNews 首行必须 if (this.data.loadingMore) return')

  // Bug1 防护 3: 加载锁 —— refreshCurrentCategory 重入保护
  // FS-CF3 (2026-08-10): refreshCurrentCategory 改薄封装直接调 _refreshWithIncrement,
  // 统一由 isRefreshing 守门（避免 loadingMore 双重锁短路），首行应含 isRefreshing 拦截
  // （允许与 loadingMore 复合判断：if (this.data.loadingMore || this.data.isRefreshing) return）
  check('refreshCurrentCategory 首行加载锁 isRefreshing',
    /async refreshCurrentCategory\(\)\s*\{[\s\S]*?if\s*\([^)]*this\.data\.isRefreshing[^)]*\)\s*return/.test(js),
    'refreshCurrentCategory 首行必须含 if (this.data.isRefreshing) return（FS-CF3 升级）')

  // Bug1 防护 4: 动画结束解锁 _isAnimating = false
  const animUnlockCount = (js.match(/_isAnimating = false/g) || []).length
  check('_isAnimating = false 至少出现 3 次（onTouchEnd/Next/Prev 各一次）',
    animUnlockCount >= 3, '出现 ' + animUnlockCount + ' 次（预期 >=3）')

  // Bug1 防护 5: 无 WXS callMethod（跨线程异常传播已消除）
  check('home.js 无 callMethod（无 WXS 回调）', !/callMethod/.test(js))

  // v5.9 手势参数不变性
  check('home.js 手势阈值 70px', js.includes('Math.abs(dy) < 70'))
  check('home.js 手势时间窗 500ms', js.includes('dt > 500'))
  check('home.js 含 onTouchStart', /onTouchStart\(e\)\s*\{/.test(js))
  check('home.js 含 onTouchEnd', /onTouchEnd\(e\)\s*\{/.test(js))

  // 确认旧 WXS 回调已清除
  check('home.js 无 onWxsTouchStart 死代码', !/onWxsTouchStart/.test(js))
  check('home.js 无 onWxsTouchMove 死代码', !/onWxsTouchMove/.test(js))
  check('home.js 无 onWxsTouchEnd 死代码', !/onWxsTouchEnd/.test(js))
}

// ===== 静态检查：home.js 架构不变量（Bug2 防护）=====
console.log('\n【静态】home.js 架构不变量（Bug2 边界路由防护）')
{
  const js = read(files.js)
  const lm = (js.match(/async loadMoreNews\(/g) || []).length
  const rc = (js.match(/async refreshCurrentCategory\(/g) || []).length
  check('loadMoreNews 唯一定义（无重复）', lm === 1, '出现 ' + lm + ' 次')
  check('refreshCurrentCategory 唯一定义（无重复）', rc === 1, '出现 ' + rc + ' 次')
  // v5.9: 边界路由从 onTouchEnd（JS flick-only），不再从 onWxsTouchEnd
  check('onTouchEnd 边界路由 -> loadMoreNews', js.includes('this.loadMoreNews()'))
  check('onTouchEnd 边界路由 -> refreshCurrentCategory', js.includes('this.refreshCurrentCategory()'))
  // BUG-20260802-004 后：切分类入口已收敛为 loadCategory -> loadNews，
  // 原「currentPage: 1 出现 >=5 次」的计数启发式随之失效，改为直接校验各入口的不变量本身
  function resetsCurrentPage(fnName) {
    const m = js.match(new RegExp(fnName + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n  \\},'))
    return !!m && m[0].includes('currentPage: 1')
  }
  check('loadCategory 重置 currentPage', resetsCurrentPage('loadCategory'))
  check('loadNews 重置 currentPage', resetsCurrentPage('async loadNews'))
  // FS-CF3 (2026-08-10): refreshCurrentCategory 改薄封装调 _refreshWithIncrement,
  // 增量刷新只 prepend 新条，currentPage（已读页码）不应在首行刷新时重置。
  check('refreshCurrentCategory 不重置 currentPage（FS-CF3 升级）',
    !resetsCurrentPage('async refreshCurrentCategory'),
    'refreshCurrentCategory 不应重置 currentPage（增量刷新与 currentPage 无关）')
}

// ===== 静态检查：编码合规 =====
console.log('\n【静态】关键文件编码合规（UTF-8，非 GBK）')
{
  const targets = [files.js, path.join(ROOT, 'utils/request.js')]
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
