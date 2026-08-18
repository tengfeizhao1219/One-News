// intelRouter.js — 情报分层路由（T3.2 / P）
// ============================================================
// 设计 §6.1/§6.4/§6.6/§6.7：
//   - 廉价「规则 + 信号词」打分，把新条目分成 high / medium / low；
//   - 低相关直接丢弃 70%+（不进今日关注），不消耗强模型配额；
//   - 场景映射基于老赵三重身份权重（工作·RCBC / 产品·One News / 家庭·装修育儿）；
//   - 合同/接口变更特殊路由（§6.7 硬约束）：命中即置 high 并标记 commlog 需广播。
//
// 纯粹、无副作用、纯函数，便于单测。intel_ 命名空间隔离。
// ============================================================

// 三重身份关注信号（设计 §6.4 权重表，可扩展）
const SIGNALS = {
  work_rcbc: {
    label: '工作·RCBC FRAML 合规 PM / TrustDecision',
    weight: 3,
    keywords: ['aml', '反洗钱', '制裁', 'sanctions', 'framl', '合规', '监管', 'regulatory',
      'trustdecision', '供应商', 'kyt', 'kyc', '交易监控', '风控', '风险评估', 'fraud'],
  },
  product_onenews: {
    label: '产品·One News PD+FE / AI 阅读引擎',
    weight: 2,
    keywords: ['one news', '阅读引擎', '小程序', 'rss', 'theme.json', '设计系统', '信息流',
      '摘要', '新闻', '阅读', '内容聚合', 'llm', '大模型', 'ai agent', 'agent', '检索', 'rag',
      '多模态', '语音识别', 'tts', 'ocr', '信息抽取', 'feed'],
  },
  life: {
    label: '家庭/生活·装修 / 育儿 / 效率 / 自动化',
    weight: 1,
    keywords: ['装修', '家居', '家电', '智能家居', '育儿', '亲子', '儿童', '家庭',
      '效率', '自动化', '脚本', '节能', '收纳', '厨房', '拖地', '扫地机器人', 'ai 助手'],
  },
}

// 合同/接口变更特殊路由（设计 §6.7 硬约束——高敏，可追溯）
const CONTRACT_HINT = ['合同', '接口', 'api', '协议', '价格', 'sla', '变更', 'contract', 'pricing', '变更通知']

/**
 * 对单条条目做相关性打分。
 * @param {Object} item - intel_ingest 原始条目（title/summary/content/layer/sourceId）
 * @param {Object|null} profile - 用户画像（intel_profile，可空；空时行为与改造前完全一致）
 * @returns {{ level:'high'|'medium'|'low', score:number, sceneTags:string[], hits:number, contract:boolean, reason:string }}
 */
function score(item, profile) {
  const body = [item.title, item.summary, item.content, item.sourceName]
    .filter(Boolean).map((s) => String(s).toLowerCase()).join('\n')

  let score = 0
  const sceneTags = []
  const hitsMap = {}
  for (const [tag, sig] of Object.entries(SIGNALS)) {
    let hits = 0
    for (const kw of sig.keywords) {
      // 单词边界式匹配：全词或直接包含（中文无需边界，英文分词）
      if (kw.includes(' ')) {
        if (body.split(/\W+/).includes(kw)) hits++
      } else if (body.includes(kw)) {
        hits++
      }
    }
    if (hits > 0) {
      sceneTags.push(tag)
      hitsMap[tag] = hits
    }
  }
  // 命中场景越多、权重越高 → 分数越高（设计 §6.4 强度规则）
  for (const tag of sceneTags) score += SIGNALS[tag].weight * Math.min(hitsMap[tag], 3)

  // ── 画像驱动打分（Phase 5 / T5.2）──
  // 空 profile(null/undefined) → profileBoost=0、depth=5，分数与改造前完全一致。
  let profileBoost = 0
  let depth = 5
  let hasProfile = false
  if (profile && typeof profile === 'object') {
    hasProfile = true
    depth = profile.depth === 'deep' ? 3 : (profile.depth === 'lite' ? 7 : 5)
    // focusTags 命中 body → 每命中 +2
    const tags = Array.isArray(profile.focusTags) ? profile.focusTags : []
    for (const t of tags) {
      const w = String(t || '').toLowerCase()
      if (w && body.includes(w)) profileBoost += 2
    }
    // identities 与 sceneTags 对齐 → 每个对齐 +1
    const id = profile.identities || {}
    if (sceneTags.includes('work_rcbc') && id.work) profileBoost += 1
    if (sceneTags.includes('product_onenews') && id.product) profileBoost += 1
    if (sceneTags.includes('life') && id.life) profileBoost += 1
  }
  score += profileBoost

  // 合同/接口变更 → 强制 high（§6.7）
  const contract = CONTRACT_HINT.some((kw) => body.includes(kw.toLowerCase()))

  let level = 'low'
  let reason = '无场景命中'
  if (contract) { level = 'high'; reason = '合同/接口变更特殊路由' }
  else if (score >= depth) { level = 'high'; reason = `规则强命中(score=${score})` }
  else if (score >= 2) { level = 'medium'; reason = `规则中命中(score=${score})` }
  else reason = `规则低相关(score=${score})`
  // 画像信息仅在有画像时附在 reason 尾部，便于观察；无画像时 reason 与改造前完全一致
  if (hasProfile) reason += `;depth=${depth},boost=${profileBoost}`

  return { level, score, sceneTags, hits: sceneTags.length, contract, reason }
}

module.exports = { score, SIGNALS, CONTRACT_HINT }
