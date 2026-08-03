// 常量定义
// S6: owner 2026-08-02 决策，「全部」与「推荐」合并为一个分类，保留 all ID 与「全部」名称
const CATEGORIES = [
  { id: 'all', name: '全部' },
  { id: 'tech', name: '科技' },
  { id: 'international', name: '国际' },
  { id: 'sports', name: '体育' },
  { id: 'life', name: '生活' },
  { id: 'agriculture', name: '农业' },
  { id: 'science', name: '科学' }
]

const CATEGORY_MAP = {}
CATEGORIES.forEach(c => { CATEGORY_MAP[c.id] = c.name })

// 页面尺寸常量（运行时计算，默认值在无法获取系统信息时使用）
let PAGE_WIDTH = 375
let PAGE_HEIGHT = 667
let STATUS_BAR_HEIGHT = 20

try {
  const info = wx.getSystemInfoSync()
  PAGE_WIDTH = info.windowWidth
  PAGE_HEIGHT = info.windowHeight
  STATUS_BAR_HEIGHT = info.statusBarHeight
} catch (e) {}

/**
 * 刷新页面尺寸（在 onShow/onResize 中调用）
 */
function refreshPageSize() {
  try {
    const info = wx.getSystemInfoSync()
    PAGE_WIDTH = info.windowWidth
    PAGE_HEIGHT = info.windowHeight
    STATUS_BAR_HEIGHT = info.statusBarHeight
  } catch (e) {}
}

// 手势阈值
const SWIPE_THRESHOLD = 50       // 上下滑动切换阈值
const PANEL_SWIPE_THRESHOLD = 60 // 左滑呼出面板阈值
const SWIPE_ANIMATION_MS = 300   // 翻页动画时长
const BOUNCE_ANIMATION_MS = 200  // 回弹动画时长

// 请求配置
const PAGE_SIZE = 15  // UX-BUG05: 从 10 提升至 15（精选场景上限）
// v5 起：小程序只读取云端真实新闻，不再启用 Mock 模式。

module.exports = {
  CATEGORIES,
  CATEGORY_MAP,
  PAGE_WIDTH,
  PAGE_HEIGHT,
  STATUS_BAR_HEIGHT,
  refreshPageSize,
  SWIPE_THRESHOLD,
  PANEL_SWIPE_THRESHOLD,
  SWIPE_ANIMATION_MS,
  BOUNCE_ANIMATION_MS,
  PAGE_SIZE,
}
