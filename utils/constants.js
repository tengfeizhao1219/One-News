// 常量定义
// S6: owner 2026-08-02 决策，「全部」与「推荐」合并为一个分类，保留 all ID 与「全部」名称
const CATEGORIES = [
  { id: 'all', name: '全部' },
  { id: 'tech', name: '科技' },
  { id: 'international', name: '国际' },
  { id: 'sports', name: '科学探索' },
  { id: 'life', name: '社会' },
  // agriculture/science 已于 2026-08-03 按产品 owner 裁定下架（BUG-P1-011 闭环）
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

// 手势阈值（v5.9: 与详情页完全对齐——阈值70px、动画350ms ease）
const SWIPE_THRESHOLD = 70       // 上下滑动切换阈值（与详情页 onTouchEnd 一致）
const PANEL_SWIPE_THRESHOLD = 60 // 左滑呼出面板阈值
const SWIPE_ANIMATION_MS = 350   // 翻页动画时长（与详情页 setTimeout 350ms 一致）
const BOUNCE_ANIMATION_MS = 200  // 回弹动画时长（v5.9 已废弃：卡片页不再使用回弹逻辑）

// 请求配置
const PAGE_SIZE = 15  // UX-BUG05: 从 10 提升至 15（精选场景上限）
// 2026-08-03 owner 裁定：全链路真实数据，所有 mock 数据已清除（data/news.json、cloud-import-data.json 已删）

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
