// 设置页 — UI-B9 独立全屏页（字号 + 主题 + 关于）

var app = getApp()
var changelog = require('../../config/changelog')

var scaleMap = [1, 1.15, 1.3, 1.5]
var META_SCALE_CAP = 1.15

Page({
  data: {
    menuTop: 0,
    menuHeight: 32,
    navOffset: 0,  // D-09 v1.2（BUG-20260806-007）: 内容起始基准
    fontScaleTier: 0,
    _fontScaleValue: 1,
    _metaScaleValue: 1,
    followSystem: true,
    darkMode: false,
    manualDark: false,
    contactModalVisible: false,   // 2026-08-26: 联系开发者弹窗
    // BUG-20260806-003（owner 07:44 追加裁定）: 第 2 层页面统一主页按钮，home icon 按深色切换白色版
    isDark: false,
    // 2026-08-09：从 changelog.js 读当前版本，点击弹出日志弹窗
    appVersion: changelog.currentVersion,
    latestChangelog: changelog.versions[0] || null,
    showChangelog: false,
    tiers: [
      { value: 0, label: '标准' },
      { value: 1, label: '大' },
      { value: 2, label: '特大' },
      { value: 3, label: '超大' },
    ],
  },

  onLoad: function () {
    var tier = (app && app.globalData && typeof app.globalData.fontScale === 'number') ? app.globalData.fontScale : 0
    this.setData({
      // BUG-20260806-004: 导航栏与胶囊对齐
      menuTop: (app && app.globalData.menuTop) || 0,
      menuHeight: (app && app.globalData.menuHeight) || 32,
      // BUG-20260806-009 v3: 状态栏背景层高度（custom 模式下 setNavigationBarColor 无效）
      statusBarHeight: (app && app.globalData.statusBarHeight) || 20,
      // D-09 v1.2（BUG-20260806-007）: 内容起始基准 = menuTop + menuHeight + 12px
      navOffset: ((app && app.globalData.menuTop) || 0) + ((app && app.globalData.menuHeight) || 32) + 12,
      fontScaleTier: tier,
      _fontScaleValue: app.globalData._fontScaleValue || scaleMap[tier] || 1,
      _metaScaleValue: app.globalData._metaScaleValue || 1,
      // BUG-20260805-003: 根节点 class 由全局 themeClass 驱动
      themeClass: (app && app.globalData && app.globalData.themeClass) || '',
      // BUG-20260806-003: 主页 icon 按主题切换白色版
      isDark: this._isSystemDark(),
    })

    // BUG-20260806-009 follow-up: 页面级调用状态栏 API
    if (app && app.setNavBarColor) {
      app.setNavBarColor((app.globalData && app.globalData.effectiveTheme) || 'light')
    }

    // 读取主题偏好（若无则默认跟随系统）
    try {
      var storedFollow = wx.getStorageSync('settings_followSystem')
      var storedDark = wx.getStorageSync('settings_darkMode')
      if (storedFollow !== '' && storedFollow !== undefined) {
        this.setData({ followSystem: storedFollow, darkMode: storedDark })
      }
    } catch (e) {}
  },

  onShow: function () {
    // 刷新底部 logo 组件主题（页面可能从其他页面返回后主题已变）
    try {
      var logoComp = this.selectComponent('#settings-logo')
      if (logoComp && typeof logoComp.refreshTheme === 'function') {
        logoComp.refreshTheme()
      }
    } catch (e) { /* ignore */ }
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
      // BUG-20260806-003: 主题切换后立即刷新主页 icon（applyTheme 同步更新 effectiveTheme）
      this.setData({ isDark: this._isSystemDark() })
      // 刷新底部 splash logo 组件主题
      try {
        var logoComp = this.selectComponent('#settings-logo')
        if (logoComp && typeof logoComp.refreshTheme === 'function') {
          logoComp.refreshTheme()
        }
      } catch (e) { /* ignore */ }
    }
  },

  /**
   * BUG-20260806-003: 判断当前生效主题是否深色（与 favorites/detail 页同源）
   */
  _isSystemDark: function () {
    try {
      if (app && app.globalData && app.globalData.effectiveTheme) {
        return app.globalData.effectiveTheme === 'dark'
      }
      var info = wx.getSystemInfoSync()
      return info.theme === 'dark'
    } catch (e) {
      return false
    }
  },

  _saveThemePrefs: function () {
    try {
      wx.setStorageSync('settings_followSystem', this.data.followSystem)
      wx.setStorageSync('settings_darkMode', this.data.darkMode)
    } catch (e) {}
  },

  /**
   * 版本日志弹窗（2026-08-09 owner 需求）：点击版本号打开更新日志。
   */
  onTapVersion: function () {
    this.setData({ showChangelog: true })
  },

  onCloseChangelog: function () {
    this.setData({ showChangelog: false })
  },

  /**
   * 2026-08-26: 打开/关闭联系开发者弹窗
   */
  openContactModal: function () {
    this.setData({ contactModalVisible: true })
  },
  closeContactModal: function () {
    this.setData({ contactModalVisible: false })
  },
  noop: function () {},

  /**
   * UI-B9: 复制邮箱
   */
  copyEmail: function () {
    this._copy('ztengfei@hotmail.com', '邮箱')
  },

  // 2026-08-26: 点击邮箱——复制并提示可在邮件 App 粘贴发送(小程序无直接调起系统邮件接口,故用复制引导)
  onEmailTap: function () {
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
   * RQ-22-FE（PRD RQ-22 · AC-01）: 意见反馈落地为留言板页。
   * 原 wx.openFeedback()（官方反馈入口，无实际留言功能）改为跳转 pages/feedback/feedback。
   */
  onFeedback: function () {
    wx.navigateTo({ url: '/pages/feedback/feedback' })
  },

  /**
   * BUG-20260806-003: 第 2 层页面统一使用主页按钮（home.svg + reLaunch）
   * TL-B15 / RQ-17：reLaunch 回首页并清栈（防抖 300ms，失败降级逐层回退）
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
})
