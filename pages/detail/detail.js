// 详情页逻辑 — 跨分类阅读模式（B-01）+ 分享（B-05）+ 收藏 UI（B-04）
// ============================================================
// B-01：方案 A（全量预拉），进入详情时并行拉取 7 分类首页，
//       合并为 mergedList → 跨分类上下滑翻页 + 进度指示 + 分类闪烁条 + 边界提示
//       B-06 localCache 缓存注入：分类列表 10min / 详情 30min
// B-04：收藏功能 — 基于 localCache 读写，容量 200，heartBeat 动画
// B-05：底部操作栏（收藏♡/♥ + 分享↗）+ onShareAppMessage
// ============================================================

var C = require('../../utils/constants')
var STATUS_BAR_HEIGHT = C.STATUS_BAR_HEIGHT
var PAGE_HEIGHT = C.PAGE_HEIGHT
var getNewsDetail = require('../../utils/request').getNewsDetail
var ReadingEngine = require('./reading-engine')
var LocalCache = require('../../utils/localCache').LocalCache
var cloud = require('../../utils/cloud')
var app = getApp()

// 全局缓存实例（引擎内部复用，favorites / browseHistory 同源存储为数组）
var _cache = new LocalCache({ maxItems: 500, defaultTTL: 7 * 24 * 60 * 60 * 1000 })

Page({
  data: {
    statusBarHeight: STATUS_BAR_HEIGHT,
    news: {},
    paragraphs: [],
    scrollTop: 0,
    pageState: 'loading',    // 'loading' | 'ready' | 'error' | 'empty'
    errorMessage: '',
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
    flashColor: '',            // 跨分类进度分类名着色；空串触发 CSS fallback 到 var(--primary)
    // 网络兜底
    networkToastVisible: false,
    // 收藏
    isFavorited: false,
    heartAnim: false,
    // BUG-FS-20260805-001: 深色模式下收藏星星 icon 切换白色版（image 渲染 SVG 时 currentColor 不生效，固定为黑色）
    isDark: false,
    // 字体档位（UX-FIX04 截断保护用）
    fontScaleTier: 0,
    // UX-FIX-F13: CSS --font-scale 数值（此前详情页完全缺失，导致正文缩放失效）
    _fontScaleValue: 1,
    // UX-FIX-F12: 元信息/操作栏缩放（封顶 1.15）
    _metaScaleValue: 1,
    // UI-B11: 阅读进度条百分比
    progressPercent: 0,
    // 底部滑动提示：3.5s 后自动淡出，首次有效滑动即消失（与首页一致）
    showSwipeHint: true,
  },

  // 引擎实例
  _engine: null,
  // 触摸状态
  _touchStartY: 0,
  _touchStartT: 0,
  _animating: false,

  // ============ 生命周期 ============

  /**
   * 底部滑动提示自动消失：渲染 ready 显示，3.5s 后淡出；
   * 用户首次有效滑动时由 onTouchEnd 立即清除（与首页一致）。
   * 同一详情页会话内仅显示一次，翻到下一条后不重复出现。
   */
  _startSwipeHintTimer: function () {
    if (this._swipeHintDismissed) return
    clearTimeout(this._swipeHintTimer)
    this.setData({ showSwipeHint: true })
    var that = this
    this._swipeHintTimer = setTimeout(function () {
      if (that._destroyed) return
      that._swipeHintDismissed = true
      that.setData({ showSwipeHint: false })
    }, 3500)
  },

  onLoad: function (options) {
    var id = options.id
    var index = parseInt(options.index, 10) || 0
    var category = options.category || 'all'

    // UI-B11: 滑动提示同会话仅显示一次
    this._swipeHintDismissed = false
    // 短内容翻页保护：内容不足一屏时需两次上滑才翻页（第一次滚到底，第二次翻页）
    this._needsSecondSwipe = false

    // UX-FIX04: 同步字体档位用于截断保护
    var app = getApp()
    var tier = (app && typeof app.globalData.fontScale === 'number') ? app.globalData.fontScale : 0
    // UX-FIX-F13/F12: 同步缩放变量，供根节点 style 注入（此前详情页从未注入 → 正文不缩放）
    var scaleVal = (app && typeof app.globalData._fontScaleValue === 'number') ? app.globalData._fontScaleValue : 1
    var metaVal = (app && typeof app.globalData._metaScaleValue === 'number')
      ? app.globalData._metaScaleValue
      : (scaleVal > 1.15 ? 1.15 : scaleVal)

    // 翻页动画偏移：用 JS 计算的像素高度（= windowHeight），避免 WXSS transform 内用 100vh 在部分机型/Webview 下失效/方向异常
    this.setData({ pageH: PAGE_HEIGHT })

    // UX-BUG02: 初始化滚动状态 + 获取可视区高度
    this._isAtTop = true
    this._isAtBottom = false
    this._bottomScrollTop = null
    try {
      var sysInfo = wx.getSystemInfoSync()
      // BUG-20260802-001: 该值仅作 onReady 实测前的临时兜底，
      // 真实高度由 _measureScroll() 实测覆盖（估算偏小会导致触底永不成立→单向翻页）
      this._clientHeight = sysInfo.windowHeight - 150
    } catch (e) {
      this._clientHeight = 500
    }

    this.setData({
      category: category,
      currentIndex: index,
      fontScaleTier: tier,
      _fontScaleValue: scaleVal,
      _metaScaleValue: metaVal,
      // BUG-20260805-003: 全局手动主题（设置页深色模式）同步到本页根节点
      themeClass: (app && app.globalData && app.globalData.themeClass) || '',
      // BUG-FS-20260805-001: 与 themeClass 同批同步（页面无 onShow，避免错位）
      isDark: this._isSystemDark()
    })

    // BUG-002 追修: 提前触发占位图预生成（不等引擎初始化，抢占 300ms 竞态窗口）
    this._pregenPlaceholder(category)

    // 初始化跨分类阅读引擎（方案 A：全量预拉 + localCache 缓存注入）
    this._initEngine(id, index, category)
  },

  onReady: function () {
    this._measureScroll()
  },

  // BUG-004: 页面销毁标记，防止回调中 setData
  onUnload: function () {
    this._destroyed = true
  },

  /**
   * BUG-20260802-001: 实测 scroll-view 真实高度与内容高度
   * 根因：原 _clientHeight = windowHeight - 150 是估算值，真实高度比它大 50px 以上时
   *      `scrollTop + _clientHeight >= scrollHeight - 50` 永不成立 → 触底判定永假 → 只能下拉翻上一条
   */
  _measureScroll: function () {
    var that = this
    try {
      wx.createSelectorQuery().in(this)
        .select('.content').boundingClientRect()
        .select('.article').boundingClientRect()
        .exec(function (res) {
          if (that._destroyed || !res || !res[0]) return
          var viewH = res[0].height
          var contentH = res[1] ? res[1].height : 0
          if (viewH > 0) that._clientHeight = viewH
          // 内容不足一屏时，标记需两次上滑才翻页（第一次滚到底确认，第二次才翻页）
          // 同时直接视为已触底，否则 onScrollToLower 不会触发
          if (viewH > 0 && contentH > 0 && contentH <= viewH + 5) {
            that._isAtBottom = true
            that._needsSecondSwipe = true
          }
        })
    } catch (e) {}
  },

  /**
   * 初始化跨分类阅读引擎（B-01 + B-06 缓存注入）
   */
  _initEngine: function (newsId, entryIndex, entryCategory) {
    var that = this
    // 加载态由页面内骨架屏呈现（pageState=loading），不再使用原生 loading

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
        // UX-BUG11-FIX (v5.8): 翻页动画期间（out 阶段）先暂存新内容，
        // 等 in 阶段再渲染，避免新内容带着 out-up/out-down 提前飞走，
        // 造成"先上飞再回来"的方向混乱。
        if (that._switching) {
          that._pendingDetail = { news: news, paragraphs: paragraphs }
          return
        }
        that._renderDetail(news, paragraphs)
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

  // ============ 详情渲染（v5.8 重构：支持翻页动画暂存） ============

  /**
   * 将分类 id 映射为 theme.json 中对应的 CSS 变量（用于跨分类分类名着色）
   */
  _getCategoryColorVar: function (categoryId) {
    var map = {
      tech: 'var(--flash-tech)',
      international: 'var(--flash-world)',
      sports: 'var(--flash-sports)',
      life: 'var(--flash-life)',
    }
    return map[categoryId] || ''
  },

  /**
   * 渲染新闻详情（供 onDetailReady / 翻页 in 阶段调用）
   */
  _renderDetail: function (news, paragraphs) {
    var that = this
    that.setData({
      news: news,
      paragraphs: paragraphs,
      scrollTop: 0,
      loading: false,
      pageState: 'ready',
      progressPercent: 0,
      flashColor: that._getCategoryColorVar(news && news.category),
    }, function () {
      // BUG-20260802-001: 每条新闻正文长度不同，渲染完成后重测真实高度/内容高度
      that._measureScroll()
    })
    that._startSwipeHintTimer()
    // UX-BUG02: 内容加载后重置滚动状态
    that._isAtTop = true
    that._isAtBottom = false
    that._bottomScrollTop = null
    if (news && news.id) {
      that._checkFavorite(news.id)
      that._recordBrowse(news) // TL-B14：浏览记录写入（本地 + 云端兜底）
    }
  },

  /**
   * 应用翻页期间暂存的详情（in 阶段切换内容时调用）
   */
  _applyPendingDetail: function () {
    if (this._pendingDetail) {
      this._renderDetail(this._pendingDetail.news, this._pendingDetail.paragraphs)
      this._pendingDetail = null
    }
  },

  /**
   * 降级加载（引擎初始化失败时）
   */
  _loadFallback: function (newsId) {
    var that = this
    if (!newsId) {
      that.setData({ pageState: 'error', errorMessage: '新闻加载失败' })
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
          pageState: 'ready',
        })
        that._startSwipeHintTimer()
        if (news && news.id) that._checkFavorite(news.id)
    }).catch(function () {
      that.setData({ pageState: 'error', errorMessage: '新闻详情暂不可用，请返回重试' })
      wx.showToast({ title: '新闻详情暂不可用，请返回重试', icon: 'none' })
    })
  },

  // ============ 翻页手势 ============

  onTouchStart: function (e) {
    this._touchStartY = e.touches[0].clientY
    this._touchStartT = Date.now()
  },

  onTouchEnd: function (e) {
    var that = this
    if (this._animating || !this._engine) return
    var dy = e.changedTouches[0].clientY - this._touchStartY
    var dt = Date.now() - this._touchStartT

    if (Math.abs(dy) < 70 || dt > 500) {
      return
    }
    // 首次有效上/下滑 → 提示消失（与首页一致），同会话内不再复现
    this._swipeHintDismissed = true
    this.setData({ showSwipeHint: false })

    // UX-BUG02: 只有滚动到边界时才触发翻页
    // 下滑(dy>0)→上一条（手指从上往下拉，内容从顶部滑入）；需内容已触顶
    // 上滑(dy<0)→下一条（手指从下往上推，内容从底部滑入）；需内容已触底
    if (dy > 0 && !this.data.isFirst) {
      if (this._isAtTop) {
        this._swipeToPrev()
      }
    } else if (dy < 0 && !this.data.isLast) {
      if (this._isAtBottom) {
        // 短内容保护：内容不足一屏时，第一次上滑仅确认"已到底"，第二次才翻页
        if (this._needsSecondSwipe) {
          this._needsSecondSwipe = false
          // 给一个微弱的视觉反馈（scrollTop 轻弹），让用户感知"到底了"
          this.setData({ scrollTop: 1 })
          setTimeout(function () { that.setData({ scrollTop: 0 }) }, 150)
          return
        }
        this._swipeToNext()
      }
    }
  },

  /**
   * UX-BUG02: 监听 scroll-view 滚动位置，判断是否触顶/触底
   */
  onContentScroll: function (e) {
    var scrollTop = e.detail.scrollTop
    var scrollHeight = e.detail.scrollHeight
    var clientHeight = this._clientHeight || 500
    this._lastScrollTop = scrollTop
    // UI-B11: 实时更新进度条百分比（保留一位小数，进度条连续平滑）
    var progressMax = scrollHeight - clientHeight
    var pct = progressMax > 0 ? Math.min(100, parseFloat((scrollTop / progressMax * 100).toFixed(1))) : 0
    this.setData({ progressPercent: pct })
    // 首次滚动即让滑动提示消失（demo 规格）
    if (scrollTop > 10 && !this._swipeHintDismissed) {
      this._swipeHintDismissed = true
      clearTimeout(this._swipeHintTimer)
      this.setData({ showSwipeHint: false })
    }
    // 触顶阈值 10px，触底阈值 50px（微信 scroll-view 可能无法精确到 0）
    this._isAtTop = scrollTop <= 10
    // BUG-20260802-001: 触底以原生 scrolltolower 为准，此处只负责「明确离开底部」时复位，
    // 避免高度实测失败时用估算值把原生事件已置位的触底状态又误清成 false
    if (scrollTop + clientHeight >= scrollHeight - 50) {
      this._isAtBottom = true
    } else if (this._bottomScrollTop == null || scrollTop < this._bottomScrollTop - 50) {
      this._isAtBottom = false
    }
  },

  /**
   * BUG-20260802-001: scroll-view 原生边界事件 —— 触发即代表已到边界，判定以此为准
   */
  onScrollToUpper: function () {
    this._isAtTop = true
  },

  onScrollToLower: function () {
    this._isAtBottom = true
    this._needsSecondSwipe = false  // 手动滚到底 = 已确认触底，无需二次滑动保护
    // 记录真实底部位置，供 onContentScroll 复位时校准
    this._bottomScrollTop = this._lastScrollTop || 0
  },

  // ============ 跨分类翻页 ============

  /**
   * 上滑 → 下一条：旧内容向上移出(out-up) → 新内容从底部滑入(in-up)，一屏高度
   */
  _swipeToNext: function () {
    var that = this
    if (that._animating || !that._engine) return
    that._animating = true
    // v5.8: 标记切换中，onDetailReady 先暂存不渲染，等 in 阶段再切内容
    that._switching = true
    that._pendingDetail = null

    var result = that._engine.goNext()
    if (!result.canGo) {
      that._animating = false
      that._switching = false
      return
    }

    // 跨分类闪烁条
    if (result.isCrossing) {
      that._showFlash(result.crossingCategory)
      // BUG-20260802-006: 跨分类 ~0.5s 分类名提示（独立于内容加载，保证可见时长）
      clearTimeout(that._crossingHintTimer)
      that._crossingHintTimer = setTimeout(function () {
        if (!that._destroyed) that.setData({ showCrossingCategory: '' })
      }, 500)
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

    // 在 out 动画期间预加载内容（onDetailReady 会暂存，不立即渲染）
    var contentPromise = that._engine.loadCurrentDetail()

    // out 动画 ~350ms，等它完成后再切入 in 动画
    setTimeout(function () {
      contentPromise.then(function () {
        that._switching = false
        // 先切换为新内容（此刻 animClass 仍是 out-up，元素停在 -100vh，旧内容已移出）
        that._applyPendingDetail()
        // 关键修复：单元素复用模型下，元素当前在 -100vh（out-up 终点）。
        // 若直接置 in-up，transition 会从 -100vh 一路滑到 +100vh（穿越全屏），
        // 30ms 后清除时停留在「近顶部→中心」，表现为新内容从【顶部】下滑——与预期相反。
        // 因此先以 no-transition 瞬间吸附到 in-up 起点(+100vh)，再移除 class 触发「从底部上滑入」。
        that.setData({ animClass: 'in-up no-transition', scrollTop: 0 })
        setTimeout(function () {
          // 移除 in-up 与 no-transition：元素从 +100vh 滑入中心（从底部往上滑入）
          that.setData({ animClass: '' })
          that._animating = false
        }, 30)
      }).catch(function () {
        that._switching = false
        that._pendingDetail = null
        that.setData({ animClass: '' })
        that._animating = false
        that._showNetworkToast()
      })
    }, 350)
  },

  /**
   * 下滑 → 上一条：旧内容向下移出(out-down) → 新内容从顶部滑入(in-down)，一屏高度
   */
  _swipeToPrev: function () {
    var that = this
    if (that._animating || !that._engine) return
    that._animating = true
    // v5.8: 标记切换中，onDetailReady 先暂存不渲染，等 in 阶段再切内容
    that._switching = true
    that._pendingDetail = null

    var result = that._engine.goPrev()
    if (!result.canGo) {
      that._animating = false
      that._switching = false
      return
    }

    if (result.isCrossing) {
      that._showFlash(result.crossingCategory)
      // BUG-20260802-006: 跨分类 ~0.5s 分类名提示
      clearTimeout(that._crossingHintTimer)
      that._crossingHintTimer = setTimeout(function () {
        if (!that._destroyed) that.setData({ showCrossingCategory: '' })
      }, 500)
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
        that._switching = false
        // out-down 阶段结束，旧内容已移出屏幕下方。
        // 翻上一页：旧内容向下移出后，新内容整屏从上方滑入（in-down: -page-h→0）。
        // 与翻下一页（in-up: +page-h→0）对称，均为一整屏画面滑入，与正文长度无关。
        that._applyPendingDetail()
        // 先以 no-transition 瞬间吸附到 -page-h（屏幕上方整屏位置），
        // 再移除 class 触发 transition 从上方整屏滑入
        that.setData({ animClass: 'in-down no-transition', scrollTop: 0 })
        setTimeout(function () {
          that.setData({ animClass: '' })
          that._animating = false
        }, 30)
      }).catch(function () {
        that._switching = false
        that._pendingDetail = null
        that.setData({ animClass: '' })
        that._animating = false
        that._showNetworkToast()
      })
    }, 350)
  },

  // ============ 跨分类视觉 ============

  /**
   * 分类闪烁条（200ms）
   */
  _showFlash: function (categoryId) {
    // UX-SIMPLIFY05: 移除闪烁条，仅保留 flashColor 用于进度指示分类名着色
    // UI-B11: 统一使用 theme.json CSS 变量，避免 hex 与变量混用导致暗色模式失效
    this.setData({ flashColor: this._getCategoryColorVar(categoryId) })
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

  /**
   * TL-B15 / RQ-17：全局返回主页入口（🏠）
   * 点击 wx.reLaunch 跳转首页并清除导航栈（避免逐层回退）。
   * 防抖 300ms（快速双击仅触发一次）；reLaunch 失败降级为逐层 navigateBack。
   */
  goHome: function () {
    var now = Date.now()
    if (this._lastHomeTap && now - this._lastHomeTap < 300) return // 防抖
    this._lastHomeTap = now

    wx.reLaunch({
      url: '/pages/home/home',
      fail: function () {
        // 降级：计算回退层数，逐层 navigateBack 到首页
        try {
          var pages = getCurrentPages()
          var delta = Math.max(1, pages.length - 1)
          wx.navigateBack({ delta: delta })
        } catch (e) {
          wx.reLaunch({ url: '/pages/home/home' })
        }
      },
    })
  },

  // ============ 分享（B-05 + UX-FIX02 占位图预缓存） ============

  /**
   * UX-FIX02: 预生成当前新闻分类的占位图 base64
   * 在引擎初始化后调用，Canvas 异步 → 缓存到 _placeholderCache
   * onShareAppMessage 同步读取缓存
   */
  _pregenPlaceholder: function (category) {
    var that = this
    var cat = category || this.data.category || 'all'
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
    // TL-B13 / RQ-07：分享点击即算（owner 2026-08-03 拍板，微信无成功回调），
    // 调用前上报 setNewsRetained(true) 触发 30 天保留；失败静默入队。
    if (news && news.id) {
      cloud.report({
        name: 'setNewsRetained',
        data: { newsId: news.id, retained: true, retainedBy: 'share' },
      })
    }

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
   * D-07 S4（G-08）：判断当前生效主题是否暗色（B-05 分享占位图用）
   * 优先取 app.globalData.effectiveTheme（含手动模式），不再只查系统主题。
   */
  _isSystemDark: function () {
    try {
      var app = getApp()
      if (app && app.globalData && app.globalData.effectiveTheme) {
        return app.globalData.effectiveTheme === 'dark'
      }
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
   * 收藏 / 取消收藏切换（B-04: localCache 读写，容量 200；TL-B13: 云端双写）
   */
  onToggleFavorite: function () {
    var news = this.data.news
    if (!news || !news.id) return

    var isFav = this.data.isFavorited
    var that = this
    try {
      var favorites = _cache.get('favorites') || []

      if (isFav) {
        // 取消收藏（本地）
        favorites = favorites.filter(function (f) { return f.id !== news.id })
        _cache.set('favorites', favorites, { ttl: 0 }) // 0 = 永不过期
        that.setData({ isFavorited: false })
        // TL-B13 / RQ-03：云端同步取消（仅取消收藏，不取消 retained — 曾收藏即保留）
        that._syncFavoriteCloud(news, false)
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
        // TL-B13 / RQ-03 + RQ-16：云端双写收藏 + 标记 retained（30 天保留）
        that._syncFavoriteCloud(news, true)
      }
    } catch (e) {
      wx.showToast({ title: isFav ? '取消收藏失败' : '收藏失败，请稍后重试', icon: 'none' })
    }
  },

  /**
   * TL-B13：收藏云端同步（本地已成功，云端失败入队重试 + 提示待同步）
   * @param {Object} news 新闻对象
   * @param {boolean} favorited true=收藏 / false=取消
   */
  _syncFavoriteCloud: function (news, favorited) {
    var data = {
      newsId: news.id,
      title: news.title || '',
      category: news.category || '',
      categoryName: news.categoryName || '',
      source: news.source || '',
      picUrl: news.picUrl || '',
      favorited: favorited,
    }
    cloud.callCloudFunction('setUserFavorite', data).then(function () {
      if (favorited) {
        // 收藏成功 → 同步标记 retained（30 天），失败也入队
        cloud.callCloudFunction('setNewsRetained', { newsId: news.id, retained: true, retainedBy: 'favorite' })
          .catch(function () {
            cloud.enqueue({ name: 'setNewsRetained', data: { newsId: news.id, retained: true, retainedBy: 'favorite' } })
          })
      }
    }).catch(function () {
      // 云端失败：入队重试 + 提示待同步
      cloud.enqueue({ name: 'setUserFavorite', data: data })
      if (favorited) {
        cloud.enqueue({ name: 'setNewsRetained', data: { newsId: news.id, retained: true, retainedBy: 'favorite' } })
      }
      wx.showToast({ title: '已收藏（待同步）', icon: 'none' })
    })
  },

  /**
   * TL-B14 / RQ-06：浏览记录写入（本地 LRU + 云端兜底）
   * 本地存为数组（key=browseHistory，与 favorites 同源），按 id 去重、刷新 viewedAt、LRU 200；
   * 渲染时按 7 天窗口过滤（惰性清理）。云端异步上报，失败静默入队。
   * @param {Object} news 新闻对象
   */
  _recordBrowse: function (news) {
    if (!news || !news.id) return
    try {
      var list = _cache.get('browseHistory') || []
      var now = Date.now()
      var found = false
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === news.id) {
          list[i].viewedAt = now // 去重：刷新 viewedAt 置顶
          list[i].title = news.title || list[i].title
          list[i].categoryName = news.categoryName || list[i].categoryName
          list[i].source = news.source || list[i].source
          found = true
          break
        }
      }
      if (!found) {
        list.unshift({
          id: news.id,
          title: news.title || '',
          category: news.category || '',
          categoryName: news.categoryName || '',
          source: news.source || '',
          viewedAt: now,
        })
        if (list.length > 200) list = list.slice(0, 200) // LRU 淘汰最旧
      }
      _cache.set('browseHistory', list, { ttl: 0 }) // 本地永久，渲染时按 7 天过滤

      // 云端兜底（非阻塞）
      cloud.report({
        name: 'recordBrowse',
        data: {
          newsId: news.id,
          title: news.title || '',
          category: news.category || '',
          categoryName: news.categoryName || '',
          source: news.source || '',
        },
      })
    } catch (e) {
      // 本地写入异常不阻断阅读
    }
  },
})
