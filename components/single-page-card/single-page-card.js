// single-page-card — 朋友圈单页模式（scene 1154）单页展示组件
// owner 2026-09-08 拍板：不管从哪个页面分享到朋友圈，打开后都是「一个单页」，
// 设计样式与首页卡片完全一致。样式自包含（复制自 home.wxss 卡片视觉），
// 主题（深色模式）通过页面根注入的 CSS 变量继承，无需重复实现。
Component({
  properties: {
    // 单页卡片数据：{ title, categoryName, metaSource, time, summary, isAi,
    //                summarySource, contentSource, summaryParagraphs }
    card: { type: Object, value: null },
    // 状态栏高度（px），用于顶部安全距离（与首页卡片 card-body 顶部留白同基准）
    statusBarHeight: { type: Number, value: 44 },
  },
})
