// 浏览记录页 — TL-B14 / RQ-06（本地秒开 · DG-04 纯本地化：云函数 getBrowseHistory 已停用）
// 注：页面视觉细节（UI-B4 设计稿）待 PM + owner 评审通过后细化；本实现为功能骨架。

// DG-03: 统一全局单例 localCache（detail/favorites/history 同源）
var localCache = require('../../utils/localCache').localCache
var { formatBrowseTime, isBrowseExpired } = require('../../utils/util')
var app = getApp()

// 全局缓存单例（与 detail.js 同源，可读到 detail 写入的 browseHistory）
var _cache = localCache

Page({
  data: {
    menuTop: 0,
    menuHeight: 32,
    navOffset: 0,  // D-09 v1.2（BUG-20260806-007）: 内容起始基准
    list: [],
    loading: true,
    isEmpty: false,
    syncing: false,
    _lastHomeTap: 0,
    // BUG-FS-20260805-001（同根因扩展）: 导航/空态 icon 深色模式切换白色版
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
      // BUG-FS-20260805-001: 导航/空态 icon 按主题切换白色版
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
      // BUG-FS-20260805-001: onShow 同步刷新（从设置页切换主题返回时更新 icon 颜色）
      isDark: this._isSystemDark(),
    })
    this._load()
  },

  /**
   * BUG-FS-20260805-001: 判断当前生效主题是否深色（含手动模式，与 detail/favorites/home 页同源）
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
   * DG-04（纯本地化）：加载浏览记录 —— 本地读取 + 7 天过期过滤（云函数已停用）
   */
  _load: function () {
    var that = this
    this.setData({ loading: true })

    var local = _cache.get('browseHistory') || []
    var merged = that._merge(local, [])
    that.setData({ list: merged, loading: false, isEmpty: merged.length === 0, syncing: false })
  },

  /**
   * 合并本地列表（以 viewedAt 最新为准去重；过滤 7 天过期）
   * DG-04: 云端列表参数保留（兼容旧调用），实际仅本地
   */
  _merge: function (localList, cloudList) {
    var map = {}
    localList.concat(cloudList).forEach(function (item) {
      if (!item || !item.id) return
      if (isBrowseExpired(item.viewedAt)) return
      var prev = map[item.id]
      if (!prev || item.viewedAt > prev.viewedAt) map[item.id] = item
    })
    var arr = Object.keys(map).map(function (k) { return map[k] })
    arr.sort(function (a, b) { return b.viewedAt - a.viewedAt })
    return arr.map(function (item) {
      return Object.assign({}, item, { _time: formatBrowseTime(item.viewedAt) })
    })
  },

  onItemTap: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    var cat = e.currentTarget.dataset.cat || 'recommend'
    // DG-04（方案 4 改动 A）：透传来源列表，详情按来源顺序翻页、禁跨分类
    var list = (that.data.list || []).map(function (item) {
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
    app.globalData.detailContext = { category: cat, list: list, source: 'history', entryId: id }
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id + '&category=' + cat + '&source=history' })
  },

  /**
   * TL-B15 / RQ-17：返回主页（与详情页一致）
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
