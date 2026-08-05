// 浏览记录页 — TL-B14 / RQ-06（本地秒开 + 云端兜底合并）
// 注：页面视觉细节（UI-B4 设计稿）待 PM + owner 评审通过后细化；本实现为功能骨架。

var LocalCache = require('../../utils/localCache').LocalCache
var cloud = require('../../utils/cloud')
var { formatBrowseTime, isBrowseExpired } = require('../../utils/util')
var app = getApp()

// 与 detail.js 同源 Storage（localCache 'lc:' 前缀），可读到 detail 写入的 browseHistory
var _cache = new LocalCache({ maxItems: 500, defaultTTL: 7 * 24 * 60 * 60 * 1000 })

Page({
  data: {
    statusBarHeight: 20,
    list: [],
    loading: true,
    isEmpty: false,
    syncing: false,
    _lastHomeTap: 0,
  },

  onLoad: function () {
    var s = (app && app.globalData && app.globalData.statusBarHeight) || 20
    this.setData({
      statusBarHeight: s,
      // BUG-20260805-003: 全局手动主题（设置页深色模式）同步到本页根节点
      themeClass: (app && app.globalData && app.globalData.themeClass) || '',
    })
  },

  onShow: function () {
    // BUG-20260805-003: onShow 刷新主题（可能从设置页返回）
    this.setData({ themeClass: (app && app.globalData && app.globalData.themeClass) || '' })
    this._load()
  },

  /**
   * 加载浏览记录：本地秒开 → 云端合并（异步，失败静默保留本地）
   */
  _load: function () {
    var that = this
    this.setData({ loading: true, syncing: true })

    var local = _cache.get('browseHistory') || []
    var merged = that._merge(local, [])
    that.setData({ list: merged, loading: false, isEmpty: merged.length === 0 })

    // 云端合并
    cloud.callCloudFunction('getBrowseHistory', {}).then(function (res) {
      var cloudList = (res && res.data && res.data.list) || []
      var merged2 = that._merge(local, cloudList)
      that.setData({ list: merged2, isEmpty: merged2.length === 0, syncing: false })
    }).catch(function () {
      // 云端失败：保持本地数据
      that.setData({ syncing: false })
    })
  },

  /**
   * 合并本地 + 云端（以 viewedAt 最新为准去重；过滤 7 天过期）
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
    var id = e.currentTarget.dataset.id
    var cat = e.currentTarget.dataset.cat || 'all'
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id + '&category=' + cat })
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
