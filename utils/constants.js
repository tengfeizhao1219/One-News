// 常量定义
// DG-03（2026-08-06 数据治理 · owner 决策）：all → 推荐分类（独立数据源，recommend 置顶）
// RQ-20（2026-08-07 owner 决策）：恢复「全部」作为侧边栏聚合视图，置于推荐上方；
//   推荐仍独立保留（首页默认 + AI 精选），all 为全分类聚合（后端 getNewsList all 分支本就保留）
const CATEGORIES = [
  { id: 'all', name: '全部' },
  { id: 'recommend', name: '推荐' },
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
// DG-03（2026-08-06 数据治理 · owner 决策）：首页首次 10 条；翻底/翻顶每次 5 条；
// 连续拉取 3 次（总 15 追加，上限 25）后提示「已阅读了 x 条新闻，建议稍后再读」
// FS-01（2026-08-07）：翻底/翻顶每次追加量 5→8（owner 反馈 5 条太少）；MORE_PAGE_LIMIT=3 不变，
// 单次连续拉取总追加 24 条，累计上限 10+24=34 条后提示稍后再读。
// FS-06（2026-08-07 · owner 决策）：PAGE_SIZE 10→8，与 refreshNews 每分类生成条数（PER_CATEGORY_COUNT=8）一致，
// 首屏请求 8 条正好拿满缓存 8 条（此前请求 10 条但缓存仅 8 条 → 首屏少 2 条的观感）；累计上限 8+24=32 条。
const PAGE_SIZE = 8        // 首次加载（FS-06：10 → 8，与每分类缓存条数一致）
const MORE_PAGE_SIZE = 8   // 翻底/翻顶每次追加量（FS-01：5 → 8）
const MORE_PAGE_LIMIT = 3  // 连续拉取上限次数（方案 5 改动 B）
// DG-03（数据治理 3.3）：纯本地存储上限（历史 500 / 收藏 200，常量统一）
const HISTORY_LIMIT = 500
const FAVORITES_LIMIT = 200

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
  MORE_PAGE_SIZE,
  MORE_PAGE_LIMIT,
  HISTORY_LIMIT,
  FAVORITES_LIMIT,
}
