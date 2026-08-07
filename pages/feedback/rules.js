// 文明留言公约页 — RQ-22-FE
// 上游：D-02-增量-RQ22-意见反馈留言板-UIUX设计.md（§2/§3.2）· PRD-RQ22（F7 / 流程 1）
// 从留言板 create 返回 BLOCKED 时 navigateTo 进入，携带违规原因（options.reason）

var app = getApp()

Page({
  data: {
    // D-09 导航
    menuTop: 0,
    menuHeight: 32,
    navOffset: 0,
    statusBarHeight: 20,
    themeClass: '',
    isDark: false,

    reason: '',        // 违规原因（BLOCKED 返回标记，供违规提示卡展示）
    showViolation: false,

    // 公约文案（编号列表，D-02 §2/§3.2；文案初稿，后续可随 PD 调整）
    clauses: [
      '请勿发布涉政、色情、暴力、赌博、诈骗等违法违规内容',
      '请勿辱骂、攻击、歧视他人，保持友善文明的讨论氛围',
      '请勿发布广告、推广、引流等与产品无关的信息',
      '请勿散布谣言或未经证实的虚假信息',
      '请勿刷屏、恶意灌水或重复发布相同内容',
      '违反公约的留言将被拦截或删除，情节严重者可能无法继续留言',
    ],
  },

  onLoad: function (options) {
    this.setData({
      menuTop: (app && app.globalData.menuTop) || 0,
      menuHeight: (app && app.globalData.menuHeight) || 32,
      statusBarHeight: (app && app.globalData.statusBarHeight) || 20,
      navOffset: ((app && app.globalData.menuTop) || 0) + ((app && app.globalData.menuHeight) || 32) + 12,
      themeClass: (app && app.globalData && app.globalData.themeClass) || '',
      isDark: this._isSystemDark(),
      reason: (options && options.reason) || '',
      showViolation: !!(options && options.reason),
    })
    if (app && app.setNavBarColor) {
      app.setNavBarColor((app.globalData && app.globalData.effectiveTheme) || 'light')
    }
  },

  onShow: function () {
    this.setData({
      themeClass: (app && app.globalData && app.globalData.themeClass) || '',
      isDark: this._isSystemDark(),
    })
  },

  _isSystemDark: function () {
    try {
      if (app && app.globalData && app.globalData.effectiveTheme) {
        return app.globalData.effectiveTheme === 'dark'
      }
    } catch (e) {}
    return false
  },

  /** 返回留言板（第 3 层页面 navigateBack；无历史则回首页兜底） */
  goBack: function () {
    var pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
    } else {
      wx.reLaunch({
        url: '/pages/feedback/feedback',
        fail: function () { wx.reLaunch({ url: '/pages/home/home' }) },
      })
    }
  },
})
