// 搜索页逻辑

const { STATUS_BAR_HEIGHT } = require('../../utils/constants')
const { searchNews } = require('../../utils/request')
const { debounce } = require('../../utils/util')

Page({
  data: {
    statusBarHeight: STATUS_BAR_HEIGHT,
    keyword: '',
    results: [],
    searched: false
  },

  onInput(e) {
    const keyword = e.detail.value
    this.setData({ keyword })
    if (keyword.trim()) {
      // 使用绑定后的防抖函数
      this._doSearch(keyword.trim())
    } else {
      this.setData({ results: [], searched: false })
    }
  },

  onLoad() {
    // 在 onLoad 中绑定防抖函数，确保 this 正确
    this._searchTimer = null
    this._doSearch = debounce((keyword) => {
      searchNews({ keyword }).then(res => {
        this.setData({
          results: res.list || [],
          searched: true
        })
      }).catch(() => {
        wx.showToast({ title: '搜索失败', icon: 'none' })
      })
    }, 300)
  },

  onUnload() {
    // 清理防抖定时器，防止页面销毁后执行 setData
    if (this._searchTimer) {
      clearTimeout(this._searchTimer)
      this._searchTimer = null
    }
  },

  onSearch(e) {
    const keyword = e.detail.value || this.data.keyword
    if (!keyword.trim()) return
    // 使用与 onInput 相同的防抖搜索
    this._doSearch(keyword.trim())
  },

  onClear() {
    this.setData({ keyword: '', results: [], searched: false })
    // 清除防抖定时器
    if (this._searchTimer) {
      clearTimeout(this._searchTimer)
      this._searchTimer = null
    }
  },

  onResultTap(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}`
    })
  },

  goBack() {
    wx.navigateBack()
  }
})
