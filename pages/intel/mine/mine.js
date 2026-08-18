// INTEL-MODULE: AI 情报官 · 我的
// 隔离说明：本文件为新增页面逻辑，独立于 One News 既有业务；命名空间 intel_*。
const app = getApp()

Page({
  data: {
    themeClass: '',
    isDark: false,
    statusBarHeight: 20,
    menuHeight: 32,
    topBarH: 44,           // 顶部条带高度（对齐原生胶囊 menuTop）
    _fontScaleValue: 1,    // 字体缩放（对齐 One News，注入 CSS --font-scale）
    _metaScaleValue: 1
  },

  onLoad() {
    let statusBarHeight = 20
    let menuTop = 44
    let menuHeight = 32
    try {
      const info = wx.getSystemInfoSync()
      statusBarHeight = info.statusBarHeight || 20
    } catch (e) {}
    const g = app.globalData || {}
    if (typeof g.menuTop === 'number') menuTop = g.menuTop
    if (typeof g.menuHeight === 'number') menuHeight = g.menuHeight
    this.setData({
      themeClass: g.themeClass || 'page--light',
      isDark: this._isSystemDark(),
      statusBarHeight,
      topBarH: menuTop,
      menuHeight,
      _fontScaleValue: (typeof g._fontScaleValue === 'number') ? g._fontScaleValue : 1,
      _metaScaleValue: (typeof g._metaScaleValue === 'number') ? g._metaScaleValue : 1
    })
  },

  _isSystemDark() {
    try { return wx.getSystemInfoSync().theme === 'dark' || wx.getAppBaseInfo().theme === 'dark' } catch (e) { return false }
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/intel/home/home' }) })
  }
})
