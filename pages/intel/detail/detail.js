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
const { recordView } = require('../../../utils/intelHistory')

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
    searchPanelTop: '100%',     // 面板 top（展开时注入 px：标题下+呼吸间距）
    searchProgress: false,      // 横线进度条（面板顶上来时从左侧系统蓝加载）
    searchRestUp: false,        // 其余内容推起（面板展开时）
    searchIntoView: '',         // scroll-into-view 锚点（收起时滚到深挖历史）
    searchQuickTitle: '',       // 一键深挖：围绕「当前新闻标题」继续深挖（截断 60 字）
    searchQuery: '',            // 输入框内容
    searchLoading: false,       // 搜索中（60s 超时）
    searchHint: '',             // 不相关 / 搜索失败 hint（当次提示，不累积）
    digGroups: [],              // 深挖历史（同话题折叠）：[{query, open, entries:[{time, sections, sources}]}]
    digLatestSources: [],       // 底部来源折叠块：最新一次深挖的来源（默认折叠）
    digLatestSourcesOpen: false,
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
    // 深挖历史：退出再进保留（本地持久化，按 itemId 隔离）
    this.setData({ digGroups: this._loadDig() })

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
          const blocks = d.whatHappenedBlocks.map(b => ({
            type: (b.type === 'plain' || b.type === 'predict' || b.type === 'def') ? b.type : 'text',
            text: String(b.text || '').replace(/\*\*/g, '').trim(),
          })).filter(b => b.text)
          // 2026-08-21 兜底修复 v2：仅当「AI 预测」误标在**第一段**时降级为正文
          //（LLM 曾把标记放正文开头 → 整段正文被误判）。正常结构「正文+预测(+定义)」中
          // 预测在后面，必须保留预测样式（之前「非最后一段即降级」误伤正常数据）。
          if (blocks.length > 1 && blocks[0].type === 'predict') {
            blocks[0] = { type: 'text', text: blocks[0].text }
          }
          return blocks
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
    // 浏览历史（纯本地 30 天滚动清除，与 One News 一致）：数据就绪后记录
    try {
      recordView({
        id: d.id || this.data.itemId || '',
        title: cleanText(d.title) || this.data.title || '',
        src: d.srcName || d.sourceName || this.data.srcName || '',
        time: d.pubTime || d.publishedAt || this.data.pubTime || '',
        desc: cleanText(d.definition) || this.data.descText || '',
      })
    } catch (e) { /* 浏览记录失败不阻塞 */ }
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
  /** 点击搜索悬浮按钮：展开覆盖面板（其余内容推上去），再点收起（内容落回） */
  onToggleSearch() {
    if (this.data.searchOpen) {
      this._collapseSearch()
      return
    }
    // 展开面板时深挖历史一律默认折叠（用户明确要求）
    const _g = this._loadDig()
    let _folded = false
    _g.forEach(x => { if (x.open) { x.open = false; _folded = true } })
    if (_folded) { this._saveDig(_g); this.setData({ digGroups: _g }) }
    this.setData({ searchRestUp: true })
    // 面板 top = 标题底部 + 呼吸间距（18px）；顶上来时横线进度条从左侧系统蓝加载（动画①）
    setTimeout(() => {
      const q = wx.createSelectorQuery().in(this)
      q.select('.detail-title').boundingClientRect()
      q.exec(res => {
        const r = res && res[0]
        const titleBottom = (r && r.top + r.height) || 0
        this.setData({ searchOpen: true, searchPanelTop: (titleBottom + 18) + 'px' })
        // 与面板 top 0.65s 过渡同步触发进度条
        this.setData({ searchProgress: true })
      })
    }, 60)
  },

  /** 面板内部滚动：记录 scrollTop；滚到顶部时深挖历史自动折叠（需求1） */
  onSearchScroll(e) {
    const st = (e.detail && e.detail.scrollTop) || 0
    this._panelScrollTop = st
    if (st <= 0 && this.data.searchOpen && this.data.digGroups.some(g => g.open)) {
      const groups = this._loadDig()
      groups.forEach(g => { g.open = false })
      this._saveDig(groups)
      this.setData({ digGroups: groups })
    }
  },
  /** 面板触摸：仅当已滚到顶部时继续下滑才收起（避免浏览结果时误收起） */
  onPanelTouchStart(e) {
    const t = e.touches && e.touches[0]
    this._panelTouch = t ? { x: t.clientX, y: t.clientY, moved: false } : null
  },
  onPanelTouchMove(e) {
    if (!this._panelTouch) return
    const t = e.touches && e.touches[0]
    if (!t) return
    const dy = t.clientY - this._panelTouch.y
    const dx = Math.abs(t.clientX - this._panelTouch.x)
    // 下滑且面板已滚到顶部（scrollTop<=0）才收起
    if (this.data.searchOpen && dy > 24 && dy > dx && (this._panelScrollTop || 0) <= 0) {
      if (!this._panelTouch.moved) {
        this._panelTouch.moved = true
        this._collapseSearch()
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

  /** 调 intelSearch：60s 超时；结果累积为详情页一部分（不覆盖），hint 当次提示 */
  _runSearch(query) {
    if (this.data.searchLoading) return
    this.setData({ searchLoading: true, searchHint: '' })
    searchIntelTopic({ itemId: this.data.itemId, query })
      .then(d => {
        // ① 不相关（当次提示条，不影响已有结果）
        if (d && d.relevant === false) {
          this.setData({ searchHint: d.hint || '这个话题和这条新闻关系不大哦，换一个试试～' })
          return
        }
        // ② 相关+成功：优先后端 sections（层级排版），回退前端段落解析；来源折叠展示
        if (d && d.relevant) {
          const sources = Array.isArray(d.sources) ? d.sources.map(x => ({
            title: x.title || x.url || '',
            url: x.url || '',
            source: x.source || '',
          })).filter(x => x.url) : []
          // 后端已结构化：sections [{type:'heading'|'para'|'bullet', text}]
          const hasSections = Array.isArray(d.sections) && d.sections.some(x => x && x.text)
          const sections = hasSections ? d.sections.map(x => ({
            type: (x.type === 'heading' || x.type === 'bullet') ? x.type : 'para',
            text: String(x.text || '').trim(),
          })).filter(x => x.text) : []
          // 无 sections → 前端解析 answer（兼容旧数据 / 非 DeepSeek 路径）
          const parsed = sections.length ? { summary: '', items: [] } : this._parseSearchAnswer(d.answer || '')
          const isFallback = sections.length ? false : (/为你找到以下信息/.test(d.answer || ''))
          const entry = {
            query: query,
            summary: sections.length ? '' : parsed.summary,
            sections: sections,
            items: sections.length ? [] : (isFallback ? [] : parsed.items),
            sources: sources,
            sourcesExpanded: false,
            isFallback: isFallback,
          }
          this._pushDigEntry(query, entry.sections, sources)
          return
        }
        // ③ 相关但失败（当次提示条）
        this.setData({ searchHint: (d && d.hint) || '这个话题联网搜索暂时没找到结果，可以换个更具体的说法再试试～' })
      })
      .catch(err => {
        wx.showToast({ title: (err && err.message) || '搜索失败，请稍后再试', icon: 'none' })
      })
      .then(() => this.setData({ searchLoading: false }))
  },

  /** 清洗 LLM 输出中的 markdown 标记（**加粗**、`代码`、# 标题等），只留纯文本 */
  _cleanMd(v) {
    return String(v || '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')   // **粗体**
      .replace(/\*([^*]+)\*/g, '$1')           // *斜体*
      .replace(/`([^`]+)`/g, '$1')               // `代码`
      .replace(/^#{1,6}\s+/gm, '')              // # 标题
      .replace(/^[-*]\s+/gm, '')                // - 列表
      .replace(/^>\s?/gm, '')                   // 引用
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [文字](链接)
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '') // 去除 emoji
      .trim()
  },

  /** answer 结构化：首行为引导头；每条「标题：内容」拆成 title/body 段落（自然排版，非编号列表） */
  _parseSearchAnswer(answer) {
    const lines = String(answer || '').split(/\n+/).map(x => x.trim()).filter(Boolean)
    if (!lines.length) return { summary: '', items: [] }
    const first = this._cleanMd(lines[0])
    const isHead = !/^\d+[.、]/.test(first) && first.length < 40
    const summary = isHead ? first : ''
    const rest = isHead ? lines.slice(1) : lines
    const items = []
    for (const ln of rest) {
      // 「标题：内容」→ title(加粗行) + body(正文段落)
      const cleanLn = this._cleanMd(ln)
      const m = cleanLn.match(/^(?:\d+[.、]\s*)?(.+?)(?::|：)\s*([\s\S]*)$/)
      if (m && m[1] && m[1].length < 60) {
        items.push({ title: m[1], body: m[2].slice(0, 300) })
      } else {
        // 无冒号分割：整行作为正文段落，合并到上一条 body（无上条则自成一段）
        if (items.length) items[items.length - 1].body += (items[items.length - 1].body ? '\n' : '') + cleanLn.slice(0, 300)
        else items.push({ title: '', body: cleanLn.slice(0, 300) })
      }
    }
    return { summary, items }
  },

  // ============ 深挖历史（同话题折叠 + 本地持久化） ============
  /** 深挖历史存储 key（按 itemId 隔离） */
  _digKey() { return 'intel_dig_history_' + (this.data.itemId || '') },
  _loadDig() {
    try {
      const k = this._digKey()
      const v = wx.getStorageSync(k)
      return Array.isArray(v) ? v : []
    } catch (e) { return [] }
  },
  _saveDig(groups) {
    try { wx.setStorageSync(this._digKey(), groups) } catch (e) {}
  },
  /** 新深挖结果入历史：同话题合并 entries（最新在前），并持久化；同步底部来源块 */
  _pushDigEntry(query, sections, sources) {
    this.setData({
      digLatestSources: Array.isArray(sources) ? sources : [],
      digLatestSourcesOpen: false,
    })
    const now = new Date()
    const time = (now.getHours() < 10 ? '0' + now.getHours() : now.getHours()) + ':' +
      (now.getMinutes() < 10 ? '0' + now.getMinutes() : now.getMinutes())
    const groups = this._loadDig()
    const g = groups.find(x => x.query === query)
    const entry = { time: time, sections: sections, sources: sources }
    if (g) { g.entries.unshift(entry) } else { groups.unshift({ query: query, open: false, entries: [entry] }) }
    // 所有情况下默认折叠（含已展开过的历史话题）
    groups.forEach(x => { x.open = false })
    // 上限保护：最多 10 个话题、每话题 10 次
    while (groups.length > 10) groups.pop()
    groups.forEach(x => { while (x.entries.length > 10) x.entries.pop() })
    this._saveDig(groups)
    this.setData({ digGroups: groups })
  },
  /** 收起搜索面板：内容落回，历史折叠（退出即折叠），滚动到深挖历史区 */
  _collapseSearch() {
    const groups = this._loadDig()
    groups.forEach(g => { g.open = false })
    this._saveDig(groups)
    this.setData({ searchOpen: false, searchPanelTop: '100%', searchRestUp: false, searchProgress: false, digGroups: groups })
    this.setData({ searchIntoView: 'dig-history' })
    setTimeout(() => this.setData({ searchIntoView: '' }), 600)
  },
  /** 展开/收起某个话题的深挖历史：互斥——点开一个，其它自动折叠 */
  onToggleDigGroup(e) {
    const gi = Number(e.currentTarget.dataset.gi)
    const groups = this._loadDig()
    if (!groups[gi]) return
    const willOpen = !groups[gi].open
    groups.forEach((g, i) => { g.open = (i === gi) && willOpen })
    this._saveDig(groups)
    this.setData({ digGroups: groups })
  },

  /** 底部来源折叠块：展开/收起（默认折叠） */
  onToggleLatestSources() {
    this.setData({ digLatestSourcesOpen: !this.data.digLatestSourcesOpen })
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
