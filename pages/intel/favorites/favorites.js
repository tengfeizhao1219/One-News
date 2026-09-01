// INTEL-MODULE: AI 情报官 · 我的收藏（2026-08-20：纯本地收藏列表，对齐 One News favorites 页逻辑）
// 数据源：utils/intelFavorites（localCache 单例，30 天 TTL 滚动清除，无云端）
// 交互：点击卡片 → 详情页（复用 intelDetailCard 透传模式）；卡片右上角 ♥ 可取消收藏
const app = getApp()
const { getFavorites, removeFavorite } = require('../../../utils/intelFavorites')
const { getSafeBottom } = require('../../../utils/intelRender')

Page({
  data: {
    themeClass: '',
    isDark: false,
    statusBarHeight: 20,
    menuHeight: 32,
    topBarH: 44,
    safeBottom: 0,
    _fontScaleValue: 1,
    _metaScaleValue: 1,
    list: [],        // 收藏数组（addedAt 倒序）
    loading: true,
    empty: false,
  },

  onLoad() {
    // 2026-08-31 修复：冷启动/栈底时左滑返回会退出小程序——
    // reLaunch 到新闻首页带 redirect 重建 home→favorites 栈
    try {
      if (getCurrentPages().length === 1) {
        wx.reLaunch({ url: '/pages/home/home?redirect=favorites', fail: function () {} })
        return
      }
    } catch (e) {}
    const g = app.globalData || {}
    let statusBarHeight = 20, menuHeight = 32, menuTop = 44
    try {
      if (typeof g.statusBarHeight === 'number') statusBarHeight = g.statusBarHeight
      if (typeof g.menuHeight === 'number') menuHeight = g.menuHeight
      if (typeof g.menuTop === 'number') menuTop = g.menuTop
    } catch (e) {}
    this.setData({
      themeClass: g.themeClass || 'page--light',
      isDark: g.effectiveTheme === 'dark',
      statusBarHeight,
      menuHeight,
      topBarH: menuTop,
      safeBottom: getSafeBottom(),
      _fontScaleValue: (typeof g._fontScaleValue === 'number') ? g._fontScaleValue : 1,
      _metaScaleValue: (typeof g._metaScaleValue === 'number') ? g._metaScaleValue : 1,
    })
  },

  onShow() {
    // 每次显示重新拉取（详情页可能新增/取消收藏）
    const g = app.globalData || {}
    if (g.themeClass && this.data.themeClass !== g.themeClass) {
      this.setData({ themeClass: g.themeClass, isDark: g.effectiveTheme === 'dark' })
    }
    this._load()
  },

  /** 加载收藏列表（本地读取；30 天过期条目在 getFavorites 内滚动清除） */
  _load() {
    try {
      const list = getFavorites()
      this.setData({
        list,
        loading: false,
        empty: list.length === 0,
      })
    } catch (e) {
      console.warn('[intel-favorites] 读取失败:', e.message || e)
      this.setData({ loading: false, empty: true })
    }
  },

  /** 点击卡片 → 详情页（透传卡片数据，详情页据此匹配标题） */
  goDetail(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.list.find((it) => it.id === id) || null
    if (item) {
      app.globalData.intelDetailCard = {
        id: item.id,
        title: item.title,
        src: item.src,
        time: item.time,
        desc: item.desc,
      }
    }
    wx.navigateTo({ url: `/pages/intel/detail/detail?id=${id}` })
  },

  /** 取消收藏（红心点击；本地移除） */
  onUnfavorite(e) {
    const id = e.currentTarget.dataset.id
    removeFavorite(id)
    wx.showToast({ title: '已取消收藏', icon: 'none' })
    this._load()
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/home/home' }) })
  },
})
