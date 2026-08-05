// 关于一页 — AB-01 独立全屏页

var app = getApp()

var scaleMap = [1, 1.15, 1.3, 1.5]

Page({
  data: {
    statusBarHeight: 20,
    fontScaleTier: 0,
    _fontScaleValue: 1,
    _metaScaleValue: 1,
    themeClass: '',
    email: 'ztengfei@hotmail.com',
    wechat: 'jiaowotengfei',
    appVersion: 'v6.3.0',
    principles: [
      { id: 1, title: '一眼即得', desc: '打开即读，不做信息流，不设推荐算法' },
      { id: 2, title: '我的选择', desc: '五大分类自己选（推荐 / 科技 / 国际 / 体育 / 生活），不被算法喂养' },
      { id: 3, title: '三分钟读完', desc: 'AI 摘要提炼要点，正文去噪（自动过滤广告声明、图片说明、扫码引导等噪音）' },
      { id: 4, title: '昼夜皆宜', desc: '暖灰纸感白天护眼，暗色模式夜间不刺眼，字号四档可调' },
      { id: 5, title: '简单到极致', desc: '全 App 层级不超过两层，核心路径不超过三步' }
    ],
    features: [
      '纯文字阅读：无图、无视频，把注意力还给文字本身',
      'AI 为你提炼：智谱 GLM-4-Flash + DeepSeek 双引擎生成摘要，三分钟读完一条',
      '永不空白：多源聚合 + 五层降级链，任何时刻打开都有内容',
      '尊重你的注意力：不打扰、无广告、不推送'
    ]
  },

  onLoad: function () {
    var s = (app && app.globalData && app.globalData.statusBarHeight) || 20
    var tier = (app && app.globalData && typeof app.globalData.fontScale === 'number') ? app.globalData.fontScale : 0
    this.setData({
      statusBarHeight: s,
      fontScaleTier: tier,
      _fontScaleValue: app.globalData._fontScaleValue || scaleMap[tier] || 1,
      _metaScaleValue: app.globalData._metaScaleValue || 1,
      themeClass: (app && app.globalData && app.globalData.themeClass) || ''
    })
  },

  /** 复制邮箱 */
  copyEmail: function () {
    this._copy(this.data.email, '邮箱')
  },

  /** 复制微信 */
  copyWechat: function () {
    this._copy(this.data.wechat, '微信号')
  },

  _copy: function (text, label) {
    wx.setClipboardData({
      data: text,
      success: function () {
        wx.showToast({ title: label + '已复制', icon: 'none' })
      },
      fail: function () {
        wx.showToast({ title: '复制失败，请手动输入：' + text, icon: 'none' })
      }
    })
  },

  /** 返回 */
  goBack: function () {
    wx.navigateBack()
  }
})
