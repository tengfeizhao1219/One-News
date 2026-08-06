// 一页 One-News · 全局任务看板数据源
// 数据取自 TASK_BOARD.md（各角色任务）+ COMMLOG + CONTEXT.md
// 字段说明：
//   id      任务ID
//   title   任务名
//   col     所属状态列：req(需求) / design(设计) / review(评审) / dev(开发) / test(测试-API) / accept(验收-真机)
//   role    负责角色
//   prio    优先级：P0 / P1 / P2 / -
//   status  状态符号：done(✅) / doing(🔄) / wait(⏳) / block(🚫) / cancel(❌)
//   link    关联链标识（同一件事跨阶段共享同一 link，用于高亮脉络）
//   note    备注
//   updated 最近更新

window.KANBAN_META = {
  title: "一页 One-News · 项目全局看板",
  subtitle: "需求 · 设计 · 评审 · 开发 · 测试(API) · 验收(真机)",
  updated: "2026-08-06",
  columns: [
    { key: "req",    name: "需求状态",     hint: "需求规划 / 需求池 / 下迭代需求" },
    { key: "design", name: "设计状态",     hint: "交互 / 视觉 / 原型 / 走查" },
    { key: "review", name: "评审状态",     hint: "设计评审 / 技术评审 / UI 闸门 / owner 确认" },
    { key: "dev",    name: "开发状态",     hint: "FS / FE 编码与云函数" },
    { key: "test",   name: "测试状态 (API)", hint: "PM 功能/回归/单测 · 自动化" },
    { key: "accept", name: "验收状态 (真机)", hint: "owner / PD 真机验证 · UAT" }
  ],
  // 项目背景介绍（看板顶部展示）
  background: "一页（One-News）是一款微信小程序 · AI 新闻速览产品，技术栈为原生微信小程序 + WXS + CloudBase 云开发，AI 引擎采用智谱 GLM-4-Flash（联网搜索）+ DeepSeek API（降级兜底）。项目由 PM / PD / FS / FE / PJM 多角色线上协作推进，当前处于「阶段五 · 测试验收」，阶段一~四已闭环。本看板以 6 大状态列（需求 → 设计 → 评审 → 开发 → 测试(API) → 验收(真机)）横向串联全流程，同一件事通过「关联链」跨阶段高亮，点击卡片即可追溯完整脉络。",
  // 最近变更日志（取 COMMLOG.md 最新 3 条，含变更人/角色 + 变更内容）
  changelog: [
    { time: "2026-08-06 11:40", who: "产品设计师(PD)", content: "D-09 升级 v1.1 系统级规范：导航条带与胶囊 6px 呼吸、进度条去底槽同色、6 页面统一" },
    { time: "2026-08-06 11:30", who: "产品设计师(PD)", content: "交互 demo 须基于当前设计稿；后续所有静态页 demo 统一标注「时间 + 调整说明」" },
    { time: "2026-08-06 11:15", who: "产品设计师(PD)", content: "交互 demo 上线 GitHub Pages，主站画廊新增入口" }
  ]
};

window.KANBAN_DATA = [
  // ===== 需求状态 (req) =====
  { id: "RQ-15",      title: "侧边分类滚轮（左滑手势进入列表页）", col: "req", role: "PM", prio: "P0", status: "done",   link: "RQ-15 滚轮",  note: "方案 A 已固化；N-01", updated: "08-03" },
  { id: "RQ-03",      title: "收藏上云（setUserFavorite / 待同步队列）", col: "req", role: "PM", prio: "P0", status: "done", link: "收藏上云", note: "RQ-03 需求池已登记", updated: "08-03" },
  { id: "RQ-06",      title: "浏览记录页（本地为主·云端兜底）", col: "req", role: "PM", prio: "P1", status: "done",   link: "浏览记录", note: "PRD 下迭代", updated: "08-03" },
  { id: "RQ-17",      title: "全局返回主页入口（🏠 导航栏）", col: "req", role: "PM", prio: "P0", status: "done",   link: "返回主页", note: "owner 直连新增", updated: "08-03" },
  { id: "RQ-16",      title: "数据保留策略（收藏30天 / 未收藏7天）", col: "req", role: "PM", prio: "P0", status: "done", link: "数据保留", note: "TTL 分级 + 清理", updated: "08-03" },
  { id: "RQ-10",      title: "内容安全 API（降级放行 + 兜底告警）", col: "req", role: "PM", prio: "P0", status: "done", link: "AI摘要", note: "owner 裁定 P0-Q1 接受放行", updated: "08-03" },
  { id: "RQ-18",      title: "AI 搜索更多（详情页底部追问 + 来源溯源）", col: "req", role: "PM", prio: "P1", status: "doing", link: "AI搜索", note: "探讨稿待评审；待 FS 技术评估", updated: "08-04" },
  { id: "AB-01-R",    title: "「关于一页」页面方案", col: "req", role: "PJM", prio: "P2", status: "done", link: "关于一页", note: "PM 方案确认", updated: "08-06" },

  // ===== 设计状态 (design) =====
  { id: "UI-B7",      title: "列表页重新设计（左滑手势 + 圆角高亮 + 底部提示）", col: "design", role: "PD", prio: "P0", status: "done", link: "RQ-15 滚轮", note: "v4.2 终版；7 轮迭代", updated: "08-04" },
  { id: "UI-B4B5",    title: "浏览记录 & 收藏展示设计（无缩略图）", col: "design", role: "PD", prio: "P1", status: "done", link: "收藏上云", note: "与浏览记录共享设计稿", updated: "08-03" },
  { id: "UI-B6",      title: "全局导航框架（⚙ dock 菜单 + 返回主页图标）", col: "design", role: "PD", prio: "P0", status: "done", link: "返回主页", note: "v1.2 通过", updated: "08-03" },
  { id: "UI-B8",      title: "AI 摘要胶囊（A-1 淡蓝轻胶囊·内联行首）", col: "design", role: "PD", prio: "P0", status: "done", link: "AI摘要", note: "4 方案对比，owner 裁定 A-1", updated: "08-04" },
  { id: "D-05",       title: "设计走查（B-01~B-07 产出物 vs 设计稿）", col: "design", role: "PD", prio: "P1", status: "doing", link: "交互标准", note: "D-05.3 修复确认 UI-A1 待启动", updated: "08-05" },
  { id: "UX-STD",     title: "交互语言标准 v1.0（6 大体系 + 简化建议）", col: "design", role: "PD", prio: "P0", status: "done", link: "交互标准", note: "D-02 交互语言标准", updated: "08-02" },

  // ===== 评审状态 (review) =====
  { id: "A-12",       title: "评审系列（技术/交互/视觉/测试 4/4）", col: "review", role: "各角色", prio: "P0", status: "done", link: "交互标准", note: "汇总为 D-04 设计评审纪要", updated: "07-30" },
  { id: "D-04",       title: "设计评审（设计评审纪要）", col: "review", role: "PM", prio: "P0", status: "done", link: "交互标准", note: "A-12 4/4 完成", updated: "07-30" },
  { id: "RV-UIB7",    title: "UI-B7 owner 在线确认（v4.2）", col: "review", role: "owner/PD", prio: "P0", status: "done", link: "RQ-15 滚轮", note: "GitHub Pages 原型确认", updated: "08-04" },
  { id: "RV-UIB8",    title: "UI-B8 owner 裁定 A-1 方案", col: "review", role: "owner/PD", prio: "P0", status: "done", link: "AI摘要", note: "17:44 裁定", updated: "08-04" },
  { id: "RV-A1",      title: "UI-A1 设计闸门（D-05.3 修复确认）", col: "review", role: "PD", prio: "P1", status: "doing", link: "交互标准", note: "依赖前端修复后二次对照", updated: "08-05" },

  // ===== 开发状态 (dev) =====
  { id: "TL-B17",     title: "列表页前端实现（category-wheel + 左滑手势 + 图标/fab）", col: "dev", role: "FS", prio: "P0", status: "done", link: "RQ-15 滚轮", note: "PD 走查 v1.3 通过率 98%", updated: "08-04" },
  { id: "TL-B13",     title: "收藏上云前端展示（同步态 / 待同步角标 / 失败条）", col: "dev", role: "FS", prio: "P0", status: "doing", link: "收藏上云", note: "云函数/数据层可先行", updated: "08-05" },
  { id: "TL-B14",     title: "浏览记录页（列表/空态/骨架/相对时间）", col: "dev", role: "FS", prio: "P1", status: "doing", link: "浏览记录", note: "入口走 ⚙ 菜单", updated: "08-05" },
  { id: "TL-B15",     title: "返回主页图标（wx.reLaunch + 防抖 + 暗色）", col: "dev", role: "FS", prio: "P0", status: "done", link: "返回主页", note: "detail/history/favorites SVG mask", updated: "08-04" },
  { id: "TL-B18",     title: "AI 摘要胶囊前端实现 + 链路 review", col: "dev", role: "FS", prio: "P0", status: "done", link: "AI摘要", note: "summarySource 链路 + A-1 胶囊", updated: "08-04" },
  { id: "B-15",       title: "L1 百炼→智谱+DeepSeek 双引擎改造（ADR-002）", col: "dev", role: "FS", prio: "P0", status: "done", link: "AI摘要", note: "DEP-01 已部署", updated: "08-01" },
  { id: "V5-FS-02",   title: "数据清洗 6 项修复（正文串入/限流/广告/图说/扫码/remove）", col: "dev", role: "FS", prio: "P0", status: "done", link: "数据清洗", note: "PJM 代码级复验全部落地(v6.3)", updated: "08-05" },
  { id: "B-10B14",    title: "后端自查 B-10~B-14（单测/限流/短路/并发）", col: "dev", role: "FS", prio: "P1", status: "done", link: "数据清洗", note: "B-08/B-11/B-12 已作废", updated: "08-05" },
  { id: "AB-01",      title: "「关于一页」页面开发（8 文件 + dock 改造）", col: "dev", role: "FE", prio: "P2", status: "done", link: "关于一页", note: "FE 交付 34d20a5；待真机验证", updated: "08-06" },
  { id: "UX-FIX",     title: "UX-SIMPLIFY / UX-FIX 系列（简化 + 修复）", col: "dev", role: "FS", prio: "P1", status: "done", link: "交互标准", note: "UX-FIX01~06 + SIMPLIFY01/05/07", updated: "08-02" },

  // ===== 测试状态 (API) =====
  { id: "Q-02",       title: "功能测试（功能用例）", col: "test", role: "PM", prio: "P0", status: "done", link: "交互标准", note: "18/18 通过", updated: "08-04" },
  { id: "Q-03",       title: "回归测试（自动化）", col: "test", role: "PM", prio: "P0", status: "done", link: "交互标准", note: "自动化 592 条全通过", updated: "08-04" },
  { id: "Q-07",       title: "TL-B13 前端展示专项测试", col: "test", role: "PM", prio: "P1", status: "done", link: "收藏上云", note: "33/33 通过 + test/v12", updated: "08-06" },
  { id: "B-10T",      title: "云函数单元测试（adapter/清洗/源/提取器）", col: "test", role: "FS", prio: "P1", status: "done", link: "数据清洗", note: "30/0 通过 test/b10", updated: "08-05" },
  { id: "API-CTL",    title: "API 契约测试（分类契约 v11 / 收藏 v12 / 暗色 v13）", col: "test", role: "PM/FS", prio: "P1", status: "done", link: "收藏上云", note: "分类契约 25/25", updated: "08-06" },
  { id: "Q-043",      title: "Bug 分配与跟踪（BUG-001~010 复测）", col: "test", role: "PJM", prio: "P1", status: "doing", link: "真机复测", note: "P0-010 已止血待复测", updated: "08-05" },

  // ===== 验收状态 (真机) =====
  { id: "UAT-01",     title: "UAT-20260806-001~005（001/002/003 + D-07 三态 + 深色 icon）", col: "accept", role: "owner", prio: "P0", status: "doing", link: "交互标准", note: "PD 建真机验证任务", updated: "08-06" },
  { id: "AB-01-A",    title: "「关于一页」真机验证", col: "accept", role: "owner", prio: "P2", status: "wait", link: "关于一页", note: "验收清单已就绪", updated: "08-06" },
  { id: "BUG-RT",     title: "真机复测：BUG-20260802-001/004/006（翻页/数据源/分类提示）", col: "accept", role: "owner", prio: "P1", status: "wait", link: "真机复测", note: "BLK-09 设备资源；代码已修待复测", updated: "08-05" },
  { id: "Q-05",       title: "产品验收（60 条验收项，P0❌→阻断）", col: "accept", role: "PM", prio: "P0", status: "doing", link: "交互标准", note: "建议待翻页真机复测通过启动", updated: "08-05" },
  { id: "Q-06",       title: "上线检查（合并确认/部署/审核准备/回滚预案）", col: "accept", role: "PJM", prio: "P0", status: "wait", link: "交互标准", note: "Q-06.1~06.4 关口检查", updated: "08-05" }
];
