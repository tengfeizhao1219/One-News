// 常量定义
const CATEGORIES = [
  { id: 'all', name: '全部' },
  { id: 'recommend', name: '推荐' },
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
const PAGE_SIZE = 10
// 开发阶段默认启用 Mock 模式（AI 缓存），云函数部署后改为 false
const USE_MOCK = true

// AI 新闻缓存配置
const AI_CACHE = {
  version: '2026-07-28-v1',
  generatedAt: '2026-07-28T11:46:00+08:00',
  // 建议刷新周期：每天手动触发一次 WorkBuddy 搜索更新
  // 运行: 告诉 WorkBuddy "搜索最新新闻更新 AI 缓存"
  refreshIntervalHours: 24,
}

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
  USE_MOCK,
  AI_CACHE
}
