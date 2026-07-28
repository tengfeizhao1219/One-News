/**
 * Mock 回归测试执行器
 * 在 Node.js 环境模拟微信小程序的核心逻辑，验证所有功能路径
 *
 * 运行：node test/mock-regression.js
 *
 * 数据源：mock/ai-news-cache.js（WorkBuddy 于 2026-07-28 搜索生成）
 * 共 36 条真实新闻，覆盖 5 个分类
 */

// 强制使用 Mock 模式进行测试
process.env.TEST_MODE = 'true'

// 模拟 wx 全局对象
global.wx = {
  cloud: {
    callFunction: () => Promise.resolve({
      result: { code: 0, data: { list: [], total: 0, hasMore: false } }
    })
  }
}

const { getNewsList, searchNews, handleApiError } = require('../utils/request')
const { SIMULATE } = require('../mock/simulator')
const aiNewsCache = require('../mock/ai-news-cache')

// 获取 AI 缓存统计
const aiStats = {}
aiNewsCache.forEach(item => {
  aiStats[item.category] = (aiStats[item.category] || 0) + 1
})

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

async function run() {
  console.log('========================================')
  console.log('  一页 Mock 回归测试 — AI 新闻缓存版')
  console.log('========================================')
  console.log(`  数据源: mock/ai-news-cache.js`)
  console.log(`  总条数: ${aiNewsCache.length}`)
  console.log(`  分类分布: ${JSON.stringify(aiStats)}\n`)

  // ── 场景1：正常加载 ──
  console.log('【场景1】normal — 正常加载 AI 缓存数据')
  SIMULATE.scenario = 'normal'

  await test('首页加载 — 返回列表非空', async () => {
    const res = await getNewsList({ category: 'all' })
    assert(res.list.length > 0, `列表不应为空，实际: ${res.list.length}`)
    assert(res.total > 0, `total 应大于 0，实际: ${res.total}`)
    assert(typeof res.hasMore === 'boolean', 'hasMore 应为 boolean')
  })

  await test('首页加载 — 列表项包含必要字段', async () => {
    const res = await getNewsList({ category: 'all' })
    const item = res.list[0]
    assert(item.id, '缺少 id')
    assert(item.title, '缺少 title')
    assert(item.summary, '缺少 summary')
    assert(item.category, '缺少 category')
    assert(item.categoryName, '缺少 categoryName')
    assert(item.source, '缺少 source')
    assert(item.time, '缺少 time')
  })

  await test('分类筛选 — tech 分类', async () => {
    const res = await getNewsList({ category: 'tech' })
    assert(res.list.length > 0, `tech 分类应有数据，实际: ${res.list.length}`)
    res.list.forEach(item => {
      assert(item.category === 'tech', `分类应为 tech，实际: ${item.category}`)
    })
  })

  await test('分类筛选 — sports 分类', async () => {
    const res = await getNewsList({ category: 'sports' })
    assert(res.list.length > 0, `sports 分类应有数据，实际: ${res.list.length}`)
  })

  await test('分页 — 第1页 hasMore 正确', async () => {
    const res = await getNewsList({ category: 'all', pageNum: 1, pageSize: 5 })
    assert(res.list.length <= 5, `每页不应超过 pageSize，实际: ${res.list.length}`)
    if (res.total > 5) {
      assert(res.hasMore === true, '应有更多数据')
    }
  })

  await test('分页 — 大页码返回空', async () => {
    const res = await getNewsList({ category: 'all', pageNum: 100, pageSize: 10 })
    assert(res.list.length === 0, '大页码应返回空列表')
  })

  // ── 场景2：搜索 ──
  console.log('\n【场景2】normal — 搜索功能（AI 缓存）')

  await test('搜索 — AI 关键词匹配', async () => {
    const res = await searchNews({ keyword: 'AI' })
    assert(res.list.length > 0, `搜索"AI"应有结果，实际: ${res.list.length}`)
    assert(res.total > 0, 'total 应大于 0')
  })

  await test('搜索 — 中文关键词匹配', async () => {
    const res = await searchNews({ keyword: '地震' })
    // 检查是否有地震相关新闻
    if (res.list.length > 0) {
      const hasMatch = res.list.some(item =>
        item.title.includes('地震') || item.summary.includes('地震')
      )
      assert(hasMatch, '搜索结果应包含地震相关内容')
    }
  })

  await test('搜索 — 空关键词', async () => {
    const res = await searchNews({ keyword: '' })
    assert(Array.isArray(res.list), '应返回数组')
  })

  await test('搜索 — 无匹配关键词', async () => {
    const res = await searchNews({ keyword: 'xyz不存在的关键词123' })
    assert(res.list.length === 0, '无匹配应返回空')
    assert(res.total === 0, 'total 应为 0')
  })

  // ── 场景3：错误模拟 ──
  console.log('\n【场景3】error — 模拟网络错误')
  SIMULATE.scenario = 'error'

  await test('错误模拟 — getNewsList 抛出异常', async () => {
    try {
      await getNewsList({ category: 'all' })
      throw new Error('应该抛出异常但没有')
    } catch (err) {
      assert(err.errorCode === 'SIMULATED_ERROR', `错误码应为 SIMULATED_ERROR，实际: ${err.errorCode}`)
    }
  })

  await test('错误模拟 — searchNews 抛出异常', async () => {
    try {
      await searchNews({ keyword: 'test' })
      throw new Error('应该抛出异常但没有')
    } catch (err) {
      assert(err.errorCode === 'SIMULATED_ERROR', `错误码应为 SIMULATED_ERROR，实际: ${err.errorCode}`)
    }
  })

  await test('错误处理 — handleApiError 返回友好提示', () => {
    const msg = handleApiError('SIMULATED_ERROR', '模拟错误信息')
    assert(msg.includes('模拟错误'), `提示应包含错误信息，实际: ${msg}`)
  })

  // ── 场景4：空数据模拟 ──
  console.log('\n【场景4】empty — 模拟空数据')
  SIMULATE.scenario = 'empty'

  await test('空数据 — getNewsList 返回空列表', async () => {
    const res = await getNewsList({ category: 'all' })
    assert(res.list.length === 0, '应返回空列表')
    assert(res.total === 0, 'total 应为 0')
    assert(res.hasMore === false, 'hasMore 应为 false')
  })

  await test('空数据 — searchNews 返回空列表', async () => {
    const res = await searchNews({ keyword: 'test' })
    assert(res.list.length === 0, '应返回空列表')
    assert(res.total === 0, 'total 应为 0')
  })

  // ── 场景5：慢网络模拟 ──
  console.log('\n【场景5】slow — 模拟慢网络')
  SIMULATE.scenario = 'slow'

  await test('慢网络 — 请求延迟后正常返回', async () => {
    const start = Date.now()
    const res = await getNewsList({ category: 'all' })
    const elapsed = Date.now() - start
    assert(elapsed >= 4000, `延迟应 >= 4000ms，实际: ${elapsed}ms`)
    assert(res.list.length > 0, '延迟后应正常返回数据')
  })

  // 恢复 normal
  SIMULATE.scenario = 'normal'

  // ── 场景6：AI 缓存数据完整性验证 ──
  console.log('\n【场景6】AI 缓存数据质量验证')

  await test('数据完整性 — 每个分类都有数据', () => {
    const requiredCategories = ['recommend', 'tech', 'sports', 'international', 'life']
    requiredCategories.forEach(cat => {
      assert(aiStats[cat] && aiStats[cat] > 0, `${cat} 分类应有数据`)
    })
  })

  await test('数据质量 — 所有项包含必要字段', () => {
    aiNewsCache.forEach((item, i) => {
      assert(item.id, `第${i}项缺少 id`)
      assert(item.title, `第${i}项缺少 title`)
      assert(item.summary, `第${i}项缺少 summary`)
      assert(item.category, `第${i}项缺少 category`)
      assert(item.categoryName, `第${i}项缺少 categoryName`)
      assert(item.source, `第${i}项缺少 source`)
      assert(item.publishTime, `第${i}项缺少 publishTime`)
    })
  })

  await test('数据质量 — 无重复 ID', () => {
    const ids = aiNewsCache.map(item => item.id)
    const uniqueIds = new Set(ids)
    assert(ids.length === uniqueIds.size, `存在重复 ID，总数: ${ids.length}，唯一数: ${uniqueIds.size}`)
  })

  // ── 结果汇总 ──
  console.log('\n========================================')
  console.log('  测试结果汇总')
  console.log('========================================')
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

  console.log('\n========================================\n')
  process.exit(failed > 0 ? 1 : 0)
}

run().catch(err => {
  console.error('测试执行异常:', err)
  process.exit(1)
})
