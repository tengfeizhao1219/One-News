/**
 * 数据质量多维评分 + 热度融合模块（qualityScorer.js）
 * ============================================================
 * 依据：《FS-数据质量多维过滤方案-2026-08-11.md》（owner 已认可，FS 角色落地）
 *
 * 目标：refreshNews 写 news_cache 前，对每条候选新闻做 6 维质量评分 + 热度融合，
 *       产出 FinalScore 用于落库 + 排序；低质/超门控条目不进 news_cache。
 *
 *   QualityScore = 0.25·①来源权威 + 0.20·②内容完整 + 0.15·③时效 + 0.15·④文本质量 + 0.10·⑤去重唯一
 *   ⑥合规性 拆分为软/硬：硬黑名单命中直接弃；软信号(版权搬运/纯导流)保留检测、进入评分降权
 *   HeatScore    = (eventHeat + topicHeat + engagement) × decay    （归一化到 0-100）
 *   FinalScore   = 0.6 · QualityScore + 0.4 · HeatScore
 *
 *   质量门（Gate）：QualityScore < 40 或 噪音比 > 0.4 或 合规硬黑名单命中 → 不进 news_cache
 *
 * 接入时序（关键设计，见 refreshNews/index.js runCategoryPipeline）：
 *   在 enrichNewsList 之前对 secPassed（已通过校验+安全审核的本分类候选）调用 scoreAll，
 *   把 finalScore / eventId / qualityScore / heatScore / passed 异步字段 attach 到每条 item。
 *   - enrich 内部用 {...item} 展开，会自动保留这些字段；
 *   - batchInsert 的 onEnriched 单条写库与兜底整批写库，均能读到 finalScore/eventId；
 *   - 保证「边抓边单条写库」与「兜底整批写库」两条路径评分一致，零漏写。
 *
 * 幂等接入：若对已 attach 过评分的 item 再次 scoreAll，会用新值覆盖，不重复扰动。
 */

const { cleanNewsContent, validateCleanedContent } = require('./newsCleaner')
const { titleSimilarity } = require('../validator')
const { SENSITIVE_WORDS, matchSensitiveWord } = require('./sensitiveWords')

// ─── 评分权重（方案 §二）────
const W = {
  source: 0.25,   // ① 来源权威性
  complete: 0.20, // ② 内容完整性
  fresh: 0.15,    // ③ 时效性
  text: 0.15,     // ④ 文本质量（噪音比）
  uniq: 0.10,     // ⑤ 去重唯一性
}

// ─── 质量门阈值（方案 §四）────
const GATE = {
  minQuality: 40,    // QualityScore 低于此 → 弃
  maxNoiseRatio: 0.4 // 噪音比高于此 → 弃
}

// 软信号降权幅度（命中合规软信号仍进入评分，但压低质量分，不丢弃）
const COMPLIANCE_SOFT_PENALTY = 15

// ─── 来源权威性配置表（方案 §六）────
// 口径：官方/央媒=100；省级权威=80；权威媒体=85；聚合/三方=60；未知/UGC=40
// 匹配优先级：先精确中文名 → 再域名正则（sourceUrl）。中文名来自 validator.SOURCE_DOMAIN_MAP。
const SOURCE_AUTHORITY = {
  // 央媒/官方喉舌 = 100
  '新华社': 100, '人民日报': 100, '央视新闻': 100, '中新网': 100, '环球时报': 100,
  '新华网': 100, '人民网': 100, '央视网': 100, '中国新闻网': 100, '光明网': 100, '央广网': 100,
  // 权威主流媒体 = 85
  '澎湃新闻': 85, '路透社': 85, 'BBC': 85, '美联社': 85, '财新': 85, '第一财经': 85,
  '南方都市报': 85, '新京报': 85, '北京青年报': 85, '界面新闻': 85, '观察者网': 85, '中国青年报': 85,
  // 科技/财经垂类 = 80
  '36氪': 80, '虎嗅': 80, 'TechCrunch': 80, 'IT之家': 80, '极客公园': 80,
  '少数派': 80, '量子位': 80, '爱范儿': 80, 'Solidot': 80, '机器之心': 80,
  '腾讯科技': 80, '新浪科技': 80, '网易科技': 80, '凤凰科技': 80,
  // 省级/地方权威 = 80（域名特征匹配兜底）
  // 聚合/三方数据源 = 60（juhe/tianxing 返回的真实来源未命中以上时）
  DEFAULT_AGG: 60,
  DEFAULT_UNKNOWN: 40, // 未知 / UGC / 弱来源
}

// 域名 → 权威判定（sourceUrl 匹配）。返回 true 视为"省级权威+ = 80"
const _PROVINCIAL_DOMAINS = [
  /(daily|news|cn)$/i,      // *.news.cn / *.daily 各省报业
]
const _CENTRAL_DOMAINS = [
  /xinhuanet\.com$/i, /people\.com\.cn$/i, /cctv\.com$/i, /chinanews\.com(\.cn)?$/i,
  /huanqiu\.com$/i, /gmw\.cn$/i, /fnw\.cn$/i, /cnr\.cn$/i, /news\.cn$/i,
]

// 聚合/三方源常见中文名（命中 → 60）
const _AGG_SOURCE_NAMES = [
  '聚合', '聚合数据', '天行', '天行数据', '今日头条', '网易号', '搜狐号', '百家号',
  '一点资讯', 'ZAKER', '快资讯', 'AI', '智谱', '智能搜索', '搜索',
]

// 合规门禁信号（⑥），2026-08-14 owner 拍板拆分为软/硬两类：
//  - 软信号（版权搬运/纯导流弱信号）：保留检测，但不硬丢弃，进入下一环节评分（降权处理）。
//    弱信号新闻仍可能经 AI 后展示，仅降低其质量分、压低排序。
//  - 硬黑名单：命中即丢弃，不进评分、不进 news_cache。
//    硬黑名单 = 早先整理的「敏感词汇过滤表」（SENSITIVE_WORDS，PRD §4.4 五大类：涉黄/涉政/暴力/辱骂/广告spam），
//    与 feedback-create 共用同一权威源（common/sensitiveWords.js，本副本由 tools/sync-common.sh 同步生成，勿手改）。
//    版权搬运硬信号（全文转载/未经授权转载等）属软信号降权范畴，不在此硬弃。
// 与 securityCheck（NLP 级 msgSecCheck）互补：msgSecCheck 负责大语义违规（联网审核）；
// 本表负责可客观判定的敏感词硬拦截（本地秒级、无网络依赖、兜底）。
// 命中规则：字符串走 includes；正则去掉 ^...$ 锚定走 test() 部分匹配（hay = title/summary/content）。

// 软信号：保留检测、进入评分降权（不丢弃）
const COMPLIANCE_SOFT_SIGNALS = [
  // 版权搬运 / 机构稿整篇转载弱信号（规避「苏民终 588」类判例风险，但不硬弃）
  '全文转载', '未经授权转载', '授权转载请联系', '不得转载',
  /版权归.{1,20}(所有|版权所有)/, /本站（独家|原创）/,
  // 纯导流/无新闻实质
  '点击下方关注', '关注我们', '星标我们', '后台回复', '公众号内回复',
]

// 硬黑名单：命中即丢弃（敏感词汇过滤表 = SENSITIVE_WORDS，PRD §4.4 五大类）
const COMPLIANCE_HARD_BLACKLIST = SENSITIVE_WORDS

/**
 * 归一化标题（用于跨源事件聚类 + 指纹，降噪）
 */
function normalizeTitleForMatch(title) {
  return String(title || '')
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * ① 来源权威性评分（0-100）
 * @param {Object} item - { source, sourceUrl }
 */
function sourceAuthority(item) {
  // 主读 item.source（news_ingest 写入端已写），兜底读 item.sourceName（rssFetcher 旧版仅写 sourceName）
  const src = (item && (item.source || item.sourceName) || '').trim()
  if (!src) return SOURCE_AUTHORITY.DEFAULT_UNKNOWN

  // 聚合/三方来源 → 60
  if (_AGG_SOURCE_NAMES.some(n => src.includes(n))) return SOURCE_AUTHORITY.DEFAULT_AGG
  // 精确中文名命中
  if (SOURCE_AUTHORITY[src] != null) return SOURCE_AUTHORITY[src]

  // 域名兜底（sourceUrl）
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
 * ② 内容完整性评分（0-100）
 * 依据清洗后正文长度分档 + 完整句加成
 */
function contentCompleteness(item) {
  let text = (item && item.content || '').trim()
  // AI 源 item.summary 可能很完整，作为无正文时的辅助信号（当前摘要本身作为 content 缺失兜底）
  if (!text.length) text = (item && item.summary || '').trim()

  const len = text.length
  let score
  if (len >= 300) {
    score = 90
  } else if (len >= 80) {
    score = 60
  } else if (len > 0) {
    score = 20
  } else {
    return 0 // 完全无内容
  }
  // 含 ≥2 个完整句（句号/感叹号/问号）→ +0.1 加成
  const sentenceCount = (text.match(/[。！？.!?]/g) || []).length
  if (sentenceCount >= 2) score = Math.min(100, Math.round(score + 0.1 * (100 - score)))
  return Math.round(score)
}

/**
 * ③ 时效性评分（0-100）
 * exp(-ageHours/48) × 100；无时间=50
 */
function timeliness(item) {
  const pub = (item && item.publishTime) || (item && item.pubDate) || 0
  if (!pub) return 50
  let ts
  if (typeof pub === 'number') {
    ts = (pub > 1e12) ? pub : pub * 1000 // 秒 → 毫秒
  } else if (typeof pub === 'string') {
    ts = Date.parse(pub)
  } else {
    ts = 0
  }
  if (!ts || isNaN(ts)) {
    // 数值型（秒级）已是数字但语义是 seconds 时再试一次
    if (typeof pub === 'number' && pub > 1e9 && pub < 1e12) ts = pub * 1000
    else return 50
  }
  const ageHours = Math.max(0, (Date.now() - ts) / 3600000)
  // 未来时间（时钟偏差）按 0 小时处理
  const clamped = Math.max(0, ageHours)
  const score = Math.exp(-clamped / 48) * 100
  return Math.round(Math.max(0, Math.min(100, score)))
}

/**
 * ④ 文本质量评分（0-100，基于噪音比）
 * 噪音比 = 1 − 清洗后/清洗前；比值越低分越高；> 0.4 由门控直接弃
 * 清洗前 = raw（item._rawContent 若存在），清洗后 = 目前 content
 * 无 raw 可对比时：content 非空 → 中性 70（AI 源已清洗良好），content 空 → 0
 */
function textQuality(item) {
  const cleaned = (item && item.content || '').trim()
  if (!cleaned.length) return 0
  const raw = (item && item._rawContent || '').trim()

  let noiseRatio
  if (raw && raw.length > 0) {
    // 有清洗前后对比：噪音比 = 1 − 清洗后长/清洗前长
    noiseRatio = 1 - (cleaned.length / raw.length)
    // 兜底：若清洗后反而更长（异常），按 0 噪音（不惩罚）
    noiseRatio = Math.max(0, Math.min(1, noiseRatio))
  } else {
    // 无 raw：假设已清洗良好，按低噪音中性处理（AI 源 content 自带全景）
    noiseRatio = 0.05
  }

  // 噪音比 → 分：线性 1.0(0分)→0(=100分)
  const score = 100 * (1 - noiseRatio)
  // 记录噪音比供门控使用
  item._noiseRatio = Math.round(noiseRatio * 100) / 100
  return Math.round(Math.max(0, Math.min(100, score)))
}

/**
 * ⑤ 去重唯一性评分（0-100）
 * 本批内首次出现=100；库内已存在=0（只更新不新增）
 * 批内重复由 scoreAll 提前循环设置 _dupInBatch（基于 normalizeTitleForMatch 归一化）；
 * 单独调用时退化为直接比对 ctx.seenTitles/seenUrls（调用方须自行归一化 key）。
 */
function dedupScore(item, ctx = {}) {
  // 库内重复（外部查询 news_cache 设定 item._dupInDb）
  if (item._dupInDb === true) return 0
  // 批内重复（scoreAll 已写入 _dupInBatch）
  if (item._dupInBatch === true) return 0
  // 退化路径：单独调用且 ctx.seenTitles/seenUrls 已归一化时按 Set 查
  const seenT = ctx.seenTitles
  const seenU = ctx.seenUrls
  if (seenT && typeof seenT.has === 'function' && seenT.has(_titleKey(item.title))) return 0
  if (seenU && typeof seenU.has === 'function' && seenU.has(_urlKey(item.sourceUrl))) return 0
  return 100
}

function _titleKey(t) { return normalizeTitleForMatch(t) || '\u0000' }
function _urlKey(u) { return String(u || '').replace(/^https?:\/\//i, '').replace(/[?#].*$/, '').trim() }
// 兼容不同指纹函数签名
function _fingerprintOf(v, map) {
  if (typeof map === 'function') return map(v)
  if (map && typeof map.get === 'function') return map.get(v)
  return null
}

/**
 * ⑥ 合规门禁（硬性）
 * 硬黑名单（敏感词表 SENSITIVE_WORDS）命中 → 返回 { hard }（不走评分）。
 * 软信号（版权搬运/纯导流）命中 → 返回 { soft }（进入评分降权，不丢弃）。
 * 无命中返回 null。
 */
function urlYearHardKill(item) {
  const s = String((item && (item.sourceUrl || item.url)) || '')
  let m = s.match(/\/((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:\/|$|[.?#])/)
  if (!m) m = s.match(/\/((?:19|20)\d{2})[/\-](0?[1-9]|1[0-2])[/\-](0?[1-9]|[12]\d|3[01])(?:\/|$|[.?#])/)
  if (!m) return null
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3])
  if (!Number.isFinite(t)) return null
  if (Date.now() - t > 48 * 3600 * 1000) return { hard: `URL 路径日期超 48h: ${m[1]}${m[2]}${m[3]}` }
  return null
}

function complianceGate(item) {
  const yearHit = urlYearHardKill(item)
  if (yearHit) return yearHit
  const hay = `${item.title || ''} ${item.summary || ''} ${item.content || ''}`
  // 硬黑名单优先：命中即弃
  for (const kw of COMPLIANCE_HARD_BLACKLIST) {
    if (typeof kw === 'string' && hay.includes(kw)) return { hard: `合规黑名单命中: ${kw}` }
    if (kw instanceof RegExp && kw.test(hay)) return { hard: `合规黑名单模式命中: ${kw}` }
  }
  // 软信号：保留检测、进入评分降权，不丢弃
  for (const kw of COMPLIANCE_SOFT_SIGNALS) {
    if (typeof kw === 'string' && hay.includes(kw)) return { soft: `合规软信号命中: ${kw}` }
    if (kw instanceof RegExp && kw.test(hay)) return { soft: `合规软信号模式命中: ${kw}` }
  }
  return null
}

/**
 * 单条质量评分（含门控 ⑥），产出质量分与门控判定
 * @param {Object} item
 * @param {Object} ctx - 共享上下文（标题/URL 指纹、批内去重集合）
 * @returns {{ score:number, passed:boolean, rejectReason?:string, source:number, complete:number, fresh:number, text:number, uniq:number, noiseRatio:number }}
 */
function score(item, ctx = {}) {
  // 合规门禁：硬黑名单命中 → 直接弃（不走评分）；软信号命中 → 记录并降权，仍进入评分
  const compliance = complianceGate(item)
  if (compliance && compliance.hard) {
    return { score: 0, passed: false, rejectReason: compliance.hard, gated: 'compliance' }
  }
  const softPenalty = (compliance && compliance.soft) ? COMPLIANCE_SOFT_PENALTY : 0
  if (compliance && compliance.soft) item._softCompliance = compliance.soft

  const s = sourceAuthority(item)
  const c = contentCompleteness(item)
  const f = timeliness(item)
  const t = textQuality(item)
  const u = dedupScore(item, ctx)
  const noiseRatio = item._noiseRatio || 0

  let score = Math.round(
    W.source * s
    + W.complete * c
    + W.fresh * f
    + W.text * t
    + W.uniq * u
  )
  // 软信号降权（进入评分但压低质量分，不丢弃）
  if (softPenalty) score = Math.max(0, score - softPenalty)

  // 质量门（方案 §四）
  let passed = true
  let rejectReason = null
  let gated = null
  if (score < GATE.minQuality) {
    passed = false; rejectReason = `质量分 ${score} < ${GATE.minQuality}`; gated = 'quality'
  } else if (noiseRatio > GATE.maxNoiseRatio) {
    passed = false; rejectReason = `噪音比 ${noiseRatio} > ${GATE.maxNoiseRatio}`; gated = 'noise'
  }

  // 清理临场噪声字段（避免污染落库结构）
  delete item._noiseRatio

  return { score, passed, rejectReason, gated, source: s, complete: c, fresh: f, text: t, uniq: u, noiseRatio }
}

/**
 * 跨源事件聚类 → 计算 eventHeat / topicHeat / engagement / HeatScore
 * 在同一分类本批 item 上运行：用标题归一化近似匹配归并 eventId。
 * @param {Array<Object>} items
 * @param {Object} [ctx] - { engagementMap } 由外部查询 favorites/browse 得到
 * @returns {Map<string, {eventHeat:number, sources:Set<string>, memberIds:string[]}>}
 */
function clusterEvent(items, ctx = {}) {
  const clusters = [] // { title, sources:Set, members:[] }
  const eventById = new Map()

  for (const item of items) {
    const norm = normalizeTitleForMatch(item.title)
    if (!norm) { item.eventHeat = 10; continue }

    let target = null
    for (const cl of clusters) {
      // 精确匹配优先；否则 Jaccard > 0.55 视为同事件
      if (cl.norm === norm || titleSimilarity(cl.norm, norm) > 0.55) {
        target = cl
        break
      }
    }
    if (!target) {
      target = { norm, sources: new Set(), members: [], title: item.title }
      clusters.push(target)
    }
    target.members.push(item.id || item.title)
    target.sources.add((item.source || '').trim())

    // 立即写入该条目的 eventHeat（同一事件每多一个不同来源 +10；本簇成员计数）
    item._eventKey = target.norm
  }

  // 回填 eventId + eventHeat
  for (const cl of clusters) {
    const distinctSources = cl.sources.size
    // eventHeat = 覆盖的不同来源数 × 10 + 各源抓取次数（本批成员数）
    const eventHeat = distinctSources * 10 + Math.min(10, cl.members.length)
    cl.eventHeat = eventHeat
    cl.eventId = _makeEventId(cl.norm)
    for (const memberId of cl.members) {
      const m = items.find(it => (it.id || it.title) === memberId)
      if (m) {
        m.eventId = cl.eventId
        m.eventHeat = eventHeat
        m._sourceCount = distinctSources
      }
    }
  }

  return clusters
}

/**
 * 由归一化标题生成稳定的 eventId（短哈希前缀）
 */
function _makeEventId(norm) {
  if (!norm) return 'evt_none'
  let h = 0
  for (let i = 0; i < norm.length; i++) h = ((h << 5) - h + norm.charCodeAt(i)) | 0
  return 'evt_' + (h >>> 0).toString(36)
}

/**
 * 话题热度（轻量：按 category 静态基线 + 近似事件经验值）。
 * 完整话题聚类需跨分类统计事件数；此处用同一事件的事件热度作为话题代理，
 * 避免引入额外 DB 扫描，符合「站内可得信号」原则。
 */
function topicHeat(item) {
  // category 基线：头条相关话题天然更高
  const base = { recommend: 15, tech: 10, science: 10, international: 10, life: 5 }[item.category]
    || 8
  // 聚合到同 eventId 的事件在此处通过 _sourceCount 补强
  const sourceBoost = (item._sourceCount || 1) >= 2 ? 10 : 0
  const heat = base + sourceBoost
  delete item._sourceCount
  return heat
}

/**
 * 参与信号（用户行为热度）
 * engagement = 收藏数×3 + 浏览数。由 ctx.engagementMap（id→{fav,browse}）提供。
 */
function engagement(item, ctx = {}) {
  const e = (ctx.engagementMap && ctx.engagementMap.get && ctx.engagementMap.get(item.id)) || null
  if (!e) return 0
  return (e.fav || 0) * 3 + (e.browse || 0)
}

/**
 * 热度总分 → 归一化 0-100
 * HeatScore = (eventHeat + topicHeat + engagement) × decay
 * 归一化：本批最大 eventHeat 作为基准，避免单一高热事件挤压其他正常条目。
 *   阈值设计：单事件基准 30（3源）→ 归一化 ×0.6；多源高热事件 ×0.9 仍能胜出但不碾压。
 */
function heatScore(item, ctx = {}) {
  const eHeat = item.eventHeat || 10
  const tHeat = topicHeat(item)
  const eng = engagement(item, ctx)
  // 时间衰减：exp(-ageHours/24)，24h 半衰
  const ageHours = Math.max(0, (Date.now() - _publishTs(item)) / 3600000)
  const decay = Math.exp(-ageHours / 24)
  const raw = (eHeat + tHeat + eng) * decay
  return Math.round(Math.max(0, Math.min(100, raw)))
}

function _publishTs(item) {
  const pub = (item && item.publishTime) || (item && item.pubDate) || 0
  if (!pub) return Date.now()
  if (typeof pub === 'number') return pub > 1e12 ? pub : pub * 1000
  if (typeof pub === 'string') { const t = Date.parse(pub); return isNaN(t) ? Date.now() : t }
  return Date.now()
}

/**
 * FinalScore = 0.6·QualityScore + 0.4·HeatScore
 */
function finalScore(qualityScore, hScore) {
  return Math.round(0.6 * qualityScore + 0.4 * hScore)
}

/**
 * 批量评分入口（refreshNews 接入点核心）
 * 对 items 批量：先 clusterEvent 聚类热度 → 逐条 quality score + heat → FinalScore → 门控。
 * 通过门控的条目 attach { finalScore, qualityScore, heatScore, eventId, passed:true }；
 * 未通过门控 attach { passed:false, rejectReason }（调用方可决定丢弃）。
 *
 * @param {Array<Object>} items
 * @param {Object} [options] - { engagementMap:Map, titleFp, urlFp }
 * @returns {{ passed:Array, rejected:Array, stats:Object }}
 */
function scoreAll(items, options = {}) {
  const ctx = {
    engagementMap: options.engagementMap || null,
    titleFp: options.titleFp || null,
    urlFp: options.urlFp || null,
    seenTitles: options.seenTitles || null,
    seenUrls: options.seenUrls || null,
  }

  // 批内去重集合（⑤：本批内首次出现=100）
  const seenTitles = new Set()
  const seenUrls = new Set()
  ctx.seenTitles = seenTitles
  ctx.seenUrls = seenUrls
  // 避免修改调用方传入的 options 对象
  for (const it of items) {
    const tk = _titleKey(it.title)
    if (seenTitles.has(tk)) it._dupInBatch = true
    seenTitles.add(tk)
    const uk = _urlKey(it.sourceUrl)
    if (seenUrls.has(uk)) it._dupInBatch = true
    seenUrls.add(uk)
  }

  // 跨源事件聚类（热度）
  clusterEvent(items, ctx)

  const passed = []
  const rejected = []
  let gatedStats = { quality: 0, noise: 0, compliance: 0, dup: 0 }

  for (const item of items) {
    // 批内重复（⑤）→ 本批只保留首条，后续标记 0 去重分但不强制丢（由质量门综合裁决）
    const q = score(item, ctx)
    const h = heatScore(item, ctx)
    const fs = finalScore(q.score, h)

    item.qualityScore = q.score
    item.heatScore = h
    item.finalScore = fs
    item.eventId = item.eventId || _makeEventId(normalizeTitleForMatch(item.title))

    if (!q.passed) {
      rejected.push({ item: item.title?.substring(0, 30), reason: q.rejectReason, gated: q.gated })
      item.passed = false
      item.rejectReason = q.rejectReason
      if (q.gated === 'compliance') gatedStats.compliance++
      else if (q.gated === 'noise') gatedStats.noise++
      else gatedStats.quality++
      continue
    }
    // 批内重复：标记但允许进 pipeline（由 finalScore/去重分自然压制），统计用
    if (item._dupInBatch) gatedStats.dup++

    item.passed = true
    delete item._dupInBatch
    delete item._eventKey
    passed.push(item)
  }

  return {
    passed,
    rejected,
    stats: {
      total: items.length,
      passed: passed.length,
      rejected: rejected.length,
      gated: gatedStats,
    },
  }
}

module.exports = {
  score,
  scoreAll,
  sourceAuthority,
  contentCompleteness,
  timeliness,
  textQuality,
  dedupScore,
  complianceGate,
  clusterEvent,
  topicHeat,
  engagement,
  heatScore,
  finalScore,
  normalizeTitleForMatch,
  SOURCE_AUTHORITY,
  GATE,
  _makeEventId,
}
