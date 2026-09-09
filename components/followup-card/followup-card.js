// 我的关注 — 覆盖层组件（纯圆形绽放 overlay）
// 由首页/情报官首页长按挂载，visible + enterPoint 驱动 clip-path 从按压点 0%→150% 绽放。
// 不依赖 wx.navigateTo，故无系统右滑转场——真正从手指位置「炸开」。

const FU = require('../../utils/followUp')
const FU_SYNC = require('../../utils/followUpSync')
const TRACK_TIMES = ['08:00', '12:00', '18:00', '21:00']

// —— fc-intro 话题摘要「可展开」判定（2026-09-08 方案C）——
// 估算渲染宽度(rpx)：卡片内宽 = 750 - 卡片外边距32*2 - 卡片内边距32*2 = 622rpx；
// 字号 25rpx：CJK/全角≈1em(25rpx)，ASCII/半角≈0.52em(13rpx)，空白≈6rpx。
// 3 行容量按 CSS 实际换行算：每行最多 floor(622/25)=24 个全角字 → 3 行 = 72 字 = 1800rpx；
// 估算宽度超过该容量才给行尾加「▾」展开箭头——3 行截断由 CSS max-height:120rpx 负责。
const INTRO_INNER_W = 750 - 32 * 2 - 32 * 2 // = 622rpx
const INTRO_3LINE_CAP = Math.floor(INTRO_INNER_W / 25) * 25 * 3 // 每行24全角字 × 3 行 = 1800rpx
function introTextWidth(text) {
  const s = String(text || '')
  let w = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 10 || c === 13 || c === 32 || c === 9) w += 6
    else if (c > 255 || (c >= 0xff01 && c <= 0xff60) || c === 0x3000) w += 25
    else w += 13
  }
  return w
}
function needIntroExpand(text) {
  return introTextWidth(text) > INTRO_3LINE_CAP
}
// 折叠态截断文本（owner 2026-09-09 定稿：圆形箭头按钮是末行末尾的流内元素，不盖在文字上）——
// 预算 = 3 行容量(1800) − 按钮+边距(36+8) − 省略号(25) − 安全余量(40，抵消估宽误差防按钮换行被裁)。
// 截断后补「…」，按钮内联跟在其后，天然落在第 3 行内；卡片不再用 max-height 裁切。
const INTRO_FOLD_BUDGET = INTRO_3LINE_CAP - 44 - 25 - 40
function introFoldText(text) {
  const s = String(text || '')
  if (introTextWidth(s) <= INTRO_FOLD_BUDGET) return s
  let w = 0
  let cut = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const cw = (c === 10 || c === 13 || c === 32 || c === 9) ? 6
      : (c > 255 || (c >= 0xff01 && c <= 0xff60) || c === 0x3000) ? 25 : 13
    if (w + cw > INTRO_FOLD_BUDGET) break
    w += cw
    cut = i + 1
  }
  return s.slice(0, cut).replace(/\s+$/, '') + '…'
}

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
    expanded: {},              // 时间线展开态（卡片点击）
    introExpanded: {},         // 话题摘要展开态（2026-09-08 方案C：点摘要本体展开/收起）
    // 初始即收为 0%，避免挂载瞬间闪现覆盖首页
    revealStyle: 'clip-path: circle(0% at 50% 50%); -webkit-clip-path: circle(0% at 50% 50%);',
    // 长按操作面板（owner 2026-09-08：自定义底部面板——无系统「取消」按钮，点蒙层关闭）
    sheetShow: false,
    sheetMode: 'actions',     // actions=操作菜单 | tracktime=改追踪时间
    trackTimeOptions: TRACK_TIMES,
  },

  lifetimes: {
    attached() {
      this._expanded = {}
      this._introExpanded = {}   // 2026-09-08 方案C：摘要展开态实例副本（_load 时同步进 data.introExpanded）
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
        needIntroExpand: needIntroExpand(item.knownSummary), // 2026-09-08 方案C：摘要超 3 行才给「展开」入口
        introFoldedText: needIntroExpand(item.knownSummary) ? introFoldText(item.knownSummary) : '', // 2026-09-09：折叠态按估宽截断+…，按钮内联跟在末尾
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
        introExpanded: Object.assign({}, this._introExpanded), // 2026-09-08 方案C
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
      // owner 2026-09-09：打开时重算主题并刷新底部 logo 深浅底——logo 是组件、只快照一次，
      // 中途切主题（设置页手动/跟随系统变更）后快照会过期 → 深色下仍显示浅色 logo。
      // 直接把 logo 的 dark prop 绑定到本组件已知主题(isDark)，打开时重算，确定性切换；
      // 再补 refreshTheme() 双保险（对齐 about/favorites/history 的 onShow 模式）。
      try {
        var a0 = getApp()
        this.setData({ isDark: !!(a0.globalData && a0.globalData.effectiveTheme === 'dark') })
      } catch (e0) { /* 忽略 */ }
      this.refreshLogoTheme()
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

    // 2026-09-08 方案C：点击摘要本体展开/收起全文（无独立标签，行尾箭头示意）。
    //  - needIntroExpand（摘要超 3 行）：仅切换摘要展开态（catchtap，不触发卡片时间线）；
    //  - 未超 3 行：等同卡片点击（展开时间线 + 标已读），与原交互保持一致。
    onIntroTap(e) {
      const id = e.currentTarget.dataset.id
      const module = e.currentTarget.dataset.module
      if (!id) return
      const expandable = e.currentTarget.dataset.expandable === true || e.currentTarget.dataset.expandable === 'true'
      if (!expandable) {
        const willExpand = !this._expanded[id]
        if (willExpand) this._expanded[id] = true
        else delete this._expanded[id]
        if (willExpand) FU.markRead(module, id)
        this._load()
        return
      }
      if (this._introExpanded[id]) delete this._introExpanded[id]
      else this._introExpanded[id] = true
      this._load()
    },

    // 长按卡片：打开自定义操作面板（owner 2026-09-08：
    // ①去掉系统弹窗底部的「取消」按钮——换自定义面板，点蒙层关闭；
    // ②「立即检索」下线——检索只能走每日定时档）
    onItemLongPress(e) {
      const id = e.currentTarget.dataset.id
      const module = e.currentTarget.dataset.module
      this._sheetTarget = { module: module, id: id }
      this.setData({
        sheetShow: true,
        sheetMode: 'actions',
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
      if (this._introExpanded[t.id]) delete this._introExpanded[t.id]
      this._sheetTarget = null
      this.setData({ sheetShow: false })
      this._load()
      wx.showToast({ title: '已取消关注', icon: 'none' })
    },

    // owner 2026-09-08 调整：离开关注页（overlay 收起）→ 自动收起全部展开的时间线与操作面板
    _onClosed() {
      this._expanded = {}
      this._introExpanded = {}   // 2026-09-08 方案C：摘要展开态一并复位
      this._sheetTarget = null
      if (this.data.sheetShow || Object.keys(this.data.expanded || {}).length || Object.keys(this.data.introExpanded || {}).length) {
        this.setData({ expanded: {}, introExpanded: {}, sheetShow: false })
      }
    },

    // 全部标为已读（红 → 绿，顶部红点清 0）
    onMarkAllRead() {
      FU.markAllRead()
      this._load()
      wx.showToast({ title: '已全部标为已读', icon: 'none' })
    },

    // owner 2026-09-09：刷新底部 logo 深浅底快照——logo 组件只在 attach 时读一次
    // app.globalData.effectiveTheme，中途切主题（设置页手动切换/跟随系统变更）后快照过期，
    // 深色模式下仍显示浅色 logo。打开/重载时调 refreshTheme() 重读；宿主页 onShow 也可直接调本方法。
    refreshLogoTheme() {
      try {
        const lg = this.selectComponent('#fu-logo')
        if (lg && lg.refreshTheme) lg.refreshTheme()
      } catch (e) { /* 静默：logo 未挂载时跳过（attach 时机主题本就正确） */ }
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
