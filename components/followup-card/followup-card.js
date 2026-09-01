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
      let summaryMuted = false
      if (latest) {
        latestDate = latest.date
        latestSummary = latest.summary
      } else {
        // 无更新：展示「已检索但无新进展」提示（对齐 demo 灰态文案）
        summaryMuted = true
        latestSummary = '今天 ' + (item.trackTime || '12:00') + ' 已检索，暂无新的公开进展，已为你持续关注。'
      }

      return Object.assign({}, item, {
        unreadCount: unreadCount,
        status: status,
        statusText: status === 'hasUpdate'
          ? (unreadCount + ' 条新更新')
          : (status === 'read' ? '已读完' : '已是最新'),
        followDays: followDays,
        latestDate: latestDate,
        latestSummary: latestSummary,
        summaryMuted: summaryMuted,
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
