// INTEL-MODULE: AI 情报官 · 浏览历史（2026-08-21：纯本地列表，30 天 TTL 滚动清除）
// 数据源：utils/intelHistory（localCache 单例，30 天滚动清除，无云端）
// 交互：点击卡片 → 详情页（复用 intelDetailCard 透传模式）；卡片可单条删除 / 右上清空
const app = getApp()
const { getHistory, removeHistory, clearHistory } = require('../../../utils/intelHistory')
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
    list: [],        // 浏览历史数组（viewedAt 倒序）
    loading: true,
    empty: false,
  },

  onLoad() {
    // 2026-08-31 修复：冷启动/栈底时左滑返回会退出小程序——
    // reLaunch 到新闻首页带 redirect 重建 home→history 栈
    try {
      if (getCurrentPages().length === 1) {
        wx.reLaunch({ url: '/pages/home/home?redirect=history', fail: function () {} })
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
    const g = app.globalData || {}
    if (g.themeClass && this.data.themeClass !== g.themeClass) {
      this.setData({ themeClass: g.themeClass, isDark: g.effectiveTheme === 'dark' })
    }
    this._load()
  },

  /** 加载浏览历史（本地读取；30 天过期条目在 getHistory 内滚动清除） */
  _load() {
    try {
      const list = getHistory()
      this.setData({
        list,
        loading: false,
        empty: list.length === 0,
      })
    } catch (e) {
      console.warn('[intel-history] 读取失败:', e.message || e)
      this.setData({ loading: false, empty: true })
    }
  },

  /** 点击卡片 → 详情页（透传卡片数据） */
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

  /** 删除单条浏览记录 */
  onRemove(e) {
    const id = e.currentTarget.dataset.id
    removeHistory(id)
    wx.showToast({ title: '已删除', icon: 'none' })
    this._load()
  },

  /** 清空全部浏览历史 */
  onClearAll() {
    wx.showModal({
      title: '清空浏览历史',
      content: '确定清空全部浏览记录吗？',
      confirmColor: '#FF3B30',
      success: (r) => {
        if (r.confirm) {
          clearHistory()
          wx.showToast({ title: '已清空', icon: 'none' })
          this._load()
        }
      },
    })
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/home/home' }) })
  },
})
