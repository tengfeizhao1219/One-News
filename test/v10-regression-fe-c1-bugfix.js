/**
 * FE-C1 回归 —— BUG-20260802-001 / 004 / 006 运行时行为验证
 *
 * 目的：不以「代码已提交」结论闭环，而是把 home / detail 两个页面对象
 *      真实 require 进来、mock 掉 wx 与数据层，驱动真实用户操作序列，
 *      断言最终 data / 内部状态符合验收标准。
 *
 * 运行：node test/v10-regression-fe-c1-bugfix.js
 */

var Module = require('module')

// ===== 测试框架 =====
var pass = 0
var fail = 0
var failures = []

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

function assertEqual(name, actual, expected) {
  check(name, actual === expected,
    'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual))
}

// ===== Mock 数据层 =====
var CATEGORIES = [
  { id: 'all', name: '全部' },
  { id: 'recommend', name: '推荐' },
  { id: 'tech', name: '科技' },
  { id: 'international', name: '国际' },
  { id: 'sports', name: '科学探索' },
  { id: 'life', name: '社会' },
  // agriculture/science 已于 2026-08-03 按产品 owner 裁定下架
]

// 记录 getNewsList 调用，用于验证「双请求」是否已消除
var apiCalls = []
var apiSeq = 0

function makeNewsList(catId, count) {
  var list = []
  for (var i = 0; i < count; i++) {
    list.push({
      id: catId + '-n' + (i + 1),
      _id: catId + '-n' + (i + 1),
      title: catId + ' 标题' + (i + 1) + ' #' + apiSeq,  // 带批次号：不同请求内容不同
      summary: '摘要\n第二段\n第三段',
      category: catId === 'all' ? (i % 2 === 0 ? 'tech' : 'sports') : catId,
      categoryName: catId,
      source: 'src',
      time: '10:00',
    })
  }
  return list
}

var mockGetNewsList = function (params) {
  apiSeq++
  apiCalls.push(params.category + (params.pageNum ? '#p' + params.pageNum : ''))
  var cat = params.category
  var count = cat === 'all' ? 6 : (cat === 'tech' ? 4 : 3)
  return Promise.resolve({ list: makeNewsList(cat, count) })
}

var mockConstants = {
  CATEGORIES: CATEGORIES,
  SWIPE_THRESHOLD: 50,
  PANEL_SWIPE_THRESHOLD: 60,
  SWIPE_ANIMATION_MS: 10,
  BOUNCE_ANIMATION_MS: 10,
  STATUS_BAR_HEIGHT: 20,
  PAGE_HEIGHT: 667,
  PAGE_SIZE: 10,
  refreshPageSize: function () {},
}

var originalRequire = Module.prototype.require
Module.prototype.require = function (id) {
  if (id.endsWith('utils/constants')) return mockConstants
  if (id.endsWith('utils/request')) {
    return {
      getNewsList: mockGetNewsList,
      getNewsDetail: function (id2) { return Promise.resolve({ id: id2, title: 't', content: 'a\nb' }) },
      handleApiError: function (code, msg) { return msg || '错误' },
    }
  }
  if (id.endsWith('utils/localCache')) {
    var store = {}
    var LC = function () {
      return { get: function (k) { return store[k] || null }, set: function (k, v) { store[k] = v } }
    }
    return { LocalCache: LC, localCache: new LC() }
  }
  return originalRequire.apply(this, arguments)
}

// ===== Mock 小程序运行时 =====
var capturedPage = null
var toastLog = []
var hideToastCount = 0
// 由测试控制的 selectorQuery 返回值（模拟真机实测高度）
var measureResult = null

global.Page = function (cfg) { capturedPage = cfg }
global.getApp = function () { return { globalData: {} } }
global.wx = {
  getSystemInfoSync: function () { return { windowHeight: 667, windowWidth: 375, statusBarHeight: 20, theme: 'light' } },
  showToast: function (o) { toastLog.push(o.title) },
  hideToast: function () { hideToastCount++ },
  showLoading: function () {},
  hideLoading: function () {},
  stopPullDownRefresh: function () {},
  navigateTo: function () {},
  navigateBack: function () {},
  createSelectorQuery: function () {
    var q = {
      _sel: [],
      in: function () { return q },
      select: function (s) { q._sel.push(s); return q },
      boundingClientRect: function () { return q },
      exec: function (cb) { cb(measureResult) },
    }
    return q
  },
  cloud: { callFunction: function () { return Promise.resolve({ result: { code: 0, data: { inserted: 1 } } }) } },
}

// 创建页面实例：把 Page 配置对象变成可调用的实例
function instantiate(cfg) {
  var inst = Object.create(cfg)
  inst.data = JSON.parse(JSON.stringify(cfg.data || {}))
  inst.setData = function (patch, cb) {
    for (var k in patch) inst.data[k] = patch[k]
    if (typeof cb === 'function') cb()
  }
  inst.selectComponent = function () { return null }
  return inst
}

function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 0) }) }

// ================================================================
// BUG-20260802-001：详情页双向翻页
// ================================================================
function testDetailPaging() {
  console.log('\n【BUG-20260802-001】详情页触底/触顶判定')

  delete require.cache[require.resolve('../pages/detail/detail.js')]
  require('../pages/detail/detail.js')
  var cfg = capturedPage
  var page = instantiate(cfg)

  check('scroll-view 已绑定原生边界事件 handler',
    typeof cfg.onScrollToLower === 'function' && typeof cfg.onScrollToUpper === 'function')

  // --- 场景1：复现旧 Bug 条件 —— 真实高度(600) 远大于估算值(667-150=517) ---
  page._isAtTop = true
  page._isAtBottom = false
  page._bottomScrollTop = null
  page._clientHeight = 517   // 估算值
  var scrollHeight = 1200
  var realClient = 600
  var maxScrollTop = scrollHeight - realClient  // 600 = 真实滚到底的位置

  // 旧逻辑：scrollTop + 估算高度 >= scrollHeight - 50 → 600+517=1117 >= 1150 ? false
  check('旧估算逻辑在真实触底时确实判定失败（Bug 根因复现）',
    !(maxScrollTop + 517 >= scrollHeight - 50))

  // 新逻辑：用户滑到底 → 先来 scroll 事件，再来原生 scrolltolower
  page.onContentScroll({ detail: { scrollTop: maxScrollTop, scrollHeight: scrollHeight } })
  page.onScrollToLower()
  assertEqual('原生 scrolltolower 触发后 _isAtBottom=true', page._isAtBottom, true)

  // 关键：惯性滚动又补了一个 scroll 事件，不能把已触底状态清掉
  page.onContentScroll({ detail: { scrollTop: maxScrollTop, scrollHeight: scrollHeight } })
  assertEqual('触底后补发的 scroll 事件不会误清触底状态', page._isAtBottom, true)

  // 上滑翻页应放行
  var wentNext = false
  page._animating = false
  page._engine = {}
  page.data.isLast = false
  page.data.isFirst = false
  page._swipeToNext = function () { wentNext = true }
  page._swipeToPrev = function () {}
  page.onTouchStart({ touches: [{ clientY: 500 }] })
  page.onTouchEnd({ changedTouches: [{ clientY: 300 }] })  // dy=-200 上滑
  check('已触底时上滑 → 翻下一条生效（方向1）', wentNext)

  // --- 场景2：用户滑回顶部 ---
  page.onContentScroll({ detail: { scrollTop: 0, scrollHeight: scrollHeight } })
  page.onScrollToUpper()
  assertEqual('滚回顶部后 _isAtTop=true', page._isAtTop, true)
  assertEqual('滚回顶部后 _isAtBottom 已复位', page._isAtBottom, false)

  var wentPrev = false
  page._swipeToPrev = function () { wentPrev = true }
  page.onTouchStart({ touches: [{ clientY: 300 }] })
  page.onTouchEnd({ changedTouches: [{ clientY: 500 }] })  // dy=+200 下滑
  check('已触顶时下滑 → 翻上一条生效（方向2）', wentPrev)

  // --- 场景3：onReady 实测真实高度，覆盖估算值 ---
  measureResult = [{ height: realClient }, { height: 1200 }]
  page._clientHeight = 517
  page.onReady()
  assertEqual('onReady 实测高度已覆盖估算值', page._clientHeight, realClient)

  // 实测后，纯 scroll 事件（无原生事件）也能正确判触底
  page._isAtBottom = false
  page._bottomScrollTop = null
  page.onContentScroll({ detail: { scrollTop: maxScrollTop, scrollHeight: scrollHeight } })
  assertEqual('实测高度生效后 scroll 事件自身即可判定触底', page._isAtBottom, true)

  // --- 场景4：内容不足一屏（永远不会触发 scroll 事件）---
  measureResult = [{ height: 600 }, { height: 300 }]
  page._isAtBottom = false
  page.onReady()
  assertEqual('内容不足一屏时直接视为已触底（否则永远无法上滑翻页）', page._isAtBottom, true)

  // --- 场景5：中途位置不应误判为边界 ---
  measureResult = [{ height: realClient }, { height: 1200 }]
  page.onReady()
  page._bottomScrollTop = null
  page.onContentScroll({ detail: { scrollTop: 200, scrollHeight: scrollHeight } })
  assertEqual('滚动到中间：_isAtBottom=false', page._isAtBottom, false)
  assertEqual('滚动到中间：_isAtTop=false', page._isAtTop, false)
}

// ================================================================
// BUG-20260802-004：卡片 ≡ 侧栏 单一数据源
// ================================================================
async function testSingleSource() {
  console.log('\n【BUG-20260802-004】卡片与侧栏数据源统一')

  delete require.cache[require.resolve('../pages/home/home.js')]
  require('../pages/home/home.js')
  var cfg = capturedPage
  var page = instantiate(cfg)

  check('loadPanelNews 已移除', typeof cfg.loadPanelNews === 'undefined')
  check('_preloadAllCategories 已移除', typeof cfg._preloadAllCategories === 'undefined')
  check('_panelCache 已移除', typeof cfg._panelCache === 'undefined')
  check('新增单一数据源派生函数 _syncPanelList', typeof cfg._syncPanelList === 'function')

  // --- 首次加载 ---
  apiCalls = []
  page.onLoad()
  await tick(5)

  assertEqual('onLoad 只发一次 getNewsList（原为卡片+侧栏双请求）', apiCalls.length, 1)

  var titlesCard = page.data.newsList.map(function (i) { return i.title })
  var titlesPanel = page.data.filteredNewsList.map(function (i) { return i.title })
  assertEqual('首次加载：卡片与侧栏条数一致', titlesPanel.length, titlesCard.length)
  assertEqual('首次加载：卡片与侧栏内容逐条一致',
    JSON.stringify(titlesPanel), JSON.stringify(titlesCard))

  // --- 刷新（模拟内容变化）后仍一致 ---
  apiCalls = []
  await page.loadNews()
  titlesCard = page.data.newsList.map(function (i) { return i.title })
  titlesPanel = page.data.filteredNewsList.map(function (i) { return i.title })
  assertEqual('刷新后：只发一次请求', apiCalls.length, 1)
  assertEqual('刷新后：卡片与侧栏内容仍逐条一致',
    JSON.stringify(titlesPanel), JSON.stringify(titlesCard))

  // --- 切换分类后一致 ---
  apiCalls = []
  await page.onCategoryChange({ currentTarget: { dataset: { cat: 'tech' } } })
  await tick(5)
  assertEqual('切分类后 currentCategory 已切换', page.data.currentCategory, 'tech')
  assertEqual('切分类后 panelCategory 同步', page.data.panelCategory, 'tech')
  assertEqual('切分类只发一次请求（原卡片/侧栏各一次）', apiCalls.length, 1)
  titlesCard = page.data.newsList.map(function (i) { return i.title })
  titlesPanel = page.data.filteredNewsList.map(function (i) { return i.title })
  assertEqual('切分类后：卡片与侧栏内容一致',
    JSON.stringify(titlesPanel), JSON.stringify(titlesCard))
  check('切分类后侧栏内容确实来自 tech', titlesPanel.length > 0 && titlesPanel[0].indexOf('tech') === 0)

  // --- 反复切换回来：不能命中「永不失效缓存」而拿到旧内容 ---
  var techBatch1 = page.data.filteredNewsList[0].title
  await page.onCategoryChange({ currentTarget: { dataset: { cat: 'sports' } } })
  await tick(5)
  await page.onCategoryChange({ currentTarget: { dataset: { cat: 'tech' } } })
  await tick(5)
  var techBatch2 = page.data.filteredNewsList[0].title
  check('切回旧分类会重新拉取（_panelCache 永不失效问题已消除）', techBatch1 !== techBatch2,
    techBatch1 + ' vs ' + techBatch2)
  assertEqual('切回后卡片与侧栏依然一致',
    JSON.stringify(page.data.newsList.map(function (i) { return i.title })),
    JSON.stringify(page.data.filteredNewsList.map(function (i) { return i.title })))

  // --- 加载更多后侧栏同步扩容 ---
  var beforeLen = page.data.newsList.length
  await page.loadMoreNews()
  await tick(5)
  assertEqual('加载更多后卡片列表变长', page.data.newsList.length > beforeLen, true)
  assertEqual('加载更多后侧栏同步扩容、与卡片一致',
    JSON.stringify(page.data.newsList.map(function (i) { return i.title })),
    JSON.stringify(page.data.filteredNewsList.map(function (i) { return i.title })))

  // --- 「正在阅读」高亮与实际阅读项同步 ---
  page.renderCards(page.data.newsList, 2)
  assertEqual('卡片翻到 index=2 时侧栏高亮同步', page.data.panelCurrentIndex, 2)
  var highlighted = page.data.filteredNewsList.filter(function (i) { return i._originalIndex === 2 })
  assertEqual('高亮项唯一', highlighted.length, 1)
  assertEqual('高亮项 == 当前卡片', highlighted[0].title, page.data.newsList[2].title)

  // --- 侧栏点击定位到对应卡片 ---
  page.onPanelItemTap({ currentTarget: { dataset: { index: 1 } } })
  assertEqual('侧栏点击后定位到对应卡片', page.data.currentIndex, 1)
  assertEqual('侧栏点击后面板关闭', page.data.showPanel, false)

  // --- 'all' 分类不过滤（混合分类不会被误删）---
  await page.loadCategory('all')
  await tick(5)
  assertEqual("'all' 分类下侧栏不做分类过滤",
    page.data.filteredNewsList.length, page.data.newsList.length)
}

// ================================================================
// BUG-20260802-006：分类切换 0.5s 提示
// ================================================================
async function testCategoryHint() {
  console.log('\n【BUG-20260802-006】分类切换 0.5s 提示可见')

  delete require.cache[require.resolve('../pages/home/home.js')]
  require('../pages/home/home.js')
  var page = instantiate(capturedPage)
  page.onLoad()
  await tick(5)

  // 模拟：刚刚触发过「刷新中…」原生 loading toast
  toastLog = []
  hideToastCount = 0

  page._showCategoryHint('tech')
  assertEqual('切分类后立即显示分类名提示', page.data.categoryHint, '科技')
  check('显示提示前会关闭遮挡的原生 toast（刷新中/加载更多）', hideToastCount === 1)

  await tick(300)
  assertEqual('300ms 时提示仍然可见（未被提前清除）', page.data.categoryHint, '科技')

  await tick(300)
  assertEqual('约 500ms 后提示自动消失', page.data.categoryHint, '')

  // 时序覆盖：加载流程中的 setData 不能把提示挤掉
  page._showCategoryHint('sports')
  assertEqual('提示已显示', page.data.categoryHint, '科学探索')
  await page.loadNews()      // 加载流程走完（含 pageState loading→ready + renderCards）
  check('加载/刷新流程走完后提示未被覆盖清空', page.data.categoryHint === '科学探索')
  await tick(600)
  assertEqual('提示最终仍按 500ms 定时器清除', page.data.categoryHint, '')

  // 连续快速切换：定时器不叠加导致提前清除
  page._showCategoryHint('tech')
  await tick(200)
  page._showCategoryHint('life')
  await tick(350)
  assertEqual('连续切换时新提示不被上一个定时器提前清掉', page.data.categoryHint, '社会')
  await tick(250)
  assertEqual('新提示按自己的 500ms 清除', page.data.categoryHint, '')
}

// ===== WXML / WXSS 静态验收 =====
function testMarkup() {
  console.log('\n【静态】WXML / WXSS 修复点')
  var fs = require('fs')
  var path = require('path')
  var ROOT = path.resolve(__dirname, '..')

  var detailWxml = fs.readFileSync(path.join(ROOT, 'pages/detail/detail.wxml'), 'utf8')
  check('detail.wxml 已加 bindscrolltolower', detailWxml.indexOf('bindscrolltolower="onScrollToLower"') > -1)
  check('detail.wxml 已加 bindscrolltoupper', detailWxml.indexOf('bindscrolltoupper="onScrollToUpper"') > -1)
  check('detail.wxml 保留 bindscroll 用于位置计算', detailWxml.indexOf('bindscroll="onContentScroll"') > -1)

  var wxss = fs.readFileSync(path.join(ROOT, 'pages/home/home.wxss'), 'utf8')
  function zIndexOf(sel) {
    var m = wxss.match(new RegExp('\\' + sel + '\\s*\\{[^}]*z-index:\\s*(\\d+)'))
    return m ? parseInt(m[1], 10) : -1
  }
  var hintZ = zIndexOf('.category-hint')
  var panelZ = zIndexOf('.slide-panel')
  var overlayZ = zIndexOf('.panel-overlay')
  check('category-hint z-index 高于侧栏面板', hintZ > panelZ, hintZ + ' vs ' + panelZ)
  check('category-hint z-index 高于遮罩层', hintZ > overlayZ, hintZ + ' vs ' + overlayZ)

  var home = fs.readFileSync(path.join(ROOT, 'pages/home/home.js'), 'utf8')
  check('home.js 内已无 _panelCache 实际引用',
    home.indexOf('this._panelCache') === -1 && home.indexOf('that._panelCache') === -1)
  check('home.js 保留 MAX_NEWS = 15 分页行为', /MAX_NEWS\s*=\s*15/.test(home))
}

// ===== 执行 =====
async function main() {
  console.log('='.repeat(64))
  console.log(' FE-C1 回归：BUG-20260802-001 / 004 / 006')
  console.log('='.repeat(64))

  testDetailPaging()
  await testSingleSource()
  await testCategoryHint()
  testMarkup()

  console.log('\n' + '='.repeat(64))
  console.log(' 通过 ' + pass + ' / 失败 ' + fail)
  if (fail > 0) {
    console.log('\n失败项：')
    failures.forEach(function (f) { console.log('  - ' + f) })
  }
  console.log('='.repeat(64))
  process.exit(fail > 0 ? 1 : 0)
}

main()
