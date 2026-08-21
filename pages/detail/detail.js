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
// 2026-08-22：话题搜索深挖（intelSearch 云函数，从 intel 详情页平移）
var searchIntelTopic = require('../../utils/intelApi').searchIntelTopic

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
    // PRD §2.4 S1：references 参考来源折叠状态
    referencesExpanded: false,
    // 一页说：关于一页说说明展开状态（owner 2026-08-12 拍板方案 C）
    opinionInfoExpanded: false,
    // ===== 话题搜索深挖（2026-08-22 从 intel 详情页平移）=====
    searchOpen: false,          // 搜索面板展开态
    searchQueried: false,       // 已搜索过：搜索词以提示词灰显示
    searchQuery: '',
    searchLoading: false,       // 搜索中（60s 超时）
    searchHint: '',             // 不相关/失败 hint（当次提示）
    searchRestUp: false,        // 内容推上去（面板展开时）
    searchPanelTop: '100%',     // 面板 top
    searchProgress: false,      // 横线进度条动画
    searchIntoView: '',         // scroll-into-view 锚点
    digScrollTo: '',
    searchPanelClientHeight: 0,
    searchPanelContentHeight: 0,
    searchQuickTitle: '',       // 一键深挖：当前新闻标题（截断 60 字）
    digGroups: [],              // 深挖历史（同话题折叠）：[{query, open, entries}]
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
    // FS-02: news 尚未加载 → 先生成分类占位图兜底；_renderDetail 会用 AI 摘要图覆盖
    this._pregenShareImage(null)

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
      // 优化（owner 2026-08-16）：翻页即时渲染本地数据后，后台拉取的最新详情到达时刷新——
      // 仍在切换中 → 替换 pendingDetail（in 阶段直接渲染全文）；已渲染且停在顶部 → 升级为全文
      onDetailRefresh: function (news, paragraphs) {
        var cur = that._engine && that._engine.getCurrent()
        if (!cur || !news || cur.id !== news.id) return
        if (that._switching) {
          if (that._pendingDetail) {
            that._pendingDetail = { news: news, paragraphs: paragraphs }
          }
          return
        }
        if ((that._lastScrollTop || 0) <= 10) {
          that._renderDetail(news, paragraphs)
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
      science: 'var(--flash-science)',
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
      // 一键深挖标题：当前新闻标题截断 60 字（intel 版同款）
      searchQuickTitle: String((news && news.title) || '').slice(0, 60),
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
    // FS-02: news 就绪 → 预生成当前新闻的 AI 摘要分享图（翻页到新新闻也会重新生成）
    that._pregenShareImage(news)
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
    getNewsDetail(newsId).then(function (raw) {
      // PRD §八 R2：单篇模式拆分点收敛到 reading-engine 公共函数（保持与详情列表一致）
      var news = ReadingEngine.normalizeDetail(raw)
      var text = ReadingEngine.resolveContentText(news)
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
    // 2026-08-22：搜索面板展开时，滑动只收起面板，不触发翻页（面板内滚动事件已独立处理）
    if (this.data.searchOpen) {
      this._collapseSearch()
      return
    }
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
      this._maybePrefetchNextCategory()
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

  /**
   * owner 2026-08-20：当前分类接近末尾时提前预取下一分类列表（零等待跨分类）。
   * 触发时机 = 当前分类内已滑到倒数第 2 条，预取下一分类并追加到 mergedList，
   * 此后真正跨分类时 loadNextCategory() 已命中缓存/已追加 → _swipeToNext 无需等网络。
   */
  _maybePrefetchNextCategory: function () {
    var that = this
    if (!that._engine || that._destroyed || that._singleMode) return
    if (that._source) return // 历史/收藏来源禁止跨分类
    var cur = that._engine.getCurrent()
    if (!cur) return
    var progress = that._engine.getProgress()
    var curCat = cur.category
    if (!curCat || curCat === 'all') return
    // 当前分类内剩余条数：该分类起点之后到当前游标的距离
    var catStart = that._engine._categoryIndexes ? (that._engine._categoryIndexes[curCat] || 0) : 0
    var remaining = progress.index - catStart  // 已在本分类读到的条数（从 0 起）
    // 分类末尾通常 PAGE_SIZE=8 条；剩余 ≤1 时预取下一分类
    var CAT_SIZE = 8
    if (remaining >= CAT_SIZE - 2) {
      that._engine.prefetchNextCategory()
    }
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
    // 2026-08-22：翻页切到新新闻 → 清空上一条的深挖历史与搜索态（避免数据错乱）
    this._resetSearchForPageChange()

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
        // 修复 v2（owner 2026-08-16）：【先滚动归位、再换内容】——
        // 旧内容此刻已在 out-up 终点(-page-h)屏外，先滚动到顶（不可见）等 scroll 落定，
        // 再切换新内容 → 新文档从顶部渲染，杜绝"换内容瞬间 scroll 被钳制到新文档底部 → 一页说闪现"
        that.setData({ scrollTop: 1 })
        setTimeout(function () {
          that.setData({ scrollTop: 0 })
          setTimeout(function () {
            that._applyPendingDetail()
            // 吸附到 in-up 起点(+page-h)，再移除 class 从底部一屏上滑入
            that.setData({ animClass: 'in-up no-transition' })
            setTimeout(function () {
              that.setData({ animClass: '' })
              that._animating = false
              // owner 2026-08-20：翻页完成后若已靠近当前分类末尾，预取下一分类（零等待跨分类）
              that._maybePrefetchNextCategory()
            }, 30)
          }, 50)
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
   * - home 来源：引擎按固定分类顺序加载下一分类首页追加，直接翻页（无顶部弹窗）
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
      // owner 2026-08-20：跨分类跳转不再弹顶部小胶囊（status-pill 已移除），
      // 直接更新总数并立即翻页 → 丝滑滑入下一分类新闻
      that.setData({ total: that._engine.getProgress().total })
      that._swipeToNext()
    })
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
        // 修复 v2（owner 2026-08-16）：【先滚动归位、再换内容】——
        // 旧内容此刻已在 out-down 终点(+page-h)屏外，先滚动到顶（不可见）等 scroll 落定，
        // 再切换新内容 → 新文档从顶部渲染，杜绝"换内容瞬间 scroll 被钳制到新文档底部 → 一页说闪现"
        that.setData({ scrollTop: 1 })
        setTimeout(function () {
          that.setData({ scrollTop: 0 })
          setTimeout(function () {
            that._applyPendingDetail()
            // 吸附到 in-down 起点(-page-h)，再移除 class 从顶部一屏下滑入
            that.setData({ animClass: 'in-down no-transition' })
            setTimeout(function () {
              that.setData({ animClass: '' })
              that._animating = false
            }, 30)
          }, 50)
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

  // ============ 分享（B-05 + UX-FIX02 占位图预缓存 + FS-02 AI 摘要图） ============

  /**
   * UX-FIX02 / FS-02: 预生成分享卡片图（AI 摘要图），缓存到 _placeholderCache
   * 优先：有标题+摘要 → 绘制「AI 摘要分享图」（标题 ≤2 行 + 摘要 ≤6 行）；
   * 无摘要降级 → 分类主题色占位图。
   * 在 _renderDetail（news 就绪，含翻页）调用；onLoad 早期仅降级分类图兜底。
   * onShareAppMessage 同步读取缓存（Canvas 2d 的 toDataURL 异步，分享回调不支持 async）
   */
  _pregenShareImage: function (news) {
    var that = this
    var cat = (news && news.category) || this.data.category || 'recommend'  // DG-03: 默认 all → recommend
    var isDark = this._isSystemDark()
    var title = (news && news.title) || ''
    // R6（PRD §八）：分享图只取 AI 解读/摘要，不取被 R1 拦截的全文（防分享图泄露原文）
    var summary = (news && news.summary) || ''

    // BUG-002 追修: 延迟缩短至 150ms（Canvas 组件在 wxml 已渲染，仅需 attach 时间）
    setTimeout(function () {
      try {
        var shareComp = that.selectComponent('#share-card')
        if (shareComp && typeof shareComp.generateShareImage === 'function') {
          shareComp.generateShareImage({
            category: cat,
            isDark: isDark,
            title: title,
            summary: summary,
          }).then(function (dataUrl) {
            that._placeholderCache = dataUrl
          }).catch(function () {
            that._placeholderCache = null
          })
        } else if (shareComp && typeof shareComp.generateImage === 'function') {
          // 旧版组件降级：分类占位图
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
   * 转发卡片：标题（≤30字）+ AI 摘要图（FS-02，替代原新闻图/分类占位图）+ path 可回看
   * FS-02（owner 决策）：新闻中不含任何图片 → imageUrl 不再使用 news.picUrl，
   * 一律用 Canvas 生成的 AI 摘要图（_placeholderCache）。
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

    // FS-02: 摘要图缓存（_renderDetail 已预生成）→ 极端竞态降级 undefined（微信默认图标）
    var imageUrl = this._placeholderCache || undefined

    return {
      title: title,
      path: path,
      imageUrl: imageUrl,
    }
  },

  /**
   * RQ-2026-08-09（owner）：详情页支持「分享到朋友圈」。
   * 朋友圈打开为「单页模式」：不支持自定义 path（页面固定为当前页），仅 query 定位；
   * title 与 onShareAppMessage 一致（一页 | 标题 ≤30 字），封面复用 AI 摘要图缓存。
   * 单页模式下 wx.login 等不可用，云函数上报 setNewsRetained 依赖云开发「未登录访问」
   * 配置，失败静默（cloud.report 内部有容错），不阻断分享。
   */
  onShareTimeline: function () {
    var news = this.data.news || {}
    var title = news.title || '一页 · 新闻速览'
    title = '一页 | ' + title
    if (title.length > 30) {
      var chars = Array.from(title)
      title = chars.slice(0, 29).join('') + '\u2026'
    }

    // TL-B13：朋友圈分享同样计入 30 天保留（分享点击即算；失败静默入队）
    if (news && news.id) {
      try {
        cloud.report({
          name: 'setNewsRetained',
          data: { newsId: news.id, retained: true, retainedBy: 'shareTimeline' },
        })
      } catch (e) { /* 静默 */ }
    }

    return {
      title: title,
      query: 'id=' + encodeURIComponent(news.id || '') +
             '&index=' + (this.data.currentIndex || 0) +
             '&category=' + encodeURIComponent(this.data.category || 'recommend'),
      imageUrl: this._placeholderCache || undefined,
    }
  },

  // ============ 合规回源 & references 来源卡片（PRD §2.2/§2.4/§2.5） ============

  /**
   * PRD §2.2 / §2.5：点击「查看原文」卡片 → 复制 sourceUrl 到剪贴板
   * 个人主体 web-view 不可用，采用「复制链接 + 引导外部浏览器打开」方案（S4）
   */
  onCopySourceUrl: function () {
    var news = this.data.news || {}
    var url = news.sourceUrl || (news.references && news.references.length > 0 && news.references[0].url)
    if (!url) {
      wx.showToast({ title: '该源暂不支持查看', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: url,
      success: function () {
        wx.showToast({ title: '链接已复制，粘贴到浏览器中打开', icon: 'none', duration: 2500 })
      },
      fail: function () {
        // S4 兜底：复制失败 → modal 告诉用户手动复制
        wx.showModal({
          title: '复制失败',
          content: '请手动复制以下链接：\n' + url,
          showCancel: false,
        })
      },
    })
  },

  /**
   * PRD §2.4 S1：展开/收起 references 参考来源卡片
   */
  onToggleReferences: function () {
    var expanded = !this.data.referencesExpanded
    this.setData({ referencesExpanded: expanded })
  },

  /**
   * 一页说：展开/收起「关于一页说」说明（owner 2026-08-12 拍板方案 C）
   */
  onToggleOpinionInfo: function () {
    var expanded = !this.data.opinionInfoExpanded
    this.setData({ opinionInfoExpanded: expanded })
  },

  /**
   * PRD §2.4 S1：点击单个 references 来源 → 复制链接到剪贴板
   */
  onCopyRefUrl: function (e) {
    var url = e.currentTarget.dataset.url
    var title = e.currentTarget.dataset.title || '参考来源'
    if (!url) return
    wx.setClipboardData({
      data: url,
      success: function () {
        wx.showToast({ title: title + ' 链接已复制', icon: 'none' })
      },
      fail: function () {
        wx.showModal({
          title: '复制失败',
          content: '请手动复制以下链接：\n' + url,
          showCancel: false,
        })
      },
    })
  },

  /**
   * BUG-002: 同步兜底 — 当 Canvas 预缓存未就绪时，
   * 返回 undefined（微信使用默认图标，优于显示错误占位）
   * 正常情况下 _pregenShareImage 会在首次分享前完成（150ms vs 用户操作延迟 >1s）。
   * FS-02: onShareAppMessage 直接用 _placeholderCache || undefined，等价于本方法 → 已删除
   */

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

  // ============ 话题搜索深挖（2026-08-22 从 intel 详情页平移） ============

  /** 点击搜索悬浮按钮：展开覆盖面板（其余内容推上去），再点收起 */
  onToggleSearch: function () {
    var that = this
    if (this.data.searchOpen) {
      this._collapseSearch()
      return
    }
    if (this.data.pageState !== 'ready') {
      wx.showToast({ title: '详情加载中，请稍后再试', icon: 'none' })
      return
    }
    // 展开面板时深挖历史一律默认折叠
    var _g = this._loadDig()
    var _folded = false
    _g.forEach(function (x) { if (x.open) { x.open = false; _folded = true } })
    if (_folded) { this._saveDig(_g); this.setData({ digGroups: _g }) }
    this.setData({ searchRestUp: true })
    setTimeout(function () {
      var q = wx.createSelectorQuery().in(that)
      q.select('.detail-title').boundingClientRect()
      q.select('.nav-bar').boundingClientRect()
      q.exec(function (res) {
        var rTitle = res && res[0]
        var rNav = res && res[1]
        var navBottom = (rNav && rNav.top + rNav.height) || 0
        var titleBottom = (rTitle && rTitle.top + rTitle.height) ||
          (navBottom + Math.round(84 * (that.data._fontScaleValue || 1)))
        var top = Math.max(titleBottom, navBottom) + 18
        that.setData({ searchOpen: true, searchPanelTop: top + 'px' })
        that.setData({ searchProgress: true })
        that._measureSearchPanel()
      })
    }, 60)
  },

  /** 测量面板可视高/内容高（内容不足一屏时禁止滑动收起） */
  _measureSearchPanel: function () {
    var that = this
    setTimeout(function () {
      var q = wx.createSelectorQuery().in(that)
      q.select('#search-area').boundingClientRect()
      q.select('.search-panel-inner').boundingClientRect()
      q.exec(function (res) {
        var area = res && res[0]
        var inner = res && res[1]
        if (area && inner) {
          that.setData({
            searchPanelClientHeight: area.height || 0,
            searchPanelContentHeight: inner.height || 0,
          })
        }
      })
    }, 100)
  },

  /** 面板内部滚动：滚到顶部且内容超出时折叠历史 */
  onSearchScroll: function (e) {
    var st = (e.detail && e.detail.scrollTop) || 0
    this._panelScrollTop = st
    var sc = this.data.searchPanelContentHeight || 0
    var cl = this.data.searchPanelClientHeight || 0
    var overflows = sc > cl
    if (overflows && st <= 0 && this.data.searchOpen && this.data.digGroups.some(function (g) { return g.open })) {
      var groups = this._loadDig()
      groups.forEach(function (g) { g.open = false })
      this._saveDig(groups)
      this.setData({ digGroups: groups })
    }
  },
  onPanelTouchStart: function (e) {
    var t = e.touches && e.touches[0]
    this._panelTouch = t ? { x: t.clientX, y: t.clientY, moved: false } : null
  },
  onPanelTouchMove: function (e) {
    if (!this._panelTouch) return
    var t = e.touches && e.touches[0]
    if (!t) return
    var dy = t.clientY - this._panelTouch.y
    var dx = Math.abs(t.clientX - this._panelTouch.x)
    var overflows = (this.data.searchPanelContentHeight || 0) > (this.data.searchPanelClientHeight || 0)
    if (this.data.searchOpen && overflows && dy > 24 && dy > dx && (this._panelScrollTop || 0) <= 0) {
      if (!this._panelTouch.moved) {
        this._panelTouch.moved = true
        this._collapseSearch()
      }
    }
  },
  onPanelTouchEnd: function () {
    this._panelTouch = null
  },

  /** 一键深挖：围绕当前新闻标题搜索 */
  onDeepQuick: function () {
    var query = this.data.searchQuickTitle
    if (!query) {
      wx.showToast({ title: '暂无可搜索话题', icon: 'none' })
      return
    }
    this.setData({ searchQueried: true, searchQuery: query })
    this._runSearch(query)
  },

  onSearchFocus: function () {
    if (this.data.searchQueried) {
      this.setData({ searchQueried: false, searchQuery: '' })
    }
  },

  onSearchInput: function (e) {
    this.setData({ searchQuery: (e.detail && e.detail.value) || '' })
  },

  onSearchSubmit: function () {
    var query = String(this.data.searchQuery || '').trim()
    if (!query) {
      wx.showToast({ title: '先输入一个话题吧', icon: 'none' })
      return
    }
    this.setData({ searchQueried: true })
    this._runSearch(query.slice(0, 60))
  },

  /** 调 intelSearch：60s 超时；One News 传 context（新闻标题+摘要），云函数不再依赖 itemId 查库 */
  _runSearch: function (query) {
    var that = this
    if (this.data.searchLoading || this._searching) return
    this._searching = true
    this.setData({ searchLoading: true, searchHint: '' })
    var news = this.data.news || {}
    var ctx = {
      title: news.title || '',
      what: news.summary || news.content || '',
      srcName: news.source || '',
    }
    searchIntelTopic({ context: ctx, query: query })
      .then(function (d) {
        if (d && d.relevant === false) {
          that.setData({ searchHint: d.hint || '这个话题和这条新闻关系不大哦，换一个试试～' })
          return
        }
        if (d && d.relevant) {
          var sources = Array.isArray(d.sources) ? d.sources.map(function (x) {
            return { title: x.title || x.url || '', url: x.url || '', source: x.source || '' }
          }).filter(function (x) { return x.url }) : []
          var hasSections = Array.isArray(d.sections) && d.sections.some(function (x) { return x && x.text })
          var sections = hasSections ? d.sections.map(function (x) {
            return { type: (x.type === 'heading' || x.type === 'bullet') ? x.type : 'para', text: String(x.text || '').trim() }
          }).filter(function (x) { return x.text }) : []
          var parsed = sections.length ? { summary: '', items: [] } : that._parseSearchAnswer(d.answer || '')
          var isFallback = sections.length ? false : (/为你找到以下信息/.test(d.answer || ''))
          var entry = {
            query: query,
            summary: sections.length ? '' : parsed.summary,
            sections: sections,
            items: sections.length ? [] : (isFallback ? [] : parsed.items),
            sources: sources,
            sourcesExpanded: false,
            isFallback: isFallback,
          }
          that._pushDigEntry(query, entry.sections, sources)
          return
        }
        that.setData({ searchHint: (d && d.hint) || '这个话题联网搜索暂时没找到结果，可以换个更具体的说法再试试～' })
      })
      .catch(function (err) {
        wx.showToast({ title: (err && err.message) || '搜索失败，请稍后再试', icon: 'none' })
      })
      .then(function () { that.setData({ searchLoading: false }) })
      .then(function () { that._searching = false })
  },

  /** 清洗 LLM 输出中的 markdown 标记 */
  _cleanMd: function (v) {
    return String(v || '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^[-*]\s+/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .trim()
  },

  /** answer 结构化：首行为引导头；「标题：内容」拆 title/body */
  _parseSearchAnswer: function (answer) {
    var that = this
    var lines = String(answer || '').split(/\n+/).map(function (x) { return x.trim() }).filter(Boolean)
    if (!lines.length) return { summary: '', items: [] }
    var first = that._cleanMd(lines[0])
    var isHead = !/^\d+[.、]/.test(first) && first.length < 40
    var summary = isHead ? first : ''
    var rest = isHead ? lines.slice(1) : lines
    var items = []
    for (var i = 0; i < rest.length; i++) {
      var cleanLn = that._cleanMd(rest[i])
      var m = cleanLn.match(/^(?:\d+[.、]\s*)?(.+?)(?::|：)\s*([\s\S]*)$/)
      if (m && m[1] && m[1].length < 60) {
        items.push({ title: m[1], body: m[2].slice(0, 300) })
      } else {
        if (items.length) items[items.length - 1].body += (items[items.length - 1].body ? '\n' : '') + cleanLn.slice(0, 300)
        else items.push({ title: '', body: cleanLn.slice(0, 300) })
      }
    }
    return { summary: summary, items: items }
  },

  // ============ 深挖历史（同话题折叠 + 本地持久化，按 news.id 隔离） ============

  _digKey: function () {
    return 'news_dig_history_' + (this.data.news && this.data.news.id || '')
  },
  _loadDig: function () {
    try {
      var k = this._digKey()
      var v = wx.getStorageSync(k)
      var groups = Array.isArray(v) ? v : []
      var cleaned = false
      groups = groups.map(function (g) {
        var seen = {}
        var entries = (g.entries || []).filter(function (en) {
          var fp = this._sectionsFingerprint(en.sections)
          if (seen[fp]) { cleaned = true; return false }
          seen[fp] = true
          return true
        }.bind(this))
        if (entries.length !== (g.entries || []).length) { cleaned = true; g.entries = entries }
        return g
      }.bind(this)).filter(function (g) { return g && g.query && (g.entries || []).length })
      if (cleaned) { try { wx.setStorageSync(k, groups) } catch (e) {} }
      return groups
    } catch (e) { return [] }
  },
  _saveDig: function (groups) {
    try { wx.setStorageSync(this._digKey(), groups) } catch (e) {}
  },
  _sectionsFingerprint: function (sections) {
    try { return JSON.stringify((sections || []).map(function (x) { return x && x.text || '' })) } catch (e) { return '' }
  },
  /** 新深挖结果入历史：同话题合并 entries（最新在前），持久化；搜索完成→最新分组展开 */
  _pushDigEntry: function (query, sections, sources) {
    var that = this
    var now = new Date()
    var time = (now.getHours() < 10 ? '0' + now.getHours() : now.getHours()) + ':' +
      (now.getMinutes() < 10 ? '0' + now.getMinutes() : now.getMinutes())
    var groups = this._loadDig()
    var g = null
    for (var i = 0; i < groups.length; i++) { if (groups[i].query === query) { g = groups[i]; break } }
    if (g && g.entries[0] && this._sectionsFingerprint(g.entries[0].sections) === this._sectionsFingerprint(sections)) {
      groups.forEach(function (x) { x.open = (x.query === query) })
      this._saveDig(groups)
      this.setData({ digGroups: groups })
      this._measureSearchPanel()
      return
    }
    var entry = { time: time, sections: sections, sources: sources, sourcesExpanded: false }
    if (g) { g.entries.unshift(entry) } else { groups.unshift({ query: query, open: false, entries: [entry] }) }
    groups.forEach(function (x) { x.open = (x.query === query) })
    while (groups.length > 10) groups.pop()
    groups.forEach(function (x) { while (x.entries.length > 10) x.entries.pop() })
    this._saveDig(groups)
    this.setData({ digGroups: groups })
    this._measureSearchPanel()
  },
  /** 收起搜索面板：内容落回，历史折叠，滚动到深挖历史区 */
  _collapseSearch: function () {
    this._foldAllDig(false)
    this.setData({ searchOpen: false, searchPanelTop: '100%', searchRestUp: false, searchProgress: false })
    this.setData({ searchIntoView: 'dig-history' })
    setTimeout(function () { this.setData({ searchIntoView: '' }) }.bind(this), 600)
  },
  /** 翻页切新闻时重置搜索态：收起面板 + 清空深挖历史（避免上一条的历史串台） */
  _resetSearchForPageChange: function () {
    this._searching = false
    this.setData({
      searchOpen: false,
      searchPanelTop: '100%',
      searchRestUp: false,
      searchProgress: false,
      searchQueried: false,
      searchQuery: '',
      searchHint: '',
      searchLoading: false,
      digGroups: [],
    })
  },
  _foldAllDig: function (open) {
    var groups = this._loadDig()
    groups.forEach(function (g) { g.open = open })
    this._saveDig(groups)
    this.setData({ digGroups: groups })
  },
  /** 展开/收起某个话题的深挖历史：互斥 */
  onToggleDigGroup: function (e) {
    var gi = Number(e.currentTarget.dataset.gi)
    var groups = this._loadDig()
    if (!groups[gi]) return
    var willOpen = !groups[gi].open
    groups.forEach(function (g, idx) { g.open = (idx === gi && willOpen) })
    this._saveDig(groups)
    this.setData({ digGroups: groups, digScrollTo: 'dig-group-' + gi })
    setTimeout(function () { this.setData({ digScrollTo: '' }) }.bind(this), 600)
  },
  /** 展开/收起某次结果的参考来源 */
  onToggleEntrySources: function (e) {
    var gi = Number(e.currentTarget.dataset.gi)
    var ei = Number(e.currentTarget.dataset.ei)
    var groups = this._loadDig()
    if (!groups[gi] || !groups[gi].entries[ei]) return
    groups[gi].entries[ei].sourcesExpanded = !groups[gi].entries[ei].sourcesExpanded
    this._saveDig(groups)
    this.setData({ digGroups: groups })
  },
  /** 打开参考来源链接（复制到剪贴板，web-view 不可用） */
  onOpenSource: function (e) {
    var url = e.currentTarget.dataset.url
    var title = e.currentTarget.dataset.title || ''
    if (!url) return
    wx.setClipboardData({
      data: url,
      success: function () { wx.showToast({ title: '链接已复制，可到浏览器打开', icon: 'none' }) },
      fail: function () { wx.showToast({ title: '复制失败', icon: 'none' }) }
    })
  },
})
