// 关于一页 — dock「扩展位」改造（AB-01 · owner 2026-08-05 确认文案）

var app = getApp()
var changelog = require('../../config/changelog')
var stories = require('../../config/stories')

Page({
  data: {
    menuTop: 0,
    menuHeight: 32,
    navOffset: 0,  // D-09 v1.2（BUG-20260806-007）: 内容起始基准
    // BUG-20260806-003（owner 07:44 追加裁定）: 第 2 层页面统一主页按钮，home icon 按深色切换白色版
    isDark: false,
    // 版本日志弹窗（2026-08-09）：点击版本号触发
    appVersion: changelog.currentVersion,
    latestChangelog: changelog.versions[0] || null,
    showChangelog: false,
    // 我们坚持的事（2026-08-07 owner 裁定：删「永不空白」；「AI 为你提炼」→「AI加持」）
    commitments: [
      { title: '纯文字阅读', desc: '无图、无视频，把注意力还给文字本身' },
      { title: 'AI加持', desc: '借助AI能力，帮助你更快，更高效阅读' },
      { title: '尊重你的注意力', desc: '不打扰、无广告、不推送' },
    ],
    // 产品介绍（2026-09-09 3.0.0：核心功能点到即止 + 保留探索乐趣）
    // 2026-09-09 owner 调整：AI 摘要与解读并入第一项；新增「深度挖掘」介绍项
    productIntro: [
      { title: '一页极简阅读 · AI 加持', desc: '打开即读，无推荐、无追踪；每条都带 AI 摘要与解读，几秒抓住要点，重要的再深一层讲透' },
      { title: '深度挖掘', desc: '读到想了解更多？按一下深挖，AI 汇聚多角度信息，把来龙去脉讲清楚' },
      { title: 'AI 情报官', desc: '每日划重点：发生了什么、AI 预测、落到你这里' },
      { title: '我的关注', desc: '长按一个话题，替你盯住“后来怎么样了”' },
    ],
    productMystery: '更多能力，藏在细节里——试试长按正文、左右滑动、点开「发生了什么」……',
    // 版本故事（2026-09-09 3.0.0：保留历史故事线，默认折叠，展开阅读；
    //   展开态按下标存（版本号含“.”会被 setData 当路径拆开，故不用版本号作 key））
    versionStories: (stories && stories.stories) || [],
    storyExpanded: {},
    // 我们的初衷（2026-09-09：过长，默认折叠到第一段，可按需展开全文）
    originOpen: false,
  },

  onLoad: function () {
    // 2026-08-31 修复：冷启动/栈底时左滑返回会退出小程序——
    // 先 reLaunch 到新闻首页形成 home→本页 栈，左滑返回自然回首页
    try {
      if (getCurrentPages().length === 1) {
        wx.reLaunch({ url: '/pages/home/home?redirect=about', fail: function () {} })
        return
      }
    } catch (e) {}
    this.setData({
      // BUG-20260806-004: 导航栏与胶囊对齐
      menuTop: (app && app.globalData.menuTop) || 0,
      menuHeight: (app && app.globalData.menuHeight) || 32,
      // BUG-20260806-009 v3: 状态栏背景层高度（custom 模式下 setNavigationBarColor 无效）
      statusBarHeight: (app && app.globalData.statusBarHeight) || 20,
      // D-09 v1.2（BUG-20260806-007）: 内容起始基准 = menuTop + menuHeight + 12px
      navOffset: ((app && app.globalData.menuTop) || 0) + ((app && app.globalData.menuHeight) || 32) + 12,
      themeClass: (app && app.globalData && app.globalData.themeClass) || '',
      // BUG-20260806-003: 主页 icon 按主题切换白色版
      isDark: this._isSystemDark(),
    })

    // BUG-20260806-009 follow-up: 页面级调用状态栏 API
    if (app && app.setNavBarColor) {
      app.setNavBarColor((app.globalData && app.globalData.effectiveTheme) || 'light')
    }
  },

  onShow: function () {
    // BUG-20260805-003: onShow 刷新主题（可能从设置页返回）
    this.setData({
      themeClass: (app && app.globalData && app.globalData.themeClass) || '',
      // BUG-20260806-003: onShow 同步 isDark（从设置页切换主题返回时刷新 icon）
      isDark: this._isSystemDark(),
    })
    // 刷新底部 logo 组件主题（手动切换主题后从设置页返回时 logo 可能滞留旧值）
    try {
      var logoComp = this.selectComponent('#about-logo')
      if (logoComp && typeof logoComp.refreshTheme === 'function') {
        logoComp.refreshTheme()
      }
    } catch (e) { /* ignore */ }
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
   * 版本日志弹窗（2026-08-09 owner 需求）：点击版本号打开更新日志弹窗。
   */
  onTapVersion: function () {
    this.setData({ showChangelog: true })
  },

  onCloseChangelog: function () {
    this.setData({ showChangelog: false })
  },

  /** 版本故事：点击卡片展开/收起（默认折叠，保留故事线；按下标作 key 防版本号“.”被 setData 拆路径） */
  onToggleStory: function (e) {
    var idx = e.currentTarget.dataset.idx
    if (idx === undefined || idx === null || idx === '') return
    var cur = this.data.storyExpanded || {}
    var next = {}
    for (var k in cur) next[k] = cur[k]
    next[idx] = !cur[idx]
    this.setData({ storyExpanded: next })
  },

  /** 我们的初衷：展开/收起全文（默认折叠到第一段） */
  onToggleOrigin: function () {
    this.setData({ originOpen: !this.data.originOpen })
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

  // ============ 分享（RQ-2026-08-09 owner：关于页支持发送给朋友 + 分享朋友圈） ============

  /**
   * 发送给朋友：固定卡片文案，path 指向关于页。
   */
  onShareAppMessage: function () {
    return {
      title: '一页 One-News · 极简新闻速览',
      path: '/pages/about/about',
    }
  },

  /**
   * 分享到朋友圈（单页模式）：关于页为纯内容展示（承诺/理念），
   * 符合单页模式「纯内容场景」定位；无自定义封面，微信使用页面截图。
   */
  onShareTimeline: function () {
    return {
      title: '一页 One-News · 极简新闻速览',
    }
  },

})
