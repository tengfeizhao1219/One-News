/**
 * 数据适配器 — 将外部 API 返回的新闻数据映射为前端统一格式
 *
 * 前端数据模型（formatNewsItem 输出格式）：
 * {
 *   id, _id, title, summary, content, category,
 *   categoryName, source, time, publishTime
 * }
 */

// ─── 分类映射表 ──────────────────────────────────────

// 方案 B（分类路由）：改用天行「分类专属接口」直连，不再依赖 allnews 聚合接口。
//
// 实测可用接口（真实 key 探测，2026-07-29）：
//   generalnews(综合) ✅  world(国际) ✅  keji(科技) ✅
//   ai(AI) ✅  it(IT) ✅  internet(互联网) ✅
// 未申请/不可用：allnews(需 col 参数，冗余) / guonei(160未申请) /
//               tiyu(160未申请) / shehui(404不存在)
//
// 一页分类 ID → 天行分类 endpoint 名称
const APP_TO_TIAN_ENDPOINT = {
  'recommend':     'generalnews',  // 综合（混合流，最适合作为首页推荐）
  'tech':          'keji',         // 科技
  'international': 'world',        // 国际
  'sports':        'generalnews',  // 体育：tiyu 未申请 → 综合兜底
  'life':          'generalnews',  // 生活：无对应接口 → 综合兜底
  'all':           'generalnews',  // 全部 → 综合兜底
}

// 天行已确认可用的分类接口清单（供扩展/排查参考，非强制映射）
const TIAN_ENDPOINTS_AVAILABLE = {
  generalnews: '综合',
  world:       '国际',
  keji:        '科技',
  ai:          'AI',
  it:          'IT',
  internet:    '互联网',
}

// 聚合数据 type 参数 → 一页分类 ID
const JUHE_TYPE_TO_APP = {
  'top':    'recommend',
  'keji':   'tech',
  'tiyu':   'sports',
  'guoji':  'international',
  'shehui': 'life',
  'yule':   'life',
  'caijing':'recommend',
}

// 一页分类 ID → 聚合数据 type 参数
const APP_TO_JUHE_TYPE = {
  'recommend':     'top',
  'tech':          'keji',
  'sports':        'tiyu',
  'life':          'shehui',
  'international': 'guoji',
  'all':           null,
}

// 一页分类 ID → 中文名称
const CATEGORY_NAMES = {
  'all':           '全部',
  'recommend':     '推荐',
  'tech':          '科技',
  'sports':        '体育',
  'life':          '生活',
  'international': '国际',
}

// ─── 字段映射函数 ───────────────────────────────────

/**
 * 安全去除 HTML 标签
 */
function stripHtml(str) {
  if (!str) return ''
  return String(str).replace(/<[^>]*>/g, '')
}

/**
 * 适配天行数据 API 返回的单条新闻
 * @param {object} apiItem 天行返回的单条新闻
 * @param {string} category 一页分类 ID（如 recommend/tech，直接透传）
 */
function adaptTianNewsItem(apiItem, category) {
  const id = String(apiItem.id || '')
  const cat = CATEGORY_NAMES[category] ? category : 'recommend'

  let title = stripHtml(apiItem.title || '')
  let summary = stripHtml(apiItem.description || '')

  // 字段长度限制
  if (title.length > 200) title = title.substring(0, 197) + '...'
  if (summary.length > 500) summary = summary.substring(0, 497) + '...'

  return {
    id,
    _id: id,
    title: title || '[无标题]',
    summary,
    category: cat,
    categoryName: CATEGORY_NAMES[cat] || '推荐',
    source: apiItem.source || '未知来源',
    sourceUrl: apiItem.url || '',
    publishTime: apiItem.ctime || '',
    // 扩展字段（前端暂不使用，预留）
    _picUrl: apiItem.picUrl || '',
  }
}

/**
 * 适配聚合数据 API 返回的单条新闻
 */
function adaptJuheNewsItem(apiItem) {
  const id = String(apiItem.uniquekey || '')
  const category = JUHE_TYPE_TO_APP[apiItem.category] || 'recommend'

  let title = stripHtml(apiItem.title || '')
  let summary = stripHtml(apiItem.description || '')

  if (title.length > 200) title = title.substring(0, 197) + '...'
  if (summary.length > 500) summary = summary.substring(0, 497) + '...'

  return {
    id,
    _id: id,
    title: title || '[无标题]',
    summary,
    category,
    categoryName: apiItem.category || CATEGORY_NAMES[category] || '推荐',
    source: apiItem.author_name || '未知来源',
    sourceUrl: apiItem.url || '',
    publishTime: apiItem.date || '',
    _picUrl: apiItem.thumbnail_pic_s || '',
  }
}

/**
 * 安全适配器 — 处理各种异常字段，失败返回 null
 */
function safeAdapt(apiItem, apiSource, category) {
  try {
    const result = apiSource === 'tian'
      ? adaptTianNewsItem(apiItem, category)
      : adaptJuheNewsItem(apiItem)

    // 必需字段校验
    if (!result.id) {
      console.warn('[Adapter] 新闻缺少 ID，跳过:', JSON.stringify(apiItem).substring(0, 100))
      return null
    }

    return result
  } catch (err) {
    console.error('[Adapter] 适配失败，跳过该条:', err.message)
    return null
  }
}

/**
 * 批量适配新闻列表
 */
function adaptNewsList(apiList, apiSource, category) {
  return apiList
    .map(item => safeAdapt(item, apiSource, category))
    .filter(Boolean)
}

// ─── 导出 ───────────────────────────────────────────

module.exports = {
  // 分类映射
  APP_TO_TIAN_ENDPOINT,
  TIAN_ENDPOINTS_AVAILABLE,
  JUHE_TYPE_TO_APP,
  APP_TO_JUHE_TYPE,
  CATEGORY_NAMES,

  // 适配函数
  adaptTianNewsItem,
  adaptJuheNewsItem,
  safeAdapt,
  adaptNewsList,
}
