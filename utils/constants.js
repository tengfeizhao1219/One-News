// 常量定义
const CATEGORIES = [
  { id: 'all', name: '全部' },
  { id: 'recommend', name: '推荐' },
  { id: 'tech', name: '科技' },
  { id: 'international', name: '国际' },
  { id: 'sports', name: '体育' },
  { id: 'life', name: '生活' }
]

const CATEGORY_MAP = {}
CATEGORIES.forEach(c => { CATEGORY_MAP[c.id] = c.name })

// 页面尺寸常量（运行时计算）
let PAGE_WIDTH = 375
let PAGE_HEIGHT = 667
let STATUS_BAR_HEIGHT = 20

try {
  const info = wx.getSystemInfoSync()
  PAGE_WIDTH = info.windowWidth
  PAGE_HEIGHT = info.windowHeight
  STATUS_BAR_HEIGHT = info.statusBarHeight
} catch (e) {}

// 手势阈值
const SWIPE_THRESHOLD = 50       // 上下滑动切换阈值
const PANEL_SWIPE_THRESHOLD = 60 // 左滑呼出面板阈值
const SWIPE_ANIMATION_MS = 380   // 滑动动画时长

// 请求配置
const PAGE_SIZE = 10
const USE_MOCK = false            // 生产模式：使用云函数

module.exports = {
  CATEGORIES,
  CATEGORY_MAP,
  PAGE_WIDTH,
  PAGE_HEIGHT,
  STATUS_BAR_HEIGHT,
  SWIPE_THRESHOLD,
  PANEL_SWIPE_THRESHOLD,
  SWIPE_ANIMATION_MS,
  PAGE_SIZE,
  USE_MOCK
}
