import { resolveInterpretPlan, routeLens } from '../cloudfunctions/refreshNews/utils/interpretLens.js'

const cases = [
  { name: '敏感题材-总书记', item: { title: '总书记发表重要讲话', category: 'recommend', finalScore: 95 } },
  { name: '敏感题材-地震', item: { title: '某地发生地震 多人遇难', category: 'life', finalScore: 80 } },
  { name: '未定论-或将', item: { title: '某新规或将于下月实施', category: 'tech', finalScore: 60 } },
  { name: '民生类-高价值', item: { title: '医保报销比例调整', category: 'life', finalScore: 72 } },
  { name: '硬新闻-高分', item: { title: '国产芯片取得突破', category: 'tech', finalScore: 85 } },
  { name: '硬新闻-中分', item: { title: '某国际会议达成阶段性共识', category: 'international', finalScore: 55 } },
  { name: '低分兜底', item: { title: '某明星出席活动', category: 'recommend', finalScore: 20 } },
  { name: '无信号-老调用方', item: { title: '某科技产品发布' } },
]

let fails = 0
for (const c of cases) {
  const plan = resolveInterpretPlan(c.item, { srcLen: 900 })
  const hasOpinionTag = plan.prompt.includes('【一页说】')
  const forbidsOpinion = plan.prompt.includes('不得加入任何评论')
  const consistent = (plan.withOpinion && hasOpinionTag) || (!plan.withOpinion && forbidsOpinion)
  if (!consistent) fails++
  console.log('【' + c.name + '】')
  console.log('  读法=' + plan.lensName + ' 观点=' + (plan.withOpinion ? '有【一页说】' : '无') + ' 区间=' + plan.tMin + '-' + plan.tMax + '字 理由=' + plan.routeReason)
  console.log('  prompt含【一页说】=' + hasOpinionTag + ' 禁评论=' + forbidsOpinion + ' 一致性=' + (consistent ? 'OK' : 'FAIL'))
  console.log('')
}
console.log(fails === 0 ? 'ALL CONSISTENT ✅' : (fails + ' CASES FAILED ❌'))
