// INTEL-MODULE: AI 情报官 · 情报首页
// 隔离说明：本文件为新增页面逻辑，独立于 One News 既有业务；命名空间 intel_*。
// 复用说明：themeClass / isDark 取值方式复刻 One News home 页面，非其业务逻辑。
//
// 数据源：调云函数 getIntelBrief（读 intel_current isCurrent 当期 Brief，
//   Channels 层 OneNewsChannel 渲染），页面元素（设计 §7.6）：
//   今日关注卡片流 + 本周可试用清单 + 「数据截至 HH:MM」+ 源健康提示。
// 演示数据仅作 UI 兜底缓存（联调期后端未组装 brief 时不清空页），真实数据覆盖。
const app = getApp()
const { getIntelBrief } = require('../../../utils/intelRequest')

// 演示数据（占位缓存：UI 验证 + 后端未就绪时兜底，不污染真实数据）
const DEMO_ITEMS = [
  {
    id: 'claude1m',
    title: 'Claude 100 万 token 上下文正式可用：你那份 80 页尽调报告，终于可以整本丢进去比差异了',
    desc: 'Anthropic 已取消长上下文溢价，单次请求最多可附带 600 页 PDF（此前上限仅 100 页），超出 20 万 token 后不再翻倍计费。在衡量超长文档检索的 MRCR v2 基准上，100 万 token 长度取得 78.3% 准确率，为当前前沿最高。长文档的「中间遗忘」明显缓解，可以整本上传、直接就全文档提问。',
    src: 'Anthropic',
    time: '今天 09:30'
  },
  {
    id: 'arxiv-selfplay',
    title: 'arXiv 新论文：小模型靠「自我博弈」在数学推理上逼近大模型',
    desc: '一项 arXiv 新研究让小模型通过「自我博弈」式的结构化反思来迭代改进推理，在数学题上逼近了参数量大得多的模型。关键不在堆算力，而是把解题拆成可自检、可重试的步骤。对你正在做的产品降本路径——用更小模型加更好推理流程替代盲目上大模型——是个值得盯的方向。',
    src: 'arXiv',
    time: '今天 08:10'
  },
  {
    id: 'thebatch-reg',
    title: 'The Batch：本周 AI 监管三件事，直接影响你们出海合规节奏',
    desc: 'The Batch 本周梳理了欧盟《AI 法案》实施细则、美国行政命令配套指南，以及中国生成式 AI 服务管理的新一轮更新。三地节奏不一但都在收紧，直接影响你们出海产品的合规排期与上线节点。建议这周把「合规评估」排进日程，别等临上线才补课。',
    src: 'The Batch',
    time: '昨天'
  }
]

// 把云函数 focusItems → 首页卡片可渲染结构（sourceName 在 item 上，desc 取一句话定义）
function toCards(focusItems) {
  return (focusItems || []).map((it) => ({
    id: it.id || it.itemId || '',
    title: it.title || '',
    desc: it.definition || it.sceneMapping || '',   // 卡片副文本：一句话定义兜底
    src: it.sourceName || '',
    time: it.publishedAt ? formatLabel(it.publishedAt) : '',
    contract: it.contract === true,
    sceneTags: it.sceneTags || [],
    rank: it.rank || 0,
  }))
}

// 简单的人读时间标签（复用相对时间太复杂，这里只做「HH:MM」打磨）
function formatLabel(iso) {
  try {
    const d = new Date(iso)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `今天 ${hh}:${mm}`
  } catch (e) { return '' }
}

Page({
  data: {
    themeClass: '',
    isDark: false,
    statusBarHeight: 20,
    // 卡片流：默认为演示缓存，云函数返回后替换
    items: DEMO_ITEMS,
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
    tryable: []
  },

  onLoad() {
    let statusBarHeight = 20
    try { statusBarHeight = wx.getSystemInfoSync().statusBarHeight || 20 } catch (e) {}
    this.setData({
      themeClass: (app.globalData && app.globalData.themeClass) || 'page--light',
      isDark: this._isSystemDark(),
      statusBarHeight: statusBarHeight
    })
    this._loadBrief()
  },

  /**
   * 拉取当期情报 brief → 渲染首页卡片流 + 本周可试用 + 元信息。
   * 后端未就绪/无当期 → 保留演示缓存 + 空态提示，不崩溃（§7.7 有则汇报无则不打扰）。
   */
  async _loadBrief() {
    try {
      const brief = await getIntelBrief()
      if (!brief || !brief.hasContent) {
        // 无内容：保留演示缓存，但诚实提示暂无后段数据
        this.setData({ 'meta.empty': true, 'meta.loading': false })
        console.log('[intel-home] getIntelBrief 返回空态（后端 brief 未组装）')
        return
      }
      // 真实数据覆盖演示缓存
      const cards = toCards(brief.focusItems)
      const health = brief.health || {}
      const meta = {
        dataAsOf: brief.dataAsOf.label || '',
        healthTitle: health.title || '',
        healthDetail: health.detail || '',
        empty: !brief.hasContent,
        loading: false,
        // 占位态（处理层大面积失败「今日无可靠更新」，§7.7）
        placeholder: brief.placeholder === true,
        banner: brief.banner || '',
      }
      // 占位无可靠更新 → 清空今日关注（避免展示演示缓存误导）
      this.setData({
        items: meta.placeholder ? [] : (cards.length ? cards : DEMO_ITEMS),
        tryable: (brief.tryable || []).map((t) => ({ id: t.id, title: t.title, minAction: t.minAction, done: false })),
        meta,
      })
    } catch (err) {
      console.warn('[intel-home] 拉取 brief 失败，保留演示缓存:', err.message || err)
      this.setData({ 'meta.loading': false })
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
    wx.navigateTo({ url: `/pages/intel/detail/detail?id=${id}` })
  },

  // 本周可试用清单勾选（本地暂存，非持久）
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
  }
})
