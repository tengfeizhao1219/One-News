// 首页 - 卡片流主视图逻辑

const { CATEGORIES, SWIPE_THRESHOLD, PANEL_SWIPE_THRESHOLD, SWIPE_ANIMATION_MS, BOUNCE_ANIMATION_MS, STATUS_BAR_HEIGHT, PAGE_HEIGHT, PAGE_SIZE, refreshPageSize } = require('../../utils/constants')
const { getNewsList, handleApiError } = require('../../utils/request')
const { localCache } = require('../../utils/localCache')

const app = getApp()

// 侧边栏分类列表（纯新闻分类，收藏入口已迁移至 dock 菜单「我的收藏」）
var PANEL_CATEGORIES = CATEGORIES

Page({
  data: {
    statusBarHeight: STATUS_BAR_HEIGHT,
    newsList: [],           // 首页当前分类的新闻
    cards: [],              // 卡片渲染数据（仅3张）
    currentIndex: 0,        // 当前卡片索引
    showPanel: false,       // 侧边栏是否显示
    categories: CATEGORIES,
    panelCategories: PANEL_CATEGORIES,  // 侧边栏分类（仅新闻分类）
    currentCategory: 'all', // 首页当前分类
    panelCategory: 'all',   // 侧边栏当前分类（独立于首页分类）
    panelCurrentIndex: 0,   // 侧边栏中标记的当前阅读位置
    filteredNewsList: [],   // 侧边栏过滤后的列表
    panelSubtitle: '',      // UI-B7：面板头部副标题「当前分类 · N 条」
    favList: [],             // 已废弃：收藏入口已迁移至 dock 菜单独立页
    // 页面状态
    pageState: 'loading',   // 'loading' | 'ready' | 'error' | 'empty'
    errorMessage: '',       // 错误提示文案
    skeletonCount: 3,       // 骨架屏卡片数量
    isRefreshing: false,    // 手动刷新中
    currentPage: 1,         // 当前分页（用于边界加载更多）
    loadingMore: false,    // 边界加载更多/刷新中
    categoryHint: '',      // BUG-20260802-006: 分类切换 0.5s 提示文案
    // 字体面板
    showFontPanel: false,   // 字体面板是否显示
    fontScaleTier: 0,       // 当前字体档位 0-3
    _fontScaleValue: 1,     // CSS --font-scale 数值（由 app 注入）
    _metaScaleValue: 1,     // UX-FIX-F12: 元信息缩放（封顶 1.15），由 app 注入
    // TL-B16: 更多功能菜单
    showMoreMenu: false,    // ⚙ 浮动按钮弹出的 dock 菜单是否展开
  },

  // 触摸状态（JS 层仅记录，渲染由 WXS 处理）
  _touchStartY: 0,
  _touchStartX: 0,
  _isAnimating: false,
  _lastSwipeTime: 0,
  _lastTouchData: null,

  onLoad() {
    // BUG-20260802-004: 侧栏不再独立请求，loadNews 内会由 newsList 派生 filteredNewsList
    this.loadNews()
    // 同步字体档位（由 app._initFontScale 初始化）
    this._syncFontScale()
  },

  onShow() {
    refreshPageSize()

    // B-07: 处理从详情页阅读模式返回的定位
    // 若首页被回收，onLoad 会重新 loadNews；onShow 中需等 loadNews 完成后再定位，
    // 否则 newsList 为空会导致定位失败。
    this._pendingReturnState = null
    var handledNow = this._handleDetailReturn()

    // 如果没有立即处理（数据未就绪），把状态暂存起来，等 loadNews 完成后再处理
    if (!handledNow && app.globalData._detailReturnState) {
      this._pendingReturnState = app.globalData._detailReturnState
      app.globalData._detailReturnState = null
    }

    // 如果不是从详情页返回，正常渲染（保持当前位置）
    if (!handledNow && !this._pendingReturnState && this.data.newsList.length > 0) {
      this.renderCards(this.data.newsList)
    }

    // 同步字体（onShow 时可能从其他页面返回，需刷新）
    this._syncFontScale()
  },

  /**
   * 同步字体档位与 CSS 变量值
   */
  _syncFontScale() {
    var app = getApp()
    var tier = (app && typeof app.globalData.fontScale === 'number') ? app.globalData.fontScale : 0
    var val = (app && typeof app.globalData._fontScaleValue === 'number') ? app.globalData._fontScaleValue : 1
    // UX-FIX-F12: 元信息缩放上限 1.15，globalData 缺失时按 val 封顶兜底
    var metaVal = (app && typeof app.globalData._metaScaleValue === 'number')
      ? app.globalData._metaScaleValue
      : (val > 1.15 ? 1.15 : val)
    if (tier !== this.data.fontScaleTier ||
        val !== this.data._fontScaleValue ||
        metaVal !== this.data._metaScaleValue) {
      this.setData({ fontScaleTier: tier, _fontScaleValue: val, _metaScaleValue: metaVal })
    }
  },

  /**
   * B-07: onShow 时数据未就绪，暂存状态；等 loadNews 完成后调用此方法真正定位
   */
  _handleDetailReturnFromPending() {
    if (!this._pendingReturnState) return
    app.globalData._detailReturnState = this._pendingReturnState
    this._pendingReturnState = null
    this._handleDetailReturn()
  },

  /**
   * B-07: 处理从详情页阅读模式返回后的定位
   * 兼容新旧两种返回格式：
   *   新格式（引擎）: { category, categoryIndex, newsId, total }
   *   旧格式（降级）: { category, readingIndex }
   * 策略：优先用 newsId 精确匹配，其次用 categoryIndex/readingIndex 估算
   */
  _handleDetailReturn() {
    const app = getApp()
    const state = app.globalData._detailReturnState
    if (!state) return false

    // 清除状态，防止重复处理
    app.globalData._detailReturnState = null

    const { category } = state
    var hasNewFormat = typeof state.categoryIndex === 'number'
    var hasOldFormat = typeof state.readingIndex === 'number'

    // 决定目标索引：优先 newsId 精确匹配
    var resolveIndex = function (list) {
      if (!list || list.length === 0) return 0
      // 新格式：用 newsId 精确匹配
      if (hasNewFormat && state.newsId) {
        for (var i = 0; i < list.length; i++) {
          if ((list[i].id || list[i]._id) === state.newsId) return i
        }
      }
      // 旧格式：用 readingIndex
      if (hasOldFormat) {
        return Math.min(state.readingIndex, list.length - 1)
      }
      // 兜底
      return 0
    }

    // 场景 1: 分类没变，直接定位
    if (category === this.data.currentCategory && this.data.newsList.length > 0) {
      var idx = resolveIndex(this.data.newsList)
      this.setData({ currentIndex: idx, panelCategory: category })
      this.renderCards(this.data.newsList, idx)
      return true
    }

    // 场景 2: 分类变了，需要切换分类并加载数据
    if (category && category !== this.data.currentCategory) {
      this.loadCategory(category, resolveIndex)
      return true
    }

    return false
  },

  /**
   * BUG-20260802-004: 切换分类的唯一入口
   * 只发一次 getNewsList → 写入唯一数据源 newsList → 卡片与侧栏同时由它派生，
   * 杜绝原先 loadNews / loadPanelNews 双请求 + _panelCache 造成的数据分叉
   * @param {string} cat 目标分类 id
   * @param {function} [resolveIndex] 可选，从列表解析初始定位下标
   */
  loadCategory(cat, resolveIndex) {
    this.setData({ currentCategory: cat, panelCategory: cat, currentIndex: 0, currentPage: 1 })
    return this.loadNews(resolveIndex)
  },

  /**
   * BUG-20260802-004: 侧栏列表由唯一数据源 newsList 派生（替代已删除的 loadPanelNews/_panelCache）
   * _originalIndex 取自 newsList 下标，保证侧栏点击与「正在阅读」高亮都能对齐卡片
   */
  _syncPanelList(list, index) {
    const src = Array.isArray(list) ? list : (this.data.newsList || [])
    const cat = this.data.currentCategory
    const mapped = src.map(function (item, i) {
      return Object.assign({}, item, { _originalIndex: i })
    })
    // newsList 已按 currentCategory 拉取，'all' 不过滤，其余按 category 过滤（同源保证）
    const filtered = (!cat || cat === 'all')
      ? mapped
      : mapped.filter(function (it) { return it.category === cat })
    this.setData({
      filteredNewsList: filtered,
      panelCurrentIndex: typeof index === 'number' ? index : this.data.currentIndex,
    })
    this._updatePanelSubtitle(cat, filtered.length)
  },

  /**
   * UI-B7：更新面板头部副标题「当前分类 · N 条」
   */
  _updatePanelSubtitle(cat, count) {
    var name = '全部'
    var cats = this.data.categories
    for (var i = 0; i < cats.length; i++) {
      if (cats[i].id === cat) { name = cats[i].name; break }
    }
    var n = typeof count === 'number' ? count : (this.data.filteredNewsList || []).length
    this.setData({ panelSubtitle: name + ' · ' + n + ' 条' })
  },

  /**
   * BUG-20260802-006: 分类切换 ~0.5s 分类名提示
   * 在卡片页可见区域中央短暂展示分类名（面板关闭后/选中卡片时触发）
   */
  _showCategoryHint: function (catId) {
    if (!catId) return
    var name = ''
    var cats = this.data.categories
    for (var i = 0; i < cats.length; i++) {
      if (cats[i].id === catId) { name = cats[i].name; break }
    }
    if (!name) return
    var that = this
    // BUG-20260802-006: 「刷新中…」「加载更多…」用的是 wx.showToast 原生浮层，
    // 它盖在所有页面视图之上，不受 z-index 影响，必须先关掉才能看到分类提示
    try { wx.hideToast() } catch (e) {}
    clearTimeout(this._categoryHintTimer)
    this.setData({ categoryHint: name })
    this._categoryHintTimer = setTimeout(function () {
      if (!that._destroyed) that.setData({ categoryHint: '' })
    }, 500)
  },

  // ============ 数据加载 ============

  async loadNews(resolveIndex) {
    try {
      this.setData({ pageState: 'loading', errorMessage: '' })

      const res = await getNewsList({ category: this.data.currentCategory })
      const list = res.list || []

      if (list.length === 0) {
        this.setData({ newsList: [], cards: [], pageState: 'empty', errorMessage: '暂无新闻，下拉刷新试试' })
        this._syncPanelList([], 0)
        return
      }

      // resolveIndex 由详情页返回定位使用；未传则沿用当前位置（renderCards 内会做边界钳制）
      const idx = typeof resolveIndex === 'function' ? resolveIndex(list) : undefined
      this.setData({ newsList: list, pageState: 'ready', currentPage: 1, loadingMore: false })
      this.renderCards(list, idx)
      // BUG-20260802-004: 卡片渲染后由同一份 newsList 派生侧栏，保证刷新后两侧一致
      this._syncPanelList(list)

      // B-07: 若 onShow 时暂存了详情页返回状态，数据就绪后立即定位
      if (this._pendingReturnState) {
        this._handleDetailReturnFromPending()
      }
    } catch (err) {
      const msg = handleApiError(err.errorCode, err.message)
      this.setData({ pageState: 'error', errorMessage: msg })
    }
  },

  // 下拉刷新（S4 owner 2026-08-02 决策：取消 R 按钮，刷新入口统一为下拉刷新）
  onPullDownRefresh() {
    this._refreshNewsCloud().finally(() => {
      wx.stopPullDownRefresh()
    })
  },

  // 重试加载
  onRetry() {
    this.loadNews()
  },

  /**
   * 云函数强制拉新（S4 取消 R 按钮后改为私有方法，仅由下拉刷新调用）
   */
  async _refreshNewsCloud() {
    if (this.data.isRefreshing) return

    this.setData({ isRefreshing: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'refreshNews',
        data: {},
      })

      if (res.result.code === 0) {
        wx.showToast({
          title: `已更新 ${res.result.data.inserted || 0} 条新闻`,
          icon: 'success',
          duration: 2000,
        })
      } else {
        wx.showToast({
          title: res.result.message || '刷新失败',
          icon: 'none',
        })
      }
    } catch (err) {
      console.error('下拉刷新失败:', err)
      wx.showToast({ title: '刷新失败，请稍后重试', icon: 'none' })
    }

    await this.loadNews()
    this.setData({ isRefreshing: false })
  },

  // ============ 卡片渲染 ============

  /**
   * 渲染卡片数据（仅构建数据，不涉及动画状态）
   * 始终以 targetIndex 为中心生成 3 张卡片
   */
  renderCards(list, targetIndex) {
    const safeList = Array.isArray(list) ? list : []
    const currentIndex = targetIndex !== undefined ? targetIndex : (this.data.currentIndex || 0)
    const total = safeList.length

    if (total === 0) {
      this.setData({ cards: [], currentIndex: 0 })
      return
    }

    const idx = Math.max(0, Math.min(currentIndex, total - 1))
    const cards = []
    if (idx > 0 && safeList[idx - 1]) cards.push(this.buildCard(safeList[idx - 1], -1))
    if (safeList[idx]) cards.push(this.buildCard(safeList[idx], 0))
    if (idx < total - 1 && safeList[idx + 1]) cards.push(this.buildCard(safeList[idx + 1], 1))

    this.setData({ currentIndex: idx, cards })

    // UX-BUG04: 同步侧边栏高亮位置
    if (idx !== this.data.panelCurrentIndex) {
      this.setData({ panelCurrentIndex: idx })
    }
  },

  buildCard(item, position) {
    if (!item) {
      return {
        id: '', title: '', summary: '', summaryParagraphs: [],
        category: '', categoryName: '', source: '', time: '',
        state: position === 0 ? 'active' : (position < 0 ? 'above' : 'below'),
        translateY: position === 0 ? 0 : (position < 0 ? -PAGE_HEIGHT : PAGE_HEIGHT),
        opacity: position === 0 ? 1 : 0, transitionClass: ''
      }
    }

    // v6.2：三档摘要优先级 —— AI 摘要 > 正文摘要 > 标题兜底
    var summarySource = item.summarySource || 'desc'
    var displaySummary = item.summary || ''

    if (summarySource === 'title') {
      // 第三档：没有可用摘要，直接用标题作为显示文本（但不标记为 AI）
      displaySummary = item.title || ''
    }
    // 'ai' / 'desc'：直接使用 item.summary（后端已生成好）

    return {
      ...item,
      summary: displaySummary,
      // 最多取前 3 段，避免摘要过长把卡片撑高、导致标题被居中布局裁切
      summaryParagraphs: displaySummary.split(String.fromCharCode(10)).filter(function (p) { return p.trim() }).slice(0, 3),
      // v6.2：AI 摘要标记（仅 summarySource === 'ai' 时显示胶囊）
      isAiSummary: summarySource === 'ai',
      // 透传来源信息，WXML 按需使用
      summarySource: summarySource,
      state: position === 0 ? 'active' : (position < 0 ? 'above' : 'below'),
      translateY: position === 0 ? 0 : (position < 0 ? -PAGE_HEIGHT : PAGE_HEIGHT),
      opacity: position === 0 ? 1 : 0,
      transitionClass: ''
    }
  },

  // ============ WXS 回调（从 WXS 触摸处理中回调） ============

  /**
   * WXS touchStart 回调 —— 仅记录状态，不做 setData
   */
  onWxsTouchStart(data) {
    try {
      if (this._isAnimating) return
      this._touchStartY = data.startY
      this._touchStartX = data.startX
    } catch (e) {
      console.error('onWxsTouchStart error', e)
    }
  },

  /**
   * WXS touchMove 回调 —— 仅记录偏移，不做 setData
   */
  onWxsTouchMove(data) {
    try {
      this._lastTouchData = data
    } catch (e) {}
  },

  /**
   * WXS touchEnd 回调 —— 执行切换 / 回弹 / 边界加载更多或刷新
   * 异常隔离：任何内部异常都不能楔住手势层（WXS 已先重置自身状态）
   */
  onWxsTouchEnd(data) {
    try {
      if (this._isAnimating) return

      const { dy, dx } = data

      // 左滑呼出面板
      if (dx < -PANEL_SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
        this.setData({ showPanel: true })
        this._resetCardPositions()
        return
      }

      // 垂直滑动：先判断是否触达边界，做加载更多 / 刷新
      if (Math.abs(dy) > SWIPE_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
        const atLast = this.data.currentIndex >= this.data.newsList.length - 1
        const atFirst = this.data.currentIndex <= 0

        if (dy < 0 && atLast) {
          // 已到列表末尾仍上滑 -> 加载更多（获取新的其他新闻）
          this.loadMoreNews()
        } else if (dy > 0 && atFirst) {
          // 已到列表开头仍下滑 -> 刷新当前分类
          this.refreshCurrentCategory()
        } else {
          this._isAnimating = true
          if (dy < 0) this._animateSwipeNext()
          else this._animateSwipePrev()
        }
      } else {
        // 未达阈值，回弹到原位
        this._animateBounceBack()
      }
    } catch (e) {
      console.error('onWxsTouchEnd error', e)
      this._isAnimating = false
    }
  },
  // ============ 动画切换逻辑 ============

  /**
   * 上滑切换到下一条
   * 策略：先给当前 cards 加上 with-transition 并设置目标位置
   * 动画完成后，再重建 cards 并移除 transition
   */
  _animateSwipeNext() {
    const { currentIndex, newsList, cards } = this.data

    if (currentIndex >= newsList.length - 1) {
      // 已是最后一张，回弹
      this._animateBounceBack()
      return
    }

    // 步骤1：给当前 cards 加上 transition，设置目标位置（当前卡移到上方，下一张卡移到中间）
    const animated = cards.map(card => {
      const next = { ...card, transitionClass: 'with-transition' }
      if (card.state === 'active') {
        next.translateY = -PAGE_HEIGHT
        next.opacity = 0
      } else if (card.state === 'below') {
        next.translateY = 0
        next.opacity = 1
        next.state = 'active'
      }
      return next
    })

    this.setData({ cards: animated })
    this._lastSwipeTime = Date.now()

    // 步骤2：动画完成后重建 cards（移除 transition，准备新的目标卡）
    // BUG-20260801-009 修复：使用 this.data.newsList 最新值而非闭包快照
    const newIndex = currentIndex + 1
    setTimeout(() => {
      try {
        this.renderCards(this.data.newsList, newIndex)
      } catch (e) {
        console.error('renderCards failed', e)
      } finally {
        this._isAnimating = false
      }
    }, SWIPE_ANIMATION_MS + 50)
  },

  /**
   * 下滑切换到上一条
   */
  _animateSwipePrev() {
    const { currentIndex, newsList, cards } = this.data

    if (currentIndex <= 0) {
      this._animateBounceBack()
      return
    }

    // 当前卡移到下方，上一张卡移到中间
    const animated = cards.map(card => {
      const next = { ...card, transitionClass: 'with-transition' }
      if (card.state === 'active') {
        next.translateY = PAGE_HEIGHT
        next.opacity = 0
      } else if (card.state === 'above') {
        next.translateY = 0
        next.opacity = 1
        next.state = 'active'
      }
      return next
    })

    this.setData({ cards: animated })
    this._lastSwipeTime = Date.now()

    const newIndex = currentIndex - 1
    // BUG-20260801-009 修复：使用 this.data.newsList 最新值而非闭包快照
    setTimeout(() => {
      try {
        this.renderCards(this.data.newsList, newIndex)
      } catch (e) {
        console.error('renderCards failed', e)
      } finally {
        this._isAnimating = false
      }
    }, SWIPE_ANIMATION_MS + 50)
  },

  /**
   * 回弹动画：卡片回到原位
   */
  _animateBounceBack() {
    const cards = this.data.cards.map(card => {
      const next = { ...card, transitionClass: 'with-transition' }
      if (card.state === 'active') {
        next.translateY = 0
        next.opacity = 1
      } else if (card.state === 'above') {
        next.translateY = -PAGE_HEIGHT
        next.opacity = 0
      } else if (card.state === 'below') {
        next.translateY = PAGE_HEIGHT
        next.opacity = 0
      }
      return next
    })

    this.setData({ cards })

    setTimeout(() => {
      try {
        this._removeTransition()
      } catch (e) {
        console.error('removeTransition failed', e)
      } finally {
        this._isAnimating = false
      }
    }, BOUNCE_ANIMATION_MS + 50)
  },

  /**
   * 重置卡片位置（用于非滑动场景如打开面板）
   */
  _resetCardPositions() {
    const cards = this.data.cards.map(card => {
      const next = { ...card, transitionClass: '' }
      if (card.state === 'active') {
        next.translateY = 0
        next.opacity = 1
      } else if (card.state === 'above') {
        next.translateY = -PAGE_HEIGHT
        next.opacity = 0
      } else if (card.state === 'below') {
        next.translateY = PAGE_HEIGHT
        next.opacity = 0
      }
      return next
    })
    this.setData({ cards })
  },

  /**
   * 移除所有卡片的 transition class
   */
  _removeTransition() {
    const cards = this.data.cards.map(card => ({ ...card, transitionClass: '' }))
    this.setData({ cards })
  },

  // ============ 边界加载更多 / 刷新 ============

  /**
   * 到达列表末尾继续上滑 -> 加载更多新闻并给出反馈
   */
  async loadMoreNews() {
    if (this.data.loadingMore) return
    const { currentCategory, currentPage, newsList } = this.data

    // UX-BUG05: 每分类上限 15 条，达到上限不加载更多
    const MAX_NEWS = 15
    if (newsList.length >= MAX_NEWS) {
      wx.showToast({ title: '已展示全部精选新闻', icon: 'none' })
      return
    }
    this.setData({ loadingMore: true })
    wx.showToast({ title: '加载更多…', icon: 'loading', duration: 800 })
    try {
      const res = await getNewsList({ category: currentCategory, pageNum: currentPage + 1, pageSize: PAGE_SIZE })
      const newItems = res.list || []
      if (newItems.length === 0) {
        wx.showToast({ title: '已经到底啦', icon: 'none' })
        return
      }
      const oldLen = newsList.length
      const merged = newsList.concat(newItems)
      this.setData({ newsList: merged, currentPage: currentPage + 1, currentIndex: oldLen })
      this.renderCards(merged, oldLen)
      // BUG-20260802-004: 新增页也要进侧栏，否则又出现卡片有、侧栏没有
      this._syncPanelList(merged, oldLen)
      setTimeout(() => {
        wx.showToast({ title: '已加载 ' + newItems.length + ' 条', icon: 'none' })
      }, 400)
    } catch (err) {
      wx.showToast({ title: handleApiError(err.errorCode, err.message), icon: 'none' })
    } finally {
      this.setData({ loadingMore: false })
    }
  },

  /**
   * 到达列表开头继续下滑 -> 刷新当前分类并给出反馈
   */
  async refreshCurrentCategory() {
    if (this.data.loadingMore) return
    this.setData({ loadingMore: true })
    wx.showToast({ title: '刷新中…', icon: 'loading', duration: 800 })
    try {
      const res = await getNewsList({ category: this.data.currentCategory, pageNum: 1, pageSize: PAGE_SIZE })
      const list = res.list || []
      this.setData({ newsList: list, currentPage: 1, currentIndex: 0 })
      this.renderCards(list, 0)
      // BUG-20260802-004: 刷新后侧栏随卡片一起更新
      this._syncPanelList(list, 0)
    } catch (err) {
      wx.showToast({ title: handleApiError(err.errorCode, err.message), icon: 'none' })
    } finally {
      this.setData({ loadingMore: false })
    }
  },

  // ============ 导航指示点点击（UX-IMPROVE06） ============

  /**
   * 点击右侧导航点，跳转到对应卡片
   */
  onNavDotTap(e) {
    if (this._isAnimating) return
    var targetIndex = e.currentTarget.dataset.index
    if (targetIndex === undefined) return
    var idx = parseInt(targetIndex)
    if (isNaN(idx) || idx < 0 || idx >= this.data.newsList.length) return
    if (idx === this.data.currentIndex) return

    this._isAnimating = true
    // 判断方向：目标在下方（上滑切换）还是上方（下滑切换）
    if (idx > this.data.currentIndex) {
      this._animateSwipeNext()
    } else {
      this._animateSwipePrev()
    }

    // 由于 _animateSwipeNext/Prev 只移动一步，需要链式跳转
    // 改用直接渲染到目标位置
    var that = this
    this.renderCards(this.data.newsList, idx)
    // 给 WXS 层一个短延迟让它感知到渲染变化
    setTimeout(function () {
      that._isAnimating = false
    }, 50)
  },

  // ============ 卡片点击 ============

  onCardTap(e) {
    if (this._lastSwipeTime && Date.now() - this._lastSwipeTime < 500) {
      return
    }

    const { currentIndex, newsList, currentCategory } = this.data
    const news = newsList[currentIndex]
    if (!news) {
      return
    }

    // 把当前分类的新闻列表交给详情页，支持上下翻页浏览
    app.globalData.detailContext = { category: currentCategory, list: newsList }

    const url = `/pages/detail/detail?id=${news.id}&index=${currentIndex}&category=${currentCategory}`
    wx.navigateTo({
      url: url,
      fail: (err) => console.error('[home] navigateTo fail:', err)
    })
  },

  // ============ 侧边栏 ============

  closePanel() {
    const { panelCategory, currentCategory } = this.data
    // 关闭侧栏时，若侧栏分类与当前首页分类不一致，则切换
    if (panelCategory !== currentCategory) {
      this._showCategoryHint(panelCategory)
      this.loadCategory(panelCategory)
    }
    this.setData({ showPanel: false })
  },

  onCategoryChange(e) {
    var cat = e.currentTarget.dataset.cat
    // UX-BUG03: 立即切换高亮，不等待数据（消除 ~1s 滞后感）
    this.setData({ panelCategory: cat })
    this._updatePanelSubtitle(cat)
    this._showCategoryHint(cat) // BUG-20260802-006: 切分类 0.5s 提示

    // BUG-20260802-004: 侧栏与卡片同源 —— 切分类即切唯一数据源 newsList，侧栏由它派生
    if (cat === this.data.currentCategory) {
      this._syncPanelList()
      return
    }
    this.loadCategory(cat)
  },

  /**
   * UI-B7：左侧分类滚轮 change 事件（RQ-15-D 实时切换 + snap）
   * @param {Object} e - { detail: { category, index } }
   */
  onWheelChange(e) {
    var cat = e.detail && e.detail.category
    if (!cat) return
    if (cat === this.data.panelCategory) {
      this._updatePanelSubtitle(cat)
      return
    }
    this.setData({ panelCategory: cat })
    this._updatePanelSubtitle(cat)

    // 同源切换：面板分类与首页一致 → 仅刷新列表；否则切换唯一数据源
    if (cat === this.data.currentCategory) {
      this._syncPanelList()
      return
    }
    this.loadCategory(cat)
  },

  /**
   * 已废弃：收藏入口已迁移至 dock 菜单独立收藏页（pages/favorites）
   * 原侧边栏「❤️ 收藏」Tab 及其 _loadFavorites() 于 2026-08-04 按 owner 决策删除。
   */

  onPanelItemTap(e) {
    var idx = e.currentTarget.dataset.index

    // 标准分类列表项点击
    // BUG-20260802-003: 选中对应卡片（不再跳转详情页，用户澄清「侧栏标题→跳首页卡片页」）
    // BUG-20260802-004: 侧栏与卡片同源，data-index 即 _originalIndex，可直接作为 newsList 下标
    const { newsList } = this.data
    if (idx === undefined || idx < 0 || idx >= newsList.length) return

    this.setData({ showPanel: false, currentIndex: idx })
    this.renderCards(newsList, idx)
  },

  // ============ 搜索 ============
  // 说明：v8 起取消主动搜索功能，小程序定位为「精选阅读」，不再提供搜索入口。

  // ============ 字体面板 ============

  /**
   * TL-B16: 切换「更多功能」dock 菜单（⚙ 浮动按钮 / 遮罩 皆可触发）
   */
  toggleMoreMenu() {
    this.setData({ showMoreMenu: !this.data.showMoreMenu })
  },

  /**
   * TL-B16: 更多功能菜单项点击分发
   *   history   → 浏览记录页
   *   favorites → 我的收藏页
   *   settings  → 字体设置面板
   *   ext       → 扩展位（占位，敬请期待）
   */
  onMoreMenuTap(e) {
    var target = e.currentTarget.dataset.target
    // 先收起菜单，避免浮层遮挡即将打开的新页面 / 字体面板
    this.setData({ showMoreMenu: false })

    if (target === 'history') {
      wx.navigateTo({
        url: '/pages/history/history',
        fail: function (err) { console.error('[home] navigate history fail:', err) }
      })
    } else if (target === 'favorites') {
      wx.navigateTo({
        url: '/pages/favorites/favorites',
        fail: function (err) { console.error('[home] navigate favorites fail:', err) }
      })
    } else if (target === 'settings') {
      this._syncFontScale()
      this.setData({ showFontPanel: true })
    } else if (target === 'ext') {
      wx.showToast({ title: '敬请期待', icon: 'none' })
    }
  },

  /**
   * 关闭字体面板
   */
  onCloseFontPanel() {
    this.setData({ showFontPanel: false })
  },

  /**
   * 字体档位变更回调（从 font-panel 组件触发）
   */
  onFontPanelChange(e) {
    var tier = e.detail.tier
    this._syncFontScale()
    this.setData({ fontScaleTier: tier })
  },
})
