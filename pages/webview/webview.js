// UX-BUG06: WebView 页面 — 微信内直接打开原文链接
Page({
  data: {
    url: ''
  },

  onLoad: function (options) {
    var url = ''
    if (options.url) {
      try {
        url = decodeURIComponent(options.url)
      } catch (e) {
        url = options.url
      }
    }
    this.setData({ url: url })
  },
})
