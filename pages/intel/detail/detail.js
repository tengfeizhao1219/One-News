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


const { getIntelDetail, searchIntelTopic } = require('../../../utils/intelApi')
const { getIntelProfile } = require('../../../utils/intelRequest')
const { getSafeBottom } = require('../../../utils/intelRender')
const { isFavorited, toggleFavorite } = require('../../../utils/intelFavorites')
const { recordView } = require('../../../utils/intelHistory')
// 「关注后续」关注关系本地存储（情报官 module='intel'，对齐 One News detail）
const followUp = require('../../../utils/followUp')

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
    // 关注后续：长按关注
    isFollowed: false,
    // 话题搜索（2026-08-21：intelSearch 云函数，三种结果路径）
    searchOpen: false,          // 搜索面板展开态
    searchPanelTop: '100%',     // 面板 top（展开时注入 px：标题下+呼吸间距）
    searchProgress: false,      // 横线进度条（面板顶上来时从左侧系统蓝加载）
    searchQueried: false,       // 已搜索过：搜索词以提示词灰显示，聚焦时清空可直接输入新词
    searchPanelClientHeight: 0, // 面板可视高度（px）
    searchPanelContentHeight: 0, // 面板内容总高（px）——内容不足一屏时禁止滑动收起（bug3）
    searchRestUp: false,        // 其余内容推起（面板展开时）
    searchIntoView: '',         // scroll-into-view 锚点（收起时滚到深挖历史）
    digScrollTo: '',            // scroll-into-view 锚点（展开某分组时该主题置顶）
    searchQuickTitle: '',       // 一键深挖：围绕「当前新闻标题」继续深挖（截断 60 字）
    searchQuery: '',            // 输入框内容
    searchLoading: false,       // 搜索中（60s 超时）
    searchHint: '',             // 不相关 / 搜索失败 hint（当次提示，不累积）
    relatedQuestions: [],       // 2026-08-22：不相关时后端推荐的搜索问题（点击直接搜索，对齐 One News）
    digGroups: [],              // 深挖历史（同话题折叠）：[{query, open, entries:[{time, sections, sources}]}]
    progressPercent: 0,         // 2026-08-24：顶部阅读进度条（对齐 One News）——正文滚动百分比
    progressTop: 0,             // 2026-08-24：进度条 top(px)——动态测量 .nav 底部(顶部状态区域底)

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

  /** 分享给朋友(2026-08-27):标题=情报标题;不传 imageUrl → 微信默认用页面截图(展示情报摘要内容)作缩略图 */
  onShareAppMessage() {
    return {
      title: this.data.title || 'AI 情报官',
      path: '/pages/intel/detail/detail?id=' + (this.data.itemId || ''),
    }
  },

  /** 分享到朋友圈(2026-08-27) */
  onShareTimeline() {
    return {
      title: this.data.title || 'AI 情报官',
      query: 'id=' + (this.data.itemId || ''),
    }
  },

  /** 页面就绪：测量 .nav 底部 → 进度条 top（精确对齐顶部状态区域底 / 内容区上方） */
  onReady() {
    var that = this
    wx.createSelectorQuery().in(this).select('.nav').boundingClientRect().exec(function (res) {
      if (res && res[0] && res[0].bottom > 0) that.setData({ progressTop: res[0].bottom })
    })
  },

  /** 顶部阅读进度条（2026-08-24 对齐 One News detail）：正文滚动百分比——节流 setData 防卡顿 */
  onContentScroll(e) {
    var st = e.detail.scrollTop
    this._lastScrollTop = st
    // 关注后续：长按期间若内容滚动（用户移动/滑动），取消长按计时
    if (this._touchActive && Math.abs(st - (this._lpStartScrollTop || 0)) > 12) {
      this._cancelLongPress()
    }
    var sh = e.detail.scrollHeight
    if (!this._clientHeight) this._measureContentHeight()
    var max = sh - (this._clientHeight || 500)
    var pct = max > 0 ? Math.min(100, parseFloat((st / max * 100).toFixed(1))) : 0
    // 2026-08-26：bindscroll 高频触发 → 仅当进度值变化且距上次>60ms 才 setData,避免每帧重渲染卡死模拟器
    var now = Date.now()
    if (pct !== this._lastPct && (!this._pctTs || now - this._pctTs > 60)) {
      this._lastPct = pct
      this._pctTs = now
      this.setData({ progressPercent: pct })
    }
  },
  _measureContentHeight() {
    var that = this
    wx.createSelectorQuery().in(this).select('.content').boundingClientRect().exec(function (res) {
      if (res && res[0] && res[0].height > 0) that._clientHeight = res[0].height
    })
  },

  /** 离开页面（返回首页/切后台等）：搜索区/结果自动折叠（bug4：再进不保持展开） */
  onHide() {
    this._foldAllDig(true)
  },

  /** 2026-08-22：页面销毁（物理返回键/系统返回手势/关闭）时也折叠——onHide 不覆盖销毁场景 */
  onUnload() {
    this._foldAllDig(true)
  },

  /** 折叠所有深挖历史分组并持久化（可选项收起面板） */
  _foldAllDig(alsoCollapsePanel) {
    const groups = this._loadDig()
    let changed = false
    groups.forEach(g => { if (g.open) { g.open = false; changed = true } })
    if (changed) {
      this._saveDig(groups)
      this.setData({ digGroups: groups })
    }
    if (alsoCollapsePanel && this.data.searchOpen) {
      this.setData({ searchOpen: false, searchPanelTop: '100%', searchRestUp: false, searchProgress: false })
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
    if (id) this._checkFollow(id) // 关注后续：加载即同步常驻小标
    // 深挖历史：退出再进保留（本地持久化，按 itemId 隔离）
    this.setData({ digGroups: this._loadDig() })

    // 2026-08-22 优化：卡片透传完整数据（sop 已随 brief 下发）→ 本地渲染秒开，免云函数等待。
    //   云函数 intelGetDetail 仅作兜底（数据缺失时）。
    if (id) {
      const cached = (app.globalData && app.globalData.intelDetailCache && app.globalData.intelDetailCache[id]) || null
      if (cached) {
        this.applyDetail(cached)
      } else if (card && card.sop && card.sop.whatHappened) {
        // 首页已带完整详情（sop）→ 本地渲染，零等待；云函数兜底不必要
        this._renderFromCard(card, id)
      } else {
        this.loadRealDetail(id)
      }
    } else {
      this.setData({ loading: false, empty: true })
    }
  },

  /** 2026-08-22：从首页透传的 card.sop 本地渲染详情（秒开，免云函数调用） */
  _renderFromCard(card, id) {
    const sop = card.sop || {}
    const d = {
      id: id || card.id || '',
      title: card.title || '',
      url: card.url || '',
      srcName: card.sourceName || card.src || '',
      sourceUrl: card.url || '',
      publishedAt: card.publishedAt || '',
      definition: sop.definition || card.desc || '',
      whatHappened: sop.whatHappened || '',
      whatHappenedBlocks: Array.isArray(sop.whatHappenedBlocks) ? sop.whatHappenedBlocks : [],
      sceneMapping: sop.sceneMapping || '',
      sceneTags: Array.isArray(card.sceneTags) ? card.sceneTags.map(t => (typeof t === 'object' ? t.key || t.label : t)) : [],
      relevance: card.relevance || 'medium',
      minAction: sop.minAction || '',
      references: Array.isArray(card.references) ? card.references : [],
      practice: sop.practice || '',
      tryable: card.tryable === true,
      research: { status: 'todo' },
      processedAt: card.time || '',
      modelUsed: '',
      cost: 0,
    }
    this.applyDetail(d)
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

  // ============ 关注后续：长按关注（纯本地，对齐收藏） ============

  /** 检查当前情报是否已关注（从 localCache 读取），同步常驻小标 */
  _checkFollow(id) {
    if (!id) return
    try {
      const followed = followUp.isFollowed('intel', id)
      this.setData({ isFollowed: followed })
    } catch (e) {
      this.setData({ isFollowed: false })
    }
  },

  /** 开启长按关注计时：记录按压点，500ms 后触发（已关注也继续 → 走取消） */
  _startFollowPress(e) {
    if (this._destroyed) return
    const t = (e.touches && e.touches[0]) || {}
    this._touchActive = true
    this._lpStartScrollTop = this._lastScrollTop || 0
    const that = this
    if (this._lpTimer) clearTimeout(this._lpTimer)
    this._lpTimer = setTimeout(function () { that._fireFollow() }, 500)
  },

  /** 取消长按计时（滚动/移动/松手时调用） */
  _cancelLongPress() {
    this._touchActive = false
    if (this._lpTimer) {
      clearTimeout(this._lpTimer)
      this._lpTimer = null
    }
  },

  /** 触发：已关注则走取消关注，否则关注（写入关注关系 + meta 行末尾铃铛 icon） */
  _fireFollow() {
    this._touchActive = false
    this._lpTimer = null
    if (this.data.isFollowed) { this._fireUnfollow(); return }
    const id = this.data.itemId || this.data.id || ''
    if (!id) return
    const res = followUp.addFollow('intel', {
      itemId: id,
      title: this.data.title || '',
      source: this.data.srcName || '',
      category: '',
      categoryName: this.data.srcName || '',
      picUrl: '',
    })
    if (res.full) {
      wx.showToast({ title: '关注已达上限，请先清理', icon: 'none' })
      return
    }
    this.setData({ isFollowed: true })
    wx.showToast({ title: '已关注，将为你追踪后续', icon: 'none', duration: 1500 })
  },

  /** 取消关注：直接移除关注关系，隐藏 meta 行末尾铃铛 icon */
  _fireUnfollow() {
    const id = this.data.itemId || this.data.id || ''
    if (!id) return
    followUp.removeFollow('intel', id)
    this.setData({ isFollowed: false })
    wx.showToast({ title: '已取消关注', icon: 'none', duration: 1500 })
  },

  /** 长按手势：touchstart 起计时 */
  onTouchStart(e) {
    this._startFollowPress(e)
  },

  /** 长按手势：touchend 清除计时 */
  onTouchEnd() {
    this._cancelLongPress()
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


    if (!d || (!d.definitionParas && !d.definition && !d.sceneMapping && !d.title && !d.whatHappened)) {
      console.warn('[intel-detail] 进入空态: d 为空或全字段空')
      this.setData({ loading: false, empty: true })
      return
    }
    // definitionParas 是按换行拆好的段；单段 .prose 整文展示时拼回换行
    const definition = d.definition || (Array.isArray(d.definitionParas) ? d.definitionParas.join('\n\n') : '')
    // 2026-08-21 方案A：落到你这里用后端结构化 lines（segments+bold，LLM 直接输出），
    // 不再本地正则解析 **加粗**；旧数据无 lines 时回退字符串 sceneMapping（按行拆分兜底）
    const relateItems = (d.sceneMapping || (d.sceneMappingLines && d.sceneMappingLines.length))
      ? [{
          who: '命中场景' + (d.sceneTags && d.sceneTags.length ? '：' + (d.sceneTags.map(t => (t && t.label) || (typeof t === 'string' ? t : '')).filter(Boolean).join(' / ')) : ''),
          txt: d.sceneMapping || '',
          lines: (d.sceneMappingLines && d.sceneMappingLines.length)
            ? d.sceneMappingLines
            : String(d.sceneMapping || '').split('\n').map(line => ({ segments: [{ text: line, bold: false }] })).filter(l => l.segments[0].text),
        }]
      : []
    this.setData({
      title: cleanText(d.title) || this.data.title,
      descText: cleanText(d.definition) || this.data.descText,
      whatHappenedText: cleanText(d.whatHappened) || cleanText(d.definition) || '',
      whatHappenedBlocks: (() => {
        // 2026-08-21 方案A：后端 LLM 直接输出结构化块（text/predict/def 类型），前端只做清洗；
        // 大白话（plain）不再展示（首页摘要已覆盖）；无 blocks 时按空行切 text 段落兜底
        if (Array.isArray(d.whatHappenedBlocks) && d.whatHappenedBlocks.length) {
          const blocks = d.whatHappenedBlocks
            .filter(b => b.type !== 'plain')
            .map(b => ({
              type: (b.type === 'predict' || b.type === 'def') ? b.type : 'text',
              text: String(b.text || '').replace(/\*\*/g, '').trim(),
            })).filter(b => b.text)
          // 兜底：仅当「AI 预测」误标在第一段时降级为正文
          if (blocks.length > 1 && blocks[0].type === 'predict') {
            blocks[0] = { type: 'text', text: blocks[0].text }
          }
          return blocks
        }
        const raw = String(d.whatHappened || '').trim()
        if (!raw) return []
        const paras = raw.split(/\n{2,}/).map(x => x.replace(/\*\*/g, '').trim()).filter(Boolean)
        return paras.length ? paras.map(p => ({ type: 'text', text: p })) : [{ type: 'text', text: raw }]
      })(),
      srcName: d.srcName || d.sourceName || this.data.srcName,
      relateItems: relateItems,
      relateSkip: (d.sceneMapping || (d.sceneMappingLines && d.sceneMappingLines.length)) ? '' : '这条与你当前场景暂时不沾边，先跳过。',
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
    // 详情未就绪（loading/empty）时标题未渲染，无法定位面板——先提示等待（bug：首次进入顶到屏幕最上方）
    if (this.data.loading || this.data.empty) {
      wx.showToast({ title: '详情加载中，请稍后再试', icon: 'none' })
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
      // 2026-08-22：改测 .title-block 底部（标题+meta 整体钉顶），面板贴在 meta 下方不遮挡
      q.select('.title-block').boundingClientRect()
      q.select('.nav').boundingClientRect()
      q.exec(res => {
        const rTitle = res && res[0]
        const rNav = res && res[1]
        // 兜底：标题量不到（未渲染/动画中）时用 nav 底部 + 标题估算高度（44rpx padding + 40rpx 标题 ×2 行）
        const navBottom = (rNav && rNav.top + rNav.height) || 0
        const titleBottom = (rTitle && rTitle.top + rTitle.height) ||
          (navBottom + Math.round(84 * (this.data._fontScaleValue || 1)))
        const top = Math.max(titleBottom, navBottom) + 18
        this.setData({ searchOpen: true, searchPanelTop: top + 'px' })
        // 与面板 top 0.65s 过渡同步触发进度条
        this.setData({ searchProgress: true })
        this._measureSearchPanel()
      })
    }, 60)
  },

  /** 测量面板可视高/内容高（bug3：内容不足一屏时禁止滑动收起） */
  _measureSearchPanel() {
    setTimeout(() => {
      const q = wx.createSelectorQuery().in(this)
      q.select('#search-area').boundingClientRect()
      q.select('.search-panel-inner').boundingClientRect()
      q.exec(res => {
        const area = res && res[0]
        const inner = res && res[1]
        if (area && inner) {
          this.setData({
            searchPanelClientHeight: area.height || 0,
            searchPanelContentHeight: inner.height || 0,
          })
        }
      })
    }, 100)
  },

  /** 面板内部滚动：记录 scrollTop/可滚空间；滚到顶部且内容超出时折叠历史（bug3：内容不足一屏不折叠） */
  onSearchScroll(e) {
    const st = (e.detail && e.detail.scrollTop) || 0
    this._panelScrollTop = st
    const sc = this.data.searchPanelContentHeight || 0
    const cl = this.data.searchPanelClientHeight || 0
    const overflows = sc > cl
    if (overflows && st <= 0 && this.data.searchOpen && this.data.digGroups.some(g => g.open)) {
      const groups = this._loadDig()
      groups.forEach(g => { g.open = false })
      this._saveDig(groups)
      this.setData({ digGroups: groups })
    }
  },
  /** 面板触摸：仅当内容超出可滚 + 已滚到顶部时继续下滑才收起（bug3） */
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
    // 2026-08-23：深挖结果页下滑退出——不再要求内容必须溢出：面板已到顶（内容不足一屏时恒为顶）
    // 继续下滑即收起面板回退正常详情页；内容溢出时先自然向上滚，滚到顶再下滑才退出（不打断面板内滚动）
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
    this.setData({ searchQueried: true, searchQuery: query })
    this._runSearch(query)
  },

  /** 聚焦：清空已搜索过的词，可直接输入新词（无须先删除） */
  onSearchFocus() {
    if (this.data.searchQueried) {
      this.setData({ searchQueried: false, searchQuery: '' })
    }
  },

  onSearchInput(e) {
    this.setData({ searchQuery: (e.detail && e.detail.value) || '' })
  },

  /** 提交搜索（输入框 confirm / 按钮）：提交后搜索词以提示词灰显示 */
  onSearchSubmit() {
    const query = String(this.data.searchQuery || '').trim()
    if (!query) {
      wx.showToast({ title: '先输入一个话题吧', icon: 'none' })
      return
    }
    this.setData({ searchQueried: true })
    this._runSearch(query.slice(0, 60))
  },

  /** 2026-08-22：点击推荐问题 → 自动填入输入框并直接搜索（对齐 One News） */
  onRelatedTap(e) {
    const q = String((e.currentTarget.dataset.query) || '').trim()
    if (!q) return
    this.setData({ searchQueried: true, searchQuery: q, searchHint: '', relatedQuestions: [] })
    this._runSearch(q.slice(0, 60))
  },

  /** 调 intelSearch：60s 超时；结果累积为详情页一部分（不覆盖），hint 当次提示
   *  bug：searchLoading 是异步 setData，快速连点/confirm+按钮并发时守卫失效 →
   *  同一搜索 push 两次 → 历史出现重复条目。用同步标志 _searching 兜底。 */
  _runSearch(query) {
    if (this.data.searchLoading || this._searching) return
    this._searching = true
    // 2026-08-22：新搜索发起 → 折叠已有展开的深挖历史（边缘条件：排他性延伸到"新搜索"）
    const _g = this._loadDig()
    let _anyOpen = false
    _g.forEach(x => { if (x.open) { x.open = false; _anyOpen = true } })
    if (_anyOpen) { this._saveDig(_g); this.setData({ digGroups: _g }) }
    this.setData({ searchLoading: true, searchHint: '', relatedQuestions: [] })
    // 意图理解上下文：画像摘要 + 最近历史搜索词（后端 inferIntent 使用）
    let profilePayload = null
    let historyPayload = null
    if (_g.length) historyPayload = _g.slice(0, 5).map(x => x.query)
    // 画像异步取（不阻塞搜索发起）
    Promise.resolve()
      .then(() => getIntelProfile())
      .then(p => {
        if (p) {
          profilePayload = {
            identitiesSummary: p.identitiesSummary || '',
            focusTags: Array.isArray(p.focusTags) ? p.focusTags : [],
          }
        }
        return this._doCallSearch(query, profilePayload, historyPayload)
      })
      .catch(() => this._doCallSearch(query, profilePayload, historyPayload))
  },

  /** 实际调 intelSearch（携带意图上下文） */
  _doCallSearch(query, profile, history) {
    searchIntelTopic({ itemId: this.data.itemId, query, profile: profile, history: history })
      .then(d => {
        // ① 不相关（当次提示条 + 推荐问题，不影响已有结果）
        if (d && d.relevant === false) {
          this.setData({
            searchHint: d.hint || '这个话题和这条新闻关系不大哦，换一个试试～',
            relatedQuestions: Array.isArray(d.related) ? d.related : [],
          })
          return
        }
        // ② 相关+成功：优先后端 sections（层级排版），回退前端段落解析；来源折叠展示
        if (d && d.relevant) {
          // 相关 → 清空推荐问题
          this.setData({ relatedQuestions: [] })
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
      .then(() => { this._searching = false })
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
      let groups = Array.isArray(v) ? v : []
      // 清洗：同 query 内指纹相同的重复 entry 只留最新（修复历史遗留重复）
      let cleaned = false
      groups = groups.map(g => {
        const seen = {}
        const entries = (g.entries || []).filter(en => {
          const fp = this._sectionsFingerprint(en.sections)
          if (seen[fp]) { cleaned = true; return false }
          seen[fp] = true
          return true
        })
        if (entries.length !== (g.entries || []).length) { cleaned = true; g.entries = entries }
        return g
      }).filter(g => g && g.query && (g.entries || []).length)
      // 2026-08-23：深挖次序号迁移——旧数据无 seq 时按存储顺序补全局连续序号（entries 最新在前，
      // 逆序补号：最旧(数组尾)先拿小号、最新(数组头)拿大号，与新条目 seq 语义一致且不重排，
      // 保证次序号连续不跳号、展示序(最新在前)与序号(越大越新)自洽）
      let maxSeq = 0
      groups.forEach(g => (g.entries || []).forEach(en => { if (en.seq > maxSeq) maxSeq = en.seq }))
      groups.forEach(g => {
        const es = g.entries || []
        for (let i = es.length - 1; i >= 0; i--) {
          if (!es[i].seq) { maxSeq++; es[i].seq = maxSeq; cleaned = true }
        }
      })
      if (cleaned) { try { wx.setStorageSync(k, groups) } catch (e) {} }
      return groups
    } catch (e) { return [] }
  },
  _saveDig(groups) {
    try { wx.setStorageSync(this._digKey(), groups) } catch (e) {}
    // 2026-08-22：全局深挖历史 key 上限（防大量情报导致 storage 超限静默失败）
    try {
      const MAX_KEYS = 200
      const info = wx.getStorageInfoSync()
      const current = this._digKey()
      const digKeys = (info.keys || []).filter(k => k.indexOf('intel_dig_history_') === 0)
      if (digKeys.length > MAX_KEYS) {
        const extra = digKeys.length - MAX_KEYS
        let removed = 0
        for (let i = digKeys.length - 1; i >= 0 && removed < extra; i--) {
          if (digKeys[i] !== current) {
            wx.removeStorageSync(digKeys[i])
            removed++
          }
        }
      }
    } catch (e) { /* 清理失败不影响主流程 */ }
  },
  /** sections 指纹：用于去重（同 query 同内容不重复入库） */
  _sectionsFingerprint(sections) {
    try { return JSON.stringify((sections || []).map(x => x && x.text || '')) } catch (e) { return '' }
  },
  /** 新深挖结果入历史：同话题合并 entries（最新在前），持久化；搜索完成→最新分组展开（bug1）
   *  bug：并发触发时同 query 会 push 两条相同内容 → 入库前去重 */
  _pushDigEntry(query, sections, sources) {
    const now = new Date()
    const time = (now.getHours() < 10 ? '0' + now.getHours() : now.getHours()) + ':' +
      (now.getMinutes() < 10 ? '0' + now.getMinutes() : now.getMinutes())
    const groups = this._loadDig()
    const g = groups.find(x => x.query === query)
    // 去重：同 query 最新 entry 指纹相同则跳过（防并发重复）
    if (g && g.entries[0] && this._sectionsFingerprint(g.entries[0].sections) === this._sectionsFingerprint(sections)) {
      // 仅刷新展开态，不重复 push
      groups.forEach(x => { x.open = (x.query === query) })
      this._saveDig(groups)
      this.setData({ digGroups: groups })
      this._measureSearchPanel()
      return
    }
    // 新条目来源默认折叠（bug2）
    // 2026-08-23：全局深挖次序号连续（第1次深挖/第2次深挖…）：新条目 seq = 当前最大 + 1，
    // 去重/容量清理只删条目不重排序号，保证历史次序号连续不断号
    let nextSeq = 0
    groups.forEach(g => (g.entries || []).forEach(en => { if (en.seq > nextSeq) nextSeq = en.seq }))
    const entry = { seq: nextSeq + 1, time: time, sections: sections, sources: sources, sourcesExpanded: false }
    if (g) { g.entries.unshift(entry) } else { groups.unshift({ query: query, open: false, entries: [entry] }) }
    // 搜索完成：当前话题分组展开（其余折叠）；来源保持默认折叠
    groups.forEach(x => { x.open = (x.query === query) })
    // 上限保护：最多 10 个话题、每话题 10 次
    while (groups.length > 10) groups.pop()
    groups.forEach(x => { while (x.entries.length > 10) x.entries.pop() })
    this._saveDig(groups)
    this.setData({ digGroups: groups })
    this._measureSearchPanel()
  },
  /** 收起搜索面板：内容落回，历史折叠，滚动到深挖历史区 */
  _collapseSearch() {
    this._foldAllDig(false)
    this.setData({ searchOpen: false, searchPanelTop: '100%', searchRestUp: false, searchProgress: false })
    this.setData({ searchIntoView: 'dig-history' })
    setTimeout(() => this.setData({ searchIntoView: '' }), 600)
  },
  /** 展开/收起某个话题的深挖历史：互斥；展开后该主题滚动到页面顶部（bug5） */
  onToggleDigGroup(e) {
    const gi = Number(e.currentTarget.dataset.gi)
    const groups = this._loadDig()
    if (!groups[gi]) return
    const willOpen = !groups[gi].open
    groups.forEach((g, i) => { g.open = (i === gi) && willOpen })
    this._saveDig(groups)
    this.setData({ digGroups: groups })
    if (willOpen) {
      // 展开后：该分组置顶（scroll-into-view 定位分组头）
      this.setData({ digScrollTo: 'dig-group-' + gi })
      setTimeout(() => this.setData({ digScrollTo: '' }), 500)
    }
  },

  /** 折叠/展开某条结果的参考来源（内置结果框内，默认折叠） */
  onToggleEntrySources(e) {
    const gi = Number(e.currentTarget.dataset.gi)
    const ei = Number(e.currentTarget.dataset.ei)
    const groups = this._loadDig()
    if (!groups[gi] || !groups[gi].entries[ei]) return
    groups[gi].entries[ei].sourcesExpanded = !groups[gi].entries[ei].sourcesExpanded
    this._saveDig(groups)
    this.setData({ digGroups: groups })
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
