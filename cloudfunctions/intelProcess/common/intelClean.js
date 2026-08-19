// intelClean.js — intel 链路数据质量清洗与闸门（T3.x / P）
// ============================================================
// 职责：在「raw(intel_ingest) → 处理层(intelProcess)」之间做一层
//   数据加工清理，只有满足质量条件的条目才允许进入下一环。纯函数、
//   无副作用、无外部依赖（不依赖 DOM / he 库），便于单测与复用。
//
// 覆盖四类脏数据根因（2026-08-19 诊断 intel_ingest 1435 条）：
//   1. HTML 实体未解码：title/content 残留 &#8217;（=’）等 → decodeHtmlEntities
//   2. 乱码/控制字符：U+FFFD ��、不可见控制符 → stripControls
//   3. 空壳正文：HN content 全空、PH 只有 tagline+锚文本 → isMeaningfulContent
//   4. 陈旧内容：多个月前的旧文混进「今日日报」→ withinFreshness
//   另含去重辅助 normalizeKey（配合 ingest 唯一索引幂等）。
//
// 用法（intelProcess.processOne 内，router.score 之后、intelChat 之前）：
//   const { qualify } = require('../common/intelClean')
//   const q = qualify(item, { freshnessDays: 7, minContent: 60, mode: 'strict' })
//   if (!q.pass) { /* 丢弃留痕 */ ; return ... }
//   item = q.clean   // 用清洗后的条目继续（title/content/summary 已解码去乱码）
// ============================================================

'use strict'

// ─── 常量与默认阈值（按 2026-08-19 实测数据校准）───
const MIN_CONTENT_DEFAULT = 60      // 有效正文最小字符数（低于判定空壳）
const FRESHNESS_DAYS_DEFAULT = 7    // 新鲜度窗口（天），超出旧文不加工
const MAX_INPUT = 4000              // 清洗后单条正文送入 LLM 的最大长度
const NAV_NOISE = [                 // 源站 RSS 尾部的通用装饰文本（不计入有效正文）
  'read the full story at', 'read the full article at', 'discussion',
  '| link', 'image:', 'sign up', 'subscribe', 'opt in', 'source:', 'tags:',
]

/**
 * 解码常见 HTML 实体（含十进制/十六进制数字实体），不依赖 DOM。
 * 覆盖 RSS/WordPress 常见：&#8217; &#8216; &#8220; &#8221; &auml; &copy; 等。
 * @param {string} s
 * @returns {string}
 */
function decodeHtmlEntities(s) {
  if (!s || typeof s !== 'string') return String(s || '')
  // 十进制/十六进制数字实体一次解
  let out = s.replace(/&#(\d+);/g, (m, d) => {
    const cp = parseInt(d, 10)
    try { return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '' } catch (e) { return '' }
  }).replace(/&#x([0-9a-fA-F]+);/g, (m, h) => {
    const cp = parseInt(h, 16)
    try { return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '' } catch (e) { return '' }
  })
  // 常用命名实体（大小写常见变体一并覆盖）
  const NAMED = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
    '&nbsp;': ' ', '&hellip;': '…', '&mdash;': '—', '&ndash;': '–', '&rsquo;': '’',
    '&lsquo;': '‘', '&rdquo;': '”', '&ldquo;': '“', '&copy;': '©', '&reg;': '®',
    '&trade;': '™', '&middot;': '·', '&bull;': '•', '&eacute;': 'é', '&egrave;': 'è',
    '&agrave;': 'à', '&ccedil;': 'ç', '&uuml;': 'ü', '&ouml;': 'ö', '&auml;': 'ä',
    '&szlig;': 'ß', '&times;': '×', '&divide;': '÷', '&pound;': '£', '&euro;': '€',
  }
  for (const k of Object.keys(NAMED)) {
    out = out.split(k).join(NAMED[k])
  }
  return out
}

/**
 * 清除乱码与不可见控制字符：
 *  - U+FFFD（替换字符，常为 emoji 截断产物 ��）
 *  - C0/C1 控制字符（\x00-\x1f、\x7f-\x9f，保留 \n\t\r）
 *  - 零宽符（BOM、零宽空格等）
 * @param {string} s
 * @returns {string}
 */
function stripControls(s) {
  if (!s || typeof s !== 'string') return String(s || '')
  return s
    .replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f\ufffd\ufeff\u200b\u200c\u200d]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')   // 孤立高代理
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')   // 孤立低代理
    .trim()
}

/**
 * 折叠多余空白：多个空格/换行 → 单空格，首尾去空白。
 * @param {string} s
 * @returns {string}
 */
function collapseSpace(s) {
  if (!s || typeof s !== 'string') return String(s || '')
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * 对单条 ingest 做统一文本清洗：title / content / summary 逐个解码+去乱码+折叠空白。
 * 返回清洗后的副本（不就地改原对象）。
 * @param {Object} item
 * @returns {Object} cleaned 副本
 */
function cleanText(item) {
  const c = Object.assign({}, item)
  for (const k of ['title', 'content', 'summary']) {
    if (typeof c[k] === 'string') {
      c[k] = collapseSpace(stripControls(decodeHtmlEntities(c[k])))
    }
  }
  return c
}

/**
 * 计算「有效正文」长度：剔除源站 RSS 尾部装饰文本（NAV_NOISE）后的实际长度。
 * 用于空壳判定，避免「只有一句 tagline + 锚文本」被当成有内容。
 * @param {Object} item 已清洗条目
 * @returns {number} 有效字符数
 */
function meaningfulLength(item) {
  const content = String(item.content || '').toLowerCase()
  const title = String(item.title || '').toLowerCase()
  let body = content
  // 逐条剔除噪声尾巴（贪心，越靠前优先级越高）
  for (const n of NAV_NOISE) {
    const i = body.indexOf(n)
    if (i >= 0) body = body.slice(0, i)
  }
  // 若正文几乎等于标题（内容仅重复标题），视为无新增信息。
  // 用 Unicode 属性正则只保留字母/数字（去空白+标点+装饰符），避免字符类范围坑。
  const dedup = body.replace(/[^\p{L}\p{N}]/gu, '')
  const titleDedup = title.replace(/[^\p{L}\p{N}]/gu, '')
  if (dedup && titleDedup && dedup === titleDedup) return 0
  return dedup.length
}

/**
 * 空壳判定：有效正文是否低于阈值。
 * @param {Object} item 已清洗条目
 * @param {number} [min] 有效正文最少字符数，默认 MIN_CONTENT_DEFAULT
 * @returns {boolean} true=合格（有实质内容）
 */
function isMeaningfulContent(item, min) {
  const threshold = (typeof min === 'number' && min >= 0) ? min : MIN_CONTENT_DEFAULT
  return meaningfulLength(item) >= threshold
}

/**
 * 新鲜度窗口校验：是否在 N 天内。
 * 优先用 publishedAt，缺失/解析失败时回退 fetchedAt；两端都失败判为过期（不给通过）。
 * @param {Object} item
 * @param {number} [days] 窗口天数，默认 FRESHNESS_DAYS_DEFAULT
 * @param {Date} [now] 基准时间（测试可注入）
 * @returns {boolean}
 */
function withinFreshness(item, days, now) {
  const win = (typeof days === 'number' && days > 0) ? days : FRESHNESS_DAYS_DEFAULT
  const base = now || new Date()
  const baseMs = base instanceof Date ? base.getTime() : Number(base)
  const t = parseStamp(item.publishedAt) || parseStamp(item.fetchedAt)
  if (!t) return false
  const epoch = t instanceof Date ? t.getTime() : t
  const ageMs = baseMs - epoch
  return ageMs >= 0 && ageMs <= win * 24 * 3600 * 1000
}

/**
 * 解析时间戳：兼容 ISO8601 与 RFC2822（如 "Wed, 13 Jan 2026 13:00:00 GMT"）及
 * 带 ±HH:MM 偏移的 ISO。失败返回 null。
 * @param {*} v
 * @returns {number|null} epoch ms
 */
function parseStamp(v) {
  if (v == null || v === '') return null
  const s = String(v).trim()
  const ms = Date.parse(s)
  // 处理 "2026-08-18T05:00:01-04:00" 这类带区偏移 ISO（Date.parse 部分引擎可解）
  if (!Number.isNaN(ms)) return ms
  // RFC2822 若无时区，补 GMT
  const rfc = /^[A-Za-z]{3},\s*\d{1,2}\s+[A-Za-z]{3}\s+\d{4}/.test(s)
  if (rfc) {
    const m2 = Date.parse(s + ' GMT')
    if (!Number.isNaN(m2)) return m2
  }
  return null
}

/**
 * 主闸门入口：综合 content 清洗 + 空壳判定 + 新鲜度 + 去重键。
 * 纯函数，输入原始 ingest 条目，返回判定结果与清洗后的安全副本。
 *
 * @param {Object} item 原始 intel_ingest 条目
 * @param {Object} [cfg]
 * @param {number} [cfg.minContent] 有效正文最少字符数（空壳阈值）
 * @param {number} [cfg.freshnessDays] 新鲜度窗口天数；<=0 表示跳过时效校验
 * @param {string} [cfg.mode] 'strict'（空壳/过期都拒）| 'lenient'（只清洗不强拦，供汇总/归档）
 * @param {Date} [cfg.now] 基准时间（测试注入）
 * @returns {{pass:boolean, reasons:string[], clean:Object}}
 */
function qualify(item, cfg) {
  const c = Object.assign({}, cfg || {})
  const mode = c.mode || 'strict'
  const reasons = []
  const clean = cleanText(item)

  // ① 空壳判定（strict 模式强拦）
  const len = meaningfulLength(clean)
  const minContent = (typeof c.minContent === 'number' && c.minContent >= 0) ? c.minContent : MIN_CONTENT_DEFAULT
  if (mode === 'strict' && len < minContent) {
    reasons.push(`content-too-short(${len}<${minContent})`)
  }

  // ② 新鲜度校验（strict + 未显式跳过时强拦）
  const skipFresh = typeof c.freshnessDays === 'number' ? c.freshnessDays <= 0 : false
  if (mode === 'strict' && !skipFresh) {
    const days = (typeof c.freshnessDays === 'number' && c.freshnessDays > 0) ? c.freshnessDays : FRESHNESS_DAYS_DEFAULT
    if (!withinFreshness(clean, days, c.now)) {
      reasons.push(`stale(>${days}d)`)
    }
  }

  // ③ 原始条目连最小信息都没有（无标题无正文无链接）→ 直接拒
  if (!clean.title && !clean.content && !clean.summary) {
    reasons.push('no-minimal-info')
  }

  // 附：有效正文字数（供日志/留痕），并给清洗后条目打上截断上限，防超长入 LLM
  clean._contentLen = len
  clean._cleanVersion = 1
  if (typeof clean.content === 'string' && clean.content.length > MAX_INPUT) {
    clean.content = clean.content.slice(0, MAX_INPUT)
  }

  return { pass: reasons.length === 0, reasons, clean }
}

module.exports = {
  qualify,
  decodeHtmlEntities,
  stripControls,
  collapseSpace,
  cleanText,
  isMeaningfulContent,
  withinFreshness,
  meaningfulLength,
  parseStamp,
  MIN_CONTENT_DEFAULT,
  FRESHNESS_DAYS_DEFAULT,
}
