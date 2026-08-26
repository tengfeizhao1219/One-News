// INTEL-MODULE: AI 情报官 · 情报首页
// 隔离说明：本文件为新增页面逻辑，独立于 One News 既有业务；命名空间 intel_*。
// 复用说明：themeClass / isDark 取值方式复刻 One News home 页面，非其业务逻辑。
//
// 数据源：调云函数 getIntelBrief（读 intel_current isCurrent 当期 Brief，
//   Channels 层 OneNewsChannel 渲染），页面元素（设计 §7.6）：
//   今日关注卡片流 + 本周可试用清单 + 「数据截至 HH:MM」+ 源健康提示。
// owner 2026-08-18 19:45 要求：前端不放任何 mock 数据，空态展示友好提示。
const app = getApp()
const { getIntelBrief, getIntelProfile, invalidateIntelBrief } = require('../../../utils/intelRequest')
const { toCards, getSafeBottom, markFocus } = require('../../../utils/intelRender')
const C = require('../../../utils/constants')

Page({
  data: {
    themeClass: '',
    isDark: false,
    statusBarHeight: 20,
    menuHeight: 32,
    topBarH: 44,           // 顶部条带高度（对齐原生胶囊 menuTop），内容从胶囊下方开始
    pageH: 667,            // 页面可用高度（windowHeight px，不含底部手势条；微信 100vh 会把手势条区计入导致底部内容被遮，故用 JS 注入）
    _fontScaleValue: 1,    // 字体缩放（对齐 One News，注入 CSS --font-scale）
    _metaScaleValue: 1,
    // 卡片流：空态展示友好提示，不放 mock
    items: [],
    // 页面元信息：数据截至 / 健康提示 / 空态 / 占位
    meta: {
      dataAsOf: '',       // '数据截至 HH:MM'
      healthTitle: '',    // 源健康提示标题（部分源待验证）
      healthDetail: '',
      empty: false,
      loading: true,
      placeholder: false,
      banner: '',
    },
    // 本周可试用清单（云函数返回后填充）
    tryable: [],
    refreshing: false,       // 下拉刷新中
    // 关注后续：长按进入「我的关注」——按压进度环
    lpRing: false,
    lpX: 0,
    lpY: 0,
  },

  /** 主题跟随兜底：页面重新显示时同步 One News 设置的深浅色（applyTheme 只更新页面栈，onShow 双保险） */
  onShow() {
    const g = app.globalData || {}
    if (g.themeClass && this.data.themeClass !== g.themeClass) {
      this.setData({
        themeClass: g.themeClass,
        isDark: g.effectiveTheme === 'dark'
      })
    }
    // 2026-08-22：回首页时失效 brief 缓存（手动刷新后的新数据立即可见；缓存仍防同页面高频重复请求）
    invalidateIntelBrief()
  },

  onLoad() {

    // 状态栏文字颜色跟随主题：亮色黑/暗色白（One News 页面 onLoad 同款，intel 页此前缺失导致亮色下状态栏白字）
    const _app = getApp()
    if (_app && _app.setNavBarColor) {
      _app.setNavBarColor((_app.globalData && _app.globalData.effectiveTheme) || 'light')
    }
    let statusBarHeight = 20
    let menuHeight = 32
    let menuTop = 44
    try {
      const g = app.globalData
      if (g) {
        if (typeof g.statusBarHeight === 'number') statusBarHeight = g.statusBarHeight
        if (typeof g.menuHeight === 'number') menuHeight = g.menuHeight
        if (typeof g.menuTop === 'number') menuTop = g.menuTop
      }
    } catch (e) {}
    this.setData({
      themeClass: (app.globalData && app.globalData.themeClass) || 'page--light',
      isDark: this._isSystemDark(),
      // 底部安全区（px）：env() 真机失效，JS 计算注入 --safe-bottom
      safeBottom: getSafeBottom(),
      statusBarHeight: statusBarHeight,
      menuHeight: menuHeight,
      topBarH: menuTop, // 顶部条带顶到胶囊顶部，内容区从胶囊下方开始（避开原生胶囊）
      pageH: (C && C.PAGE_HEIGHT) || statusBarHeight + menuTop + menuHeight + 400,
      _fontScaleValue: (app.globalData && typeof app.globalData._fontScaleValue === 'number') ? app.globalData._fontScaleValue : 1,
      _metaScaleValue: (app.globalData && typeof app.globalData._metaScaleValue === 'number') ? app.globalData._metaScaleValue : 1,
    })
    // T5.1 引导闸门：首次进入若无画像 → 先跳 onboard，仅有画像才进入 brief 渲染。
    this._gateOnboard()
  },

  /**
   * 引导闸门：拉一次画像，有画像直接进 brief；首次进入无画像 → 重定向到引导页。
   * 与 _loadBrief 解耦：缺画像时直接 redirect，避免空 brief 干扰首次体验。
   */
  async _gateOnboard() {
    try {
      const profile = await getIntelProfile()
      if (!profile) {
        wx.redirectTo({ url: '/pages/intel/onboard/onboard' })
        return
      }
      // 已有画像：进入原 brief 渲染逻辑
      this._loadBrief()
    } catch (err) {
      console.warn('[intel-home] getIntelProfile 失败，保守进入 brief:', err.message || err)
      // 拉画像失败不阻塞 brief（画像非核心）
      this._loadBrief()
    }
  },

  /**
   * 拉取当期情报 brief → 渲染首页卡片流 + 本周可试用 + 元信息。
   * owner 2026-08-18 19:45：后端未就绪/无当期 → 直接展示空态友好提示，不放 mock。
   */
  /** 下拉刷新：仅重新拉取最新 brief（手动全量管线只在 owner 明确说"手动刷新"时由外部触发 intelManualRun） */
  async onRefresh() {
    if (this.data.refreshing) return
    this.setData({ refreshing: true })
    try {
      await this._loadBrief()
    } catch (e) {
      console.warn('[intel-home] 下拉刷新失败:', tag, (e && e.message) || e)
    } finally {
      this.setData({ refreshing: false })
    }
  },


  async _loadBrief() {
    try {
      const brief = await getIntelBrief()
      if (!brief || !brief.hasContent) {
        // 无内容：直接空态友好提示，不展示 mock
        this.setData({ items: [], 'meta.empty': true, 'meta.loading': false })
        console.log('[intel-home] getIntelBrief 返回空态（后端 brief 未组装）')
        return
      }
      // 真实数据覆盖空态（owner 2026-08-18 19:45：去掉 mock 兜底，占位或无卡直接展示空态）
      const cards = toCards(brief.focusItems)
      const health = brief.health || {}
      const meta = {
        dataAsOf: brief.dataAsOf.label || '',
        healthTitle: health.title || '',
        healthDetail: health.detail || '',
        empty: !brief.hasContent,
        loading: false,
        placeholder: brief.placeholder === true,
        banner: brief.banner || '',
      }
      this.setData({
        items: meta.placeholder ? [] : cards,
        tryable: (brief.tryable || []).map((t) => ({ id: t.id, title: t.title, minAction: t.minAction, done: false })),
        meta,
      })
      // 对你最重要：按画像 focusTags 命中标记（sceneTags ∩ focusTags），命中则浅蓝区展示 focusFor 关联介绍
      if (!meta.placeholder && cards.length) {
        this.applyFocusMark(cards)
      }
    } catch (err) {
      console.warn('[intel-home] 拉取 brief 失败:', err.message || err)
      this.setData({ items: [], 'meta.loading': false, 'meta.empty': true })
    }
  },

  // 复刻 One News _isSystemDark（仅用于 FAB 图标深浅切换，非其业务逻辑）
  _isSystemDark() {
    try {
      const a = getApp()
      if (a && a.globalData && a.globalData.effectiveTheme) {
        return a.globalData.effectiveTheme === 'dark'
      }
      return wx.getSystemInfoSync().theme === 'dark'
    } catch (e) {
      return false
    }
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    // 方案A：把选中卡片的完整数据透传给详情页（经 app.globalData，与 One News detailContext 同模式），
    // 详情页据此渲染匹配的标题/来源角标/正文，避免「点 arXiv 卡却进 Claude 详情」的内容错配。
    var card = null
    var list = this.data.items || []
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { card = list[i]; break }
    }
    app.globalData.intelDetailCard = card || null
    wx.navigateTo({ url: `/pages/intel/detail/detail?id=${id}` })
  },

  // 本周可试用清单勾选（本地暂存，非持久）
  /** 拉取画像并按 focusTags 命中标记"对你最重要"卡片（命中后 setData 更新 focus/focusFor 展示） */
  async applyFocusMark(cards) {
    try {
      const profile = await getIntelProfile()
      const marked = markFocus(cards, profile)
      // 仅当有命中项时更新（避免无谓 setData）
      if (marked.some((it) => it.focus)) {
        this.setData({ items: marked })
      }
    } catch (e) {
      console.warn('[intel-home] 画像命中标记失败:', (e && e.message) || e)
    }
  },

  toggleTryable(e) {
    const id = e.currentTarget.dataset.id
    const tryable = (this.data.tryable || []).map((t) =>
      t.id === id ? { ...t, done: !t.done } : t)
    this.setData({ tryable })
  },

  goMine() {
    wx.navigateTo({ url: '/pages/intel/mine/mine' })
  },

  // 返回 One News 首页（由右滑入口经 navigateTo 进入，故用 navigateBack）
  goBack() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/home/home' }) })
  },

  // ===== 左滑返回手势（INTEL-MODULE）：在 AI 情报首页左滑（dx<0）→ 返回 One News 首页。
  // 与进入方向对称：进入是右滑进入（从左侧滑入），返回是左滑后回到 One News（从右侧滑入回）。
  _slideX: 0,
  _slideY: 0,
  _slideT: 0,
  _slideLock: false,
  onSlideTouchStart(e) {
    this._slideX = e.touches[0].clientX
    this._slideY = e.touches[0].clientY
    this._slideT = Date.now()
    // 关注后续：长按进入「我的关注」（按住不动 500ms；移动/滚动则取消）
    this._startFollowPress(e)
  },
  onSlideTouchMove(e) {
    if (this._touchActive && e.touches && e.touches[0]) {
      var dx = e.touches[0].clientX - (this._slideX || 0)
      var dy = e.touches[0].clientY - (this._slideY || 0)
      if (Math.abs(dx) > 20 || Math.abs(dy) > 20) this._cancelLongPress()
    }
  },
  onSlideTouchEnd(e) {
    if (this._slideX === undefined || this._slideLock) return
    var dx = e.changedTouches[0].clientX - this._slideX
    var dy = e.changedTouches[0].clientY - this._slideY
    var dt = Date.now() - this._slideT
    // 左滑返回：dx<0 且横向为主且快速（对应进入手势的对称阈值 60px）
    if (dx < -60 && Math.abs(dx) > Math.abs(dy) && dt < 800) {
      this._slideLock = true
      var that = this
      setTimeout(function () { that._slideLock = false }, 1000)
      this.goBack()
    }
  },

  // ============ 关注后续：长按进入「我的关注」 ============
  _startFollowPress(e) {
    if (this._destroyed) return
    var t = (e.touches && e.touches[0]) || {}
    this._touchActive = true
    this.setData({
      lpRing: true,
      lpX: t.clientX || 0,
      lpY: t.clientY || 0,
    })
    var that = this
    if (this._lpTimer) clearTimeout(this._lpTimer)
    this._lpTimer = setTimeout(function () { that._enterFollow() }, 500)
  },
  _cancelLongPress() {
    this._touchActive = false
    if (this._lpTimer) { clearTimeout(this._lpTimer); this._lpTimer = null }
    if (this.data.lpRing) this.setData({ lpRing: false })
  },
  _enterFollow() {
    this._touchActive = false
    this._lpTimer = null
    this.setData({ lpRing: false })
    app.globalData.followEnterPoint = { x: this._slideX || 0, y: this._slideY || 0 }
    wx.navigateTo({ url: '/pages/followup/followup' })
  },
})
