// 请求层封装 - 支持 Mock / 云函数双模式

const { USE_MOCK, PAGE_SIZE, CATEGORY_MAP } = require('./constants')
const { formatRelativeTime } = require('./util')
const mockNews = require('../mock/news')

/**
 * 获取新闻列表
 * @param {Object} params
 * @param {string} params.category 分类ID，默认'all'
 * @param {number} params.pageNum   页码，默认1
 * @param {number} params.pageSize  每页条数，默认10
 * @returns {Promise<{list: Array, total: number, hasMore: boolean}>}
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

// ============ Mock 实现 ============

function getNewsListMock({ category, pageNum, pageSize }) {
  return new Promise((resolve) => {
    let list = [...mockNews]
    if (category && category !== 'all') {
      list = list.filter(item => item.category === category)
    }
    const total = list.length
    const start = (pageNum - 1) * pageSize
    const pagedList = list.slice(start, start + pageSize)
    const hasMore = start + pageSize < total

    // 模拟网络延迟
    setTimeout(() => {
      resolve({
        list: pagedList.map(formatNewsItem),
        total,
        hasMore
      })
    }, 200)
  })
}

function getNewsDetailMock(newsId) {
  return new Promise((resolve, reject) => {
    // 兼容字符串ID和ObjectId（云数据库可能返回不同格式）
    const item = mockNews.find(n => {
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
  return new Promise((resolve) => {
    const kw = keyword.toLowerCase()
    let list = mockNews.filter(item =>
      item.title.toLowerCase().includes(kw) ||
      item.summary.toLowerCase().includes(kw)
    )
    const total = list.length
    const start = (pageNum - 1) * pageSize
    list = list.slice(start, start + pageSize)
    setTimeout(() => {
      resolve({ list: list.map(formatNewsItem), total })
    }, 200)
  })
}

// ============ 云函数实现 ============

function getNewsListCloud({ category, pageNum, pageSize }) {
  return wx.cloud.callFunction({
    name: 'getNewsList',
    data: { category, pageNum, pageSize }
  }).then(res => {
    if (res.result.code !== 0) {
      throw new Error(res.result.message || '获取新闻列表失败')
    }
    const data = res.result.data
    return {
      list: (data.list || []).map(formatNewsItem),
      total: data.total,
      hasMore: data.hasMore
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
      throw new Error(res.result.message || '搜索新闻失败')
    }
    const data = res.result.data
    return {
      list: (data.list || []).map(formatNewsItem),
      total: data.total
    }
  })
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
    time: formatRelativeTime(item.publishTime || item.time),
    publishTime: item.publishTime || item.time
  }
}

module.exports = {
  getNewsList,
  getNewsDetail,
  searchNews
}
