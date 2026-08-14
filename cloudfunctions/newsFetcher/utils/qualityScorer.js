/**
 * qualityScorer.js — 官方 RSS 源 质量评分精简版
 * ============================================================
 * 与 refreshNews/utils/qualityScorer.js 【同源】——评分口径必须逐字节一致：
 *   权重、门控阈值、来源权威表、合规硬门禁均保持一致，禁止单方面改动。
 *
 * 精简裁剪说明（相对 refreshNews 版本）：
 *   1) 移除 newsCleaner 依赖          —— 官方 RSS 只存 summary 无正文，无需正文清洗；
 *                                        contentCompleteness 在 content 为空时自动以 summary 兜底评分。
 *   2) 移除 titleSimilarity/聚类/热度  —— 官方 single-source，urlFp/titleFp 已由 newsStore 精确去重，
 *                                        无跨源事件聚类，无用户行为热度。
 *   3) 保留单条评分核心                —— sourceAuthority / contentCompleteness / timeliness /
 *                                        textQuality / complianceGate / score / finalScore。
 *
 * 落库字段：scoreAll 由调用方（newsStore.batchInsert）逐条调用 score()，
 *   输出 attached { qualityScore, qualityDetail, finalScore, heatScore, passed }。
 *   FinalScore = 0.6·QualityScore + 0.4·HeatScore（HeatScore 此处用来源级静态分，见 sourceHeat）。
 *
 * 版权红线：只评分 title/summary/url，不引入正文全文。
 * ============================================================
 */

// ─── 评分权重（与 refreshNews 一致）────
const W = {
  source: 0.25,   // ① 来源权威性
  complete: 0.20, // ② 内容完整性
  fresh: 0.15,    // ③ 时效性
  text: 0.15,     // ④ 文本质量（噪音比）
  uniq: 0.10,     // ⑤ 去重唯一性
}

// ─── 质量门阈值（与 refreshNews 一致）────
const GATE = {
  minQuality: 40,    // QualityScore 低于此 → 弃
  maxNoiseRatio: 0.4 // 噪音比高于此 → 弃
}

// ─── 来源权威性配置表（与 refreshNews 一致）────
// 官方源（中新/人民/央视/新华）命中 → 100
const SOURCE_AUTHORITY = {
  '新华社': 100, '人民日报': 100, '央视新闻': 100, '中新网': 100, '环球时报': 100,
  '新华网': 100, '人民网': 100, '央视网': 100, '中国新闻网': 100, '光明网': 100, '央广网': 100,
  '澎湃新闻': 85, '路透社': 85, 'BBC': 85, '美联社': 85, '财新': 85, '第一财经': 85,
  '南方都市报': 85, '新京报': 85, '北京青年报': 85, '界面新闻': 85, '观察者网': 85, '中国青年报': 85,
  '36氪': 80, '虎嗅': 80, 'TechCrunch': 80, 'IT之家': 80, '极客公园': 80,
  '腾讯科技': 80, '新浪科技': 80, '网易科技': 80, '凤凰科技': 80,
  DEFAULT_AGG: 60,
  DEFAULT_UNKNOWN: 40,
}

const _CENTRAL_DOMAINS = [
  /xinhuanet\.com$/i, /people\.com\.cn$/i, /cctv\.com$/i, /chinanews\.com(\.cn)?$/i,
  /huanqiu\.com$/i, /gmw\.cn$/i, /fnw\.cn$/i, /cnr\.cn$/i, /news\.cn$/i,
]
const _PROVINCIAL_DOMAINS = [ /(daily|news|cn)$/i ]

const _AGG_SOURCE_NAMES = [
  '聚合', '聚合数据', '天行', '天行数据', '今日头条', '网易号', '搜狐号', '百家号',
  '一点资讯', 'ZAKER', '快资讯', 'AI', '智谱', '智能搜索', '搜索',
]

// 合规硬门禁信号（⑥）——与 refreshNews 一致：命中即弃，不进评分、不进落库。
// 官方 RSS 源为合规信源，命中概率极低，但保留口径以兜底异常条目（如转载声明残留）。
const _COMPLIANCE_BLOCK_KEYWORDS = [
  '全文转载', '未经授权转载', '授权转载请联系', '不得转载',
  /版权归.{1,20}(所有|版权所有)/, /本站（独家|原创）/,
  '点击下方关注', '关注我们', '星标我们', '后台回复', '公众号内回复',
].filter(Boolean)

/**
 * ① 来源权威性评分（0-100）——与 refreshNews 逐字节一致
 */
function sourceAuthority(item) {
  const src = (item && item.source || '').trim()
  if (!src) return SOURCE_AUTHORITY.DEFAULT_UNKNOWN
  if (_AGG_SOURCE_NAMES.some(n => src.includes(n))) return SOURCE_AUTHORITY.DEFAULT_AGG
  if (SOURCE_AUTHORITY[src] != null) return SOURCE_AUTHORITY[src]
  const url = (item && item.sourceUrl) || ''
  if (url) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
      if (_CENTRAL_DOMAINS.some(re => re.test(hostname))) return 100
      if (_PROVINCIAL_DOMAINS.some(re => re.test(hostname))) return 80
    } catch (_) { /* 忽略无效 URL */ }
  }
  return SOURCE_AUTHORITY.DEFAULT_UNKNOWN
}

/**
 * ② 内容完整性评分（0-100）——与 refreshNews 一致
 * content 为空时以 summary 兜底（官方 RSS 无正文本场景即走此路径）。
 */
function contentCompleteness(item) {
  let text = (item && item.content || '').trim()
  if (!text.length) text = (item && item.summary || '').trim()
  const len = text.length
  let score
  if (len >= 300) score = 90
  else if (len >= 80) score = 60
  else if (len > 0) score = 20
  else return 0
  const sentenceCount = (text.match(/[。！？.!?]/g) || []).length
  if (sentenceCount >= 2) score = Math.min(100, Math.round(score + 0.1 * (100 - score)))
  return Math.round(score)
}

/**
 * ③ 时效性评分（0-100）——与 refreshNews 一致
 * exp(-ageHours/48) × 100；无时间=50
 */
function timeliness(item) {
  const pub = (item && item.publishTime) || (item && item.pubDate) || 0
  if (!pub) return 50
  let ts
  if (typeof pub === 'number') ts = (pub > 1e12) ? pub : pub * 1000
  else if (typeof pub === 'string') ts = Date.parse(pub)
  else ts = 0
  if (!ts || isNaN(ts)) {
    if (typeof pub === 'number' && pub > 1e9 && pub < 1e12) ts = pub * 1000
    else return 50
  }
  const ageHours = Math.max(0, (Date.now() - ts) / 3600000)
  const clamped = Math.max(0, ageHours)
  return Math.round(Math.max(0, Math.min(100, Math.exp(-clamped / 48) * 100)))
}

/**
 * ④ 文本质量评分（0-100，基于噪音比）——与 refreshNews 一致
 * 官方 RSS 无 _rawContent → 按低噪音中性 70（content/summary 已清洗、渠道高质）。
 */
function textQuality(item) {
  const cleaned = (item && item.content || '').trim()
  if (!cleaned.length) return 0
  // 官方 RSS 无 raw 对照，采用中性低噪音口径
  item._noiseRatio = 0.05
  return 70
}

/**
 * ⑤ 去重唯一性评分——官方源在 newsStore 已按 urlFp/titleFp 精确去重，
 * 进入本评分函数的均为新增（批内唯一），恒为 100。
 */
function dedupScore() {
  return 100
}

/**
 * ⑥ 合规门禁（硬性）——与 refreshNews 一致
 * 命中敏感/版权红线 → 返回 reason；无命中 → null。
 */
function complianceGate(item) {
  const hay = `${item.title || ''} ${item.summary || ''} ${item.content || ''}`
  for (const kw of _COMPLIANCE_BLOCK_KEYWORDS) {
    if (typeof kw === 'string' && hay.includes(kw)) return `合规关键词命中: ${kw}`
    if (kw instanceof RegExp && kw.test(hay)) return `合规模式命中: ${kw}`
  }
  return null
}

/**
 * 来源级热度（HeatScore 的替代项，官方 single-source 静态分）
 * 官方/央媒源 → 20；权威主流 → 15；省级 → 12；聚合/第三方 → 8；未知 → 6
 * 用于 FinalScore 计算，避免官方源因无用户行为数据而热度恒 0。
 */
function sourceHeat(item) {
  const a = sourceAuthority(item)
  if (a >= 100) return 20
  if (a >= 85) return 15
  if (a >= 80) return 12
  if (a >= 60) return 8
  return 6
}

/**
 * 单条质量评分（含门控 ⑥）——与 refreshNews 的 score() 一致（无聚类上下文版）
 * @param {Object} item - { title, summary, content?, source, sourceUrl, pubDate }
 * @returns {{ score:number, passed:boolean, rejectReason?:string, source:number,
 *             complete:number, fresh:number, text:number, uniq:number, noiseRatio:number }}
 */
function score(item) {
  const compliance = complianceGate(item)
  if (compliance) {
    return { score: 0, passed: false, rejectReason: compliance, gated: 'compliance' }
  }

  const s = sourceAuthority(item)
  const c = contentCompleteness(item)
  const f = timeliness(item)
  const t = textQuality(item)
  const u = dedupScore()
  const noiseRatio = item._noiseRatio || 0
  delete item._noiseRatio

  const qScore = Math.round(
    W.source * s
    + W.complete * c
    + W.fresh * f
    + W.text * t
    + W.uniq * u
  )

  // 质量门（与 refreshNews 一致）
  let passed = true
  let rejectReason = null
  let gated = null
  if (qScore < GATE.minQuality) {
    passed = false; rejectReason = `质量分 ${qScore} < ${GATE.minQuality}`; gated = 'quality'
  } else if (noiseRatio > GATE.maxNoiseRatio) {
    passed = false; rejectReason = `噪音比 ${noiseRatio} > ${GATE.maxNoiseRatio}`; gated = 'noise'
  }

  return {
    score: qScore, passed, rejectReason, gated,
    source: s, complete: c, fresh: f, text: t, uniq: u, noiseRatio,
  }
}

/**
 * FinalScore = 0.6·QualityScore + 0.4·HeatScore（与 refreshNews 一致）
 */
function finalScore(qualityScore, hScore) {
  return Math.round(0.6 * qualityScore + 0.4 * hScore)
}

/**
 * 落库装配：对一条合法 item 做完整评分，附加落库字段。
 * @param {Object} item - 已通过 validator.validate 的 item（含 title/summary/url/pubDate/sourceId/sourceName/category）
 * @returns {Object} attach 到 item 的评分字段；passed=false 时含 rejectReason/gated
 */
function attachScore(item) {
  // 供 sourceAuthority 识别：官方源 sourceId 形如 xinhua/people/cctv/chinanews，
  // sourceName 为中文名（命中 100）。summary 作为 content 兜底由 contentCompleteness 处理。
  const scored = score({
    title: item.title,
    summary: item.summary,
    // 官方源无 content 全文，用 summary 填充 content，使 ②内容完整 与 ④文本质量 都能基于实际文本
    content: item.summary,
    source: item.sourceName || item.sourceId || '',
    sourceUrl: item.url || '',
    pubDate: item.pubDate || '',
    publishTime: item.pubDate || '',
  })

  const heat = sourceHeat({ source: item.sourceName || item.sourceId || '' })
  const fs = finalScore(scored.score, heat)

  item.qualityScore = scored.score
  item.qualityDetail = {
    source: scored.source, complete: scored.complete, fresh: scored.fresh,
    text: scored.text, uniq: scored.uniq, noiseRatio: scored.noiseRatio,
  }
  item.heatScore = heat
  item.finalScore = fs
  item.qualityPassed = scored.passed

  if (scored.passed) {
    item.status = 'active'
  } else {
    item.status = 'rejected'
    item.rejectReason = scored.rejectReason
    item.gated = scored.gated
  }
  return item
}

module.exports = {
  score,
  finalScore,
  sourceHeat,
  sourceAuthority,
  contentCompleteness,
  timeliness,
  textQuality,
  dedupScore,
  complianceGate,
  attachScore,
  SOURCE_AUTHORITY,
  GATE,
}
