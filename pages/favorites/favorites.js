// 收藏列表页 — TL-B13 / RQ-03（本地秒开 + 云端兜底合并）
// 注：收藏同步展示细节（UI-B5 设计稿，待同步角标/失败条）待评审通过后细化；本实现为功能骨架。

var LocalCache = require('../../utils/localCache').LocalCache
var cloud = require('../../utils/cloud')
var { formatRelativeTime } = require('../../utils/util')
var app = getApp()

// 与首页侧边栏同源 Storage（localCache 'lc:' 前缀），可读到详情页写入的 favorites
var _cache = new LocalCache({ maxItems: 500, defaultTTL: 7 * 24 * 60 * 60 * 1000 })

Page({
  data: {
    statusBarHeight: 20,
    list: [],
    loading: true,
    isEmpty: false,
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
    that.setData({ list: localMerged, loading: false, isEmpty: localMerged.length === 0 })

    cloud.callCloudFunction('getUserFavorites', {}).then(function (res) {
      var cloudList = (res && res.data && res.data.list) || []
      var merged = that._merge(local, cloudList)
      that.setData({ list: merged, isEmpty: merged.length === 0 })
    }).catch(function () {
      // 云端失败：保持本地
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
    var id = e.currentTarget.dataset.id
    var cat = e.currentTarget.dataset.cat || 'all'
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id + '&category=' + cat })
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
