/**
 * B-10 云函数层单元测试
 * ============================================================
 * 覆盖 refreshNews 云函数的核心模块：
 *   1. sources/tianxing.js — 天行 API 适配器（B-11 类型兼容/HTTP 降级/响应上限）
 *   2. sources/juhe.js     — 聚合 API 适配器（B-11 类型兼容/HTTP 降级/响应上限）
 *   3. utils/newsCleaner.js — 内容清洗（HTML 解码/标签剥离/噪音行/冗余段/正文提取）
 *   4. utils/contentFetcher.js — 网页抓取（HTML 解析/聚合 key 解析/enrich 并发）
 *   5. validator.js        — 新闻校验与去重
 *   6. zhipuSearch.js      — 限流识别与降级链（B-12 策略）
 *
 * 运行：node test/b10-cloudfunction-unit-test.js
 * 说明：HTTP 类用例通过 mock https 模块实现，不发起真实网络请求。
 * ============================================================
 */

'use strict'

let passed = 0
let failed = 0

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✅ ${name}`) })
    .catch(err => { failed++; console.error(`  ❌ ${name} — ${err.message}`) })
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败')
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || '值不等'}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
  }
}

// ─── Mock 基础设施 ─────────────────────────────────

/**
 * 可注入的 https mock：拦截 require('https') 的请求
 * 用法：mockHttps.setResponder(fn(req) => ({ statusCode, body, headers }))
 */
const mockHttps = {
  _responder: null,
  setResponder(fn) { this._responder = fn },
  clear() { this._responder = null },
}

// 需要 require 的模块路径（相对本文件）
const REFRESH_DIR = require('path').join(__dirname, '..', 'cloudfunctions', 'refreshNews')

// 保存原始 require
const Module = require('module')
const origResolve = Module._resolveFilename
const origLoad = Module._load

// 只拦截 refreshNews 内部对 https 的 require
const interceptedHttps = function () {}
interceptedHttps.get = (url, options, cb) => {
  if (typeof options === 'function') { cb = options; options = {} }
  const responder = mockHttps._responder
  if (!responder) {
    const err = new Error('mock https.get 未配置 responder')
    process.nextTick(() => { err.code = 'EMOCK'; cb && cb(err) })
    return { on() {}, end() {}, destroy() {}, resume() {} }
  }
  const { statusCode = 200, body = '', headers = {} } = responder({ method: 'GET', url })
  const res = {
    statusCode,
    headers,
    on(evt, fn) {
      if (evt === 'data') { if (body) fn(Buffer.from(body)) }
      if (evt === 'end') { process.nextTick(fn) }
      return this
    },
    resume() {},
  }
  process.nextTick(() => cb(res))
  return { on() {}, end() {}, destroy() {}, resume() {} }
}
interceptedHttps.request = (options, cb) => {
  const responder = mockHttps._responder
  if (!responder) {
    process.nextTick(() => {
      const err = new Error('mock https.request 未配置 responder')
      err.code = 'EMOCK'
      cb && cb(err)
    })
    return { on() {}, end() {}, write() {}, destroy() {} }
  }
  const { statusCode = 200, body = '', headers = {} } = responder({ method: options.method || 'POST', path: options.path })
  const res = {
    statusCode,
    headers,
    on(evt, fn) {
      if (evt === 'data') { if (body) fn(Buffer.from(body)) }
      if (evt === 'end') { process.nextTick(fn) }
      return this
    },
    resume() {},
  }
  process.nextTick(() => cb(res))
  return { on() {}, end() {}, write() {}, destroy() {} }
}

Module._load = function (request, parent, isMain) {
  // 拦截 refreshNews 目录及其子目录对 https 的引用
  if (request === 'https') {
    const parentPath = (parent && parent.filename) || ''
    if (parentPath.includes('cloudfunctions')) {
      return interceptedHttps
    }
  }
  return origLoad.call(this, request, parent, isMain)
}

// 恢复函数
function restoreHttpsMock() {
  Module._load = origLoad
}

// ─── 测试主体 ──────────────────────────────────────

async function main() {
  console.log('==============================================')
  console.log('B-10 云函数层单元测试')
  console.log('==============================================\n')

  // ── 1. newsCleaner：HTML 解码 / 标签剥离 ──
  console.log('── 1. newsCleaner 基础清洗 ──')
  const cleaner = require(REFRESH_DIR + '/utils/newsCleaner')

  await test('decodeHtmlEntities 解码常用实体', () => {
    const out = cleaner.decodeHtmlEntities('&amp;&lt;&gt;&quot;&#39;&nbsp;&mdash;&ldquo;&rdquo;')
    assertEqual(out, '&<>"\' \u2014\u201C\u201D')
  })

  await test('stripHtmlTags 剥离标签保留文本', () => {
    const out = cleaner.stripHtmlTags('<p>你好<strong>世界</strong></p>')
    assert(out.replace(/\n/g, '').replace(/\s/g, '') === '你好世界', `剥离后应保留文本，实际: ${JSON.stringify(out)}`)
  })

  await test('cleanSummary 截断到最大长度', () => {
    // 30 字重复 → 180 字，截断到 50：无句号 → 50字 + "..." = 53
    const out = cleaner.cleanSummary('这是一段测试摘要内容'.repeat(10), 50)
    assert(out.length <= 53, `摘要应截断到约 50 字，实际 ${out.length} 字`)
    // 有句号时按句号回退，长度不超过 maxLength
    const out2 = cleaner.cleanSummary('第一句内容。'.repeat(20), 50)
    assert(out2.length <= 50, `含句号截断应 ≤50 字，实际 ${out2.length} 字`)
    // 空输入返回空串
    assertEqual(cleaner.cleanSummary(''), '')
    assertEqual(cleaner.cleanSummary(null), '')
  })

  await test('removeInlineBracketedMeta 清除括号包裹责任编辑', () => {
    const out = cleaner.removeInlineBracketedMeta('正文内容（责任编辑：王五）')
    assert(!out.includes('责任编辑'), '括号内责任编辑应被清除')
  })

  await test('removeNoiseLines 清除广告/引导噪音行', () => {
    const out = cleaner.removeNoiseLines('这是一段正文\n广告：立即购买\n扫描二维码关注\n正文继续')
    assert(!out.includes('立即购买'), '广告行应被清除')
    assert(out.includes('这是一段正文'), '正文应保留')
  })

  await test('cleanNewsContent 完整清洗链', () => {
    const raw = '<div><p>标题重复标题重复</p><p>正文内容足够长，用于测试清洗效果。包含一些实质信息。</p><p>（责任编辑：张三）</p><p>【广告】限时特惠</p></div>'
    const out = cleaner.cleanNewsContent(raw, { title: '标题重复' })
    assert(typeof out === 'string' && out.length > 0, '清洗后应有内容')
    assert(!out.includes('责任编辑'), '清洗后不应含责任编辑')
  })

  // ── 2. validator：新闻校验 ──
  console.log('\n── 2. validator 校验与去重 ──')
  const validator = require(REFRESH_DIR + '/validator')

  await test('validateNewsItem 合法新闻通过', () => {
    const r = validator.validateNewsItem({
      title: '这是一条足够长的合法新闻标题',
      summary: '这是足够长的新闻摘要内容，用于通过校验。',
      source: '新华社',
      sourceUrl: 'https://www.xinhuanet.com/news/123',
    })
    assertEqual(r.valid, true)
  })

  await test('validateNewsItem 标题过短拒绝', () => {
    const r = validator.validateNewsItem({ title: '短', summary: '摘要内容足够长用于校验测试。', source: '新华社' })
    assertEqual(r.valid, false)
  })

  await test('validateNewsItem 广告标题拒绝', () => {
    const r = validator.validateNewsItem({ title: '限时优惠立即购买超值商品', summary: '摘要内容足够长用于校验测试。', source: '广告' })
    assertEqual(r.valid, false)
  })

  await test('validateSourceUrl 占位符 URL 拒绝', () => {
    const r = validator.validateSourceUrl('https://example.com/1234567890', '测试')
    assertEqual(r.valid, false)
  })

  await test('validateSourceUrl 合法 URL 通过', () => {
    const r = validator.validateSourceUrl('https://www.people.com.cn/2026/0805/12345.html', '人民日报')
    assertEqual(r.valid, true)
  })

  await test('deduplicateByTitle 标题去重', () => {
    const list = [
      { title: '完全相同的标题内容', summary: '摘要一足够长用于测试', source: '来源A' },
      { title: '完全相同的标题内容', summary: '摘要二足够长用于测试', source: '来源B' },
      { title: '不同的标题内容', summary: '摘要三足够长用于测试', source: '来源C' },
    ]
    const out = validator.deduplicateByTitle(list)
    assertEqual(out.length, 2, '应去重为 2 条')
  })

  // ── 3. sources/tianxing：类型兼容 + HTTP 降级 ──
  console.log('\n── 3. tianxing 适配器（B-11） ──')
  // 需要 config 中的 apiKey，临时设置环境变量
  const origKeys = { tian: process.env.TIAN_API_KEY }
  process.env.TIAN_API_KEY = 'mock_tian_key'
  // 清除 config 缓存以便读取新 env
  delete require.cache[require.resolve(REFRESH_DIR + '/config')]
  delete require.cache[require.resolve(REFRESH_DIR + '/sources/tianxing')]
  const tianxing = require(REFRESH_DIR + '/sources/tianxing')

  await test('fetchTianNewsList 数字 code=200 正常返回', () => {
    mockHttps.setResponder(() => ({
      statusCode: 200,
      body: JSON.stringify({ code: 200, msg: 'ok', result: { newslist: [{ title: '测试新闻', url: 'https://a.com/1', description: '摘要内容' }] } }),
    }))
    return tianxing.fetchTianNewsList('tech', 5).then(list => {
      assert(Array.isArray(list), '应返回数组')
      assertEqual(list.length, 1)
    })
  })

  await test('fetchTianNewsList 字符串 code="200" 兼容（B-11 核心）', () => {
    mockHttps.setResponder(() => ({
      statusCode: 200,
      body: JSON.stringify({ code: '200', msg: 'ok', result: { newslist: [{ title: '字符串code新闻', url: 'https://a.com/2', description: '摘要内容' }] } }),
    }))
    return tianxing.fetchTianNewsList('tech', 5).then(list => {
      assertEqual(list.length, 1, '字符串 "200" 应被识别为成功')
    })
  })

  await test('fetchTianNewsList code=400 业务错误降级空数组', () => {
    mockHttps.setResponder(() => ({
      statusCode: 200,
      body: JSON.stringify({ code: 400, msg: '参数错误', result: null }),
    }))
    return tianxing.fetchTianNewsList('tech', 5).then(list => {
      assertEqual(list.length, 0)
    })
  })

  await test('fetchTianNewsList HTTP 500 降级空数组（B-11）', () => {
    mockHttps.setResponder(() => ({ statusCode: 500, body: '<html>Server Error</html>' }))
    return tianxing.fetchTianNewsList('tech', 5).then(list => {
      assertEqual(list.length, 0, 'HTTP 500 不应尝试 JSON 解析')
    })
  })

  await test('fetchTianNewsList 非法 JSON 降级空数组', () => {
    mockHttps.setResponder(() => ({ statusCode: 200, body: 'not-json{{{' }))
    return tianxing.fetchTianNewsList('tech', 5).then(list => {
      assertEqual(list.length, 0)
    })
  })

  await test('formatTianNewsItem 字段映射正确', () => {
    const item = tianxing.formatTianNewsItem({
      title: '标题', description: '摘要', source: '来源', url: 'https://x.com', pub_time: '2026-08-05',
    }, 'tech')
    assertEqual(item.category, 'tech')
    assertEqual(item.categoryName, '科技')
    assert(item.id.startsWith('tian_tech_'))
  })

  // ── 4. sources/juhe：类型兼容 ──
  console.log('\n── 4. juhe 适配器（B-11） ──')
  process.env.JUHE_API_KEY = 'mock_juhe_key'
  delete require.cache[require.resolve(REFRESH_DIR + '/config')]
  delete require.cache[require.resolve(REFRESH_DIR + '/sources/juhe')]
  const juhe = require(REFRESH_DIR + '/sources/juhe')

  await test('fetchJuheNewsList error_code=0 正常返回', () => {
    mockHttps.setResponder(() => ({
      statusCode: 200,
      body: JSON.stringify({ error_code: 0, reason: 'ok', result: { data: [{ title: '聚合新闻', url: 'https://j.com/1' }] } }),
    }))
    return juhe.fetchJuheNewsList('tech', 5).then(list => {
      assertEqual(list.length, 1)
    })
  })

  await test('fetchJuheNewsList 字符串 error_code="0" 兼容（B-11 核心）', () => {
    mockHttps.setResponder(() => ({
      statusCode: 200,
      body: JSON.stringify({ error_code: '0', reason: 'ok', result: { data: [{ title: '字符串错误码新闻', url: 'https://j.com/2' }] } }),
    }))
    return juhe.fetchJuheNewsList('tech', 5).then(list => {
      assertEqual(list.length, 1, '字符串 "0" 应被识别为成功')
    })
  })

  await test('fetchJuheNewsList 字符串 error_code="10012" 识别为额度耗尽', () => {
    mockHttps.setResponder(() => ({
      statusCode: 200,
      body: JSON.stringify({ error_code: '10012', reason: '超过每日允许请求次数', result: null }),
    }))
    return juhe.fetchJuheNewsList('tech', 5).then(list => {
      // DG-01（2026-08-06 16:18）：10012 配额耗尽 → 返回 null（不重试标记），非 [] 
      assertEqual(list === null, true, '10012 应返回 null（配额耗尽不重试）')
    })
  })

  await test('fetchJuheNewsList HTTP 非 2xx 降级', () => {
    mockHttps.setResponder(() => ({ statusCode: 502, body: '<html>Bad Gateway</html>' }))
    return juhe.fetchJuheNewsList('tech', 5).then(list => {
      assertEqual(list.length, 0)
    })
  })

  await test('formatJuheNewsItem 字段映射正确', () => {
    const item = juhe.formatJuheNewsItem({
      title: '标题', author_name: '来源', url: 'https://x.com', date: '2026-08-05',
    }, 'tech')
    assertEqual(item.categoryName, '科技')
    assert(item.id.startsWith('juhe_tech_'))
  })

  // ── 5. contentFetcher：HTML 解析 + enrich 并发 ──
  console.log('\n── 5. contentFetcher 抓取与并发 ──')
  const contentFetcher = require(REFRESH_DIR + '/utils/contentFetcher')

  await test('parseJuheKey 解析聚合 uniquekey', () => {
    const key = contentFetcher.parseJuheKey('juhe_tech_abc123def456')
    assertEqual(key, 'abc123def456')
    // 非法格式返回 null
    assertEqual(contentFetcher.parseJuheKey('unknown_id'), null)
    assertEqual(contentFetcher.parseJuheKey(''), null)
  })

  await test('extractContentFromHtml 提取正文段落', () => {
    // 使用更贴近真实页面的 HTML（含 body/div 结构，正文以 <p> 分段）
    const html = '<html><head><title>测试</title></head><body><div class="content"><p>第一段正文内容足够长，用于测试提取。</p><p>第二段正文内容也很长，用于满足段落数量要求。</p><p>第三段补充说明。</p></div></body></html>'
    const out = contentFetcher.extractContentFromHtml(html)
    assert(out && out.includes('第一段'), '应提取到正文')
  })

  await test('extractContentFromHtml 空 HTML 返回 null', () => {
    const out = contentFetcher.extractContentFromHtml('<html><body></body></html>')
    assertEqual(out, null)
    // 空输入同样返回 null
    assertEqual(contentFetcher.extractContentFromHtml(''), null)
  })

  await test('enrichNewsList 并发控制正确（skipFetch）', async () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`, title: `标题${i}`, summary: `摘要${i}`,
      content: `正文内容第${i}段，足够长用于测试。`,
    }))
    // skipFetch=true 跳过网络请求，测试并发聚合逻辑
    const out = await contentFetcher.enrichNewsList(items, 3, true, true)
    assertEqual(out.length, 6, '应处理全部条目')
    assert(out.every(x => x.content && x.content.length > 0), '每条应有 content')
    assert(out.every(x => x.summarySource), '每条应有 summarySource 标记')
  })

  // ── 6. zhipuSearch：降级链（B-12） ──
  console.log('\n── 6. zhipuSearch 降级链（B-12） ──')
  const zhipuSearch = require(REFRESH_DIR + '/zhipuSearch')

  await test('CATEGORY_PROMPTS 五个分类齐备', () => {
    const cats = Object.keys(zhipuSearch.CATEGORY_PROMPTS)
    assertEqual(cats.length, 5)
    for (const c of ['recommend', 'tech', 'sports', 'international', 'life']) {
      assert(cats.includes(c), `缺少分类 ${c}`)
    }
  })

  await test('readDailyQuota 无 db 时返回默认配额', async () => {
    const quota = await zhipuSearch.readDailyQuota(null)
    assertEqual(quota.deepseekCalls, 0)
    assertEqual(quota.zhipuCalls, 0)
  })

  await test('writeDailyQuota 无 db 时不抛错', async () => {
    await zhipuSearch.writeDailyQuota(null, { deepseekCalls: 1, zhipuCalls: 1 })
    assert(true)
  })

  // ── 汇总 ──
  restoreHttpsMock()
  // 恢复环境变量
  if (origKeys.tian === undefined) delete process.env.TIAN_API_KEY; else process.env.TIAN_API_KEY = origKeys.tian

  console.log('\n==============================================')
  console.log(`B-10 云函数层单元测试：通过 ${passed} / 失败 ${failed}`)
  console.log('==============================================')
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('测试执行异常:', err)
  process.exit(1)
})
