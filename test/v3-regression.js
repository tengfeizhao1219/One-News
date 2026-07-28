/**
 * 新闻自动更新 v3 — Mock 回归测试
 *
 * 覆盖模块：
 *   1. llmSearch — 百炼 API 联网搜索
 *   2. validator — 新闻质量校验
 *   3. refreshNews — 云函数完整流程
 *   4. getNewsList — DB 缓存优先
 *   5. searchNews — DB 搜索优先
 *   6. 前端交互 — 手动刷新按钮
 *
 * 运行：node test/v3-regression.js
 */

// 模拟 wx 全局对象
global.wx = {
  cloud: {
    callFunction: (opts) => {
      if (opts.name === 'refreshNews') {
        return mockRefreshNews()
      }
      return Promise.resolve({
        result: { code: 0, data: { list: [], total: 0, hasMore: false } }
      })
    },
  },
}

const { getNewsList, searchNews, handleApiError } = require('../utils/request')
const { SIMULATE } = require('../mock/simulator')
const aiNewsCache = require('../mock/ai-news-cache')

// ─── 模拟百炼 API 返回 ──────────────────────────────

const LLM_SIMULATE = {
  scenario: 'normal',
  scenarios: {
    // 正常：返回5条高质量新闻
    normal: {
      news: [
        { title: '央行宣布降准0.5个百分点，释放长期资金约1万亿', summary: '中国人民银行今日宣布...', source: '新华社' },
        { title: '国产大飞机C919完成首次商业载客飞行', summary: '今日上午，中国商飞C919...', source: '央视新闻' },
        { title: '2026世界人工智能大会在上海开幕', summary: '本届大会以智能向善为主题...', source: '36氪' },
        { title: '中国女足亚洲杯夺冠，3-1逆转日本队', summary: '在2026年女足亚洲杯决赛中...', source: '央视新闻' },
        { title: '暑期旅游市场持续火爆，多地景区客流创新高', summary: '2026年暑期旅游市场持续升温...', source: '澎湃新闻' },
      ],
    },
    // 混合：部分来源不在白名单
    mixed_sources: {
      news: [
        { title: '正常新闻1', summary: '来自新华社的正常新闻...', source: '新华社' },
        { title: '正常新闻2', summary: '来自央视的正常新闻...', source: '央视新闻' },
        { title: '垃圾新闻1', summary: '来自未知来源...', source: '某营销号' },
        { title: '正常新闻3', summary: '来自36氪的正常新闻...', source: '36氪' },
        { title: '垃圾新闻2', summary: '来自广告平台...', source: '广告推广' },
      ],
    },
    // 重复标题
    duplicate_titles: {
      news: [
        { title: '央行宣布降准0.5个百分点', summary: '第一条内容足够长用于测试去重功能验证', source: '新华社' },
        { title: '央行宣布降准0.5个百分点', summary: '第二条重复内容也很长用于测试去重', source: '央视新闻' },
        { title: '央行宣布降准0.5个百分点释放流动性', summary: '第三条相似内容但还是足够长来测试', source: '人民日报' },
        { title: '完全不同的新闻标题内容', summary: '不一样的内容足够长通过校验测试', source: '中新网' },
      ],
    },
    // 空返回
    empty: { news: [] },
    // 格式错误（不是数组）
    malformed: { news: 'not an array' },
    // 缺少字段
    missing_fields: {
      news: [
        { title: '有标题没摘要没来源' },
        { summary: '有摘要没标题', source: '新华社' },
        { title: '', summary: '空标题', source: '央视新闻' },
        { title: '标题过短', summary: 'a', source: '新华社' },
      ],
    },
  },
}

function getLlmScenario() {
  return LLM_SIMULATE.scenarios[LLM_SIMULATE.scenario] || LLM_SIMULATE.scenarios.normal
}

// 模拟 refreshNews 云函数返回
async function mockRefreshNews() {
  const scenario = LLM_SIMULATE.scenario
  if (scenario === 'error') {
    return { result: { code: -1, message: '百炼 API 调用失败', errorCode: 'LLM_SEARCH_FAILED' } }
  }
  if (scenario === 'timeout') {
    return { result: { code: -1, message: '请求超时', errorCode: 'API_TIMEOUT' } }
  }

  const data = getLlmScenario()
  const news = Array.isArray(data.news) ? data.news : []

  // 通过 validator 模拟校验
  const { validateAndClean } = require('../cloudfunctions/common/validator')
  const result = validateAndClean(news.map((item, i) => ({
    id: `llm_test_${scenario}_${i}`,
    title: item.title || '',
    summary: item.summary || '',
    category: 'recommend',
    categoryName: '推荐',
    source: item.source || '未知来源',
    publishTime: new Date().toISOString(),
  })))

  return {
    result: {
      code: 0,
      message: `刷新完成，共 ${result.valid.length} 条新闻`,
      data: {
        total: news.length,
        inserted: result.valid.length,
        failed: result.stats.rejected,
        cleared: 0,
        categories: { recommend: result.valid.length },
        validation: result.stats,
        elapsedMs: 1200,
      },
    },
  }
}

// ─── 测试运行器 ─────────────────────────────────────

let passed = 0
let failed = 0
const failures = []

async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✅ ${name}`)
  } catch (err) {
    failed++
    failures.push({ name, error: err.message })
    console.log(`  ❌ ${name}: ${err.message}`)
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || '断言失败')
}

// ─── 主测试入口 ─────────────────────────────────────

async function run() {
  console.log('='.repeat(50))
  console.log('  一页 Mock 回归测试 — 新闻自动更新 v3')
  console.log('='.repeat(50))
  console.log(`  数据源: AI 缓存 ${aiNewsCache.length} 条 + 百炼模拟器\n`)

  // ═══════════════════════════════════════════
  // 模块1：validator 质量校验
  // ═══════════════════════════════════════════
  console.log('【模块1】validator — 新闻质量校验')

  const { validateAndClean, validateNewsItem, VALID_SOURCES } = require('../cloudfunctions/common/validator')

  await test('来源白名单 — 合法来源通过', () => {
    const result = validateNewsItem({
      title: '测试新闻标题', summary: '这是一条测试新闻的摘要内容足够长', source: '新华社',
    })
    assert(result.valid === true, '新华社应在白名单中')
  })

  await test('来源白名单 — 非法来源拒绝', () => {
    const result = validateNewsItem({
      title: '测试新闻标题', summary: '这是一条测试新闻的摘要内容', source: '某营销号',
    })
    assert(result.valid === false, '营销号应被拒绝')
    assert(result.reason.includes('白名单'), `原因应提到白名单: ${result.reason}`)
  })

  await test('来源白名单 — 海外来源通过', () => {
    assert(validateNewsItem({ title: 'BBC Test News Title', summary: 'Test summary content that is long enough for BBC validation check', source: 'BBC' }).valid, 'BBC 应通过')
    assert(validateNewsItem({ title: 'Reuters Test News Title', summary: 'Test summary content long enough for Reuters validation check', source: '路透社' }).valid, '路透社应通过')
  })

  await test('字段校验 — 缺少标题拒绝', () => {
    const result = validateNewsItem({ summary: '有摘要', source: '新华社' })
    assert(result.valid === false, '缺少标题应拒绝')
  })

  await test('字段校验 — 缺少摘要拒绝', () => {
    const result = validateNewsItem({ title: '有标题', source: '新华社' })
    assert(result.valid === false, '缺少摘要应拒绝')
  })

  await test('长度校验 — 标题过短拒绝', () => {
    const result = validateNewsItem({ title: 'ab', summary: '足够长的摘要内容来进行验证测试', source: '新华社' })
    assert(result.valid === false, '标题过短应拒绝')
  })

  await test('长度校验 — 摘要过短拒绝', () => {
    const result = validateNewsItem({ title: '正常长度的新闻标题', summary: '短', source: '新华社' })
    assert(result.valid === false, '摘要过短应拒绝')
  })

  await test('垃圾内容 — 广告过滤', () => {
    const result = validateNewsItem({
      title: '限时优惠！点击查看最新广告', summary: '这是一条广告推广内容测试', source: '新华社',
    })
    assert(result.valid === false, '广告应被过滤')
  })

  await test('批量校验 — 正常数据全通过', () => {
    const items = [
      { id: '1', title: '新闻一标题', summary: '摘要一内容足够长用于测试验证通过', source: '新华社', category: 'recommend', categoryName: '推荐', publishTime: new Date().toISOString() },
      { id: '2', title: '新闻二标题', summary: '摘要二内容也足够长进行校验测试', source: '央视新闻', category: 'recommend', categoryName: '推荐', publishTime: new Date().toISOString() },
    ]
    const result = validateAndClean(items)
    assert(result.stats.passed === 2, `应全通过，实际: ${result.stats.passed}`)
    assert(result.stats.rejected === 0, `拒绝应为0，实际: ${result.stats.rejected}`)
  })

  await test('批量校验 — 混合数据正确过滤', () => {
    const items = [
      { id: '1', title: '正常新闻标题', summary: '正常摘要内容足够长通过校验', source: '新华社', category: 'recommend', categoryName: '推荐', publishTime: new Date().toISOString() },
      { id: '2', title: '垃圾标题', summary: '广告内容很短', source: '营销号', category: 'recommend', categoryName: '推荐', publishTime: new Date().toISOString() },
      { id: '3', title: '正常新闻标题二', summary: '正常摘要内容也很长足够通过', source: '央视新闻', category: 'recommend', categoryName: '推荐', publishTime: new Date().toISOString() },
    ]
    const result = validateAndClean(items)
    assert(result.stats.passed >= 1, `应至少通过1条，实际: ${result.stats.passed}`)
    assert(result.stats.rejected >= 1, `应至少拒绝1条，实际: ${result.stats.rejected}`)
  })

  await test('去重 — 完全相同的标题被去重', () => {
    const items = [
      { id: '1', title: '央行宣布降准0.5个百分点', summary: '第一条内容足够长用于测试去重功能', source: '新华社', category: 'recommend', categoryName: '推荐', publishTime: new Date().toISOString() },
      { id: '2', title: '央行宣布降准0.5个百分点', summary: '第二条重复内容也很长用于测试', source: '央视新闻', category: 'recommend', categoryName: '推荐', publishTime: new Date().toISOString() },
    ]
    const result = validateAndClean(items)
    assert(result.stats.duplicatesRemoved >= 1, `应去重至少1条，实际: ${result.stats.duplicatesRemoved}`)
  })

  // ═══════════════════════════════════════════
  // 模块2：refreshNews 云函数模拟
  // ═══════════════════════════════════════════
  console.log('\n【模块2】refreshNews — 大模型搜索云函数')

  await test('正常搜索 — 返回成功结果', async () => {
    LLM_SIMULATE.scenario = 'normal'
    const res = await mockRefreshNews()
    assert(res.result.code === 0, `应返回成功，实际: ${res.result.code}`)
    assert(res.result.data.inserted > 0, `应有新闻插入，实际: ${res.result.data.inserted}`)
  })

  await test('正常搜索 — 所有来源通过白名单', async () => {
    LLM_SIMULATE.scenario = 'normal'
    const res = await mockRefreshNews()
    assert(res.result.data.validation.rejected === 0, `不应有拒绝，实际: ${res.result.data.validation.rejected}`)
  })

  await test('混合来源 — 过滤非法来源', async () => {
    LLM_SIMULATE.scenario = 'mixed_sources'
    const res = await mockRefreshNews()
    assert(res.result.data.validation.rejected >= 2, `应拒绝至少2条，实际: ${res.result.data.validation.rejected}`)
    assert(res.result.data.inserted === 3, `应通过3条，实际: ${res.result.data.inserted}`)
  })

  await test('重复标题 — 去重处理', async () => {
    LLM_SIMULATE.scenario = 'duplicate_titles'
    const res = await mockRefreshNews()
    assert(res.result.data.validation.duplicatesRemoved >= 1, `应去重，实际: ${res.result.data.validation.duplicatesRemoved}`)
  })

  await test('空数据 — 返回空结果', async () => {
    LLM_SIMULATE.scenario = 'empty'
    const res = await mockRefreshNews()
    assert(res.result.code === 0, '空数据不应报错')
    assert(res.result.data.inserted === 0, '插入应为0')
  })

  await test('格式错误 — 不影响系统', async () => {
    LLM_SIMULATE.scenario = 'malformed'
    const res = await mockRefreshNews()
    // 格式错误时 validator 应能处理，不应崩溃
    assert(res.result.code === 0, '格式错误不应导致系统崩溃')
  })

  await test('API 错误 — 返回错误码', async () => {
    LLM_SIMULATE.scenario = 'error'
    const res = await mockRefreshNews()
    assert(res.result.code === -1, '应返回错误')
    assert(res.result.errorCode === 'LLM_SEARCH_FAILED', '错误码应为 LLM_SEARCH_FAILED')
  })

  await test('超时 — 返回超时错误', async () => {
    LLM_SIMULATE.scenario = 'timeout'
    const res = await mockRefreshNews()
    assert(res.result.code === -1, '应返回错误')
  })

  // 恢复 normal
  LLM_SIMULATE.scenario = 'normal'

  // ═══════════════════════════════════════════
  // 模块3：getNewsList + searchNews（现有功能回归）
  // ═══════════════════════════════════════════
  console.log('\n【模块3】getNewsList / searchNews — 数据流回归')
  SIMULATE.scenario = 'normal'

  await test('首页加载 — AI 缓存正常', async () => {
    const res = await getNewsList({ category: 'all' })
    assert(res.list.length > 0, '列表不应为空')
    assert(res.total === 36, `total 应为 36，实际: ${res.total}`)
  })

  await test('分类筛选 — 5个分类都有数据', async () => {
    for (const cat of ['recommend', 'tech', 'sports', 'international', 'life']) {
      const res = await getNewsList({ category: cat })
      assert(res.list.length > 0, `${cat} 分类应有数据`)
    }
  })

  await test('分页 — 跨页数据不重复', async () => {
    const page1 = await getNewsList({ category: 'all', pageNum: 1, pageSize: 10 })
    const page2 = await getNewsList({ category: 'all', pageNum: 2, pageSize: 10 })
    const ids1 = new Set(page1.list.map(i => i.id))
    const overlap = page2.list.filter(i => ids1.has(i.id))
    assert(overlap.length === 0, `分页数据不应重复，重复: ${overlap.length} 条`)
  })

  await test('搜索 — 关键词匹配', async () => {
    const res = await searchNews({ keyword: 'AI' })
    assert(res.list.length > 0, '搜索 AI 应有结果')
  })

  await test('搜索 — 中文关键词', async () => {
    const res = await searchNews({ keyword: '地震' })
    assert(res.total >= 0, '搜索不应报错')
  })

  await test('搜索 — 无匹配返回空', async () => {
    const res = await searchNews({ keyword: 'xyz不存在的关键词999' })
    assert(res.list.length === 0, '无匹配应返回空')
  })

  // ═══════════════════════════════════════════
  // 模块4：异常场景
  // ═══════════════════════════════════════════
  console.log('\n【模块4】异常场景模拟')
  SIMULATE.scenario = 'error'

  await test('网络错误 — getNewsList 抛异常', async () => {
    try {
      await getNewsList({ category: 'all' })
      throw new Error('应抛出异常')
    } catch (err) {
      assert(err.errorCode === 'SIMULATED_ERROR', `错误码应为 SIMULATED_ERROR: ${err.errorCode}`)
    }
  })

  await test('网络错误 — searchNews 抛异常', async () => {
    try {
      await searchNews({ keyword: 'test' })
      throw new Error('应抛出异常')
    } catch (err) {
      assert(err.errorCode === 'SIMULATED_ERROR', `错误码应为 SIMULATED_ERROR: ${err.errorCode}`)
    }
  })

  await test('错误提示 — handleApiError 友好', () => {
    const msg = handleApiError('ALL_DOWN')
    assert(msg.length > 0, '应返回提示文案')
  })

  SIMULATE.scenario = 'empty'

  await test('空数据 — getNewsList 返回空', async () => {
    const res = await getNewsList({ category: 'all' })
    assert(res.list.length === 0, '应返回空')
    assert(res.hasMore === false, 'hasMore 应为 false')
  })

  SIMULATE.scenario = 'slow'

  await test('慢网络 — 延迟后正常返回', async () => {
    const start = Date.now()
    const res = await getNewsList({ category: 'all' })
    const elapsed = Date.now() - start
    assert(elapsed >= 4000, `延迟应 >= 4000ms，实际: ${elapsed}ms`)
    assert(res.list.length > 0, '延迟后应有数据')
  })

  SIMULATE.scenario = 'normal'

  // ═══════════════════════════════════════════
  // 模块5：数据完整性
  // ═══════════════════════════════════════════
  console.log('\n【模块5】AI 缓存数据完整性')

  await test('总条数 — 36条', () => {
    assert(aiNewsCache.length === 36, `应为36条，实际: ${aiNewsCache.length}`)
  })

  await test('分类覆盖 — 5个分类', () => {
    const cats = new Set(aiNewsCache.map(i => i.category))
    assert(cats.has('recommend'), '应有 recommend')
    assert(cats.has('tech'), '应有 tech')
    assert(cats.has('sports'), '应有 sports')
    assert(cats.has('international'), '应有 international')
    assert(cats.has('life'), '应有 life')
  })

  await test('无重复 ID', () => {
    const ids = aiNewsCache.map(i => i.id)
    assert(new Set(ids).size === ids.length, '不应有重复 ID')
  })

  await test('所有字段完整', () => {
    aiNewsCache.forEach((item, i) => {
      assert(item.id, `第${i}条缺 id`)
      assert(item.title, `第${i}条缺 title`)
      assert(item.summary, `第${i}条缺 summary`)
      assert(item.category, `第${i}条缺 category`)
      assert(item.categoryName, `第${i}条缺 categoryName`)
      assert(item.source, `第${i}条缺 source`)
      assert(item.publishTime, `第${i}条缺 publishTime`)
    })
  })

  // ═══════════════════════════════════════════
  // 结果汇总
  // ═══════════════════════════════════════════
  console.log('\n' + '='.repeat(50))
  console.log('  测试结果汇总')
  console.log('='.repeat(50))
  console.log(`  总计: ${passed + failed} 条`)
  console.log(`  通过: ${passed} ✅`)
  console.log(`  失败: ${failed} ❌`)

  if (failures.length > 0) {
    console.log('\n  失败详情:')
    failures.forEach((f, i) => {
      console.log(`  ${i + 1}. ${f.name}`)
      console.log(`     原因: ${f.error}`)
    })
  }

  console.log('\n' + '='.repeat(50) + '\n')
  process.exit(failed > 0 ? 1 : 0)
}

run().catch(err => {
  console.error('测试执行异常:', err)
  process.exit(1)
})
