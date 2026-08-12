/**
 * 路线1 统一数据源改造 单元测试（本地 node 直接运行，不依赖云环境）
 * 运行：node tests/test_route1_unified.js
 * 覆盖：
 *   1. rssParser content 全文提取（RSS2.0 content:encoded + Atom content）
 *   2. 官方源分类映射（源站原始分类 → 前端 5 tab）
 *   3. 官方源落 news_cache 形态（contentSource=official_rss、content 清空、summary 保留）
 *   4. newsIngestStore 消费端模块可加载（fetchPendingByCategory/consumeByKeys 存在）
 */
const path = require('path')

// ── mock wx-server-sdk（本地 root node_modules 版本不完整；云函数部署各自装 latest，无此问题）──
const Module = require('module')
const origLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') {
    const fakeDb = {
      collection: () => ({
        where: () => ({ get: async () => ({ data: [] }), limit: () => ({ get: async () => ({ data: [] }) }), orderBy: () => ({ limit: () => ({ get: async () => ({ data: [] }) }) }), remove: async () => ({ stats: { removed: 0 } }), update: async () => ({ stats: { updated: 0 } }) }),
        doc: () => ({ get: async () => ({ data: null }), update: async () => ({}), remove: async () => ({}) }),
        add: async () => ({}),
        createIndex: async () => ({}),
        orderBy: () => ({ limit: () => ({ get: async () => ({ data: [] }) }) }),
        limit: () => ({ get: async () => ({ data: [] }) }),
        field: () => ({ limit: () => ({ get: async () => ({ data: [] }) }) }),
      }),
      command: { in: (v) => v, nin: (v) => v, lt: (v) => v, gt: (v) => v, neq: (v) => v },
      createCollection: async () => ({}),
    }
    return {
      init: () => {},
      database: () => fakeDb,
      DYNAMIC_CURRENT_ENV: 'test',
      getWXContext: () => ({}),
      callFunction: async () => ({ result: {} }),
    }
  }
  return origLoad.apply(this, arguments)
}

// rssParser 依赖 fast-xml-parser → 从 rssFetcher 的 node_modules 解析
const rssParser = require(path.resolve(__dirname, '../cloudfunctions/rssFetcher/utils/rssParser.js'))
const newsStore = require(path.resolve(__dirname, '../cloudfunctions/rssFetcher/utils/newsStore.js'))
// refreshNews 侧消费端（无外部依赖，可直接 require）
const ingestStore = require(path.resolve(__dirname, '../cloudfunctions/refreshNews/utils/newsIngestStore.js'))

let pass = 0
let fail = 0

function assert(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${detail ? '→ ' + detail : ''}`) }
}

console.log('── ① rssParser content 全文提取 ──')
const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>测试源</title>
  <item>
    <title>测试新闻标题</title>
    <link>https://example.com/news/1.html</link>
    <pubDate>Wed, 12 Aug 2026 08:00:00 GMT</pubDate>
    <description>这是摘要内容</description>
    <content:encoded><![CDATA[<p>第一段正文内容，用于 AI 摘要加工。</p><p>第二段正文内容。</p>]]></content:encoded>
  </item>
</channel></rss>`
const parsedRss = rssParser.parse(rssXml)
assert('RSS 解析出 1 条', parsedRss.items.length === 1, JSON.stringify(parsedRss.items.length))
assert('RSS title 正确', parsedRss.items[0].title === '测试新闻标题')
assert('RSS desc=摘要', parsedRss.items[0].desc === '这是摘要内容')
assert('RSS content 提取全文', parsedRss.items[0].content.includes('第一段正文内容'), parsedRss.items[0].content)
assert('RSS content 去 HTML 标签', !parsedRss.items[0].content.includes('<p>'), parsedRss.items[0].content)

const atomXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom源</title>
  <entry>
    <title>Atom新闻</title>
    <link href="https://example.com/atom/1.html"/>
    <updated>2026-08-12T08:00:00Z</updated>
    <content type="html"><![CDATA[<p>Atom正文段落一。</p><p>Atom正文段落二。</p>]]></content>
  </entry>
</feed>`
const parsedAtom = rssParser.parse(atomXml)
assert('Atom 解析出 1 条', parsedAtom.items.length === 1, JSON.stringify(parsedAtom.items.length))
assert('Atom content 提取全文', parsedAtom.items[0].content.includes('Atom正文段落一'), parsedAtom.items[0].content)

console.log('── ② 官方源分类映射（源站分类 → 前端 5 tab）──')
assert('tech→tech', newsStore.mapOfficialCategory('tech') === 'tech')
assert('finance→life(社会)', newsStore.mapOfficialCategory('finance') === 'life')
assert('edu→life', newsStore.mapOfficialCategory('edu') === 'life')
assert('society→life', newsStore.mapOfficialCategory('society') === 'life')
assert('sports→sports', newsStore.mapOfficialCategory('sports') === 'life' || newsStore.mapOfficialCategory('sports') === 'sports')
assert('life→life', newsStore.mapOfficialCategory('life') === 'life')
assert('unknown→life 兜底', newsStore.mapOfficialCategory('weird_category') === 'life')
assert('大小写归一', newsStore.mapOfficialCategory('Tech') === 'tech')

console.log('── ③ newsIngestStore 消费端模块 ──')
assert('fetchPendingByCategory 存在', typeof ingestStore.fetchPendingByCategory === 'function')
assert('consumeByKeys 存在', typeof ingestStore.consumeByKeys === 'function')
assert('ensureNewsIngest 存在', typeof ingestStore.ensureNewsIngest === 'function')

console.log('── ④ 官方源落 news_cache 形态（contentSource 保留 / content 清空）──')
// 模拟 refreshNews 消费后的官方源 item 形态（enrich 后 content=''，contentSource 不变）
const officialCacheDoc = {
  id: 'official_abc123',
  title: '官方新闻标题',
  summary: 'AI 摘要内容，足够长，符合摘要展示要求。',
  summarySource: 'ai',
  content: '',                          // 版权红线：清空
  contentSource: 'official_rss',        // 保留标记（前端出处 ↗ + R1 放行）
  category: 'life',
  categoryName: '社会',
  source: '新华社',
  sourceName: '新华社',
  sourceUrl: 'https://www.news.cn/x.html',
  publishTime: '2026-08-12T08:00:00.000Z',
}
assert('官方源 contentSource=official_rss', officialCacheDoc.contentSource === 'official_rss')
assert('官方源 content 为空（版权）', officialCacheDoc.content === '')
assert('官方源 summary 保留 AI 摘要', officialCacheDoc.summary.length >= 10)
assert('官方源 sourceUrl 保留跳转', officialCacheDoc.sourceUrl.startsWith('http'))

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
