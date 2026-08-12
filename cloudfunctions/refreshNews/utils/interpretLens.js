/**
 * interpretLens —— AI 解读「读法路由」（轻量路线，2026-08-12 owner 拍板）
 *
 * 解决两个问题（owner 8/12 提出）：
 *   ① 解读模式固化：所有新闻一个人格 + 一套四段结构，看多了疲劳
 *      → 读法库（5 种 lens）+ 同 lens 内确定性腔调轮换
 *   ② 只复述别人、缺 AI 自身视角：单调，浪费「AI」身份
 *      → 选择性加【一页说】观点段（不是所有新闻都加）
 *
 * 「轻量路线」定义（区别于 RAG）：
 *   不引入外部检索通道，观点仅来自「模型自身知识 + 原文」，并用【一页说】显式框为观点。
 *   代价：模型训练数据有截止日期，对极新/极专业事件观点可能偏泛 → 因此用门禁限制范围，
 *   只在「值得且安全」的新闻上开观点；将来接 RAG 时只需替换 buildPrompt 的背景注入部分。
 *
 * 门禁信号来源（复用 qualityScorer 已落库字段，不重复计算）：
 *   finalScore / qualityScore / heatScore / eventId / category
 *
 * 合规硬约束（详情页合规 v1.3 延续）：
 *   - 时政/灾难/事故/犯罪/军事/涉外争议等题材 → 强制「速览」且**禁止**任何观点评判
 *   - 观点必须以【一页说】显式标注，与事实区隔
 *   - 禁止编造原文不存在的事实（所有 lens 通用底线）
 */

// ─────────────────────────────────────────────────────────
// 一、不宜加 AI 观点的题材（保守判定：宁可不加，也不越线）
// 命中 → 强制 brief 读法 + allowOpinion=false
// 注：与 qualityScorer._COMPLIANCE_BLOCK_KEYWORDS 分工不同——
//     那里是「命中即弃、不入库」；这里是「可以入库，但 AI 不得评判」。
// ─────────────────────────────────────────────────────────
const NO_OPINION_SIGNALS = [
  // 时政 / 领导人活动 / 会议公报
  '总书记', '主席', '总理', '中央政治局', '国务院常务会议', '全国两会',
  '重要讲话', '亲切会见', '发表重要', '公报', '党中央',
  // 灾难 / 事故 / 伤亡
  '地震', '洪灾', '洪水', '台风', '暴雨致', '山体滑坡', '泥石流',
  '爆炸', '火灾', '坠机', '沉船', '矿难', '事故', '遇难', '伤亡', '失联', '死亡',
  // 犯罪 / 司法未决
  '涉嫌', '被刑拘', '批准逮捕', '提起公诉', '一审宣判', '判处', '被查', '落马',
  '受贿', '贪污', '刑事', '嫌疑人',
  // 军事 / 主权 / 涉外争议
  '军演', '导弹', '战机', '领土', '主权', '制裁', '撤侨', '冲突升级',
  // 公共卫生突发
  '疫情', '确诊病例', '疫苗紧急', '突发公共卫生',
]

// 发展中 / 结论未定的信号 → 适合「追问」读法（以问代论，不硬下结论）
const UNSETTLED_SIGNALS = [
  '或将', '可能', '拟', '传', '有望', '研究中', '征求意见', '试点',
  '尚未', '待定', '初步', '预计', '计划于', '正在调查', '知情人士',
]

// ─────────────────────────────────────────────────────────
// 二、读法库（5 种）
// 每种含多组 opening/closing 变体，用于同 lens 内破疲劳（确定性轮换）
// allowOpinion: 该读法是否「允许」带观点（最终还要与题材门禁 AND）
// lengthFactor: 字数系数（速览天然该短，省 token 也省成本）
// ─────────────────────────────────────────────────────────
const LENSES = {
  // 速览：只讲清楚发生了什么，绝不评判。用于低价值/软新闻/敏感题材
  brief: {
    id: 'brief',
    name: '速览',
    allowOpinion: false,
    lengthFactor: 0.6,
    persona: '你是「一页」的新闻速览员，任务是让读者 30 秒内知道发生了什么。',
    body: [
      '第一句直接给最核心的事实（谁、做了什么、结果如何），不要铺垫；',
      '随后补必要的时间、地点、数字等关键信息，只留读者真正需要的；',
      '语言干净、短句为主，不抒情、不评判、不做延伸推测。',
    ],
    openings: [
      '开头用一句陈述句把最关键的结论摆出来。',
      '开头直接点出这件事最值得知道的一个事实。',
      '开头用「发生了什么」的最简概括起手，不带修饰。',
    ],
    closings: [
      '结尾用一句客观交代当前进展或后续安排即可，不加评论。',
      '结尾落在事实层面的收束（现状/下一步时间点），不作判断。',
      '结尾简单交代目前状态，不引申、不评价。',
    ],
  },

  // 深一度：讲清背景与影响，可带克制观点。硬新闻主力读法
  depth: {
    id: 'depth',
    name: '深一度',
    allowOpinion: true,
    lengthFactor: 1.0,
    persona: '你是「一页」的深度解读人，擅长把一件事的来龙去脉和分量讲透。',
    body: [
      '讲清事件的背景——它是从哪一步走到今天的；',
      '说明它为什么重要，以及具体影响到哪些人、哪些行业；',
      '挑读者最该知道的两三个关键点展开，不做无差别罗列。',
    ],
    openings: [
      '开场用一句话点出「这事和读者有什么关系」，别端着。',
      '开场先给一个具体的对比或数字，让读者立刻感到分量。',
      '开场从「过去是什么样、现在变成什么样」的变化切入。',
      '开场用一句反常识的判断把读者拉进来，随后用事实兜住。',
    ],
    closings: [
      '结尾给一句让人记得住的话（金句或小提醒）。',
      '结尾指出接下来最值得盯的一个变量。',
      '结尾用一句收束性的判断作结，克制、不喊口号。',
    ],
  },

  // 冷思考：观点权重最高，讲权衡与盲点。仅高价值 + 安全题材
  cold: {
    id: 'cold',
    name: '冷思考',
    allowOpinion: true,
    lengthFactor: 1.0,
    persona: '你是「一页」的冷思考作者，比起复述，你更擅长指出别人没说的那一层。',
    body: [
      '先用最少的字把事实讲清，不要在已知信息上耗篇幅；',
      '重点放在「这件事的另一面」——被忽略的代价、潜在的权衡、可能的副作用；',
      '给出你自己的判断，但每个判断都要能追溯到原文事实或公认常识，不臆造。',
    ],
    openings: [
      '开场直接抛出一个多数人没注意到的角度。',
      '开场先承认这事的表面利好，再转向「但是」。',
      '开场用一个设问把读者的默认判断悬起来。',
      '开场从「谁受益、谁承担成本」这个切口进入。',
    ],
    closings: [
      '结尾留一个值得长期观察的问题，不强行给答案。',
      '结尾给一句克制而有分量的判断。',
      '结尾提醒读者未来验证这件事的具体观察点。',
    ],
  },

  // 生活家：跟日子的关系。民生/社会类
  life: {
    id: 'life',
    name: '生活家',
    allowOpinion: true,
    lengthFactor: 0.85,
    persona: '你是「一页」的生活观察者，习惯把政策和新闻翻译成普通人过日子的语言。',
    body: [
      '把这件事换算成读者的具体生活场景（花多少钱、省多少事、要注意什么）；',
      '讲清哪些人会真的被影响到，哪些人其实不受影响，避免让人虚惊一场；',
      '用日常口语,不用公文腔和行业术语，必要时打个生活化的比方。',
    ],
    openings: [
      '开场用一句「以后你可能会……」把读者代入。',
      '开场先说这事儿落到日常里是什么样子。',
      '开场从一个具体的生活场景切进去。',
    ],
    closings: [
      '结尾给一句实用的小提醒。',
      '结尾说清读者现在需不需要做点什么。',
      '结尾用一句贴近生活的话收住。',
    ],
  },

  // 追问：结论未定的事，以问代论
  ask: {
    id: 'ask',
    name: '追问',
    allowOpinion: true,
    lengthFactor: 0.85,
    persona: '你是「一页」的追问者，面对还没定论的事，你负责把问题问准，而不是抢着下结论。',
    body: [
      '讲清目前已经确定的事实边界——什么已经明确，什么还只是说法；',
      '把关键的不确定点一一列出，说明为什么它们还悬着；',
      '明确区分「已确认」与「待观察」，绝不把猜测写成事实。',
    ],
    openings: [
      '开场先说清这事目前只到哪一步，别把进行中说成已完成。',
      '开场用一个尚未有答案的关键问题起手。',
      '开场先划清「已确定」和「还没定」的界线。',
    ],
    closings: [
      '结尾列出接下来最该等的那个信号。',
      '结尾提醒读者在哪一步之前不必急着下判断。',
      '结尾以一个开放问题收束。',
    ],
  },
}

// ─────────────────────────────────────────────────────────
// 三、门禁阈值
// ─────────────────────────────────────────────────────────
const ROUTE = {
  coldMinScore: 70,   // 冷思考（观点最重）：FinalScore 门槛
  depthMinScore: 50,  // 深一度：FinalScore 门槛
  opinionMinScore: 50, // 低于此分不加【一页说】观点段（不值得占篇幅）
}

// 硬新闻类目（适合 depth/cold）
const HARD_CATEGORIES = ['tech', 'international', 'recommend']
// 民生/社会类目（适合 life）
const LIFE_CATEGORIES = ['life']

/**
 * 确定性哈希（同一标题永远得同一腔调变体 → 结果可复现，不会一刷新就变；
 * 不同新闻之间自然分散 → 破疲劳）
 */
function stableHash(str) {
  const s = String(str || '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * 题材安全判定：是否禁止 AI 加观点
 * @returns {string|null} 命中的信号词；无命中返回 null
 */
function detectNoOpinionSignal(item) {
  const hay = `${(item && item.title) || ''} ${(item && item.summary) || ''}`
  for (const kw of NO_OPINION_SIGNALS) {
    if (hay.includes(kw)) return kw
  }
  return null
}

/**
 * 结论未定判定（→ 追问读法）
 */
function detectUnsettled(item) {
  const hay = `${(item && item.title) || ''}`
  for (const kw of UNSETTLED_SIGNALS) {
    if (hay.includes(kw)) return kw
  }
  return null
}

/**
 * 读法路由：根据落库信号决定「用哪种读法 + 是否允许观点」
 *
 * 优先级（越前越硬）：
 *   1. 敏感题材 → brief，禁观点（合规硬约束，最高优先）
 *   2. 结论未定 → ask
 *   3. 民生/社会类 → life
 *   4. 高分 + 硬新闻 → cold
 *   5. 中分 → depth
 *   6. 兜底 → brief
 *
 * @param {Object} item - 已被 qualityScorer 评分的新闻项
 * @returns {{lensId:string, lens:Object, allowOpinion:boolean, reason:string, variant:number}}
 */
function routeLens(item) {
  const it = item || {}
  const score = typeof it.finalScore === 'number' ? it.finalScore : 50
  const category = it.category || ''
  const variant = stableHash(it.title || it.id || '')

  // 1. 合规硬约束：敏感题材一律速览、禁止评判
  const blocked = detectNoOpinionSignal(it)
  if (blocked) {
    return {
      lensId: 'brief', lens: LENSES.brief, allowOpinion: false, variant,
      reason: `敏感题材(${blocked})→强制速览禁观点`,
    }
  }

  // 2. 结论未定 → 追问
  const unsettled = detectUnsettled(it)
  if (unsettled && score >= ROUTE.opinionMinScore) {
    return {
      lensId: 'ask', lens: LENSES.ask, allowOpinion: true, variant,
      reason: `结论未定(${unsettled})→追问`,
    }
  }

  // 3. 民生/社会类 → 生活家
  if (LIFE_CATEGORIES.includes(category) && score >= ROUTE.opinionMinScore) {
    return {
      lensId: 'life', lens: LENSES.life, allowOpinion: true, variant,
      reason: `民生类(${category})→生活家`,
    }
  }

  // 4. 高分 + 硬新闻 → 冷思考
  if (score >= ROUTE.coldMinScore && HARD_CATEGORIES.includes(category)) {
    return {
      lensId: 'cold', lens: LENSES.cold, allowOpinion: true, variant,
      reason: `高价值(${score})+硬新闻(${category})→冷思考`,
    }
  }

  // 5. 中分 → 深一度
  if (score >= ROUTE.depthMinScore) {
    return {
      lensId: 'depth', lens: LENSES.depth, allowOpinion: true, variant,
      reason: `中等价值(${score})→深一度`,
    }
  }

  // 6. 兜底 → 速览（低分不值得长篇，也不加观点）
  return {
    lensId: 'brief', lens: LENSES.brief, allowOpinion: false, variant,
    reason: `低价值(${score})→速览`,
  }
}

/**
 * 按读法生成 system prompt
 *
 * @param {Object} route - routeLens 返回值
 * @param {Object} opts - { srcLen, tMin, tMax }
 * @returns {{prompt:string, tMin:number, tMax:number, lensId:string, withOpinion:boolean}}
 */
function buildPrompt(route, opts = {}) {
  const lens = (route && route.lens) || LENSES.brief
  const variant = (route && route.variant) || 0
  const srcLen = opts.srcLen || 0

  // 字数按读法系数收缩（速览天然短，省成本）
  const factor = lens.lengthFactor || 1.0
  const tMin = Math.max(120, Math.round((opts.tMin || 300) * factor))
  const tMax = Math.max(tMin + 60, Math.round((opts.tMax || 600) * factor))

  // 确定性轮换腔调（同 lens 不同新闻腔调不同 → 破疲劳）
  const opening = lens.openings[variant % lens.openings.length]
  const closing = lens.closings[variant % lens.closings.length]

  // 观点段：读法允许 AND 题材允许，才要求 AI 出【一页说】
  const withOpinion = !!(lens.allowOpinion && route && route.allowOpinion)

  const lines = []
  lines.push(lens.persona)
  lines.push('基于用户给的新闻原文写一篇独立解读，不是复述、不是摘要。')
  lines.push('写法：')
  let n = 1
  lines.push(`${n++}. ${opening}`)
  for (const b of lens.body) lines.push(`${n++}. ${b}`)
  lines.push(`${n++}. ${closing}`)
  lines.push(`${n++}. 分段用空行分隔，段间自然过渡。`)

  if (withOpinion) {
    // 观点段：显式标注，与事实区隔（合规要求）
    lines.push(
      `${n++}. 在结尾另起一段，以「【一页说】」开头，用 2-3 句给出你自己的看法或提醒。` +
      '这一段是观点而非事实，必须建立在原文事实或公认常识之上，不得引入无法核实的具体数据、时间、人名。'
    )
  } else {
    lines.push(`${n++}. 全文只陈述事实，不得加入任何评论、判断、猜测或情绪化表达。`)
  }

  // 通用底线（所有读法共用）
  lines.push(
    `${n++}. 禁止「据报道」「据悉」「记者从…获悉」等套话；禁止逐字复述或高度相似改写原文；` +
    '禁止编造原文中不存在的事实。'
  )
  lines.push(
    `原文约 ${srcLen} 字，你的解读控制在 ${tMin}-${tMax} 字，以句号自然收尾。`
  )

  return { prompt: lines.join('\n'), tMin, tMax, lensId: lens.id, withOpinion }
}

/**
 * 一站式：路由 + 生成 prompt（contentFetcher 主要调这个）
 */
function resolveInterpretPlan(item, opts = {}) {
  const route = routeLens(item)
  const built = buildPrompt(route, opts)
  return {
    ...built,
    lensName: route.lens.name,
    routeReason: route.reason,
    allowOpinion: route.allowOpinion,
  }
}

/**
 * 从解读正文切出【一页说】观点段，返回干净的「正文」与独立的「观点」字段。
 *
 * 用途（owner 2026-08-12 拍板）：前端要把【一页说】作为独立小卡片/胶囊呈现，
 * 不应混在正文当普通段落。故生成侧把观点从 text 切出成独立字段 aiOpinion，
 * 正文 text 同时剥离内联标记，避免前端重复渲染。
 *
 * @param {string} text - 模型返回的解读全文
 * @returns {{body:string, opinion:string}}
 *   body   去掉【一页说】段后的正文（前端当普通段落渲染，已无内联标记）
 *   opinion 观点文本本体（不含「【一页说】」标签前缀）；无可切出则为 ''
 */
function splitOpinionFromText(text) {
  if (!text) return { body: '', opinion: '' }
  const markers = ['【一页说】', '一页说']
  let idx = -1
  let markerLen = 0
  for (const m of markers) {
    const i = text.indexOf(m)
    if (i !== -1) { idx = i; markerLen = m.length; break }
  }
  if (idx === -1) return { body: text, opinion: '' }
  let opinion = text.slice(idx + markerLen).trim()
  // 去掉观点段开头可能的分隔符（—— / ： / : / 换行 / 全角空格）
  opinion = opinion.replace(/^[\s　:：—\-·]+/, '')
  let body = text.slice(0, idx).trim()
  // 去掉正文中观点段之前的残留分隔符（换行 / —— / · 等）
  body = body.replace(/[\s　—\-·]+$/, '')
  return { body, opinion }
}

module.exports = {
  LENSES,
  ROUTE,
  NO_OPINION_SIGNALS,
  UNSETTLED_SIGNALS,
  stableHash,
  detectNoOpinionSignal,
  detectUnsettled,
  routeLens,
  buildPrompt,
  resolveInterpretPlan,
  splitOpinionFromText,
}
