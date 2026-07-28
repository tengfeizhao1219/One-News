// 首页 - 卡片流主视图逻辑

const { CATEGORIES, SWIPE_THRESHOLD, PANEL_SWIPE_THRESHOLD, SWIPE_ANIMATION_MS, STATUS_BAR_HEIGHT, PAGE_HEIGHT, refreshPageSize } = require('../../utils/constants')
const { getNewsList } = require('../../utils/request')

const app = getApp()

Page({
  data: {
    statusBarHeight: STATUS_BAR_HEIGHT,
    newsList: [],           // 所有新闻
    cards: [],              // 卡片渲染数据（仅3张）
    currentIndex: 0,        // 当前卡片索引
    showPanel: false,       // 侧边栏是否显示
    showGuide: true,        // 首次引导
    categories: CATEGORIES,
    currentCategory: 'all',
    filteredNewsList: []    // 侧边栏过滤后的列表
  },

  // 触摸状态
  touchStartY: 0,
  touchStartX: 0,
  isAnimating: false,
  isDragging: false,
  cardOffset: 0,

  onLoad() {
    this.loadNews()
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
      wx.showLoading({ title: '加载中...' })
      const res = await getNewsList({ category: this.data.currentCategory })
      const list = res.list || []

      this.setData({
        newsList: list,
        filteredNewsList: list.map((item, i) => ({ ...item, _originalIndex: i }))
      })

      this.renderCards(list)
      wx.hideLoading()

      setTimeout(() => {
        this.setData({ showGuide: false })
      }, 4000)
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
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

    // 同步 currentIndex（处理越界修正）
    if (idx !== this.data.currentIndex) {
      this.setData({ currentIndex: idx, cards })
    } else {
      this.setData({ cards })
    }
  },

  buildCard(item, position) {
    // transitionClass 控制 CSS transition：有动画时才启用
    return {
      ...item,
      summaryParagraphs: (item.summary || '').split('\n').filter(p => p.trim()),
      state: position === 0 ? 'active' : (position < 0 ? 'above' : 'below'),
      translateY: position === 0 ? 0 : (position < 0 ? -PAGE_HEIGHT : PAGE_HEIGHT),
      transitionClass: ''  // 默认无 transition（手指拖拽时不需要）
    }
  },

  // ============ 触摸事件 ============

  onTouchStart(e) {
    if (this.isAnimating) return
    this.touchStartY = e.touches[0].clientY
    this.touchStartX = e.touches[0].clientX
    this.isDragging = false
    this.cardOffset = 0
  },

  onTouchMove(e) {
    if (this.isAnimating) return
    const dy = e.touches[0].clientY - this.touchStartY
    const dx = e.touches[0].clientX - this.touchStartX

    // 首次判定方向：水平优先 → 左滑面板
    if (!this.isDragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      this.isDragging = true
    }
    if (this.isDragging && Math.abs(dx) > Math.abs(dy)) {
      return
    }

    // 垂直滑动：移除 transition，实时跟手
    if (!this.isDragging && Math.abs(dy) > 5) {
      this.isDragging = true
      // 拖拽开始：禁用 CSS transition（核心修复：避免拖拽时的延迟抖动）
      this.setTransitionEnabled(false)
    }

    if (this.isDragging && Math.abs(dy) > Math.abs(dx)) {
      const maxOffset = 200
      this.cardOffset = Math.max(-maxOffset, Math.min(maxOffset, dy))
      this.updateCardOffset()
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
      // 启用 transition（自动切换动画）
      this.setTransitionEnabled(true)
      this.isAnimating = true
      if (dy < 0) {
        this.swipeNext()
      } else {
        this.swipePrev()
      }
    } else {
      // 回弹：启用 transition 做弹性回弹动画
      this.setTransitionEnabled(true)
      this.resetCardOffset()
      setTimeout(() => this.setTransitionEnabled(false), SWIPE_ANIMATION_MS)
    }
  },

  // 控制卡片的 CSS transition
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

  updateCardOffset() {
    const cards = this.data.cards.map(card => {
      if (card.state === 'active') {
        return { ...card, translateY: this.cardOffset }
      }
      return card
    })
    this.setData({ cards })
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
    this.setData({ showPanel: false })
  },

  onCategoryChange(e) {
    const cat = e.currentTarget.dataset.cat
    this.setData({
      currentCategory: cat,
      showPanel: false
    })
    getNewsList({ category: cat }).then(res => {
      const list = res.list || []
      this.setData({
        newsList: list,
        currentIndex: 0,
        filteredNewsList: list.map((item, i) => ({ ...item, _originalIndex: i }))
      })
      this.renderCards(list)
    }).catch(() => {
      wx.showToast({ title: '加载失败', icon: 'none' })
      this.setData({ showPanel: true })
    })
  },

  onPanelItemTap(e) {
    const idx = e.currentTarget.dataset.index
    const { newsList } = this.data
    if (idx === undefined || idx >= newsList.length) return

    this.setData({
      currentIndex: idx,
      showPanel: false
    })
    this.renderCards(newsList, idx)
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
