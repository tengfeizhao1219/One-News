/**
 * v5.11 回归测试 —— 翻页方向（Bug1 中心闪现 / Bug2 面板打不开 / 详情页反向）
 *
 * 背景（根因）：
 *   Bug1（首页中心闪现→反向错觉）：v5.9 重写后 _animateSwipeNext 先 renderCards 到中心
 *        （animClass ''），30ms 后才把激活卡置为 in-up，导致新卡先闪现中央→下滑→上滑，
 *        表现为「翻下一页内容先往反方向走」。修复：renderCards 时直接以 incomingAnim
 *        ('in-up'/'in-down') 起始渲染，新卡从屏外直接滑入，无中心闪现。
 *
 *   Bug2（面板打不开）：onTouchEnd 在 `Math.abs(dy) < 70` 纵向早退之后才判定左滑面板，
 *        纯横向左滑（dy 极小）在到达面板判定前就被 return，侧边栏永远打不开。
 *        修复：左滑面板判定必须早于纵向早退。
 *
 *   详情页反向（单元素复用模型）：_swipeToNext/Prev 在 out 阶段结束后元素停在
 *        -100vh/+100vh，直接置 in-up/in-down 会让 transition 从 out 终点一路穿越全屏，
 *        30ms 清除后停留在「近反方向→中心」，新内容从【反方向】滑入——与预期相反。
 *        修复：先以 no-transition 瞬间吸附到 in 起点，再移除 class 触发正确方向滑入。
 *
 * 用户预期（验收标准）：
 *   翻下一页（上滑）→ 内容从【底部往上】滑入
 *   翻上一页（下滑）→ 内容从【顶部往下】滑入
 *
 * 运行：node test/v511-regression-swipe-direction.js
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const files = {
  homeJs: path.join(ROOT, 'pages/home/home.js'),
  detailJs: path.join(ROOT, 'pages/detail/detail.js'),
  detailWxss: path.join(ROOT, 'pages/detail/detail.wxss'),
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

function extractFn(src, fnName) {
  // 抓取方法体：从 `fnName(...) {` 到第一个 2 空格缩进的 `},`（方法结束）
  const re = new RegExp(fnName + '\\(\\)\\s*\\{[\\s\\S]*?\\n  \\},')
  const m = src.match(re)
  return m ? m[0] : ''
}

// ===== 首页：Bug2 面板判定早于纵向早退 =====
console.log('\n【静态】home.js onTouchEnd 左滑面板判定顺序（Bug2）')
{
  const js = read(files.homeJs)
  const m = js.match(/onTouchEnd\(e\)\s*\{([\s\S]*?)\n  \},/)
  const body = m ? m[1] : ''
  // 注意：注释里也写了「Math.abs(dy) < 70」（全角括号），必须匹配 `if (` 代码形态，避免误命中注释
  const panelIdx = body.indexOf('if (dx < -PANEL_SWIPE_THRESHOLD')
  const verticalReturnIdx = body.indexOf('if (Math.abs(dy) < 70')
  check('onTouchEnd 左滑面板判定早于纵向早退（Math.abs(dy)<70）',
    panelIdx >= 0 && verticalReturnIdx >= 0 && panelIdx < verticalReturnIdx,
    'panelIdx=' + panelIdx + ' verticalReturnIdx=' + verticalReturnIdx)
  check('onTouchEnd 左滑面板条件含横向优先 Math.abs(dx) > Math.abs(dy)',
    /dx < -PANEL_SWIPE_THRESHOLD && Math\.abs\(dx\) > Math\.abs\(dy\)/.test(body))
  check('onTouchEnd 纵向翻页仍需 70px + 500ms',
    body.includes('Math.abs(dy) < 70') && body.includes('dt > 500'))
}

// ===== 首页：Bug1 新卡以 incomingAnim 起始（无中心闪现）=====
console.log('\n【静态】home.js _animateSwipeNext/Prev 屏外起始（Bug1 修复）')
{
  const js = read(files.homeJs)
  const nextFn = extractFn(js, '_animateSwipeNext')
  const prevFn = extractFn(js, '_animateSwipePrev')
  check('_animateSwipeNext 新激活卡以 in-up 起始（从底部上滑入）',
    nextFn.includes("renderCards(that.data.newsList, newIndex, 'in-up')"), nextFn.slice(0, 0))
  check('_animateSwipePrev 新激活卡以 in-down 起始（从顶部下滑入）',
    prevFn.includes("renderCards(that.data.newsList, newIndex, 'in-down')"))
  // 确认没有遗留「先渲染中心再补 in-up」的反向写法
  check('_animateSwipeNext 无「先空 animClass 渲染再补 in-up」旧逻辑',
    !/renderCards\(that\.data\.newsList, newIndex\)\s*\n\s*setTimeout[\s\S]*?animClass:\s*'in-up'/.test(js))
}

// ===== 详情页：单元素模型 no-transition 吸附修复（反向 Bug）=====
console.log('\n【静态】detail.js _swipeToNext/Prev 无穿越反向（详情页预期方向）')
{
  const js = read(files.detailJs)
  check('detail _swipeToNext 以 in-up no-transition 起始（从底部上滑入）',
    js.includes("animClass: 'in-up no-transition'"))
  check('detail _swipeToPrev 以 in-down no-transition 起始（从顶部下滑入）',
    js.includes("animClass: 'in-down no-transition'"))
  // 防止回退为「裸 in-up / in-down」（会穿越全屏导致反向）
  check('detail _swipeToNext 无裸 in-up（必带 no-transition）',
    !/setData\(\{\s*animClass:\s*'in-up'\s*\}/.test(js))
  check('detail _swipeToPrev 无裸 in-down（必带 no-transition）',
    !/setData\(\{\s*animClass:\s*'in-down'\s*\}/.test(js))
}

// ===== 详情页 WXSS：no-transition 类存在 =====
console.log('\n【静态】detail.wxss .article.no-transition 无过渡类')
{
  const wxss = read(files.detailWxss)
  check('detail.wxss 含 .article.no-transition { transition: none }',
    /\.article\.no-transition\s*\{\s*transition:\s*none/.test(wxss))
}

// ===== 总结 =====
console.log('\n==============================================')
console.log('v5.11 回归测试（翻页方向 Bug1/Bug2/详情反向）：通过 ' + pass + ' / 失败 ' + fail)
console.log('==============================================')
if (fail > 0) {
  console.log('\n失败项：')
  failures.forEach(function (f) { console.log('  - ' + f) })
  process.exit(1)
} else {
  console.log('\n全部不变量校验通过 [OK]')
  process.exit(0)
}
