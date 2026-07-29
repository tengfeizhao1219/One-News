// 详情页 —— 阅读模式：上下滑切换新闻（跨分类串联）
// 从首页卡片点击进入，可上下滑切到上一条/下一条，返回时定位到当前在看的那条

const { STATUS_BAR_HEIGHT, SWIPE_THRESHOLD, SWIPE_ANIMATION_MS, CATEGORIES } = require('../../utils/constants')
const { getNewsDetail, getNewsList, handleApiError } = require('../../utils/request')

Page({
  data: {
    statusBarHeight: STATUS_BAR_HEIGHT,

    // 当前展示的新闻
    news: {},
    paragraphs: [],

    // 阅读模式
    readingList: [],      // 跨分类串联阅读列表
    readingIndex: 0,      // 当前在阅读列表中的索引
    totalCount: 0,        // 阅读列表总数

    // 首页定位信息（返回时用）
    homeIndex: 0,
    homeCategory: 'all',

    // 动画与手势
    isAnimating: false,
    translateY: 0,        // 当前页面的 Y 偏移（用于翻页动画）
    transitionClass: '',  // 是否启用 transition

    // 滚动边界标记
    isAtTop: true,
    isAtBottom: false,

    // 加载状态
    pageState: 'loading', // loading | ready | error
  },

  // 触摸状态（JS 层）
  _touchStartY: 0,
  _touchStartX: 0,
  _contentCache: {},     // 懒加载 content 缓存

  onLoad(options) {
    const { id, index, category } = options
    const homeIndex = parseInt(index) || 0
    const homeCategory = category || 'all'

    this.setData({ homeIndex, homeCategory })

    if (id) {
      this.init(id).catch((err) => {
        // 兜底：任何未捕获异常都转入 error 状态，避免白屏
        console.error('详情页初始化失败:', err)
        this.setData({ pageState: 'error' })
      })
    } else {
      this.setData({ pageState: 'error' })
    }
  },

  // ============ 初始化 ============

  async init(currentId) {
    console.log('[detail] init start, id =', currentId)
    // 超时兜底：若 6s 内未完成初始化，避免永久空白/卡 loading
    var self = this
    var timer = setTimeout(function () {
      if (self.data.pageState === 'loading') {
        console.warn('[detail] 初始化超时（6s），强制进入 error 状态')
        self.setData({ pageState: 'error' })
        wx.hideLoading()
      }
    }, 6000)

    try {
      wx.showLoading({ title: '加载中...' })

      // 并行：加载当前新闻全文 + 构建跨分类阅读列表
      const [, readingData] = await Promise.all([
        this.loadDetail(currentId),
        this.buildReadingList(currentId)
      ])
      console.log('[detail] 两路数据加载完成, readingList 条数 =',
        (readingData && readingData.readingList) ? readingData.readingList.length : 0)

      clearTimeout(timer)

      // 从阅读列表中获取当前新闻的基本信息（用于 progress）
      const { readingList, readingIndex, totalCount } = readingData
      this.setData({ readingList, readingIndex, totalCount })

      wx.hideLoading()
      this.setData({ pageState: 'ready' })
      console.log('[detail] init success, pageState = ready, totalCount =', totalCount)

    } catch (err) {
      clearTimeout(timer)
      wx.hideLoading()
      console.error('[detail] 初始化失败:', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
      this.setData({ pageState: 'error' })
    }
  },

  /**
   * 加载单条新闻全文
   */
  async loadDetail(newsId) {
    const news = await getNewsDetail(newsId)
    const text = news.content || news.summary || ''
    // content 在 JS 运行时已是实际换行符，按实际换行切段（兼容 \n 或 \n\n）
    const paragraphs = text.split(/\n+/).map(function (p) { return p.trim() }).filter(function (p) { return p })

    this.setData({ news, paragraphs })

    // 缓存 content
    this._contentCache[newsId] = { news, paragraphs }
  },

  /**
   * 构建跨分类串联阅读列表
   * 按分类顺序（推荐→科技→国际→体育→生活）并行请求所有分类数据
   * 拼接去重后，定位当前新闻在列表中的索引
   */
  async buildReadingList(currentId) {
    // 获取非 "all" 的分类
    var cats = CATEGORIES.filter(function (c) { return c.id !== 'all' })

    // 并行请求所有分类
    var results = await Promise.all(
      cats.map(function (cat) {
        return getNewsList({ category: cat.id, pageSize: 50 }).catch(function () {
          return { list: [] }
        })
      })
    )

    // 按分类顺序拼接，去重
    var seen = {}
    var readingList = []

    for (var i = 0; i < cats.length; i++) {
      var items = results[i].list || []
      for (var j = 0; j < items.length; j++) {
        var item = items[j]
        if (!seen[item.id]) {
          seen[item.id] = true
          readingList.push(item)
        }
      }
    }

    // 定位当前新闻
    var readingIndex = 0
    for (var k = 0; k < readingList.length; k++) {
      if (readingList[k].id === currentId || readingList[k]._id === currentId) {
        readingIndex = k
        break
      }
    }

    return {
      readingList: readingList,
      readingIndex: readingIndex,
      totalCount: readingList.length
    }
  },

  // ============ 切换新闻 ============

  /**
   * 切换到上一条新闻
   */
  async swipeToPrev() {
    if (this.data.isAnimating) return
    var prevIndex = this.data.readingIndex - 1

    if (prevIndex < 0) {
      wx.showToast({ title: '已经是第一条了', icon: 'none' })
      return
    }

    await this.swipeTo(prevIndex, 'down')
  },

  /**
   * 切换到下一条新闻
   */
  async swipeToNext() {
    if (this.data.isAnimating) return
    var nextIndex = this.data.readingIndex + 1

    if (nextIndex >= this.data.readingList.length) {
      wx.showToast({ title: '已经到最后一条了', icon: 'none' })
      return
    }

    await this.swipeTo(nextIndex, 'up')
  },

  /**
   * 执行切换动画并加载新内容
   * @param {number} targetIndex - 目标索引
   * @param {string} direction - 'up'（上滑，新内容从下方进入）| 'down'（下滑，新内容从上方进入）
   */
  async swipeTo(targetIndex, direction) {
    var that = this
    that.setData({ isAnimating: true })

    // 第一步：设置过渡动画的起始状态
    var startY = direction === 'up' ? 0 : 0
    var endY = direction === 'up' ? -that.data.statusBarHeight * 2 - 200 : that.data.statusBarHeight * 2 + 200

    // 先让页面偏移到即将消失的位置
    that.setData({
      translateY: endY,
      transitionClass: 'with-transition'
    })

    // 动画进行中，加载目标新闻
    var targetNews = that.data.readingList[targetIndex]
    if (!targetNews) {
      that.setData({ isAnimating: false })
      return
    }

    try {
      // 加载全文
      await that.loadDetail(targetNews.id)

      // 第二步：动画完成后更新内容并复位
      setTimeout(function () {
        // 先去掉 transition，瞬间复位到初始位置
        that.setData({
          transitionClass: '',
          translateY: 0,
          readingIndex: targetIndex
        })

        // 短暂延迟后恢复交互
        setTimeout(function () {
          that.setData({ isAnimating: false })
          // 重置滚动位置
          that.setData({ isAtTop: true, isAtBottom: false })
        }, 50)
      }, SWIPE_ANIMATION_MS)
    } catch (err) {
      console.error('加载新闻失败:', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
      that.setData({
        transitionClass: '',
        translateY: 0,
        isAnimating: false
      })
    }
  },

  // ============ 触摸手势（纯 JS，不用 WXS） ============

  onTouchStart(e) {
    if (this.data.isAnimating) return
    var touch = e.touches[0]
    this._touchStartY = touch.clientY
    this._touchStartX = touch.clientX
  },

  onTouchMove(e) {
    // 详情页不需要跟手拖拽，仅记录
  },

  onTouchEnd(e) {
    if (this.data.isAnimating) return

    var touch = e.changedTouches[0]
    var dy = touch.clientY - this._touchStartY
    var dx = touch.clientX - this._touchStartX

    // 水平滑动忽略
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
      return
    }

    // 垂直滑动切换
    if (Math.abs(dy) > SWIPE_THRESHOLD) {
      if (dy < 0) {
        // 上滑 → 下一条
        this.swipeToNext()
      } else {
        // 下滑 → 上一条
        this.swipeToPrev()
      }
    }
  },

  // ============ 滚动边界检测 ============

  onScrollToUpper() {
    this.setData({ isAtTop: true, isAtBottom: false })
  },

  onScrollToLower() {
    this.setData({ isAtTop: false, isAtBottom: true })
  },

  onScroll(e) {
    // 中间滚动状态
    var scrollTop = e.detail.scrollTop
    this.setData({
      isAtTop: scrollTop <= 5,
      isAtBottom: false
    })
  },

  // ============ 返回 ============

  goBack() {
    var that = this
    var readingList = that.data.readingList
    var readingIndex = that.data.readingIndex

    if (readingList.length > 0 && readingList[readingIndex]) {
      var currentNews = readingList[readingIndex]
      // 通过 app.globalData 将定位信息传回首页
      var app = getApp()
      if (app && app.globalData) {
        app.globalData._detailReturnState = {
          newsId: currentNews.id,
          category: currentNews.category,
          readingIndex: readingIndex
        }
      }
    }

    wx.navigateBack()
  },

  // ============ 错误重试 ============

  onRetry() {
    var pages = getCurrentPages()
    var options = pages[pages.length - 1].options || {}
    if (options.id) {
      this.init(options.id)
    }
  }
})
