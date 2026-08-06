// 收藏列表页 — TL-B13 / RQ-03 + UI-B10 + DG-04（纯本地化：云函数 setUserFavorite/getUserFavorites 已停用）

// DG-03: 统一全局单例 localCache（detail/favorites/history 同源）
var localCache = require('../../utils/localCache').localCache
var { formatRelativeTime } = require('../../utils/util')
var app = getApp()

// 全局缓存单例（与首页侧边栏、详情页同源，可读到 detail 写入的 favorites）
var _cache = localCache

// 收藏 TTL：30 天（owner 决策，纯本地）
var FAVORITES_TTL = 30 * 24 * 60 * 60 * 1000

// UI-B10: 分类筛选胶囊（与 reading-engine 跨分类顺序一致；去掉「全部」，默认展示全部）
var CATEGORIES = [
  { id: 'tech', name: '科技' },
  { id: 'international', name: '世界' },
  { id: 'sports', name: '体育' },
  { id: 'life', name: '生活' },
]


Page({
  data: {
    menuTop: 0,
    menuHeight: 32,
    navOffset: 0,  // D-09 v1.2（BUG-20260806-007）: 内容起始基准
    list: [],
    filteredList: [],
    categories: CATEGORIES,
    activeCategory: '',
    filteredCount: 0,
    loading: true,
    isEmpty: false,
    sheetVisible: false,
    _lastHomeTap: 0,
    // BUG-FS-20260805-001: 深色模式下空态星星 icon 切换白色版（image 渲染 SVG 时 currentColor 不生效→黑色，深色下几乎不可见）
    isDark: false,
  },

  onLoad: function () {
    this.setData({
      // BUG-20260806-004: 导航栏与胶囊对齐
      menuTop: (app && app.globalData.menuTop) || 0,
      menuHeight: (app && app.globalData.menuHeight) || 32,
      // BUG-20260806-009 v3: 状态栏背景层高度（custom 模式下 setNavigationBarColor 无效）
      statusBarHeight: (app && app.globalData.statusBarHeight) || 20,
      // D-09 v1.2（BUG-20260806-007）: 内容起始基准 = menuTop + menuHeight + 12px
      navOffset: ((app && app.globalData.menuTop) || 0) + ((app && app.globalData.menuHeight) || 32) + 12,
      // BUG-20260805-003: 全局手动主题（设置页深色模式）同步到本页根节点
      themeClass: (app && app.globalData && app.globalData.themeClass) || '',
      // BUG-FS-20260805-001: 空态星星 icon 按主题切换白色版
      isDark: this._isSystemDark(),
    })

    // BUG-20260806-009 follow-up: 页面级调用状态栏 API
    if (app && app.setNavBarColor) {
      app.setNavBarColor((app.globalData && app.globalData.effectiveTheme) || 'light')
    }
  },

  onShow: function () {
    // BUG-20260805-003: onShow 刷新主题（可能从设置页返回）
    this.setData({
      themeClass: (app && app.globalData && app.globalData.themeClass) || '',
      // BUG-FS-20260805-001: onShow 同步刷新（从设置页切换主题返回时更新星星颜色）
      isDark: this._isSystemDark(),
    })
    this._load()
  },

  /**
   * BUG-FS-20260805-001: 判断当前生效主题是否深色（含手动模式，与 detail 页 _isSystemDark 同源）
   */
  _isSystemDark: function () {
    try {
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
   * DG-04（纯本地化）：加载收藏 —— 本地读取 + 30 天过期过滤（云函数已停用）
   */
  _load: function () {
    var that = this
    this.setData({ loading: true })

    var local = _cache.get('favorites') || []
    var merged = that._merge(local, [])
    that._setList(merged)
    that.setData({ loading: false })
  },

  /**
   * UI-14 兼容：同步失败条重试入口保留（纯本地后无云端，直接重载本地）
   */
  onSyncRetry: function () {
    this._load()
  },

  /**
   * UI-B10: 统一设置列表并应用当前筛选
   */
  _setList: function (list) {
    this._allList = list
    this._applyFilter(list, this.data.activeCategory)
  },

  /**
   * UI-B10: 应用分类筛选
   */
  _applyFilter: function (list, category) {
    var filtered = category
      ? list.filter(function (item) { return item.category === category })
      : list
    this.setData({
      list: list,
      filteredList: filtered,
      filteredCount: filtered.length,
      isEmpty: list.length === 0,
    })
  },

  /**
   * DG-04（纯本地）：合并本地列表 —— addedAt 倒序 + 30 天过期过滤 + 相对时间格式化
   * cloudList 参数保留兼容（实际仅本地）
   */
  _merge: function (localList) {
    var now = Date.now()
    var map = {}
    localList.forEach(function (item) {
      if (!item || !item.id) return
      // 过期过滤：addedAt + 30 天
      if (item.addedAt && now - item.addedAt > FAVORITES_TTL) return
      map[item.id] = item
    })
    var arr = Object.keys(map).map(function (k) { return map[k] })
    arr.sort(function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0) })
    return arr.map(function (item) {
      return Object.assign({}, item, {
        _time: formatRelativeTime(item.addedAt),
        _pending: false,  // DG-04: 纯本地无待同步
      })
    })
  },

  /**
   * UI-13 兼容：☁️ 待同步角标点击（DG-04 纯本地后无云端同步，直接清除角标）
   */
  onPendingTap: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    that.setData({ list: that.data.list.map(function (item) {
      return item.id === id ? Object.assign({}, item, { _pending: false }) : item
    }) })
  },

  onItemTap: function (e) {
    // UI-B10: 长按触发后 300ms 内屏蔽 click，避免误跳转
    if (this._longPressTriggered) {
      this._longPressTriggered = false
      return
    }
    var that = this
    var id = e.currentTarget.dataset.id
    var cat = e.currentTarget.dataset.cat || 'recommend'
    // DG-04（方案 4 改动 A）：透传来源列表，详情按来源顺序翻页、禁跨分类
    var src = (that._allList || that.data.list).map(function (item) {
      return {
        id: item.id,
        title: item.title || '',
        category: item.category || '',
        categoryName: item.categoryName || '',
        source: item.source || '',
        picUrl: item.picUrl || '',
        time: item.time || '',
      }
    })
    app.globalData.detailContext = { category: cat, list: src, source: 'favorites', entryId: id }
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id + '&category=' + cat + '&source=favorites' })
  },

  /**
   * UI-B10: 分类筛选切换
   */
  onFilterTap: function (e) {
    var cat = e.currentTarget.dataset.id
    var next = this.data.activeCategory === cat ? '' : cat
    this.setData({ activeCategory: next })
    this._applyFilter(this._allList || this.data.list, next)
  },

  /**
   * UI-B10: 长按开始计时，500ms 后弹出取消收藏 ActionSheet
   */
  onTouchStart: function (e) {
    var that = this
    this._longPressTriggered = false
    clearTimeout(this._lpTimer)
    this._lpId = e.currentTarget.dataset.id
    this._lpTimer = setTimeout(function () {
      that._longPressTriggered = true
      that._openSheet(that._lpId)
    }, 500)
  },

  onTouchEnd: function () {
    clearTimeout(this._lpTimer)
  },

  onLongPress: function (e) {
    // 与 onTouchStart 双保险：真机 longpress 事件触发也打开 sheet
    this._longPressTriggered = true
    this._openSheet(e.currentTarget.dataset.id)
  },

  _openSheet: function (id) {
    this._pendingId = id
    this.setData({ sheetVisible: true })
  },

  onSheetCancel: function () {
    this._pendingId = null
    this.setData({ sheetVisible: false })
  },

  /**
   * UI-B10: 确认取消收藏 —— 本地立即移除（DG-04 纯本地，无云端双写）
   */
  onConfirmUnfavorite: function () {
    var that = this
    var id = this._pendingId
    if (!id) {
      that.setData({ sheetVisible: false })
      return
    }

    // 乐观更新：先移除
    var next = (that._allList || that.data.list).filter(function (item) { return item.id !== id })
    that._setList(next)
    that.setData({ sheetVisible: false })
    wx.showToast({ title: '已取消收藏', icon: 'none' })

    // 本地缓存写入
    try {
      var favorites = next.map(function (item) {
        return {
          id: item.id,
          title: item.title,
          category: item.category,
          categoryName: item.categoryName,
          source: item.source,
          picUrl: item.picUrl,
          addedAt: item.addedAt,
        }
      })
      _cache.set('favorites', favorites, { ttl: 0 })
    } catch (e) {}
  },

  /**
   * TL-B15 / RQ-17：返回主页
   */
  goHome: function () {
    var now = Date.now()
    if (this.data._lastHomeTap && now - this.data._lastHomeTap < 300) return
    this.setData({ _lastHomeTap: now })
    wx.reLaunch({
      url: '/pages/home/home',
      fail: function () {
        try {
          var pages = getCurrentPages()
          wx.navigateBack({ delta: Math.max(1, pages.length - 1) })
        } catch (e) { wx.reLaunch({ url: '/pages/home/home' }) }
      },
    })
  },
})
