// INTEL-MODULE: AI 情报官 · 情报详情
// 隔离说明：本文件为新增页面逻辑，独立于 One News 既有业务；命名空间 intel_*。
// 数据说明：调云函数 intelGetDetail 拉真实详情；无数据时展示友好提示，不放 mock。
// owner 2026-08-18 19:45：前端不放任何 mock 数据，空态展示友好提示。
// 融合说明：以 Desktop(intel-officer) 的空态/安全区/真实数据流为骨架，融入 main 的
//           whatHappened 科普多段叙事 + 可以怎么做 + 最小行动 渲染。
const app = getApp()
const { getIntelDetail } = require('../../../utils/intelApi')
const { getSafeBottom } = require('../../../utils/intelRender')

Page({
  data: {
    themeClass: '',
    isDark: false,
    statusBarHeight: 20,
    menuHeight: 32,
    topBarH: 44,           // 顶部条带高度（对齐胶囊 = menuTop），避免内容被原生胶囊遮挡
    showMore: false,
    showTry: false,
    srcName: '',
    pubTime: '',          // 发布时间（取自首页卡片 time，经 intelDetailCard 传入）
    _fontScaleValue: 1,    // 字体缩放（与 One News _applyFontScale 对齐，注入 CSS --font-scale）
    _metaScaleValue: 1,
    // 详情内容（数据驱动，方案A：与所选卡片匹配）
    title: '',
    descText: '',          // 「发生了什么」一句话摘要（definition，兜底）
    whatHappenedText: '',  // 「发生了什么」科普向详细叙事（sop.whatHappened，多段）
    whatHappenedParagraphs: [], // 按换行分段，供多段渲染；有则优先展示，无则回退 descText
    practiceText: '',      // 「可以怎么做」实操案例（sop.practice）
    minActionText: '',     // 「最小行动」（sop.minAction）
    relateItems: [],       // 「落到你这里」身份条目（who / txt）
    relateSkip: '',        // 未命中身份时先跳过的提示
    hasMore: false,        // 是否有真实验证来源
    sourceUrl: '',         // 真实来源链接
    safeBottom: 0,         // 底部安全区（px）：JS 注入 --safe-bottom，规避 env() 真机失效
    loading: true,         // 加载态
    empty: false,          // 空态
  },

  onLoad(query) {
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
    const id = (query && query.id) || ''
    const card = (app.globalData && app.globalData.intelDetailCard) || null

    this.setData({
      themeClass: (app.globalData && app.globalData.themeClass) || 'page--light',
      isDark: this._isSystemDark(),
      statusBarHeight: statusBarHeight,
      menuHeight: menuHeight,
      topBarH: menuTop,
      // 底部安全区（px）：env() 真机失效，JS 计算注入 --safe-bottom
      safeBottom: getSafeBottom(),
      srcName: (card && card.src) || '',
      pubTime: (card && card.time) || '',
      _fontScaleValue: (app.globalData && typeof app.globalData._fontScaleValue === 'number') ? app.globalData._fontScaleValue : 1,
      _metaScaleValue: (app.globalData && typeof app.globalData._metaScaleValue === 'number') ? app.globalData._metaScaleValue : 1,
      title: (card && card.title) || '',
      descText: (card && card.desc) || '',
    })

    // 详情加载优化（2026-08-19）：不等待全量——有 card 基础数据立即渲染（秒开），全量异步补充；缓存命中直接展示
    if (id) {
      const cached = (app.globalData && app.globalData.intelDetailCache && app.globalData.intelDetailCache[id]) || null
      if (cached) {
        this.applyDetail(cached)
      } else if (card && (card.title || card.desc)) {
        // 先用卡片基础数据渲染（标题/来源/一句定义），云函数全量到达后覆盖
        this.setData({ loading: false, empty: false })
        this.loadRealDetail(id)
      } else {
        this.loadRealDetail(id)
      }
    } else {
      this.setData({ loading: false, empty: true })
    }
  },

  /** 拉取真实详情（云函数 intelGetDetail）；无数据/失败时展示空态友好提示
   *  重要：utils/intelApi.getIntelDetail 已走 formatIntelDetail 格式化，
   *        d.definition → d.definitionParas(Array)，d.sceneMapping 保持原字段。
   *        修正后能正确命中真实数据。 */
  /** 应用详情数据（全量渲染 + 写入内存缓存，同一 id 重复进入秒开） */
  applyDetail(d) {
    const app = getApp()
    if (!d || (!d.definitionParas && !d.definition && !d.sceneMapping && !d.title && !d.whatHappened)) {
      console.warn('[intel-detail] 进入空态: d 为空或全字段空')
      this.setData({ loading: false, empty: true })
      return
    }
    // definitionParas 是按换行拆好的段；单段 .prose 整文展示时拼回换行
    const definition = d.definition || (Array.isArray(d.definitionParas) ? d.definitionParas.join('\n\n') : '')
    const relateItems = d.sceneMapping
      ? [{ who: '命中场景' + (d.sceneTags && d.sceneTags.length ? '：' + (d.sceneTags.map(t => (t && t.label) || (typeof t === 'string' ? t : '')).filter(Boolean).join(' / ')) : ''), txt: d.sceneMapping }]
      : []
    this.setData({
      title: d.title || this.data.title,
      descText: d.definition || this.data.descText,
      whatHappenedText: d.whatHappened || d.definition || '',
      whatHappenedParagraphs: String(d.whatHappened || '').split(/\n+\s*/).map(x => x.trim()).filter(Boolean),
      srcName: d.srcName || d.sourceName || this.data.srcName,
      relateItems: relateItems,
      relateSkip: d.sceneMapping ? '' : '这条与你当前场景暂时不沾边，先跳过。',
      hasMore: !!(d.sourceUrl || (d.references && d.references.length)),
      sourceUrl: d.sourceUrl || '',
      practiceText: d.practice || '',
      minActionText: d.minAction || '',
      loading: false,
      empty: false,
    })
    // 内存缓存：同一 id 重复进入直接展示，不再调云函数
    if (d && d.title) {
      if (!app.globalData.intelDetailCache) app.globalData.intelDetailCache = {}
      app.globalData.intelDetailCache[d.id || this.data.id] = d
    }
    console.log('[intel-detail] 真实详情已加载:', d.id || '')
  },

  loadRealDetail(id) {
    console.log('[intel-detail] loadRealDetail 开始, id=', id)
    getIntelDetail(id)
      .then(d => {
        console.log('[intel-detail] 云函数返回 d=', JSON.stringify(d).slice(0, 300))
        this.applyDetail(d)
      })
      .catch(err => {
        console.warn('[intel-detail] 真实详情拉取失败:', err && err.message, err)
        // 有卡片基础数据时保持展示，不因全量失败清空
        if (!(this.data.title || this.data.descText)) {
          this.setData({ loading: false, empty: true })
        }
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

  toggleMore() { this.setData({ showMore: !this.data.showMore }) },
  toggleTry() { this.setData({ showTry: !this.data.showTry }) },

  // 复制参考链接到剪贴板（个人主体 web-view 不可用，复用 One News「复制链接」方案）
  copyLink(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '链接已复制', icon: 'none' }),
      fail: () => wx.showToast({ title: '复制失败', icon: 'none' })
    })
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/home/home' }) })
  }
})
