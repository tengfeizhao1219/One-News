// 设置页 — UI-B9 独立全屏页（字号 + 主题 + 关于）

var app = getApp()

var scaleMap = [1, 1.15, 1.3, 1.5]
var META_SCALE_CAP = 1.15

Page({
  data: {
    statusBarHeight: 20,
    fontScaleTier: 0,
    _fontScaleValue: 1,
    _metaScaleValue: 1,
    followSystem: true,
    darkMode: false,
    manualDark: false,
    contactOpen: false,
    appVersion: 'v6.2.0',
    tiers: [
      { value: 0, label: '标准' },
      { value: 1, label: '大' },
      { value: 2, label: '特大' },
      { value: 3, label: '超大' },
    ],
  },

  onLoad: function () {
    var s = (app && app.globalData && app.globalData.statusBarHeight) || 20
    var tier = (app && app.globalData && typeof app.globalData.fontScale === 'number') ? app.globalData.fontScale : 0
    this.setData({
      statusBarHeight: s,
      fontScaleTier: tier,
      _fontScaleValue: app.globalData._fontScaleValue || scaleMap[tier] || 1,
      _metaScaleValue: app.globalData._metaScaleValue || 1,
      // BUG-20260805-003: 根节点 class 由全局 themeClass 驱动
      themeClass: (app && app.globalData && app.globalData.themeClass) || '',
    })

    // 读取主题偏好（若无则默认跟随系统）
    try {
      var storedFollow = wx.getStorageSync('settings_followSystem')
      var storedDark = wx.getStorageSync('settings_darkMode')
      if (storedFollow !== '' && storedFollow !== undefined) {
        this.setData({ followSystem: storedFollow, darkMode: storedDark })
      }
    } catch (e) {}
  },

  /**
   * UI-B9: 字体档位切换
   */
  onSelectTier: function (e) {
    var tier = Number(e.currentTarget.dataset.tier)
    if (tier === this.data.fontScaleTier) return

    if (app && typeof app.setFontScale === 'function') {
      app.setFontScale(tier)
    }

    var scale = scaleMap[tier] || 1
    var metaScale = scale > META_SCALE_CAP ? META_SCALE_CAP : scale
    this.setData({
      fontScaleTier: tier,
      _fontScaleValue: scale,
      _metaScaleValue: metaScale,
    })
  },

  /**
   * UI-B9: 跟随系统开关
   * BUG-20260805-003：同步 app.globalData 并 applyTheme 让全小程序立即生效
   */
  toggleFollowSystem: function () {
    var next = !this.data.followSystem
    this.setData({
      followSystem: next,
      darkMode: next ? false : this.data.darkMode,
      manualDark: next ? false : this.data.darkMode,
    })
    this._syncGlobalTheme()
    this._saveThemePrefs()
  },

  /**
   * UI-B9: 深色模式开关（仅在非跟随系统时可用）
   * BUG-20260805-003：同步 app.globalData 并 applyTheme 让全小程序立即生效
   */
  toggleDarkMode: function () {
    if (this.data.followSystem) return
    var next = !this.data.darkMode
    this.setData({
      darkMode: next,
      manualDark: next,
    })
    this._syncGlobalTheme()
    this._saveThemePrefs()
  },

  /**
   * BUG-20260805-003：将手动主题偏好同步到 app.globalData 并广播到所有页面
   */
  _syncGlobalTheme: function () {
    if (app) {
      app.globalData.followSystem = this.data.followSystem
      app.globalData.darkMode = this.data.darkMode
      if (typeof app.applyTheme === 'function') app.applyTheme()
    }
  },

  _saveThemePrefs: function () {
    try {
      wx.setStorageSync('settings_followSystem', this.data.followSystem)
      wx.setStorageSync('settings_darkMode', this.data.darkMode)
    } catch (e) {}
  },

  /**
   * UI-B9: 展开/收起联系开发者
   */
  toggleContact: function () {
    this.setData({ contactOpen: !this.data.contactOpen })
  },

  /**
   * UI-B9: 复制邮箱
   */
  copyEmail: function () {
    this._copy('ztengfei@hotmail.com', '邮箱')
  },

  /**
   * UI-B9: 复制微信
   */
  copyWechat: function () {
    this._copy('jiaowotengfei', '微信号')
  },

  _copy: function (text, label) {
    wx.setClipboardData({
      data: text,
      success: function () {
        wx.showToast({ title: label + '已复制', icon: 'none' })
      },
      fail: function () {
        wx.showToast({ title: '复制失败，请手动输入：' + text, icon: 'none' })
      },
    })
  },

  /**
   * UI-B9: 意见反馈
   */
  onFeedback: function () {
    // 小程序内优先尝试 openFeedback，不支持则 toast 引导
    if (wx.openFeedback) {
      wx.openFeedback()
    } else {
      wx.showToast({ title: '已唤起反馈入口', icon: 'none' })
    }
  },

  /**
   * BUG-20260806-003: 第 2 层页面统一使用主页按钮（home.svg + reLaunch）
   */
  goHome: function () {
    var now = Date.now()
    if (this._lastHomeTap && now - this._lastHomeTap < 300) return
    this._lastHomeTap = now
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

  /**
   * 返回上一页
   */
  goBack: function () {
    wx.navigateBack()
  },
})
