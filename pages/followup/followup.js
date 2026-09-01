// 我的关注 — 独立直达页（承载 followup-card 覆盖层组件）
// 主要入口是首页/情报官首页长按 overlay；此页保留可独立直达（如分享链接）的能力。

Page({
  data: {
    themeClass: '',
  },

  onLoad() {
    // 2026-08-31 修复：冷启动/栈底进入（分享链接直达/无上级页）时，
    // iOS 左滑返回会直接退出小程序——reLaunch 到首页重建 home→本页 栈
    try {
      if (getCurrentPages().length === 1) {
        wx.reLaunch({ url: '/pages/home/home?redirect=followup', fail: function () {} })
        return
      }
    } catch (e) { /* 忽略 */ }
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
