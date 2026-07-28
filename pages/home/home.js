// 首页 - 卡片流主视图逻辑

const { CATEGORIES, SWIPE_THRESHOLD, PANEL_SWIPE_THRESHOLD, SWIPE_ANIMATION_MS, STATUS_BAR_HEIGHT, PAGE_HEIGHT } = require('../../utils/constants')
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
  touchCurrentY: 0,
  isAnimating: false,
  cardOffset: 0,           // 当前卡片偏移量（跟随手指）

  onLoad() {
    this.loadNews()
  },

  onShow() {
    // 从详情页/搜索页返回时恢复卡片渲染状态
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

      // 4秒后隐藏引导
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
    // 当传入 targetIndex 时直接使用（规避 setData 异步问题）
    const currentIndex = targetIndex !== undefined ? targetIndex : this.data.currentIndex
    const cards = []
    const total = list.length

    if (total === 0) {
      this.setData({ cards: [] })
      return
    }

    // 确保 currentIndex 不越界
    const idx = Math.max(0, Math.min(currentIndex, total - 1))
    if (idx !== this.data.currentIndex) {
      this.setData({ currentIndex: idx })
    }

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

    this.setData({ cards })
  },

  buildCard(item, position) {
    return {
      ...item,
      summaryParagraphs: (item.summary || '').split('\n').filter(p => p.trim()),
      state: position === 0 ? 'active' : (position < 0 ? 'above' : 'below'),
      translateY: position === 0 ? 0 : (position < 0 ? -PAGE_HEIGHT : PAGE_HEIGHT)
    }
  },

  // ============ 触摸事件 ============

  onTouchStart(e) {
    if (this.isAnimating) return
    this.touchStartY = e.touches[0].clientY
    this.touchStartX = e.touches[0].clientX
    this.touchCurrentY = this.touchStartY
    this.cardOffset = 0
  },

  onTouchMove(e) {
    if (this.isAnimating) return
    const dy = e.touches[0].clientY - this.touchStartY
    const dx = e.touches[0].clientX - this.touchStartX

    // 水平滑动优先（左滑面板）
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 20) {
      return
    }

    // 垂直滑动：限制范围
    const maxOffset = 200
    this.cardOffset = Math.max(-maxOffset, Math.min(maxOffset, dy))
    this.updateCardOffset()
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

    // 垂直滑动切换卡片
    if (Math.abs(dy) > SWIPE_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
      this.isAnimating = true
      if (dy < 0) {
        this.swipeNext()
      } else {
        this.swipePrev()
      }
    } else {
      // 回弹
      this.resetCardOffset()
    }
  },

  swipeNext() {
    const { currentIndex, newsList } = this.data
    if (currentIndex >= newsList.length - 1) {
      this.resetCardOffset()
      this.isAnimating = false
      return
    }
    const newIndex = currentIndex + 1
    this.setData({ currentIndex: newIndex })
    this.renderCards(newsList, newIndex)
    this._lastSwipeTime = Date.now()
    setTimeout(() => { this.isAnimating = false }, SWIPE_ANIMATION_MS)
  },

  swipePrev() {
    const { currentIndex, newsList } = this.data
    if (currentIndex <= 0) {
      this.resetCardOffset()
      this.isAnimating = false
      return
    }
    const newIndex = currentIndex - 1
    this.setData({ currentIndex: newIndex })
    this.renderCards(newsList, newIndex)
    this._lastSwipeTime = Date.now()
    setTimeout(() => { this.isAnimating = false }, SWIPE_ANIMATION_MS)
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
    // 如果刚进行过滑动操作，忽略点击
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
    // 重新加载并切换到第一条
    getNewsList({ category: cat }).then(res => {
      const list = res.list || []
      this.setData({
        newsList: list,
        currentIndex: 0,
        filteredNewsList: list.map((item, i) => ({ ...item, _originalIndex: i }))
      })
      this.renderCards(list)
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
    // 阻止遮罩层滚动穿透
    return false
  }
})
