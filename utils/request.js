// 请求层封装 — 云函数模式（v5 起：纯真实数据，不再使用 Mock）
//
// 数据流架构：
//   前端 → 云函数 getNewsList / getNewsDetail / refreshNews
//          └─ 天行实时 API（第一优先级）→ 内存缓存 → 云数据库 → 聚合降级 → AI 静态缓存兜底
//
// 说明：Mock 模式（AI 新闻缓存 + 模拟器）已于 v5 清理，小程序只读取云端真实新闻。

const { PAGE_SIZE, CATEGORY_MAP } = require('./constants')
const { formatRelativeTime } = require('./util')

/**
 * 获取新闻列表
 * @param {Object} params
 * @param {string} params.category 分类ID，默认'all'
 * @param {number} params.pageNum   页码，默认1
 * @param {number} params.pageSize  每页条数，默认10
 * @returns {Promise<{list: Array, total: number, hasMore: boolean, meta?: Object}>}
 */
function getNewsList({ category = 'all', pageNum = 1, pageSize = PAGE_SIZE } = {}) {
  return wx.cloud.callFunction({
    name: 'getNewsList',
    data: { category, pageNum, pageSize }
  }).then(res => {
    if (res.result.code !== 0) {
      const err = new Error(res.result.message || '获取新闻列表失败')
      err.errorCode = res.result.errorCode
      throw err
    }
    const data = res.result.data
    return {
      list: (data.list || []).map(formatNewsItem),
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
    content: includeContent ? (item.content || item.summary) : undefined,
    category: item.category,
    categoryName: item.categoryName || CATEGORY_MAP[item.category] || item.category,
    source: item.source,
    sourceUrl: item.sourceUrl || item._url || '',
    time: formatRelativeTime(item.publishTime || item.time),
    publishTime: item.publishTime || item.time
  }
}

module.exports = {
  getNewsList,
  getNewsDetail,
  handleApiError
}
