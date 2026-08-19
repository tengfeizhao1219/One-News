// INTEL-MODULE: AI 情报官 · 情报首页（内嵌横滑屏，嵌入 One News 首页）
// 说明：原 pages/intel/home 独立页改造为可复用组件，由 One News 首页同屏横滑切换。
//   - 父组件传 active 控制本屏 transform: translateX(-100%/0)，实现「右滑从左侧滑入、左滑从右侧滑回」。
//   - 本组件只负责渲染情报卡片 + 跳转 detail/mine；横滑手势由父组件（One News 首页）统一处理。
//   - detail/mine 仍为独立页，从本组件 navigateTo（纵深跳转，从右滑入，符合直觉）。
// 隔离说明：本组件独立于 One News 既有业务，可随 intel 模块整体摘除。
// owner 2026-08-18 19:45：前端不放任何 mock 数据，空态展示友好提示。
const app = getApp()
const { getIntelBrief, getIntelProfile } = require('../../utils/intelRequest')
const { toCards, markFocus } = require('../../utils/intelRender')

Component({
  properties: {
    // 父组件控制：true=AI 情报屏覆盖显示（translateX 0）；false=藏在屏幕左侧（translateX -100%）
    active: { type: Boolean, value: false },
    // 字体缩放（对齐 One News 字号档位）：由父页面 _syncFontScale 传入，组件 isolated 读不到父级 CSS 变量，
    // 故经 property 实时同步，改动档位后立即生效
    fontScaleValue: { type: Number, value: 1 },
    metaScaleValue: { type: Number, value: 1 },
    // 页面可视高度（windowHeight px）：父页注入，用于锚定覆盖层高度，规避 100vh 在部分 Webview 下高于可视窗口
    pageH: { type: Number, value: 0 }
  },

  data: {
    themeClass: '',
    isDark: false,
    statusBarHeight: 20,
    menuHeight: 32,
    topBarH: 44,           // 顶部条带高度（对齐原生胶囊 menuTop），内容从胶囊下方开始
    stageH: 0,             // 覆盖层锚定高度（windowHeight px）：优先取父页 pageH，父页未传时组件自算兜底
    safeBottom: 0,         // 底部安全区（px）：JS 计算注入 --safe-bottom（env() 真机失效）
    _fontScaleValue: 1,    // 字体缩放（对齐 One News，注入 CSS --font-scale）
    _metaScaleValue: 1,
    // 卡片流：空态展示友好提示，不放 mock
    items: [],
    // 页面元信息
    meta: {
      dataAsOf: '',
      healthTitle: '',
      healthDetail: '',
      empty: false,
      loading: true,
      placeholder: false,
      banner: '',
    },
    tryable: []
  },

  lifetimes: {
    attached() {
      this._applyTheme()
      this._loadBrief()
    }
  },

  observers: {
    // 父页注入 pageH 后同步到 stageH；仅接受正值，避免初始 0 覆盖组件兜底值
    'pageH': function (v) {
      if (typeof v === 'number' && v > 0) this.setData({ stageH: v })
    },
    // 父页面改动字号档位时，同步字体缩放（组件 isolated，父级 CSS 变量穿透不进来，须经 property → data 映射）
    'fontScaleValue, metaScaleValue': function (v, m) {
      this.setData({
        _fontScaleValue: (typeof v === 'number' && v > 0) ? v : 1,
        _metaScaleValue: (typeof m === 'number' && m > 0) ? m : 1
      })
    }
  },

  methods: {
    _applyTheme() {
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
      // 覆盖层锚定高度：优先父页注入 pageH；为 0 时（父页未传/时机未到）组件自算 windowHeight 兜底，
      // 保证 --stage-h 始终为精确 px，绝不回退到 100vh/100%（本应用已知其高于可视窗口）
      let winH = 0
      let safeBottom = 0
      try {
        const win = (typeof wx.getWindowInfo === 'function') ? wx.getWindowInfo() : wx.getSystemInfoSync()
        winH = win.windowHeight || 0
        const safe = win.safeArea || null
        if (safe && winH) {
          const inset = winH - safe.bottom
          if (inset > 0) safeBottom = inset
        }
      } catch (e) {}
      const pageH = this.data.pageH
      this.setData({
        themeClass: (app.globalData && app.globalData.themeClass) || 'page--light',
        isDark: this._isSystemDark(),
        statusBarHeight: statusBarHeight,
        menuHeight: menuHeight,
        topBarH: menuTop, // 顶部条带顶到胶囊顶部，内容区从胶囊下方开始（避开原生胶囊）
        stageH: (typeof pageH === 'number' && pageH > 0) ? pageH : (winH || 0),
        // 底部安全区（px）：env() 真机失效，JS 计算注入 --safe-bottom
        safeBottom: safeBottom,
        _fontScaleValue: (app.globalData && typeof app.globalData._fontScaleValue === 'number') ? app.globalData._fontScaleValue : 1,
        _metaScaleValue: (app.globalData && typeof app.globalData._metaScaleValue === 'number') ? app.globalData._metaScaleValue : 1
      })
    },

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

    /**
     * 拉取当期情报 brief → 渲染卡片流 + 本周可试用 + 元信息。
     * owner 2026-08-18 19:45：后端未就绪/无当期 → 直接展示空态友好提示，不放 mock。
     */
    async _loadBrief() {
      try {
        const brief = await getIntelBrief()
        if (!brief || !brief.hasContent) {
          this.setData({ items: [], 'meta.empty': true, 'meta.loading': false })
          console.log('[intel-stage] getIntelBrief 返回空态')
          return
        }
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
        // 对你最重要：按画像 focusTags 命中标记
        if (!meta.placeholder && cards.length) {
          this.applyFocusMark(cards)
        }
      } catch (err) {
        console.warn('[intel-stage] 拉取 brief 失败:', err.message || err)
        this.setData({ items: [], 'meta.loading': false, 'meta.empty': true })
      }
    },

    goDetail(e) {
      const id = e.currentTarget.dataset.id
      // 方案A：把选中卡片完整数据透传给详情页（经 app.globalData，与 One News detailContext 同模式）
      var card = null
      var list = this.data.items || []
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) { card = list[i]; break }
      }
      app.globalData.intelDetailCard = card || null
      // 标记「从内嵌情报屏跳详情」，父组件 onShow 据此恢复情报屏显示
      app.globalData.intelFromEmbed = true
      wx.navigateTo({ url: `/pages/intel/detail/detail?id=${id}` })
    },

    goMine() {
      wx.navigateTo({ url: '/pages/intel/mine/mine' })
    },

    // 通知父组件：请求滑回 One News（由父置 active=false）
    /** 本周可试用清单勾选（与 pages/intel/home 一致） */
    /** 拉取画像并按 focusTags 命中标记"对你最重要"卡片 */
    async applyFocusMark(cards) {
      try {
        const profile = await getIntelProfile()
        const marked = markFocus(cards, profile)
        if (marked.some((it) => it.focus)) {
          this.setData({ items: marked })
        }
      } catch (e) {
        console.warn('[intel-stage] 画像命中标记失败:', (e && e.message) || e)
      }
    },

    toggleTryable(e) {
      const id = e.currentTarget.dataset.id
      const tryable = (this.data.tryable || []).map((t) =>
        t.id === id ? Object.assign({}, t, { done: !t.done }) : t)
      this.setData({ tryable })
    },

    reqBack() {
      this.triggerEvent('reqback', {}, { bubbles: false, composed: false })
    }
  }
})
