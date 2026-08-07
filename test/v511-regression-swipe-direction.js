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
  // 2026-08-07 巡检：纵向阈值改用常量 SWIPE_THRESHOLD（=70），顺序校验不变
  const verticalReturnIdx = body.indexOf('if (Math.abs(dy) < SWIPE_THRESHOLD')
  check('onTouchEnd 左滑面板判定早于纵向早退（Math.abs(dy)<SWIPE_THRESHOLD）',
    panelIdx >= 0 && verticalReturnIdx >= 0 && panelIdx < verticalReturnIdx,
    'panelIdx=' + panelIdx + ' verticalReturnIdx=' + verticalReturnIdx)
  check('onTouchEnd 左滑面板条件含横向优先 Math.abs(dx) > Math.abs(dy)',
    /dx < -PANEL_SWIPE_THRESHOLD && Math\.abs\(dx\) > Math\.abs\(dy\)/.test(body))
  check('onTouchEnd 纵向翻页仍需 70px + 500ms',
    body.includes('Math.abs(dy) < SWIPE_THRESHOLD') && body.includes('dt > 500'))
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
  // 首页多卡片模型 no-transition 吸附修复：新卡先瞬间吸附再 transition（否则新节点从 0→±page-h 反向闪）
  check('_animateSwipeNext renderCards 后立即加 no-transition 吸附',
    /renderCards[\s\S]*?no-transition/.test(nextFn))
  check('_animateSwipePrev renderCards 后立即加 no-transition 吸附',
    /renderCards[\s\S]*?no-transition/.test(prevFn))
  check('_animateSwipeNext 30ms 后 animClass 全部清空为 \'\'（触发 transition）',
    /animClass:\s*''/.test(nextFn))
  check('_animateSwipePrev 30ms 后 animClass 全部清空为 \'\'（触发 transition）',
    /animClass:\s*''/.test(prevFn))
  // 反向校验：最终清空时不得残留 replace('no-transition')（那只会去掉 no-transition，
  // 但 in-up/in-down 还在，卡片永远停在屏外导致空白）
  check('_animateSwipeNext 清空逻辑不使用 replace(\'no-transition\')（避免残留 in-up）',
    !nextFn.includes("replace('no-transition'"))
  check('_animateSwipePrev 清空逻辑不使用 replace(\'no-transition\')（避免残留 in-down）',
    !prevFn.includes("replace('no-transition'"))
}

// ===== 详情页：单元素模型 no-transition 吸附修复（反向 Bug）=====
console.log('\n【静态】detail.js _swipeToNext/Prev 翻页动画（详情页预期方向）')
{
  const js = read(files.detailJs)
  check('detail _swipeToNext 以 in-up no-transition 起始（从底部上滑入）',
    js.includes("animClass: 'in-up no-transition'"))
  check('detail _swipeToPrev 以 in-down no-transition 起始（从顶部整屏下滑入）',
    js.includes("animClass: 'in-down no-transition'"))
  // 防止回退为「裸 in-up / in-down」（会穿越全屏导致反向）
  check('detail _swipeToNext 无裸 in-up（必带 no-transition）',
    !/setData\(\{\s*animClass:\s*'in-up'\s*\}/.test(js))
  check('detail _swipeToPrev 无裸 in-down（必带 no-transition）',
    !/setData\(\{\s*animClass:\s*'in-down'\s*\}/.test(js))
}

// ===== 详情页 WXSS：动画类存在 =====
console.log('\n【静态】detail.wxss .article 动画类')
{
  const wxss = read(files.detailWxss)
  check('detail.wxss 含 .article.no-transition { transition: none }',
    /\.article\.no-transition\s*\{\s*transition:\s*none/.test(wxss))
  check('detail.wxss 含 .article.in-down（整屏从上方滑入）',
    wxss.includes('.article.in-down'))
}

// ===== 首页 WXSS：no-transition 类存在（多卡片模型吸附修复） =====
console.log('\n【静态】home.wxss .card.no-transition 无过渡类')
{
  const homeWxss = read(path.join(ROOT, 'pages/home/home.wxss'))
  check('home.wxss 含 .card.no-transition { transition: none }',
    /\.card\.no-transition\s*\{\s*transition:\s*none/.test(homeWxss))
}

// ===== v5.9 回归根因修复：100vh 在 transform 内不可靠 → 改用 JS 注入的 --page-h 像素值 =====
// 用户反馈：v5.9 将翻页偏移由 PAGE_HEIGHT(px) 改为 100vh 后，翻页方向在部分机型/Webview 下随机/反向；
// pre-v5.9 卡片页用 PAGE_HEIGHT(px) 偏移方向正确。修复：CSS 变量 --page-h（= windowHeight px）。
console.log('\n【静态】home.wxss / detail.wxss 翻页偏移使用 --page-h（避免 100vh 在 transform 内失效）')
{
  const homeWxss = read(path.join(ROOT, 'pages/home/home.wxss'))
  const dWxss = read(files.detailWxss)
  const homeNeed = [
    ".card.out-up   { transform: translateY(calc(-1 * var(--page-h",
    ".card.out-down { transform: translateY(var(--page-h",
    ".card.in-up    { transform: translateY(var(--page-h",
    ".card.in-down  { transform: translateY(calc(-1 * var(--page-h",
  ]
  homeNeed.forEach(function (s) {
    check('home.wxss ' + s.trim().split(' ')[0] + ' 使用 --page-h', homeWxss.includes(s))
  })
  const dNeed = [
    ".article.out-up   { transform: translateY(calc(-1 * var(--page-h",
    ".article.out-down { transform: translateY(var(--page-h",
    ".article.in-up    { transform: translateY(var(--page-h",
    ".article.in-down  { transform: translateY(calc(-1 * var(--page-h",
  ]
  dNeed.forEach(function (s) {
    check('detail.wxss ' + s.trim().split(' ')[0] + ' 使用 --page-h', dWxss.includes(s))
  })
  // 反向校验：transform 内不得残留裸 100vh（var(--page-h, 100vh) 的 fallback 不算）
  check('home.wxss .card 翻页 transform 无裸 100vh',
    !/\.card\.(out|in)-(up|down)\s*\{\s*transform:\s*translateY\(-?100vh\)/.test(homeWxss))
  check('detail.wxss .article 翻页 transform 无裸 100vh',
    !/\.article\.(out|in)-(up|down)\s*\{\s*transform:\s*translateY\(-?100vh\)/.test(dWxss))
}

// ===== v5.12：短内容翻页保护 + 翻上一页淡入淡出 =====
console.log('\n【静态】detail.js 短内容保护 _needsSecondSwipe + onScrollToLower 清除')
{
  const dJs = read(files.detailJs)
  check('detail.js onLoad 初始化 _needsSecondSwipe = false',
    dJs.includes('this._needsSecondSwipe = false'))
  check('detail.js _measureScroll 短内容设 _needsSecondSwipe = true',
    dJs.includes('that._needsSecondSwipe = true'))
  check('detail.js onTouchEnd 上滑分支含 _needsSecondSwipe 判断',
    dJs.includes('if (this._needsSecondSwipe)'))
  check('detail.js _needsSecondSwipe 为 true 时不调用 _swipeToNext',
    /if\s*\(\s*this\._needsSecondSwipe\s*\)\s*\{[\s\S]*?_needsSecondSwipe\s*=\s*false[\s\S]*?return/.test(dJs))
  check('detail.js onScrollToLower 清除 _needsSecondSwipe',
    /onScrollToLower[\s\S]*?_needsSecondSwipe\s*=\s*false/.test(dJs))
}

// ===== JS 注入 --page-h（pageH: PAGE_HEIGHT），与 WXSS var(--page-h) 对应 =====
console.log('\n【静态】home.js / detail.js 注入 pageH = PAGE_HEIGHT（配套 --page-h）')
{
  const homeJs = read(files.homeJs)
  const dJs = read(files.detailJs)
  check('home.js onLoad 注入 pageH: PAGE_HEIGHT',
    homeJs.includes('this.setData({ pageH: PAGE_HEIGHT })'))
  check('detail.js onLoad 注入 pageH: PAGE_HEIGHT',
    dJs.includes('this.setData({ pageH: PAGE_HEIGHT })'))
  check('home.js 已导入 PAGE_HEIGHT', homeJs.includes('PAGE_HEIGHT'))
  check('detail.js 已导入 PAGE_HEIGHT', dJs.includes('var PAGE_HEIGHT = C.PAGE_HEIGHT'))
  // WXML 根节点需将 pageH 注入为 --page-h CSS 变量
  const homeWxml = read(path.join(ROOT, 'pages/home/home.wxml'))
  const dWxml = read(path.join(ROOT, 'pages/detail/detail.wxml'))
  check('home.wxml 根节点注入 --page-h: {{pageH}}px',
    homeWxml.includes('--page-h: {{pageH}}px;'))
  check('detail.wxml 根节点注入 --page-h: {{pageH}}px',
    dWxml.includes('--page-h: {{pageH}}px;'))
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
