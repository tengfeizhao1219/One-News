// 详情页逻辑 — 跨分类阅读模式（B-01）+ 分享（B-05）+ 收藏 UI（B-04）
// ============================================================
// B-01：方案 A（全量预拉），进入详情时并行拉取 7 分类首页，
//       合并为 mergedList → 跨分类上下滑翻页 + 进度指示 + 分类闪烁条 + 边界提示
//       B-06 localCache 缓存注入：分类列表 10min / 详情 30min
// B-04：收藏功能 — 基于 localCache 读写，容量 200，heartBeat 动画
// B-05：底部操作栏（收藏♡/♥ + 分享↗）+ onShareAppMessage
// ============================================================

var C = require('../../utils/constants')
var PAGE_HEIGHT = C.PAGE_HEIGHT
var getNewsDetail = require('../../utils/request').getNewsDetail
var ReadingEngine = require('./reading-engine')
// BUG-20260806-006: 改用全局单例 localCache（detail/favorites/history 原各自 new 独立实例，
//   内存 Map 隔离导致「收藏后列表不显示新条目」stale read。单例内存共享，set 后所有 get 命中新值）
var localCache = require('../../utils/localCache').localCache
var cloud = require('../../utils/cloud')
var app = getApp()

// 全局缓存单例（引擎内部复用，favorites / browseHistory 同源存储为数组）
var _cache = localCache

Page({
  data: {
    // BUG-20260806-004: 导航栏与原生胶囊对齐
    menuTop: 0,
    menuHeight: 32,
    // D-09 v1.2（BUG-20260806-007）: 内容起始基准 = menuTop + menuHeight + 12px（条带下呼吸）
    navOffset: 0,
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
    // BUG-20260806-025: 浏览完毕居中 toast 显示状态
    finishToastVisible: false,
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
    // BUG-20260806-003: 第 3 层及以上（detail）统一返回按钮（owner 07:44 裁定）
    showBackButton: true,
    // DG-02（需求方案 4）：来源标识 'home'|'history'|'favorites'
    source: '',
    // 底部滑动提示：3.5s 后自动淡出，首次有效滑动即消失（与首页一致）
    showSwipeHint: true,
    // BUG-20260806-023: 状态栏小胶囊提示（替换跨分类切换的 wx.showToast）
    statusPillShow: false,
    statusPillText: '',
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
    var category = options.category || 'recommend'  // DG-03: 默认分类 all → recommend
    // DG-02（需求方案 4）：来源识别 — history/favorites 进入时透传 source，
    // 详情滑动范围 = 来源列表顺序，禁止跨分类补拉/跳转
    var source = options.source || ''

    // UI-B11: 滑动提示同会话仅显示一次
    this._swipeHintDismissed = false
    // 短内容翻页保护：内容不足一屏时需两次上滑才翻页（第一次滚到底，第二次翻页）
    this._needsSecondSwipe = false
    // BUG-20260806-002: 单篇模式标记（入口新闻未命中时启用，禁止翻页）
    this._singleMode = false

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
      source: source,  // DG-02: 'history'|'favorites'（来源列表模式）
      // BUG-20260806-004: 导航栏与胶囊对齐
      menuTop: (app && app.globalData.menuTop) || 0,
      menuHeight: (app && app.globalData.menuHeight) || 32,
      // BUG-20260806-009 v3: 状态栏背景层高度（custom 模式下 setNavigationBarColor 无效）
      statusBarHeight: (app && app.globalData.statusBarHeight) || 20,
      // D-09 v1.2（BUG-20260806-007）: 内容起始基准 = menuTop + menuHeight + 12px
      navOffset: ((app && app.globalData.menuTop) || 0) + ((app && app.globalData.menuHeight) || 32) + 12,
      // BUG-20260805-003: 全局手动主题（设置页深色模式）同步到本页根节点
      themeClass: (app && app.globalData && app.globalData.themeClass) || '',
      // BUG-FS-20260805-001: 与 themeClass 同批同步（页面无 onShow，避免错位）
      isDark: this._isSystemDark()
    })

    // BUG-20260806-009 follow-up: 页面级调用状态栏 API（页面级调用比 App.onLaunch 更可靠）
    if (app && app.setNavBarColor) {
      app.setNavBarColor((app.globalData && app.globalData.effectiveTheme) || 'light')
    }

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
    // BUG-20260806-025: 清理浏览完毕 toast 计时器，防止异步 setData 在已销毁页面执行
    if (this._finishToastTimer) {
      clearTimeout(this._finishToastTimer)
      this._finishToastTimer = null
    }
    // BUG-20260806-023 (FE): onUnload 时回写阅读位置 —— 覆盖「系统返回手势/物理返回键」场景。
    // 原仅 goBack()（顶部返回按钮）回写 _detailReturnState，系统返回手势走 onUnload 不回写，
    // 导致首页从详情返回后仍显示初始新闻。此处与 goBack 同逻辑回写，无论哪种返回方式首页都能恢复。
    this._writeReturnState()
  },

  /**
   * BUG-20260806-023 (FE): 回写阅读位置到 app.globalData._detailReturnState（供首页恢复）
   * goBack 与 onUnload 共用，避免两种返回方式行为不一致
   */
  _writeReturnState: function () {
    try {
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
    } catch (e) {}
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
    // DG-02（需求方案 4）：history/favorites 透传来源列表（source 已带）；
    // 首页透传（source 缺省）时沿用 detailContext
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
      source: this.data.source || '',      // DG-02: 'home'|'history'|'favorites'（禁跨分类）
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
      // BUG-20260806-002：入口新闻在合并列表中未命中（收藏/历史页跳转的旧新闻）
      // 方案 A 单篇模式：直接拉取该新闻详情，禁止回退展示他条；拉取失败提示失效
      if (engine.hasEntryNewsId() && !engine.isEntryFound()) {
        that._loadFallback(newsId, true)
        return
      }
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
      that._recordBrowse(news) // DG-02/TL-B14：浏览记录写入（纯本地）
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
   * 降级加载（引擎初始化失败 或 BUG-20260806-002 入口新闻未命中时）
   * @param {string} newsId 新闻 ID
   * @param {boolean} isExpiredEntry true=入口新闻未命中（单篇模式，失败提示「该新闻已失效」）
   */
  _loadFallback: function (newsId, isExpiredEntry) {
    var that = this
    if (!newsId) {
      that.setData({ pageState: 'error', errorMessage: '新闻加载失败' })
      wx.showToast({ title: '新闻加载失败', icon: 'none' })
      return
    }
    // BUG-20260806-002：单篇模式 — 禁用跨分类翻页（引擎仍存在，但 total=1 边界挡住 goNext/goPrev）
    that._singleMode = !!isExpiredEntry
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
      var msg = isExpiredEntry ? '该新闻已失效' : '新闻详情暂不可用，请返回重试'
      that.setData({ pageState: 'error', errorMessage: msg })
      wx.showToast({ title: msg, icon: 'none' })
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
    if (dy > 0 && this.data.isFirst) {
      // DG-02（需求方案 4）：首条下滑 → 边界 toast（禁止静默）
      wx.showToast({ title: '已经是第一篇了', icon: 'none' })
      return
    }
    if (dy > 0 && !this.data.isFirst) {
      if (this._isAtTop) {
        this._swipeToPrev()
      }
    } else if (dy < 0 && this.data.isLast) {
      // BUG-20260806-022 追修 (FE): 合并列表最后一条上滑 → 跨分类自动跳转。
      // 原实现 `dy < 0 && !this.data.isLast` 在 isLast=true 时直接拦截整个分支，
      // _swipeToNext 永不执行 → _tryNextCategory 永不触发 → 详情页末条无法跨分类。
      // 修复: 末条时单独走 _tryNextCategory()（引擎内部判断是否还有下一分类）。
      if (this._isAtBottom) {
        // 短内容保护：末条内容不足一屏时，第一次上滑仅确认"已到底"，第二次才跨分类
        if (this._needsSecondSwipe) {
          this._needsSecondSwipe = false
          this.setData({ scrollTop: 1 })
          setTimeout(function () { that.setData({ scrollTop: 0 }) }, 150)
          return
        }
        this._tryNextCategory()
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
    // BUG-20260806-002：单篇模式禁止翻页
    if (that._singleMode) return
    that._animating = true
    // v5.8: 标记切换中，onDetailReady 先暂存不渲染，等 in 阶段再切内容
    that._switching = true
    that._pendingDetail = null

    var result = that._engine.goNext()
    if (!result.canGo) {
      // DG-02（需求 R3）：末条 → 尝试跨分类自动跳转（home 来源）；
      // history/favorites 来源引擎返回 hasNext:false → 直接边界 toast
      that._animating = false
      that._switching = false
      that._tryNextCategory()
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
   * DG-02（需求 R3 + 方案 4）：当前分类末条 → 跨分类自动跳转
   * - home 来源：引擎按固定分类顺序加载下一分类首页追加（toast「正在阅读：分类」）
   * - 所有分类读完 / history / favorites 来源：toast「已阅读完，回到首页获取更多新闻」
   */
  _tryNextCategory: function () {
    var that = this
    if (!that._engine || that._destroyed) return
    that._engine.loadNextCategory().then(function (res) {
      if (that._destroyed) return
      if (!res.hasNext) {
        // BUG-20260806-025: 浏览完毕提示改为自定义居中 toast（半透明黑底白字胶囊）
        that._showFinishToast()
        return
      }
      // 跨分类跳转成功：小胶囊提示切换分类 + 更新总数 + 立即翻页
      that._showStatusPill('正在阅读：' + res.categoryName)
      that.setData({ total: that._engine.getProgress().total })
      that._swipeToNext()
    })
  },

  /**
   * BUG-20260806-023 (FE): 状态栏小胶囊提示（跨分类切换「正在阅读：」提示）
   * 定位在状态栏区域中央（status-bar-fill 之上），自动 1.5s 淡出。
   * @param {string} text 显示文本
   */
  _showStatusPill: function (text) {
    if (!text) return
    clearTimeout(this._statusPillTimer)
    this.setData({ statusPillShow: true, statusPillText: text })
    var that = this
    this._statusPillTimer = setTimeout(function () {
      if (!that._destroyed) that.setData({ statusPillShow: false })
    }, 1500)
  },

  /**
   * BUG-20260806-025: 浏览完毕居中 toast（替代原 wx.showToast）
   * - 半透明黑底白字胶囊 + 完美居中 + 淡入淡出
   * - 持续 2 秒后自动隐藏
   * - 页面销毁时清理 timer，避免异步 setData 在已销毁页面执行
   */
  _showFinishToast: function () {
    var that = this
    if (that._finishToastTimer) {
      clearTimeout(that._finishToastTimer)
      that._finishToastTimer = null
    }
    that.setData({ finishToastVisible: true })
    that._finishToastTimer = setTimeout(function () {
      that._finishToastTimer = null
      if (!that._destroyed) {
        that.setData({ finishToastVisible: false })
      }
    }, 2000)
  },

  /**
   * 下滑 → 上一条：旧内容向下移出(out-down) → 新内容从顶部滑入(in-down)，一屏高度
   */
  _swipeToPrev: function () {
    var that = this
    if (that._animating || !that._engine) return
    // BUG-20260806-002：单篇模式禁止翻页
    if (that._singleMode) return
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
    // BUG-20260806-023: 复用 _writeReturnState（与 onUnload 同逻辑），保证两种返回方式一致
    this._writeReturnState()
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
    var cat = category || this.data.category || 'recommend'  // DG-03: 默认 all → recommend
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
        // BUG-20260806-001：取消收藏反馈提示（对比收藏页已有「已取消收藏」提示）
        wx.showToast({ title: '已取消收藏', icon: 'none' })
        // DG-02（owner 09:48 决策③）：收藏纯本地，移除云端 setUserFavorite 同步
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
            expireAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // DG-02：30 天 TTL（需求方案 3）
          })
          _cache.set('favorites', favorites, { ttl: 0 })
        }
        that.setData({ isFavorited: true, heartAnim: true })
        setTimeout(function () { that.setData({ heartAnim: false }) }, 350)
        // BUG-20260806-001：收藏反馈提示
        wx.showToast({ title: '已收藏', icon: 'none' })
        // DG-02（owner 09:48 决策③）：收藏纯本地，移除云端 setUserFavorite 双写 +
        // retained 标记（retained 仅分享场景触发，onShareAppMessage 保留）
      }
    } catch (e) {
      wx.showToast({ title: isFav ? '取消收藏失败' : '收藏失败，请稍后重试', icon: 'none' })
    }
  },

  /**
   * DG-02 / TL-B14：浏览记录写入（纯本地，owner 2026-08-06 09:48 决策）
   * 本地存为数组（key=browseHistory），按 id 去重、刷新 viewedAt 置顶；
   * 记录 expireAt = viewedAt + 7 天（DG-04 页面按此过滤 + app.js 每日清理）；
   * LRU 上限 500（DG-03 将常量化到 utils/constants.js HISTORY_LIMIT）。
   * 原云端 recordBrowse 上报已移除（云函数 DG-01 停用，避免入队重试噪音）。
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
          list[i].expireAt = now + 7 * 24 * 60 * 60 * 1000 // 刷新 7 天 TTL
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
          expireAt: now + 7 * 24 * 60 * 60 * 1000, // DG-02：7 天 TTL（需求方案 3）
        })
        if (list.length > 500) list = list.slice(0, 500) // LRU 淘汰最旧（DG-03 常量化）
      }
      _cache.set('browseHistory', list, { ttl: 0 }) // 本地永久，渲染时按 7 天过滤
    } catch (e) {
      // 本地写入异常不阻断阅读
    }
  },
})
