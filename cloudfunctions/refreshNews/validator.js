/**
 * 新闻质量校验模块
 *
 * 对大模型返回的新闻数据进行多层校验：
 *   1. 字段完整性
 *   2. 来源白名单
 *   3. 标题去重
 *   4. 时间合理性
 *   5. 内容质量（长度、敏感词等）
 *   6. sourceUrl 格式校验（L1：正则 + 占位符检测）
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
const MIN_SUMMARY_LENGTH = 10
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

  // 3. 来源白名单（v5.0 改造：天行/聚合等第三方 API 返回真实来源，不再严格限制白名单）
  //    仅做基本检查：来源不能为空、不能是占位符、不能是广告推广
  const source = item.source.trim()
  if (!source || source.length < 2) {
    return { valid: false, reason: '来源为空或太短' }
  }
  // 排除明显的占位符/推广来源
  // 2026-08-07 上线前审查：补 `^未知来源$`（"未知"与"未知来源"均为占位符性质，宽松模式也应收敛）
  const invalidSourcePatterns = [
    /^来源$/, /^未知$/, /^未知来源$/, /^Unknown$/i, /^未命名$/,
    /广告/, /推广/, /Sponsored/i,
  ]
  for (const pattern of invalidSourcePatterns) {
    if (pattern.test(source)) {
      return { valid: false, reason: `来源无效: ${source}` }
    }
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

  // 6. sourceUrl 格式校验（L1）
  //    只做零成本的格式/语义检测，不做网络可达性（L2 可选）
  if (item.sourceUrl) {
    const urlResult = validateSourceUrl(item.sourceUrl, item.source)
    if (!urlResult.valid) {
      // 不拒绝整条新闻，只清空无效 sourceUrl
      item.sourceUrl = ''
      item._urlRejected = urlResult.reason
    }
  }

  return { valid: true }
}

/**
 * L1 URL 格式校验
 *
 * 因为百炼 DeepSeek 返回的 sourceUrl 是模型生成的（非 API 原生），
 * 必须检查是否存在幻觉（占位符、模板 URL、与来源不匹配等）。
 *
 * @param {string} url       - 模型返回的 URL
 * @param {string} source    - 来源中文名（如"新华社"），用于域名一致性检查
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateSourceUrl(url, source) {
  if (!url || typeof url !== 'string') {
    return { valid: false, reason: 'URL 为空' }
  }

  const u = url.trim()

  // 1. 协议检查
  if (!/^https?:\/\//i.test(u)) {
    return { valid: false, reason: `URL 不含 http(s) 协议: ${u.substring(0, 60)}` }
  }

  // 2. 占位符/模板 URL 检测（模型幻觉高频模式）
  //
  //  关键设计：36氪(/p/)、虎嗅(/article/)、澎湃(newsDetail) 等媒体
  //  的 URL 路径天然就是数字 ID，不能靠数字长度来判断。
  //  因此只检测"数字序列有显著规律"的占位符（如 1234567890、9876543210、
  //  11111111 等），而不对合法媒体的数字路径做一刀切。
  const placeholderPatterns = [
    /1234567890/,                          // 递增序列占位（10位）
    /9876543210/,                          // 递减序列占位（10位）
    /\b9876543\b/,                         // 递减序列占位（7位，仅独立数字词边界）
    /\b1234567\b/,                         // 递增序列占位（7位，仅独立数字词边界）
    /example\.com/i,                       // example.com 占位域名
    /localhost/i,                          // localhost
    /placeholder/i,                        // 含 "placeholder" 字样
    /your[-_]?domain/i,                    // "yourdomain.com" 模板
    /example\.(com|org|net)/i,             // 各种 example 域名
    /^https?:\/\/[^/]+\/\d{1,4}$/,         // 域名后仅有 1-4 位数字，无路径（如 /1234）
  ]

  for (const pattern of placeholderPatterns) {
    if (pattern.test(u)) {
      return { valid: false, reason: `疑似占位符/模板 URL: ${u.substring(0, 80)}` }
    }
  }

  // 3. 域名提取与来源一致性检查（宽松模式：仅警告，不拒绝）
  try {
    const hostname = new URL(u).hostname.replace(/^www\./, '').toLowerCase()

    // 来源中文名 → 预期域名映射
    const SOURCE_DOMAIN_EXPECT = {
      '新华社':     ['xinhuanet.com'],
      '人民日报':   ['people.com.cn'],
      '央视新闻':   ['cctv.com', 'cctv.cn'],
      '中新网':     ['chinanews.com'],
      '澎湃新闻':   ['thepaper.cn'],
      '36氪':       ['36kr.com'],
      '虎嗅':       ['huxiu.com'],
      '环球时报':   ['huanqiu.com'],
      '路透社':     ['reuters.com'],
      'BBC':        ['bbc.com', 'bbc.co.uk'],
      '美联社':     ['apnews.com'],
      'TechCrunch': ['techcrunch.com'],
    }

    const expectedDomains = SOURCE_DOMAIN_EXPECT[source]
    if (expectedDomains) {
      const matchesSource = expectedDomains.some(d => hostname === d || hostname.endsWith('.' + d))
      if (!matchesSource) {
        // 域名与来源不一致——大概率是模型把 URL 安错了新闻
        return { valid: false, reason: `URL 域名(${hostname})与来源(${source})不匹配` }
      }
    }
  } catch (_) {
    // URL 解析失败（语法错误）
    return { valid: false, reason: `URL 解析失败: ${u.substring(0, 60)}` }
  }

  // 4. 极端短域名（如 "t.cn"）——可能是模型截断或编造
  const hostname = new URL(u).hostname.replace(/^www\./, '').toLowerCase()
  const dotCount = (hostname.match(/\./g) || []).length
  if (dotCount < 1 || hostname.length < 6) {
    return { valid: false, reason: `URL 域名过短/异常: ${hostname}` }
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
  validateSourceUrl,
  deduplicateByTitle,
  VALID_SOURCES,
}
