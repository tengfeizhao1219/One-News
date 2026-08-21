// INTEL-MODULE: AI 情报官 · 情报详情
// 隔离说明：本文件为新增页面逻辑，独立于 One News 既有业务；命名空间 intel_*。
// 数据说明：调云函数 intelGetDetail 拉真实详情；无数据时展示友好提示，不放 mock。
// owner 2026-08-18 19:45：前端不放任何 mock 数据，空态展示友好提示。
// 融合说明：以 Desktop(intel-officer) 的空态/安全区/真实数据流为骨架，融入 main 的
//           whatHappened 科普多段叙事 + 可以怎么做 + 最小行动 渲染。
const app = getApp()

/** 乱码过滤：清除 U+FFFD（替换符，黑菱形块/问号块）与孤立控制字符 */
function cleanText(v) {
  return String(v || '').replace(/\uFFFD/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
}

/** sceneMapping 结构化解析：按 \n 分行，每行拆 **加粗** 段 → {lines:[{segments:[{text,bold}]}]}
 * （不用 rich-text：微信 rich-text 的 \n 换行渲染不可靠；view+text 完全可控） */
function parseSceneMapping(txt) {
  const text = cleanText(txt)
  const lines = String(text).split('\n').map((line) => {
    const segments = []
    const parts = line.split(/\*\*(.+?)\*\*/g)
    parts.forEach((p, i) => {
      if (!p) return
      if (i % 2 === 1) segments.push({ text: p, bold: true })
      else segments.push({ text: p, bold: false })
    })
    return { segments }
  }).filter((l) => l.segments.length)
  return lines
}
const { getIntelDetail, searchIntelTopic } = require('../../../utils/intelApi')
const { getSafeBottom } = require('../../../utils/intelRender')
const { isFavorited, toggleFavorite } = require('../../../utils/intelFavorites')

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
    whatHappenedBlocks: [],  // 2026-08-20 v5：结构化块 [{type:'text'|'plain'|'predict'|'def', text}]（正文段/大白话/AI预测/定义）
    practiceText: '',      // 「可以怎么做」实操案例（sop.practice）
    minActionText: '',     // 「最小行动」（sop.minAction）
    relateItems: [],       // 「落到你这里」身份条目（who / txt）
    relateSkip: '',        // 未命中身份时先跳过的提示
    hasMore: false,        // 是否有真实验证来源
    sourceUrl: '',         // 真实来源链接
    references: [],        // 参考链接列表（了解更多/试试看 fold）
    processedTime: '',     // 状态条「已完成梳理 · X分钟前」
    safeBottom: 0,         // 底部安全区（px）：JS 注入 --safe-bottom，规避 env() 真机失效
    loading: true,         // 加载态
    empty: false,          // 空态
    // 收藏（2026-08-20：对齐 One News B-04 纯本地，TTL 半年）
    itemId: '',
    isFavorited: false,
    heartAnim: false,
    // 话题搜索（2026-08-21：intelSearch 云函数，三种结果路径）
    searchOpen: false,          // 搜索面板展开态
    searchScrollTop: 0,         // 展开搜索时归顶（保证标题在视口顶部）
    searchPanelTop: '100%',     // 面板 top（展开时注入 px，钉在标题下方+呼吸间距）
    searchQuickTitle: '',       // 一键深挖：围绕「当前新闻标题」继续深挖（截断 60 字）
    searchQuery: '',            // 输入框内容
    searchLoading: false,       // 搜索中（60s 超时）
    searchHint: '',             // 不相关 / 搜索失败 hint
    searchAnswer: '',           // 相关+成功：总结回答（原始）
    searchSummary: '',          // 结构化：引导头（「关于…为你找到以下信息：」）
    searchItems: [],            // 结构化：编号条目 [{n,title,body}]（标题加粗、内容截断）
    searchSources: [],          // 相关+成功：引用来源列表 [{title,url,source}]
    searchSourcesExpanded: false, // 来源折叠态（默认收起，点击展开）
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
  },

  onLoad(query) {

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
      itemId: id,
    })
    if (id) this._checkFavorite(id)

    // 2026-08-21 修复（问题④）：去掉「先卡片摘要后全量覆盖」两段式——
    //   统一等云函数返回完整详情再渲染（期间 loading），避免用户先看到一句话摘要再闪成完整内容。
    if (id) {
      const cached = (app.globalData && app.globalData.intelDetailCache && app.globalData.intelDetailCache[id]) || null
      if (cached) {
        this.applyDetail(cached)
      } else {
        this.loadRealDetail(id)
      }
    } else {
      this.setData({ loading: false, empty: true })
    }
  },

  // 2026-08-20 修复：收藏方法缺失（wxml 已引用 bindtap / onLoad 已调用 _checkFavorite，
  // 但方法定义遗漏 → onLoad 抛 TypeError → 详情页永远卡在"情报官正在梳理详情"）
  _checkFavorite(id) {
    this.setData({ isFavorited: isFavorited(id) })
  },

  onToggleFavorite() {
    const item = {
      id: this.data.itemId || this.data.id || '',
      title: this.data.title || '',
      src: this.data.srcName || '',
      time: this.data.pubTime || '',
      desc: this.data.descText || '',
    }
    const r = toggleFavorite(item)
    this.setData({ isFavorited: r.favorited })
    wx.showToast({
      title: r.favorited ? '已收藏' : '已取消收藏',
      icon: 'none',
      duration: 1200,
    })
  },

  /** 拉取真实详情（云函数 intelGetDetail）；无数据/失败时展示空态友好提示
   *  重要：utils/intelApi.getIntelDetail 已走 formatIntelDetail 格式化，
   *        d.definition → d.definitionParas(Array)，d.sceneMapping 保持原字段。
   *        修正后能正确命中真实数据。 */
  /** 应用详情数据（全量渲染 + 写入内存缓存，同一 id 重复进入秒开） */
  applyDetail(d) {
    const app = getApp()

/** 乱码过滤：清除 U+FFFD（替换符，黑菱形块/问号块）与孤立控制字符 */
function cleanText(v) {
  return String(v || '').replace(/\uFFFD/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
}

/** sceneMapping 结构化解析：按 \n 分行，每行拆 **加粗** 段 → {lines:[{segments:[{text,bold}]}]}
 * （不用 rich-text：微信 rich-text 的 \n 换行渲染不可靠；view+text 完全可控） */
function parseSceneMapping(txt) {
  const text = cleanText(txt)
  const lines = String(text).split('\n').map((line) => {
    const segments = []
    const parts = line.split(/\*\*(.+?)\*\*/g)
    parts.forEach((p, i) => {
      if (!p) return
      if (i % 2 === 1) segments.push({ text: p, bold: true })
      else segments.push({ text: p, bold: false })
    })
    return { segments }
  }).filter((l) => l.segments.length)
  return lines
}
    if (!d || (!d.definitionParas && !d.definition && !d.sceneMapping && !d.title && !d.whatHappened)) {
      console.warn('[intel-detail] 进入空态: d 为空或全字段空')
      this.setData({ loading: false, empty: true })
      return
    }
    // definitionParas 是按换行拆好的段；单段 .prose 整文展示时拼回换行
    const definition = d.definition || (Array.isArray(d.definitionParas) ? d.definitionParas.join('\n\n') : '')
    const relateItems = d.sceneMapping
      ? [{ who: '命中场景' + (d.sceneTags && d.sceneTags.length ? '：' + (d.sceneTags.map(t => (t && t.label) || (typeof t === 'string' ? t : '')).filter(Boolean).join(' / ')) : ''), txt: d.sceneMapping, lines: parseSceneMapping(d.sceneMapping) }]
      : []
    this.setData({
      title: cleanText(d.title) || this.data.title,
      descText: cleanText(d.definition) || this.data.descText,
      whatHappenedText: cleanText(d.whatHappened) || cleanText(d.definition) || '',
      whatHappenedBlocks: (() => {
        // 2026-08-20 v5：优先用后端结构化结果（intelProcess 已解析 whatHappenedBlocks 存 sop）；
        // 旧数据（后端未解析）才走本地兜底解析
        if (Array.isArray(d.whatHappenedBlocks) && d.whatHappenedBlocks.length) {
          return d.whatHappenedBlocks.map(b => ({
            type: (b.type === 'plain' || b.type === 'predict' || b.type === 'def') ? b.type : 'text',
            text: String(b.text || '').replace(/\*\*/g, '').trim(),
          })).filter(b => b.text)
        }
        // 本地兜底解析（对齐后端 structureWhatHappened 逻辑）——2026-08-20 v5
        const raw = String(d.whatHappened || '').trim()
        if (!raw) return []
        // ① 先按标记切分：separator 捕获标记词，内容块在奇偶位
        const SEP_RE = /\*\*\s*(?:（|\(|\s)*(大白话|AI\s*预测|预测|定义|一句话定义|大白话版|用大白话说)(?:\s|）|\)|\*)*\s*\*\*?\s*[:：]?\s*/
        const parts = raw.split(SEP_RE)
        const blocks = []
        const pushText = (txt) => {
          const t = String(txt || '').replace(/\*\*/g, '').trim()
          if (!t) return
          blocks.push({ type: 'text', text: t })
        }
        // ② 开头正文（parts[0]）：按换行拆成多个自然段落
        const head = String(parts[0] || '').trim()
        if (head) {
          const paras = head.split(/\n+\s*/).map(x => x.trim()).filter(Boolean)
          if (paras.length >= 2) paras.forEach(p => pushText(p))
          else pushText(head)
        }
        // ③ 标记块：label → 类型，content → 整块（先截断后续标记，再清星号）
        let idx = 1
        while (idx < parts.length) {
          const label = String(parts[idx] || '').trim()
          let content = String(parts[idx + 1] || '').trim()
          // 内容里若混入后续标记（**对老赵的意义** 等）→ 截断，只保留本块内容
          const cut = content.search(/\*{1,2}(?:对老赵的意义|可以怎么做|想试试|最小行动|场景映射|溯源|发生了什么)\s*\*{0,2}\s*[:：]?/)
          if (cut >= 0) content = content.slice(0, cut).trim()
          content = content.replace(/\*\*/g, '').trim()
          if (content) {
            let type = 'text'
            if (/大白话|用大白话说/.test(label)) type = 'plain'
            else if (/AI\s*预测|预测/.test(label)) type = 'predict'
            else if (/定义/.test(label)) type = 'def'
            blocks.push({ type, text: content })
          }
          idx += 2
        }
        // ④ 无任何标记 → 退回纯段落（按换行/句号兜底分段）
        if (blocks.length <= 1) {
          const byNewline = raw.split(/\n+\s*/).map(x => x.trim().replace(/\*\*/g, '')).filter(Boolean)
          if (byNewline.length >= 2) return byNewline.map(t => ({ type: 'text', text: t }))
          const parts2 = raw.split(/(?<=[。！？；])\s*/).map(x => x.trim()).filter(Boolean)
          const merged = []
          let cur = ''
          for (const p of parts2) {
            cur = (cur ? cur + ' ' : '') + p
            if (cur.length >= 40) { merged.push(cur); cur = '' }
          }
          if (cur) merged.push(cur)
          return (merged.length >= 2 ? merged : [raw]).map(t => ({ type: 'text', text: t }))
        }
        return blocks
      })(),
      srcName: d.srcName || d.sourceName || this.data.srcName,
      relateItems: relateItems,
      relateSkip: d.sceneMapping ? '' : '这条与你当前场景暂时不沾边，先跳过。',
      hasMore: !!(d.sourceUrl || (d.references && d.references.length)),
      sourceUrl: d.sourceUrl || '',
      references: Array.isArray(d.references) ? d.references : [],
      processedTime: d.processedTime || '',
      // 2026-08-21 修复：formatIntelDetail 输出 practiceParas（数组）非 practice；minAction 同名
      practiceText: cleanText(d.practice) || (Array.isArray(d.practiceParas) ? cleanText(d.practiceParas.join('\n')) : ''),
      minActionText: cleanText(d.minAction) || '',
      loading: false,
      empty: false,
      searchQuickTitle: (cleanText(d.title) || this.data.title || '').slice(0, 60),
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

  // ============ 话题搜索（intelSearch） ============
  /** 展开/收起搜索面板：展开时面板升到标题下方（呼吸间距 18px），其余内容推上去 */
  onToggleSearch() {
    if (this.data.searchOpen) {
      this.setData({ searchOpen: false, searchPanelTop: '100%' })
      this._setRestUp(false)
      return
    }
    this._setRestUp(true)
    // 归顶（保证标题在视口顶部）后再量标题底部，确定面板 top
    this.setData({ searchScrollTop: 0 }, () => {
      const q = wx.createSelectorQuery().in(this)
      q.select('.detail-title').boundingClientRect()
      q.exec(res => {
        const r = res && res[0]
        const titleBottom = (r && r.top + r.height) || 0
        this.setData({ searchOpen: true, searchPanelTop: (titleBottom + 18) + 'px' })
      })
    })
  },

  /** 其余内容（rest）推起/落回 */
  _setRestUp(up) {
    this.setData({ searchRestUp: up })
  },

  // ============ 面板下滑手势收起（问题③：搜索区域滑上去后可手动滑下来） ============
  onPanelTouchStart(e) {
    const t = e.touches && e.touches[0]
    this._panelTouch = t ? { x: t.clientX, y: t.clientY, moved: false } : null
  },
  onPanelTouchMove(e) {
    if (!this._panelTouch) return
    const t = e.touches && e.touches[0]
    if (!t) return
    const dy = t.clientY - this._panelTouch.y
    // 下滑超过 24px 即收起（垂直手势为主，忽略横向）
    if (Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(t.clientX - this._panelTouch.x) && this.data.searchOpen) {
      if (!this._panelTouch.moved) {
        this._panelTouch.moved = true
        this.onToggleSearch()
      }
    }
  },
  onPanelTouchEnd() {
    this._panelTouch = null
  },

  /** 一键深挖：围绕当前新闻标题搜索（截断 60 字） */
  onDeepQuick() {
    const query = this.data.searchQuickTitle
    if (!query) {
      wx.showToast({ title: '暂无可搜索话题', icon: 'none' })
      return
    }
    this._runSearch(query)
  },

  onSearchInput(e) {
    this.setData({ searchQuery: (e.detail && e.detail.value) || '' })
  },

  /** 提交搜索（输入框 confirm / 按钮） */
  onSearchSubmit() {
    const query = String(this.data.searchQuery || '').trim()
    if (!query) {
      wx.showToast({ title: '先输入一个话题吧', icon: 'none' })
      return
    }
    this._runSearch(query.slice(0, 60))
  },

  /** 调 intelSearch：60s 超时；渲染三种结果路径 */
  _runSearch(query) {
    if (this.data.searchLoading) return
    this.setData({ searchLoading: true, searchHint: '', searchAnswer: '', searchSources: [] })
    searchIntelTopic({ itemId: this.data.itemId, query })
      .then(d => {
        // ① 不相关
        if (d && d.relevant === false) {
          this.setData({ searchHint: d.hint || '这个话题和这条新闻关系不大哦，换一个试试～' })
          return
        }
        // ② 相关+成功：answer 结构化解析（引导头 + 编号条目），sources 折叠展示
        if (d && d.relevant && d.answer) {
          const parsed = this._parseSearchAnswer(d.answer)
          this.setData({
            searchAnswer: d.answer,
            searchSummary: parsed.summary,
            searchItems: parsed.items,
            searchSourcesExpanded: false,
            searchSources: Array.isArray(d.sources) ? d.sources.map(x => ({
              title: x.title || x.url || '',
              url: x.url || '',
              source: x.source || '',
            })).filter(x => x.url) : [],
          })
          return
        }
        // ③ 相关但失败
        this.setData({ searchHint: (d && d.hint) || '这个话题联网搜索暂时没找到结果，可以换个更具体的说法再试试～' })
      })
      .catch(err => {
        wx.showToast({ title: (err && err.message) || '搜索失败，请稍后再试', icon: 'none' })
      })
      .then(() => this.setData({ searchLoading: false }))
  },

  /** answer 结构化：首行为引导头，后续「N. 标题：内容」拆成编号条目 */
  _parseSearchAnswer(answer) {
    const lines = String(answer || '').split(/\n+/).map(x => x.trim()).filter(Boolean)
    if (!lines.length) return { summary: '', items: [] }
    const first = lines[0]
    const isHead = !/^\d+[.、]/.test(first) && first.length < 40
    const summary = isHead ? first : ''
    const rest = isHead ? lines.slice(1) : lines
    const items = []
    for (const ln of rest) {
      const m = ln.match(/^(\d+)[.、]\s*(.+?)(?::|：)\s*([\s\S]*)$/)
      if (m) {
        items.push({ n: m[1], title: m[2], body: m[3].slice(0, 120) })
      } else {
        const m2 = ln.match(/^(\d+)[.、]\s*([\s\S]+)$/)
        if (m2) items.push({ n: m2[1], title: m2[2].slice(0, 60), body: '' })
        else if (items.length) items[items.length - 1].body += (items[items.length - 1].body ? ' ' : '') + ln.slice(0, 120)
      }
    }
    return { summary, items }
  },

  /** 折叠/展开参考来源 */
  onToggleSources() {
    this.setData({ searchSourcesExpanded: !this.data.searchSourcesExpanded })
  },

  /** 打开来源链接：个人主体无 web-view，复用「复制链接」方案 */
  onOpenSource(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '链接已复制', icon: 'none' }),
      fail: () => wx.showToast({ title: '复制失败', icon: 'none' })
    })
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
