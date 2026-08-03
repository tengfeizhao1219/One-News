/**
 * v7 阅读模式回归 —— 运行时测试（Q-新05 补充）
 *
 * 现有 v7 回归仅有静态架构检查（37 条），本脚本补充 ReadingEngine
 * 实际运行时行为验证：初始化、翻页、跨分类检测、缓存、边界等。
 *
 * 运行：node test/v7-regression-reading-mode-runtime.js
 */

// ===== Mock 依赖 =====
var Module = require('module')
var originalLoad = Module._load || Module._compile

// Mock constants
var mockConstants = {
  CATEGORIES: [
    { id: 'recommend', name: '推荐' },
    { id: 'tech', name: '科技' },
    { id: 'international', name: '国际' },
    { id: 'sports', name: '体育' },
    { id: 'life', name: '生活' },
    // agriculture/science 已于 2026-08-03 按产品 owner 裁定下架
    { id: 'all', name: '全部' },
  ],
  PAGE_SIZE: 10,
}

// Mock request: 每个分类返回模拟数据
function makeNewsList(categoryId, count) {
  var list = []
  for (var i = 0; i < count; i++) {
    list.push({
      id: categoryId + '-news-' + (i + 1),
      _id: categoryId + '-news-' + (i + 1),
      title: categoryId + ' 新闻标题 ' + (i + 1),
      summary: categoryId + ' 摘要内容 ' + (i + 1),
      category: categoryId,
      categoryName: categoryId === 'recommend' ? '推荐' :
                     categoryId === 'tech' ? '科技' :
                     categoryId === 'international' ? '国际' :
                     categoryId === 'sports' ? '体育' :
                     categoryId === 'life' ? '生活' : '未知',
      source: '来源' + categoryId,
      sourceUrl: 'https://example.com/' + categoryId + '/' + (i + 1),
      picUrl: '',
      publishTime: '2026-07-31',
    })
  }
  return list
}

var mockGetNewsList = function (params) {
  var catId = params.category
  var count = (catId === 'recommend') ? 5 :
              (catId === 'tech') ? 3 :
              (catId === 'international') ? 4 :
              (catId === 'sports') ? 2 :
              (catId === 'life') ? 3 : 2
  return Promise.resolve({ list: makeNewsList(catId, count) })
}

var mockGetNewsDetail = function (newsId) {
  return Promise.resolve({
    id: newsId,
    _id: newsId,
    title: '详情标题 ' + newsId,
    content: '这是 ' + newsId + ' 的正文内容。\n第二段内容。\n第三段内容。',
    summary: '摘要 ' + newsId,
    category: newsId.split('-')[0],
    source: '测试来源',
    sourceUrl: 'https://example.com/' + newsId,
    picUrl: '',
    publishTime: '2026-07-31',
  })
}

// 拦截 require
var path = require('path')
var ROOT = path.resolve(__dirname, '..')
var originalRequire = Module.prototype.require
Module.prototype.require = function (id) {
  if (id === '../../utils/constants' || id.endsWith('/utils/constants')) {
    return mockConstants
  }
  if (id === '../../utils/request' || id.endsWith('/utils/request')) {
    return { getNewsList: mockGetNewsList, getNewsDetail: mockGetNewsDetail }
  }
  return originalRequire.apply(this, arguments)
}

// ===== 引入 ReadingEngine =====
var ReadingEngine = require('../pages/detail/reading-engine')

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
  var ok = actual === expected
  if (ok) {
    pass++
    console.log('  [PASS] ' + name)
  } else {
    fail++
    var msg = 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual)
    failures.push(name + ' :: ' + msg)
    console.log('  [FAIL] ' + name + ' :: ' + msg)
  }
}

// ===== 辅助：创建 Mock Cache =====
function createMockCache() {
  var store = {}
  return {
    get: function (key) { return store[key] || null },
    set: function (key, val, opts) { store[key] = val },
    remove: function (key) { delete store[key] },
    _store: store,
  }
}

// ===== 运行测试 =====
function runTests() {
  console.log('\n【运行时】ReadingEngine 初始化')
  var cache = createMockCache()

  var engine = new ReadingEngine({
    entryCategory: 'tech',
    entryIndex: 1,
    entryNewsId: 'tech-news-2',
    cache: cache,
    onProgress: function () {},
    onDetailReady: function () {},
    onError: function () {},
  })

  return engine.init().then(function (startIndex) {
    // --- 初始化验证 ---
    check('初始化后 _initialized = true', engine._initialized === true)

    var total = engine._total
    console.log('  [INFO] mergedList 总条数: ' + total)
    check('mergedList 包含多条新闻', total > 0)
    // 5+3+4+2+3 = 17（agriculture/science 已下架）
    assertEqual('mergedList 总数为 17（5+3+4+2+3）', total, 17)

    // 入口定位
    var cur = engine.getCurrent()
    check('入口定位成功（getCurrent 非空）', cur !== null)
    assertEqual('入口为 tech-news-2', cur ? cur.id : '', 'tech-news-2')

    // 进度指示
    console.log('\n【运行时】进度指示')
    var prog = engine.getProgress()
    check('positionText 非空', prog.positionText.length > 0)
    check('positionText 格式为 "N / M"', prog.positionText.indexOf(' / ') > 0)

    // 分类信息
    var startProg = engine.getProgress()
    console.log('  [INFO] 入口进度: ' + JSON.stringify(startProg))

    // --- goNext 测试 ---
    console.log('\n【运行时】goNext 翻页')
    var nextResult = engine.goNext()
    check('goNext 返回 canGo: true', nextResult.canGo === true)
    check('goNext 后 _globalIndex 递增', engine._globalIndex > 0)
    check('goNext 后 getCurrent 非空', engine.getCurrent() !== null)

    // 同分类内翻页不应跨分类（还在 tech 内）
    console.log('  [INFO] goNext isCrossing: ' + nextResult.isCrossing + ', current: ' + engine.getCurrent().category)

    // --- 翻到 tech 末条 ---
    console.log('\n【运行时】跨分类检测')
    // 当前在 tech-news-3（首次 goNext 从 tech-news-2→tech-news-3）
    // 再 goNext 应该跨到 international-news-1
    var crossResult = engine.goNext()
    check('tech 末条后 goNext 触发跨分类', crossResult.isCrossing === true)
    check('跨分类 crossingCategory 不为 null', crossResult.crossingCategory !== null)
    console.log('  [INFO] 跨分类到: ' + crossResult.crossingCategory + ', news: ' + engine.getCurrent().id)

    // --- goPrev 测试 ---
    console.log('\n【运行时】goPrev 回翻')
    var prevResult = engine.goPrev()
    check('goPrev 返回 canGo: true', prevResult.canGo === true)
    check('goPrev 后 getCurrent 非空', engine.getCurrent() !== null)
    console.log('  [INFO] goPrev 后: ' + engine.getCurrent().id + ', isCrossing: ' + prevResult.isCrossing)

    // --- 边界测试 ---
    console.log('\n【运行时】边界检测')
    // 翻到第一条
    while (!engine.isFirst()) { engine.goPrev() }
    check('翻到第一条后 isFirst() = true', engine.isFirst() === true)
    var firstResult = engine.goPrev()
    check('第一条 goPrev 返回 canGo: false', firstResult.canGo === false)
    assertEqual('第一条 reason = "first"', firstResult.reason, 'first')

    // 翻到最后一条
    while (!engine.isLast()) { engine.goNext() }
    check('翻到最后一条后 isLast() = true', engine.isLast() === true)
    var lastResult = engine.goNext()
    check('最后一条 goNext 返回 canGo: false', lastResult.canGo === false)
    assertEqual('最后一条 reason = "last"', lastResult.reason, 'last')

    // --- 去重测试 ---
    console.log('\n【运行时】去重验证')
    var ids = engine._mergedList.map(function (item) { return item.id })
    var uniqueIds = {}
    var dupFound = false
    for (var i = 0; i < ids.length; i++) {
      if (uniqueIds[ids[i]]) { dupFound = true; break }
      uniqueIds[ids[i]] = true
    }
    check('mergedList 无重复 id', !dupFound)

    // --- 返回定位 ---
    console.log('\n【运行时】返回定位')
    var returnState = engine.getReturnState()
    check('getReturnState 返回 category', typeof returnState.category === 'string' && returnState.category.length > 0)
    check('getReturnState 返回 newsId', typeof returnState.newsId === 'string' && returnState.newsId.length > 0)
    check('getReturnState 返回 categoryIndex', typeof returnState.categoryIndex === 'number')

    // --- loadCurrentDetail ---
    console.log('\n【运行时】loadCurrentDetail')
    return engine.loadCurrentDetail().then(function (detailResult) {
      check('loadCurrentDetail 返回 news 对象', detailResult.news !== null)
      check('loadCurrentDetail 返回 paragraphs 数组', Array.isArray(detailResult.paragraphs))
      check('paragraphs 数量 > 0', detailResult.paragraphs.length > 0)
      check('paragraphs 经 split 和 filter 处理', detailResult.paragraphs.every(function (p) { return p.trim().length > 0 }))

      // --- 缓存命中 ---
      console.log('\n【运行时】详情缓存（二次加载）')
      return engine.loadCurrentDetail().then(function (detailResult2) {
        check('二次 loadCurrentDetail 命中缓存', detailResult2.fromCache === true)

        // --- 分类列表缓存 ---
        console.log('\n【运行时】分类列表缓存')
        var catCache = cache.get('newsList:recommend')
        check('分类列表已写入缓存（newsList:recommend）', catCache !== null && Array.isArray(catCache))
        check('缓存内容长度 > 0', catCache && catCache.length > 0)

        // --- getCategoryName ---
        console.log('\n【运行时】工具方法')
        assertEqual('getCategoryName("tech") = "科技"', engine.getCategoryName('tech'), '科技')
        assertEqual('getCategoryName("unknown") = ""', engine.getCategoryName('unknown'), '')

        // --- getCategoryFlashColor ---
        check('getCategoryFlashColor 返回颜色值（#开头）', engine.getCategoryFlashColor('tech').indexOf('#') === 0)

        // --- 跨分类全链路 ---
        console.log('\n【运行时】跨分类全链路验证')
        // 重置到推荐首条
        while (!engine.isFirst()) { engine.goPrev() }
        check('重置到首条', engine.isFirst())

        var categoriesSeen = {}
        var currentCat = engine.getCurrent().category
        categoriesSeen[currentCat] = true
        var crossingCount = 0

        while (!engine.isLast()) {
          var r = engine.goNext()
          if (r.isCrossing) {
            crossingCount++
            var newCat = engine.getCurrent().category
            check('跨分类: ' + currentCat + ' → ' + newCat + ' (无重复分类)', !categoriesSeen[newCat])
            categoriesSeen[newCat] = true
            currentCat = newCat
          }
        }
        // 5 个 READING_CATEGORIES，所以跨分类次数应为 4
        assertEqual('跨分类切换次数 = 4（5 个分类，4 次切换）', crossingCount, 4)

        // --- 预取窗口 ---
        console.log('\n【运行时】预取窗口')
        // 翻到中间位置触发预取
        for (var j = 0; j < 5; j++) { engine.goPrev() } // 从末条回退
        var prefetchedCount = Object.keys(engine._prefetched).length
        check('预取窗口已填充（_prefetched 非空）', prefetchedCount > 0)
        console.log('  [INFO] 预取了 ' + prefetchedCount + ' 条')

        // --- 结果 ---
        console.log('\n==============================================')
        console.log('v7 运行时回归测试：通过 ' + pass + ' / 失败 ' + fail)
        console.log('==============================================')

        if (fail > 0) {
          console.log('\n失败项：')
          failures.forEach(function (f) { console.log('  - ' + f) })
          process.exit(1)
        } else {
          console.log('\n全部运行时测试通过 [OK]')
          process.exit(0)
        }
      })
    })
  }).catch(function (err) {
    console.error('\n[FATAL] 测试执行异常: ' + err.message)
    console.error(err.stack)
    process.exit(1)
  })
}

// 清理 mock
process.on('exit', function () {
  Module.prototype.require = originalRequire
})

runTests()
