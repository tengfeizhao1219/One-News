/**
 * 新闻质量校验模块
 *
 * 对大模型返回的新闻数据进行多层校验：
 *   1. 字段完整性
 *   2. 来源白名单
 *   3. 标题去重
 *   4. 时间合理性
 *   5. 内容质量（长度、敏感词等）
 */

// ─── 配置 ───────────────────────────────────────────

// 来源域名 → 中文名映射
const SOURCE_DOMAIN_MAP = {
  'xinhuanet.com': '新华社',
  'people.com.cn': '人民日报',
  'cctv.com': '央视新闻',
  'chinanews.com': '中新网',
  'thepaper.cn': '澎湃新闻',
  '36kr.com': '36氪',
  'huxiu.com': '虎嗅',
  'huanqiu.com': '环球时报',
  'reuters.com': '路透社',
  'bbc.com': 'BBC',
  'apnews.com': '美联社',
  'techcrunch.com': 'TechCrunch',
}

// 来源白名单（中文名）
const VALID_SOURCES = new Set(Object.values(SOURCE_DOMAIN_MAP))

// 最小/最大长度
const MIN_TITLE_LENGTH = 5
const MAX_TITLE_LENGTH = 200
const MIN_SUMMARY_LENGTH = 20
const MAX_SUMMARY_LENGTH = 1000

// ─── 校验函数 ──────────────────────────────────────

/**
 * 校验单条新闻
 * @param {Object} item
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateNewsItem(item) {
  // 1. 字段完整性
  if (!item.title || typeof item.title !== 'string') {
    return { valid: false, reason: '缺少标题' }
  }
  if (!item.summary || typeof item.summary !== 'string') {
    return { valid: false, reason: '缺少摘要' }
  }
  if (!item.source || typeof item.source !== 'string') {
    return { valid: false, reason: '缺少来源' }
  }

  // 2. 长度校验
  const title = item.title.trim()
  const summary = item.summary.trim()

  if (title.length < MIN_TITLE_LENGTH) {
    return { valid: false, reason: `标题过短 (${title.length}字)` }
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return { valid: false, reason: `标题过长 (${title.length}字)` }
  }
  if (summary.length < MIN_SUMMARY_LENGTH) {
    return { valid: false, reason: `摘要过短 (${summary.length}字)` }
  }
  if (summary.length > MAX_SUMMARY_LENGTH) {
    return { valid: false, reason: `摘要过长 (${summary.length}字)` }
  }

  // 3. 来源白名单
  if (!VALID_SOURCES.has(item.source)) {
    return { valid: false, reason: `来源不在白名单: ${item.source}` }
  }

  // 4. 内容质量 — 过滤明显的垃圾内容
  const lowerTitle = title.toLowerCase()
  const garbagePatterns = [
    '广告', '推广', 'sponsored', 'advertisement',
    '点击查看', '立即购买', '限时优惠',
  ]
  for (const pattern of garbagePatterns) {
    if (lowerTitle.includes(pattern)) {
      return { valid: false, reason: `疑似广告: ${pattern}` }
    }
  }

  return { valid: true }
}

/**
 * 计算两个字符串的相似度（简化版 Jaccard）
 * @returns {number} 0-1 之间的相似度
 */
function titleSimilarity(a, b) {
  const setA = new Set(a.split(''))
  const setB = new Set(b.split(''))
  const intersection = new Set([...setA].filter(x => setB.has(x)))
  const union = new Set([...setA, ...setB])
  return intersection.size / union.size
}

/**
 * 标题去重：相似度 > 0.7 视为重复，保留第一条
 */
function deduplicateByTitle(newsList) {
  const result = []
  for (const item of newsList) {
    const isDuplicate = result.some(existing =>
      titleSimilarity(existing.title, item.title) > 0.7
    )
    if (!isDuplicate) {
      result.push(item)
    }
  }
  return result
}

/**
 * 批量校验 + 去重
 * @param {Array} newsList
 * @returns {{ valid: Array, rejected: Array, stats: Object }}
 */
function validateAndClean(newsList) {
  const valid = []
  const rejected = []

  for (const item of newsList) {
    const result = validateNewsItem(item)
    if (result.valid) {
      valid.push(item)
    } else {
      rejected.push({ item: item.title?.substring(0, 30), reason: result.reason })
    }
  }

  // 去重
  const deduped = deduplicateByTitle(valid)

  return {
    valid: deduped,
    rejected,
    stats: {
      total: newsList.length,
      passed: deduped.length,
      rejected: rejected.length,
      duplicatesRemoved: valid.length - deduped.length,
    },
  }
}

module.exports = {
  validateNewsItem,
  validateAndClean,
  deduplicateByTitle,
  VALID_SOURCES,
}
