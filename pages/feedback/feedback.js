// 意见反馈留言板 — RQ-22-FE
// 上游：PRD-RQ22-意见反馈留言板.md（v1.1 已确认）· D-02-增量-RQ22-意见反馈留言板-UIUX设计.md（v1.0）
// 作者识别/筛选/删除等管理控件仅由云函数返回 isAuthor 驱动渲染，前端不可伪造身份（PRD §4.3.2/§4.3.3）

var { formatRelativeTime } = require('../../utils/util')
var app = getApp()

// 30s 限频（PRD §3.1 F2 / D-02 §4：30s/条）
var COOLDOWN_MS = 30 * 1000
// 楼中楼嵌套最深 4 级收平（D-02 §4）
var MAX_REPLY_DEPTH = 4

Page({
  data: {
    // D-09 导航（与 settings/favorites 一致）
    menuTop: 0,
    menuHeight: 32,
    navOffset: 0,
    statusBarHeight: 20,
    themeClass: '',
    // BUG-FS-20260805-001: 深色 icon 切换
    isDark: false,

    loading: true,
    isEmpty: false,

    list: [],        // 顶层留言卡片（含 replies 展平嵌套）
    total: 0,        // 留言总数「共 N 条」（仅作者，Q4 ✅）
    isAuthor: false, // 当前调用者是否作者（云函数判定，不可伪造）

    draft: '',       // 底部输入框内容
    sendDisabled: true,
    sending: false,
    cooldownLeft: 0, // 30s 冷却剩余秒数

    filterOpen: false, // 筛选下拉（仅作者）
    filter: 'all',     // all | violation | mine

    replyTargetId: '', // 展开回复输入框的留言 id（'' = 无）
    replyDraft: {},    // { [id]: 回复草稿 }
    replySending: false,
  },

  // 30s 限频本地记录（毫秒时间戳）
  _lastSubmitTime: 0,
  _cooldownTimer: null,

  onLoad: function () {
    this.setData({
      menuTop: (app && app.globalData.menuTop) || 0,
      menuHeight: (app && app.globalData.menuHeight) || 32,
      // BUG-20260806-009 v3: 状态栏背景层高度
      statusBarHeight: (app && app.globalData.statusBarHeight) || 20,
      // D-09 v1.2（BUG-20260806-007）: 内容起始基准
      navOffset: ((app && app.globalData.menuTop) || 0) + ((app && app.globalData.menuHeight) || 32) + 12,
      themeClass: (app && app.globalData && app.globalData.themeClass) || '',
      isDark: this._isSystemDark(),
    })
    // BUG-20260806-009 follow-up: 页面级调用状态栏 API
    if (app && app.setNavBarColor) {
      app.setNavBarColor((app.globalData && app.globalData.effectiveTheme) || 'light')
    }
  },

  onShow: function () {
    // BUG-20260805-003: 刷新主题（可能从设置页/公约页返回）
    this.setData({
      themeClass: (app && app.globalData && app.globalData.themeClass) || '',
      isDark: this._isSystemDark(),
    })
    this._load()
  },

  onUnload: function () {
    if (this._cooldownTimer) {
      clearInterval(this._cooldownTimer)
      this._cooldownTimer = null
    }
  },

  /**
   * BUG-FS-20260805-001: 判断当前生效主题是否深色（与 favorites/detail 同源）
   */
  _isSystemDark: function () {
    try {
      if (app && app.globalData && app.globalData.effectiveTheme) {
        return app.globalData.effectiveTheme === 'dark'
      }
    } catch (e) {}
    return false
  },

  // ============ 数据加载 ============

  _load: function () {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'feedback-list',
      data: { pageNum: 1, pageSize: 50, filter: this.data.filter },
    })
      .then((res) => {
        const r = (res && res.result) || {}
        if (r.code === 0 && r.data) {
          this._applyList(r.data.list || [], r.data.total || 0, !!r.isAuthor)
        } else {
          this.setData({ loading: false, isEmpty: true })
          wx.showToast({ title: '留言板加载失败', icon: 'none' })
        }
      })
      .catch(() => {
        this.setData({ loading: false, isEmpty: true })
        wx.showToast({ title: '留言板加载失败', icon: 'none' })
      })
  },

  /**
   * 组装列表：顶层（rootId 空）倒序；回复按 parentId 组嵌套树（楼中楼），
   * 展平为带 depth 的线性数组供 wxml 渲染，深度封顶 MAX_REPLY_DEPTH（4 级收平）。
   */
  _applyList: function (list, total, isAuthor) {
    const top = list.filter((x) => !x.rootId).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    const replies = list.filter((x) => x.rootId)
    const cards = top.map((t) => this._buildCard(t, replies, isAuthor))
    this.setData({
      list: cards,
      total: total || 0,
      isAuthor: !!isAuthor,
      loading: false,
      isEmpty: cards.length === 0,
    })
  },

  _buildCard: function (t, replies, isAuthor) {
    const tree = this._buildReplyTree(t._id, replies, 1)
    return {
      id: t._id,
      nickname: t.nickname || '微信用户',
      isAuthorNick: !!t.isAuthor,
      timeText: this._timeText(t.createdAt),
      content: t.content || '',
      deleted: t.status === 'deleted',
      showDelete: !!isAuthor && t.status !== 'deleted',
      replies: this._flattenReplies(tree),
    }
  },

  /** 递归组嵌套树，depth 封顶后收平（不再增加缩进） */
  _buildReplyTree: function (parentId, list, depth) {
    const d = Math.min(depth, MAX_REPLY_DEPTH)
    return list
      .filter((r) => r.parentId === parentId)
      .map((r) => ({
        id: r._id,
        nickname: r.nickname || '微信用户',
        isAuthorNick: !!r.isAuthor,
        timeText: this._timeText(r.createdAt),
        content: r.content || '',
        depth: d,
        deleted: r.status === 'deleted',
        showDelete: !!isAuthor && r.status !== 'deleted',
        replies: this._buildReplyTree(r._id, list, d + 1),
      }))
  },

  _flattenReplies: function (tree) {
    const out = []
    const walk = (items) => {
      ;(items || []).forEach((r) => {
        out.push(r)
        if (r.replies && r.replies.length) walk(r.replies)
      })
    }
    walk(tree)
    return out
  },

  _timeText: function (ts) {
    return ts ? formatRelativeTime(ts) : ''
  },

  // ============ 底部输入：提交留言 ============

  onDraftInput: function (e) {
    const draft = e.detail.value
    this.setData({
      draft,
      sendDisabled: !draft.trim() || this.data.sending || this.data.cooldownLeft > 0,
    })
  },

  onSend: function () {
    const content = (this.data.draft || '').trim()
    if (!content || this.data.sending) return
    const left = this._cooldownLeft()
    if (left > 0) {
      // 30s 限频：未到时间 → 输入区上方倒计时（D-02 §4）
      this.setData({ cooldownLeft: left })
      this._startCooldownTicker()
      return
    }
    this.setData({ sending: true, sendDisabled: true })
    this._call('feedback-create', { content })
      .then((r) => {
        this.setData({ sending: false })
        if (r.code === 0) {
          this._lastSubmitTime = Date.now()
          this.setData({ draft: '', sendDisabled: true })
          this._startCooldownTicker()
          this._load()
          wx.showToast({ title: '留言成功', icon: 'success' })
        } else if (r.code === 'BLOCKED') {
          // 违规拦截 → 跳文明留言公约页（携带违规原因），不入库（AC-09）
          this._gotoRules(r.data && r.data.reason)
        } else {
          wx.showToast({ title: '提交失败，请重试', icon: 'none' })
        }
      })
      .catch(() => {
        this.setData({ sending: false, sendDisabled: false })
        wx.showToast({ title: '提交失败，请检查网络', icon: 'none' })
      })
  },

  // ============ 回复（楼中楼） ============

  toggleReply: function (e) {
    const id = e.currentTarget.dataset.id
    this.setData({ replyTargetId: this.data.replyTargetId === id ? '' : id })
  },

  onReplyInput: function (e) {
    const id = e.currentTarget.dataset.id
    const replyDraft = this.data.replyDraft || {}
    replyDraft[id] = e.detail.value
    this.setData({ replyDraft })
  },

  onReplySend: function (e) {
    const id = e.currentTarget.dataset.id
    const content = ((this.data.replyDraft || {})[id] || '').trim()
    if (!content || this.data.replySending) return
    this.setData({ replySending: true })
    this._call('feedback-create', { content, parentId: id })
      .then((r) => {
        this.setData({ replySending: false })
        if (r.code === 0) {
          const replyDraft = this.data.replyDraft || {}
          replyDraft[id] = ''
          this.setData({ replyDraft, replyTargetId: '' })
          this._load()
          wx.showToast({ title: '回复成功', icon: 'success' })
        } else if (r.code === 'BLOCKED') {
          this._gotoRules(r.data && r.data.reason)
        } else {
          wx.showToast({ title: '回复失败，请重试', icon: 'none' })
        }
      })
      .catch(() => {
        this.setData({ replySending: false })
        wx.showToast({ title: '回复失败，请检查网络', icon: 'none' })
      })
  },

  // ============ 作者：删除（软删除，作者侧灰显） ============

  onDelete: function (e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除留言',
      content: '确定删除这条留言？删除后普通用户不可见。',
      confirmColor: '#FF3B30',
      success: (res) => {
        if (!res.confirm) return
        this._call('feedback-delete', { id })
          .then((r) => {
            if (r.code === 0) {
              wx.showToast({ title: '已删除', icon: 'none' })
              this._load()
            } else {
              wx.showToast({ title: '删除失败', icon: 'none' })
            }
          })
          .catch(() => {
            wx.showToast({ title: '删除失败，请检查网络', icon: 'none' })
          })
      },
    })
  },

  // ============ 作者：筛选（全部 / 仅违规标记 / 仅我的回复） ============

  toggleFilter: function () {
    this.setData({ filterOpen: !this.data.filterOpen })
  },

  onFilterSelect: function (e) {
    const f = e.currentTarget.dataset.f
    this.setData({ filter: f, filterOpen: false })
    this._load()
  },

  // ============ 工具 ============

  /**
   * 云函数调用：返回 result（含 code）。BLOCKED 等非 0 code 也原样返回，由调用方分支处理。
   */
  _call: function (name, data) {
    return wx.cloud
      .callFunction({ name, data })
      .then((res) => (res && res.result) || {})
      .catch(() => ({}))
  },

  _cooldownLeft: function () {
    const elapsed = Date.now() - (this._lastSubmitTime || 0)
    return Math.max(0, Math.ceil((COOLDOWN_MS - elapsed) / 1000))
  },

  _startCooldownTicker: function () {
    if (this._cooldownTimer) clearInterval(this._cooldownTimer)
    const that = this
    const tick = function () {
      const left = that._cooldownLeft()
      that.setData({
        cooldownLeft: left,
        sendDisabled: left > 0 || !(that.data.draft || '').trim(),
      })
      if (left <= 0 && that._cooldownTimer) {
        clearInterval(that._cooldownTimer)
        that._cooldownTimer = null
      }
    }
    tick()
    this._cooldownTimer = setInterval(tick, 1000)
  },

  /** 违规拦截 → 文明留言公约页（携带违规原因） */
  _gotoRules: function (reason) {
    const q = reason ? '?reason=' + encodeURIComponent(reason) : ''
    wx.navigateTo({ url: '/pages/feedback/rules' + q })
  },

  // ============ 主页按钮（D-09 第 2 层页面统一，与 favorites/settings 同源） ============

  goHome: function () {
    var now = Date.now()
    if (this.data._lastHomeTap && now - this.data._lastHomeTap < 300) return
    this.setData({ _lastHomeTap: now })
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
