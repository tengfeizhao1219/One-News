# D-02-增量 · UI-B7 列表页重新设计

> **编号**：UI-B7 | **角色**：产品设计师 | **日期**：2026-08-05
> **原型来源**：https://tengfeizhao1219.github.io/One-News/showcase/ui-b7-list-redesign.html
> **状态**：✅ v5.3-final — 以交互原型库为唯一权威依据

---

## 1. 概述

v5.3-final 版本，经 owner 2026-08-04 最终确认：

| # | 反馈 | 改动 |
|---|------|------|
| 1 | 选中分类用淡淡蓝色高亮，保证暗色下能看清 | idle 选中项加淡蓝底色 `--highlight-bg` |
| 2 | 选中分类固定在顶部第二行 | 锚定逻辑：`translateY = max(0, -(curCat-1) × 36px)` |
| 3 | 移除面板右上角关闭按钮 | 删除 close button，右滑关闭即可 |
| 4 | 列表字号再小一档 | `15px → 14px` |

---

## 2. 整体架构

```
首页（全屏单卡流）  ←→  侧边列表面板（左滑进入）
     │                        │
     │ 上滑/下滑翻卡           │ 左侧分类滚轮 + 右侧极简标题列表
     │                        │
     └──── 点击卡片 → 详情页 ──┘
```

---

## 3. 首页全屏卡片

### 3.1 布局

```
┌──────────────────────────────────────────┐
│  9:41                    ●●● ▮ 100%     │ ← 状态栏（z-index: 40）
├──────────────────────────────────────────┤
│              科技  ───●───               │ ← 分类名 + 进度条（z-index: 30）
│                                          │
│  ┌──────────────────────────────────┐    │
│  │                                  │    │
│  │  国产大模型推理成本一年下降 90%    │    │ ← 标题 26px Bold
│  │  端侧部署成新战场                  │    │
│  │                                  │    │
│  │  科技  新华社 · 2小时前           │    │ ← 元信息 11px
│  │                                  │    │
│  │  随着算力优化与蒸馏技术成熟……     │    │ ← 摘要 16px 衬线
│  │                                  │    │
│  │  多家厂商将战场推向手机与车机…     │    │
│  │                                  │    │
│  └──────────────────────────────────┘    │
│                                          │
│              ⇅ 上滑阅读下一条             │ ← 滑动提示
│                                          │
│                                ┌──┐      │ ← FAB 浮动按钮（z-index: 60）
│                                │⚙ │      │
│                                └──┘      │
└──────────────────────────────────────────┘
```

### 3.2 卡片规格

| 属性 | 值 |
|------|-----|
| 卡片尺寸 | 全屏 375×812，`position: absolute; inset: 0` |
| 背景 | `var(--bg-card)` |
| 内容区 padding | `104px 32px 90px`（顶部留导航空间，底部留滑动提示） |
| 标题 | `26px`，`font-weight: 700`，`line-height: 1.35`，`letter-spacing: -0.5px`，3行截断 |
| 元信息 | `11px`，`var(--text-secondary)`，`letter-spacing: 0.5px` |
| 分类标签 | `11px`，`padding: 2px 9px`，`border-radius: 999px`，`background: var(--tag-bg)` |
| 摘要 | 衬线，`16px`，`var(--text-body)`，`line-height: 1.85`，`letter-spacing: 0.5px` |
| 卡片切换 | `transition: transform 0.35s cubic-bezier(0.25,0.1,0.25,1), opacity 0.35s ease` |

### 3.3 顶部进度指示

| 属性 | 值 |
|------|-----|
| 位置 | `top: 44px; height: 48px`，居中 |
| 分类名 | `13px`，`font-weight: 500`，`color: var(--primary)`，`opacity: 0.8`，`letter-spacing: 1px` |
| 进度条 | `width: 64px; height: 3px; border-radius: 2px; background: var(--divider)` |
| 进度填充 | `var(--primary)`，`transition: width 0.3s` |

### 3.4 滑动提示

| 属性 | 值 |
|------|-----|
| 位置 | `position: absolute; bottom: 0; height: 62px` |
| 背景 | `linear-gradient(transparent, var(--bg-card) 40%)` |
| 图标 | `⇅`，`14px`，`opacity: 0.45` |
| 文字 | 「上滑阅读下一条」，`9px`，`letter-spacing: 2px`，`opacity: 0.45` |

### 3.5 FAB 浮动按钮

| 属性 | 值 |
|------|-----|
| 位置 | `position: absolute; right: 20px; bottom: 30px; z-index: 60` |
| 尺寸 | `48px × 48px`，圆形 |
| 背景 | `var(--tag-bg)` |
| 图标 | SVG 齿轮，`26px`，`stroke: var(--text-secondary)` |
| 按压 | `transform: scale(0.92)` |
| 点击 | toggle Dock 菜单 |

---

## 4. Dock 菜单

```
┌──────────────────────────────────┐
│                          ┌──────┐│
│                    ⚙ 设置 │ ⚙  ││
│                          └──────┘│
│                    ┌──────┐      │
│              ❤ 我的收藏 │ ❤  │    │
│                    └──────┘      │
│                    ┌──────┐      │
│            🕐 浏览记录 │ 🕐  │    │
│                    └──────┘      │
│                    ┌──────┐      │
│              ➕ 扩展位 │ ➕  │    │
│                    └──────┘      │
│                          ┌──┐    │
│                          │⚙ │    │ ← FAB
│                          └──┘    │
└──────────────────────────────────┘
```

| 属性 | 值 |
|------|-----|
| 遮罩 | `rgba(0,0,0,0.18)`，点击关闭 |
| 菜单项 | `background: var(--panel-bg)`，`backdrop-filter: blur(20px)`，`border: 1px solid var(--divider)`，`border-radius: 14px` |
| 内边距 | `padding: 10px 16px 10px 12px` |
| 图标区 | `30px × 30px`，`border-radius: 9px`，`background: var(--tag-bg)` |
| 图标 SVG | `18px`，`stroke: var(--text-secondary)`，统一描边风格 |
| 标签 | `14px`，`font-weight: 500`，`color: var(--text-primary)` |
| 入场动画 | 逐项 `translateY(20px) scale(0.8) → 0 scale(1)`，交错延迟 0/0.04/0.08/0.12s |

---

## 5. 侧边列表面板（左滑进入）

### 5.1 面板框架

| 属性 | 值 |
|------|-----|
| 触发方式 | 左滑手势（首页卡片区 touchstart→touchmove→touchend，dx < -60 打开） |
| 面板宽度 | `90%` 屏宽 |
| 背景 | `var(--bg-card)` |
| 入场动画 | `translateX(100%) → 0`，`0.3s cubic-bezier(0.4,0,0.2,1)` |
| 遮罩 | `var(--overlay)`，点击关闭 |
| 关闭方式 | 右滑 或 点击遮罩 或 点击列表项（定位后自动关闭） |
| 关闭按钮 | **无**（v5.3-final 已移除） |

### 5.2 面板头部

| 属性 | 值 |
|------|-----|
| 标题 | 「今日新闻」，`18px`，`font-weight: 700`，`letter-spacing: 1px` |
| 副标题 | 「科技 · 3 条」，`11px`，`color: var(--text-secondary)` |
| 内边距 | `padding: 100px 20px 12px`（顶部留状态栏空间） |

### 5.3 分类滚轮

| 属性 | 值 |
|------|-----|
| 容器 | `width: 60px; height: 216px`（6项 × 36px），`overflow: hidden` |
| 项高 | `36px` |
| idle 文字 | `10px`，`color: var(--wheel-text-idle)`（`rgba(0,0,0,0.12)`） |
| idle 选中项 | `12px`，`font-weight: 500`，`color: var(--wheel-selected-idle)` + `background: var(--highlight-bg)` |
| active 文字 | `11px`，`color: var(--wheel-text-active)`（`rgba(0,0,0,0.45)`） |
| active 选中项 | `scale(1.08)`，`font-weight: 500`，无边框无背景 |
| 锚定逻辑 | `translateY = max(0, -(curCat-1) × 36px)`，选中项固定第二行 |
| 滚动方式 | 触摸拖动 或 鼠标滚轮 |
| 分类列表 | 推荐 / 科技 / 国际 / 体育 / 生活 / 三农 / 收藏 |

### 5.4 极简标题列表

| 属性 | 值 |
|------|-----|
| 列表容器 | `flex: 1; overflow-y: auto; padding: 6px 0 32px` |
| 列表项 | `margin: 0 12px; padding: 8px 16px` |
| 标题 | `14px`，`font-weight: 600`，`color: var(--text-primary)`，`line-height: 1.4`，2行截断 |
| 当前项 | `color: var(--primary)` — **仅文字变色，无背景** |
| 按压反馈 | `background: var(--tag-bg)` |
| 点击行为 | 定位回首页对应卡片 + 关闭面板 |

---

## 6. 详情页

| 属性 | 值 |
|------|-----|
| 内容区 | `padding: 100px 18px 90px; overflow-y: auto` |
| 标题 | 衬线，`22px`，`line-height: 1.4` |
| 元信息 | `11px`，`color: var(--text-secondary)` |
| 正文 | `15px`，`color: var(--text-body)`，`line-height: 1.9` |
| 返回按钮 | ⌂ 首页图标，`top: 52px; left: 16px; z-index: 35` |

---

## 7. 手势系统

| 手势 | 场景 | 行为 |
|------|------|------|
| 上滑 | 首页卡片 | 下一条（dy < -40） |
| 下滑 | 首页卡片 | 上一条（dy > 40） |
| 左滑 | 首页 | 打开侧边列表面板（dx < -60） |
| 右滑 | 侧边面板 | 关闭面板 |
| 点击卡片 | 首页 | 进入详情页 |
| 点击列表项 | 侧边面板 | 定位首页 + 关闭面板 |
| 触摸滚轮 | 侧边分类栏 | 切换分类 |

---

## 8. 暗色模式

| 属性 | 浅色 | 暗色 |
|------|------|------|
| 高亮底 | `rgba(0,122,255,0.06)` | `rgba(10,132,255,0.10)` |
| 滚轮 idle 文字 | `rgba(0,0,0,0.12)` | `rgba(255,255,255,0.12)` |
| 滚轮选中 idle | `rgba(0,0,0,0.5)` | `rgba(255,255,255,0.5)` |
| 滚轮 active 文字 | `rgba(0,0,0,0.45)` | `rgba(255,255,255,0.45)` |
| Dock 面板 | `rgba(250,249,247,0.78)` | `rgba(13,13,13,0.78)` |
| 滑动提示渐变 | `transparent → var(--bg-card)` | `transparent → var(--bg-card)` |

---

## 9. 验收清单

| 验收项 | 标准 |
|--------|------|
| 全屏卡片上滑/下滑切换 | 动画流畅，`0.35s cubic-bezier` |
| 分类滚轮锚定第二行 | 选中项固定，淡蓝底色，scale(1.08) |
| 列表项 14px | 仅标题，当前项仅文字变色 |
| 面板无关闭按钮 | 右滑关闭 |
| 左滑手势阈值 | dx < -60 打开面板 |
| Dock 菜单毛玻璃 | `blur(20px)`，交错入场动画 |
| FAB 齿轮图标 | 48px 圆形，点击 toggle Dock |
| 暗色模式全部 token 生效 | 滚轮/Dock/高亮/渐变 |
| 进度条随翻页更新 | `transition: width 0.3s` |

---

> **UI-B7 列表页重新设计 v5.3-final** — 以原型 `ui-b7-list-redesign.html` 为唯一权威依据
