// INTEL-MODULE: AI 情报官 · 情报首页（内嵌横滑屏，嵌入 One News 首页）
// 说明：原 pages/intel/home 独立页改造为可复用组件，由 One News 首页同屏横滑切换。
//   - 父组件传 active 控制本屏 transform: translateX(-100%/0)，实现「右滑从左侧滑入、左滑从右侧滑回」。
//   - 本组件只负责渲染情报卡片 + 跳转 detail/mine；横滑手势由父组件（One News 首页）统一处理。
//   - detail/mine 仍为独立页，从本组件 navigateTo（纵深跳转，从右滑入，符合直觉）。
// 隔离说明：本组件独立于 One News 既有业务，可随 intel 模块整体摘除。
const app = getApp()

Component({
  properties: {
    // 父组件控制：true=AI 情报屏覆盖显示（translateX 0）；false=藏在屏幕左侧（translateX -100%）
    active: { type: Boolean, value: false },
    // 字体缩放（对齐 One News 字号档位）：由父页面 _syncFontScale 传入，组件 isolated 读不到父级 CSS 变量，
    // 故经 property 实时同步，改动档位后立即生效
    fontScaleValue: { type: Number, value: 1 },
    metaScaleValue: { type: Number, value: 1 }
  },

  data: {
    themeClass: '',
    isDark: false,
    statusBarHeight: 20,
    menuHeight: 32,
    topBarH: 44,           // 顶部条带高度（对齐原生胶囊 menuTop），内容从胶囊下方开始
    _fontScaleValue: 1,    // 字体缩放（对齐 One News，注入 CSS --font-scale）
    _metaScaleValue: 1,
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

  lifetimes: {
    attached() {
      this._applyTheme()
    }
  },

  observers: {
    // 父组件首次进入时确保主题就绪
    'active': function () {},
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
      this.setData({
        themeClass: (app.globalData && app.globalData.themeClass) || 'page--light',
        isDark: this._isSystemDark(),
        statusBarHeight: statusBarHeight,
        menuHeight: menuHeight,
        topBarH: menuTop, // 顶部条带顶到胶囊顶部，内容区从胶囊下方开始（避开原生胶囊）
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
    reqBack() {
      this.triggerEvent('reqback', {}, { bubbles: false, composed: false })
    }
  }
})
