// 关于一页 — dock「扩展位」改造（AB-01 · owner 2026-08-05 确认文案）

var app = getApp()

Page({
  data: {
    menuTop: 0,
    menuHeight: 32,
    navOffset: 0,  // D-09 v1.2（BUG-20260806-007）: 内容起始基准
    appVersion: 'v6.3.0',
    // BUG-20260806-003（owner 07:44 追加裁定）: 第 2 层页面统一主页按钮，home icon 按深色切换白色版
    isDark: false,
    // 五条设计理念
    principles: [
      { title: '一眼即得', desc: '打开即读，不做信息流，不设推荐算法' },
      { title: '我的选择', desc: '五大分类自己选（推荐 / 科技 / 国际 / 体育 / 生活），不被算法喂养' },
      { title: '三分钟读完', desc: 'AI 摘要提炼要点，正文去噪（自动过滤广告声明、图片说明、扫码引导等噪音）' },
      { title: '昼夜皆宜', desc: '暖灰纸感白天护眼，暗色模式夜间不刺眼，字号四档可调' },
      { title: '简单到极致', desc: '全 App 层级不超过两层，核心路径不超过三步' },
    ],
    // 我们坚持的事
    commitments: [
      { title: '纯文字阅读', desc: '无图、无视频，把注意力还给文字本身' },
      { title: 'AI 为你提炼', desc: '智谱 GLM-4-Flash + DeepSeek 双引擎生成摘要，三分钟读完一条' },
      { title: '永不空白', desc: '多源聚合 + 多层降级保障，任何时刻打开都有内容' },
      { title: '尊重你的注意力', desc: '不打扰、无广告、不推送' },
    ],
  },

  onLoad: function () {
    this.setData({
      // BUG-20260806-004: 导航栏与胶囊对齐
      menuTop: (app && app.globalData.menuTop) || 0,
      menuHeight: (app && app.globalData.menuHeight) || 32,
      // D-09 v1.2（BUG-20260806-007）: 内容起始基准 = menuTop + menuHeight + 12px
      navOffset: ((app && app.globalData.menuTop) || 0) + ((app && app.globalData.menuHeight) || 32) + 12,
      themeClass: (app && app.globalData && app.globalData.themeClass) || '',
      // BUG-20260806-003: 主页 icon 按主题切换白色版
      isDark: this._isSystemDark(),
    })
  },

  onShow: function () {
    // BUG-20260805-003: onShow 刷新主题（可能从设置页返回）
    this.setData({
      themeClass: (app && app.globalData && app.globalData.themeClass) || '',
      // BUG-20260806-003: onShow 同步 isDark（从设置页切换主题返回时刷新 icon）
      isDark: this._isSystemDark(),
    })
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

  goBack: function () {
    var pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
    } else {
      wx.reLaunch({ url: '/pages/home/home' })
    }
  },

  /**
   * BUG-20260806-003（owner 07:44 追加裁定）: 第 2 层页面统一主页按钮
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

  copyEmail: function () {
    this._copy('ztengfei@hotmail.com', '邮箱')
  },

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
})
