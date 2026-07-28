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

// 天行数据频道 col ID → 一页分类 ID
const TIAN_COL_TO_APP = {
  7:  'recommend',      // 国内新闻 → 推荐
  8:  'international',  // 国际新闻
  12: 'sports',         // 体育新闻
  13: 'tech',           // 科技新闻
  17: 'life',           // 健康知识 → 生活
  // 扩展映射
  10: 'life',           // 娱乐新闻 → 生活
  32: 'recommend',      // 财经新闻 → 推荐
  27: 'international',  // 军事新闻 → 国际
  18: 'life',           // 旅游资讯 → 生活
  14: 'tech',           // 互联网 → 科技
}

// 一页分类 ID → 天行数据 col 参数
const APP_TO_TIAN_COL = {
  'recommend':     7,
  'tech':          13,
  'sports':        12,
  'life':          17,
  'international': 8,
  'all':           null,  // 全部 → 不传 col 参数
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
 */
function adaptTianNewsItem(apiItem, colId) {
  const id = String(apiItem.id || '')
  const category = TIAN_COL_TO_APP[colId] || 'recommend'

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
    category,
    categoryName: CATEGORY_NAMES[category] || '推荐',
    source: apiItem.source || '未知来源',
    publishTime: apiItem.ctime || '',
    // 扩展字段（前端暂不使用，预留）
    _url: apiItem.url || '',
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
    publishTime: apiItem.date || '',
    _url: apiItem.url || '',
    _picUrl: apiItem.thumbnail_pic_s || '',
  }
}

/**
 * 安全适配器 — 处理各种异常字段，失败返回 null
 */
function safeAdapt(apiItem, apiSource, colId) {
  try {
    const result = apiSource === 'tian'
      ? adaptTianNewsItem(apiItem, colId)
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
function adaptNewsList(apiList, apiSource, colId) {
  return apiList
    .map(item => safeAdapt(item, apiSource, colId))
    .filter(Boolean)
}

// ─── 导出 ───────────────────────────────────────────

module.exports = {
  // 分类映射
  TIAN_COL_TO_APP,
  APP_TO_TIAN_COL,
  JUHE_TYPE_TO_APP,
  APP_TO_JUHE_TYPE,
  CATEGORY_NAMES,

  // 适配函数
  adaptTianNewsItem,
  adaptJuheNewsItem,
  safeAdapt,
  adaptNewsList,
}
