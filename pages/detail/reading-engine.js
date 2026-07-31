// B-01 跨分类阅读引擎 — 状态机模块
// ============================================================
// 职责：全分类新闻合并列表构建 + 跨分类翻页 + 预取窗口 + 边界检测
//
// 方案 A（全量预拉）：进入详情时并行拉取 7 个非 all 分类首页，
// 按 CATEGORIES 顺序串联为一个 mergedList，全程无加载态。
//
// 依赖：getNewsList / getNewsDetail（utils/request.js）
// 缓存接口：_cache（预留 B-06 localCache 注入点）
// ============================================================

var CATEGORIES = require('../../utils/constants').CATEGORIES
var getNewsList = require('../../utils/request').getNewsList
var getNewsDetail = require('../../utils/request').getNewsDetail
var PAGE_SIZE = require('../../utils/constants').PAGE_SIZE

// 参与跨分类串联的分类（排除 'all'）
var READING_CATEGORIES = []
for (var i = 0; i < CATEGORIES.length; i++) {
  if (CATEGORIES[i].id !== 'all') {
    READING_CATEGORIES.push(CATEGORIES[i])
  }
}

/**
 * 阅读引擎构造函数
 * @param {Object} options
 * @param {string} options.entryCategory  入口分类
 * @param {number} options.entryIndex     入口在该分类内的索引
 * @param {string} options.entryNewsId    入口新闻 ID
 * @param {Function} options.onProgress   进度更新回调 ({ index, total, category, categoryName, isCrossing })
 * @param {Function} options.onDetailReady 详情加载完成回调 (news, paragraphs)
 * @param {Function} options.onError      错误回调 (message)
 * @param {Object} [options.cache]        缓存实例（B-06 localCache 注入点，可选）
 */
function ReadingEngine(options) {
  this._entryCategory = options.entryCategory || 'recommend'
  this._entryIndex = options.entryIndex || 0
  this._entryNewsId = options.entryNewsId || ''
  this._onProgress = options.onProgress || function () {}
  this._onDetailReady = options.onDetailReady || function () {}
  this._onError = options.onError || function () {}
  this._cache = options.cache || null

  // 状态
  this._mergedList = []       // 全分类合并列表 [{ news, category, categoryIndex }]
  this._globalIndex = 0       // 当前在 mergedList 中的位置
  this._total = 0
  this._categoryIndexes = {}  // { categoryId: startIndexInMergedList }
  this._prefetched = {}       // { globalIndex: true } 已预取详情
  this._initialized = false
  this._initializing = false
}

/**
 * 初始化：并行拉取所有分类首页 → 合并 → 定位入口
 * @returns {Promise<void>}
 */
ReadingEngine.prototype.init = function () {
  var that = this
  if (that._initializing) return Promise.resolve()
  that._initializing = true

  // 并行拉取 7 个分类（方案 A + B-06 缓存注入）
  var fetches = []
  for (var i = 0; i < READING_CATEGORIES.length; i++) {
    var catId = READING_CATEGORIES[i].id
    fetches.push(
      that._fetchCategoryWithCache(catId)
    )
  }

  return Promise.all(fetches).then(function (results) {
    return that._buildMergedList(results)
  })
}

/**
 * 带缓存的分分类数据拉取（B-06）
 * 缓存 key: 'newsList:{category}'，TTL 10 分钟
 */
ReadingEngine.prototype._fetchCategoryWithCache = function (categoryId) {
  var that = this
  var cacheKey = 'newsList:' + categoryId

  // 1) 尝试读缓存
  if (that._cache) {
    try {
      var cached = that._cache.get(cacheKey)
      if (cached && Array.isArray(cached) && cached.length > 0) {
        return Promise.resolve({ list: cached, categoryId: categoryId, fromCache: true })
      }
    } catch (e) { /* 缓存读取失败，继续网络请求 */ }
  }

  // 2) 网络请求
  return getNewsList({ category: categoryId, pageNum: 1, pageSize: PAGE_SIZE })
    .then(function (res) {
      var list = res.list || []
      // 写入缓存（TTL 10 分钟）
      if (that._cache && list.length > 0) {
        try {
          that._cache.set(cacheKey, list, { ttl: 10 * 60 * 1000 })
        } catch (e) { /* 缓存写入失败不阻塞 */ }
      }
      return { list: list, categoryId: categoryId, fromCache: false }
    })
    .catch(function () {
      return { list: [], categoryId: categoryId, error: true }
    })
}
ReadingEngine.prototype._buildMergedList = function (results) {
  var seen = {}
  var merged = []
  var indexes = {}
  var entryGlobalIndex = 0
  var foundEntry = false

  for (var r = 0; r < results.length; r++) {
    var catId = results[r].categoryId
    var list = results[r].list
    var startIdx = merged.length
    indexes[catId] = startIdx

    for (var i = 0; i < list.length; i++) {
      var item = list[i]
      var nid = item.id || item._id
      if (!nid) continue
      if (seen[nid]) continue // 去重
      seen[nid] = true

      var entry = {
        id: nid,
        title: item.title || '',
        summary: item.summary || '',
        category: catId,
        categoryName: item.categoryName || '',
        source: item.source || '',
        sourceUrl: item.sourceUrl || '',
        picUrl: item.picUrl || '',
        publishTime: item.publishTime || item.time,
      }
      merged.push(entry)

      // 定位入口
      if (!foundEntry && this._entryNewsId && nid === this._entryNewsId) {
        entryGlobalIndex = merged.length - 1
        foundEntry = true
      }
    }
  }

  // 如果按 ID 没找到，用分类+索引定位
  if (!foundEntry && this._entryCategory) {
    var catStart = indexes[this._entryCategory] || 0
    entryGlobalIndex = catStart + Math.min(this._entryIndex, (merged.length - catStart - 1))
  }

  this._mergedList = merged
  this._total = merged.length
  this._globalIndex = Math.min(entryGlobalIndex, merged.length - 1)
  this._categoryIndexes = indexes
  this._initialized = true
  this._initializing = false

  return this._globalIndex
}

/**
 * 获取当前新闻条目
 */
ReadingEngine.prototype.getCurrent = function () {
  return this._mergedList[this._globalIndex] || null
}

/**
 * 获取当前进度信息
 */
ReadingEngine.prototype.getProgress = function () {
  var cur = this.getCurrent()
  return {
    index: this._globalIndex,
    total: this._total,
    category: cur ? cur.category : '',
    categoryName: cur ? cur.categoryName : '',
    positionText: this._total > 0 ? (this._globalIndex + 1) + ' / ' + this._total : '',
  }
}

/**
 * 翻到下一页
 * @returns {{ canGo: boolean, isCrossing: boolean, crossingCategory: string|null }}
 */
ReadingEngine.prototype.goNext = function () {
  if (this._globalIndex >= this._total - 1) {
    return { canGo: false, isCrossing: false, crossingCategory: null, reason: 'last' }
  }

  var oldCat = this.getCurrent() ? this.getCurrent().category : ''
  this._globalIndex++
  var cur = this.getCurrent()
  var newCat = cur ? cur.category : ''
  var isCrossing = oldCat !== newCat

  return {
    canGo: true,
    isCrossing: isCrossing,
    crossingCategory: isCrossing ? newCat : null,
    newIndex: this._globalIndex,
  }
}

/**
 * 翻到上一页
 * @returns {{ canGo: boolean, isCrossing: boolean, crossingCategory: string|null }}
 */
ReadingEngine.prototype.goPrev = function () {
  if (this._globalIndex <= 0) {
    return { canGo: false, isCrossing: false, crossingCategory: null, reason: 'first' }
  }

  var oldCat = this.getCurrent() ? this.getCurrent().category : ''
  this._globalIndex--
  var cur = this.getCurrent()
  var newCat = cur ? cur.category : ''
  var isCrossing = oldCat !== newCat

  return {
    canGo: true,
    isCrossing: isCrossing,
    crossingCategory: isCrossing ? newCat : null,
    newIndex: this._globalIndex,
  }
}

/**
 * 加载当前索引的新闻详情（含 ±2 预取）
 * @returns {Promise<{news: Object, paragraphs: Array}>}
 */
ReadingEngine.prototype.loadCurrentDetail = function () {
  var that = this
  var cur = this.getCurrent()
  if (!cur) {
    return Promise.reject(new Error('no current news'))
  }

  // 预取窗口 ±2
  that._prefetchWindow()

  // B-06: 先尝试读缓存（TTL 30 分钟）
  if (that._cache) {
    try {
      var cachedDetail = that._cache.get('newsDetail:' + cur.id)
      if (cachedDetail) {
        var text = cachedDetail.content || cachedDetail.summary || ''
        var paragraphs = text.split('\n').filter(function (p) { return p.trim() })
        that._onDetailReady(cachedDetail, paragraphs)
        return Promise.resolve({ news: cachedDetail, paragraphs: paragraphs, fromCache: true })
      }
    } catch (e) { /* 缓存读取失败，继续网络请求 */ }
  }

  return getNewsDetail(cur.id).then(function (detail) {
    var text = detail.content || detail.summary || ''
    var paragraphs = text.split('\n').filter(function (p) { return p.trim() })
    that._onDetailReady(detail, paragraphs)

    // B-06: 写入缓存（TTL 30 分钟）
    if (that._cache) {
      try {
        that._cache.set('newsDetail:' + cur.id, detail, { ttl: 30 * 60 * 1000 })
      } catch (e) { /* 缓存写入失败不阻塞 */ }
    }

    return { news: detail, paragraphs: paragraphs, fromCache: false }
  }).catch(function () {
    // 降级：用列表摘要
    var text = cur.summary || ''
    var paragraphs = text.split('\n').filter(function (p) { return p.trim() })
    var fallback = {
      id: cur.id,
      _id: cur.id,
      title: cur.title,
      summary: cur.summary,
      content: cur.summary,
      category: cur.category,
      categoryName: cur.categoryName,
      source: cur.source,
      sourceUrl: cur.sourceUrl,
      picUrl: cur.picUrl,
      publishTime: cur.publishTime,
    }
    that._onDetailReady(fallback, paragraphs)
    return { news: fallback, paragraphs: paragraphs }
  })
}

/**
 * 预取窗口 ±2 条新闻详情（静默，不触发回调）
 */
ReadingEngine.prototype._prefetchWindow = function () {
  var that = this
  var start = Math.max(0, this._globalIndex - 2)
  var end = Math.min(this._total - 1, this._globalIndex + 2)

  for (var i = start; i <= end; i++) {
    if (i === this._globalIndex) continue // 当前条不预取
    if (this._prefetched[i]) continue      // 已预取

    this._prefetched[i] = true
    var item = this._mergedList[i]
    if (!item) continue

    getNewsDetail(item.id).catch(function () {
      // 预取失败静默，不影响主流程
    })
  }
}

/**
 * 获取返回定位信息（供 detail.js goBack 使用）
 */
ReadingEngine.prototype.getReturnState = function () {
  var cur = this.getCurrent()
  return {
    category: cur ? cur.category : '',
    categoryIndex: this._globalIndex,
    newsId: cur ? cur.id : '',
    total: this._total,
  }
}

/**
 * 判断是否是第一条 / 最后一条
 */
ReadingEngine.prototype.isFirst = function () {
  return this._globalIndex <= 0
}

ReadingEngine.prototype.isLast = function () {
  return this._globalIndex >= this._total - 1
}

/**
 * 获取分类闪烁条颜色（跨分类动画用）
 */
ReadingEngine.prototype.getCategoryFlashColor = function (categoryId) {
  var colors = {
    recommend:     '#FF3B30',
    tech:          '#007AFF',
    international: '#5856D6',
    sports:        '#FF9500',
    life:          '#34C759',
    agriculture:   '#65A30D',
    science:       '#7C3AED',
  }
  return colors[categoryId] || '#007AFF'
}

/**
 * 获取分类名称
 */
ReadingEngine.prototype.getCategoryName = function (categoryId) {
  for (var i = 0; i < READING_CATEGORIES.length; i++) {
    if (READING_CATEGORIES[i].id === categoryId) {
      return READING_CATEGORIES[i].name
    }
  }
  return ''
}

module.exports = ReadingEngine
