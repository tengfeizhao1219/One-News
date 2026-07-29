// 详情页逻辑

const { STATUS_BAR_HEIGHT } = require('../../utils/constants')
const { getNewsDetail } = require('../../utils/request')

Page({
  data: {
    statusBarHeight: STATUS_BAR_HEIGHT,
    news: {},
    paragraphs: []
  },

  onLoad(options) {
    const { id } = options
    if (id) {
      this.loadDetail(id)
    }
  },

  async loadDetail(newsId) {
    try {
      wx.showLoading({ title: '加载中...' })
      const news = await getNewsDetail(newsId)

      // 将 content 或 summary 按段落拆分
      const text = news.content || news.summary || ''
      const paragraphs = text.split('\n').filter(p => p.trim())

      this.setData({ news, paragraphs })
      wx.hideLoading()
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  goBack() {
    wx.navigateBack()
  },

  // 打开原始新闻链接（复制链接或使用 webview）
  openSourceUrl() {
    const url = this.data.news.sourceUrl
    if (!url) return
    // 在小程序内打开 webview 或复制链接
    wx.setClipboardData({
      data: url,
      success() {
        wx.showToast({ title: '链接已复制，请在浏览器中打开', icon: 'none', duration: 2500 })
      }
    })
  }
})
