// INTEL-MODULE: AI 情报官 · 情报首页
// 隔离说明：本文件为新增页面逻辑，独立于 One News 既有业务；命名空间 intel_*。
// 复用说明：themeClass / isDark 取值方式复刻 One News home 页面，非其业务逻辑。
const app = getApp()

Page({
  data: {
    themeClass: '',
    isDark: false,
    statusBarHeight: 20,
    // 演示数据（占位）：后端情报处理层就绪后由云函数下发，此处仅用于 UI 验证
    items: [
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
  },

  onLoad() {
    let statusBarHeight = 20
    try { statusBarHeight = wx.getSystemInfoSync().statusBarHeight || 20 } catch (e) {}
    this.setData({
      themeClass: (app.globalData && app.globalData.themeClass) || 'page--light',
      isDark: this._isSystemDark(),
      statusBarHeight: statusBarHeight
    })
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

  goMine() {
    wx.navigateTo({ url: '/pages/intel/mine/mine' })
  },

  // 返回 One News 首页（由右滑入口经 navigateTo 进入，故用 navigateBack）
  goBack() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/home/home' }) })
  }
})
