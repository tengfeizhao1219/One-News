// 收藏列表页 — TL-B13 / RQ-03 + UI-B10 + DG-04（纯本地化：云函数 setUserFavorite/getUserFavorites 已停用）

// DG-03: 统一全局单例 localCache（detail/favorites/history 同源）
var localCache = require('../../utils/localCache').localCache
var { formatAbsoluteTime } = require('../../utils/util')
var ALL_CATEGORIES = require('../../utils/constants').CATEGORIES
var app = getApp()

// 全局缓存单例（与首页侧边栏、详情页同源，可读到 detail 写入的 favorites）
var _cache = localCache

// 收藏 TTL：30 天（owner 决策，纯本地）
var FAVORITES_TTL = 30 * 24 * 60 * 60 * 1000

// UI-B10: 分类筛选胶囊（与 constants.js 标准分类统一，去掉「全部」；默认展示全部）
// 原硬编码分类名（世界/体育/生活）与标准分类（国际/科学探索/社会）不一致、
// 且缺 recommend —— 统一从 constants.js 派生，与 home.js CONTENT_CATEGORIES / reading-engine READING_CATEGORIES 口径一致。
var CATEGORIES = ALL_CATEGORIES.filter(function (c) { return c.id !== 'all' })


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
    // BUG-20260806-020: 左滑状态 —— 当前打开的滑动项 id（'' 表示全部收起）
    openSwipeId: '',
    // BUG-20260806-020: 各滑动项实时位移（rpx），key = item.id
    swipeOffsets: {},
    // BUG-20260806-020: 正在拖动中的项 id（拖动时禁用 CSS transition 防滞后）
    swipingId: '',
    _lastHomeTap: 0,
    // BUG-FS-20260805-001: 深色模式下空态星星 icon 切换白色版（image 渲染 SVG 时 currentColor 不生效→黑色，深色下几乎不可见）
    isDark: false,
  },

  onLoad: function () {
    // 2026-08-31 修复：冷启动/栈底进入收藏页（getCurrentPages 深度=1）时，
    // iOS 左滑返回无上级页 → 直接退出小程序。先 reLaunch 到新闻首页并带 redirect
    // 回跳参数，由 home 重建 home→favorites 栈，左滑返回自然回到首页。
    try {
      var _stack = getCurrentPages()
      if (_stack.length === 1) {
        wx.reLaunch({
          url: '/pages/home/home?redirect=favorites',
          fail: function () { /* 忽略：保持当前页 */ },
        })
        return
      }
    } catch (e) { /* 忽略 */ }
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
    // 刷新底部 splash logo 主题（手动切换深色模式后）
    var favLogo = this.selectComponent('#fav-logo')
    if (favLogo && favLogo.refreshTheme) favLogo.refreshTheme()
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
        _time: formatAbsoluteTime(item.addedAt),
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
    var that = this
    var id = e.currentTarget.dataset.id
    // BUG-20260806-020: 若该项处于左滑打开状态，点击内容区应收起而非跳转
    if (this.data.openSwipeId === id) {
      this._closeSwipe(id)
      return
    }
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
    // BUG-20260806-020: 切换分类时收起所有左滑项，避免残留
    this._closeAllSwipes()
    this.setData({ activeCategory: next })
    this._applyFilter(this._allList || this.data.list, next)
  },

  /* ============ BUG-20260806-020: 左滑取消收藏 ============
     替换原「长按 → ActionSheet」交互。
     左滑列表项 → 内容左移 160rpx 露出右侧红色"取消收藏"按钮；
     点击按钮 → 取消收藏；右滑/松手回弹 → 恢复。 */

  // 删除按钮宽度（rpx）
  SWIPE_ACTION_W: 160,

  onSwipeStart: function (e) {
    var touch = e.touches[0]
    this._swipe = {
      id: e.currentTarget.dataset.id,
      startX: touch.clientX,
      startY: touch.clientY,
      horizontal: false,
      dead: false,
    }
    // 若其它项已打开，先收起（避免多开）
    if (this.data.openSwipeId && this.data.openSwipeId !== this._swipe.id) {
      this._closeAllSwipes()
    }
  },

  onSwipeMove: function (e) {
    if (!this._swipe || this._swipe.dead) return
    var touch = e.touches[0]
    var dxPx = touch.clientX - this._swipe.startX
    var dyPx = touch.clientY - this._swipe.startY

    // 方向判定：水平位移显著且大于垂直 → 判定为左滑手势
    if (!this._swipe.horizontal) {
      if (Math.abs(dxPx) > 10 && Math.abs(dxPx) > Math.abs(dyPx)) {
        this._swipe.horizontal = true
      } else if (Math.abs(dyPx) > 10) {
        // 垂直滚动，放弃本次滑动（不拦截 scroll-view 滚动）
        this._swipe.dead = true
        return
      } else {
        return
      }
    }

    var pxPerRpx = this._pxPerRpx()
    var dxRpx = dxPx / pxPerRpx
    // 位移限制在 [-160, 0] rpx；右滑做阻尼（乘 0.3）
    var offsetRpx = dxRpx < 0 ? Math.max(dxRpx, -this.SWIPE_ACTION_W) : Math.min(dxRpx * 0.3, 0)
    var patch = { swipingId: this._swipe.id }
    patch['swipeOffsets.' + this._swipe.id] = Math.round(offsetRpx)
    this.setData(patch)
  },

  onSwipeEnd: function (e) {
    if (!this._swipe) return
    var swipe = this._swipe
    this._swipe = null
    if (swipe.dead) return

    var touch = e.changedTouches[0]
    var pxPerRpx = this._pxPerRpx()
    var dxRpx = (touch.clientX - swipe.startX) / pxPerRpx
    var id = swipe.id

    // 超过阈值 → 打开
    if (dxRpx < -60) {
      this._openSwipe(id)
    } else if (Math.abs(dxRpx) > 20) {
      // 有实际滑动但未达阈值 → 回弹收起
      this._closeSwipe(id)
    }
    // |dx| ≤ 20 视为轻点：不处理，交给 tap 事件（打开项点击收起 / 未打开项跳转）
  },

  _openSwipe: function (id) {
    var patch = { swipingId: '', openSwipeId: id }
    patch['swipeOffsets.' + id] = -this.SWIPE_ACTION_W
    this.setData(patch)
  },

  _closeSwipe: function (id) {
    var patch = { swipingId: '', openSwipeId: '' }
    patch['swipeOffsets.' + id] = 0
    this.setData(patch)
  },

  _closeAllSwipes: function () {
    var that = this
    var patches = { swipingId: '', openSwipeId: '' }
    // 把已打开项的位移归零
    var openId = this.data.openSwipeId
    if (openId) patches['swipeOffsets.' + openId] = 0
    this.setData(patches)
  },

  /**
   * 获取当前设备 rpx→px 换算（屏幕宽度 / 750）
   */
  _pxPerRpx: function () {
    if (this._pxPerRpxCache) return this._pxPerRpxCache
    try {
      var info = wx.getSystemInfoSync()
      this._pxPerRpxCache = info.windowWidth / 750
    } catch (e) {
      this._pxPerRpxCache = 0.5
    }
    return this._pxPerRpxCache
  },

  /**
   * 点击"取消收藏"按钮（左滑露出）→ 复用原 onConfirmUnfavorite 核心逻辑
   */
  onDeleteItem: function (e) {
    var id = e.currentTarget.dataset.id
    if (!id) return
    this._pendingId = id
    this._closeAllSwipes()
    this.onConfirmUnfavorite()
  },

  /**
   * 确认取消收藏 —— 本地立即移除（DG-04 纯本地，无云端双写）
   */
  onConfirmUnfavorite: function () {
    var that = this
    var id = this._pendingId
    if (!id) return

    // 乐观更新：先移除
    var next = (that._allList || that.data.list).filter(function (item) { return item.id !== id })
    that._setList(next)
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
