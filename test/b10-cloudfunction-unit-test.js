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

  // ── 5.5. FS-04：DeepSeek 摘要引擎补全（8/9 凌晨根因） ──
  console.log('\n── 5.5 summarizeWithZhipu DeepSeek 引擎降级（FS-04） ──')

  // 配置环境变量 + 清理 require 缓存，确保 summarizeWithZhipu 读到新 env
  const savedKeys = { ZHIPU: process.env.ZHIPU_API_KEY, DASH: process.env.DASHSCOPE_API_KEY, DS: process.env.DEEPSEEK_API_KEY }
  process.env.ZHIPU_API_KEY = 'mock_zhipu_key'
  process.env.DASHSCOPE_API_KEY = 'mock_dash_key'
  process.env.DEEPSEEK_API_KEY = 'mock_deepseek_key'
  delete require.cache[require.resolve(REFRESH_DIR + '/config')]
  delete require.cache[require.resolve(REFRESH_DIR + '/utils/contentFetcher')]
  const cf = require(REFRESH_DIR + '/utils/contentFetcher')

  await test('FS-04·DeepSeek 兜底：智谱+Qwen 失败时 DeepSeek 顶上', async () => {
    // 记录请求路径，验证降级链
    const calls = []
    mockHttps.setResponder((req) => {
      calls.push(req.path || '')
      // 智谱域：返回 400 让它 3 次尝试都失败
      if (req.path && req.path.includes('/api/paas/v4')) {
        return { statusCode: 400, body: JSON.stringify({ error: { message: '智谱超时' } }) }
      }
      // Qwen 域：返回 403 配额耗尽
      if (req.path && req.path.includes('/compatible-mode')) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Free quota exhausted' }) }
      }
      // DeepSeek 域：成功返回摘要（content 长度 >30 字通过摘要校验）
      if (req.path && req.path.includes('/v1/chat/completions')) {
        return { statusCode: 200, body: JSON.stringify({ choices: [{ message: { content: '这是 DeepSeek 生成的中文新闻摘要内容足够长用于通过校验测试' } }] }) }
      }
      return { statusCode: 500, body: '{}' }
    })
    const summary = await cf.summarizeWithZhipu('正文内容足够长用于测试摘要生成，重复填充。重复填充。重复填充。', '测试标题')
    assert(summary && summary.length > 0, '应拿到 DeepSeek 生成的摘要')
    assert(summary.includes('DeepSeek'), '摘要应来自 DeepSeek 响应')
    // 验证请求路径降级顺序：智谱先调（3 次）→ Qwen 调（≤3 次）→ DeepSeek 调（1 次成功）
    const dsCalls = calls.filter(p => p.includes('/v1/chat/completions')).length
    assert(dsCalls >= 1, 'DeepSeek 至少被调用 1 次')
    const zhipuCalls = calls.filter(p => p.includes('/api/paas/v4')).length
    assert(zhipuCalls >= 1, '智谱应先被尝试')
  })

  await test('FS-04·引擎顺序：智谱成功时不调 DeepSeek', async () => {
    let deepseekCalled = false
    let zhipuCalls = 0
    mockHttps.setResponder((req) => {
      // 智谱直接成功（content 长度 >30 字通过摘要校验）
      if (req.path && req.path.includes('/api/paas/v4')) {
        zhipuCalls++
        return { statusCode: 200, body: JSON.stringify({ choices: [{ message: { content: '智谱生成的中文新闻摘要内容足够长用于通过摘要长度校验测试通过' } }] }) }
      }
      // 兜底监控：DeepSeek 不应被调用
      if (req.path && req.path.includes('/v1/chat/completions')) {
        deepseekCalled = true
        return { statusCode: 500, body: '{}' }
      }
      return { statusCode: 500, body: '{}' }
    })
    const summary = await cf.summarizeWithZhipu('正文内容足够长用于测试摘要生成，重复填充。重复填充。', '测试标题')
    assert(summary && summary.length > 0, '应拿到智谱摘要')
    assert(summary.includes('智谱'), '摘要应来自智谱')
    assertEqual(deepseekCalled, false, '智谱成功后不应再调 DeepSeek')
  })

  await test('FS-04·无 key 配置时直接返回 null 不发请求', async () => {
    // 临时清掉所有 key
    process.env.ZHIPU_API_KEY = ''
    process.env.DASHSCOPE_API_KEY = ''
    process.env.DEEPSEEK_API_KEY = ''
    delete require.cache[require.resolve(REFRESH_DIR + '/config')]
    delete require.cache[require.resolve(REFRESH_DIR + '/utils/contentFetcher')]
    const cfEmpty = require(REFRESH_DIR + '/utils/contentFetcher')
    let called = false
    mockHttps.setResponder(() => { called = true; return { statusCode: 200, body: '{}' } })
    const summary = await cfEmpty.summarizeWithZhipu('正文内容足够长用于测试摘要生成，重复填充。', '测试标题')
    assertEqual(summary, null, '无 key 时应返回 null')
    assertEqual(called, false, '无 key 时不应发任何网络请求')
    // 恢复 key
    process.env.ZHIPU_API_KEY = savedKeys.ZHIPU || 'mock_zhipu_key'
    process.env.DASHSCOPE_API_KEY = savedKeys.DASH || 'mock_dash_key'
    process.env.DEEPSEEK_API_KEY = savedKeys.DS || 'mock_deepseek_key'
  })

  // ── 5.5b FS-06：混元引擎（云开发内置，无密钥）降级兼容 ──
  // 本地/沙箱无 wx-server-sdk → dynamic require 失败 → 混元优雅跳过，
  // 不影响原 智谱/Qwen/DeepSeek 链（仍能正常返回外部引擎摘要）。
  console.log('\n── 5.5b 混元引擎兼容（FS-06） ──')
  await test('FS-06·沙箱无 wx-server-sdk 时混元跳过并降级外部链', async () => {
    // 配置全 key，模拟生产（混元启用但沙箱无 sdk）
    process.env.ZHIPU_API_KEY = 'mock_zhipu_key'
    process.env.DASHSCOPE_API_KEY = 'mock_dash_key'
    process.env.DEEPSEEK_API_KEY = 'mock_deepseek_key'
    delete require.cache[require.resolve(REFRESH_DIR + '/config')]
    delete require.cache[require.resolve(REFRESH_DIR + '/utils/contentFetcher')]
    const cfHy = require(REFRESH_DIR + '/utils/contentFetcher')
    const calls = []
    mockHttps.setResponder((req) => {
      calls.push(req.path || '')
      // 智谱失败走降级，DeepSeek 成功兜底
      if (req.path && req.path.includes('/api/paas/v4')) {
        return { statusCode: 400, body: JSON.stringify({ error: { message: 'x' } }) }
      }
      if (req.path && req.path.includes('/compatible-mode')) {
        return { statusCode: 403, body: JSON.stringify({ error: 'quota' }) }
      }
      if (req.path && req.path.includes('/v1/chat/completions')) {
        return { statusCode: 200, body: JSON.stringify({ choices: [{ message: { content: '这是DeepSeek降级生成的中文新闻摘要内容足够长用于通过校验测试' } }] }) }
      }
      return { statusCode: 500, body: '{}' }
    })
    const summary = await cfHy.summarizeWithZhipu('正文内容足够长用于测试摘要生成，重复填充。重复填充。', '测试标题')
    assert(summary && summary.includes('DeepSeek'), '沙箱无混元 sdk 时仍应降级拿到 DeepSeek 摘要')
    const dsCalls = calls.filter(p => p.includes('/v1/chat/completions')).length
    assert(dsCalls >= 1, 'DeepSeek 兜底被调用')
  })

  // ── 5.6. FS-05：聚合接口"假 desc"识别 + 兜底扩展（8/9 owner 拍板） ──
  // Bug 场景：聚合接口返回 rawSummary="2026-08-09 14:23" / "澎湃新闻" / "。" 等无效内容
  // 原判定 rawSummary === item.title 才判 title 兜底，对"假 desc"无效 → 前端展示日期。
  // 修复：增加 isInvalIdesc 内容质量判定 + 兜底条件扩为 summarySource !== 'ai'。
  console.log('\n── 5.6 假 desc 识别 + 兜底扩展（FS-05） ──')

  // enrichNewsList 需要 mock fetchContentForItem 走内容（content 需 > 10 字）
  // 但 enrichNewsList 内部直接调 fetchContentForItem(item)，不通过 https。
  // 测试策略：构造一个 content 已经存在于 item 的 fake item（skipFetch=true 路径），
  // 这样能直接验 rawSummary 处理 + 兜底逻辑，不需要 mock 抓取。

  await test('FS-05·纯日期 desc 被识别为无效 → 走首段兜底', async () => {
    const item = {
      id: 'test-fs05-1',
      title: '测试新闻标题足够长这样才不会被误判成短标题',
      source: '澎湃新闻',
      summary: '2026-08-09 14:23',  // 假 desc
      content: '这是正文第一段，足够长的中文内容用于通过首段校验测试。继续填充确保长度大于20字。\n这是第二段，测试用。',
    }
    const out = await cf.enrichNewsList([item], 1, /* skipFetch */ true, /* skipAiSummary */ true)
    assert(out.length === 1, '应有 1 条结果')
    assertEqual(out[0].summarySource, 'content', '假 desc → 应降级为 content 档')
    assert(out[0].summary.includes('这是正文第一段'), '摘要应为正文第一段')
    assert(!out[0].summary.includes('2026-08-09'), '不应展示日期')
  })

  await test('FS-05·来源名作 desc → 走首段兜底', async () => {
    const item = {
      id: 'test-fs05-2',
      title: '某条国际新闻标题足够长以避免被误判成短标题',
      source: 'BBC News',
      summary: 'BBC News',  // 假 desc = 来源名
      content: 'BBC 报道了一则国际新闻，正文内容足够长用于通过首段校验测试。\n第二段。',
    }
    const out = await cf.enrichNewsList([item], 1, true, true)
    assertEqual(out[0].summarySource, 'content', '来源名作 desc → 应降级为 content 档')
    assert(out[0].summary.includes('BBC 报道了'), '摘要应为正文首段而非"来源名"')
  })

  await test('FS-05·短 desc（< 20 字）→ 走首段兜底', async () => {
    const item = {
      id: 'test-fs05-3',
      title: '某科技新闻标题足够长以避免被误判成短标题',
      source: '36氪',
      summary: '本文介绍了',  // 14 字，< 20
      content: '本文详细介绍了某项新技术的核心原理和应用场景，正文内容足够长。\n第二段。',
    }
    const out = await cf.enrichNewsList([item], 1, true, true)
    assertEqual(out[0].summarySource, 'content', '短 desc → 应降级为 content 档')
    assert(out[0].summary.includes('本文详细介绍了'), '摘要应为正文首段')
  })

  await test('FS-05·有效 desc（>= 20 字且非假 desc）→ 保留 desc 档', async () => {
    const item = {
      id: 'test-fs05-4',
      title: '某生活新闻标题足够长以避免被误判成短标题',
      source: '新京报',
      summary: '本报道详细分析了某城市最近的交通改善措施及其对市民出行的影响。',
      content: '不应被使用的正文内容。\n第二段。',
    }
    // skipAiSummary=true: 智谱 prompt 已内联 summary → 视为 'ai' 档（v6.6 语义）
    const out = await cf.enrichNewsList([item], 1, true, true)
    assertEqual(out[0].summarySource, 'ai', 'skipAiSummary=true 时有效 desc → 标 ai 档')
    assert(out[0].summary.includes('交通改善'), '应展示原 desc')
  })

  await test('FS-09·首段是日期但第二段合格 → 取第二段为 content 档', async () => {
    const item = {
      id: 'test-fs09-1',
      title: '某条体育新闻标题足够长以避免被误判成短标题',
      source: '虎扑',
      summary: '',  // 空
      content: '2026-08-09 14:23 比赛开始。\n第二段足够长的正文内容用于测试，这段文字超过二十个字能够通过首段校验判定。',  // 首段是日期，第二段是正文
    }
    const out = await cf.enrichNewsList([item], 1, true, true)
    // 首段"2026-08-09 比赛开始" → 含日期 → isValidParagraph=false
    // 但第二段合格 → 应取第二段为 content 档，而非退 title
    assertEqual(out[0].summarySource, 'content', '首段为日期但第二段合格 → 应取第二段为 content 档')
    assert(out[0].summary.includes('第二段足够长的正文内容'), '摘要应为第二段正文而非标题')
  })

  await test('FS-09·所有段落都不合格 → 才退到 title 档', async () => {
    const item = {
      id: 'test-fs09-2',
      title: '某条新闻标题足够长以避免被误判成短标题',
      source: '虎扑',
      summary: '',
      content: '2026-08-09 14:23\n2026-08-10 09:00',  // 全是日期，无合格段落
    }
    const out = await cf.enrichNewsList([item], 1, true, true)
    assertEqual(out[0].summarySource, 'title', '所有段落都不合格 → 退到 title 档')
    assertEqual(out[0].summary, item.title, '应展示标题')
  })

  await test('FS-05 v2·isInvalidDesc 顶层导出 + 老假 desc 判定', () => {
    const cfExported = require(REFRESH_DIR + '/utils/contentFetcher')
    assert(typeof cfExported.isInvalidDesc === 'function', 'isInvalidDesc 应被导出')
    const ctx = { title: '某条足够长的标题文字用于测试判定', source: '澎湃新闻' }
    // 老假 desc:日期 / 来源名 / 短串 / 仅标点 → 全被判无效
    assert(cfExported.isInvalidDesc('2026-08-09 14:23', ctx) === true, '纯日期应判为假 desc')
    assert(cfExported.isInvalidDesc('澎湃新闻', ctx) === true, '来源名应判为假 desc')
    assert(cfExported.isInvalidDesc('短', ctx) === true, '短串应判为假 desc')
    assert(cfExported.isInvalidDesc(',,,,。。', ctx) === true, '仅标点应判为假 desc')
    // 有效 desc(>20 字且含实质中文)→ 判为有效
    assert(cfExported.isInvalidDesc('这是一段足够长的有效摘要文字，超过二十个字能够用于展示新闻的核心内容要点。', ctx) === false, '有效长摘要应判为合格')
  })

  // ── 5.6b FE-20260810-003：AI 摘要完整保留（移除 150 字硬截断） ──
  console.log('\n── 5.6b AI 摘要完整保留（FE-20260810-003，不再 150 字硬截断） ──')
  await test('FE-20260810·AI 摘要超长 → 完整保留不截断', async () => {
    // mock 混元/智谱返回超长摘要（300 字）
    const longSummary = Array(30).fill('这是一段很长很长的中文新闻摘要内容用于测试屏幕展示容量上限截断功能是否生效。').join('')
    mockHttps.setResponder((req) => {
      return { statusCode: 200, body: JSON.stringify({ choices: [{ message: { content: longSummary } }] }) }
    })
    const content = '这是新闻正文第一段，内容足够长超过十个字的门槛能够进入 AI 摘要生成流程。' + Array(20).fill('这是补充正文内容确保输入足够长以便触发摘要。').join('')
    const out = await cf.enrichNewsList([{ id: 'test-fe-1', title: '测试标题足够长避免误判为短标题', content: content }], 1, true, false)
    assert(out.length === 1, '应有 1 条结果')
    assert(out[0].summarySource === 'ai', '摘要应标为 ai 档')
    assert(out[0].summary === longSummary, `AI 摘要应完整保留（不再 slice 硬截断），实际长度 ${out[0].summary.length} 字`)
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
