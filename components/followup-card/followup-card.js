// 我的关注 — 覆盖层组件（纯圆形绽放 overlay）
// 由首页/情报官首页长按挂载，visible + enterPoint 驱动 clip-path 从按压点 0%→150% 绽放。
// 不依赖 wx.navigateTo，故无系统右滑转场——真正从手指位置「炸开」。

const FU = require('../../utils/followUp')
const FU_SYNC = require('../../utils/followUpSync')
const TRACK_TIMES = ['08:00', '12:00', '18:00', '21:00']

Component({
  options: {
    multipleSlots: false,
  },

  properties: {
    visible: { type: Boolean, value: false },   // 宿主控制显隐（false 时 clip-path 收为 0%，不拦截触摸）
    enterPoint: { type: Object, value: null },   // { x, y } 按压点，供圆形绽放圆心；缺省则居中
  },

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
    // 初始即收为 0%，避免挂载瞬间闪现覆盖首页
    revealStyle: 'clip-path: circle(0% at 50% 50%); -webkit-clip-path: circle(0% at 50% 50%);',
    // 长按操作面板（owner 2026-09-08：自定义底部面板——无系统「取消」按钮，点蒙层关闭）
    sheetShow: false,
    sheetMode: 'actions',     // actions=操作菜单 | tracktime=改追踪时间
    sheetTitle: '',
    trackTimeOptions: TRACK_TIMES,
  },

  lifetimes: {
    attached() {
      this._expanded = {}
      this._destroyed = false
      const a = getApp()
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
    },
    detached() {
      this._destroyed = true
    },
  },

  observers: {
    // 宿主把 visible 置 true → 从按压点绽放
    'visible': function (v) {
      if (v) this._enterReveal()
      else this._onClosed()
    },
  },

  methods: {
    _isSystemDark() {
      try {
        const a = getApp()
        if (a.globalData.effectiveTheme) return a.globalData.effectiveTheme === 'dark'
        return wx.getSystemInfoSync().theme === 'dark'
      } catch (e) { return false }
    },

    // 计算单条四态（对齐 demo：状态徽标 / 来源标签 / 追踪时间 / 已关注天数 / 最新更新高亮框）
    _decorate(item) {
      const updates = item.updates || []
      const unreadCount = updates.filter(function (u) { return !u.read }).length
      let status = 'none'
      if (updates.length === 0) status = 'none'
      else if (unreadCount > 0) status = 'hasUpdate'
      else status = 'read'

      // 已关注天数（从创建时刻算到今天，至少 1 天）
      let followDays = 1
      if (item.createdAt) {
        followDays = Math.max(1, Math.round((Date.now() - item.createdAt) / 86400000))
      }

      // 最新更新：addUpdate 用 unshift，updates[0] 即最新一条
      const latest = updates.length ? updates[0] : null
      let latestDate = ''
      let latestSummary = ''
      if (latest) {
        latestDate = FU.formatFollowTime(latest.date)  // 2026-08-31: 带时分（今天 HH:MM / 昨天 HH:MM）
        latestSummary = latest.summary
      }
      // owner 2026-09-08：无更新时不再展示「今天 HH:MM 已检索，暂无新的公开进展」话术——
      // 静默留白（话题介绍 knownSummary 承担标题下的上下文版面）

      return Object.assign({}, item, {
        unreadCount: unreadCount,
        status: status,
        statusText: status === 'hasUpdate'
          ? (unreadCount + ' 条新更新')
          : (status === 'read' ? '已读完' : '已是最新'),
        followDays: followDays,
        latestDate: latestDate,
        latestSummary: latestSummary,
        timeline: updates.map(function (u) {
          return { date: FU.formatFollowTime(u.date), summary: u.summary, sourcesCount: u.sourcesCount, read: u.read }  // 2026-08-31: 带时分
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

    // 按压点 → clip-path 圆心（缺省居中）
    _point() {
      const p = this.data.enterPoint
      return p ? { x: p.x + 'px', y: p.y + 'px' } : { x: '50%', y: '50%' }
    },

    // 进入：clip-path 0% → 150% 绽放
    _enterReveal() {
      const pt = this._point()
      const zero = 'clip-path: circle(0% at ' + pt.x + ' ' + pt.y + '); -webkit-clip-path: circle(0% at ' + pt.x + ' ' + pt.y + ');'
      this.setData({ revealStyle: zero })
      this._load()
      // §九 后端：异步拉取云端检索更新 → 合并进本地 → 重渲染（失败静默，不影响展示）
      const that = this
      FU_SYNC.fetchUpdates().then(function (merged) {
        if (that._destroyed) return
        if (merged > 0) that._load()
      }).catch(function () { /* 离线/未部署：保持本地数据 */ })
      const that2 = this
      // 稍延迟一帧再切到 150%，确保浏览器已应用 0% 初始态，transition 能被触发
      setTimeout(function () {
        if (that2._destroyed) return
        that2.setData({ revealStyle: 'clip-path: circle(150% at ' + pt.x + ' ' + pt.y + '); -webkit-clip-path: circle(150% at ' + pt.x + ' ' + pt.y + ');' })
      }, 80)
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

    // 长按卡片：打开自定义操作面板（owner 2026-09-08：
    // ①去掉系统弹窗底部的「取消」按钮——换自定义面板，点蒙层关闭；
    // ②「立即检索」下线——检索只能走每日定时档）
    onItemLongPress(e) {
      const id = e.currentTarget.dataset.id
      const module = e.currentTarget.dataset.module
      const item = (this.data.list || []).find(function (it) { return it.itemId === id })
      this._sheetTarget = { module: module, id: id }
      this.setData({
        sheetShow: true,
        sheetMode: 'actions',
        sheetTitle: (item && item.title) ? String(item.title).slice(0, 20) : '',
      })
    },

    // —— 操作面板事件 ——
    onSheetMaskTap() {
      this.setData({ sheetShow: false })
    },
    // 阻止面板内点击冒泡到蒙层（catchtap 引用）
    noop() {},

    onSheetMarkRead() {
      const t = this._sheetTarget
      if (!t) return
      FU.markRead(t.module, t.id)
      this.setData({ sheetShow: false })
      this._load()
    },

    onSheetTrackTime() {
      this.setData({ sheetMode: 'tracktime' })
    },

    onSheetPickTime(e) {
      const t = this._sheetTarget
      const v = e.currentTarget.dataset.v
      if (!t || !v) return
      FU.setTrackTime(t.module, t.id, v)
      this.setData({ sheetShow: false })
      this._load()
      wx.showToast({ title: '追踪时间 ' + v, icon: 'none' })
      // 追踪时间改后需同步云端（否则定时器按旧 trackTime 触发）
      FU_SYNC.syncModule(t.module)
    },

    onSheetUnfollow() {
      const t = this._sheetTarget
      if (!t) return
      // followUp.removeFollow 单点收口：本地物理移除 + 云端物理删除（内部触发 removeOne）
      FU.removeFollow(t.module, t.id)
      if (this._expanded[t.id]) delete this._expanded[t.id]
      this._sheetTarget = null
      this.setData({ sheetShow: false })
      this._load()
      wx.showToast({ title: '已取消关注', icon: 'none' })
    },

    // owner 2026-09-08 调整：离开关注页（overlay 收起）→ 自动收起全部展开的时间线与操作面板
    _onClosed() {
      this._expanded = {}
      this._sheetTarget = null
      if (this.data.sheetShow || Object.keys(this.data.expanded || {}).length) {
        this.setData({ expanded: {}, sheetShow: false })
      }
    },

    // 全部标为已读（红 → 绿，顶部红点清 0）
    onMarkAllRead() {
      FU.markAllRead()
      this._load()
      wx.showToast({ title: '已全部标为已读', icon: 'none' })
    },

    // 返回：反向圆形收回按压点，再通知宿主隐藏
    goBack() {
      const pt = this._point()
      this.setData({ revealStyle: 'clip-path: circle(0% at ' + pt.x + ' ' + pt.y + '); -webkit-clip-path: circle(0% at ' + pt.x + ' ' + pt.y + ');' })
      const that = this
      // 等待 0.96s 反向收回动画完成后再通知宿主隐藏（与 clip-path transition 时长一致）
      setTimeout(function () {
        if (that._destroyed) return
        that.triggerEvent('back')
      }, 960)
    },

    // ============ 右滑返回手势（BUG-20260828-003） ============
    // 背景：覆盖层无触摸处理时，右滑被微信系统手势拦截 → 栈底首页直接退出小程序。
    // 修复：组件内捕获触摸，右滑（横向为主且位移 > 60px）→ goBack() 返回首页。
    onTouchStart(e) {
      if (!this.data.visible) return
      const t = (e.touches && e.touches[0]) || {}
      this._slideX = t.clientX || 0
      this._slideY = t.clientY || 0
      this._slideT = Date.now()
      this._slideLock = false
    },
    onTouchMove(e) {
      // 仅跟踪，不实时拦截（避免影响列表滚动）
    },
    onTouchEnd(e) {
      if (!this.data.visible || this._slideLock || this._slideX === undefined) return
      const t = (e.changedTouches && e.changedTouches[0]) || {}
      const dx = (t.clientX || 0) - this._slideX
      const dy = (t.clientY || 0) - this._slideY
      const dt = Date.now() - this._slideT
      // 右滑返回：dx>60px 且横向为主且快速（对称于进入关注页的判定）
      if (dx > 60 && Math.abs(dx) > Math.abs(dy) && dt < 800) {
        this._slideLock = true
        const that = this
        setTimeout(function () { that._slideLock = false }, 1000)
        this.goBack()
      }
    },
    onTouchCancel() {
      this._slideLock = false
    },

    // 空态/兜底：回首页
    goHome() {
      wx.reLaunch({ url: '/pages/home/home' })
    },
  },
})
