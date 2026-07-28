/**
 * AI 新闻服务 — 基于 WorkBuddy 实时搜索生成的新闻缓存
 *
 * 数据来源：mock/ai-news-cache.js
 *   由 WorkBuddy 通过 WebSearch + WebFetch 在 2026-07-28 搜索整理
 *   覆盖 5 个分类：recommend / tech / sports / international / life
 *   共 40+ 条真实新闻
 *
 * 核心能力：
 *   - getByCategory(category, pageNum, pageSize) — 按分类分页获取
 *   - search(keyword, pageNum, pageSize) — 全量搜索+分页
 *   - getById(id) — 按 ID 获取详情
 *   - getStats() — 获取缓存统计信息
 *
 * 注意：云函数环境不支持 require 小程序 mock 目录，需要将缓存数据内联
 *       部署前通过 build-cache.js 脚本将 mock/ai-news-cache.js 复制到此处
 */

// ═══════════════════════════════════════════════════════
// 数据源（部署时由 build 脚本自动替换此段）
// ═══════════════════════════════════════════════════════

let _aiNewsCache = []

try {
  // 优先尝试加载本地缓存文件（build 脚本生成的）
  _aiNewsCache = require('./aiNewsData') || []
} catch (_) {
  // 降级：使用内联的默认数据
  _aiNewsCache = []
}

// ═══════════════════════════════════════════════════════
// 缓存元信息
// ═══════════════════════════════════════════════════════

const CACHE_META = {
  version: '2026-07-28-v1',
  generatedAt: '2026-07-28T11:46:00+08:00',
  totalItems: 0,       // 运行时计算
  categories: {
    recommend: 0,
    tech: 0,
    sports: 0,
    international: 0,
    life: 0,
  },
}

/**
 * 初始化：计算缓存统计信息
 */
function initCacheStats() {
  CACHE_META.totalItems = _aiNewsCache.length
  CACHE_META.categories = { recommend: 0, tech: 0, sports: 0, international: 0, life: 0 }
  _aiNewsCache.forEach(item => {
    if (CACHE_META.categories.hasOwnProperty(item.category)) {
      CACHE_META.categories[item.category]++
    }
  })
}

// 首次加载时初始化
initCacheStats()

// ═══════════════════════════════════════════════════════
// 查询方法
// ═══════════════════════════════════════════════════════

/**
 * 按分类获取新闻列表（带分页）
 * @param {string} category - 分类ID: 'all' | 'recommend' | 'tech' | 'sports' | 'international' | 'life'
 * @param {number} pageNum - 页码（从 1 开始）
 * @param {number} pageSize - 每页条数
 * @returns {{ list: Array, total: number, hasMore: boolean }}
 */
function getByCategory(category, pageNum = 1, pageSize = 10) {
  let list = [..._aiNewsCache]

  // 分类过滤
  if (category && category !== 'all') {
    list = list.filter(item => item.category === category)
  }

  const total = list.length
  const start = (pageNum - 1) * pageSize
  const pagedList = list.slice(start, start + pageSize)
  const hasMore = start + pageSize < total

  return { list: pagedList, total, hasMore }
}

/**
 * 全文搜索（标题 + 摘要匹配）
 * @param {string} keyword - 搜索关键词
 * @param {number} pageNum - 页码（从 1 开始）
 * @param {number} pageSize - 每页条数
 * @returns {{ list: Array, total: number }}
 */
function search(keyword, pageNum = 1, pageSize = 10) {
  if (!keyword || !keyword.trim()) {
    return { list: [], total: 0 }
  }

  const kw = keyword.trim().toLowerCase()
  const filtered = _aiNewsCache.filter(item =>
    (item.title || '').toLowerCase().includes(kw) ||
    (item.summary || '').toLowerCase().includes(kw)
  )

  const total = filtered.length
  const start = (pageNum - 1) * pageSize
  const pagedList = filtered.slice(start, start + pageSize)

  return { list: pagedList, total }
}

/**
 * 按 ID 获取新闻详情
 * @param {string} id
 * @returns {Object|null}
 */
function getById(id) {
  return _aiNewsCache.find(item => item.id === id || item._id === id) || null
}

/**
 * 获取缓存统计信息
 * @returns {{ version, generatedAt, totalItems, categories }}
 */
function getStats() {
  return { ...CACHE_META }
}

/**
 * 动态更新缓存数据（用于运行时刷新）
 * @param {Array} newData - 新的新闻数据数组
 * @param {Object} meta - 元信息 { version, generatedAt }
 */
function updateCache(newData, meta = {}) {
  if (!Array.isArray(newData) || newData.length === 0) {
    return false
  }

  _aiNewsCache = newData
  if (meta.version) CACHE_META.version = meta.version
  if (meta.generatedAt) CACHE_META.generatedAt = meta.generatedAt
  initCacheStats()
  return true
}

/**
 * 获取当前缓存中的分类列表（含计数）
 */
function getCategories() {
  return Object.entries(CACHE_META.categories).map(([id, count]) => ({
    id,
    name: CATEGORY_NAMES[id] || id,
    count,
  }))
}

const CATEGORY_NAMES = {
  all: '全部',
  recommend: '推荐',
  tech: '科技',
  sports: '体育',
  international: '国际',
  life: '生活',
}

module.exports = {
  getByCategory,
  search,
  getById,
  getStats,
  getCategories,
  updateCache,
  CACHE_META,
}
