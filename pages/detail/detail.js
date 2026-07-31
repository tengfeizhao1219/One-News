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
    // 收藏
    isFavorited: false,   // 当前新闻是否已收藏
    heartAnim: false,     // 收藏按钮动画状态
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
    // 检查收藏状态
    if (news && news.id) {
      this._checkFavorite(news.id)
    }
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

  // ============ 分享 ============

  /**
   * 微信原生分享（button open-type="share" 触发）
   * 转发卡片：标题（≤30字）+ 封面图/分类占位图 + path 可回看
   */
  onShareAppMessage() {
    var news = this.data.news || {}
    var title = news.title || '一页 · 新闻速览'
    // 截断 ≤ 30 中文字符
    if (title.length > 30) {
      title = title.slice(0, 29) + '\u2026'
    }
    title = '一页 | ' + title

    var path = '/pages/detail/detail'
    if (news.id) {
      path += '?id=' + news.id + '&index=' + this.data.currentIndex + '&category=' + this.data.category
    }

    // 有图用图，无图用占位（由 share-card 组件预生成）
    var imageUrl = news.picUrl || ''
    var that = this
    if (!imageUrl) {
      // 尝试从组件获取占位图
      try {
        var isDark = this._isSystemDark()
        var shareComp = this.selectComponent('#share-card')
        if (shareComp && shareComp.generateImage) {
          // 同步生成（微信 onShareAppMessage 不支持异步 Promise）
          // 用默认占位兜底
          imageUrl = this._getDefaultPlaceholder(news.category, isDark)
        } else {
          imageUrl = ''
        }
      } catch (e) {
        imageUrl = ''
      }
    }

    return {
      title: title,
      path: path,
      imageUrl: imageUrl || undefined,
    }
  },

  /**
   * 判断系统是否暗色模式
   */
  _isSystemDark: function () {
    try {
      var info = wx.getSystemInfoSync()
      return info.theme === 'dark'
    } catch (e) {
      return false
    }
  },

  /**
   * 返回默认分类占位（无法使用 Canvas 时的 fallback）
   * 微信小程序 onShareAppMessage 不支持异步，Canvas 2d 需要异步获取 node
   * 实际场景中 imageUrl 为空时微信会使用默认小程序图标
   */
  _getDefaultPlaceholder: function (category, isDark) {
    return ''
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
  },

  // ============ 收藏（UI 层，持久化待 B-04 完整实现） ============

  /**
   * 检查当前新闻是否已收藏（从 storage 读取）
   */
  _checkFavorite(newsId) {
    try {
      var favorites = wx.getStorageSync('favorites') || []
      var found = false
      for (var i = 0; i < favorites.length; i++) {
        if (favorites[i].id === newsId) { found = true; break }
      }
      this.setData({ isFavorited: found })
    } catch (e) {
      this.setData({ isFavorited: false })
    }
  },

  /**
   * 收藏 / 取消收藏切换
   */
  onToggleFavorite() {
    var news = this.data.news
    if (!news || !news.id) return

    var isFav = this.data.isFavorited
    try {
      var favorites = wx.getStorageSync('favorites') || []

      if (isFav) {
        // 取消收藏
        favorites = favorites.filter(function (f) { return f.id !== news.id })
        wx.setStorageSync('favorites', favorites)
        this.setData({ isFavorited: false })
      } else {
        // 添加收藏（容量上限 200）
        if (favorites.length >= 200) {
          wx.showToast({ title: '收藏已满，请清理后重试', icon: 'none' })
          return
        }
        // 幂等保护
        var exists = false
        for (var i = 0; i < favorites.length; i++) {
          if (favorites[i].id === news.id) { exists = true; break }
        }
        if (!exists) {
          favorites.unshift({
            id: news.id,
            title: news.title || '',
            category: news.category || '',
            categoryName: news.categoryName || '',
            source: news.source || '',
            picUrl: news.picUrl || '',
            addedAt: Date.now(),
          })
          wx.setStorageSync('favorites', favorites)
        }
        // heartBeat 动画
        this.setData({ isFavorited: true, heartAnim: true })
        var that = this
        setTimeout(function () { that.setData({ heartAnim: false }) }, 350)
      }
    } catch (e) {
      wx.showToast({ title: isFav ? '取消收藏失败' : '收藏失败，请稍后重试', icon: 'none' })
    }
  },
})
