// 首页 - 卡片流主视图逻辑

const { CATEGORIES, SWIPE_THRESHOLD, PANEL_SWIPE_THRESHOLD, SWIPE_ANIMATION_MS, BOUNCE_ANIMATION_MS, STATUS_BAR_HEIGHT, PAGE_HEIGHT, PAGE_SIZE, refreshPageSize } = require('../../utils/constants')
const { getNewsList, handleApiError } = require('../../utils/request')
const { localCache } = require('../../utils/localCache')

const app = getApp()

// 侧边栏分类列表（标准 8 分类 + 收藏 Tab）
var PANEL_CATEGORIES = CATEGORIES.concat([{ id: '__favorites__', name: '❤️ 收藏' }])

Page({
  data: {
    statusBarHeight: STATUS_BAR_HEIGHT,
    newsList: [],           // 首页当前分类的新闻
    cards: [],              // 卡片渲染数据（仅3张）
    currentIndex: 0,        // 当前卡片索引
    showPanel: false,       // 侧边栏是否显示
    showGuide: true,        // 首次引导
    categories: CATEGORIES,
    panelCategories: PANEL_CATEGORIES,  // B-04: 侧边栏分类（含收藏 Tab）
    currentCategory: 'all', // 首页当前分类
    panelCategory: 'all',   // 侧边栏当前分类（独立于首页分类）
    panelCurrentIndex: 0,   // 侧边栏中标记的当前阅读位置
    filteredNewsList: [],   // 侧边栏过滤后的列表
    favList: [],             // B-04: 收藏列表
    // 页面状态
    pageState: 'loading',   // 'loading' | 'ready' | 'error' | 'empty'
    errorMessage: '',       // 错误提示文案
    skeletonCount: 3,       // 骨架屏卡片数量
    isRefreshing: false,    // 手动刷新中
    currentPage: 1,         // 当前分页（用于边界加载更多）
    loadingMore: false,     // 边界加载更多/刷新中
    // 字体面板
    showFontPanel: false,   // 字体面板是否显示
    fontScaleTier: 0,       // 当前字体档位 0-3
    _fontScaleValue: 1,     // CSS --font-scale 数值（由 app 注入）
  },

  // 触摸状态（JS 层仅记录，渲染由 WXS 处理）
  _touchStartY: 0,
  _touchStartX: 0,
  _isAnimating: false,
  _lastSwipeTime: 0,
  _lastTouchData: null,

  onLoad() {
    this.loadNews()
    // 侧边栏也加载一份数据（全部新闻）
    this.loadPanelNews()
    // UX-BUG13: 并行预加载所有分类到 _panelCache，消除首次切换 ~1s 等待
    this._preloadAllCategories()
    // 同步字体档位（由 app._initFontScale 初始化）
    this._syncFontScale()
  },

  onShow() {
    refreshPageSize()
    if (this.data.newsList.length > 0) {
      this.renderCards(this.data.newsList)
    }

    // 处理从详情页（阅读模式）返回的定位信息
    this._handleDetailReturn()
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
    if (tier !== this.data.fontScaleTier || val !== this.data._fontScaleValue) {
      this.setData({ fontScaleTier: tier, _fontScaleValue: val })
    }
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
    if (!state) return

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
      if (idx !== this.data.currentIndex) {
        this.setData({ currentIndex: idx, panelCategory: category })
        this.renderCards(this.data.newsList, idx)
      }
      return
    }

    // 场景 2: 分类变了，需要切换分类并加载数据
    if (category && category !== this.data.currentCategory) {
      this.setData({ currentCategory: category, panelCategory: category })
      getNewsList({ category: category }).then(function (res) {
        var list = res.list || []
        var idx = resolveIndex(list)
        this.setData({ newsList: list, currentIndex: idx, currentPage: 1, loadingMore: false })
        this.renderCards(list, idx)
      }.bind(this)).catch(function () {
        // 加载失败，保持当前状态
      })
    }
  },

  // ============ 数据加载 ============

  async loadNews() {
    try {
      this.setData({ pageState: 'loading', errorMessage: '' })

      const res = await getNewsList({ category: this.data.currentCategory })
      const list = res.list || []

      if (list.length === 0) {
        this.setData({ newsList: [], cards: [], pageState: 'empty', errorMessage: '暂无新闻，下拉刷新试试' })
        return
      }

      this.setData({ newsList: list, pageState: 'ready', currentPage: 1 })
      this.renderCards(list)

      setTimeout(() => {
        this.setData({ showGuide: false })
      }, 4000)
    } catch (err) {
      const msg = handleApiError(err.errorCode, err.message)
      this.setData({ pageState: 'error', errorMessage: msg })
    }
  },

  // UX-BUG03: 侧边栏分类数据内存缓存
  _panelCache: {},

  // 侧边栏数据加载（全部新闻，独立于首页分类）—— 带缓存
  async loadPanelNews(category) {
    const cat = category || 'all'
    var that = this

    // UX-BUG03: 优先读取内存缓存，命中则跳过云函数调用
    if (this._panelCache[cat]) {
      this.setData({
        filteredNewsList: this._panelCache[cat],
        panelCategory: cat
      })
      return
    }

    try {
      // 侧边栏需要全部数据，不分页
      const res = await getNewsList({ category: cat, pageSize: PAGE_SIZE })
      const list = res.list || []
      var mapped = list.map(function (item, i) { return Object.assign({}, item, { _originalIndex: i }) })

      // UX-BUG03: 写入缓存
      that._panelCache[cat] = mapped

      this.setData({
        filteredNewsList: mapped,
        panelCategory: cat
      })
    } catch (err) {
      wx.showToast({ title: handleApiError(err.errorCode, err.message), icon: 'none' })
    }
  },

  /**
   * UX-BUG13: 预加载所有分类到 _panelCache
   * onLoad 时并行发起，切换分类时零等待
   */
  _preloadAllCategories: function () {
    var that = this
    // 获取除「收藏」外的所有分类 ID
    var catIds = CATEGORIES.map(function (c) { return c.id })
    // 'all' 已经在 loadPanelNews 中加载，跳过
    // 并行请求其余分类
    catIds.forEach(function (cat) {
      if (cat === 'all') return  // 已加载
      getNewsList({ category: cat, pageSize: PAGE_SIZE }).then(function (res) {
        var list = res.list || []
        var mapped = list.map(function (item, i) { return Object.assign({}, item, { _originalIndex: i }) })
        that._panelCache[cat] = mapped
      }).catch(function () {
        // 预加载失败静默降级，首次切换时走正常加载流程
      })
    })
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.loadNews().then(() => {
      wx.stopPullDownRefresh()
    })
  },

  // 重试加载
  onRetry() {
    this.loadNews()
  },

  // 手动刷新新闻
  async onRefreshNews() {
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
      console.error('手动刷新失败:', err)
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
    const summary = item.summary || ''
    return {
      ...item,
      // 最多取前 3 段，避免摘要过长把卡片撑高、导致标题被居中布局裁切
      summaryParagraphs: summary.split(String.fromCharCode(10)).filter(p => p.trim()).slice(0, 3),
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
    const newIndex = currentIndex + 1
    setTimeout(() => {
      try {
        this.renderCards(newsList, newIndex)
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
    setTimeout(() => {
      try {
        this.renderCards(newsList, newIndex)
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
    if (panelCategory !== currentCategory) {
      this.setData({ currentCategory: panelCategory })
      getNewsList({ category: panelCategory }).then(res => {
        const list = res.list || []
        this.setData({ newsList: list, currentIndex: 0, currentPage: 1, loadingMore: false })
        this.renderCards(list)
      })
    }
    this.setData({ showPanel: false })
  },

  onCategoryChange(e) {
    var cat = e.currentTarget.dataset.cat
    // UX-BUG03: 立即切换高亮，不等待数据（消除 ~1s 滞后感）
    this.setData({ panelCategory: cat })

    // B-04: 收藏 Tab 特殊处理（同步读取，无网络延迟）
    if (cat === '__favorites__') {
      this._loadFavorites()
      return
    }
    this.loadPanelNews(cat)
  },

  /**
   * B-04: 从 localCache 加载收藏列表
   */
  _loadFavorites: function () {
    var favorites = localCache.get('favorites') || []
    // 计算相对时间
    var now = Date.now()
    var list = favorites.map(function (item) {
      var diff = now - (item.addedAt || 0)
      var timeAgo = ''
      if (diff < 60 * 1000) {
        timeAgo = '刚刚'
      } else if (diff < 60 * 60 * 1000) {
        timeAgo = Math.floor(diff / (60 * 1000)) + '分钟前'
      } else if (diff < 24 * 60 * 60 * 1000) {
        timeAgo = Math.floor(diff / (60 * 60 * 1000)) + '小时前'
      } else {
        timeAgo = Math.floor(diff / (24 * 60 * 60 * 1000)) + '天前'
      }
      return Object.assign({}, item, { _timeAgo: timeAgo })
    })
    this.setData({
      panelCategory: '__favorites__',
      favList: list,
    })
  },

  onPanelItemTap(e) {
    var idx = e.currentTarget.dataset.index
    var isFav = e.currentTarget.dataset.isFav

    // B-04: 收藏列表项点击 → 直接跳转详情页
    if (isFav) {
      var favItem = this.data.favList[idx]
      if (!favItem) return
      // 设置详情页上下文（收藏列表作为阅读上下文）
      app.globalData.detailContext = { category: favItem.category, list: this.data.favList }
      var url = '/pages/detail/detail?id=' + favItem.id + '&index=' + idx + '&category=' + (favItem.category || 'recommend')
      wx.navigateTo({
        url: url,
        fail: function (err) { console.error('[home] navigateTo fav fail:', err) }
      })
      return
    }

    // 标准分类列表项点击（UX-BUG08: 直接跳转到对应新闻的详情页）
    const { filteredNewsList } = this.data
    if (idx === undefined || idx >= filteredNewsList.length) return

    const item = filteredNewsList[idx]
    const cat = this.data.panelCategory
    const newsId = item.id || item._id
    if (!newsId) return

    // 先关闭面板
    this.setData({ showPanel: false })

    // 设置详情页上下文
    if (cat !== this.data.currentCategory) {
      this.setData({ currentCategory: cat })
      app.globalData.detailContext = { category: cat, list: [] }
    } else {
      app.globalData.detailContext = { category: cat, list: this.data.newsList }
    }

    // 跳转详情页
    var url = '/pages/detail/detail?id=' + newsId + '&index=' + idx + '&category=' + cat
    wx.navigateTo({
      url: url,
      fail: function (err) { console.error('[home] navigateTo panel fail:', err) }
    })
  },

  // ============ 搜索 ============
  // 说明：v8 起取消主动搜索功能，小程序定位为「精选阅读」，不再提供搜索入口。

  // ============ 字体面板 ============

  /**
   * 打开字体设置面板
   */
  onOpenSettings() {
    this._syncFontScale()
    this.setData({ showFontPanel: true })
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
