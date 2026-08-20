/**
 * qualityScorer.js 单元测试（本地 node 直接运行，不依赖云环境）
 * 运行：node test_qualityScorer.js
 */
const qs = require('../cloudfunctions/refreshNews/utils/qualityScorer')

let pass = 0
let fail = 0

function assert(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${detail ? '→ ' + detail : ''}`) }
}

console.log('── ① 来源权威性 sourceAuthority ──')
assert('新华社=100', qs.sourceAuthority({ source: '新华社' }) === 100, qs.sourceAuthority({ source: '新华社' }))
assert('人民日报=100', qs.sourceAuthority({ source: '人民日报' }) === 100)
assert('央媒域名兜底 cctv.com=100', qs.sourceAuthority({ source: '央视', sourceUrl: 'https://news.cctv.com/x' }) === 100)
assert('澎湃=85', qs.sourceAuthority({ source: '澎湃新闻' }) === 85)
assert('36氪=80', qs.sourceAuthority({ source: '36氪' }) === 80)
assert('聚合数据=60', qs.sourceAuthority({ source: '聚合数据' }) === 60)
assert('天行=60', qs.sourceAuthority({ source: '天行' }) === 60)
assert('未知=40', qs.sourceAuthority({ source: '某自媒体号' }) === 40)
assert('空来源=40', qs.sourceAuthority({ source: '' }) === 40)
assert('IT之家=80', qs.sourceAuthority({ source: 'IT之家' }) === 80)

console.log('── ② 内容完整性 contentCompleteness ──')
assert('正文300+字>=90', qs.contentCompleteness({ content: '。'.repeat(320) }) >= 90)
assert('正文80-300字>=60', qs.contentCompleteness({ content: '。'.repeat(150) }) >= 60)
assert('正文<80字=20', qs.contentCompleteness({ content: '短正文。' }) === 20)
assert('无内容用summary', qs.contentCompleteness({ content: '', summary: '这是一个比较长一点的摘要内容用来测试。' }) >= 20)
assert('完全无内容=0', qs.contentCompleteness({ content: '' }) === 0)
assert('含>=2句加成', qs.contentCompleteness({ content: ('好句子。'.repeat(50)) }) >= qs.contentCompleteness({ content: ('好句子'.repeat(50)) }))

console.log('── ③ 时效性 timeliness ──')
assert('无时间=50', qs.timeliness({}) === 50)
assert('1小时前>12小时前', qs.timeliness({ publishTime: Date.now() - 3600000 }) > qs.timeliness({ publishTime: Date.now() - 12 * 3600000 }))
assert('48小时接近半衰', Math.abs(qs.timeliness({ publishTime: Date.now() - 48 * 3600000 }) - 37) <= 3, qs.timeliness({ publishTime: Date.now() - 48 * 3600000 }))
assert('现在=100附近', qs.timeliness({ publishTime: Date.now() }) >= 95)

console.log('── ④ 文本质量 textQuality ──')
const rawDirty = '这是一段非常长的正文内容。'.repeat(50) + '相关推荐推荐阅读猜你喜欢更多新闻'.repeat(20)
assert('高噪音比>0.4检测', (() => {
  const item = { content: '清洗后较短正文。', _rawContent: rawDirty }
  const t = qs.textQuality(item)
  return item._noiseRatio > 0.4 || t === 0
})())
assert('基本无噪音高分', qs.textQuality({ content: '。'.repeat(100) }) > 80)
assert('无content=0', qs.textQuality({}) === 0)

console.log('── ⑤ 去重唯一性 dedupScore ──')
const ctxDup = { seenTitles: new Set(['标题a']), seenUrls: new Set(['a.com/x']) }
assert('批内标题重复=0', qs.dedupScore({ title: '标题A', sourceUrl: 'b.com/y' }, ctxDup) === 0)
assert('批内URL重复=0', qs.dedupScore({ title: '标题B', sourceUrl: 'a.com/x' }, ctxDup) === 0)
assert('全新=100', qs.dedupScore({ title: '标题C', sourceUrl: 'c.com/z' }, { seenTitles: new Set(), seenUrls: new Set() }) === 100)
assert('_dupInBatch=0', qs.dedupScore({ title: '标题X', sourceUrl: 'x.com', _dupInBatch: true }, {}) === 0)

console.log('── ⑥ 合规门禁 complianceGate ──')
assert('版权全文转载命中', !!qs.complianceGate({ title: '【全文转载】某外媒深度报道', summary: 'x' }))
assert('版权归XX所有命中', !!qs.complianceGate({ title: '正常标题', summary: '版权归原作者所有' }))
assert('正常不命中', !qs.complianceGate({ title: '今天天气晴朗', summary: '适合出行' }))

console.log('── 跨源事件聚类 clusterEvent ──')
const items = [
  { id: 'a1', title: '央行宣布全面降准0.5个百分点', source: '新华社', category: 'recommend', publishTime: Date.now() - 3600000, content: '。'.repeat(300) },
  { id: 'a2', title: '央行全面降准0.5个百分点 释放长期资金', source: '澎湃新闻', category: 'recommend', publishTime: Date.now() - 3600000, content: '。'.repeat(300) },
  { id: 'b1', title: '国足备战世预赛名单公布', source: '新浪体育', category: 'science', publishTime: Date.now() - 7200000, content: '。'.repeat(300) },
]
qs.clusterEvent(items, {})
assert('两条降准归并同一eventId', items[0].eventId === items[1].eventId, `${items[0].eventId} vs ${items[1].eventId}`)
assert('降准事件不同eventId于国足', items[0].eventId !== items[2].eventId)
assert('跨源事件热度>单源', items[0].eventHeat > items[2].eventHeat, `${items[0].eventHeat} vs ${items[2].eventHeat}`)

console.log('── 热度 heatScore 与时间衰减 ──')
const h1 = qs.heatScore({ ...items[0], eventHeat: 30, _sourceCount: 2 }, {})
assert('eventHeat=30带decay在合理区间', h1 > 0 && h1 <= 100, h1)

console.log('── FinalScore ──')
assert('finalScore=0.6*80+0.4*50=68', qs.finalScore(80, 50) === 68)

console.log('── 批量评分 scoreAll 集成 ──')
const batch = [
  { id: 'i1', title: 'AI大模型行业迎来新一轮爆发', source: '新华社', category: 'recommend', publishTime: Date.now() - 3600000, content: '。'.repeat(300), summary: '。'.repeat(40) },
  { id: 'i2', title: 'AI大模型行业迎来新一轮爆发：多家厂商加入', source: '澎湃新闻', category: 'recommend', publishTime: Date.now() - 3600000, content: '。'.repeat(300), summary: '。'.repeat(40) },
  { id: 'dup', title: 'AI大模型行业迎来新一轮爆发', source: '天行', category: 'recommend', publishTime: Date.now() - 3600000, content: '。'.repeat(300), summary: '。'.repeat(40) },
  { id: 'bad', title: '【全文转载】某外媒报道受版权保护内容', source: '某自媒体', category: 'tech', publishTime: Date.now() - 7200000, content: '', summary: '短' },
]
const r = qs.scoreAll(batch)
assert('总条数4', r.stats.total === 4, r.stats.total)
assert('通过者带finalScore', r.passed.every(it => typeof it.finalScore === 'number'))
assert('通过者带eventId', r.passed.every(it => it.eventId))
assert('合规条目被拒(gated=compliance)', r.rejected.some(x => x.gated === 'compliance'), JSON.stringify(r.rejected.map(x=>x.gated)))
assert('两条AI大模型同一事件', batch[0].eventId === batch[1].eventId)
assert('i1热度过i2(权威)质量分更高', batch[0].qualityScore >= batch[1].qualityScore, `${batch[0].qualityScore} vs ${batch[1].qualityScore}`)

console.log(`\n===== 结果: ${pass} 通过, ${fail} 失败 =====`)
process.exit(fail > 0 ? 1 : 0)
