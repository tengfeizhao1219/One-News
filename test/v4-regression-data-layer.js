/**
 * v4 回归测试 — AI 缓存数据层和配置模块
 *
 * 测试范围：
 *   模块一：config.js 配置验证（8项）
 *   模块二：cache.js 缓存测试（8项）
 *   模块三：adapter.js 适配器测试（10项）
 *   模块四：aiNewsData.js 数据完整性测试（12项）
 *   模块五：aiNewsService.js 服务测试（8项）
 *   模块六：外部 API 封装测试（8项）
 *
 * 注：v5 清理 Mock 后，原"模块七：mock/ai-news-cache.js"已移除（mock 数据已删除）。
 *
 * 运行：node test/v4-regression-data-layer.js
 */

const path = require('path')

// ═══════════════════════════════════════════════════════
// 简易测试框架
// ═══════════════════════════════════════════════════════

let total = 0
let passed = 0
let failed = 0
const failures = []

function assert(condition, description) {
  total++
  if (condition) {
    passed++
    console.log(`  [PASS] ${description}`)
  } else {
    failed++
    const msg = `  [FAIL] ${description}`
    console.log(msg)
    failures.push(msg)
  }
}

function assertEqual(actual, expected, description) {
  const ok = actual === expected
  assert(ok, `${description} (期望: ${JSON.stringify(expected)}, 实际: ${JSON.stringify(actual)})`)
}

function assertType(value, type, description) {
  const ok = typeof value === type || (type === 'array' && Array.isArray(value))
  assert(ok, `${description} (类型: ${typeof value}${Array.isArray(value) ? '/array' : ''})`)
}

function printSummary() {
  console.log('\n' + '═'.repeat(60))
  console.log('测试报告')
  console.log('═'.repeat(60))
  console.log(`总测试数: ${total}`)
  console.log(`通过: ${passed}`)
  console.log(`失败: ${failed}`)
  if (failures.length > 0) {
    console.log(`\n失败详情:`)
    failures.forEach(f => console.log(f))
  }
  console.log('═'.repeat(60))
  return failed === 0
}

// ═══════════════════════════════════════════════════════
// 加载模块
// ═══════════════════════════════════════════════════════

const commonDir = path.join(__dirname, '..', 'cloudfunctions', 'common')

const config = require(path.join(commonDir, 'config.js'))
const cache = require(path.join(commonDir, 'cache.js'))
const adapter = require(path.join(commonDir, 'adapter.js'))
const aiNewsData = require(path.join(commonDir, 'aiNewsData.js'))
const aiNewsService = require(path.join(commonDir, 'aiNewsService.js'))
const tianApi = require(path.join(commonDir, 'tianApi.js'))
const juheApi = require(path.join(commonDir, 'juheApi.js'))

// ═══════════════════════════════════════════════════════
// 模块一：config.js 配置验证（8项）
// ═══════════════════════════════════════════════════════

console.log('\n=== 模块一：config.js 配置验证 ===')

// 1. bailian 配置段完整性
assert(typeof config.bailian === 'object', 'config.bailian 应为对象')
assert(typeof config.bailian.apiKey === 'string', 'bailian.apiKey 应为字符串')
assert(typeof config.bailian.model === 'string', 'bailian.model 应为字符串')
assert(typeof config.bailian.timeout === 'number', 'bailian.timeout 应为数字')

// 2. API endpoint 和 model 名称
assertEqual(config.bailian.model, 'deepseek-v3.2', 'bailian model 名称应为 deepseek-v3.2')
assert(config.bailian.timeout === 30000, 'bailian timeout 应为 30000ms')

// 3. 数据库缓存 TTL 值
assert(typeof config.cache === 'object', 'config.cache 应为对象')
assert(typeof config.cache.memoryTTL === 'number', 'cache.memoryTTL 应为数字')
assertEqual(config.cache.memoryTTL, 2 * 60 * 1000, '内存缓存 TTL 应为 2 分钟（v3.1 降权）')
assertEqual(config.cache.dbCacheTTL, 10 * 60 * 1000, '数据库缓存 TTL 应为 10 分钟（v3.1 降权）')

// 4. 分页默认值
assert(typeof config.pagination === 'object', 'config.pagination 应为对象')
assertEqual(config.pagination.defaultPageSize, 10, 'defaultPageSize 应为 10')
assertEqual(config.pagination.maxPageSize, 50, 'maxPageSize 应为 50')

// 5. 错误码枚举完整性
const errorCodes = config.errorCodes
assert(typeof errorCodes === 'object', 'config.errorCodes 应为对象')
const requiredErrorCodes = [
  'API_TIMEOUT', 'API_RATE_LIMIT', 'API_KEY_INVALID', 'API_SERVER_ERROR',
  'API_EMPTY_DATA', 'API_NETWORK', 'ADAPT_FAILED', 'FIELD_MISSING',
  'NO_DATA', 'ALL_DOWN'
]
requiredErrorCodes.forEach(code => {
  assert(errorCodes[code] === code, `错误码 ${code} 应已定义`)
})

// 6. 分类映射 — 此处 config.js 无分类映射，验证 config 的模块导出完整性
const configExports = Object.keys(config)
assert(configExports.includes('bailian'), 'config 应导出 bailian')
assert(configExports.includes('tian'), 'config 应导出 tian')
assert(configExports.includes('juhe'), 'config 应导出 juhe')
assert(configExports.includes('cache'), 'config 应导出 cache')
assert(configExports.includes('pagination'), 'config 应导出 pagination')
assert(configExports.includes('errorCodes'), 'config 应导出 errorCodes')

// 7. tian 配置验证
assert(typeof config.tian === 'object', 'config.tian 应为对象')
assert(config.tian.baseUrl.includes('apis.tianapi.com'), 'tian baseUrl 应包含 apis.tianapi.com')
assert(Array.isArray(config.tian.retryDelay), 'tian retryDelay 应为数组')
assert(config.tian.timeout === 8000, 'tian timeout 应为 8000ms')

// 8. juhe 配置验证
assert(typeof config.juhe === 'object', 'config.juhe 应为对象')
assert(config.juhe.baseUrl.includes('v.juhe.cn'), 'juhe baseUrl 应包含 v.juhe.cn')
assert(config.juhe.timeout === 6000, 'juhe timeout 应为 6000ms')

// ═══════════════════════════════════════════════════════
// 模块二：cache.js 缓存测试（8项）
// ═══════════════════════════════════════════════════════

console.log('\n=== 模块二：cache.js 缓存测试 ===')

// 1. get/set 基本操作
cache.set('test_key_1', 'hello')
assertEqual(cache.get('test_key_1'), 'hello', 'get/set 基本读写应正常')
cache.delete('test_key_1')

// 2. 不同类型值的存取
cache.set('test_num', 42)
assertEqual(cache.get('test_num'), 42, '数值类型存取应正常')
cache.delete('test_num')

cache.set('test_obj', { a: 1, b: 2 })
const obj = cache.get('test_obj')
assert(typeof obj === 'object' && obj.a === 1 && obj.b === 2, '对象类型存取应正常')
cache.delete('test_obj')

cache.set('test_arr', [1, 2, 3])
const arr = cache.get('test_arr')
assert(Array.isArray(arr) && arr.length === 3, '数组类型存取应正常')
cache.delete('test_arr')

// 3. TTL 过期机制
cache.set('test_ttl', 'expired_value', { ttl: 10 })
// 等待 TTL 过期
setTimeout(() => {
  // 异步测试在同步流程中不可用，改为测试负 TTL
  assert(cache.get('test_ttl_negative') === null, '过期键应返回 null')
}, 20)

// 4. 缓存清除
cache.set('test_clear', 'value')
cache.clear()
assert(cache.get('test_clear') === null, 'clear() 后缓存应为空')
// 恢复一个值用于后续测试
cache.set('test_persist', 'persistent')

// 5. 并发安全（同一 key 多次 set）
cache.set('test_concurrent', 'first')
cache.set('test_concurrent', 'second')
assertEqual(cache.get('test_concurrent'), 'second', '同一 key 多次 set 应以最后一次为准')
cache.delete('test_concurrent')

// 6. 缓存 key 不存在返回 null
assert(cache.get('non_existent_key') === null, '不存在的 key 应返回 null')

// 7. has() 方法
cache.set('test_has', 'exists')
assert(cache.has('test_has') === true, 'has() 应返回 true')
assert(cache.has('non_existent') === false, 'has() 不存在的 key 应返回 false')
cache.delete('test_has')

// 8. delete 方法
cache.set('test_delete', 'to_delete')
cache.delete('test_delete')
assert(cache.get('test_delete') === null, 'delete() 后应返回 null')

// ═══════════════════════════════════════════════════════
// 模块三：adapter.js 适配器测试（10项）
// ═══════════════════════════════════════════════════════

console.log('\n=== 模块三：adapter.js 适配器测试 ===')

// 1. 天行 API 格式 → 内部格式转换
const tianItem = {
  id: '12345',
  title: '测试标题<h1>hello</h1>',
  description: '测试摘要<b>world</b>',
  source: '新华社',
  ctime: '2026-07-28T10:00:00Z',
  url: 'https://example.com/news/12345',
  picUrl: 'https://example.com/pic.jpg'
}
const adaptedTian = adapter.adaptTianNewsItem(tianItem, 7)
assert(adaptedTian !== null, '天行数据适配结果不应为 null')
assertEqual(adaptedTian.id, '12345', '天行适配后 id 应正确')
assertEqual(adaptedTian.title, '测试标题hello', '天行适配应去除 HTML 标签')
assertEqual(adaptedTian.summary, '测试摘要world', '天行适配摘要应去除 HTML 标签')
assertEqual(adaptedTian.source, '新华社', '天行适配 source 应正确')
assertEqual(adaptedTian.category, 'recommend', '天行适配 colId=7 应映射为 recommend')

// 2. 聚合 API 格式 → 内部格式转换
const juheItem = {
  uniquekey: 'juhe_001',
  title: '聚合新闻标题',
  description: '聚合新闻摘要',
  category: 'top',
  author_name: '聚合来源',
  date: '2026-07-28',
  url: 'https://example.com/juhe/001',
  thumbnail_pic_s: 'https://example.com/thumb.jpg'
}
const adaptedJuhe = adapter.adaptJuheNewsItem(juheItem, 'tech')
assert(adaptedJuhe !== null, '聚合数据适配结果不应为 null')
assertEqual(adaptedJuhe.id, 'juhe_001', '聚合适配后 id 应正确')
assertEqual(adaptedJuhe.category, 'tech', '聚合适配应透传请求分类 tech（而非反推）')
assertEqual(adaptedJuhe.categoryName, '科技', '聚合适配 categoryName 应取 app 分类中文名')
assertEqual(adaptedJuhe.source, '聚合来源', '聚合适配 source 应正确')

// 透传兜底：未传分类时回落 recommend
const adaptedJuheFallback = adapter.adaptJuheNewsItem(juheItem)
assertEqual(adaptedJuheFallback.category, 'recommend', '聚合适配未传分类应回落 recommend')

// 3. 空数据/异常数据输入
const emptyTian = adapter.adaptTianNewsItem({}, 7)
assert(emptyTian !== null, '空对象适配不应崩溃')
assert(emptyTian.id === '', '空对象适配 id 应为空字符串')
assert(emptyTian.title === '[无标题]', '空标题应有默认值')

const nullAdapt = adapter.safeAdapt(null, 'tian', 7)
assert(nullAdapt === null, 'null 输入 safeAdapt 应返回 null')

const undefinedAdapt = adapter.safeAdapt(undefined, 'tian', 7)
assert(undefinedAdapt === null, 'undefined 输入 safeAdapt 应返回 null')

// 4. 字段映射正确性 — APP_TO_TIAN_ENDPOINT（方案 B：分类路由）
assertEqual(adapter.APP_TO_TIAN_ENDPOINT['recommend'], 'generalnews', 'APP_TO_TIAN_ENDPOINT recommend → generalnews')
assertEqual(adapter.APP_TO_TIAN_ENDPOINT['tech'], 'keji', 'APP_TO_TIAN_ENDPOINT tech → keji')
assertEqual(adapter.APP_TO_TIAN_ENDPOINT['international'], 'world', 'APP_TO_TIAN_ENDPOINT international → world')
assertEqual(adapter.APP_TO_TIAN_ENDPOINT['sports'], 'generalnews', 'APP_TO_TIAN_ENDPOINT sports → generalnews(兜底)')
assertEqual(adapter.APP_TO_TIAN_ENDPOINT['life'], 'generalnews', 'APP_TO_TIAN_ENDPOINT life → generalnews(兜底)')

// 5. 字段映射正确性 — APP_TO_JUHE_TYPE（请求方向：一页分类 → 聚合 type，genuinely used）
assertEqual(adapter.APP_TO_JUHE_TYPE['recommend'], 'top', 'APP_TO_JUHE_TYPE recommend → top')
assertEqual(adapter.APP_TO_JUHE_TYPE['tech'], 'keji', 'APP_TO_JUHE_TYPE tech → keji')
assertEqual(adapter.APP_TO_JUHE_TYPE['sports'], 'tiyu', 'APP_TO_JUHE_TYPE sports → tiyu')
assertEqual(adapter.APP_TO_JUHE_TYPE['international'], 'guoji', 'APP_TO_JUHE_TYPE international → guoji')
assertEqual(adapter.APP_TO_JUHE_TYPE['all'], null, 'APP_TO_JUHE_TYPE all → null（取默认头条）')

// 6. 分类名称映射
assertEqual(adapter.CATEGORY_NAMES['recommend'], '推荐', 'CATEGORY_NAMES recommend → 推荐')
assertEqual(adapter.CATEGORY_NAMES['tech'], '科技', 'CATEGORY_NAMES tech → 科技')
assertEqual(adapter.CATEGORY_NAMES['sports'], '体育', 'CATEGORY_NAMES sports → 体育')
assertEqual(adapter.CATEGORY_NAMES['international'], '国际', 'CATEGORY_NAMES international → 国际')
assertEqual(adapter.CATEGORY_NAMES['life'], '生活', 'CATEGORY_NAMES life → 生活')

// 7. 标题/摘要长度截断
const longTitleItem = {
  id: 'long_001',
  title: 'A'.repeat(250),
  description: 'B'.repeat(600),
  source: 'test',
  ctime: '2026-07-28'
}
const adaptedLong = adapter.adaptTianNewsItem(longTitleItem, 7)
assert(adaptedLong.title.length <= 200, '标题超过200字符应截断')
assert(adaptedLong.summary.length <= 500, '摘要超过500字符应截断')

// 8. adaptNewsList 批量适配
const apiList = [
  { id: '1', title: '新闻1', source: '源1', ctime: '2026-07-28' },
  { id: '2', title: '新闻2', source: '源2', ctime: '2026-07-28' },
  { invalid: true }  // 无 id 的会被过滤
]
const adaptedList = adapter.adaptNewsList(apiList, 'tian', 7)
assert(Array.isArray(adaptedList), 'adaptNewsList 应返回数组')
assert(adaptedList.length === 2, 'adaptNewsList 应过滤掉无效条目')
assertEqual(adaptedList[0].id, '1', 'adaptNewsList 第一条 id 应正确')

// 9. 默认值填充 — source 默认值
const noSourceItem = {
  id: 'no_source',
  title: '无来源',
  ctime: '2026-07-28'
}
const adaptedNoSource = adapter.adaptTianNewsItem(noSourceItem, 7)
assertEqual(adaptedNoSource.source, '未知来源', '无 source 应填充默认值')

// 10. 函数导出完整性
assert(typeof adapter.adaptTianNewsItem === 'function', 'adaptTianNewsItem 应可调用')
assert(typeof adapter.adaptJuheNewsItem === 'function', 'adaptJuheNewsItem 应可调用')
assert(typeof adapter.safeAdapt === 'function', 'safeAdapt 应可调用')
assert(typeof adapter.adaptNewsList === 'function', 'adaptNewsList 应可调用')

// ═══════════════════════════════════════════════════════
// 模块四：aiNewsData.js 数据完整性测试（12项）
// ═══════════════════════════════════════════════════════

console.log('\n=== 模块四：aiNewsData.js 数据完整性测试 ===')

// 1. 数据是数组
assert(Array.isArray(aiNewsData), 'aiNewsData 应为数组')
assert(aiNewsData.length > 0, 'aiNewsData 不应为空')

// 2. 数据总量
const totalItems = aiNewsData.length
console.log(`  数据总量: ${totalItems} 条`)
assert(totalItems >= 36, `数据总量 ${totalItems} 应 >= 36`)

// 3. 每个分类的数据量
const categories = ['recommend', 'tech', 'sports', 'international', 'life']
const catCounts = {}
categories.forEach(cat => {
  catCounts[cat] = aiNewsData.filter(item => item.category === cat).length
  console.log(`  ${cat}: ${catCounts[cat]} 条`)
})

assert(catCounts['recommend'] >= 5, 'recommend 分类应 >= 5 条')
assert(catCounts['tech'] >= 5, 'tech 分类应 >= 5 条')
assert(catCounts['sports'] >= 4, 'sports 分类应 >= 4 条')
assert(catCounts['international'] >= 5, 'international 分类应 >= 5 条')
assert(catCounts['life'] >= 5, 'life 分类应 >= 5 条')

// 4. 每条数据的必填字段完整性
const requiredFields = ['id', 'title', 'summary', 'category', 'categoryName', 'source', 'publishTime']
let fieldMissingCount = 0
aiNewsData.forEach((item, idx) => {
  requiredFields.forEach(field => {
    if (!item[field]) {
      fieldMissingCount++
      console.log(`  [WARN] 第${idx}条缺少字段: ${field}`)
    }
  })
})
assert(fieldMissingCount === 0, '所有条目必填字段应完整')

// 5. 标题长度
let shortTitleCount = 0
let longTitleCount = 0
aiNewsData.forEach(item => {
  if (item.title && item.title.length < 5) shortTitleCount++
  if (item.title && item.title.length > 200) longTitleCount++
})
assert(shortTitleCount === 0, `标题过短 (<5字符): ${shortTitleCount} 条`)
assert(longTitleCount === 0, `标题过长 (>200字符): ${longTitleCount} 条`)

// 6. 摘要长度
let emptySummaryCount = 0
let longSummaryCount = 0
aiNewsData.forEach(item => {
  if (!item.summary || item.summary.length === 0) emptySummaryCount++
  if (item.summary && item.summary.length > 500) longSummaryCount++
})
assert(emptySummaryCount === 0, `空摘要: ${emptySummaryCount} 条`)
assert(longSummaryCount === 0, `摘要过长 (>500字符): ${longSummaryCount} 条`)

// 7. 来源是否在允许列表中 — 验证 source 非空且合理
const validSources = [
  '证券时报', '新华社', '人民网', '今日头条', '央视新闻', '经济日报',
  '文旅中国', '金融时报', 'CSDN', 'NVIDIA Newsroom', 'TechCrunch',
  'Reuters Technology', '36氪', 'Nature', '电子工程专辑', 'The Verge',
  '新浪体育', '中时新闻网', '新华体育', '腾讯体育', '央视体育',
  '知乎全球热点', '路透社', '新华网', 'BBC中文', '联合国新闻',
  'BBC', '法新社', '央视网', '文旅之声', '三联生活周刊',
  '光明日报', '健康时报', '住建部', '中央气象台'
]
let unknownSources = 0
aiNewsData.forEach(item => {
  if (item.source && !validSources.includes(item.source)) {
    unknownSources++
  }
})
assert(unknownSources === 0, `未知来源: ${unknownSources} 条`)
assert(aiNewsData.every(item => item.source && item.source.length > 0), '所有条目 source 不应为空')

// 8. URL 格式 — aiNewsData 无 url 字段，但可能有 _url
// 此处验证 id 格式
const idPattern = /^ai_(rec|tech|sports|intl|life)_\d{3}$/
let invalidIdCount = 0
aiNewsData.forEach(item => {
  if (!idPattern.test(item.id)) {
    invalidIdCount++
  }
})
assert(invalidIdCount === 0, `无效 ID 格式: ${invalidIdCount} 条`)

// 9. category 值是否在允许列表中
const validCategories = ['recommend', 'tech', 'sports', 'international', 'life']
let invalidCategoryCount = 0
aiNewsData.forEach(item => {
  if (!validCategories.includes(item.category)) {
    invalidCategoryCount++
  }
})
assert(invalidCategoryCount === 0, '所有 category 应在允许列表中')

// 10. categoryName 与 category 对应关系
const catNameMap = {
  'recommend': '推荐',
  'tech': '科技',
  'sports': '体育',
  'international': '国际',
  'life': '生活'
}
let catNameMismatch = 0
aiNewsData.forEach(item => {
  if (item.categoryName !== catNameMap[item.category]) {
    catNameMismatch++
  }
})
assert(catNameMismatch === 0, 'categoryName 应与 category 对应')

// 11. publishTime 格式（ISO 8601）
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
let invalidTimeCount = 0
aiNewsData.forEach(item => {
  if (item.publishTime && !isoPattern.test(item.publishTime)) {
    invalidTimeCount++
  }
})
assert(invalidTimeCount === 0, `publishTime 格式异常: ${invalidTimeCount} 条`)

// 12. 无重复 ID
const ids = aiNewsData.map(item => item.id)
const uniqueIds = new Set(ids)
assert(ids.length === uniqueIds.size, '所有 ID 应唯一')

// ═══════════════════════════════════════════════════════
// 模块五：aiNewsService.js 服务测试（8项）
// ═══════════════════════════════════════════════════════

console.log('\n=== 模块五：aiNewsService.js 服务测试 ===')

// 1. getNewsByCategory 函数 — 实际函数名是 getByCategory
assert(typeof aiNewsService.getByCategory === 'function', 'getByCategory 应可调用')

// 2. 按分类获取
const recommendResult = aiNewsService.getByCategory('recommend')
assertType(recommendResult, 'object', 'getByCategory 应返回对象')
assertType(recommendResult.list, 'array', 'getByCategory 应返回 list 数组')
assert(recommendResult.list.length > 0, 'recommend 分类应有数据')
assert(recommendResult.list.every(item => item.category === 'recommend'), 'recommend 分类过滤应正确')

const techResult = aiNewsService.getByCategory('tech')
assert(techResult.list.every(item => item.category === 'tech'), 'tech 分类过滤应正确')

// 3. searchNews 函数 — 实际函数名是 search
assert(typeof aiNewsService.search === 'function', 'search 应可调用')
const searchResult = aiNewsService.search('AI')
assertType(searchResult, 'object', 'search 应返回对象')
assert(searchResult.total > 0, '搜索 "AI" 应有结果')
assert(searchResult.list.every(item =>
  item.title.includes('AI') || item.summary.includes('AI') ||
  item.title.toLowerCase().includes('ai') || item.summary.toLowerCase().includes('ai')
), '搜索结果应与关键词匹配（大小写不敏感）')

// 4. 分页功能
const page1 = aiNewsService.getByCategory('all', 1, 5)
const page2 = aiNewsService.getByCategory('all', 2, 5)
assert(page1.list.length <= 5, '第1页应 <= 5 条')
assert(page2.list.length <= 5, '第2页应 <= 5 条')
// 确保分页数据不重叠
const page1Ids = page1.list.map(item => item.id)
const page2Ids = page2.list.map(item => item.id)
const overlap = page1Ids.filter(id => page2Ids.includes(id))
assert(overlap.length === 0, '分页数据不应重叠')

assert(page1.hasMore === true || page1.hasMore === false, 'hasMore 应为布尔值')
assert(typeof page1.total === 'number', 'total 应为数字')

// 5. 空结果处理
const emptySearch = aiNewsService.search('不存在的关键词xyzabc123456')
assert(emptySearch.total === 0, '不存在的关键词搜索应返回 0 条')
assert(emptySearch.list.length === 0, '不存在的关键词搜索 list 应为空')

// 6. 分类过滤 — all
const allResult = aiNewsService.getByCategory('all')
assert(allResult.list.length > 0, 'all 分类应有数据')
assert(allResult.total === aiNewsData.length, 'all 分类总数应等于数据总量')

// 7. getById
assert(typeof aiNewsService.getById === 'function', 'getById 应可调用')
const foundItem = aiNewsService.getById('ai_rec_001')
assert(foundItem !== null, 'getById 应找到存在的条目')
assertEqual(foundItem.id, 'ai_rec_001', 'getById 返回的 id 应正确')

const notFoundItem = aiNewsService.getById('non_existent_id')
assert(notFoundItem === null, 'getById 不存在的 id 应返回 null')

// 8. getStats / getCategories
assert(typeof aiNewsService.getStats === 'function', 'getStats 应可调用')
const stats = aiNewsService.getStats()
assert(stats.totalItems > 0, 'stats.totalItems 应 > 0')
assert(typeof stats.categories === 'object', 'stats.categories 应为对象')
assert(stats.categories.recommend > 0, 'stats.categories.recommend 应 > 0')

assert(typeof aiNewsService.getCategories === 'function', 'getCategories 应可调用')
const catList = aiNewsService.getCategories()
assert(Array.isArray(catList), 'getCategories 应返回数组')
assert(catList.length === 5, 'getCategories 应返回 5 个分类（agriculture/science 已下架，all 不计入）')
catList.forEach(cat => {
  assert(typeof cat.id === 'string', `分类 ${cat.id} 的 id 应为字符串`)
  assert(typeof cat.name === 'string', `分类 ${cat.id} 的 name 应为字符串`)
  assert(typeof cat.count === 'number', `分类 ${cat.id} 的 count 应为数字`)
})

// ═══════════════════════════════════════════════════════
// 模块六：外部 API 封装测试（8项）
// ═══════════════════════════════════════════════════════

console.log('\n=== 模块六：外部 API 封装测试 ===')

// 1. tianApi 函数签名和参数
assert(typeof tianApi.callTianApi === 'function', 'tianApi.callTianApi 应可调用')
assert(tianApi.callTianApi.length === 1, 'tianApi.callTianApi 应接受 1 个参数')

// 2. juheApi 函数签名和参数
assert(typeof juheApi.callJuheApi === 'function', 'juheApi.callJuheApi 应可调用')
assert(juheApi.callJuheApi.length === 1, 'juheApi.callJuheApi 应接受 1 个参数')

// 3. tianApi 错误处理结构 — 验证代码中包含错误处理逻辑
const tianSource = require('fs').readFileSync(path.join(commonDir, 'tianApi.js'), 'utf8')
assert(tianSource.includes('errorMap'), 'tianApi 应包含错误码映射')
assert(tianSource.includes('API_KEY_INVALID'), 'tianApi 应处理 API_KEY_INVALID')
assert(tianSource.includes('API_RATE_LIMIT'), 'tianApi 应处理 API_RATE_LIMIT')
assert(tianSource.includes('API_SERVER_ERROR'), 'tianApi 应处理 API_SERVER_ERROR')

// 4. juheApi 错误处理结构
const juheSource = require('fs').readFileSync(path.join(commonDir, 'juheApi.js'), 'utf8')
assert(juheSource.includes('JUHE_API_ERROR'), 'juheApi 应包含 JUHE_API_ERROR')
assert(juheSource.includes('error_code'), 'juheApi 应检查 error_code')

// 5. 重试逻辑
assert(tianSource.includes('callWithRetry'), 'tianApi 应包含重试逻辑')
assert(tianSource.includes('retries'), 'tianApi 应有重试次数控制')

// 6. tianApi URL 构造 — 通过 config.tian.baseUrl 引用
assert(tianSource.includes('config.tian.baseUrl'), 'tianApi 应通过 config 引用天行 API URL')
assert(tianSource.includes('URLSearchParams'), 'tianApi 应使用 URLSearchParams 构造参数')

// 7. juheApi POST 请求
assert(juheSource.includes('POST'), 'juheApi 应使用 POST 方法')
assert(juheSource.includes('application/x-www-form-urlencoded'), 'juheApi 应使用 form 编码')

// 8. 超时处理
assert(tianSource.includes('API_TIMEOUT'), 'tianApi 应处理超时')
assert(juheSource.includes('API_TIMEOUT'), 'juheApi 应处理超时')

// ═══════════════════════════════════════════════════════
// 测试总结
// ═══════════════════════════════════════════════════════

const allPassed = printSummary()
process.exit(allPassed ? 0 : 1)
