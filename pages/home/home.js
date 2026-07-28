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

  // 触摸状态
  touchStartY: 0,
  touchStartX: 0,
  isAnimating: false,
  isDragging: false,
  cardOffset: 0,
  // 翻书模式：拖拽时同时移动当前卡和目标卡
  swipeDirection: 0, // 1=上滑(next), -1=下滑(prev), 0=未确定

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
      const res = await getNewsList({ category: cat })
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
  // Mock 模式：直接重新加载数据
  // 云函数模式：调用 refreshNews 触发大模型搜索 → 重新加载
  async onRefreshNews() {
    if (this.data.isRefreshing) return

    this.setData({ isRefreshing: true })

    const { USE_MOCK } = require('../../utils/constants')

    if (USE_MOCK) {
      // Mock 模式：直接重新加载（模拟刷新效果）
      wx.showToast({ title: '刷新中...', icon: 'loading', duration: 800 })
      setTimeout(async () => {
        await this.loadNews()
        this.setData({ isRefreshing: false })
        wx.showToast({ title: '已刷新', icon: 'success', duration: 1500 })
      }, 500)
      return
    }

    // 云函数模式：调用 refreshNews 触发大模型搜索
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

    // 无论刷新成功与否，重新加载新闻列表
    await this.loadNews()
    this.setData({ isRefreshing: false })
  },

  // ============ 卡片渲染 ============

  renderCards(list, targetIndex) {
    const currentIndex = targetIndex !== undefined ? targetIndex : this.data.currentIndex
    const cards = []
    const total = list.length

    if (total === 0) {
      this.setData({ cards: [] })
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

    if (idx !== this.data.currentIndex) {
      this.setData({ currentIndex: idx, cards })
    } else {
      this.setData({ cards })
    }
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

  // ============ 触摸事件（翻书式动画）============

  onTouchStart(e) {
    if (this.isAnimating) return
    this.touchStartY = e.touches[0].clientY
    this.touchStartX = e.touches[0].clientX
    this.isDragging = false
    this.swipeDirection = 0
    this.cardOffset = 0
  },

  onTouchMove(e) {
    if (this.isAnimating) return
    const dy = e.touches[0].clientY - this.touchStartY
    const dx = e.touches[0].clientX - this.touchStartX

    // 水平滑动优先
    if (!this.isDragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      this.isDragging = true
    }
    if (this.isDragging && Math.abs(dx) > Math.abs(dy)) {
      return
    }

    // 垂直滑动：确定方向
    if (!this.isDragging && Math.abs(dy) > 5) {
      this.isDragging = true
      this.swipeDirection = dy < 0 ? 1 : -1  // 上滑=1, 下滑=-1
      this.setTransitionEnabled(false)
    }

    if (this.isDragging && Math.abs(dy) > Math.abs(dx)) {
      const maxOffset = PAGE_HEIGHT
      this.cardOffset = Math.max(-maxOffset, Math.min(maxOffset, dy))
      // 翻书模式：同时移动当前卡和目标卡
      this.updateBookOffset()
    }
  },

  onTouchEnd(e) {
    if (this.isAnimating) return

    const dy = e.changedTouches[0].clientY - this.touchStartY
    const dx = e.changedTouches[0].clientX - this.touchStartX

    // 左滑呼出面板
    if (dx < -PANEL_SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      this.setData({ showPanel: true })
      this.resetCardOffset()
      return
    }

    // 垂直滑动切换
    if (Math.abs(dy) > SWIPE_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
      this.setTransitionEnabled(true)
      this.isAnimating = true
      if (dy < 0) {
        this.swipeNext()
      } else {
        this.swipePrev()
      }
    } else {
      // 回弹
      this.setTransitionEnabled(true)
      this.resetCardOffset()
      setTimeout(() => this.setTransitionEnabled(false), BOUNCE_ANIMATION_MS)
    }
  },

  // 翻书模式：同时移动当前卡片和目标卡片（含 opacity 渐变）
  updateBookOffset() {
    const { cards } = this.data
    const dir = this.swipeDirection
    const progress = Math.min(Math.abs(this.cardOffset) / PAGE_HEIGHT, 1)

    const updated = cards.map(card => {
      if (dir === 1) {
        // 上滑：当前卡上移渐隐，下一张从下方跟随渐显
        if (card.state === 'active') {
          return { ...card, translateY: this.cardOffset, opacity: 1 - progress * 0.4 }
        }
        if (card.state === 'below') {
          return { ...card, translateY: PAGE_HEIGHT + this.cardOffset, opacity: progress }
        }
      } else if (dir === -1) {
        // 下滑：当前卡下移渐隐，上一张从上方跟随渐显
        if (card.state === 'active') {
          return { ...card, translateY: this.cardOffset, opacity: 1 - progress * 0.4 }
        }
        if (card.state === 'above') {
          return { ...card, translateY: -PAGE_HEIGHT + this.cardOffset, opacity: progress }
        }
      }
      return card
    })

    this.setData({ cards: updated })
  },

  setTransitionEnabled(enabled) {
    const cls = enabled ? 'with-transition' : ''
    const cards = this.data.cards.map(card => ({ ...card, transitionClass: cls }))
    this.setData({ cards })
  },

  swipeNext() {
    const { currentIndex, newsList } = this.data
    if (currentIndex >= newsList.length - 1) {
      this.renderCards(newsList, currentIndex)
      this.resetCardOffset()
      this.isAnimating = false
      return
    }
    const newIndex = currentIndex + 1
    this.setData({ currentIndex: newIndex })
    this.renderCards(newsList, newIndex)
    this._lastSwipeTime = Date.now()
    setTimeout(() => {
      this.isAnimating = false
      this.setTransitionEnabled(false)
    }, SWIPE_ANIMATION_MS)
  },

  swipePrev() {
    const { currentIndex, newsList } = this.data
    if (currentIndex <= 0) {
      this.renderCards(newsList, currentIndex)
      this.resetCardOffset()
      this.isAnimating = false
      return
    }
    const newIndex = currentIndex - 1
    this.setData({ currentIndex: newIndex })
    this.renderCards(newsList, newIndex)
    this._lastSwipeTime = Date.now()
    setTimeout(() => {
      this.isAnimating = false
      this.setTransitionEnabled(false)
    }, SWIPE_ANIMATION_MS)
  },

  resetCardOffset() {
    const cards = this.data.cards.map(card => {
      if (card.state === 'active') return { ...card, translateY: 0 }
      if (card.state === 'above') return { ...card, translateY: -PAGE_HEIGHT }
      if (card.state === 'below') return { ...card, translateY: PAGE_HEIGHT }
      return card
    })
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
    // 关闭面板时，将面板分类同步到首页（如果不同）
    const { panelCategory, currentCategory } = this.data
    if (panelCategory !== currentCategory) {
      this.setData({ currentCategory: panelCategory })
      // 重新加载首页数据
      getNewsList({ category: panelCategory }).then(res => {
        const list = res.list || []
        this.setData({ newsList: list, currentIndex: 0 })
        this.renderCards(list)
      })
    }
    this.setData({ showPanel: false })
  },

  // 侧边栏分类切换 —— 不关闭面板，仅更新列表
  onCategoryChange(e) {
    const cat = e.currentTarget.dataset.cat
    this.loadPanelNews(cat)
  },

  // 侧边栏列表项点击 —— 关闭面板，跳转到对应新闻
  onPanelItemTap(e) {
    const idx = e.currentTarget.dataset.index
    const { filteredNewsList } = this.data
    if (idx === undefined || idx >= filteredNewsList.length) return

    const item = filteredNewsList[idx]
    // 使用面板分类和对应数据
    const cat = this.data.panelCategory

    // 如果面板分类和首页分类不同，先切换首页分类
    if (cat !== this.data.currentCategory) {
      this.setData({ currentCategory: cat })
      getNewsList({ category: cat }).then(res => {
        const list = res.list || []
        // 找到对应新闻在完整列表中的索引
        const realIdx = Math.min(idx, list.length - 1)
        this.setData({
          newsList: list,
          currentIndex: realIdx,
          showPanel: false
        })
        this.renderCards(list, realIdx)
      })
    } else {
      // 同一分类，直接跳转
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
