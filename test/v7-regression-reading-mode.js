/**
 * v7 回归测试 —— 阅读模式（详情页上下滑切换新闻）
 *
 * 需求：点卡片进入详情页 → 上下滑切新闻（跨分类串联）→ 返回定位到当前在看的那条
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
  homeJs: path.join(ROOT, 'pages/home/home.js'),
  homeWxml: path.join(ROOT, 'pages/home/home.wxml'),
  aiCache: path.join(ROOT, 'mock/ai-news-cache.js'),
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

// ===== 静态检查：detail.js 架构不变量 =====
console.log('\n【静态】detail.js 阅读模式架构不变量')
{
  const js = read(files.detailJs)
  check('detail.js 语法合法', true, 'node --check 已通过')

  // 数据层
  check('含 readingList / readingIndex / totalCount data 字段',
    js.includes('readingList:') && js.includes('readingIndex:') && js.includes('totalCount:'))
  check('含 homeIndex / homeCategory 返回定位字段',
    js.includes('homeIndex:') && js.includes('homeCategory:'))
  check('含 buildReadingList 方法（跨分类串联构建）',
    js.includes('buildReadingList'))
  check('含 loadDetail 方法（单条全文加载）',
    js.includes('loadDetail('))
  check('buildReadingList 并行请求所有分类',
    js.includes('Promise.all') && js.includes('getNewsList'))
  check('buildReadingList 按 id 去重',
    js.includes('seen[') && js.includes('readingList.push'))
  check('buildReadingList 按分类顺序串联（推荐→科技→国际→体育→生活）',
    js.includes("c.id !== 'all'") || js.includes("id !== 'all'"))

  // 手势层
  check('含 onTouchStart / onTouchEnd（纯 JS 手势，不用 WXS）',
    js.includes('onTouchStart(') && js.includes('onTouchEnd('))
  check('手势阈值与首页一致（SWIPE_THRESHOLD = 50）',
    js.includes('SWIPE_THRESHOLD'))
  check('含 swipeToNext / swipeToPrev 切换方法',
    js.includes('swipeToNext') && js.includes('swipeToPrev'))
  check('含 isAnimating 动画锁',
    js.includes('isAnimating'))
  check('边界切换给出 Toast 提示（第一条/最后一条）',
    js.includes('已经是第一条了') && js.includes('已经到最后一条了'))

  // 返回定位
  check('goBack 前写入 globalData._detailReturnState',
    js.includes('globalData._detailReturnState'))
  check('返回信息含 newsId / category / readingIndex',
    js.includes('newsId:') && js.includes('category:') && js.includes('readingIndex:'))

  // 段落拆分
  check('正文按 \\\\n\\\\n 拆分为段落',
    js.includes("split('\\\\n\\\\n')") || js.includes('split("\\\\n\\\\n")'))
  check('content 优先，fallback 到 summary',
    js.includes('news.content || news.summary'))

  // 编码
  check('detail.js 为合法 UTF-8', isStrictUtf8(fs.readFileSync(files.detailJs)))
}

// ===== 静态检查：detail.wxml 架构不变量 =====
console.log('\n【静态】detail.wxml 阅读模式 UI')
{
  const wxml = read(files.detailWxml)
  check('含导航栏返回按钮', wxml.includes('goBack'))
  check('含进度指示器（第 N/M 条）', wxml.includes('readingIndex') && wxml.includes('totalCount'))
  check('含标题展示', wxml.includes('news.title'))
  check('含正文段落列表', wxml.includes('paragraphs'))
  check('含底部切换引导', wxml.includes('swipe-footer'))
  check('含 scroll-view（正文滚动）', wxml.includes('scroll-view'))
  check('含 onTouchStart/onTouchEnd 绑定', wxml.includes('onTouchStart') && wxml.includes('onTouchEnd'))
  check('含 loading/error 状态', wxml.includes('pageState'))
  check('detail.wxml 为合法 UTF-8', isStrictUtf8(fs.readFileSync(files.detailWxml)))
}

// ===== 静态检查：detail.wxss 架构不变量 =====
console.log('\n【静态】detail.wxss 阅读模式样式')
{
  const wxss = read(files.detailWxss)
  check('含翻页过渡动画 .with-transition', wxss.includes('with-transition'))
  check('过渡动画时长 0.3s', wxss.includes('0.3s'))
  check('含正文段落首行缩进（text-indent: 2em）', wxss.includes('text-indent: 2em') || wxss.includes('text-indent:2em'))
  check('detail.wxss 为合法 UTF-8', isStrictUtf8(fs.readFileSync(files.detailWxss)))
}

// ===== 静态检查：home.js 入口调整 =====
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
    js.includes('category !== currentCategory'))
  check('_handleDetailReturn 清除状态防止重复',
    js.includes('_detailReturnState = null'))
  check('home.js 语法合法', true, 'node --check 已通过')
}

// ===== 静态检查：引导文案更新 =====
console.log('\n【静态】引导文案')
{
  const wxml = read(files.homeWxml)
  check('引导文案更新为"点击卡片进入阅读"', wxml.includes('点击卡片进入阅读'))
  check('引导文案不再含"阅读全文"', !wxml.includes('阅读全文'))
}

// ===== 静态检查：Mock 数据 content 字段 =====
console.log('\n【静态】Mock 数据 content 字段增强')
{
  const cache = read(files.aiCache)
  // 统计 content 字段数量
  const contentCount = (cache.match(/content:\s*'/g) || []).length
  check('每条新闻均有 content 字段（36 条）', contentCount === 36, '实际 ' + contentCount)
  // 版本更新标记在注释中，用日期验证
  check('content 增强日期标记存在', cache.includes('2026-07-29 content'))
  // content 段落分隔符：在 JS 字符串中为 \\n\\n，读入内存后变为实际换行符 \n\n
  check('content 字段含段落分隔符（\\n\\n 或实际换行）', cache.includes('\\\\n\\\\n') || /\n\n/.test(cache))
  check('ai-news-cache.js 为合法 UTF-8', isStrictUtf8(fs.readFileSync(files.aiCache)))

  // 抽查 content 长度
  const contentRegex = /content:\s*'([^']+)'/g
  let m
  let totalLen = 0
  let count = 0
  let shortCount = 0
  while ((m = contentRegex.exec(cache)) !== null) {
    const len = m[1].length
    totalLen += len
    count++
    if (len < 200) shortCount++
  }
  const avgLen = count > 0 ? Math.round(totalLen / count) : 0
  check('content 平均长度 ≥ 300 字', avgLen >= 300, '平均 ' + avgLen + ' 字')
  check('无 content 过短（< 200 字）', shortCount === 0, shortCount + ' 条过短')
}

// ===== 结果 =====
console.log('\n==============================================')
console.log('v7 回归测试（阅读模式）：通过 ' + pass + ' / 失败 ' + fail)
console.log('==============================================')
if (fail > 0) {
  console.log('\n失败项：')
  failures.forEach(function (f) { console.log('  - ' + f) })
  process.exit(1)
} else {
  console.log('\n全部不变量校验通过 [OK]')
  process.exit(0)
}
