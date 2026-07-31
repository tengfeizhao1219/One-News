// 详情页逻辑 — 跨分类阅读模式（B-01）+ 分享（B-05）+ 收藏 UI（B-04）
// ============================================================
// B-01：方案 A（全量预拉），进入详情时并行拉取 7 分类首页，
//       合并为 mergedList → 跨分类上下滑翻页 + 进度指示 + 分类闪烁条 + 边界提示
//       B-06 localCache 缓存注入：分类列表 10min / 详情 30min
// B-04：收藏功能 — 基于 localCache 读写，容量 200，heartBeat 动画
// B-05：底部操作栏（收藏♡/♥ + 分享↗）+ onShareAppMessage
// ============================================================

var STATUS_BAR_HEIGHT = require('../../utils/constants').STATUS_BAR_HEIGHT
var getNewsDetail = require('../../utils/request').getNewsDetail
var ReadingEngine = require('./reading-engine')
var LocalCache = require('../../utils/localCache').LocalCache
var app = getApp()

// 全局缓存实例（引擎内部复用）
var _cache = new LocalCache({ maxItems: 500, defaultTTL: 7 * 24 * 60 * 60 * 1000 })

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
    positionText: '',
    isFirst: true,
    isLast: false,
    loading: false,
    animClass: '',
    // 跨分类视觉
    showCrossingCategory: '',  // 进度指示中的分类名
    flashVisible: false,       // 闪烁条可见
    flashColor: '#007AFF',     // 闪烁条颜色
    // 边界提示
    boundaryVisible: false,
    boundaryText: '',
    boundaryAction: '',        // 'back' 表示可点击返回
    // 网络兜底
    networkToastVisible: false,
    // 收藏
    isFavorited: false,
    heartAnim: false,
  },

  // 引擎实例
  _engine: null,
  // 触摸状态
  _touchStartY: 0,
  _touchStartT: 0,
  _animating: false,

  // ============ 生命周期 ============

  onLoad: function (options) {
    var id = options.id
    var index = parseInt(options.index, 10) || 0
    var category = options.category || 'recommend'

    this.setData({ category: category, currentIndex: index })

    // 初始化跨分类阅读引擎（方案 A：全量预拉 + localCache 缓存注入）
    this._initEngine(id, index, category)
  },

  /**
   * 初始化跨分类阅读引擎（B-01 + B-06 缓存注入）
   */
  _initEngine: function (newsId, entryIndex, entryCategory) {
    var that = this
    wx.showLoading({ title: '加载中...', mask: true })

    var engine = new ReadingEngine({
      entryCategory: entryCategory,
      entryIndex: entryIndex,
      entryNewsId: newsId,
      cache: _cache,  // B-06: 注入 localCache 实例
      onProgress: function (info) {
        // 进度回调（引擎 init 完成时触发）
        that.setData({
          currentIndex: info.index,
          total: info.total,
          category: info.category,
          positionText: info.positionText,
          isFirst: info.index <= 0,
          isLast: info.index >= info.total - 1,
        })
      },
      onDetailReady: function (news, paragraphs) {
        that.setData({
          news: news,
          paragraphs: paragraphs,
          scrollTop: 0,
          loading: false,
        })
        if (news && news.id) {
          that._checkFavorite(news.id)
        }
      },
      onError: function (msg) {
        wx.hideLoading()
        wx.showToast({ title: msg || '加载失败', icon: 'none' })
      },
    })

    that._engine = engine

    engine.init().then(function () {
      var progress = engine.getProgress()
      that.setData({
        currentIndex: progress.index,
        total: progress.total,
        category: progress.category,
        positionText: progress.positionText,
        isFirst: engine.isFirst(),
        isLast: engine.isLast(),
      })

      // 加载入口新闻详情
      return engine.loadCurrentDetail()
    }).then(function () {
      wx.hideLoading()
    }).catch(function () {
      wx.hideLoading()
      // 降级：尝试直接加载单条
      that._loadFallback(newsId)
    })
  },

  /**
   * 降级加载（引擎初始化失败时）
   */
  _loadFallback: function (newsId) {
    var that = this
    if (!newsId) {
      wx.showToast({ title: '新闻加载失败', icon: 'none' })
      return
    }
    getNewsDetail(newsId).then(function (news) {
      var text = news.content || news.summary || ''
      var paragraphs = text.split('\n').filter(function (p) { return p.trim() })
      that.setData({
        news: news,
        paragraphs: paragraphs,
        total: 1,
        currentIndex: 0,
        isFirst: true,
        isLast: true,
        positionText: '1 / 1',
        scrollTop: 0,
        loading: false,
      })
      if (news && news.id) that._checkFavorite(news.id)
    }).catch(function () {
      wx.showToast({ title: '新闻详情暂不可用，请返回重试', icon: 'none' })
    })
  },

  // ============ 翻页手势 ============

  onTouchStart: function (e) {
    this._touchStartY = e.touches[0].clientY
    this._touchStartT = Date.now()
  },

  onTouchEnd: function (e) {
    if (this._animating || !this._engine) return
    var dy = e.changedTouches[0].clientY - this._touchStartY
    var dt = Date.now() - this._touchStartT
    if (Math.abs(dy) < 70 || dt > 500) return

    if (dy < 0 && !this.data.isLast) {
      this._swipeToNext()
    } else if (dy > 0 && !this.data.isFirst) {
      this._swipeToPrev()
    } else if (dy < 0 && this.data.isLast) {
      this._showBoundary('已经是最后一条 · ← 返回首页', 'back')
    } else if (dy > 0 && this.data.isFirst) {
      this._showBoundary('已经是第一条 · 上滑返回', '')
    }
  },

  // ============ 跨分类翻页 ============

  /**
   * 上滑 → 下一条（可能跨分类）
   */
  _swipeToNext: function () {
    var that = this
    if (that._animating || !that._engine) return
    that._animating = true

    var result = that._engine.goNext()
    if (!result.canGo) {
      that._animating = false
      if (result.reason === 'last') {
        that._showBoundary('已经是最后一条 · ← 返回首页', 'back')
      }
      return
    }

    // 跨分类闪烁条
    if (result.isCrossing) {
      that._showFlash(result.crossingCategory)
    }

    // 更新进度
    var progress = that._engine.getProgress()
    that.setData({
      currentIndex: progress.index,
      total: progress.total,
      category: progress.category,
      positionText: progress.positionText,
      isFirst: that._engine.isFirst(),
      isLast: that._engine.isLast(),
      showCrossingCategory: result.isCrossing ? progress.categoryName : '',
      animClass: 'out-up',
    })

    // 加载内容
    setTimeout(function () {
      that._engine.loadCurrentDetail().then(function () {
        that.setData({ animClass: 'in-up' })
        setTimeout(function () {
          that.setData({ animClass: '', showCrossingCategory: '' })
          that._animating = false
        }, 30)
      }).catch(function () {
        that.setData({ animClass: '' })
        that._animating = false
        that._showNetworkToast()
      })
    }, 220)
  },

  /**
   * 下滑 → 上一条（可能跨分类）
   */
  _swipeToPrev: function () {
    var that = this
    if (that._animating || !that._engine) return
    that._animating = true

    var result = that._engine.goPrev()
    if (!result.canGo) {
      that._animating = false
      if (result.reason === 'first') {
        that._showBoundary('已经是第一条 · 上滑返回', '')
      }
      return
    }

    if (result.isCrossing) {
      that._showFlash(result.crossingCategory)
    }

    var progress = that._engine.getProgress()
    that.setData({
      currentIndex: progress.index,
      total: progress.total,
      category: progress.category,
      positionText: progress.positionText,
      isFirst: that._engine.isFirst(),
      isLast: that._engine.isLast(),
      showCrossingCategory: result.isCrossing ? progress.categoryName : '',
      animClass: 'out-down',
    })

    setTimeout(function () {
      that._engine.loadCurrentDetail().then(function () {
        that.setData({ animClass: 'in-down' })
        setTimeout(function () {
          that.setData({ animClass: '', showCrossingCategory: '' })
          that._animating = false
        }, 30)
      }).catch(function () {
        that.setData({ animClass: '' })
        that._animating = false
        that._showNetworkToast()
      })
    }, 220)
  },

  // 按钮翻页
  goNext: function () {
    if (!this.data.isLast) this._swipeToNext()
  },
  goPrev: function () {
    if (!this.data.isFirst) this._swipeToPrev()
  },

  // ============ 跨分类视觉 ============

  /**
   * 分类闪烁条（200ms）
   */
  _showFlash: function (categoryId) {
    var that = this
    var color = this._engine ? this._engine.getCategoryFlashColor(categoryId) : '#007AFF'
    this.setData({ flashVisible: true, flashColor: color })
    setTimeout(function () {
      that.setData({ flashVisible: false })
    }, 200)
  },

  /**
   * 边界提示 Chip（2s 自动消失）
   */
  _showBoundary: function (text, action) {
    var that = this
    this.setData({ boundaryVisible: true, boundaryText: text, boundaryAction: action || '' })
    clearTimeout(this._boundaryTimer)
    this._boundaryTimer = setTimeout(function () {
      that.setData({ boundaryVisible: false })
    }, 2000)
  },

  /**
   * 网络兜底 Toast（3s 自动消失）
   */
  _showNetworkToast: function () {
    var that = this
    this.setData({ networkToastVisible: true })
    clearTimeout(this._networkTimer)
    this._networkTimer = setTimeout(function () {
      that.setData({ networkToastVisible: false })
    }, 3000)
  },

  // ============ 返回 ============

  goBack: function () {
    // B-07: 回写阅读位置（含跨分类索引 + newsId 用于精确定位）
    if (this._engine) {
      var state = this._engine.getReturnState()
      app.globalData._detailReturnState = state
    } else {
      // 引擎降级时使用旧格式
      app.globalData._detailReturnState = {
        category: this.data.category,
        readingIndex: this.data.currentIndex,
      }
    }
    wx.navigateBack()
  },

  // ============ 分享（B-05） ============

  /**
   * 微信原生分享（button open-type="share" 触发）
   * 转发卡片：标题（≤30字）+ 封面图/分类占位图 + path 可回看
   */
  onShareAppMessage: function () {
    var news = this.data.news || {}
    var title = news.title || '一页 · 新闻速览'
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
    if (!imageUrl) {
      try {
        var isDark = this._isSystemDark()
        var shareComp = this.selectComponent('#share-card')
        if (shareComp && shareComp.generateImage) {
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
   * 判断系统是否暗色模式（B-05 分享占位图用）
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
   */
  _getDefaultPlaceholder: function (category, isDark) {
    return ''
  },

  // 打开原始新闻链接（复制链接）
  openSourceUrl: function () {
    var url = this.data.news.sourceUrl
    if (!url) return
    wx.setClipboardData({
      data: url,
      success: function () {
        wx.showToast({ title: '链接已复制，请在浏览器中打开', icon: 'none', duration: 2500 })
      },
    })
  },

  // ============ 收藏（B-04：迁移到 localCache） ============

  /**
   * 检查当前新闻是否已收藏（从 localCache 读取）
   */
  _checkFavorite: function (newsId) {
    try {
      var favorites = _cache.get('favorites') || []
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
   * 收藏 / 取消收藏切换（B-04: localCache 读写，容量 200）
   */
  onToggleFavorite: function () {
    var news = this.data.news
    if (!news || !news.id) return

    var isFav = this.data.isFavorited
    var that = this
    try {
      var favorites = _cache.get('favorites') || []

      if (isFav) {
        // 取消收藏
        favorites = favorites.filter(function (f) { return f.id !== news.id })
        _cache.set('favorites', favorites, { ttl: 0 }) // 0 = 永不过期
        that.setData({ isFavorited: false })
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
          _cache.set('favorites', favorites, { ttl: 0 })
        }
        that.setData({ isFavorited: true, heartAnim: true })
        setTimeout(function () { that.setData({ heartAnim: false }) }, 350)
      }
    } catch (e) {
      wx.showToast({ title: isFav ? '取消收藏失败' : '收藏失败，请稍后重试', icon: 'none' })
    }
  },
})
