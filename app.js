const { CATEGORIES } = require('./utils/constants')

App({
  globalData: {
    currentCategory: 'all',
    categoryNames: {},
    fontScale: 0,
  },

  onLaunch() {
    // 初始化分类名称映射（与 constants.js 同步）
    CATEGORIES.forEach(c => {
      this.globalData.categoryNames[c.id] = c.name
    })

    // 初始化云开发
    if (wx.cloud) {
      wx.cloud.init({
        env: 'cloud1-1g9313w0bb791de0',
        traceUser: false
      })
    }

    // 获取系统信息
    const sysInfo = wx.getSystemInfoSync()
    this.globalData.statusBarHeight = sysInfo.statusBarHeight
    this.globalData.screenHeight = sysInfo.screenHeight
    this.globalData.screenWidth = sysInfo.screenWidth

    // 字体初始化：首入跟随系统，后续读取记忆
    this._initFontScale()
  },

  /**
   * 初始化字体缩放档位
   * 首入：跟随微信系统字体设置
   * 后续：读取用户手动选择的档位
   */
  _initFontScale() {
    var stored = null
    try {
      stored = wx.getStorageSync('fontScale')
    } catch (e) { /* ignore */ }

    if (stored !== null && stored !== undefined && stored !== '') {
      // 已有记忆：直接恢复
      this.globalData.fontScale = Number(stored)
      this._applyFontScale(this.globalData.fontScale)
      return
    }

    // 首入：跟随系统字体
    var systemTier = 0
    try {
      var sysInfo = wx.getSystemInfoSync()
      var fs = sysInfo.fontSizeSetting || 16
      if (fs >= 24) systemTier = 3
      else if (fs >= 20) systemTier = 2
      else if (fs >= 18) systemTier = 1
      else systemTier = 0
    } catch (e) { /* fallback to tier 0 */ }

    this.globalData.fontScale = systemTier
    this._applyFontScale(systemTier)

    try {
      wx.setStorageSync('fontScale', systemTier)
    } catch (e) { /* ignore */ }
  },

  /**
   * 设置字体档位（供 font-panel 组件调用）
   * @param {number} tier 0-3
   */
  setFontScale(tier) {
    this.globalData.fontScale = tier
    this._applyFontScale(tier)
    try {
      wx.setStorageSync('fontScale', tier)
    } catch (e) { /* ignore */ }
  },

  /**
   * 将档位映射为 CSS --font-scale 数值并注入到页面 style
   */
  _applyFontScale(tier) {
    var scaleMap = [1, 1.15, 1.3, 1.5]
    var scale = scaleMap[tier] || 1

    // 动态设置 page 级别的 CSS 变量（覆盖 theme.json 默认值）
    // 通过 getCurrentPages 注入到所有页面
    try {
      var pages = getCurrentPages()
      for (var i = 0; i < pages.length; i++) {
        if (pages[i] && pages[i].setData) {
          pages[i].setData({ _fontScaleValue: scale })
        }
      }
    } catch (e) { /* ignore */ }

    // 同时写入全局 data，供新页面 onLoad 时读取
    this.globalData._fontScaleValue = scale
  }
})
