// 请求层封装 — 云函数模式（全链路真实数据，无 Mock 兜底）
//
// 数据流架构：
//   前端 → 云函数 getNewsList / getNewsDetail / refreshNews
//          └─ 智谱/DeepSeek 双引擎 AI 生成 → 云数据库
//
// 2026-08-03 owner 裁定：全链路真实数据，所有 mock 数据文件已物理删除。

const { PAGE_SIZE, RECOMMEND_PAGE_SIZE, CATEGORY_MAP } = require('./constants')
const { formatAbsoluteTime } = require('./util')

/**
 * 获取新闻列表
 * @param {Object} params
 * @param {string} params.category 分类ID，默认'recommend'（DG-03: all → recommend）
 * @param {number} params.pageNum   页码，默认1
 * @param {number} params.pageSize  每页条数；不传时按分类默认：recommend→15（对齐落库 cap），其余→8（PAGE_SIZE）
 * @param {boolean} [params.includeContent=false] 是否透传完整正文 content/aiOpinion。
 *        默认 false（瘦包）：首页卡片流只用 summary，无需长正文。
 *        详情页首屏按需传 true（或走 getNewsDetail 后台拉取）。
 * @returns {Promise<{list: Array, total: number, hasMore: boolean, meta?: Object}>}
 */
function getNewsList({ category = 'recommend', pageNum = 1, pageSize, includeContent = false } = {}) {
  const size = pageSize || (category === 'recommend' ? RECOMMEND_PAGE_SIZE : PAGE_SIZE)
  return wx.cloud.callFunction({
    name: 'getNewsList',
    // 2026-08-28 优化：首页高频列表默认不拉长正文，减小响应包（详情页按需 includeContent=true / getNewsDetail）
    data: { category, pageNum, pageSize: size, includeContent }
  }).then(res => {
    if (res.result.code !== 0) {
      const err = new Error(res.result.message || '获取新闻列表失败')
      err.errorCode = res.result.errorCode
      throw err
    }
    const data = res.result.data
    return {
      // includeContent=true 时透传完整 AI 解读正文 content（详情页首帧完整渲染）；
      // false 时列表项不含 content，靠 getNewsDetail 按需补全。
      list: (data.list || []).map(item => formatNewsItem(item, !!includeContent)),
      total: data.total,
      hasMore: data.hasMore,
      meta: res.result.meta,  // 透传 source 信息
    }
  })
}

/**
 * 获取新闻详情
 * @param {string} newsId
 * @returns {Promise<Object>}
 */
function getNewsDetail(newsId) {
  return wx.cloud.callFunction({
    name: 'getNewsDetail',
    data: { newsId }
  }).then(res => {
    if (res.result.code !== 0) {
      throw new Error(res.result.message || '获取新闻详情失败')
    }
    return formatNewsItem(res.result.data, true)
  })
}

/**
 * 获取增量新闻（FS-CF3 · 2026-08-10 owner 确认方案A「先快返回+分批增量」）
 * 下拉刷新后短轮询：按 createdAt >= since 读回 refreshNews 逐条写库的新记录，实现列表逐条增加。
 * 根因：getNewsList 按 publishTime desc 排序，读不到刚刷新写入（publishTime 偏旧）的记录。
 * @param {Object} params
 * @param {string} params.category 分类ID（默认 recommend）
 * @param {number} params.since    本轮刷新启动时刻（ms 时间戳），createdAt >= since 视为本轮新增
 * @param {number} [params.max]    单次返回条数上限（默认 10）
 * @returns {Promise<{list: Array, total: number}>}
 */
function getNewsDelta({ category = 'recommend', since = 0, max = 10 } = {}) {
  return wx.cloud.callFunction({
    name: 'getNewsDelta',
    data: { category, since, max }
  }).then(res => {
    if (res.result.code !== 0) {
      const err = new Error(res.result.message || '获取增量新闻失败')
      err.errorCode = res.result.errorCode
      throw err
    }
    const list = (res.result.data.list || []).map(item => {
      const fmt = formatNewsItem(item)
      fmt.createdAt = item.createdAt // 透传写入时刻（前端按序 prepend 需用）
      return fmt
    })
    return { list, total: res.result.data.total }
  })
}

// ============ 错误码映射 ============

/**
 * 将云函数返回的错误码映射为用户友好的提示文案
 */
function handleApiError(errorCode, message) {
  const errorMessages = {
    'API_RATE_LIMIT':   '今日阅读次数已用完，明天再来吧',
    'API_UNAVAILABLE':  '新闻服务暂时不可用，请稍后重试',
    'ALL_DOWN':         '新闻服务暂时不可用，请稍后重试',
    'LLM_SEARCH_FAILED':'智能搜索暂时不可用，请稍后重试',
    'NO_DATA':          '暂无新闻，下拉刷新试试',
    'API_KEY_INVALID':  '服务配置错误，请联系管理员',
    'API_TIMEOUT':      '网络开小差了，请重试',
    'SIMULATED_ERROR':  message || '模拟错误',
  }
  return errorMessages[errorCode] || message || '网络开小差了，请重试'
}

// ============ 格式化 ============

function formatNewsItem(item, includeContent = false) {
  const itemId = item._id || item.id
  return {
    id: itemId,
    _id: itemId,
    title: item.title,
    summary: item.summary,
    // v6.2：透传 summarySource 供前端三档优先级（'ai' > 'desc' > 'title'）
    summarySource: item.summarySource || 'desc',
    content: includeContent ? (item.content || item.summary) : undefined,
    category: item.category,
    categoryName: item.categoryName || CATEGORY_MAP[item.category] || item.category,
    source: item.source,
    // v1.2 路线1：官方源字段透传（此前丢失导致前端无法识别 official_rss）
    // 1) contentSource：官方源标记（首页「出处 ↗」/详情页官方源归因块依赖）
    // 2) sourceName：官方源来源名（落库字段，前端 metaSource 取它）
    // 3) references：参考来源（详情页折叠卡依赖）
    // 4) aiOpinion：一页说 AI 独立观点（详情页观点卡依赖，仅非空渲染）
    contentSource: item.contentSource || '',
    sourceName: item.sourceName || item.source || '',
    references: Array.isArray(item.references) ? item.references : [],
    aiOpinion: item.aiOpinion || '',
    sourceUrl: item.sourceUrl || item._url || '',
    picUrl: item.picUrl || '',
    // 2026-08-21 owner 方案：首页时间改为「新闻源抓取的绝对时间」publishTime，
    // 格式 MM/DD HH:mm（如 8/21 14:05）。不再用 createdAt 相对时间（True freshness 曾有争议）。
    // publishTime 缺失时兜底 createdAt；两者都无 → 空（不渲染乱码）
    time: formatAbsoluteTime(item.publishTime || item.createdAt || item.time),
    publishTime: item.publishTime || item.time,
    createdAt: item.createdAt,
    isRetained: item.isRetained === true
  }
}

module.exports = {
  getNewsList,
  getNewsDetail,
  getNewsDelta,
  handleApiError
}
