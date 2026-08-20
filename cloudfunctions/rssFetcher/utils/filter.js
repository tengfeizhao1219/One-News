/**
 * filter.js — 官方 RSS 源 质量/合规过滤
 * ============================================================
 * 对应 PRD：只接「特定非敏感分类」的高质量新闻。
 * 原则：
 *   1. 敏感与否按【栏目维度】判断（不扫正文内容）——feed URL 本身就是按栏目划分的，
 *      我们只接入明确非敏感的栏目源，天然避开时政/军事/主权等敏感分类。
 *   2. 栏目白名单 + 归一化别名，数据驱动（PM/PD 可配），代码里不做内容级政治词扫描。
 * ============================================================
 */

// ── 全局非敏感栏目白名单 ──
// 命中的栏目才允许入库；不在列表中的栏目源整体不入。可被 feed_meta.allowCategories 覆盖放宽。
// 含英文通名 + 常见中文别名（RSS 的 category 可能是中文栏目名）。
// 注意：按栏目 URL 接入时，主分类建议由 feed_meta 显式指定，这里作为兜底匹配。
const CATEGORY_ALIASES = {
  recommend: ['recommend', '推荐', '推荐阅读'],
  tech: ['tech', 'it', 'technology', '科技', '数码', '互联网'],
  finance: ['finance', 'fortune', 'economy', 'money', '财经', '金融', '经济'],
  edu: ['edu', 'education', 'school', '教育'],
  health: ['health', 'healthy', '健康', '医药', '医疗'],
  culture: ['culture', '文化', '文艺'],
  society: ['society', 'social', '社会', '民生'],
  world: ['world', 'international', 'global', '国际', '世界'],
  life: ['life', '生活', '时尚'],
  auto: ['auto', 'car', '汽车'],
  digital: ['digital', 'digitaltech', '互联网'],
  science: ['science', 'sci', 'sport', '体育', 'tech', '科学', '探索', '科技'],
}

// 扁平化展开成别名列表，同时保留英文通名本身可命中的白名单
function buildAllowed() {
  const set = new Set()
  for (const aliases of Object.values(CATEGORY_ALIASES)) {
    for (const a of aliases) set.add(a)
  }
  return Array.from(set)
}

const DEFAULT_ALLOWED_CATEGORIES = buildAllowed()

// 栏目名归一化（去掉空格/大写，方便匹配）
function norm(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase()
}

/**
 * 判断一个栏目名是否属于允许接入的非敏感分类。
 * @param {string} category - 栏目名（如 'tech' / '财经' / 'edu'）
 * @param {string[]} [allowExtra] - feed_meta 里额外放行的栏目
 * @returns {boolean}
 */
function isAllowedCategory(category, allowExtra = []) {
  const c = norm(category)
  if (!c) return false
  const all = DEFAULT_ALLOWED_CATEGORIES.concat(allowExtra || [])
  return all.some((a) => norm(a) === c)
}

/**
 * 标题/条目级过滤——排除明显非新闻条目（AD、直播、专题、招聘等）。
 * 过滤词可扩展，PD 的过滤词表产出后可并入此数组或放入 feed_meta.blockTitleKeywords。
 * @param {string} title
 * @param {string[]} [extraKeywords]
 * @returns {{pass:boolean, reason:string}}
 */
function checkTitle(title, extraKeywords = []) {
  const t = norm(title)
  if (!t) return { pass: false, reason: '空标题' }
  const keywords = ['直播', '专题', '招聘', '商务合作', '广告', '免责声明']
    .concat(extraKeywords || [])
    .map((k) => norm(k))
    .filter(Boolean)
  for (const kw of keywords) {
    if (t.includes(kw)) return { pass: false, reason: `标题含过滤词「${kw}」` }
  }
  return { pass: true, reason: '' }
}

/**
 * 综合过滤器：对一条候选新闻项做「栏目白名单 + 标题过滤」判定。
 * @param {string} category
 * @param {string} title
 * @param {Object} [options]
 * @param {string[]} [options.allowCategories] feed_meta 额外放行栏目
 * @param {string[]} [options.blockTitleKeywords] 过滤词语
 * @returns {{pass:boolean, reason:string}}
 */
function check(item, options = {}) {
  if (!isAllowedCategory(item.category, (options.allowCategories || []))) {
    return { pass: false, reason: `栏目「${item.category}」不在非敏感白名单` }
  }
  return checkTitle(item.title, options.blockTitleKeywords)
}

module.exports = { isAllowedCategory, checkTitle, check, norm }
