// aiOpinion 抽取单测：验证【一页说】观点从正文切出成独立字段、正文内联标记被剥离。
// 运行：node test/ai-opinion-extract-test.mjs
import { splitOpinionFromText } from '../cloudfunctions/refreshNews/utils/interpretLens.js'

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

console.log('— splitOpinionFromText —')

// 1. 标准：结尾【一页说】段，正文剥离标记
{
  const t = '这事的核心是政府出台了新补贴政策。\n对新能源车企是直接利好。\n\n【一页说】短期看是抢装行情，长期还得看需求能不能接住。'
  const { body, opinion } = splitOpinionFromText(t)
  check('body 不含【一页说】标记', !body.includes('【一页说】'))
  check('body 保留前两段', body.includes('新能源车企是直接利好'))
  check('opinion 不含标签前缀', opinion === '短期看是抢装行情，长期还得看需求能不能接住。')
  check('opinion 非空', opinion.length > 0)
}

// 2. 无观点标记：整段当正文，opinion 空
{
  const t = '今天气温骤降，注意保暖。这是一条普通事实解读。'
  const { body, opinion } = splitOpinionFromText(t)
  check('无标记时 body=全文', body === t)
  check('无标记时 opinion 为空', opinion === '')
}

// 3. 兼容无括号「一页说」
{
  const t = '某政策落地。\n\n一页说：落地节奏比力度更关键。'
  const { body, opinion } = splitOpinionFromText(t)
  check('兼容无括号一页说', opinion === '落地节奏比力度更关键。')
  check('body 不残留一页说', !body.includes('一页说'))
}

// 4. 观点段前有分隔符（—— / 换行）应被清理
{
  const t = '主体内容。\n\n——【一页说】这事没看上去那么简单。'
  const { body, opinion } = splitOpinionFromText(t)
  check('opinion 去掉开头——', opinion === '这事没看上去那么简单。')
  check('body 去掉结尾换行/分隔', !body.endsWith('——') && body === '主体内容。')
}

// 5. 模拟调用方门禁：withOpinion=false 时即使模型夹带标记也不暴露观点
{
  const t = '事实陈述。\n\n【一页说】不该出现的观点。'
  const { body, opinion } = splitOpinionFromText(t)
  const withOpinion = false
  const aiOpinion = withOpinion ? opinion : ''   // 与 contentFetcher 逻辑一致
  check('禁观点时 aiOpinion 为空', aiOpinion === '')
  check('禁观点时正文仍剥离标记', !body.includes('【一页说】'))
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
