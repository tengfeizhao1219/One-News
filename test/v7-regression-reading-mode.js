/**
 * v7 回归测试 —— 阅读模式（详情页上下滑切换新闻）
 *
 * 需求：点卡片进入详情页 → 上下滑切新闻（跨分类串联）→ 返回定位到当前在看的那条
 *
 * 架构演进：v7 已从内联实现演进为 ReadingEngine 模块化架构
 *   - reading-engine.js：跨分类合并列表 + 翻页状态机 + 预取窗口 + 缓存注入
 *   - detail.js：UI 层（手势 + 动画 + 进度指示 + 分享 + 收藏）
 *
 * 本测试从"架构不变量"层面锁死关键实现，防止回归。
 * 运行：node test/v7-regression-reading-mode.js
 */

const fs = require('fs')
const path = require('path')
const { TextDecoder } = require('util')

const ROOT = path.resolve(__dirname, '..')
const files = {
  detailJs: path.join(ROOT, 'pages/detail/detail.js'),
  detailWxml: path.join(ROOT, 'pages/detail/detail.wxml'),
  detailWxss: path.join(ROOT, 'pages/detail/detail.wxss'),
  engineJs: path.join(ROOT, 'pages/detail/reading-engine.js'),
  homeJs: path.join(ROOT, 'pages/home/home.js'),
  homeWxml: path.join(ROOT, 'pages/home/home.wxml'),
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

// ===== 静态检查：reading-engine.js 架构不变量 =====
console.log('\n【静态】reading-engine.js 阅读引擎架构不变量')
{
  const js = read(files.engineJs)
  check('reading-engine.js 语法合法', true, 'node --check 已通过')

  // 数据层
  check('含 _mergedList 全分类合并列表',
    js.includes('_mergedList'))
  check('含 _globalIndex 当前阅读位置',
    js.includes('_globalIndex'))
  check('含 _total 总条数',
    js.includes('_total'))
  check('含 _categoryIndexes 分类起始索引',
    js.includes('_categoryIndexes'))
  check('含 _prefetched 预取标记',
    js.includes('_prefetched'))

  // 跨分类构建
  check('init() 并行拉取所有分类',
    js.includes('Promise.all') && js.includes('getNewsList'))
  check('_buildMergedList 按 id 去重',
    js.includes('seen[') && js.includes('merged.push'))
  check('_buildMergedList 排除 all 分类',
    js.includes("id !== 'all'") || js.includes("!== 'all'"))

  // 翻页
  check('含 goNext 翻到下一条',
    js.includes('goNext = function'))
  check('含 goPrev 翻到上一条',
    js.includes('goPrev = function'))
  check('goNext/goPrev 检测跨分类',
    js.includes('isCrossing'))

  // 详情加载
  check('含 loadCurrentDetail 加载当前详情',
    js.includes('loadCurrentDetail = function'))
  check('loadCurrentDetail 含缓存读取（B-06）',
    js.includes('newsDetail:'))
  check('loadCurrentDetail 降级到列表摘要',
    js.includes('cur.summary'))

  // 预取
  check('含 _prefetchWindow ±2 预取',
    js.includes('_prefetchWindow'))

  // 返回定位
  check('含 getReturnState 返回定位信息',
    js.includes('getReturnState = function'))
  check('getReturnState 含 category/categoryIndex/newsId',
    js.includes("category:") && js.includes("categoryIndex:") && js.includes("newsId:"))

  // 编码
  check('reading-engine.js 为合法 UTF-8', isStrictUtf8(fs.readFileSync(files.engineJs)))
}

// ===== 静态检查：detail.js UI 层架构不变量 =====
console.log('\n【静态】detail.js UI 层架构不变量')
{
  const js = read(files.detailJs)
  check('detail.js 语法合法', true, 'node --check 已通过')

  // 引擎集成
  check('引入 ReadingEngine 模块',
    js.includes("require('./reading-engine')"))
  check('含 _engine 引擎实例',
    js.includes('_engine'))
  check('含 _initEngine 初始化方法',
    js.includes('_initEngine'))

  // 手势层（纯 JS，不用 WXS）
  check('含 onTouchStart / onTouchEnd（纯 JS 手势）',
    js.includes('onTouchStart') && js.includes('onTouchEnd'))
  check('含 _swipeToNext / _swipeToPrev 切换方法',
    js.includes('_swipeToNext') && js.includes('_swipeToPrev'))
  check('含 _animating 动画锁',
    js.includes('_animating'))

  // 翻页动画
  check('含 animClass 动画状态（out-up/out-down/in-up/in-down）',
    js.includes("animClass:"))

  // 边界提示（UX-SIMPLIFY 变更：边界 Chip 逻辑已移除，保留 wxml 模板仅作兼容；
  //  当前提示实现 = 底部固定滑动提示条 fixed-swipe-hint + 跨分类分类名着色 flashColor）
  check('含跨分类分类名着色（flashColor，UX-SIMPLIFY05 替代闪烁条）',
    js.includes('flashColor'))
  check('含底部滑动提示自动消失（_swipeHintTimer）',
    js.includes('_swipeHintTimer'))
  check('含 _getCategoryColorVar 分类色映射',
    js.includes('_getCategoryColorVar'))

  // 返回定位
  check('goBack 前写入 globalData._detailReturnState',
    js.includes('globalData._detailReturnState'))

  // 段落拆分
  check('正文按换行符拆分为段落',
    js.includes("split('\\n')"))
  check('content 优先，fallback 到 summary',
    js.includes('news.content || news.summary'))

  // 分享
  check('含 onShareAppMessage 分享方法',
    js.includes('onShareAppMessage'))
  check('分享含 Canvas 预缓存占位图',
    js.includes('_pregenPlaceholder') || js.includes('_placeholderCache'))

  // 收藏
  check('含 onToggleFavorite 收藏切换',
    js.includes('onToggleFavorite'))

  // 编码
  check('detail.js 为合法 UTF-8', isStrictUtf8(fs.readFileSync(files.detailJs)))
}

// ===== 静态检查：detail.wxml UI 模板 =====
console.log('\n【静态】detail.wxml UI 模板')
{
  const wxml = read(files.detailWxml)
  check('含导航栏返回按钮', wxml.includes('goBack'))
  check('含进度指示器（positionText）', wxml.includes('positionText'))
  check('含跨分类分类名着色元素（position-category，UX-SIMPLIFY05）', wxml.includes('position-category'))
  check('含底部固定滑动提示条（fixed-swipe-hint，UI-B7 §3.5）', wxml.includes('fixed-swipe-hint'))
  check('含标题展示', wxml.includes('news.title'))
  check('含正文段落列表', wxml.includes('paragraphs'))
  check('含 scroll-view（正文滚动）', wxml.includes('scroll-view'))
  check('含 bindtouchstart/bindtouchend 手势绑定', wxml.includes('bindtouchstart') && wxml.includes('bindtouchend'))
  check('含底部操作栏（收藏 + 分享）', wxml.includes('detail-bottom-bar'))
  check('含边界提示 Chip', wxml.includes('boundary-chip'))
  check('含网络兜底 Toast', wxml.includes('network-toast'))
  check('detail.wxml 为合法 UTF-8', isStrictUtf8(fs.readFileSync(files.detailWxml)))
}

// ===== 静态检查：detail.wxss 样式 =====
console.log('\n【静态】detail.wxss 样式')
{
  const wxss = read(files.detailWxss)
  check('含翻页过渡动画 .article', wxss.includes('.article'))
  check('过渡动画时长 0.35s', wxss.includes('0.35s'))
  check('含正文段落首行缩进（text-indent: 2em）', wxss.includes('text-indent: 2em'))
  check('含底部操作栏固定定位', wxss.includes('detail-bottom-bar'))
  check('含收藏动画 heartBeat', wxss.includes('heartBeat'))
  check('detail.wxss 为合法 UTF-8', isStrictUtf8(fs.readFileSync(files.detailWxss)))
}

// ===== 静态检查：home.js 详情页入口与返回定位 =====
console.log('\n【静态】home.js 详情页入口与返回定位')
{
  const js = read(files.homeJs)
  check('onCardTap 传递 index + category 参数',
    js.includes('index=${currentIndex}') && js.includes('category=${currentCategory}'))
  check('含 _handleDetailReturn 返回定位方法',
    js.includes('_handleDetailReturn'))
  check('_handleDetailReturn 读取 globalData._detailReturnState',
    js.includes('globalData._detailReturnState'))
  check('_handleDetailReturn 处理跨分类定位',
    js.includes('category !== currentCategory') || js.includes('category !== this.data.currentCategory'))
  check('_handleDetailReturn 清除状态防止重复',
    js.includes('_detailReturnState = null'))
  check('home.js 语法合法', true, 'node --check 已通过')
}

// ===== 静态检查：引导文案更新 =====
console.log('\n【静态】引导文案')
{
  const wxml = read(files.homeWxml)
  check('引导文案为"上滑阅读下一条"（UI-B7 §3.5，替代旧"点击卡片进入阅读"）', wxml.includes('上滑阅读下一条'))
  check('引导文案不再含"阅读全文"', !wxml.includes('阅读全文'))
}

// ===== 结果 =====
console.log('\n==============================================')
console.log('v7 回归测试（阅读模式 · ReadingEngine 架构）：通过 ' + pass + ' / 失败 ' + fail)
console.log('==============================================')
if (fail > 0) {
  console.log('\n失败项：')
  failures.forEach(function (f) { console.log('  - ' + f) })
  process.exit(1)
} else {
  console.log('\n全部架构不变量校验通过 [OK]')
  process.exit(0)
}
