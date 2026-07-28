/**
 * Validator 深度回归测试 v4
 *
 * 覆盖维度：
 *   一、来源白名单
 *   二、字段完整性
 *   三、长度校验
 *   四、垃圾内容过滤
 *   五、去重逻辑
 *   六、批量校验
 */

const {
  validateNewsItem,
  validateAndClean,
  deduplicateByTitle,
  VALID_SOURCES,
} = require('../cloudfunctions/common/validator')

// ─── 测试框架 ───────────────────────────────────────

const results = { pass: 0, fail: 0 }
const failures = []

function test(name, fn) {
  try {
    fn()
    results.pass++
  } catch (e) {
    results.fail++
    failures.push({ name, error: e.message })
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'assertEqual failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertOk(value, msg) {
  if (!value) {
    throw new Error(`${msg || 'assertOk failed'}: expected truthy, got ${JSON.stringify(value)}`)
  }
}

function assertNotOk(value, msg) {
  if (value) {
    throw new Error(`${msg || 'assertNotOk failed'}: expected falsy, got ${JSON.stringify(value)}`)
  }
}

function assertIncludes(str, substr, msg) {
  if (!str.includes(substr)) {
    throw new Error(`${msg || 'assertIncludes failed'}: "${str}" does not include "${substr}"`)
  }
}

function makeItem(overrides = {}) {
  return {
    title: '这是一个正常的新闻标题',
    summary: '这是一个正常的新闻摘要，包含足够长度的内容信息。',
    source: '新华社',
    url: 'https://example.com/news/1',
    publishTime: '2026-07-28T10:00:00Z',
    category: '科技',
    ...overrides,
  }
}

// ─── 维度一：来源白名单 ─────────────────────────────

console.log('\n========== 维度一：来源白名单 ==========')

// 实际 VALID_SOURCES（从 SOURCE_DOMAIN_MAP 的值构建）
const actualValidSources = [
  '新华社', '人民日报', '央视新闻', '中新网', '澎湃新闻',
  '36氪', '虎嗅', '环球时报', '路透社', 'BBC', '美联社', 'TechCrunch',
]

// 合法来源逐一测试
actualValidSources.forEach(source => {
  test(`合法来源: ${source}`, () => {
    const r = validateNewsItem(makeItem({ source }))
    assertEqual(r.valid, true, `来源 ${source} 应该通过`)
  })
})

// 非法来源测试
test('非法来源: 随机字符串 "随便写的来源"', () => {
  const r = validateNewsItem(makeItem({ source: '随便写的来源' }))
  assertNotOk(r.valid, '随机来源应被拒绝')
  assertIncludes(r.reason, '来源不在白名单')
})

test('非法来源: 空字符串', () => {
  const r = validateNewsItem(makeItem({ source: '' }))
  assertNotOk(r.valid, '空字符串来源应被拒绝')
  // 空字符串会先被"缺少来源"拦截，还是被"来源不在白名单"拦截？
  // 代码: !item.source 对空字符串也是 true，所以会是"缺少来源"
})

test('非法来源: null', () => {
  const r = validateNewsItem(makeItem({ source: null }))
  assertNotOk(r.valid, 'null 来源应被拒绝')
})

test('非法来源: undefined', () => {
  const r = validateNewsItem(makeItem({ source: undefined }))
  assertNotOk(r.valid, 'undefined 来源应被拒绝')
})

test('非法来源: "未知来源"', () => {
  const r = validateNewsItem(makeItem({ source: '未知来源' }))
  assertNotOk(r.valid, '"未知来源"应被拒绝')
  assertIncludes(r.reason, '来源不在白名单')
})

// 来源为中文但不在白名单中的边界情况
test('边界: 中文来源"光明日报"(不在白名单)', () => {
  const r = validateNewsItem(makeItem({ source: '光明日报' }))
  assertNotOk(r.valid, '光明日报不在白名单，应拒绝')
})

test('边界: 中文来源"华尔街日报"(不在白名单)', () => {
  const r = validateNewsItem(makeItem({ source: '华尔街日报' }))
  assertNotOk(r.valid, '华尔街日报不在白名单，应拒绝')
})

test('边界: 中文来源"CNN"(不在白名单)', () => {
  const r = validateNewsItem(makeItem({ source: 'CNN' }))
  assertNotOk(r.valid, 'CNN不在白名单，应拒绝')
})

// ─── 维度二：字段完整性 ─────────────────────────────

console.log('\n========== 维度二：字段完整性 ==========')

test('缺失 title', () => {
  const r = validateNewsItem(makeItem({ title: undefined }))
  assertNotOk(r.valid)
  assertIncludes(r.reason, '标题')
})

test('缺失 title (空字符串)', () => {
  const r = validateNewsItem(makeItem({ title: '' }))
  assertNotOk(r.valid)
  assertIncludes(r.reason, '标题')
})

test('缺失 summary', () => {
  const r = validateNewsItem(makeItem({ summary: undefined }))
  assertNotOk(r.valid)
  assertIncludes(r.reason, '摘要')
})

test('缺失 summary (空字符串)', () => {
  const r = validateNewsItem(makeItem({ summary: '' }))
  assertNotOk(r.valid)
  assertIncludes(r.reason, '摘要')
})

test('缺失 source', () => {
  const r = validateNewsItem(makeItem({ source: undefined }))
  assertNotOk(r.valid)
  assertIncludes(r.reason, '来源')
})

test('缺失 url', () => {
  // url 在代码中未被校验，所以应该通过
  const r = validateNewsItem(makeItem({ url: undefined }))
  assertEqual(r.valid, true, 'url 未被校验，应通过')
})

test('缺失 publishTime', () => {
  // publishTime 在代码中未被校验，所以应该通过
  const r = validateNewsItem(makeItem({ publishTime: undefined }))
  assertEqual(r.valid, true, 'publishTime 未被校验，应通过')
})

test('缺失 category（可选字段，应通过）', () => {
  const r = validateNewsItem(makeItem({ category: undefined }))
  assertEqual(r.valid, true, 'category 是可选字段，应通过')
})

test('所有字段完整', () => {
  const r = validateNewsItem(makeItem())
  assertEqual(r.valid, true, '所有字段完整应通过')
})

// ─── 维度三：长度校验 ───────────────────────────────

console.log('\n========== 维度三：长度校验 ==========')

// title 长度边界
test('title 恰好 5 字符（边界通过）', () => {
  const r = validateNewsItem(makeItem({ title: '12345' }))
  assertEqual(r.valid, true, '5 字符标题应通过')
})

test('title 恰好 200 字符（边界通过）', () => {
  const r = validateNewsItem(makeItem({ title: 'A'.repeat(200) }))
  assertEqual(r.valid, true, '200 字符标题应通过')
})

test('title 4 字符（应拒绝）', () => {
  const r = validateNewsItem(makeItem({ title: '1234' }))
  assertNotOk(r.valid, '4 字符标题应拒绝')
  assertIncludes(r.reason, '过短')
})

test('title 201 字符（应拒绝）', () => {
  const r = validateNewsItem(makeItem({ title: 'A'.repeat(201) }))
  assertNotOk(r.valid, '201 字符标题应拒绝')
  assertIncludes(r.reason, '过长')
})

// summary 长度边界
test('summary 恰好 10 字符（边界通过）', () => {
  const r = validateNewsItem(makeItem({ summary: '1234567890' }))
  assertEqual(r.valid, true, '10 字符摘要应通过')
})

test('summary 恰好 1000 字符（边界通过）', () => {
  const r = validateNewsItem(makeItem({ summary: 'A'.repeat(1000) }))
  assertEqual(r.valid, true, '1000 字符摘要应通过')
})

test('summary 9 字符（应拒绝）', () => {
  const r = validateNewsItem(makeItem({ summary: '123456789' }))
  assertNotOk(r.valid, '9 字符摘要应拒绝')
  assertIncludes(r.reason, '过短')
})

test('summary 1001 字符（应拒绝）', () => {
  const r = validateNewsItem(makeItem({ summary: 'A'.repeat(1001) }))
  assertNotOk(r.valid, '1001 字符摘要应拒绝')
  assertIncludes(r.reason, '过长')
})

// 额外边界：title 带空格 trim 后长度边界
test('title 前后有空格，trim 后 5 字符', () => {
  const r = validateNewsItem(makeItem({ title: '  12345  ' }))
  assertEqual(r.valid, true, 'trim 后 5 字符应通过')
})

test('title 前后有空格，trim 后 4 字符', () => {
  const r = validateNewsItem(makeItem({ title: '  1234  ' }))
  assertNotOk(r.valid, 'trim 后 4 字符应拒绝')
})

// ─── 维度四：垃圾内容过滤 ───────────────────────────

console.log('\n========== 维度四：垃圾内容过滤 ==========')

test('包含"广告"关键词', () => {
  const r = validateNewsItem(makeItem({ title: '这是一个广告标题' }))
  assertNotOk(r.valid, '包含广告应拒绝')
  assertIncludes(r.reason, '广告')
})

test('包含"推广"关键词', () => {
  const r = validateNewsItem(makeItem({ title: '产品推广活动' }))
  assertNotOk(r.valid, '包含推广应拒绝')
  assertIncludes(r.reason, '推广')
})

test('包含"sponsored"关键词', () => {
  const r = validateNewsItem(makeItem({ title: 'This is a Sponsored Post' }))
  assertNotOk(r.valid, '包含 sponsored 应拒绝')
  assertIncludes(r.reason.toLowerCase(), 'sponsored')
})

test('包含"点击查看"关键词', () => {
  const r = validateNewsItem(makeItem({ title: '点击查看详情' }))
  assertNotOk(r.valid, '包含点击查看应拒绝')
})

test('包含"立即购买"关键词', () => {
  const r = validateNewsItem(makeItem({ title: '立即购买享受优惠' }))
  assertNotOk(r.valid, '包含立即购买应拒绝')
})

test('包含"限时优惠"关键词', () => {
  const r = validateNewsItem(makeItem({ title: '限时优惠大促销' }))
  assertNotOk(r.valid, '包含限时优惠应拒绝')
})

test('包含"advertisement"关键词', () => {
  const r = validateNewsItem(makeItem({ title: 'This is an Advertisement' }))
  assertNotOk(r.valid, '包含 advertisement 应拒绝')
  assertIncludes(r.reason.toLowerCase(), 'advertisement')
})

// 注意: 代码中垃圾过滤只检查 title，不检查 summary
test('标题正常但摘要含"广告"（应通过）', () => {
  const r = validateNewsItem(makeItem({ title: '这是一个正常的标题', summary: '这是一个广告推广内容信息' }))
  assertEqual(r.valid, true, '摘要含广告但标题正常，应通过（只检查标题）')
})

// 注意: 代码中没有针对"http://"、"全是数字"、"全是标点"的特殊检查
test('包含"http://"链接的标题（代码无此规则，应通过）', () => {
  const r = validateNewsItem(makeItem({ title: '请看 http://example.com 这里' }))
  assertEqual(r.valid, true, 'http:// 不在过滤规则中，应通过')
})

test('标题全是数字', () => {
  const r = validateNewsItem(makeItem({ title: '1234567890' }))
  assertEqual(r.valid, true, '全数字标题无特殊规则，应通过')
})

test('摘要全是标点符号', () => {
  const r = validateNewsItem(makeItem({ summary: '。，！？；：（）～～～～～～～～～～' }))
  assertEqual(r.valid, true, '全标点摘要无特殊规则，应通过')
})

// 正常合法内容
test('正常合法内容（应通过）', () => {
  const r = validateNewsItem(makeItem({
    title: '中国科学家在量子计算领域取得重大突破',
    summary: '近日，中国科学技术大学研究团队成功实现了量子计算新突破。',
  }))
  assertEqual(r.valid, true, '正常内容应通过')
})

// ─── 维度五：去重逻辑 ───────────────────────────────

console.log('\n========== 维度五：去重逻辑 (deduplicateByTitle) ==========')

test('完全相同标题', () => {
  const input = [
    makeItem({ title: '中国量子计算新突破' }),
    makeItem({ title: '中国量子计算新突破' }),
  ]
  const result = deduplicateByTitle(input)
  assertEqual(result.length, 1, '完全相同标题应去重保留 1 条')
})

test('Jaccard 相似度 > 0.7（相似但非完全相同）', () => {
  const input = [
    makeItem({ title: '中国量子计算取得新突破' }),
    makeItem({ title: '中国量子计算取得大突破' }), // 仅一字之差，字符集几乎相同
  ]
  const result = deduplicateByTitle(input)
  // "中国量子计算取得新突破" vs "中国量子计算取得大突破"
  // setA = {中,国,量,子,计,算,取,得,新,突,破}
  // setB = {中,国,量,子,计,算,取,得,大,突,破}
  // intersection = {中,国,量,子,计,算,取,得,突,破} = 10
  // union = {中,国,量,子,计,算,取,得,新,大,突,破} = 12
  // similarity = 10/12 ≈ 0.833 > 0.7 → 应去重
  assertEqual(result.length, 1, '相似度 > 0.7 应去重保留 1 条')
})

test('Jaccard 相似度 < 0.7', () => {
  const input = [
    makeItem({ title: '中国量子计算取得新突破' }),
    makeItem({ title: '美国股市大幅下跌' }),
  ]
  const result = deduplicateByTitle(input)
  assertEqual(result.length, 2, '相似度 < 0.7 应保留 2 条')
})

test('空数组输入', () => {
  const result = deduplicateByTitle([])
  assertEqual(result.length, 0, '空数组应返回空数组')
})

test('单条数据输入', () => {
  const input = [makeItem({ title: '唯一标题' })]
  const result = deduplicateByTitle(input)
  assertEqual(result.length, 1, '单条数据应保留')
  assertEqual(result[0].title, '唯一标题', '应保留原数据')
})

test('所有标题都不同', () => {
  const input = [
    makeItem({ title: '中国科技发展迅速' }),
    makeItem({ title: '全球经济形势分析' }),
    makeItem({ title: '人工智能伦理讨论' }),
  ]
  const result = deduplicateByTitle(input)
  assertEqual(result.length, 3, '三个不同标题应全部保留')
})

test('所有标题都相同（只保留一条）', () => {
  const input = [
    makeItem({ title: '相同标题' }),
    makeItem({ title: '相同标题' }),
    makeItem({ title: '相同标题' }),
    makeItem({ title: '相同标题' }),
  ]
  const result = deduplicateByTitle(input)
  assertEqual(result.length, 1, '4 条相同标题应只保留 1 条')
})

test('部分重复部分不重复', () => {
  const input = [
    makeItem({ title: '中国量子计算新突破' }),
    makeItem({ title: '中国量子计算新突破' }), // 重复
    makeItem({ title: '全球经济形势分析' }),   // 不重复
    makeItem({ title: '人工智能发展报告' }),   // 不重复
    makeItem({ title: '中国量子计算新突破' }), // 重复
  ]
  const result = deduplicateByTitle(input)
  assertEqual(result.length, 3, '5 条中 2 组重复，应保留 3 条')
})

test('保留的是第一条', () => {
  const input = [
    makeItem({ title: '第一条标题', summary: '第一条的摘要' }),
    makeItem({ title: '第一条标题', summary: '第二条的摘要' }),
  ]
  const result = deduplicateByTitle(input)
  assertEqual(result.length, 1, '重复标题只保留一条')
  assertEqual(result[0].summary, '第一条的摘要', '应保留第一条')
})

// ─── 维度六：批量校验 (validateAndClean) ─────────────

console.log('\n========== 维度六：批量校验 (validateAndClean) ==========')

test('正常批量数据全部通过', () => {
  const input = [
    makeItem({ title: '新闻标题一' }),
    makeItem({ title: '新闻标题二' }),
    makeItem({ title: '新闻标题三' }),
  ]
  const result = validateAndClean(input)
  assertEqual(result.valid.length, 3, '3 条有效数据应全部通过')
  assertEqual(result.rejected.length, 0, '无拒绝数据')
  assertEqual(result.stats.total, 3)
  assertEqual(result.stats.passed, 3)
  assertEqual(result.stats.rejected, 0)
  assertEqual(result.stats.duplicatesRemoved, 0)
})

test('混合有效/无效数据', () => {
  const input = [
    makeItem({ title: '有效新闻一' }),
    makeItem({ title: '广告', source: '新华社' }), // 垃圾内容
    makeItem({ title: '有', source: '新华社' }), // 标题过短
    makeItem({ title: '有效新闻二' }),
    makeItem({ source: '无效来源', title: '有效标题但来源不对' }),
  ]
  const result = validateAndClean(input)
  assertEqual(result.valid.length, 2, '应只有 2 条有效')
  assertEqual(result.rejected.length, 3, '应有 3 条被拒绝')
  assertEqual(result.stats.total, 5)
  assertEqual(result.stats.passed, 2)
  assertEqual(result.stats.rejected, 3)
})

test('空数组输入', () => {
  const result = validateAndClean([])
  assertEqual(result.valid.length, 0, '空数组 valid 应为空')
  assertEqual(result.rejected.length, 0, '空数组 rejected 应为空')
  assertEqual(result.stats.total, 0)
  assertEqual(result.stats.passed, 0)
  assertEqual(result.stats.rejected, 0)
  assertEqual(result.stats.duplicatesRemoved, 0)
})

test('包含 undefined 元素', () => {
  const input = [
    makeItem({ title: '有效新闻' }),
    undefined,
    makeItem({ title: '另一条有效新闻' }),
  ]
  // validateNewsItem(undefined) 会访问 undefined.title → throw TypeError
  let threw = false
  try {
    validateAndClean(input)
  } catch (e) {
    threw = true
    assertOk(e instanceof TypeError, '应抛出 TypeError')
  }
  assertOk(threw, '包含 undefined 元素应抛出异常')
})

test('包含 null 元素', () => {
  const input = [
    makeItem({ title: '有效新闻' }),
    null,
    makeItem({ title: '另一条有效新闻' }),
  ]
  let threw = false
  try {
    validateAndClean(input)
  } catch (e) {
    threw = true
    assertOk(e instanceof TypeError, '应抛出 TypeError')
  }
  assertOk(threw, '包含 null 元素应抛出异常')
})

test('批量数据含重复标题（验证去重统计）', () => {
  const input = [
    makeItem({ title: '中国量子计算新突破' }),
    makeItem({ title: '中国量子计算新突破' }),
    makeItem({ title: '全球经济形势分析' }),
    makeItem({ title: '中国量子计算大突破' }), // 相似度 > 0.7，与第一条重复
  ]
  const result = validateAndClean(input)
  assertEqual(result.valid.length, 2, '去重后应只有 2 条')
  assertEqual(result.stats.duplicatesRemoved, 2, '应移除 2 条重复')
  assertEqual(result.stats.passed, 2)
  assertEqual(result.stats.rejected, 0)
})

test('rejected 中包含被拒绝的原因', () => {
  const input = [
    makeItem({ title: '广告推送', source: '新华社' }),
    makeItem({ source: '无效来源', title: '标题正常但来源无效' }),
  ]
  const result = validateAndClean(input)
  assertEqual(result.rejected.length, 2)
  // 验证 reason 包含有意义的信息
  result.rejected.forEach(r => {
    assertOk(r.reason && r.reason.length > 0, `rejected reason 不应为空: ${JSON.stringify(r)}`)
  })
})

// ─── 汇总报告 ───────────────────────────────────────

console.log('\n========================================')
console.log('           测 试 报 告')
console.log('========================================')
console.log(`总测试数: ${results.pass + results.fail}`)
console.log(`通  过:   ${results.pass}`)
console.log(`失  败:   ${results.fail}`)
console.log(`通过率:   ${((results.pass / (results.pass + results.fail)) * 100).toFixed(1)}%`)

if (failures.length > 0) {
  console.log('\n──────── 失败详情 ────────')
  failures.forEach((f, i) => {
    console.log(`  ${i + 1}. [${f.name}]`)
    console.log(`     ${f.error}`)
  })
}

console.log('========================================\n')

// 以退出码标识失败
process.exit(failures.length > 0 ? 1 : 0)
