// 首页 - 卡片流主视图逻辑

const { CATEGORIES, SWIPE_THRESHOLD, PANEL_SWIPE_THRESHOLD, SWIPE_ANIMATION_MS, BOUNCE_ANIMATION_MS, STATUS_BAR_HEIGHT, PAGE_HEIGHT, refreshPageSize } = require('../../utils/constants')
const { getNewsList, handleApiError } = require('../../utils/request')

const app = getApp()

Page({
  data: {
    statusBarHeight: STATUS_BAR_HEIGHT,
    newsList: [],           // 首页当前分类的新闻
    cards: [],              // 卡片渲染数据（仅3张）
    currentIndex: 0,        // 当前卡片索引
    showPanel: false,       // 侧边栏是否显示
    showGuide: true,        // 首次引导
    categories: CATEGORIES,
    currentCategory: 'all', // 首页当前分类
    panelCategory: 'all',   // 侧边栏当前分类（独立于首页分类）
    panelCurrentIndex: 0,   // 侧边栏中标记的当前阅读位置
    filteredNewsList: [],   // 侧边栏过滤后的列表
    // 页面状态
    pageState: 'loading',   // 'loading' | 'ready' | 'error' | 'empty'
    errorMessage: '',       // 错误提示文案
    skeletonCount: 3,       // 骨架屏卡片数量
    isRefreshing: false,    // 手动刷新中
  },

  // 触摸状态（JS 层仅记录，渲染由 WXS 处理）
  _touchStartY: 0,
  _touchStartX: 0,
  _isAnimating: false,
  _lastSwipeTime: 0,

  onLoad() {
    this.loadNews()
    // 侧边栏也加载一份数据（全部新闻）
    this.loadPanelNews()
  },

  onShow() {
    refreshPageSize()
    if (this.data.newsList.length > 0) {
      this.renderCards(this.data.newsList)
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

      this.setData({ newsList: list, pageState: 'ready' })
      this.renderCards(list)

      setTimeout(() => {
        this.setData({ showGuide: false })
      }, 4000)
    } catch (err) {
      const msg = handleApiError(err.errorCode, err.message)
      this.setData({ pageState: 'error', errorMessage: msg })
    }
  },

  // 侧边栏数据加载（全部新闻，独立于首页分类）
  async loadPanelNews(category) {
    const cat = category || 'all'
    try {
      // 侧边栏需要全部数据，不分页
      const res = await getNewsList({ category: cat, pageSize: 100 })
      const list = res.list || []
      this.setData({
        filteredNewsList: list.map((item, i) => ({ ...item, _originalIndex: i })),
        panelCategory: cat
      })
    } catch (err) {
      wx.showToast({ title: handleApiError(err.errorCode, err.message), icon: 'none' })
    }
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

    const { USE_MOCK } = require('../../utils/constants')

    if (USE_MOCK) {
      wx.showToast({ title: '刷新中...', icon: 'loading', duration: 800 })
      setTimeout(async () => {
        await this.loadNews()
        this.setData({ isRefreshing: false })
        wx.showToast({ title: '已刷新', icon: 'success', duration: 1500 })
      }, 500)
      return
    }

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
    const currentIndex = targetIndex !== undefined ? targetIndex : this.data.currentIndex
    const cards = []
    const total = list.length

    if (total === 0) {
      this.setData({ cards: [], currentIndex: 0 })
      return
    }

    const idx = Math.max(0, Math.min(currentIndex, total - 1))

    // 上一张
    if (idx > 0) {
      cards.push(this.buildCard(list[idx - 1], -1))
    }
    // 当前
    cards.push(this.buildCard(list[idx], 0))
    // 下一张
    if (idx < total - 1) {
      cards.push(this.buildCard(list[idx + 1], 1))
    }

    // 一次性更新 currentIndex 和 cards
    this.setData({ currentIndex: idx, cards })
  },

  buildCard(item, position) {
    return {
      ...item,
      summaryParagraphs: (item.summary || '').split('\n').filter(p => p.trim()),
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
    if (this._isAnimating) return
    this._touchStartY = data.startY
    this._touchStartX = data.startX
  },

  /**
   * WXS touchMove 回调 —— 仅记录偏移，不做 setData
   * 渲染由 WXS 的 getTranslateY/getOpacity 直接驱动
   */
  onWxsTouchMove(data) {
    // WXS 已处理渲染，JS 层只需记录当前状态供 touchend 使用
    this._lastTouchData = data
  },

  /**
   * WXS touchEnd 回调 —— 执行切换或回弹
   * 核心策略：先在当前 cards 上做动画，动画完成后再重建 cards
   */
  onWxsTouchEnd(data) {
    if (this._isAnimating) return

    const { dy, dx } = data

    // 左滑呼出面板
    if (dx < -PANEL_SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      this.setData({ showPanel: true })
      this._resetCardPositions()
      return
    }

    // 垂直滑动切换
    if (Math.abs(dy) > SWIPE_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
      this._isAnimating = true
      if (dy < 0) {
        this._animateSwipeNext()
      } else {
        this._animateSwipePrev()
      }
    } else {
      // 回弹到原位
      this._animateBounceBack()
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
      this.renderCards(newsList, newIndex)
      this._isAnimating = false
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
      this.renderCards(newsList, newIndex)
      this._isAnimating = false
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
      this._removeTransition()
      this._isAnimating = false
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

  // ============ 卡片点击 ============

  onCardTap(e) {
    if (this._lastSwipeTime && Date.now() - this._lastSwipeTime < 500) return

    const { currentIndex, newsList } = this.data
    const news = newsList[currentIndex]
    if (!news) return

    wx.navigateTo({
      url: `/pages/detail/detail?id=${news.id}`
    })
  },

  // ============ 侧边栏 ============

  closePanel() {
    const { panelCategory, currentCategory } = this.data
    if (panelCategory !== currentCategory) {
      this.setData({ currentCategory: panelCategory })
      getNewsList({ category: panelCategory }).then(res => {
        const list = res.list || []
        this.setData({ newsList: list, currentIndex: 0 })
        this.renderCards(list)
      })
    }
    this.setData({ showPanel: false })
  },

  onCategoryChange(e) {
    const cat = e.currentTarget.dataset.cat
    this.loadPanelNews(cat)
  },

  onPanelItemTap(e) {
    const idx = e.currentTarget.dataset.index
    const { filteredNewsList } = this.data
    if (idx === undefined || idx >= filteredNewsList.length) return

    const item = filteredNewsList[idx]
    const cat = this.data.panelCategory

    if (cat !== this.data.currentCategory) {
      this.setData({ currentCategory: cat })
      getNewsList({ category: cat }).then(res => {
        const list = res.list || []
        const realIdx = Math.min(idx, list.length - 1)
        this.setData({
          newsList: list,
          currentIndex: realIdx,
          showPanel: false
        })
        this.renderCards(list, realIdx)
      })
    } else {
      this.setData({
        currentIndex: idx,
        showPanel: false
      })
      this.renderCards(this.data.newsList, idx)
    }
  },

  preventMove() {
    return false
  },

  // ============ 搜索 ============

  goSearch() {
    wx.navigateTo({
      url: '/pages/search/search'
    })
  }
})
