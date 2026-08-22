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
// 2026-08-22：与首页列表一致，详情页元信息行用绝对时间（MM/DD HH:mm）
var formatAbsoluteTime = require('../../utils/util').formatAbsoluteTime

// 参与跨分类串联的分类（CATEGORIES 已无 all，DG-03 后 recommend 在列）
var READING_CATEGORIES = []
for (var i = 0; i < CATEGORIES.length; i++) {
  if (CATEGORIES[i].id !== 'all') {
    READING_CATEGORIES.push(CATEGORIES[i])
  }
}

// B-COMPLIANCE-1 R2（PRD §八）：4 处 content||summary 拆分点统一收敛
// 按 contentSource 决定正文渲染来源，杜绝缓存命中路径仍渲染被 R1 拦截的全文。
// - 'ai_interpretation'  → 渲染 content（AI 独立解读，独立作品）
// - 'r1_blocked_fulltext' → 渲染 summary（R1 已拦截全文，仅留 AI 摘要；前端不应再取 content）
// - 其他历史全文本（'cached' / 'fetched_and_cleaned' 等）→ 降级渲染 summary
// - 兜底无 contentSource → 优先 summary
// ⚠️ FS R1（commit eb12834）已保证 ai_first 模式下非 ai_interpretation 的 content 字段已清空；
//   本函数是**前端最后一道闸门**，即使后端拦截漏网也只展示 summary。
var ALLOWED_RENDER_CONTENT_SOURCE = 'ai_interpretation'
// v1.2 路线1 + 2026-08-12 修订：官方源（official_rss）落库 content 可能是 AI 解读正文
// （A.4/A.5：解读是加工产物非原文复述，可展示），应渲染 content；仅当 content 为空（解读失败）
// 时降级 summary。R1（FS）已保证 official_rss 的 content 要么是 AI 解读正文要么为空，不会是原文全文。
// v1.2.1 builtin（owner 2026-08-21）：占位欢迎新闻 contentSource='app_intro'，
// 其 content 是「关于一页」功能介绍正文（非 AI 生成），同样允许渲染。
var ALLOWED_RENDER_CONTENT_SOURCES = ['ai_interpretation', 'official_rss', 'app_intro']
var R1_BLOCKED_CONTENT_SOURCE = 'r1_blocked_fulltext'

/**
 * R2 公共函数：按 contentSource 决定详情正文文本
 * @param {Object} news 详情对象（含 content / summary / contentSource / references）
 * @returns {string} 用于 paragraphs 切分的文本
 */
function resolveContentText(news) {
  if (!news) return ''
  var source = news.contentSource || ''
  if (ALLOWED_RENDER_CONTENT_SOURCES.indexOf(source) !== -1) {
    return news.content || news.summary || ''
  }
  // r1_blocked_fulltext / 其他历史全文本 / 兜底：只取 summary
  return news.summary || ''
}

/**
 * 把 app_intro 正文拆成结构化块（标题/正文），供详情页分段美化渲染。
 * 标题判定：短行（≤8 字）且不以句末标点结尾（避免把正文首句误判为标题）。
 */
function buildIntroBlocks(text) {
  var lines = (text || '').split('\n').map(function (l) { return l.trim() }).filter(function (l) { return l })
  return lines.map(function (line) {
    var isTitle = line.length <= 8 && !/[。？！；：…，、]/.test(line)
    return { type: isTitle ? 'title' : 'text', text: line }
  })
}

/**
 * R2 辅助：把任意来源对象规范化为前端使用的"详情文档"
 * 兜底（降级摘要、缓存命中、AI 解读三种路径）一律产出结构一致的 shape，
 * 避免不同路径下字段缺失导致 wxml 渲染分支走错。
 * @param {Object} raw 任意来源的详情/兜底对象
 * @returns {Object} 规范化后的详情
 */
function normalizeDetail(raw) {
  if (!raw) return null
  var normalized = {
    id: raw.id || raw._id || '',
    title: raw.title || '',
    summary: raw.summary || '',
    content: raw.content || '',
    contentSource: raw.contentSource || '',
    category: raw.category || '',
    categoryName: raw.categoryName || '',
    source: raw.source || '',
    // #35 接口 v1 字段：官方源来源名（sourceName），兜底取 source
    sourceName: raw.sourceName || raw.source || '',
    sourceUrl: raw.sourceUrl || '',
    // 一页说：AI 独立观点（owner 2026-08-12 拍板方案 C；FS 经 getNewsDetail 返回，仅非空时前端渲染）
    aiOpinion: raw.aiOpinion || '',
    references: Array.isArray(raw.references) ? raw.references : [],
    picUrl: raw.picUrl || '',
    publishTime: raw.publishTime || raw.time || '',
    // 相对时间展示字段（沿用首页列表形式："X分钟前"），供详情页元信息行渲染
    time: (raw.publishTime || raw.time) ? formatAbsoluteTime(raw.publishTime || raw.time) : '',
  }
  // 兜底场景下若 contentSource 为空，视为 AI 解读（与 R5 兜底语义一致）
  if (!normalized.contentSource && normalized.summary) {
    normalized.contentSource = 'ai_interpretation'
  }
  return normalized
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
  this._entryCategory = options.entryCategory || 'recommend'  // DG-03: 默认 all → recommend
  this._entryIndex = options.entryIndex || 0
  this._entryNewsId = options.entryNewsId || ''
  this._onProgress = options.onProgress || function () {}
  this._onDetailReady = options.onDetailReady || function () {}
  this._onDetailRefresh = options.onDetailRefresh || function () {}
  this._onError = options.onError || function () {}
  this._cache = options.cache || null

  // UX-BUG09: 首页透传数据 — 跳过 init() 网络请求，直接使用预加载列表
  this._preloadedList = options.preloadedList || null
  this._preloadedCategory = options.preloadedCategory || null
  // DG-02: 来源识别（'home' | 'history' | 'favorites' | ''）
  // history/favorites 进入 → 滑动范围=透传列表，禁止跨分类补拉/跳转（需求 R3 + 方案 4）
  this._source = options.source || ''

  // 状态
  this._mergedList = []       // 全分类合并列表 [{ news, category, categoryIndex }]
  this._globalIndex = 0       // 当前在 mergedList 中的位置
  this._total = 0
  this._categoryIndexes = {}  // { categoryId: startIndexInMergedList }
  this._prefetched = {}       // { globalIndex: true } 已预取详情
  // DG-08：入口首次预取延迟（避免进入详情时当前条+预取 5 并发排队）
  this._prefetchDeferred = false
  this._prefetchTimer = null
  // owner 2026-08-20：跨分类列表预取中标记（防并发重复拉取）
  this._prefetchingNext = false
  this._initialized = false
  this._initializing = false
  // BUG-20260806-002：入口新闻未命中标记（收藏/历史旧新闻已失效时禁止回退展示他条）
  this._entryNotFound = false
}

/**
 * 初始化：并行拉取所有分类首页 → 合并 → 定位入口
 * @returns {Promise<void>}
 */
ReadingEngine.prototype.init = function () {
  var that = this
  if (that._initializing) return Promise.resolve()
  that._initializing = true

  // UX-BUG09: 快速通道 — 首页透传了预加载数据，跳过网络请求
  if (that._preloadedList && that._preloadedList.length > 0) {
    return that._initFromPreloaded(that._preloadedList, that._preloadedCategory)
  }

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
 * UX-BUG09: 从首页透传数据构建合并列表（快速通道，零网络请求）
 * @param {Array} preloadedList 首页已加载的新闻列表
 * @param {string} preloadedCategory 首页当前分类
 */
ReadingEngine.prototype._initFromPreloaded = function (preloadedList, preloadedCategory) {
  var that = this
  var seen = {}
  var merged = []
  var indexes = {}
  var entryGlobalIndex = 0
  var foundEntry = false

  // 先将透传分类的数据加入
  var catId = preloadedCategory || that._entryCategory
  indexes[catId] = 0
  for (var i = 0; i < preloadedList.length; i++) {
    var item = preloadedList[i]
    var nid = item.id || item._id
    if (!nid || seen[nid]) continue
    seen[nid] = true
    var entry = {
      id: nid,
      title: item.title || '',
      summary: item.summary || '',
      content: item.content || '',
      category: catId,
      categoryName: item.categoryName || '',
      source: item.source || '',
      sourceUrl: item.sourceUrl || '',
      picUrl: item.picUrl || '',
      time: item.time || '',
      // B-COMPLIANCE-1 FE-2: 首页透传列表也要带合规字段，
      // 避免 mergedList 条目缺失 contentSource/references 导致详情页 UI 不渲染
      contentSource: item.contentSource || '',
      references: Array.isArray(item.references) ? item.references : [],
    }
    merged.push(entry)
    if (nid === that._entryNewsId) {
      entryGlobalIndex = merged.length - 1
      foundEntry = true
    }
  }

  // DG-02（需求 R1/R3）：滑动范围 = 透传列表，禁止后台补拉改范围
  // （原 _fetchRemainingCategories 已删除——补拉导致顺序失控/总数漂移 P1/P2）
  // 未找到入口新闻时用 index 定位
  // BUG-20260806-002：入口新闻 ID 已传入但未命中 → 标记失效，禁止回退展示他条
  if (this._entryNewsId && !foundEntry) {
    this._entryNotFound = true
    entryGlobalIndex = 0
  } else if (!foundEntry && that._entryIndex >= 0 && that._entryIndex < merged.length) {
    entryGlobalIndex = that._entryIndex
  }

  that._mergedList = merged
  that._globalIndex = entryGlobalIndex
  that._total = merged.length  // 总数锁定 = 透传列表长度（P2 修复：不再因补拉漂移）
  that._categoryIndexes = indexes
  that._initialized = true

  return Promise.resolve()
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
        content: item.content || '',
        category: catId,
        categoryName: item.categoryName || '',
        source: item.source || '',
        sourceUrl: item.sourceUrl || '',
        picUrl: item.picUrl || '',
        publishTime: item.publishTime || item.time,
        // B-COMPLIANCE-1 R2：非首页入口路径（直接进详情/跨分类补拉）也要带合规字段
        contentSource: item.contentSource || '',
        references: Array.isArray(item.references) ? item.references : [],
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
  // BUG-20260806-002：入口新闻 ID 已传入但未命中（收藏/历史旧新闻不在列表）→
  // 标记失效，禁止回退展示他条；由上层走单篇模式（getNewsDetail 拉取或提示失效）
  if (this._entryNewsId && !foundEntry) {
    this._entryNotFound = true
    entryGlobalIndex = 0
  } else if (!foundEntry && this._entryCategory) {
    var catStart = indexes[this._entryCategory] || 0
    var catSize = merged.length - catStart
    if (catSize <= 0) {
      // BUG-001: 空分类兜底到首条，而非越界定位到上一分类末条
      entryGlobalIndex = 0
    } else {
      entryGlobalIndex = catStart + Math.min(this._entryIndex, catSize - 1)
    }
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
 * DG-02（需求 R3 + owner 决策②③）：跨分类自动跳转
 * 当前分类已读到末条时，加载下一个有数据的分类首页并追加到 _mergedList。
 * - 顺序：READING_CATEGORIES 固定顺序（recommend→tech→international→science→life）
 * - history/favorites 来源（_source 非空）→ 禁止跨分类（滑动范围=来源列表）
 * @returns {Promise<{hasNext:boolean, category:string, categoryName:string, added:number}>}
 */
ReadingEngine.prototype.loadNextCategory = function () {
  var that = this
  if (that._source) {
    // 来源列表模式：禁止跨分类跳转（需求 R3）
    return Promise.resolve({ hasNext: false, category: '', categoryName: '', added: 0 })
  }
  var cur = that.getCurrent()
  var curCat = cur ? cur.category : ''
  // RQ-20（全部聚合）：'all' 聚合视图已包含所有内容分类，末尾即到底，禁止再补拉。
  // 否则 curCat='all' 不在 READING_CATEGORIES（curIdx=-1）→ 恒取 recommend →
  // 而 recommend 已在聚合列表内 → added=0 → 递归死循环。
  if (curCat === 'all') {
    return Promise.resolve({ hasNext: false, category: '', categoryName: '', added: 0 })
  }
  // 找当前分类在 READING_CATEGORIES 中的位置
  var curIdx = -1
  for (var i = 0; i < READING_CATEGORIES.length; i++) {
    if (READING_CATEGORIES[i].id === curCat) { curIdx = i; break }
  }
  // P1-4 修复：改为"顺序游标推进"——空/失败/全去重时从已尝试分类的下一位置继续，
  // 游标单调递增、深度有界（≤ READING_CATEGORIES.length），Promise 必然 settle。
  // 原实现递归时 curIdx 不推进 → 空分类/全去重场景无限递归（页面卡死 + 请求风暴）。
  function tryFrom(startIdx) {
    var targetCatId = ''
    var targetCatName = ''
    var foundIdx = -1
    for (var j = startIdx + 1; j < READING_CATEGORIES.length; j++) {
      targetCatId = READING_CATEGORIES[j].id
      targetCatName = READING_CATEGORIES[j].name
      foundIdx = j
      break // 取顺序上紧邻的下一分类
    }
    if (!targetCatId || foundIdx < 0) {
      return Promise.resolve({ hasNext: false, category: '', categoryName: '', added: 0 })
    }

    return that._fetchCategoryWithCache(targetCatId).then(function (result) {
      var list = result.list || []
      if (list.length === 0) {
        // 下一分类无数据 → 跳过（owner 决策②③：无数据则跳下下分类）
        return tryFrom(foundIdx)
      }
      // 去重追加
      var seen = {}
      for (var k = 0; k < that._mergedList.length; k++) {
        seen[that._mergedList[k].id] = true
      }
      var added = 0
      var startPos = that._mergedList.length
      that._categoryIndexes[targetCatId] = startPos
      for (var m = 0; m < list.length; m++) {
        var item = list[m]
        var nid = item.id || item._id
        if (!nid || seen[nid]) continue
        seen[nid] = true
        that._mergedList.push({
          id: nid,
          title: item.title || '',
          summary: item.summary || '',
          category: targetCatId,
          categoryName: item.categoryName || targetCatName,
          source: item.source || '',
          sourceUrl: item.sourceUrl || '',
          picUrl: item.picUrl || '',
          publishTime: item.publishTime || item.time,
          // B-COMPLIANCE-1 R2：跨分类补拉也要带合规字段
          contentSource: item.contentSource || '',
          references: Array.isArray(item.references) ? item.references : [],
        })
        added++
      }
      if (added === 0) {
        // 全部去重（罕见）→ 跳过
        return tryFrom(foundIdx)
      }
      that._total = that._mergedList.length
      return { hasNext: true, category: targetCatId, categoryName: targetCatName, added: added }
    })
  }
  return tryFrom(curIdx)
}

/**
 * 预取下一分类列表（owner 2026-08-20）：在当前分类接近末尾时提前调用，
 * 让 loadNextCategory() 在跨分类那一刻能命中已追加的数据，实现零等待跨分类滑动。
 * 幂等：下一分类已在 mergedList / 已在预取中 → 静默返回。
 * @returns {Promise<void>}
 */
ReadingEngine.prototype.prefetchNextCategory = function () {
  var that = this
  if (that._source || that._prefetchingNext) return Promise.resolve()
  var cur = that.getCurrent()
  var curCat = cur ? cur.category : ''
  if (!curCat || curCat === 'all') return Promise.resolve()
  // 下一分类是否已追加（categoryIndexes 里已有 > 当前游标之后的分类起点）
  that._prefetchingNext = true
  return that.loadNextCategory().then(function (res) {
    that._prefetchingNext = false
    return res
  }).catch(function () {
    that._prefetchingNext = false
  })
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

  // 优化（owner 2026-08-16）：内容已存在本地（库/缓存），翻页不应等云端——
  // ① 立即用本地数据渲染（本地缓存 > 列表条目摘要），Promise 立即 resolve，翻页零等待；
  // ② 后台拉取 getNewsDetail 刷新合规字段/全文（写缓存 + 回写 mergedList，
  //    仍在当前页则通过 onDetailRefresh 升级渲染）。
  // 2026-08-21 方案A：getNewsList 已透传完整 AI 解读正文 content——
  // 列表数据直接含全文，首帧即完整解读；aiOpinion 一并带入（详情页观点卡可用）。
  var local = null
  if (that._cache) {
    try { local = that._cache.get('newsDetail:' + cur.id) } catch (e) { local = null }
  }
  var base = local || {
    id: cur.id,
    _id: cur.id,
    title: cur.title,
    summary: cur.summary,
    content: cur.content || cur.summary,
    aiOpinion: cur.aiOpinion || '',
    contentSource: cur.contentSource || 'ai_interpretation',
    category: cur.category,
    categoryName: cur.categoryName,
    source: cur.source,
    sourceUrl: cur.sourceUrl || '',
    references: cur.references || [],
    picUrl: cur.picUrl,
    publishTime: cur.publishTime,
  }
  var normalized = normalizeDetail(base)
  var text = resolveContentText(normalized)
  // app_intro：结构化块供详情页 hero + 分段标题卡片渲染
  if (normalized.contentSource === 'app_intro') {
    normalized.isAppIntro = true
    normalized.introBlocks = buildIntroBlocks(text)
  }
  var paragraphs = text.split('\n').filter(function (p) { return p.trim() })
  that._onDetailReady(normalized, paragraphs)

  // 后台刷新（网络失败静默，不影响已展示内容）
  getNewsDetail(cur.id).then(function (detail) {
    var fresh = normalizeDetail(detail)
    // 回写 mergedList 合规字段（后续翻页/返回/分享图一致）
    if (that._mergedList[that._globalIndex] && that._mergedList[that._globalIndex].id === cur.id) {
      that._mergedList[that._globalIndex].contentSource = fresh.contentSource
      that._mergedList[that._globalIndex].references = fresh.references
      that._mergedList[that._globalIndex].sourceUrl = fresh.sourceUrl || that._mergedList[that._globalIndex].sourceUrl
      that._mergedList[that._globalIndex].content = fresh.content || that._mergedList[that._globalIndex].content
      that._mergedList[that._globalIndex].aiOpinion = fresh.aiOpinion || ''
    }
    if (that._cache) {
      try { that._cache.set('newsDetail:' + cur.id, fresh, { ttl: 24 * 60 * 60 * 1000 }) } catch (e) { /* 忽略 */ }
    }
    // 仍在当前页 → 用最新详情刷新渲染（本地仅摘要兜底时，全文到达后升级显示）
    if (that._onDetailRefresh) {
      var t2 = resolveContentText(fresh)
      var p2 = t2.split('\n').filter(function (p) { return p.trim() })
      if (fresh.contentSource === 'app_intro') {
        fresh.isAppIntro = true
        fresh.introBlocks = buildIntroBlocks(t2)
      }
      that._onDetailRefresh(fresh, p2)
    }
  }).catch(function () { /* 网络失败：保持本地渲染 */ })

  return Promise.resolve({ news: normalized, paragraphs: paragraphs, fromCache: !!local })
}

/**
 * 预取窗口 ±2 条新闻详情（静默，不触发回调）
 */
ReadingEngine.prototype._prefetchWindow = function () {
  var that = this
  var doPrefetch = function () {
    // DG-08：只向后预取 +2（向前几乎用不到），减少并发；预取失败静默，不影响主流程
    var end = Math.min(that._total - 1, that._globalIndex + 2)
    for (var i = that._globalIndex + 1; i <= end; i++) {
      if (that._prefetched[i]) continue      // 已预取
      that._prefetched[i] = true
      var item = that._mergedList[i]
      if (!item) continue
      getNewsDetail(item.id).then(function (detail) {
        // 优化（owner 2026-08-16）：预取结果写缓存——翻页到该条时直接命中本地缓存，秒开
        if (that._cache) {
          try { that._cache.set('newsDetail:' + item.id, normalizeDetail(detail), { ttl: 24 * 60 * 60 * 1000 }) } catch (e) { /* 忽略 */ }
        }
      }).catch(function () {})
    }
  }

  // DG-08：入口首次调用延迟 400ms，避免「当前条 + 预取」并发排队拖慢首帧
  if (!that._prefetchDeferred) {
    that._prefetchDeferred = true
    that._prefetchTimer = setTimeout(function () {
      that._prefetchTimer = null
      doPrefetch()
    }, 400)
    return
  }
  // 翻页期间：立即预取（下一两条尽快就绪）；清掉可能残留的延迟任务
  if (that._prefetchTimer) {
    clearTimeout(that._prefetchTimer)
    that._prefetchTimer = null
  }
  doPrefetch()
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
 * BUG-20260806-002：是否传入了入口新闻 ID
 * @returns {boolean}
 */
ReadingEngine.prototype.hasEntryNewsId = function () {
  return !!this._entryNewsId
}

/**
 * BUG-20260806-002：入口新闻是否在合并列表中命中
 * @returns {boolean} true=命中 / false=未命中（可能已失效）
 */
ReadingEngine.prototype.isEntryFound = function () {
  return !this._entryNotFound
}

/**
 * 获取分类闪烁条颜色（跨分类动画用）
 */
ReadingEngine.prototype.getCategoryFlashColor = function (categoryId) {
  // S6: recommend 已合并到 all；分类闪烁颜色仅用于非 all 分类，all 返回空让 CSS fallback 到 --primary
  var colors = {
    tech:          '#007AFF',
    international: '#5856D6',
    science:        '#FF9500',
    life:          '#34C759',
    // agriculture/science 已于 2026-08-03 按产品 owner 裁定下架
  }
  return colors[categoryId] || ''
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

// PRD §八 R2：公共函数挂到 ReadingEngine 上，detail.js 单篇模式可直接复用
ReadingEngine.resolveContentText = resolveContentText
ReadingEngine.normalizeDetail = normalizeDetail
