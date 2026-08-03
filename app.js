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
