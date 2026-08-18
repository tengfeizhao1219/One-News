// INTEL-MODULE: AI 情报官 · 我的
// 隔离说明：本文件为新增页面逻辑，独立于 One News 既有业务；命名空间 intel_*。
const app = getApp()

Page({
  data: {
    themeClass: '',
    statusBarHeight: 20
  },

  onLoad() {
    let statusBarHeight = 20
    try { statusBarHeight = wx.getSystemInfoSync().statusBarHeight || 20 } catch (e) {}
    this.setData({
      themeClass: (app.globalData && app.globalData.themeClass) || 'page--light',
      statusBarHeight: statusBarHeight
    })
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/intel/home/home' }) })
  }
})
