// 收藏列表页 — TL-B13 / RQ-03 + UI-B10（本地秒开 + 云端兜底合并 + 分类筛选 + 长按取消收藏）

var LocalCache = require('../../utils/localCache').LocalCache
var cloud = require('../../utils/cloud')
var { formatRelativeTime } = require('../../utils/util')
var app = getApp()

// 与首页侧边栏同源 Storage（localCache 'lc:' 前缀），可读到详情页写入的 favorites
var _cache = new LocalCache({ maxItems: 500, defaultTTL: 7 * 24 * 60 * 60 * 1000 })

// UI-B10: 分类筛选胶囊（与 reading-engine 跨分类顺序一致；去掉「全部」，默认展示全部）
var CATEGORIES = [
  { id: 'tech', name: '科技' },
  { id: 'international', name: '世界' },
  { id: 'sports', name: '体育' },
  { id: 'life', name: '生活' },
]


Page({
  data: {
    statusBarHeight: 20,
    list: [],
    filteredList: [],
    categories: CATEGORIES,
    activeCategory: '',
    filteredCount: 0,
    loading: true,
    isEmpty: false,
    // UI-11/UI-13/UI-14（UI-B5 设计稿，owner 2026-08-04 确认通过）：
    // 云端合并中进度条 / 待同步角标 / 同步失败重试条
    syncing: false,
    syncFailed: false,
    sheetVisible: false,
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
   * 加载收藏：本地秒开 → 云端合并（云端为准，本地缺失补入，云端已删移除）
   * UI-11：云端合并期间顶部细进度条（≤2s，合并完成静默收起）
   * UI-14：云端拉取失败 → 顶部轻提示「收藏同步失败，点击重试」（非阻断，本地照常展示）
   */
  _load: function () {
    var that = this
    this.setData({ loading: true, syncing: true, syncFailed: false })

    var local = _cache.get('favorites') || []
    var localMerged = that._merge(local, [], cloud.getPendingFavorites())
    that._setList(localMerged)
    that.setData({ loading: false, syncing: false })

    cloud.callCloudFunction('getUserFavorites', {}).then(function (res) {
      var cloudList = (res && res.data && res.data.list) || []
      var merged = that._merge(local, cloudList, cloud.getPendingFavorites())
      that._setList(merged)
      that.setData({ syncing: false })
    }).catch(function () {
      // 云端失败：保持本地，顶部轻提示可重试（UI-14，非阻断式）
      that.setData({ syncing: false, syncFailed: true })
    })
  },

  /**
   * UI-14：同步失败条点击重试 —— 重拉云端合并
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
   * 合并本地 + 云端（云端为准：同 id 优先云端数据；本地独有条目保留展示）
   * UI-13：本地独有、且待同步队列中仍有该条收藏上云操作 → 标记 pending（☁️ 待同步角标）；
   *         本地独有但队列无该条（如云端已删）→ 不标角标，保持原展示行为。
   * @param {Array} localList 本地收藏
   * @param {Array} cloudList 云端收藏
   * @param {string[]} pendingIds 待同步队列中的 newsId 列表（未成功上云）
   */
  _merge: function (localList, cloudList, pendingIds) {
    var map = {}
    var pending = Array.isArray(pendingIds) ? pendingIds : []
    localList.forEach(function (item) {
      if (item && item.id) map[item.id] = item
    })
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
      // UI-13：仅本地有、云端无的条目才可能是「待同步」；云端已有该条视为已同步
      var inCloud = false
      for (var i = 0; i < cloudList.length; i++) {
        if (cloudList[i] && cloudList[i].newsId === item.id) { inCloud = true; break }
      }
      var isPending = !inCloud && pending.indexOf(item.id) !== -1
      return Object.assign({}, item, {
        _time: formatRelativeTime(item.addedAt),
        _pending: isPending,
      })
    })
  },

  /**
   * UI-13：点击「☁️ 待同步」角标 → 重试该条收藏上云；成功清除角标，失败保持并 toast
   */
  onPendingTap: function (e) {
    var that = this
    var id = e.currentTarget.dataset.id
    var target = (that._allList || that.data.list).filter(function (item) { return item.id === id })[0]
    if (!target) return
    cloud.callCloudFunction('setUserFavorite', {
      newsId: id,
      title: target.title || '',
      category: target.category || '',
      categoryName: target.categoryName || '',
      source: target.source || '',
      picUrl: target.picUrl || '',
      favorited: true,
    }).then(function () {
      // 同步成功：清除角标（云端下次拉取会带上该条）
      that.setData({ list: that.data.list.map(function (item) {
        return item.id === id ? Object.assign({}, item, { _pending: false }) : item
      }) })
      wx.showToast({ title: '已同步', icon: 'none' })
    }).catch(function () {
      wx.showToast({ title: '同步失败，请检查网络', icon: 'none' })
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
