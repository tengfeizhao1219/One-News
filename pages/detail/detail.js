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
    // 网络兜底
    networkToastVisible: false,
    // 收藏
    isFavorited: false,
    heartAnim: false,
    // 字体档位（UX-FIX04 截断保护用）
    fontScaleTier: 0,
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

    // UX-FIX04: 同步字体档位用于截断保护
    var app = getApp()
    var tier = (app && typeof app.globalData.fontScale === 'number') ? app.globalData.fontScale : 0

    // UX-BUG02: 初始化滚动状态 + 获取可视区高度
    this._isAtTop = true
    this._isAtBottom = false
    try {
      var sysInfo = wx.getSystemInfoSync()
      // scroll-view 可用高度 ≈ 屏幕高度 - 顶部栏(~50px) - 底部操作栏(~100px)
      this._clientHeight = sysInfo.windowHeight - 150
    } catch (e) {
      this._clientHeight = 500
    }

    this.setData({ category: category, currentIndex: index, fontScaleTier: tier })

    // BUG-002 追修: 提前触发占位图预生成（不等引擎初始化，抢占 300ms 竞态窗口）
    this._pregenPlaceholder(category)

    // 初始化跨分类阅读引擎（方案 A：全量预拉 + localCache 缓存注入）
    this._initEngine(id, index, category)
  },

  // BUG-004: 页面销毁标记，防止回调中 setData
  onUnload: function () {
    this._destroyed = true
  },

  /**
   * 初始化跨分类阅读引擎（B-01 + B-06 缓存注入）
   */
  _initEngine: function (newsId, entryIndex, entryCategory) {
    var that = this
    wx.showLoading({ title: '加载中...', mask: true })

    // UX-BUG09: 检测首页透传数据 — 有则走快速通道，零网络请求
    var app = getApp()
    var ctx = app.globalData.detailContext
    var preloadedList = null
    var preloadedCategory = null
    if (ctx && ctx.list && ctx.list.length > 0 && ctx.category === entryCategory) {
      preloadedList = ctx.list
      preloadedCategory = ctx.category
    }

    var engine = new ReadingEngine({
      entryCategory: entryCategory,
      entryIndex: entryIndex,
      entryNewsId: newsId,
      cache: _cache,  // B-06: 注入 localCache 实例
      preloadedList: preloadedList,        // UX-BUG09: 透传数据
      preloadedCategory: preloadedCategory, // UX-BUG09: 透传分类
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
        // UX-BUG02: 内容加载后重置滚动状态
        that._isAtTop = true
        that._isAtBottom = false
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
      // BUG-004: 页面已销毁则跳过 setData
      if (that._destroyed) return
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

    // UX-BUG02: 只有滚动到边界时才触发翻页
    // 上滑(dy<0)→下一条：需内容已触底；下滑(dy>0)→上一条：需内容已触顶
    if (dy < 0 && !this.data.isLast) {
      if (this._isAtBottom) {
        this._swipeToNext()
      }
    } else if (dy > 0 && !this.data.isFirst) {
      if (this._isAtTop) {
        this._swipeToPrev()
      }
    } else if (dy < 0 && this.data.isLast) {
      // 边界已移除
    } else if (dy > 0 && this.data.isFirst) {
      // 边界已移除
    }
  },

  /**
   * UX-BUG02: 监听 scroll-view 滚动位置，判断是否触顶/触底
   */
  onContentScroll: function (e) {
    var scrollTop = e.detail.scrollTop
    var scrollHeight = e.detail.scrollHeight
    var clientHeight = this._clientHeight || 500
    // 触顶阈值 10px，触底阈值 50px（微信 scroll-view 可能无法精确到 0）
    this._isAtTop = scrollTop <= 10
    this._isAtBottom = scrollTop + clientHeight >= scrollHeight - 50
  },

  // ============ 跨分类翻页 ============

  /**
   * UX-BUG11: 上滑 → 下一条（连续滑动动画，消除 220ms 停顿）
   * 策略：预加载 + 一次性动画（out→in 连续，不等网络）
   */
  _swipeToNext: function () {
    var that = this
    if (that._animating || !that._engine) return
    that._animating = true

    var result = that._engine.goNext()
    if (!result.canGo) {
      that._animating = false
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

    // UX-BUG11: 不等待 220ms — 在 out 动画期间预加载内容
    // out-up 动画时长 ~350ms（CSS transition 0.35s），内容加载并行
    var contentPromise = that._engine.loadCurrentDetail()

    // 等 out 动画过半（~180ms）后开始 in 动画
    setTimeout(function () {
      contentPromise.then(function () {
        // 内容就绪 → 立即切入 in 动画
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
    }, 180)
  },

  /**
   * UX-BUG11: 下滑 → 上一条（连续滑动动画）
   */
  _swipeToPrev: function () {
    var that = this
    if (that._animating || !that._engine) return
    that._animating = true

    var result = that._engine.goPrev()
    if (!result.canGo) {
      that._animating = false
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

    var contentPromise = that._engine.loadCurrentDetail()

    setTimeout(function () {
      contentPromise.then(function () {
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
    }, 180)
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

  // ============ 分享（B-05 + UX-FIX02 占位图预缓存） ============

  /**
   * UX-FIX02: 预生成当前新闻分类的占位图 base64
   * 在引擎初始化后调用，Canvas 异步 → 缓存到 _placeholderCache
   * onShareAppMessage 同步读取缓存
   */
  _pregenPlaceholder: function (category) {
    var that = this
    var cat = category || this.data.category || 'recommend'
    var isDark = this._isSystemDark()

    // BUG-002 追修: 延迟缩短至 150ms（Canvas 组件在 wxml 已渲染，仅需 attach 时间）
    setTimeout(function () {
      try {
        var shareComp = that.selectComponent('#share-card')
        if (shareComp && typeof shareComp.generateImage === 'function') {
          shareComp.generateImage(cat, isDark).then(function (dataUrl) {
            that._placeholderCache = dataUrl
          }).catch(function () {
            that._placeholderCache = null
          })
        }
      } catch (e) {
        that._placeholderCache = null
      }
    }, 150)
  },

  /**
   * 微信原生分享（button open-type="share" 触发）
   * 转发卡片：标题（≤30字）+ 封面图/分类占位图 + path 可回看
   */
  onShareAppMessage: function () {
    var news = this.data.news || {}
    var title = news.title || '一页 · 新闻速览'

    // UX-FIX05: 先加前缀再截断
    title = '一页 | ' + title
    // BUG-003: emoji 安全截断（Array.from 按 codepoint 而非 UTF-16 码元）
    if (title.length > 30) {
      var chars = Array.from(title)
      title = chars.slice(0, 29).join('') + '\u2026'
    }

    var path = '/pages/detail/detail'
    if (news.id) {
      path += '?id=' + news.id + '&index=' + this.data.currentIndex + '&category=' + this.data.category
    }

    // BUG-002: 分享占位图时序竞态修复
    // 优先级：picUrl > Canvas预缓存 > 同步纯色兜底
    var imageUrl = news.picUrl || this._placeholderCache
    if (!imageUrl) {
      imageUrl = this._getSyncPlaceholder(news.category)
    }

    return {
      title: title,
      path: path,
      imageUrl: imageUrl || undefined,
    }
  },

  /**
   * BUG-002: 同步兜底 — 当 Canvas 预缓存未就绪时，
   * 返回 undefined（微信使用默认图标，优于显示错误占位）
   * 正常情况下 _pregenPlaceholder 会在首次分享前完成（300ms vs 用户操作延迟 >1s）
   */
  _getSyncPlaceholder: function (category) {
    // Canvas 2d 的 toDataURL 是异步的，onShareAppMessage 不支持 async
    // 此处无法同步生成有效图片。预缓存 _placeholderCache 覆盖绝大多数场景，
    // 极端竞态（300ms 内分享）降级为微信默认图标——可接受
    return undefined
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
