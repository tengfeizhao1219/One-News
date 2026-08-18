// INTEL-MODULE: AI 情报官 · 情报详情
// 隔离说明：本文件为新增页面逻辑，独立于 One News 既有业务；命名空间 intel_*。
// 演示数据（占位）：claude1m 为真实调研示例；其余 id 显示占位，待后端处理层下发。
const app = getApp()

Page({
  data: {
    themeClass: '',
    isDark: false,
    statusBarHeight: 20,
    menuHeight: 32,
    topBarH: 44,           // 顶部条带高度（对齐胶囊 = menuTop），避免内容被原生胶囊遮挡
    showMore: false,
    showTry: false,
    srcName: 'Anthropic',
    _fontScaleValue: 1,    // 字体缩放（与 One News _applyFontScale 对齐，注入 CSS --font-scale）
    _metaScaleValue: 1,
    // 详情内容（数据驱动，方案A：与所选卡片匹配）
    title: '',
    descText: '',          // 非 claude 卡片「发生了什么」正文（取其原文 desc）
    relateItems: [],       // 「落到你这里」身份条目（who / txt）
    relateSkip: '',        // 未命中身份时先跳过的提示
    hasMore: false,        // 是否有真实验证来源
    fullDetail: false,     // 是否完整叙事（claude1m 专属演示）；否则为降级占位
  },

  onLoad(query) {
    let statusBarHeight = 20
    let menuHeight = 32
    let menuTop = 44
    try {
      const g = app.globalData
      if (g) {
        // 对齐 One News：menuTop=胶囊顶部，menuHeight=胶囊高度（见 app.js onLaunch 注入）
        if (typeof g.statusBarHeight === 'number') statusBarHeight = g.statusBarHeight
        if (typeof g.menuHeight === 'number') menuHeight = g.menuHeight
        if (typeof g.menuTop === 'number') menuTop = g.menuTop
      }
    } catch (e) {}
    const id = (query && query.id) || ''
    const card = (app.globalData && app.globalData.intelDetailCard) || null
    const srcName = (card && card.src) || (id === 'claude1m' ? 'Anthropic' : 'AI 情报官')

    // claude1m 为真实调研演示，保留完整叙事；其余卡片为降级占位（标题/来源/正文与所选卡片匹配）
    const isFull = id === 'claude1m'
    this.setData({
      themeClass: (app.globalData && app.globalData.themeClass) || 'page--light',
      isDark: this._isSystemDark(),
      statusBarHeight: statusBarHeight,
      menuHeight: menuHeight,
      topBarH: menuTop, // 顶部条带顶到胶囊顶部，内容区从胶囊下方开始
      srcName: srcName,
      _fontScaleValue: (app.globalData && typeof app.globalData._fontScaleValue === 'number') ? app.globalData._fontScaleValue : 1,
      _metaScaleValue: (app.globalData && typeof app.globalData._metaScaleValue === 'number') ? app.globalData._metaScaleValue : 1,
      title: isFull
        ? 'Claude 100 万 token 上下文正式可用：你那份 80 页尽调报告，终于可以整本丢进去比差异了'
        : (card && card.title) || '情报详情',
      descText: (card && card.desc) || '', // 非 claude：正文取其原文要点
      fullDetail: isFull,
    })

    if (isFull) {
      this._buildFullDetail()
    } else if (card) {
      this._buildPlaceholderDetail(card)
    } else {
      // 兜底（无卡片数据进来）
      this.setData({ relateItems: [{ who: '工作', txt: '该情报点的详情内容尚未生成，待后端处理层就绪后自动填充。' }] })
    }
  },

  // claude1m：完整叙事（真实调研内容）
  _buildFullDetail(card) {
    this.setData({
      relateItems: [
        {
          who: '工 · 尽调 / 合同',
          txt: '你上周还在吐槽把 80 页尽调报告拆成 5 段、前后对不齐。现在可以整本上传，直接问「与上轮版本相比，第 3 条责任上限改了什么」——而长文档检索准确率（78.3%）正是这件事成立的前提。'
        },
        {
          who: '产 · 客服知识库',
          txt: '你们 300 页客服知识库此前靠 RAG 检索，长尾问题常丢内容。可评估改为「全量直喂 + 精准问答」，预计能覆盖原先检索不到的跨页关联；配合下方的缓存策略，反复追问成本可控。'
        }
      ],
      relateSkip: '家庭侧：这条偏工程 / 工作侧，与你家庭场景暂时不沾边，先跳过。',
      hasMore: true,
    })
  },

  // 非 claude 卡片：降级占位，标题/来源/正文与所选卡片匹配，不硬编 Claude 内容
  _buildPlaceholderDetail(card) {
    this.setData({
      relateItems: [
        {
          who: '工作',
          txt: '这条情报的「落到你这里」拆解，将在后端情报处理层完成画像匹配后生成。当前展示的是来自 ' + (card.src || '情报源') + ' 的原文要点，供先预览。'
        }
      ],
      relateSkip: '',
      hasMore: false,
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
