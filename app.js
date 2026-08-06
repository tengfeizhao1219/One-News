const { CATEGORIES } = require('./utils/constants')

/**
 * 元信息/操作栏字号缩放上限（UX-FIX-F12，owner 2026-08-02 批准）
 * 正文可放大到 1.5，元信息最高只跟涨到 1.15（22rpx → 25.3rpx）。
 */
const META_SCALE_CAP = 1.15

App({
  globalData: {
    currentCategory: 'all',
    categoryNames: {},
    fontScale: 0,
    _fontScaleValue: 1,
    _metaScaleValue: 1,
    // BUG-20260805-003：全局手动主题（设置页「深色模式」需全小程序生效）
    followSystem: true,
    darkMode: false,
    themeClass: '',
    // D-07 S1：实际生效主题（'light' | 'dark'），单一事实源
    effectiveTheme: 'light',
    _systemTheme: 'light',
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

    // TL-B13/B14：应用启动后重试离线期间堆积的收藏/浏览上报（非阻塞）
    try {
      require('./utils/cloud').flushQueue()
    } catch (e) { /* ignore */ }

    // DG-04（数据治理 3.4）：每日首次打开异步清理过期收藏/浏览（延迟 2s，不阻塞启动）
    try {
      this._dailyCleanup()
    } catch (e) { /* ignore */ }

    // BUG-20260805-003：读取手动主题偏好并应用到全部页面
    this._initTheme()

    // D-07 S1：跟随系统模式下，运行中切换系统主题 → 即时广播（关闭 G-04）
    this._registerThemeChangeListener()

    // 获取系统信息
    const sysInfo = wx.getSystemInfoSync()
    this.globalData.statusBarHeight = sysInfo.statusBarHeight
    this.globalData.screenHeight = sysInfo.screenHeight
    this.globalData.screenWidth = sysInfo.screenWidth

    // BUG-20260806-004：导航栏与原生胶囊对齐
    try {
      var menuRect = wx.getMenuButtonBoundingClientRect()
      this.globalData.menuTop = menuRect.top
      this.globalData.menuHeight = menuRect.height
      this.globalData.menuBottom = menuRect.bottom
    } catch (e) { /* 低版本兼容：用估算值 */ }

    // 字体初始化：首入跟随系统，后续读取记忆
    this._initFontScale()
  },

  /**
   * DG-04（数据治理 3.4 · 方案 3 改动 C）：每日首次打开异步清理过期收藏/浏览
   * 主防线是读取时惰性过滤；此兜底每日一次遍历本地 lc:browseHistory / lc:favorites，
   * 删除 expireAt < now 的记录（浏览 7 天 / 收藏 30 天），更新 lastCleanupDate。
   * 延迟 2s 执行，实际耗时 <10ms，对启动零影响。
   */
  _dailyCleanup() {
    var that = this
    setTimeout(function () {
      try {
        var today = new Date()
        var todayStr = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate()
        var last = wx.getStorageSync('lc:lastCleanupDate')
        if (last === todayStr) return // 今日已清理

        var now = Date.now()
        // 浏览历史：7 天过期（值结构 lc:browseHistory = [{...}]）
        try {
          var hist = wx.getStorageSync('lc:browseHistory')
          if (hist) {
            var histArr = JSON.parse(hist)
            var hv = histArr._v || histArr
            var hList = Array.isArray(hv) ? hv : []
            var hFiltered = hList.filter(function (it) {
              if (!it || !it.viewedAt) return true
              return now - it.viewedAt < 7 * 24 * 60 * 60 * 1000
            })
            if (hFiltered.length !== hList.length) {
              wx.setStorageSync('lc:browseHistory', JSON.stringify({ _v: hFiltered, _e: 0 }))
            }
          }
        } catch (e) { /* ignore */ }

        // 收藏：30 天过期（值结构 lc:favorites = [{...}]）
        try {
          var fav = wx.getStorageSync('lc:favorites')
          if (fav) {
            var favArr = JSON.parse(fav)
            var fv = favArr._v || favArr
            var fList = Array.isArray(fv) ? fv : []
            var fFiltered = fList.filter(function (it) {
              if (!it || !it.addedAt) return true
              return now - it.addedAt < 30 * 24 * 60 * 60 * 1000
            })
            if (fFiltered.length !== fList.length) {
              wx.setStorageSync('lc:favorites', JSON.stringify({ _v: fFiltered, _e: 0 }))
            }
          }
        } catch (e) { /* ignore */ }

        wx.setStorageSync('lc:lastCleanupDate', todayStr)
      } catch (e) { /* ignore */ }
    }, 2000)
  },

  /**
   * D-07 S1：初始化主题偏好（读取 Storage + 系统主题）
   * 读取 Storage（settings_followSystem / settings_darkMode，与设置页同键），
   * 计算 effectiveTheme 并始终注入生效 class（page--dark / page--light）。
   */
  _initTheme() {
    var followSystem = true
    var darkMode = false
    try {
      var sf = wx.getStorageSync('settings_followSystem')
      var sd = wx.getStorageSync('settings_darkMode')
      if (sf !== '' && sf !== undefined && sf !== null) {
        followSystem = !!sf
        darkMode = !!sd
      }
    } catch (e) { /* ignore */ }
    this.globalData.followSystem = followSystem
    this.globalData.darkMode = darkMode
    // D-07 S1：读取系统主题作为初始值（跟随模式基准）
    try {
      var sysInfo = wx.getSystemInfoSync()
      this.globalData._systemTheme = sysInfo.theme === 'dark' ? 'dark' : 'light'
    } catch (e) { /* ignore */ }
    this.applyTheme()
  },

  /**
   * D-07 S1：跟随系统模式下监听系统主题切换，实时广播（关闭 G-04）
   * 手动模式（followSystem=false）不监听，主题由设置页开关决定。
   */
  _registerThemeChangeListener() {
    try {
      if (wx.onThemeChange) {
        wx.onThemeChange(function (res) {
          var theme = res && res.theme === 'dark' ? 'dark' : 'light'
          this.globalData._systemTheme = theme
          // 仅跟随系统模式下系统切换才影响生效主题
          if (this.globalData.followSystem !== false) {
            this.applyTheme()
          }
        }.bind(this))
      }
    } catch (e) { /* ignore */ }
  },

  /**
   * D-07 S1：应用主题到所有已存在页面（getCurrentPages 动态注入 themeClass）
   * 状态机：followSystem=true → effectiveTheme=系统主题（随 onThemeChange 更新）
   *         followSystem=false → effectiveTheme=darkMode?'dark':'light'
   * 始终注入生效 class（page--dark / page--light），不再输出 ''（关闭 G-01）。
   */
  applyTheme() {
    var followSystem = this.globalData.followSystem !== false
    var darkMode = !!this.globalData.darkMode
    var effectiveTheme = followSystem
      ? (this.globalData._systemTheme || 'light')
      : (darkMode ? 'dark' : 'light')
    this.globalData.effectiveTheme = effectiveTheme
    var themeClass = effectiveTheme === 'dark' ? 'page--dark' : 'page--light'
    this.globalData.themeClass = themeClass
    try {
      var pages = getCurrentPages()
      for (var i = 0; i < pages.length; i++) {
        if (pages[i] && pages[i].setData) {
          pages[i].setData({ themeClass: themeClass })
        }
      }
    } catch (e) { /* ignore */ }
    // D-07 S4（G-05）：同步窗口背景/下拉回弹露底与 loading 指示点颜色
    this._syncWindowStyle(effectiveTheme)
  },

  /**
   * D-07 S4（G-05）：窗口背景跟随生效主题（方案 B：运行时 setBackgroundColor）
   * 微信 window.backgroundColor 静态配置无法跟随手动模式，运行时同步最可控；
   * 下拉回弹/页面露底处显示与当前主题一致的背景色。
   */
  _syncWindowStyle(theme) {
    try {
      if (wx.setBackgroundColor) {
        wx.setBackgroundColor({
          backgroundColor: theme === 'dark' ? '#000000' : '#F5F3F0',
          backgroundColorTop: theme === 'dark' ? '#000000' : '#F5F3F0',
          backgroundColorBottom: theme === 'dark' ? '#000000' : '#F5F3F0',
        })
      }
      if (wx.setBackgroundTextStyle) {
        wx.setBackgroundTextStyle({
          textStyle: theme === 'dark' ? 'light' : 'dark',
        })
      }
    } catch (e) { /* ignore */ }
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
      // UX-FIX03: 已有记忆直接恢复，不检查 fromSystem（存储值优先）
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
      wx.setStorageSync('fontScaleFromSystem', true)
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
      // UX-FIX03: 标记手动调整，之后不再跟随系统字号
      wx.setStorageSync('fontScaleFromSystem', false)
    } catch (e) { /* ignore */ }
  },

  /**
   * 将档位映射为 CSS --font-scale 数值并注入到页面 style
   *
   * UX-FIX-F13：此前 wxml 根节点未绑定 style="--font-scale"，导致本方法算出的
   * scale 从未真正进入 DOM，全站 22 处 calc(Xrpx * var(--font-scale)) 恒等于
   * 基准值 —— 四档字号形同虚设。现由 home.wxml / detail.wxml 根节点绑定生效。
   *
   * UX-FIX-F12（owner 2026-08-02 批准折中）：元信息与操作栏不再锁死 22rpx，
   * 改为跟随缩放但设 1.15 上限（最高 25.3rpx），既守住「元信息视觉退后」的
   * 版式意图，又不完全冻结无障碍缩放。上限在 JS 层算好而非用 CSS min()，
   * 规避低版本 WebView 对 min() 的兼容风险。
   */
  _applyFontScale(tier) {
    var scaleMap = [1, 1.15, 1.3, 1.5]
    var scale = scaleMap[tier] || 1

    // 元信息/操作栏折中系数：跟涨但封顶 1.15
    var metaScale = scale > META_SCALE_CAP ? META_SCALE_CAP : scale

    // 动态设置 page 级别的 CSS 变量（覆盖 theme.json 默认值）
    // 通过 getCurrentPages 注入到所有页面
    try {
      var pages = getCurrentPages()
      for (var i = 0; i < pages.length; i++) {
        if (pages[i] && pages[i].setData) {
          pages[i].setData({
            _fontScaleValue: scale,
            _metaScaleValue: metaScale
          })
        }
      }
    } catch (e) { /* ignore */ }

    // 同时写入全局 data，供新页面 onLoad 时读取
    this.globalData._fontScaleValue = scale
    this.globalData._metaScaleValue = metaScale
  }
})
