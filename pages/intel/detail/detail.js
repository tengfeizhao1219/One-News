// INTEL-MODULE: AI 情报官 · 情报详情
// 隔离说明：本文件为新增页面逻辑，独立于 One News 既有业务；命名空间 intel_*。
// 演示数据（占位）：claude1m 为真实调研示例；其余 id 显示占位，待后端处理层下发。
const app = getApp()

Page({
  data: {
    themeClass: '',
    isDark: false,
    statusBarHeight: 20,
    showMore: false,
    showTry: false,
    srcName: 'Anthropic'
  },

  onLoad(query) {
    let statusBarHeight = 20
    try { statusBarHeight = wx.getSystemInfoSync().statusBarHeight || 20 } catch (e) {}
    const id = (query && query.id) || ''
    // 演示：仅 claude1m 有完整内容；其它情报点后端就绪后由云函数填充
    this.setData({
      themeClass: (app.globalData && app.globalData.themeClass) || 'page--light',
      isDark: this._isSystemDark(),
      statusBarHeight: statusBarHeight,
      srcName: id === 'claude1m' ? 'Anthropic' : 'AI 情报官'
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
