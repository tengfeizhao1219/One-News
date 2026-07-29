// 请求层封装 — 支持 Mock（AI 缓存）/ 云函数双模式
//
// 数据流架构（v2.0）：
//   Mock 模式 → AI 新闻缓存 (mock/ai-news-cache.js) + 模拟器
//   生产模式 → 云函数 getNewsList / searchNews
//              └─ AI 缓存 (aiNewsService) → 云数据库缓存 → 外部 API 降级
//
//   AI 缓存特点：零延迟、零费用、零外部依赖
//   由 WorkBuddy 通过 WebSearch + WebFetch 实时搜索生成

const { USE_MOCK, PAGE_SIZE, CATEGORY_MAP, AI_CACHE } = require('./constants')
const { formatRelativeTime } = require('./util')
const { simulateGetNewsList, simulateSearchNews } = require('../mock/simulator')

// AI 新闻缓存（Mock 模式直接使用，生产模式走云函数）
let aiNewsCache = []
try {
  aiNewsCache = require('../mock/ai-news-cache')
} catch (_) {
  aiNewsCache = []
}

/**
 * 获取新闻列表
 * @param {Object} params
 * @param {string} params.category 分类ID，默认'all'
 * @param {number} params.pageNum   页码，默认1
 * @param {number} params.pageSize  每页条数，默认10
 * @returns {Promise<{list: Array, total: number, hasMore: boolean, meta?: Object}>}
 */
function getNewsList({ category = 'all', pageNum = 1, pageSize = PAGE_SIZE } = {}) {
  if (USE_MOCK) {
    return getNewsListMock({ category, pageNum, pageSize })
  }
  return getNewsListCloud({ category, pageNum, pageSize })
}

/**
 * 获取新闻详情
 * @param {string} newsId
 * @returns {Promise<Object>}
 */
function getNewsDetail(newsId) {
  if (USE_MOCK) {
    return getNewsDetailMock(newsId)
  }
  return getNewsDetailCloud(newsId)
}

/**
 * 搜索新闻
 * @param {Object} params
 * @param {string} params.keyword
 * @param {number} params.pageNum
 * @param {number} params.pageSize
 * @returns {Promise<{list: Array, total: number}>}
 */
function searchNews({ keyword, pageNum = 1, pageSize = PAGE_SIZE } = {}) {
  if (USE_MOCK) {
    return searchNewsMock({ keyword, pageNum, pageSize })
  }
  return searchNewsCloud({ keyword, pageNum, pageSize })
}

// ============ Mock 实现（AI 缓存 + 模拟器）============

function getNewsListMock({ category, pageNum, pageSize }) {
  // 使用 AI 新闻缓存作为数据源
  const dataSource = aiNewsCache.length > 0 ? aiNewsCache : []

  return simulateGetNewsList(dataSource, category, pageNum, pageSize).then(res => ({
    list: res.list.map(formatNewsItem),
    total: res.total,
    hasMore: res.hasMore,
    meta: {
      source: 'ai_cache_mock',
      cacheVersion: AI_CACHE.version,
      cacheGeneratedAt: AI_CACHE.generatedAt,
    }
  }))
}

function getNewsDetailMock(newsId) {
  return new Promise((resolve, reject) => {
    const item = aiNewsCache.find(n => {
      const nid = String(n.id || n._id || '')
      const sid = String(newsId || '')
      return nid === sid
    })
    if (!item) {
      reject(new Error('新闻不存在'))
      return
    }
    setTimeout(() => {
      resolve(formatNewsItem(item, true))
    }, 150)
  })
}

function searchNewsMock({ keyword, pageNum, pageSize }) {
  return simulateSearchNews(aiNewsCache, keyword, pageNum, pageSize).then(res => ({
    list: res.list.map(formatNewsItem),
    total: res.total
  }))
}

// ============ 云函数实现 ============

function getNewsListCloud({ category, pageNum, pageSize }) {
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

function getNewsDetailCloud(newsId) {
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

function searchNewsCloud({ keyword, pageNum, pageSize }) {
  return wx.cloud.callFunction({
    name: 'searchNews',
    data: { keyword, pageNum, pageSize }
  }).then(res => {
    if (res.result.code !== 0) {
      const err = new Error(res.result.message || '搜索新闻失败')
      err.errorCode = res.result.errorCode
      throw err
    }
    const data = res.result.data
    return {
      list: (data.list || []).map(formatNewsItem),
      total: data.total
    }
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
  searchNews,
  handleApiError
}
