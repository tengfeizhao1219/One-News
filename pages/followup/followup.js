// 我的关注 — 独立直达页（承载 followup-card 覆盖层组件）
// 主要入口是首页/情报官首页长按 overlay；此页保留可独立直达（如分享链接）的能力。

Page({
  data: {
    themeClass: '',
  },

  onLoad() {
    const a = getApp()
    this.setData({ themeClass: (a.globalData && a.globalData.themeClass) || '' })
  },

  // overlay 返回事件 → 关闭本页（无上层则回首页）
  onBack() {
    wx.navigateBack({
      delta: 1,
      fail: function () {
        wx.reLaunch({ url: '/pages/home/home' })
      },
    })
  },
})
