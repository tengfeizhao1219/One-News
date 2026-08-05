// 收藏列表页 — TL-B13 / RQ-03 + UI-B10（本地秒开 + 云端兜底合并 + 分类筛选 + 长按取消收藏）

var LocalCache = require('../../utils/localCache').LocalCache
var cloud = require('../../utils/cloud')
var { formatRelativeTime } = require('../../utils/util')
var app = getApp()

// 与首页侧边栏同源 Storage（localCache 'lc:' 前缀），可读到详情页写入的 favorites
var _cache = new LocalCache({ maxItems: 500, defaultTTL: 7 * 24 * 60 * 60 * 1000 })

// UI-B10: 分类筛选胶囊（与 reading-engine 跨分类顺序一致）
var CATEGORIES = [
  { id: 'all', name: '全部' },
  { id: 'tech', name: '科技' },
  { id: 'international', name: '世界' },
  { id: 'sports', name: '体育' },
  { id: 'life', name: '生活' },
]

// 分类 → CSS 强调色类名
var CATEGORY_CLASS_MAP = {
  tech: 'c-tech',
  international: 'c-world',
  sports: 'c-sports',
  life: 'c-life',
}

Page({
  data: {
    statusBarHeight: 20,
    list: [],
    filteredList: [],
    categories: CATEGORIES,
    activeCategory: 'all',
    filteredCount: 0,
    loading: true,
    isEmpty: false,
    sheetVisible: false,
    _lastHomeTap: 0,
  },

  onLoad: function () {
    var s = (app && app.globalData && app.globalData.statusBarHeight) || 20
    this.setData({ statusBarHeight: s })
  },

  onShow: function () {
    this._load()
  },

  /**
   * 加载收藏：本地秒开 → 云端合并（云端为准，本地缺失补入，云端已删移除）
   */
  _load: function () {
    var that = this
    this.setData({ loading: true })

    var local = _cache.get('favorites') || []
    var localMerged = that._merge(local, [])
    that._setList(localMerged)
    that.setData({ loading: false })

    cloud.callCloudFunction('getUserFavorites', {}).then(function (res) {
      var cloudList = (res && res.data && res.data.list) || []
      var merged = that._merge(local, cloudList)
      that._setList(merged)
    }).catch(function () {
      // 云端失败：保持本地
    })
  },

  /**
   * UI-B10: 统一设置列表并应用当前筛选
   */
  _setList: function (list) {
    var decorated = list.map(function (item) {
      return Object.assign({}, item, {
        categoryClass: CATEGORY_CLASS_MAP[item.category] || '',
      })
    })
    this._allList = decorated
    this._applyFilter(decorated, this.data.activeCategory)
  },

  /**
   * UI-B10: 应用分类筛选
   */
  _applyFilter: function (list, category) {
    var filtered = category === 'all'
      ? list
      : list.filter(function (item) { return item.category === category })
    this.setData({
      list: list,
      filteredList: filtered,
      filteredCount: filtered.length,
      isEmpty: list.length === 0,
    })
  },

  /**
   * 合并本地 + 云端（云端为准：同 id 优先云端；云端已删 isActive=false 的项移除）
   */
  _merge: function (localList, cloudList) {
    var map = {}
    localList.forEach(function (item) { if (item && item.id) map[item.id] = item })
    cloudList.forEach(function (item) {
      if (!item || !item.newsId) return
      map[item.newsId] = {
        id: item.newsId,
        title: item.title,
        category: item.category,
        categoryName: item.categoryName,
        source: item.source,
        picUrl: item.picUrl,
        addedAt: item.addedAt,
      }
    })
    var arr = Object.keys(map).map(function (k) { return map[k] })
    arr.sort(function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0) })
    return arr.map(function (item) {
      return Object.assign({}, item, { _time: formatRelativeTime(item.addedAt) })
    })
  },

  onItemTap: function (e) {
    // UI-B10: 长按触发后 300ms 内屏蔽 click，避免误跳转
    if (this._longPressTriggered) {
      this._longPressTriggered = false
      return
    }
    var id = e.currentTarget.dataset.id
    var cat = e.currentTarget.dataset.cat || 'all'
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id + '&category=' + cat })
  },

  /**
   * UI-B10: 分类筛选切换
   */
  onFilterTap: function (e) {
    var cat = e.currentTarget.dataset.id
    this.setData({ activeCategory: cat })
    this._applyFilter(this._allList || this.data.list, cat)
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
   * UI-B10: 确认取消收藏 —— 本地立即移除 + 云端异步双写
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

    // 云端同步取消（非阻塞）
    var target = (that._allList || that.data.list).find(function (item) { return item.id === id })
    cloud.callCloudFunction('setUserFavorite', {
      newsId: id,
      favorited: false,
    }).catch(function () {
      wx.showToast({ title: '已取消收藏（待同步）', icon: 'none' })
      if (target) {
        cloud.enqueue({ name: 'setUserFavorite', data: {
          newsId: id,
          title: target.title || '',
          category: target.category || '',
          categoryName: target.categoryName || '',
          source: target.source || '',
          picUrl: target.picUrl || '',
          favorited: false,
        }})
      }
    })
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
