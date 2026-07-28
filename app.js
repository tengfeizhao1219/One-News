const { CATEGORIES } = require('./utils/constants')

App({
  globalData: {
    currentCategory: 'all',
    categoryNames: {}
  },

  onLaunch() {
    // 初始化分类名称映射（与 constants.js 同步）
    CATEGORIES.forEach(c => {
      this.globalData.categoryNames[c.id] = c.name
    })

    // 初始化云开发（上线前替换为你的环境ID）
    if (wx.cloud) {
      wx.cloud.init({
        env: 'your-env-id',  // TODO: 替换为你的云开发环境ID
        traceUser: false
      })
    }

    // 获取系统信息
    const sysInfo = wx.getSystemInfoSync()
    this.globalData.statusBarHeight = sysInfo.statusBarHeight
    this.globalData.screenHeight = sysInfo.screenHeight
    this.globalData.screenWidth = sysInfo.screenWidth
  }
})
