// 首页 - 卡片流主视图逻辑

const { CATEGORIES, SWIPE_THRESHOLD, PANEL_SWIPE_THRESHOLD, PAGE_HEIGHT, PAGE_SIZE, RECOMMEND_PAGE_SIZE, MORE_PAGE_SIZE, MORE_PAGE_LIMIT, refreshPageSize } = require('../../utils/constants')
const { getNewsList, handleApiError } = require('../../utils/request')
const { localCache } = require('../../utils/localCache')

const INTEL_ENTER_SWIPE_THRESHOLD = 60 // INTEL-BRIDGE: 右滑进入 AI 情报阈值（与 PANEL_SWIPE_THRESHOLD 同级）

const app = getApp()

// 2026-08-18（owner 决策）：分类首页首屏尺寸——recommend 读满落库 cap(15)，其余分类 8。
const firstPageSize = function (cat) {
  return cat === 'recommend' ? RECOMMEND_PAGE_SIZE : PAGE_SIZE
}

// 侧边栏分类列表（纯新闻分类，收藏入口已迁移至 dock 菜单「我的收藏」）
var PANEL_CATEGORIES = CATEGORIES

// RQ-20（全部聚合）内容分类：CATEGORIES 去除 all 本身，作为「全部」视图并行拉取的分类集合
// 与 reading-engine READING_CATEGORIES 口径一致（顺序 = CATEGORIES 固定顺序）
var CONTENT_CATEGORIES = CATEGORIES.filter(function (c) { return c.id !== 'all' })

Page({
  data: {
    menuTop: 0,
    menuHeight: 32,
    newsList: [],           // 首页当前分类的新闻
    cards: [],              // 卡片渲染数据（仅3张）
    currentIndex: 0,        // 当前卡片索引
    showPanel: false,       // 侧边栏是否显示
    panelAnim: false,       // 17:08: 面板滑入动画是否完成（完成后附加 .done 移除 transform，恢复 scroll-view 滚动）
    categories: CATEGORIES,
    panelCategories: PANEL_CATEGORIES,  // 侧边栏分类（仅新闻分类）
    currentCategory: 'recommend', // DG-03: 首页默认分类（all → 推荐）
    panelCategory: 'recommend',   // 侧边栏当前分类（独立于首页分类）
    panelCurrentIndex: 0,   // 侧边栏中标记的当前阅读位置
    filteredNewsList: [],   // 侧边栏过滤后的列表
    panelSubtitle: '',      // UI-B7：面板头部副标题「当前分类 · N 条」
    lastUpdated: '',        // 2026-08-21：列表数据最新一条的发布时间（HH:MM），用于「更新于」提示
    dataAsOf: '',           // 2026-08-24：本批数据落库时间（HH:MM，跨天含 MM/DD），顶栏「数据截至」展示
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
    _intelBridgeEnabled: true, // INTEL-BRIDGE: 右滑入口总开关，置 false 即摘除（不影响 One News 既有手势）
    intelActive: false,        // INTEL-BRIDGE: AI 情报屏是否覆盖显示（true=情报屏在屏，false=藏在左侧）
    // 关注后续：首页长按进入「我的关注」——按压进度环
    lpRing: false,
    lpX: 0,
    lpY: 0,
    // 关注后续：纯圆形绽放 overlay（不 navigateTo，避免系统右滑）
    showFollow: false,
    followEnterPoint: null,
    // 首页底部滑动提示：进入 ready 即显示，3.5s 后自动淡出；首次有效滑动即消失（与详情页 UI-B11 一致）
    showSwipeHint: true,
    // BUG-20260806-023: 状态栏小胶囊提示（替换跨分类切换的 wx.showToast）
    statusPillShow: false,
    statusPillText: '',
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

    // INTEL-BRIDGE: 从 AI 情报详情/我的返回时，恢复情报屏显示（此前右滑进情报屏 → 点进详情/我的）
    if (app.globalData && app.globalData.intelFromEmbed) {
      app.globalData.intelFromEmbed = false
      if (this.data._intelBridgeEnabled) this.setData({ intelActive: true })
    }

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

  // P2-8 修复：此前页面无 onUnload/onHide，_destroyed 从未置 true，16 处守卫全部失效；
  // 下拉刷新轮询与提示定时器在页面离开后仍继续执行（浪费云函数调用 + 销毁后 setData 告警）。
  onHide() {
    // 读库刷新已无后台轮询；此处仅作防御性清理（轮询定时器不再被设置，清除为无害 no-op）
    if (this._refreshPollTimer) { clearTimeout(this._refreshPollTimer); this._refreshPollTimer = null }
    if (this._reloadTimer) { clearTimeout(this._reloadTimer); this._reloadTimer = null }
  },

  onUnload() {
    this._destroyed = true
    var timers = [
      this._swipeHintTimer,
      this._categoryHintTimer,
      this._statusPillTimer,
      this._refreshPollTimer,
      this._reloadTimer,
      this._panelAnimTimer,
    ]
    timers.forEach(function (t) { if (t) clearTimeout(t) })
    if (Array.isArray(this._refreshReloadTimers)) {
      this._refreshReloadTimers.forEach(function (t) { if (t) clearTimeout(t) })
    }
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
    var lu = this.data.lastUpdated
    this.setData({ panelSubtitle: name + ' · ' + n + ' 条' + (lu ? ' · 更新于 ' + lu : '') })
  },

  /**
   * 2026-08-21：根据列表计算「最新一条」的发布时间，格式化为 HH:MM（本地时区）。
   * 取 publishTime / createdAt / fetchedAt 三者最大者，作为「数据更新于」展示。
   * @param {Array} list 新闻列表（含 publishTime 等毫秒时间戳字段）
   * @returns {string} "HH:MM" 或 ''
   */
  _computeLastUpdated(list) {
    if (!list || !list.length) return ''
    var max = 0
    for (var i = 0; i < list.length; i++) {
      var it = list[i]
      var t = it.publishTime || it.createdAt || it.fetchedAt || 0
      if (t > max) max = t
    }
    if (!max) return ''
    var d = new Date(max)
    var hh = ('0' + d.getHours()).slice(-2)
    var mm = ('0' + d.getMinutes()).slice(-2)
    return hh + ':' + mm
  },

  /**
   * 2026-08-24：首页「数据截至」——本批数据落库时刻（batchTime），参考 AI 情报官首页。
   * 优先用云函数返回的 batchTime（同批 createdAt 相同，即批次写入时刻）；
   * 缺失时回退取列表内 createdAt 最大值（all 聚合等场景）。格式化：当天 HH:MM，跨天 MM/DD HH:MM。
   * @param {Array} list 新闻列表（含 createdAt 毫秒时间戳）
   * @param {number} [batchTime] 云函数返回的本批落库时刻
   * @returns {string} "HH:MM" 或 "MM/DD HH:MM" 或 ''
   */
  _computeDataAsOf(list, batchTime) {
    var bt = batchTime || 0
    if (!bt && list && list.length) {
      for (var i = 0; i < list.length; i++) {
        var t = list[i].createdAt || 0
        if (t > bt) bt = t
      }
    }
    if (!bt) return ''
    var d = new Date(bt)
    var now = new Date()
    var hh = ('0' + d.getHours()).slice(-2)
    var mm = ('0' + d.getMinutes()).slice(-2)
    var sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
    return (sameDay ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ') + hh + ':' + mm
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

  /**
   * BUG-20260806-023 (FE): 状态栏小胶囊提示（替换跨分类切换的 wx.showToast）
   * 定位在状态栏区域中央（status-bar-fill 之上），自动 1.5s 淡出。
   * @param {string} text 显示文本（如「正在阅读：科技」）
   */
  _showStatusPill(text) {
    if (!text) return
    clearTimeout(this._statusPillTimer)
    this.setData({ statusPillShow: true, statusPillText: text })
    var that = this
    this._statusPillTimer = setTimeout(function () {
      if (!that._destroyed) that.setData({ statusPillShow: false })
    }, 1500)
  },

  // ============ 数据加载 ============

  /**
   * RQ-20（全部聚合）：并行拉取所有内容分类首页 → 按 CATEGORIES 顺序合并去重。
   * 「全部」视图一次性展示各分类数据（单分类 8 条 × 5 分类 ≈ 40 条），
   * 替代原先 getNewsList({category:'all'}) 单请求只返回 PAGE_SIZE=8 条的问题。
   * 单分类失败不阻塞整体（catch 返回空数组）。
   * @returns {Promise<Array>} 合并去重后的新闻列表
   */
  async _loadAllAggregated() {
    var that = this
    var fetches = CONTENT_CATEGORIES.map(function (c) {
      return getNewsList({ category: c.id, pageNum: 1, pageSize: firstPageSize(c.id) })
        .then(function (res) { return res.list || [] })
        .catch(function (err) {
          console.warn('[home] 全部聚合分类拉取失败:', c.id, err)
          return []
        })
    })
    var results = await Promise.all(fetches)
    if (that._destroyed) return []
    var seen = {}
    var merged = []
    for (var i = 0; i < results.length; i++) {
      var catList = results[i] || []
      for (var j = 0; j < catList.length; j++) {
        var item = catList[j]
        var nid = item.id || item._id
        if (!nid || seen[nid]) continue
        seen[nid] = true
        merged.push(item)
      }
    }
    return merged
  },

  /**
   * RQ-20（全部聚合）：「全部」视图翻底加载更多 —— 并行拉取各内容分类下一页，
   * 相对当前 newsList 去重后追加。
   * @param {number} currentPage 当前已拉到的页码（下一页 = currentPage + 1）
   * @returns {Promise<Array>} 新增条目（未并入 newsList）
   */
  async _loadMoreAllAggregated(currentPage) {
    var that = this
    var seen = {}
    var existing = this.data.newsList || []
    for (var e = 0; e < existing.length; e++) {
      var eid = existing[e].id || existing[e]._id
      if (eid) seen[eid] = true
    }
    var fetches = CONTENT_CATEGORIES.map(function (c) {
      return getNewsList({ category: c.id, pageNum: currentPage + 1, pageSize: MORE_PAGE_SIZE })
        .then(function (res) { return res.list || [] })
        .catch(function (err) {
          console.warn('[home] 全部聚合加载更多分类拉取失败:', c.id, err)
          return []
        })
    })
    var results = await Promise.all(fetches)
    if (that._destroyed) return []
    var newItems = []
    for (var i = 0; i < results.length; i++) {
      var catList = results[i] || []
      for (var j = 0; j < catList.length; j++) {
        var item = catList[j]
        var nid = item.id || item._id
        if (!nid || seen[nid]) continue
        seen[nid] = true
        newItems.push(item)
      }
    }
    return newItems
  },

  async loadNews(resolveIndex) {
    try {
      this.setData({ pageState: 'loading', errorMessage: '' })

      // RQ-20：'all'（全部）→ 并行聚合各分类首页，一次性展示所有分类数据
      let res = null
      let list = []
      if (this.data.currentCategory === 'all') {
        list = await this._loadAllAggregated()
      } else {
        res = await getNewsList({ category: this.data.currentCategory })
        list = (res && res.list) || []
      }

      if (list.length === 0) {
        this.setData({ newsList: [], cards: [], pageState: 'empty', errorMessage: '暂无新闻，下拉刷新试试' })
        this._syncPanelList([], 0)
        return
      }

      // resolveIndex 由详情页返回定位使用；未传则沿用当前位置（renderCards 内会做边界钳制）
      const idx = typeof resolveIndex === 'function' ? resolveIndex(list) : undefined
      // DG-03: 首次加载/切分类重置 loadMoreCount（方案 5 改动 B：每次 loadCategory 重置为 0）
      const lastUpdated = this._computeLastUpdated(list)
      const dataAsOf = this._computeDataAsOf(list, res && res.batchTime)
      this.setData({ newsList: list, pageState: 'ready', currentPage: 1, loadingMore: false, loadMoreCount: 0, lastUpdated, dataAsOf })
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
  // 2026-08-20 owner 决策：下拉刷新 = 从数据库（news_cache，即已展示给前端的数据）重新读取并渲染，
  // 不触发 newsFetcher 抓取新数据、不轮询 getNewsDelta 增量。
  onPullDownRefresh() {
    if (this.data.isRefreshing) {
      wx.stopPullDownRefresh()
      return
    }
    // 读库刷新（内部置 isRefreshing 锁；下拉指示器可先收起，读库结束后统一复位）
    this._refreshFromDb(this.data.currentCategory)
    wx.stopPullDownRefresh()
  },

  // 重试加载
  onRetry() {
    this.loadNews()
  },

  /**
   * 下拉/到顶下滑刷新（2026-08-20 owner 决策，取代 2026-08-10 FS-CF3 增量抓取）：
   * 仅从数据库（news_cache，即已展示给前端的数据）重新读取并渲染当前分类，
   * 不触发 newsFetcher 抓取新数据、不轮询 getNewsDelta 增量。
   * 数据源由整点定时 newsFetcher 自动入库，前端下拉只需拉取已入库数据。
   * @param {string} refreshTarget 要刷新的分类
   */
  async _refreshFromDb(refreshTarget) {
    // isRefreshing 作为唯一重入锁（含下拉 + 到达开头下滑两个入口）
    if (this.data.isRefreshing) return
    const target = refreshTarget || this.data.currentCategory

    this.setData({ isRefreshing: true })
    try {
      wx.showToast({ title: '正在刷新…', icon: 'loading', duration: 800 })
      // 读库：与 loadNews 同一路径，拉取已在 DB 中、展示给前端的数据
      let res = null
      let list = []
      if (target === 'all') {
        list = await this._loadAllAggregated()
      } else {
        res = await getNewsList({ category: target, pageNum: 1, pageSize: firstPageSize(target) })
        list = (res && res.list) || []
      }
      if (this._destroyed) return
      if (list.length === 0) {
        this.setData({ newsList: [], cards: [], pageState: 'empty', errorMessage: '暂无新闻，下拉刷新试试', currentPage: 1, loadingMore: false, loadMoreCount: 0 })
        this._syncPanelList([], 0)
      } else {
        const lastUpdated = this._computeLastUpdated(list)
        const dataAsOf = this._computeDataAsOf(list, res && res.batchTime)
        this.setData({ newsList: list, pageState: 'ready', currentPage: 1, currentIndex: 0, loadingMore: false, loadMoreCount: 0, lastUpdated, dataAsOf })
        this.renderCards(list, 0)
        this._syncPanelList(list, 0)
      }
      wx.showToast({ title: '已刷新' + (this.data.lastUpdated ? ' · ' + this.data.lastUpdated : ''), icon: 'none', duration: 1200 })
    } catch (err) {
      console.error('下拉刷新(读库)失败:', err)
      const msg = handleApiError(err.errorCode, err.message)
      this.setData({ pageState: 'error', errorMessage: msg })
      wx.showToast({ title: '刷新失败，请稍后重试', icon: 'none' })
    } finally {
      this.setData({ isRefreshing: false })
    }
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

    // FS-03（owner 2026-08-07 裁定）：四级摘要降级 —— AI 摘要(ai) → 原摘要(desc) → 正文第一段(content) → 标题(title)
    // FS-05（2026-08-09 owner 拍板）：兜底条件扩展 —— 任何"无 AI 摘要 + 有正文"都走首段,
    // 不再要求 summarySource === 'title'。修复场景：聚合接口返回"假 desc"（日期/来源名/标点）,
    // 原本被判为有效 desc → 跳过兜底 → 前端直接展示假 desc。
    // FS-05 v2:兼容老 DB 记录 summarySource 字段缺失(标 undefined),按 'desc' 走首段兜底逻辑。
    var summarySource = item.summarySource || 'desc'
    var displaySummary = item.summary || ''
    // 假 desc 防御(前端兜底,后端已写 summarySource='content' 或 'title',但老数据可能没标)
    var isFakeDesc = function(s) {
      if (!s) return true
      if (s === item.title) return true
      if (s.length < 20) return true
      var stripped = s.replace(/[\d\s\-/:.\u3000,，。、年月日时分秒]+/g, '')
      if (stripped.length < 5) return true
      if (item.source && s === item.source) return true
      return false
    }
    if (summarySource === 'title' || (summarySource !== 'ai' && isFakeDesc(displaySummary) && item.content && item.content.length > 10)) {
      // 走首段兜底（FS-09：首段不合格时继续扫描后续段落，取第一个合格段落）
      var paragraphs = (item.content || '').split('\n').map(function(s){return s.trim()}).filter(function(s){return s.length > 0})
      var contentParagraph = ''
      for (var pi = 0; pi < paragraphs.length; pi++) {
        if (paragraphs[pi].length >= 20 && paragraphs[pi] !== item.title) {
          contentParagraph = paragraphs[pi]
          break
        }
      }
      if (contentParagraph) {
        // FE-20260810-003：移除 150 字硬截断 —— 完整展示首段（句子不中途断裂）。
        // 内容超高由布局整体居中 + 物理溢出兜底（FE-20260810-002）。
        displaySummary = contentParagraph
        summarySource = 'content'
      } else {
        // 所有段落都不合格 → 退到 title 档
        displaySummary = item.title || ''
        summarySource = 'title'
      }
    } else if (summarySource === 'title') {
      displaySummary = item.title || ''
    }

    // 官方 RSS 源（contentSource==='official_rss'）：来源名取 sourceName（落库字段），
    // 与普通源 item.source 区分；元信息行直接并入，不另起角标（PD+PE 评审 §五 3.1）。
    var isOfficialSource = item.contentSource === 'official_rss'
    var metaSource = isOfficialSource ? (item.sourceName || item.source || '') : (item.source || '')

    return {
      ...item,
      summary: displaySummary,
      // 空字符串 → split 产生 [''] → filter(p.trim) 过滤 → [] → wx:for 不产出节点
      summaryParagraphs: displaySummary
        ? displaySummary.split(String.fromCharCode(10)).filter(function (p) { return p.trim() }).slice(0, 3)
        : [],
      isAiSummary: summarySource === 'ai',
      summarySource: summarySource,
      isOfficialSource: isOfficialSource,
      metaSource: metaSource,
      state: position === 0 ? 'active' : (position < 0 ? 'above' : 'below'),
      animClass: animClass || ''
    }
  },

  // ============ 翻页手势（v5.9: 与详情页完全对齐——JS 触摸 + 70px/500ms flick-only） ============

  onTouchStart(e) {
    this._touchStartY = e.touches[0].clientY
    this._touchStartX = e.touches[0].clientX
    this._touchStartT = Date.now()
    // 关注后续：长按进入「我的关注」（仅 One News 首页本体、面板/情报屏未展开时）
    this._startFollowPress(e)
  },

  onTouchMove(e) {
    // 关注后续：长按期间若手指移动超过阈值，取消长按（让位给翻页/右滑/面板手势）
    if (this._touchActive && e.touches && e.touches[0]) {
      var dx = e.touches[0].clientX - (this._touchStartX || 0)
      var dy = e.touches[0].clientY - (this._touchStartY || 0)
      if (Math.abs(dx) > 20 || Math.abs(dy) > 20) this._cancelLongPress()
    }
  },

  onTouchEnd(e) {
    // 关注后续：松手即清除长按计时（任何情况都清，含动画中）
    this._cancelLongPress()
    if (this._isAnimating) return

    var dy = e.changedTouches[0].clientY - this._touchStartY
    var dx = e.changedTouches[0].clientX - (this._touchStartX || 0)
    var dt = Date.now() - this._touchStartT

    // 左滑呼出面板：横向手势优先判定，必须早于纵向早退（Math.abs(dy) < 70），
    // 否则纯横向左滑（dy 很小）会被纵向判定直接 return，导致面板永远打不开（Bug 2）。
    if (dx < -PANEL_SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      // 左滑呼出面板 = 有效手势，提示立即淡出，同会话内不再复现
      this._swipeHintDismissed = true
      this.setData({ showSwipeHint: false })
      this.openPanel()
      return
    }

    // 纵向翻页判定（与详情页完全一致：70px + 500ms flick-only，慢拖不翻）
    if (Math.abs(dy) < SWIPE_THRESHOLD || dt > 500) return
    // 首次有效上/下滑 → 提示消失（与详情页一致），同会话内不再复现
    this._swipeHintDismissed = true
    this.setData({ showSwipeHint: false })

    var atLast = this.data.currentIndex >= this.data.newsList.length - 1
    var atFirst = this.data.currentIndex <= 0

    if (dy < 0 && atLast) {
      // 已到末尾上滑 → 优先跨分类切到下一分类第一条（BUG-20260806-022）
      // 若已是最后一个分类 → 回退加载更多（原行为）
      this._tryNextCategoryOrLoadMore()
    } else if (dy > 0 && atFirst) {
      // 已到开头下滑 → 刷新
      this.refreshCurrentCategory()
    } else {
      this._isAnimating = true
      if (dy < 0) this._animateSwipeNext()
      else this._animateSwipePrev()
    }
  },

  // ============ 关注后续：长按进入「我的关注」 ============
  // 规则：按住不动 500ms = 触发；一滚动/移动就取消（与详情页一致，无冲突）
  _startFollowPress(e) {
    if (this._destroyed || this.data.showPanel || this.data.intelActive) return
    var t = (e.touches && e.touches[0]) || {}
    this._touchActive = true
    this.setData({
      lpRing: true,
      lpX: t.clientX || 0,
      lpY: t.clientY || 0,
    })
    var that = this
    if (this._lpTimer) clearTimeout(this._lpTimer)
    this._lpTimer = setTimeout(function () { that._enterFollow() }, 500)
  },
  _cancelLongPress() {
    this._touchActive = false
    if (this._lpTimer) { clearTimeout(this._lpTimer); this._lpTimer = null }
    if (this.data.lpRing) this.setData({ lpRing: false })
  },
  _enterFollow() {
    this._touchActive = false
    this._lpTimer = null
    this.setData({ lpRing: false })
    // 纯圆形绽放 overlay：记录按压点，展开覆盖层（clip-path 从按压点 0%→150%）
    const p = { x: this._touchStartX || 0, y: this._touchStartY || 0 }
    app.globalData.followEnterPoint = p
    this.setData({ showFollow: true, followEnterPoint: p })
  },

  // 覆盖层返回：收起 overlay（反向圆形收回由组件内部完成）
  onFollowBack() {
    this.setData({ showFollow: false })
  },

  // ============ INTEL-BRIDGE (START): AI 情报模块——同屏横滑（内嵌面板，最小可摘除） ============
  // 说明：本段为 AI 情报官模块新增，独立于 One News 既有业务。
  //  owner 2026-08-18 拍板：AI 情报屏内嵌为 One News 首页覆盖层，同屏横滑切换。
  //   - One News 屏右滑（dx>0，横向）→ 情报屏从左侧滑入（intelActive=true）
  //   - AI 情报屏左滑（dx<0，横向）→ 从右侧滑回 One News（intelActive=false）
  //   - 与 card-stage 的 One News 翻页/左滑呼出面板完全解耦：
  //       * intelActive=false（One News 屏）：右滑本无行为 → 进情报；左滑仍交 card-stage onTouchEnd 呼出面板
  //       * intelActive=true（情报屏覆盖）：card-stage 被盖住收不到触摸 → 左滑仅用于返回，无冲突
  //   - 面板/情报屏互相排斥：打开情报屏时先关侧边栏（避免叠层）。
  //  摘除方式：删除本段 + home.wxml 的 <intel-stage> + home.json 注册 + data._intelBridgeEnabled/intelActive 即可。
  onIntelTouchStart(e) {
    this._intelTouchX = e.touches[0].clientX
    this._intelTouchY = e.touches[0].clientY
    this._intelTouchT = Date.now()
  },
  onIntelTouchEnd(e) {
    if (!this.data._intelBridgeEnabled) return
    if (this._intelTouchX === undefined) return
    var dx = e.changedTouches[0].clientX - this._intelTouchX
    var dy = e.changedTouches[0].clientY - this._intelTouchY
    var dt = Date.now() - this._intelTouchT
    // 防抖：1 秒内只允许触发一次（避免与 card-stage 冒泡重复/连点）
    if (this._intelNavLock) return
    var intelOn = this.data.intelActive

    if (intelOn) {
      // 当前 AI 情报屏覆盖：仅响应「左滑返回」；纵向滚动（情报内 scroll-view）dy 占主导不会误触
      if (dx < -INTEL_ENTER_SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) && dt < 800) {
        this._intelNavLock = true
        var that2 = this
        setTimeout(function () { that2._intelNavLock = false }, 1000)
        console.log('[intel-bridge] 情报屏左滑返回 One News, dx=', dx)
        this.setData({ intelActive: false })
      }
      return // 情报屏打开时不再处理 One News 屏的其它横向手势
    }

    // One News 屏：右滑进入情报；左滑（呼出面板）由 card-stage onTouchEnd 处理，此处不碰
    // 侧边栏展开态（showPanel）排除：此时右滑是用来「收起侧边栏」的，由 slide-panel 的
    // onPanelTouchEnd 处理，不应被误判成进入 AI 情报。仅当侧边栏收起、在 One News 首页本体右滑才进入。
    if (!this.data.showPanel && dx > INTEL_ENTER_SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) && dt < 800) {
      this._intelNavLock = true
      var that = this
      setTimeout(function () { that._intelNavLock = false }, 1000)
      console.log('[intel-bridge] 右滑进入 AI 情报, dx=', dx)
      // 打开情报屏前先收起侧边栏，避免叠层
      if (this.data.showPanel) this.closePanel()
      this.setData({ intelActive: true })
    }
  },
  // 组件内 ‹ 返回按钮请求滑回 One News
  onIntelReqBack() {
    if (!this.data.intelActive) return
    this.setData({ intelActive: false })
  },
  // ============ INTEL-BRIDGE (END) ============

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
    // 修复（owner 2026-08-16）：仅 active 卡参与 out 动画——above/below 卡是 opacity:0 的隐藏卡，
    // 若一并挂 out-* 会出现"鬼影卡"滑过屏幕（上一条/下一条提前闪现又消失），观感不自然
    var cards = this.data.cards.map(function (card) {
      var next = { ...card }
      if (card.state === 'active') {
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
    // 修复（owner 2026-08-16）：仅 active 卡参与 out 动画（同上，消除隐藏卡鬼影）
    var cards = this.data.cards.map(function (card) {
      var next = { ...card }
      if (card.state === 'active') {
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
   * BUG-20260806-022 (FE): 当前分类最后一条上滑 → 优先跨分类切到下一分类第一条。
   * 若已是最后一个分类 → 回退 loadMoreNews()（原加载更多行为）。
   * 与详情页 reading-engine.loadNextCategory 的顺序保持一致（CATEGORIES 固定顺序）。
   */
  _tryNextCategoryOrLoadMore() {
    const { currentCategory, loadingMore } = this.data
    if (loadingMore) return

    // RQ-20（全部聚合）：'all' 已聚合所有内容分类，读到末尾 → 直接加载更多，
    // 避免切到下一分类（recommend）导致与聚合内容重复。
    if (currentCategory === 'all') {
      this.loadMoreNews()
      return
    }

    // 找当前分类在 CATEGORIES 中的顺序位置
    const curIdx = CATEGORIES.findIndex(c => c.id === currentCategory)
    const nextCat = curIdx >= 0 && curIdx < CATEGORIES.length - 1 ? CATEGORIES[curIdx + 1] : null

    if (!nextCat) {
      // 已是最后一个分类 → 回退加载更多
      this.loadMoreNews()
      return
    }

    // 跨分类切换：状态栏小胶囊提示（BUG-20260806-023 替换 wx.showToast，与详情页 _tryNextCategory 一致）
    this.setData({ loadingMore: true })
    this._showStatusPill('正在阅读：' + nextCat.name)

    // 拉取下一分类首页
    getNewsList({ category: nextCat.id, pageNum: 1, pageSize: firstPageSize(nextCat.id) })
      .then(res => {
        const list = res.list || []
        if (this._destroyed) return
        if (list.length === 0) {
          // 下一分类无数据 → 继续跳过（与详情页 owner 决策②③一致：无数据跳下下分类）
          this.setData({ loadingMore: false })
          this._tryNextCategoryFrom(nextCat.id)
          return
        }
        // 更新当前分类 + 列表 + 索引，沿用翻页动画 out-up → in-up
        this._isAnimating = true
        this.setData({
          currentCategory: nextCat.id,
          panelCategory: nextCat.id,
          currentPage: 1,
          loadMoreCount: 0,
          newsList: list,
        })
        // 阶段 1: out-up 旧卡片移出
        const cards = this.data.cards.map(card => {
          const next = { ...card }
          if (card.state === 'active' || card.state === 'below') next.animClass = 'out-up'
          return next
        })
        this.setData({ cards })
        setTimeout(() => {
          this.renderCards(list, 0, 'in-up')
          // 阶段 2a: no-transition 瞬间吸附到 +page-h 屏外
          const snapped = this.data.cards.map(card => ({ ...card, animClass: (card.animClass || '') + ' no-transition' }))
          this.setData({ cards: snapped })
          // 阶段 2b: 下一帧移除，触发从底部上滑入
          setTimeout(() => {
            const cleared = this.data.cards.map(card => ({ ...card, animClass: '' }))
            this.setData({ cards: cleared })
            this._isAnimating = false
            this.setData({ loadingMore: false })
            // 侧栏同步
            this._syncPanelList(list, 0)
          }, 30)
        }, 350)
      })
      .catch(err => {
        if (this._destroyed) return
        this.setData({ loadingMore: false })
        wx.showToast({ title: handleApiError(err.errorCode, err.message), icon: 'none' })
      })
  },

  /**
   * BUG-20260806-022: 跨分类跳过无数据分类后的递归入口（从指定分类继续向后找）
   * @param {string} fromCatId - 已确认无数据的分类 id（跳过它，从下一分类继续）
   */
  _tryNextCategoryFrom(fromCatId) {
    const fromIdx = CATEGORIES.findIndex(c => c.id === fromCatId)
    const nextCat = fromIdx >= 0 && fromIdx < CATEGORIES.length - 1 ? CATEGORIES[fromIdx + 1] : null
    if (!nextCat) {
      // BUG-20260806-023: 状态栏小胶囊提示（替换 wx.showToast）
      this._showStatusPill('已经到底啦')
      return
    }
    // 递归：直接以目标分类再走一次跨分类流程
    this._switchToCategory(nextCat.id, nextCat.name)
  },

  /**
   * BUG-20260806-022: 切换到指定分类（供无数据跳过递归复用）
   */
  _switchToCategory(catId, catName) {
    getNewsList({ category: catId, pageNum: 1, pageSize: firstPageSize(catId) })
      .then(res => {
        const list = res.list || []
        if (this._destroyed) return
        if (list.length === 0) {
          this._tryNextCategoryFrom(catId)
          return
        }
        this._isAnimating = true
        this.setData({
          currentCategory: catId,
          panelCategory: catId,
          currentPage: 1,
          loadMoreCount: 0,
          newsList: list,
        })
        const cards = this.data.cards.map(card => {
          const next = { ...card }
          if (card.state === 'active' || card.state === 'below') next.animClass = 'out-up'
          return next
        })
        this.setData({ cards })
        setTimeout(() => {
          this.renderCards(list, 0, 'in-up')
          const snapped = this.data.cards.map(card => ({ ...card, animClass: (card.animClass || '') + ' no-transition' }))
          this.setData({ cards: snapped })
          setTimeout(() => {
            const cleared = this.data.cards.map(card => ({ ...card, animClass: '' }))
            this.setData({ cards: cleared })
            this._isAnimating = false
            this.setData({ loadingMore: false })
            this._syncPanelList(list, 0)
          }, 30)
        }, 350)
      })
      .catch(err => {
        if (this._destroyed) return
        this.setData({ loadingMore: false })
        wx.showToast({ title: handleApiError(err.errorCode, err.message), icon: 'none' })
      })
  },

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
      // RQ-20：'all'（全部）→ 并行拉取各分类下一页聚合追加；其余分类保持单请求
      const newItems = currentCategory === 'all'
        ? await this._loadMoreAllAggregated(currentPage)
        : (await getNewsList({ category: currentCategory, pageNum: currentPage + 1, pageSize: MORE_PAGE_SIZE })).list || []
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
      // FS-CF2：翻页只是读取数据库既有分页内容（非抓取新新闻），提示不得虚报条数，
      // 统一改为「已加载更多」（另「已加载新内容」亦不实——因为新内容来自后台刷新而非本操作）。
      setTimeout(() => {
        wx.showToast({ title: '已加载更多', icon: 'none' })
      }, 400)
    } catch (err) {
      wx.showToast({ title: handleApiError(err.errorCode, err.message), icon: 'none' })
    } finally {
      this.setData({ loadingMore: false })
    }
  },

  /**
   * DG-03（方案 5 改动 C）：到达列表开头继续下滑 -> 刷新
   * 2026-08-20 owner 决策：到达开头下滑 = 读库刷新（与下拉刷新一致），
   * 仅从数据库（news_cache，即已展示给前端的数据）重新读取并渲染，不抓取新数据、不轮询增量。
   * 历史：2026-08-10 FS-CF3 曾改为「真刷（newsFetcher + getNewsDelta 增量）」以修复「假刷新」；
   * 本次 owner 决策明确回退为「读库刷新」——数据源由整点定时 newsFetcher 自动入库，前端下拉只需拉取已入库数据。
   */
  async refreshCurrentCategory() {
    if (this.data.loadingMore || this.data.isRefreshing) return
    // 2026-08-20 owner 决策：到达开头下滑 = 读库刷新（不抓取新数据），toast 由 _refreshFromDb 统一处理
    try {
      await this._refreshFromDb(this.data.currentCategory)
    } finally {
      this.setData({ loadingMore: false })
    }
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

  // ============ 官方源「出处 ↗」回源（v1.0 §6.2，镜像 detail.onCopySourceUrl） ============
  // 个人主体 web-view 不可用，采用「复制链接 + 引导外部浏览器打开」方案。
  // 列表卡片整卡 bindtap=onCardTap 会跳详情，故 wxml 用 catchtap 阻止冒泡，点击此处只复制源站链接。
  onCopySourceUrl(e) {
    const url = e.currentTarget.dataset.url
    if (!url) {
      wx.showToast({ title: '该源暂不支持查看', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showToast({ title: '链接已复制，粘贴到浏览器中打开', icon: 'none', duration: 2500 })
      },
      fail: () => {
        wx.showToast({ title: '复制失败，请稍后再试', icon: 'none' })
      }
    })
  },

  // ============ 分享（RQ-2026-08-09 owner：首页支持发送给朋友 + 分享朋友圈） ============

  /**
   * 分享首页当前正在阅读的新闻卡片（有数据时）→ 跳详情页；无数据时分享首页本身。
   * 发送给朋友：title（≤30 字）+ path 直达详情；imageUrl 用新闻图（如有），否则默认。
   */
  onShareAppMessage: function () {
    const { currentIndex, newsList, currentCategory } = this.data
    const news = (newsList && newsList[currentIndex]) || null

    if (news && news.id) {
      var title = '一页 | ' + (news.title || '新闻速览')
      if (title.length > 30) {
        var chars = Array.from(title)
        title = chars.slice(0, 29).join('') + '\u2026'
      }
      return {
        title: title,
        path: `/pages/detail/detail?id=${news.id}&index=${currentIndex}&category=${currentCategory}`,
        imageUrl: news.picUrl || undefined,
      }
    }

    // 数据未就绪：分享首页入口
    return {
      title: '一页 · 极简新闻速览',
      path: '/pages/home/home',
    }
  },

  /**
   * 分享到朋友圈（单页模式）：不支持自定义 path，仅 query 定位。
   * 首页作为纯内容聚合页，朋友圈打开后进入首页单页模式（场景值 1154），
   * 顶部固定导航 + 底部「前往小程序」，页面内容正常展示。
   */
  onShareTimeline: function () {
    const { currentIndex, newsList, currentCategory } = this.data
    const news = (newsList && newsList[currentIndex]) || null

    var title = news && news.title ? '一页 | ' + news.title : '一页 · 极简新闻速览'
    if (title.length > 30) {
      var chars = Array.from(title)
      title = chars.slice(0, 29).join('') + '\u2026'
    }

    return {
      title: title,
      query: news && news.id
        ? 'id=' + encodeURIComponent(news.id) + '&index=' + currentIndex + '&category=' + encodeURIComponent(currentCategory)
        : 'category=' + encodeURIComponent(currentCategory || 'recommend'),
      imageUrl: (news && news.picUrl) || undefined,
    }
  },

  // ============ 侧边栏 ============

  /**
   * BUG-PD-019 + owner 2026-08-06 16:33 + 17:08: 侧边栏面板手势 —— 右滑关闭。
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

  /**
   * 17:08 系统性修复③：打开面板动画状态机。
   * 阶段 1：showPanel=true（无 .done）→ .show 触发 translateX(100%)→0 滑入；
   * 阶段 2：350ms 滑入完成后附加 panelAnim=true（.done）→ transform:none，
   *         移除 transform 祖先，面板内 scroll-view 原生滚动恢复正常。
   */
  openPanel() {
    clearTimeout(this._panelAnimTimer)
    this.setData({ showPanel: true, panelAnim: false })
    var that = this
    this._panelAnimTimer = setTimeout(function () {
      if (that._destroyed) return
      if (that.data.showPanel) that.setData({ panelAnim: true })
    }, 350)
  },

  /**
   * 17:08 系统性修复③：关闭面板动画状态机。
   * 阶段 1：先移除 .done（transform:none → translateX(0)，视觉完全一致，无跳动）；
   * 阶段 2：30ms 后移除 .show（translateX(0) → translateX(100%) 滑出动画）。
   * @param {Function} [done] 滑出动画触发后的回调（不等待动画结束）
   */
  _animateClose(done) {
    if (!this.data.showPanel) return
    clearTimeout(this._panelAnimTimer)
    this.setData({ panelAnim: false })
    var that = this
    this._panelAnimTimer = setTimeout(function () {
      if (that._destroyed) return
      that.setData({ showPanel: false })
      if (typeof done === 'function') done()
    }, 30)
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
    this._animateClose()
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
    // BUG-20260806-017 (FE): owner 裁定取消选中后 toast 提示，滚轮切换分类不再弹 toast

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

    this.setData({ currentIndex: idx })
    this.renderCards(newsList, idx)
    // 17:08: 关闭面板走动画状态机（先移除 .done 再滑出）
    this._animateClose()
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
})
