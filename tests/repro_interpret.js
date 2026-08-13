// 模拟 interpretNews 的输入，验证 prompt 是否会让模型输出"像摘要"的解读
const { resolveInterpretPlan } = require('../cloudfunctions/refreshNews/utils/interpretLens')
const longNews = {
  title: '我国首款自研大型客机C919首条国际航线开通 执飞上海-新加坡',
  summary: 'C919今日正式执飞首条国际航线，从上海虹桥飞往新加坡樟宜，标志着国产大飞机迈出国际市场第一步。',
  category: 'tech',
  finalScore: 68,
}
const plan = resolveInterpretPlan(longNews, { srcLen: 1200, tMin: 450, tMax: 580 })
console.log('读法:', plan.lensName, '| 允许观点:', plan.withOpinion, '| 路由原因:', plan.routeReason)
console.log('--- prompt 前 300 字 ---')
console.log(plan.prompt.slice(0, 300))
