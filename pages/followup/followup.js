// 我的关注 — 「关注后续」跨模块聚合页（One News + AI 情报官）
// 四态：有更新(红 hasUpdate) / 无更新(灰 none) / 已读(绿 read) / 空状态
// 进入/返回：圆形绽放 reveal（按压点 clip-path，由首页/详情页长按传入 followEnterPoint）

const app = getApp()
const FU = require('../../utils/followUp')

const TRACK_TIMES = ['08:00', '12:00', '18:00', '21:00']

Page({
  data: {
    menuTop: 0,
    menuHeight: 32,
    statusBarHeight: 20,
    navOffset: 0,
    themeClass: '',
    isDark: false,
    list: [],
    unreadCount: 0,
    isEmpty: false,
    expanded: {},
    revealStyle: '',
  },

  // 展开态（实例级，_load 后回写避免重置）
  _expanded: {},
  _destroyed: false,

  onLoad() {
    const a = getApp()
    this._expanded = {}
    this.setData({
      menuTop: a.globalData.menuTop || 0,
      menuHeight: a.globalData.menuHeight || 32,
      statusBarHeight: a.globalData.statusBarHeight || 20,
      navOffset: (a.globalData.menuTop || 0) + (a.globalData.menuHeight || 32) + 12,
      themeClass: a.globalData.themeClass || '',
      isDark: this._isSystemDark(),
    })
    if (a.setNavBarColor) a.setNavBarColor(a.globalData.effectiveTheme || 'light')
    this._load()
    this._initReveal()
  },

  onShow() {
    this.setData({
      themeClass: app.globalData.themeClass || '',
      isDark: this._isSystemDark(),
    })
    if (app.setNavBarColor) app.setNavBarColor(app.globalData.effectiveTheme || 'light')
    this._load()
  },

  onUnload() {
    this._destroyed = true
  },

  _isSystemDark() {
    try {
      const a = getApp()
      if (a.globalData.effectiveTheme) return a.globalData.effectiveTheme === 'dark'
      return wx.getSystemInfoSync().theme === 'dark'
    } catch (e) { return false }
  },

  // 计算单条四态
  _decorate(item) {
    const updates = item.updates || []
    const unreadCount = updates.filter(function (u) { return !u.read }).length
    let status = 'none'
    if (updates.length === 0) status = 'none'
    else if (unreadCount > 0) status = 'hasUpdate'
    else status = 'read'
    return Object.assign({}, item, {
      unreadCount: unreadCount,
      status: status,
      statusText: status === 'hasUpdate'
        ? (unreadCount + ' 条新更新')
        : (status === 'read' ? '已读完' : '已是最新'),
      timeline: updates.map(function (u) {
        return { date: u.date, summary: u.summary, sourcesCount: u.sourcesCount, read: u.read }
      }),
    })
  },

  _load() {
    const raw = FU.getFollows()
    const list = raw.map(this._decorate.bind(this))
    const unread = list.reduce(function (n, it) { return n + (it.unreadCount || 0) }, 0)
    this.setData({
      list: list,
      unreadCount: unread,
      isEmpty: list.length === 0,
      expanded: Object.assign({}, this._expanded),
    })
  },

  // 圆形绽放进入：从按压点 clip-path 0% → 150%
  _initReveal() {
    const a = getApp()
    const p = (a.globalData && a.globalData.followEnterPoint) || null
    const x = p ? p.x : -1
    const y = p ? p.y : -1
    this.setData({
      revealStyle: 'clip-path: circle(0% at ' + x + 'px ' + y + 'px); -webkit-clip-path: circle(0% at ' + x + 'px ' + y + 'px);',
    })
    const that = this
    setTimeout(function () {
      if (that._destroyed) return
      that.setData({
        revealStyle: 'clip-path: circle(150% at ' + x + 'px ' + y + 'px); -webkit-clip-path: circle(150% at ' + x + 'px ' + y + 'px);',
      })
    }, 50)
  },

  // 点击卡片：展开/收起时间线；展开即标记已读（读完转绿）
  onItemTap(e) {
    const id = e.currentTarget.dataset.id
    const module = e.currentTarget.dataset.module
    const willExpand = !this._expanded[id]
    if (willExpand) this._expanded[id] = true
    else delete this._expanded[id]
    if (willExpand) FU.markRead(module, id)
    this._load()
  },

  // 长按卡片：操作菜单（模拟更新 / 标记已读 / 改追踪时间 / 取消关注）
  onItemLongPress(e) {
    const id = e.currentTarget.dataset.id
    const module = e.currentTarget.dataset.module
    const that = this
    wx.showActionSheet({
      itemList: ['模拟收到新更新', '标记已读', '改追踪时间', '取消关注'],
      success: function (res) {
        if (res.tapIndex === 0) {
          FU.addUpdate(module, id)
          that._load()
          wx.showToast({ title: '已模拟一次 AI 更新', icon: 'none' })
        } else if (res.tapIndex === 1) {
          FU.markRead(module, id)
          that._load()
        } else if (res.tapIndex === 2) {
          wx.showActionSheet({
            itemList: TRACK_TIMES,
            success: function (r) {
              FU.setTrackTime(module, id, TRACK_TIMES[r.tapIndex])
              that._load()
              wx.showToast({ title: '追踪时间 ' + TRACK_TIMES[r.tapIndex], icon: 'none' })
            },
          })
        } else if (res.tapIndex === 3) {
          FU.removeFollow(module, id)
          if (that._expanded[id]) delete that._expanded[id]
          that._load()
          wx.showToast({ title: '已取消关注', icon: 'none' })
        }
      },
    })
  },

  // 全部标为已读（红 → 绿，顶部红点清 0）
  onMarkAllRead() {
    FU.markAllRead()
    this._load()
    wx.showToast({ title: '已全部标为已读', icon: 'none' })
  },

  // 返回：反向圆形收回按压点，再 navigateBack
  goBack() {
    const a = getApp()
    const p = (a.globalData && a.globalData.followEnterPoint) || null
    const x = p ? p.x : -1
    const y = p ? p.y : -1
    this.setData({
      revealStyle: 'clip-path: circle(0% at ' + x + 'px ' + y + 'px); -webkit-clip-path: circle(0% at ' + x + 'px ' + y + 'px);',
    })
    const that = this
    setTimeout(function () {
      if (that._destroyed) return
      wx.navigateBack()
    }, 320)
  },

  goHome() {
    wx.reLaunch({ url: '/pages/home/home' })
  },
})
