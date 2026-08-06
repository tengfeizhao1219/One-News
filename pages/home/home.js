// 首页 - 卡片流主视图逻辑

const { CATEGORIES, SWIPE_THRESHOLD, PANEL_SWIPE_THRESHOLD, PAGE_HEIGHT, PAGE_SIZE, MORE_PAGE_SIZE, MORE_PAGE_LIMIT, refreshPageSize } = require('../../utils/constants')
const { getNewsList, handleApiError } = require('../../utils/request')
const { localCache } = require('../../utils/localCache')

const app = getApp()

// 侧边栏分类列表（纯新闻分类，收藏入口已迁移至 dock 菜单「我的收藏」）
var PANEL_CATEGORIES = CATEGORIES

Page({
  data: {
    menuTop: 0,
    menuHeight: 32,
    newsList: [],           // 首页当前分类的新闻
    cards: [],              // 卡片渲染数据（仅3张）
    currentIndex: 0,        // 当前卡片索引
    showPanel: false,       // 侧边栏是否显示
    categories: CATEGORIES,
    panelCategories: PANEL_CATEGORIES,  // 侧边栏分类（仅新闻分类）
    currentCategory: 'recommend', // DG-03: 首页默认分类（all → 推荐）
    panelCategory: 'recommend',   // 侧边栏当前分类（独立于首页分类）
    panelCurrentIndex: 0,   // 侧边栏中标记的当前阅读位置
    filteredNewsList: [],   // 侧边栏过滤后的列表
    panelSubtitle: '',      // UI-B7：面板头部副标题「当前分类 · N 条」
    favList: [],             // 已废弃：收藏入口已迁移至 dock 菜单独立页
    // 页面状态
    pageState: 'loading',   // 'loading' | 'ready' | 'error' | 'empty'
    errorMessage: '',       // 错误提示文案
    skeletonCount: 3,       // 骨架屏卡片数量
    isRefreshing: false,    // 手动刷新中
    currentPage: 1,         // 当前分页（用于边界加载更多）
    loadingMore: false,    // 边界加载更多/刷新中
    loadMoreCount: 0,      // DG-03: 翻底连续拉取次数（上限 MORE_PAGE_LIMIT=3）
    categoryHint: '',      // BUG-20260802-006: 分类切换 0.5s 提示文案
    // UI-B9: 字体设置已迁移到独立设置页；首页仅保留当前档位同步
    fontScaleTier: 0,       // 当前字体档位 0-3
    _fontScaleValue: 1,     // CSS --font-scale 数值（由 app 注入）
    _metaScaleValue: 1,     // UX-FIX-F12: 元信息缩放（封顶 1.15），由 app 注入
    // TL-B16: 更多功能菜单
    showMoreMenu: false,    // ⚙ 浮动按钮弹出的 dock 菜单是否展开
    // BUG-FS-20260805-001（同根因扩展）: dock 菜单 icon 深色模式切换白色版
    isDark: false,
    // 首页底部滑动提示：进入 ready 即显示，3.5s 后自动淡出；首次有效滑动即消失（与详情页 UI-B11 一致）
    showSwipeHint: true,
  },

  // 触摸状态（v5.9: 与详情页完全对齐——JS 线程处理、70px/500ms flick-only）
  _touchStartY: 0,
  _touchStartX: 0,
  _isAnimating: false,
  _lastSwipeTime: 0,

  /**
   * 首页底部滑动提示自动消失：进入 ready 显示，3.5s 后淡出；
   * 用户首次有效滑动时由 onTouchEnd 立即清除（与详情页 UI-B11 行为一致）。
   * 同一首页会话内仅显示一次，切分类/刷新后不再复现。
   */
  _startSwipeHintTimer() {
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

  onLoad() {
    // UI-B11: 滑动提示同会话仅显示一次
    this._swipeHintDismissed = false
    // 翻页动画偏移：JS 计算的像素高度（= windowHeight），替代 WXSS transform 内的 100vh（部分机型/Webview 下方向异常）
    this.setData({ pageH: PAGE_HEIGHT })
    // BUG-20260805-003: 全局手动主题（设置页深色模式）同步到本页根节点
    this.setData({
      // BUG-20260806-004: 导航栏与胶囊对齐
      menuTop: (app.globalData && app.globalData.menuTop) || 0,
      menuHeight: (app.globalData && app.globalData.menuHeight) || 32,
      // BUG-20260806-009 v3: 状态栏背景层高度（custom 模式下 setNavigationBarColor 无效）
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20,
      themeClass: (app.globalData && app.globalData.themeClass) || '',
      // BUG-FS-20260805-001: dock 菜单 icon 按主题切换白色版
      isDark: this._isSystemDark(),
    })

    // BUG-20260806-009 follow-up: 页面级调用状态栏 API
    if (app && app.setNavBarColor) {
      app.setNavBarColor((app.globalData && app.globalData.effectiveTheme) || 'light')
    }
    // BUG-20260802-004: 侧栏不再独立请求，loadNews 内会由 newsList 派生 filteredNewsList
    this.loadNews()
    // 同步字体档位（由 app._initFontScale 初始化）
    this._syncFontScale()
  },

  onShow() {
    refreshPageSize()

    // BUG-20260805-003: onShow 时刷新主题（可能从设置页返回）
    this.setData({
      themeClass: (app.globalData && app.globalData.themeClass) || '',
      // BUG-FS-20260805-001: onShow 同步刷新（从设置页切换主题返回时更新 icon 颜色）
      isDark: this._isSystemDark(),
    })

    // B-07: 处理从详情页阅读模式返回的定位
    // 若首页被回收，onLoad 会重新 loadNews；onShow 中需等 loadNews 完成后再定位，
    // 否则 newsList 为空会导致定位失败。
    this._pendingReturnState = null
    var handledNow = this._handleDetailReturn()

    // 如果没有立即处理（数据未就绪），把状态暂存起来，等 loadNews 完成后再处理
    if (!handledNow && app.globalData._detailReturnState) {
      this._pendingReturnState = app.globalData._detailReturnState
      app.globalData._detailReturnState = null
    }

    // 如果不是从详情页返回，正常渲染（保持当前位置）
    if (!handledNow && !this._pendingReturnState && this.data.newsList.length > 0) {
      this.renderCards(this.data.newsList)
    }

    // 同步字体（onShow 时可能从其他页面返回，需刷新）
    this._syncFontScale()
  },

  /**
   * 同步字体档位与 CSS 变量值
   */
  _syncFontScale() {
    var app = getApp()
    var tier = (app && typeof app.globalData.fontScale === 'number') ? app.globalData.fontScale : 0
    var val = (app && typeof app.globalData._fontScaleValue === 'number') ? app.globalData._fontScaleValue : 1
    // UX-FIX-F12: 元信息缩放上限 1.15，globalData 缺失时按 val 封顶兜底
    var metaVal = (app && typeof app.globalData._metaScaleValue === 'number')
      ? app.globalData._metaScaleValue
      : (val > 1.15 ? 1.15 : val)
    if (tier !== this.data.fontScaleTier ||
        val !== this.data._fontScaleValue ||
        metaVal !== this.data._metaScaleValue) {
      this.setData({ fontScaleTier: tier, _fontScaleValue: val, _metaScaleValue: metaVal })
    }
  },

  /**
   * BUG-FS-20260805-001: 判断当前生效主题是否深色（含手动模式，与 detail/favorites 页同源）
   */
  _isSystemDark() {
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
   * B-07: onShow 时数据未就绪，暂存状态；等 loadNews 完成后调用此方法真正定位
   */
  _handleDetailReturnFromPending() {
    if (!this._pendingReturnState) return
    app.globalData._detailReturnState = this._pendingReturnState
    this._pendingReturnState = null
    this._handleDetailReturn()
  },

  /**
   * B-07: 处理从详情页阅读模式返回后的定位
   * 兼容新旧两种返回格式：
   *   新格式（引擎）: { category, categoryIndex, newsId, total }
   *   旧格式（降级）: { category, readingIndex }
   * 策略：优先用 newsId 精确匹配，其次用 categoryIndex/readingIndex 估算
   */
  _handleDetailReturn() {
    const app = getApp()
    const state = app.globalData._detailReturnState
    if (!state) return false

    // 清除状态，防止重复处理
    app.globalData._detailReturnState = null

    const { category } = state
    var hasNewFormat = typeof state.categoryIndex === 'number'
    var hasOldFormat = typeof state.readingIndex === 'number'

    // 决定目标索引：优先 newsId 精确匹配
    var resolveIndex = function (list) {
      if (!list || list.length === 0) return 0
      // 新格式：用 newsId 精确匹配
      if (hasNewFormat && state.newsId) {
        for (var i = 0; i < list.length; i++) {
          if ((list[i].id || list[i]._id) === state.newsId) return i
        }
      }
      // 旧格式：用 readingIndex
      if (hasOldFormat) {
        return Math.min(state.readingIndex, list.length - 1)
      }
      // 兜底
      return 0
    }

    // 场景 1: 分类没变，直接定位
    if (category === this.data.currentCategory && this.data.newsList.length > 0) {
      var idx = resolveIndex(this.data.newsList)
      this.setData({ currentIndex: idx, panelCategory: category })
      this.renderCards(this.data.newsList, idx)
      return true
    }

    // 场景 2: 分类变了，需要切换分类并加载数据
    if (category && category !== this.data.currentCategory) {
      this.loadCategory(category, resolveIndex)
      return true
    }

    return false
  },

  /**
   * BUG-20260802-004: 切换分类的唯一入口
   * 只发一次 getNewsList → 写入唯一数据源 newsList → 卡片与侧栏同时由它派生，
   * 杜绝原先 loadNews / loadPanelNews 双请求 + _panelCache 造成的数据分叉
   * @param {string} cat 目标分类 id
   * @param {function} [resolveIndex] 可选，从列表解析初始定位下标
   */
  loadCategory(cat, resolveIndex) {
    this.setData({ currentCategory: cat, panelCategory: cat, currentIndex: 0, currentPage: 1 })
    return this.loadNews(resolveIndex)
  },

  /**
   * BUG-20260802-004: 侧栏列表由唯一数据源 newsList 派生（替代已删除的 loadPanelNews/_panelCache）
   * _originalIndex 取自 newsList 下标，保证侧栏点击与「正在阅读」高亮都能对齐卡片
   */
  _syncPanelList(list, index) {
    const src = Array.isArray(list) ? list : (this.data.newsList || [])
    const cat = this.data.currentCategory
    const mapped = src.map(function (item, i) {
      return Object.assign({}, item, { _originalIndex: i })
    })
    // newsList 已按 currentCategory 拉取（同源保证）；'recommend'/'all' 不过滤（推荐为聚合数据，
    // 单条 category 字段可能非 recommend，直接全量展示当前分类列表），其余按 category 过滤
    const filtered = (!cat || cat === 'recommend' || cat === 'all')
      ? mapped
      : mapped.filter(function (it) { return it.category === cat })
    this.setData({
      filteredNewsList: filtered,
      panelCurrentIndex: typeof index === 'number' ? index : this.data.currentIndex,
    })
    this._updatePanelSubtitle(cat, filtered.length)
  },

  /**
   * UI-B7：更新面板头部副标题「当前分类 · N 条」
   */
  _updatePanelSubtitle(cat, count) {
    var name = '推荐'
    var cats = this.data.categories
    for (var i = 0; i < cats.length; i++) {
      if (cats[i].id === cat) { name = cats[i].name; break }
    }
    var n = typeof count === 'number' ? count : (this.data.filteredNewsList || []).length
    this.setData({ panelSubtitle: name + ' · ' + n + ' 条' })
  },

  /**
   * BUG-20260802-006: 分类切换 ~0.5s 分类名提示
   * 在卡片页可见区域中央短暂展示分类名（面板关闭后/选中卡片时触发）
   * v6.2 增强：双重 hideToast 确保原生浮层关闭；延长展示到 600ms 提高可见性
   */
  _showCategoryHint: function (catId) {
    if (!catId) return
    var name = ''
    var cats = this.data.categories
    for (var i = 0; i < cats.length; i++) {
      if (cats[i].id === catId) { name = cats[i].name; break }
    }
    if (!name) return
    var that = this
    // BUG-20260802-006: wx.showToast 是原生浮层，不受 CSS z-index 控制，
    // 必须确保关闭后再展示分类提示。双重调用防止时序竞态。
    try { wx.hideToast() } catch (e) {}
    clearTimeout(this._categoryHintTimer)
    this.setData({ categoryHint: name })
    // 延迟 50ms 再关一次 toast，防止 loadCategory 内部的异步 toast 覆盖
    setTimeout(function () { try { wx.hideToast() } catch (e) {} }, 50)
    this._categoryHintTimer = setTimeout(function () {
      if (!that._destroyed) that.setData({ categoryHint: '' })
    }, 600)
  },

  // ============ 数据加载 ============

  async loadNews(resolveIndex) {
    try {
      this.setData({ pageState: 'loading', errorMessage: '' })

      const res = await getNewsList({ category: this.data.currentCategory })
      const list = res.list || []

      if (list.length === 0) {
        this.setData({ newsList: [], cards: [], pageState: 'empty', errorMessage: '暂无新闻，下拉刷新试试' })
        this._syncPanelList([], 0)
        return
      }

      // resolveIndex 由详情页返回定位使用；未传则沿用当前位置（renderCards 内会做边界钳制）
      const idx = typeof resolveIndex === 'function' ? resolveIndex(list) : undefined
      // DG-03: 首次加载/切分类重置 loadMoreCount（方案 5 改动 B：每次 loadCategory 重置为 0）
      this.setData({ newsList: list, pageState: 'ready', currentPage: 1, loadingMore: false, loadMoreCount: 0 })
      this._startSwipeHintTimer()
      this.renderCards(list, idx)
      // BUG-20260802-004: 卡片渲染后由同一份 newsList 派生侧栏，保证刷新后两侧一致
      this._syncPanelList(list)

      // B-07: 若 onShow 时暂存了详情页返回状态，数据就绪后立即定位
      if (this._pendingReturnState) {
        this._handleDetailReturnFromPending()
      }
    } catch (err) {
      const msg = handleApiError(err.errorCode, err.message)
      this.setData({ pageState: 'error', errorMessage: msg })
    }
  },

  // 下拉刷新（S4 owner 2026-08-02 决策：取消 R 按钮，刷新入口统一为下拉刷新）
  onPullDownRefresh() {
    this._refreshNewsCloud().finally(() => {
      wx.stopPullDownRefresh()
    })
  },

  // 重试加载
  onRetry() {
    this.loadNews()
  },

  /**
   * 云函数强制拉新（S4 取消 R 按钮后改为私有方法，仅由下拉刷新调用）
   */
  async _refreshNewsCloud() {
    if (this.data.isRefreshing) return

    this.setData({ isRefreshing: true })

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
      console.error('下拉刷新失败:', err)
      wx.showToast({ title: '刷新失败，请稍后重试', icon: 'none' })
    }

    await this.loadNews()
    this.setData({ isRefreshing: false })
  },

  // ============ 卡片渲染 ============

  /**
   * 渲染卡片数据（仅构建数据，不涉及动画状态）
   * 始终以 targetIndex 为中心生成 3 张卡片
   */
  renderCards(list, targetIndex, incomingAnim) {
    const safeList = Array.isArray(list) ? list : []
    const currentIndex = targetIndex !== undefined ? targetIndex : (this.data.currentIndex || 0)
    const total = safeList.length

    if (total === 0) {
      this.setData({ cards: [], currentIndex: 0 })
      return
    }

    const idx = Math.max(0, Math.min(currentIndex, total - 1))
    const cards = []
    if (idx > 0 && safeList[idx - 1]) cards.push(this.buildCard(safeList[idx - 1], -1))
    if (safeList[idx]) cards.push(this.buildCard(safeList[idx], 0, incomingAnim))
    if (idx < total - 1 && safeList[idx + 1]) cards.push(this.buildCard(safeList[idx + 1], 1))

    this.setData({ currentIndex: idx, cards })

    // UX-BUG04: 同步侧边栏高亮位置
    if (idx !== this.data.panelCurrentIndex) {
      this.setData({ panelCurrentIndex: idx })
    }
  },

  buildCard(item, position, animClass) {
    if (!item) {
      return {
        id: '', title: '', summary: '', summaryParagraphs: [],
        category: '', categoryName: '', source: '', time: '',
        state: position === 0 ? 'active' : (position < 0 ? 'above' : 'below'),
        animClass: animClass || ''
      }
    }

    // v6.2：三档摘要优先级 —— AI 摘要 > 正文摘要 > 标题兜底（摘要区留空）
    var summarySource = item.summarySource || 'desc'
    var displaySummary = item.summary || ''

    // v6.2-fix（PD 裁定 BUG-PD-018）：第三档不复用标题，摘要区留空
    // 理由：.card-title 已渲染标题，摘要区重复同一段文字无增量价值，
    // 且 PD 从未定义过 title 档视觉——未定义场景不得自行推断
    if (summarySource === 'title') {
      displaySummary = ''
    }

    return {
      ...item,
      summary: displaySummary,
      // 空字符串 → split 产生 [''] → filter(p.trim) 过滤 → [] → wx:for 不产出节点
      summaryParagraphs: displaySummary
        ? displaySummary.split(String.fromCharCode(10)).filter(function (p) { return p.trim() }).slice(0, 3)
        : [],
      isAiSummary: summarySource === 'ai',
      summarySource: summarySource,
      state: position === 0 ? 'active' : (position < 0 ? 'above' : 'below'),
      animClass: animClass || ''
    }
  },

  // ============ 翻页手势（v5.9: 与详情页完全对齐——JS 触摸 + 70px/500ms flick-only） ============

  onTouchStart(e) {
    this._touchStartY = e.touches[0].clientY
    this._touchStartX = e.touches[0].clientX
    this._touchStartT = Date.now()
  },

  onTouchEnd(e) {
    if (this._isAnimating) return

    var dy = e.changedTouches[0].clientY - this._touchStartY
    var dx = e.changedTouches[0].clientX - (this._touchStartX || 0)
    var dt = Date.now() - this._touchStartT

    // 左滑呼出面板：横向手势优先判定，必须早于纵向早退（Math.abs(dy) < 70），
    // 否则纯横向左滑（dy 很小）会被纵向判定直接 return，导致面板永远打不开（Bug 2）。
    if (dx < -PANEL_SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      // 左滑呼出面板 = 有效手势，提示立即淡出，同会话内不再复现
      this._swipeHintDismissed = true
      this.setData({ showPanel: true, showSwipeHint: false })
      return
    }

    // 纵向翻页判定（与详情页完全一致：70px + 500ms flick-only，慢拖不翻）
    if (Math.abs(dy) < 70 || dt > 500) return
    // 首次有效上/下滑 → 提示消失（与详情页一致），同会话内不再复现
    this._swipeHintDismissed = true
    this.setData({ showSwipeHint: false })

    var atLast = this.data.currentIndex >= this.data.newsList.length - 1
    var atFirst = this.data.currentIndex <= 0

    if (dy < 0 && atLast) {
      // 已到末尾上滑 → 加载更多
      this.loadMoreNews()
    } else if (dy > 0 && atFirst) {
      // 已到开头下滑 → 刷新
      this.refreshCurrentCategory()
    } else {
      this._isAnimating = true
      if (dy < 0) this._animateSwipeNext()
      else this._animateSwipePrev()
    }
  },
  // ============ 动画切换逻辑（v5.9: 与详情页 out-in 两阶段完全一致） ============

  /**
   * 上滑 → 下一条：out-up 350ms → 重建 cards → in-up
   */
  _animateSwipeNext() {
    var that = this
    var currentIndex = this.data.currentIndex
    var newsList = this.data.newsList

    if (currentIndex >= newsList.length - 1) {
      this._isAnimating = false
      return
    }

    // 阶段 1: out-up —— 当前卡片向上移出
    var cards = this.data.cards.map(function (card) {
      var next = { ...card }
      if (card.state === 'active' || card.state === 'below') {
        next.animClass = 'out-up'
      }
      return next
    })
    this.setData({ cards: cards })
    this._lastSwipeTime = Date.now()

    // 350ms 后重建 cards（新索引）。
    // 首页多卡片模型：renderCards 重建 card 节点，新卡是全新 WX 节点（transform=0）。
    // 直接挂 in-up 会让 transition 从 0→+page-h（先反方向闪），
    // 必须先以 no-transition 瞬间吸附到屏外起点，下一帧再移除触发正确方向滑入。
    var newIndex = currentIndex + 1
    setTimeout(function () {
      that.renderCards(that.data.newsList, newIndex, 'in-up')
      // 阶段 2a: 无过渡瞬间吸附到 +page-h 屏外位置
      var snapped = that.data.cards.map(function (card) {
        return { ...card, animClass: (card.animClass || '') + ' no-transition' }
      })
      that.setData({ cards: snapped })
      // 阶段 2b: 下一帧移除 no-transition + in-up，触发 transition 从 +page-h→0（底部上滑入）
      setTimeout(function () {
        var cleared = that.data.cards.map(function (card) {
          return { ...card, animClass: '' }
        })
        that.setData({ cards: cleared })
        that._isAnimating = false
      }, 30)
    }, 350)
  },

  /**
   * 下滑 → 上一条：out-down 350ms → 重建 cards → in-down
   */
  _animateSwipePrev() {
    var that = this
    var currentIndex = this.data.currentIndex

    if (currentIndex <= 0) {
      this._isAnimating = false
      return
    }

    // 阶段 1: out-down —— 当前卡片向下移出
    var cards = this.data.cards.map(function (card) {
      var next = { ...card }
      if (card.state === 'active' || card.state === 'above') {
        next.animClass = 'out-down'
      }
      return next
    })
    this.setData({ cards: cards })
    this._lastSwipeTime = Date.now()

    // 350ms 后重建 cards（新索引）。新卡以 in-down（-page-h 屏外）起始，
    // 先 no-transition 瞬间吸附到屏外起点，再移除触发 transition 从顶部下滑入。
    var newIndex = currentIndex - 1
    setTimeout(function () {
      that.renderCards(that.data.newsList, newIndex, 'in-down')
      // 阶段 2a: 无过渡瞬间吸附到 -page-h 屏外位置
      var snapped = that.data.cards.map(function (card) {
        return { ...card, animClass: (card.animClass || '') + ' no-transition' }
      })
      that.setData({ cards: snapped })
      // 阶段 2b: 下一帧移除 no-transition + in-down，触发 transition 从 -page-h→0（顶部下滑入）
      setTimeout(function () {
        var cleared = that.data.cards.map(function (card) {
          return { ...card, animClass: '' }
        })
        that.setData({ cards: cleared })
        that._isAnimating = false
      }, 30)
    }, 350)
  },

  // ============ 边界加载更多 / 刷新 ============

  /**
   * DG-03（方案 5 改动 B）：到达列表末尾继续上滑 -> 加载更多（每次 5 条，最多 3 次）
   */
  async loadMoreNews() {
    if (this.data.loadingMore) return
    const { currentCategory, currentPage, newsList, loadMoreCount } = this.data

    // DG-03: 连续拉取 3 次上限 → 提示「已阅读了 x 条新闻，建议稍后再读」
    if (loadMoreCount >= MORE_PAGE_LIMIT) {
      wx.showToast({ title: '已阅读了 ' + newsList.length + ' 条新闻，建议稍后再读', icon: 'none' })
      return
    }
    this.setData({ loadingMore: true })
    wx.showToast({ title: '抓取更多新闻中', icon: 'loading', duration: 800 })
    try {
      const res = await getNewsList({ category: currentCategory, pageNum: currentPage + 1, pageSize: MORE_PAGE_SIZE })
      const newItems = res.list || []
      if (newItems.length === 0) {
        wx.showToast({ title: '已经到底啦', icon: 'none' })
        return
      }
      const oldLen = newsList.length
      const merged = newsList.concat(newItems)
      this.setData({ newsList: merged, currentPage: currentPage + 1, currentIndex: oldLen, loadMoreCount: loadMoreCount + 1 })
      this.renderCards(merged, oldLen)
      // BUG-20260802-004: 新增页也要进侧栏，否则又出现卡片有、侧栏没有
      this._syncPanelList(merged, oldLen)
      setTimeout(() => {
        wx.showToast({ title: '已加载 ' + newItems.length + ' 条', icon: 'none' })
      }, 400)
    } catch (err) {
      wx.showToast({ title: handleApiError(err.errorCode, err.message), icon: 'none' })
    } finally {
      this.setData({ loadingMore: false })
    }
  },

  /**
   * DG-03（方案 5 改动 C）：到达列表开头继续下滑 -> 刷新当前分类（toast 统一）
   */
  async refreshCurrentCategory() {
    if (this.data.loadingMore) return
    this.setData({ loadingMore: true })
    wx.showToast({ title: '抓取更多新闻中', icon: 'loading', duration: 800 })
    try {
      const res = await getNewsList({ category: this.data.currentCategory, pageNum: 1, pageSize: PAGE_SIZE })
      const list = res.list || []
      this.setData({ newsList: list, currentPage: 1, currentIndex: 0, loadMoreCount: 0 })
      this.renderCards(list, 0)
      // BUG-20260802-004: 刷新后侧栏随卡片一起更新
      this._syncPanelList(list, 0)
      if (list.length > 0) {
        setTimeout(() => {
          wx.showToast({ title: '已更新 ' + list.length + ' 条', icon: 'none' })
        }, 400)
      }
    } catch (err) {
      wx.showToast({ title: handleApiError(err.errorCode, err.message), icon: 'none' })
    } finally {
      this.setData({ loadingMore: false })
    }
  },

  // ============ 导航指示点点击（UX-IMPROVE06） ============

  /**
   * 点击右侧导航点，跳转到对应卡片
   */
  onNavDotTap(e) {
    if (this._isAnimating) return
    var targetIndex = e.currentTarget.dataset.index
    if (targetIndex === undefined) return
    var idx = parseInt(targetIndex)
    if (isNaN(idx) || idx < 0 || idx >= this.data.newsList.length) return
    if (idx === this.data.currentIndex) return

    this._isAnimating = true
    // 判断方向：目标在下方（上滑切换）还是上方（下滑切换）
    if (idx > this.data.currentIndex) {
      this._animateSwipeNext()
    } else {
      this._animateSwipePrev()
    }

    // 直接渲染到目标位置（不再链式调用动画，renderCards 自带 animClass=''）
    var that = this
    this.renderCards(this.data.newsList, idx)
    setTimeout(function () {
      that._isAnimating = false
    }, 50)
  },

  // ============ 卡片点击 ============

  onCardTap(e) {
    if (this._lastSwipeTime && Date.now() - this._lastSwipeTime < 500) {
      return
    }

    const { currentIndex, newsList, currentCategory } = this.data
    const news = newsList[currentIndex]
    if (!news) {
      return
    }

    // 把当前分类的新闻列表交给详情页，支持上下翻页浏览
    app.globalData.detailContext = { category: currentCategory, list: newsList }

    const url = `/pages/detail/detail?id=${news.id}&index=${currentIndex}&category=${currentCategory}`
    wx.navigateTo({
      url: url,
      fail: (err) => console.error('[home] navigateTo fail:', err)
    })
  },

  // ============ 侧边栏 ============

  /**
   * BUG-PD-019 + owner 2026-08-06 16:33: 侧边栏面板手势 —— 右滑关闭。
   * card-stage 在 showPanel 时被 display:none，手势事件丢失，
   * 因此将 touch 事件直接绑在 slide-panel 上。
   * 注意：面板内部滚动由 panel-scroll（scroll-view）处理，
   * 纵向滑动不会触发关闭；只有横向右滑（dx>50 且 |dx|>|dy|）才关闭面板。
   */
  onPanelTouchStart(e) {
    this._panelTouchStartX = e.touches[0].clientX
    this._panelTouchStartY = e.touches[0].clientY
  },

  onPanelTouchEnd(e) {
    if (!this.data.showPanel) return
    var dx = e.changedTouches[0].clientX - (this._panelTouchStartX || 0)
    var dy = e.changedTouches[0].clientY - (this._panelTouchStartY || 0)
    // 右滑且横向位移 > 纵向位移且超过 50px 阈值 → 关闭面板
    // 纵向滑动（scroll-view 滚动）: dy 大 dx 小 → 不触发关闭
    if (dx > 50 && Math.abs(dx) > Math.abs(dy)) {
      this.closePanel()
    }
  },

  closePanel() {
    const { panelCategory, currentCategory } = this.data
    // 关闭侧栏时，若侧栏分类与当前首页分类不一致，则切换
    if (panelCategory !== currentCategory) {
      // 切分类 = 新一批内容，滑动提示允许再次出现
      this._swipeHintDismissed = false
      this._showCategoryHint(panelCategory)
      this.loadCategory(panelCategory)
    }
    this.setData({ showPanel: false })
  },

  onCategoryChange(e) {
    var cat = e.currentTarget.dataset.cat
    // UX-BUG03: 立即切换高亮，不等待数据（消除 ~1s 滞后感）
    this.setData({ panelCategory: cat })
    this._updatePanelSubtitle(cat)
    this._showCategoryHint(cat) // BUG-20260802-006: 切分类 0.5s 提示

    // BUG-20260802-004: 侧栏与卡片同源 —— 切分类即切唯一数据源 newsList，侧栏由它派生
    if (cat === this.data.currentCategory) {
      // BUG-PD-019: 必须显式传入 newsList，理由同 onWheelChange
      this._syncPanelList(this.data.newsList)
      return
    }
    this.loadCategory(cat)
  },

  /**
   * UI-B7：左侧分类滚轮 change 事件（RQ-15-D 实时切换 + snap）
   * @param {Object} e - { detail: { category, index } }
   */
  onWheelChange(e) {
    var cat = e.detail && e.detail.category
    if (!cat) return
    if (cat === this.data.panelCategory) {
      this._updatePanelSubtitle(cat)
      return
    }
    this.setData({ panelCategory: cat })
    this._updatePanelSubtitle(cat)
    this._showCategoryHint(cat) // BUG-20260802-006: 滚轮切分类也需 0.5s 提示

    // 同源切换：面板分类与首页一致 → 仅刷新列表；否则切换唯一数据源
    if (cat === this.data.currentCategory) {
      // BUG-PD-019: 必须显式传入 newsList，因为 setData({panelCategory:cat}) 异步，
      // _syncPanelList 内 fallback this.data.newsList 时 panelCategory 可能还是旧值，
      // 导致 filter 全量过滤 → 空列表"暂无新闻"
      this._syncPanelList(this.data.newsList)
      return
    }
    this.loadCategory(cat)
  },

  /**
   * 已废弃：收藏入口已迁移至 dock 菜单独立收藏页（pages/favorites）
   * 原侧边栏「❤️ 收藏」Tab 及其 _loadFavorites() 于 2026-08-04 按 owner 决策删除。
   */

  onPanelItemTap(e) {
    var idx = e.currentTarget.dataset.index

    // 标准分类列表项点击
    // BUG-20260802-003: 选中对应卡片（不再跳转详情页，用户澄清「侧栏标题→跳首页卡片页」）
    // BUG-20260802-004: 侧栏与卡片同源，data-index 即 _originalIndex，可直接作为 newsList 下标
    const { newsList } = this.data
    if (idx === undefined || idx < 0 || idx >= newsList.length) return

    this.setData({ showPanel: false, currentIndex: idx })
    this.renderCards(newsList, idx)
  },

  // ============ 搜索 ============
  // 说明：v8 起取消主动搜索功能，小程序定位为「精选阅读」，不再提供搜索入口。

  // ============ 字体面板 ============

  /**
   * TL-B16: 切换「更多功能」dock 菜单（⚙ 浮动按钮 / 遮罩 皆可触发）
   */
  toggleMoreMenu() {
    this.setData({ showMoreMenu: !this.data.showMoreMenu })
  },

  /**
   * TL-B16: 更多功能菜单项点击分发
   *   about     → 关于一页
   *   history   → 浏览记录页
   *   favorites → 我的收藏页
   *   settings  → 字体设置面板
   */
  onMoreMenuTap(e) {
    var target = e.currentTarget.dataset.target
    // 先收起菜单，避免浮层遮挡即将打开的新页面 / 字体面板
    this.setData({ showMoreMenu: false })

    if (target === 'history') {
      wx.navigateTo({
        url: '/pages/history/history',
        fail: function (err) { console.error('[home] navigate history fail:', err) }
      })
    } else if (target === 'favorites') {
      wx.navigateTo({
        url: '/pages/favorites/favorites',
        fail: function (err) { console.error('[home] navigate favorites fail:', err) }
      })
    } else if (target === 'about') {
      // AB-01：dock 第 4 项「扩展位」→「关于一页」（owner 2026-08-05 确认）
      wx.navigateTo({
        url: '/pages/about/about',
        fail: function (err) { console.error('[home] navigate about fail:', err) }
      })
    } else if (target === 'settings') {
      wx.navigateTo({
        url: '/pages/settings/settings',
        fail: function (err) { console.error('[home] navigate settings fail:', err) }
      })
    }
  },

  /**
   * 关闭字体面板
   */
  onCloseFontPanel() {
    this.setData({ showFontPanel: false })
  },

  /**
   * 字体档位变更回调（从 font-panel 组件触发）
   */
  onFontPanelChange(e) {
    var tier = e.detail.tier
    this._syncFontScale()
    this.setData({ fontScaleTier: tier })
  },
})
