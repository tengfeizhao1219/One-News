// 详情页逻辑 — 支持在详情页内上下翻页浏览新闻

const { STATUS_BAR_HEIGHT } = require('../../utils/constants')
const { getNewsDetail } = require('../../utils/request')
const app = getApp()

Page({
  data: {
    statusBarHeight: STATUS_BAR_HEIGHT,
    news: {},
    paragraphs: [],
    scrollTop: 0,
    // 翻页状态
    currentIndex: 0,
    total: 0,
    category: 'all',
    positionText: '',     // 例如 "3 / 20"
    isFirst: true,
    isLast: false,
    loading: false,
    animClass: '',        // 切换动画类
  },

  // 当前分类的新闻列表（来自首页 globalData）
  _list: [],
  // 触摸状态
  _touchStartY: 0,
  _touchStartT: 0,
  _animating: false,

  onLoad(options) {
    const { id, index, category } = options
    const ctx = app.globalData.detailContext
    let list = []
    if (ctx && ctx.category === category && Array.isArray(ctx.list)) {
      list = ctx.list
    }
    this._list = list

    const total = list.length
    let idx = parseInt(index, 10)
    if (isNaN(idx) || idx < 0) idx = 0

    this.setData({
      category,
      total,
      currentIndex: idx,
      isFirst: idx <= 0,
      isLast: total > 0 && idx >= total - 1,
      positionText: total > 0 ? `${idx + 1} / ${total}` : '',
    })

    if (total > 0) {
      this.loadDetailByIndex(idx)
    } else if (id) {
      // 无列表上下文（例如冷启动直达），仅加载单条
      this.loadDetail(id)
    } else {
      wx.showToast({ title: '未找到新闻', icon: 'none' })
    }
  },

  /**
   * 按索引加载某条新闻详情（翻页核心）
   * v9: getNewsDetail 失败时降级使用列表摘要（无需等待 DB 写入）
   */
  async loadDetailByIndex(i) {
    const item = this._list[i]
    if (!item) return
    this.setData({ loading: true })
    const fallback = {
      id: item.id, _id: item._id || item.id,
      title: item.title,
      summary: item.summary || '',
      content: item.summary || '',
      category: item.category, categoryName: item.categoryName || '',
      source: item.source, sourceUrl: item.sourceUrl || '',
      publishTime: item.publishTime,
      picUrl: item.picUrl || '',
    }
    try {
      const news = await getNewsDetail(item.id)
      const text = news.content || news.summary || ''
      const paragraphs = text.split('\n').filter(p => p.trim())
      this.renderDetail(news, paragraphs, i)
    } catch (_) {
      // 云函数未命中：降级用列表摘要渲染
      const text = fallback.content
      const paragraphs = text.split('\n').filter(p => p.trim())
      this.renderDetail(fallback, paragraphs, i)
    }
  },

  renderDetail(news, paragraphs, i) {
    const total = this._list.length
    this.setData({
      news, paragraphs,
      currentIndex: i,
      isFirst: i <= 0,
      isLast: i >= total - 1,
      positionText: `${i + 1} / ${total}`,
      scrollTop: 0,
      loading: false,
    })
  },

  /**
   * 冷启动无列表时的单条加载
   * v9: 失败时降级提示（冷启动无列表无法用摘要兜底）
   */
  async loadDetail(newsId) {
    try {
      wx.showLoading({ title: '加载中...' })
      const news = await getNewsDetail(newsId)
      const text = news.content || news.summary || ''
      const paragraphs = text.split('\n').filter(p => p.trim())
      this.setData({ news, paragraphs, scrollTop: 0 })
      wx.hideLoading()
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '新闻详情暂不可用，请返回重试', icon: 'none' })
    }
  },

  // ============ 翻页手势 ============

  onTouchStart(e) {
    this._touchStartY = e.touches[0].clientY
    this._touchStartT = Date.now()
  },

  onTouchEnd(e) {
    if (this._animating) return
    const dy = e.changedTouches[0].clientY - this._touchStartY
    const dt = Date.now() - this._touchStartT
    // 仅响应「快速滑动」，慢速拖动用 scroll-view 自身滚动
    if (Math.abs(dy) < 70 || dt > 500) return
    if (dy < 0 && !this.data.isLast) {
      this.pageTo(this.data.currentIndex + 1, 'next')
    } else if (dy > 0 && !this.data.isFirst) {
      this.pageTo(this.data.currentIndex - 1, 'prev')
    }
  },

  /**
   * 执行翻页并播放滑动动画
   * @param {number} i   目标索引
   * @param {'next'|'prev'} dir
   */
  pageTo(i, dir) {
    if (this._animating || i < 0 || i >= this._list.length) return
    this._animating = true

    // 1) 当前内容离场
    this.setData({ animClass: dir === 'next' ? 'out-up' : 'out-down' })

    // 2) 动画过半后切换内容并置于入场起始位
    setTimeout(() => {
      this.loadDetailByIndex(i).then(() => {
        this.setData({ animClass: dir === 'next' ? 'in-up' : 'in-down' })
        // 3) 下一帧落位到中心
        setTimeout(() => {
          this.setData({ animClass: '' })
          this._animating = false
        }, 30)
      })
    }, 220)
  },

  // 显式按钮翻页
  goNext() {
    if (!this.data.isLast) this.pageTo(this.data.currentIndex + 1, 'next')
  },
  goPrev() {
    if (!this.data.isFirst) this.pageTo(this.data.currentIndex - 1, 'prev')
  },

  goBack() {
    // 回写阅读位置，便于首页定位
    app.globalData._detailReturnState = {
      category: this.data.category,
      readingIndex: this.data.currentIndex,
    }
    wx.navigateBack()
  },

  // 打开原始新闻链接（复制链接）
  openSourceUrl() {
    const url = this.data.news.sourceUrl
    if (!url) return
    wx.setClipboardData({
      data: url,
      success() {
        wx.showToast({ title: '链接已复制，请在浏览器中打开', icon: 'none', duration: 2500 })
      }
    })
  }
})
