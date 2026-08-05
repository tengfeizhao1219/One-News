# DESIGN.md — 一页 One-News 设计语言系统 v2.0

> **状态**：✅ 权威版 — 以交互原型库前五个原型（UI-B11/B10/B9/B8/B7）为唯一依据
> **日期**：2026-08-05 | **角色**：产品设计师
> **原型来源**：https://tengfeizhao1219.github.io/One-News/

---

## 1. Visual Theme & Atmosphere（视觉主题与氛围）

**品牌设计哲学**：纸质阅读的数字化延伸 — 温暖、克制的类纸张质感，让新闻阅读回归专注。

**视觉基调**：
- 类纸质感：暖灰基底 + 微纹理感，模拟纸质触感
- 克制配色：蓝作为唯一强调色，其他元素退后
- 信息优先：装饰最小化，内容承载为第一目标
- 轻量交互：毛玻璃、微阴影、温和动画，不喧宾夺主

**核心视觉特征关键词**：纸质 / 克制 / 温润 / 聚焦 / 轻量

**光影与质感倾向**：微阴影（单层浅阴影）+ 毛玻璃（底部栏/面板）+ 低对比度分割线

---

## 2. Color Palette & Roles（调色板与角色）

### 2.1 核心色彩（1:1 取自五个原型 theme.json）

```css
/* ===== 浅色主题 ===== */
[data-theme="light"] {
  /* 页面基底 */
  --bg-page: #F5F3F0;          /* 页面背景 — 暖灰 */
  --bg-card: #FAF9F7;          /* 卡片/内容区背景 — 近白 */
  --bg-subtle: #F0EEEA;        /* 次级背景 — 微暗 */

  /* 文字层级 */
  --text-primary: #1C1C1E;     /* 主文字 — 近黑 */
  --text-secondary: #6B6B70;   /* 次级文字 */
  --text-body: #5E5E60;        /* 正文文字 */
  --text-tertiary: #8A8A8E;    /* 三级文字 */

  /* 分割与标签 */
  --divider: #E8E6E1;          /* 分割线 */
  --tag-bg: #EEECE8;           /* 标签背景 */
  --tag-text: #7A7A7A;         /* 标签文字 */

  /* 主色（唯一强调色） */
  --primary: #007AFF;          /* iOS Blue */
  --primary-subtle: rgba(0, 122, 255, 0.12);  /* 主色浅底 */

  /* 收藏 */
  --color-favorite: #FF3B30;                     /* 收藏红 */
  --color-favorite-tint: rgba(255, 59, 48, 0.10); /* 收藏高亮底 */

  /* 底部操作栏 */
  --bottom-bar-bg: rgba(250, 249, 247, 0.55);    /* 详情页底部栏 */

  /* 分类色（用于文字标识 + 闪烁条 + 分享卡片） */
  --flash-tech: #007AFF;
  --flash-world: #5856D6;
  --flash-sports: #FF9500;
  --flash-life: #34C759;

  /* 遮罩 */
  --overlay: rgba(0, 0, 0, 0.25);

  /* 设置页专用 */
  --setting-panel-bg: rgba(250, 249, 247, 0.78);
  --setting-panel-blur: blur(20px);
  --seg-bg: #E4E4E6;            /* 分段控制器底 */
  --seg-on-bg: #FFFFFF;         /* 分段控制器选中 */
  --seg-on-text: #1C1C1E;
  --switch-off: #E9E9EA;        /* iOS 开关关闭态 */
  --preview-bg: #FFFFFF;        /* 预览卡片背景 */

  /* 列表页高亮 */
  --highlight-bg: rgba(0, 122, 255, 0.06);        /* 列表选中淡蓝底 */

  /* 列表页侧边滚轮 */
  --wheel-text-idle: rgba(0, 0, 0, 0.12);
  --wheel-selected-idle: rgba(0, 0, 0, 0.5);
  --wheel-text-active: rgba(0, 0, 0, 0.45);

  /* Toast / Chip */
  --chip-bg: rgba(28, 28, 30, 0.85);
  --chip-text: #FFFFFF;
}
```

```css
/* ===== 暗色主题 ===== */
[data-theme="dark"] {
  --bg-page: #000000;
  --bg-card: #0D0D0D;
  --bg-subtle: #1A1A1C;

  --text-primary: #FFFFFF;
  --text-secondary: #999999;
  --text-body: #D4D4D4;
  --text-tertiary: #666666;

  --divider: #1C1C1E;
  --tag-bg: #1C1C1E;
  --tag-text: #999999;

  --primary: #0A84FF;
  --primary-subtle: rgba(10, 132, 255, 0.18);

  --color-favorite: #FF453A;
  --color-favorite-tint: rgba(255, 69, 58, 0.16);

  --bottom-bar-bg: rgba(13, 13, 13, 0.55);

  --flash-tech: #60A5FA;
  --flash-world: #818CF8;
  --flash-sports: #FBBF24;
  --flash-life: #34D399;

  --overlay: rgba(0, 0, 0, 0.7);

  --setting-panel-bg: rgba(13, 13, 13, 0.78);
  --seg-bg: #2C2C2E;
  --seg-on-bg: #636366;
  --seg-on-text: #FFFFFF;
  --switch-off: #39393D;
  --preview-bg: #141416;

  --highlight-bg: rgba(10, 132, 255, 0.10);

  --wheel-text-idle: rgba(255, 255, 255, 0.12);
  --wheel-selected-idle: rgba(255, 255, 255, 0.5);
  --wheel-text-active: rgba(255, 255, 255, 0.45);

  --chip-bg: rgba(255, 255, 255, 0.15);
}
```

### 2.2 分类色彩映射

| 分类 | 浅色文字色 | 暗色文字色 | 浅色底 | 用途 |
|------|-----------|-----------|--------|------|
| 科技 | `#007AFF` | `#60A5FA` | `rgba(0,122,255,0.08)` | 分类标签/分享卡片 |
| 国际 | `#5856D6` | `#818CF8` | `rgba(88,86,214,0.08)` | 同上 |
| 体育 | `#FF9500` | `#FBBF24` | `rgba(255,149,0,0.08)` | 同上 |
| 生活 | `#34C759` | `#34D399` | `rgba(52,199,89,0.08)` | 同上 |
| 推荐 | `#FF3B30` | `#FF453A` | — | 分享卡片 |

### 2.3 语义色

| Token | 浅色 | 暗色 | 用途 |
|-------|------|------|------|
| `--color-favorite` | `#FF3B30` | `#FF453A` | 收藏图标/标签 |
| `--color-favorite-tint` | `rgba(255,59,48,0.10)` | `rgba(255,69,58,0.16)` | 已收藏按钮底 |
| `--progress` | `rgba(0,122,255,0.55)` | `rgba(10,132,255,0.60)` | 阅读进度条 |

---

## 3. Typography Rules（排版规则）

### 3.1 字体族

```css
/* 系统 UI 文字 */
font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif;

/* 正文衬线 */
font-family: "PingFang SC", "Noto Serif SC", "Songti SC", Georgia, serif;
```

### 3.2 字号层级表（1:1 取自五个原型）

| 层级 | 用途 | 字号 rpx | 字号 px | 字重 | 行高 | 字距 | 字体族 |
|------|------|---------|---------|------|------|------|--------|
| Display | 全屏卡片标题 | 52rpx | 26px | 700 | 1.35 | -0.5px | 系统 |
| Hero | 详情页标题 | 44rpx | 22px | 700 | 1.45 | -0.3px | 系统 |
| H1 | 页面标题 | 36rpx | 18px | 700 | 1.4 | 1px | 系统 |
| H2 | 设置页标题 | 34rpx | 17px | 600 | 1.4 | — | 系统 |
| H3 | 卡片标题 | 32rpx | 16px | 600 | 1.4 | — | 系统 |
| H4 | 侧栏列表标题 | 28rpx | 14px | 600 | 1.4 | — | 系统 |
| Body | 正文 | 32rpx | 16px | 400 | 2.0 | 0.5px | 衬线 |
| Body-S | 元信息/标签 | 24rpx | 12px | 400 | 1.4 | — | 系统 |
| Caption | 辅助文字 | 22rpx | 11px | 400 | 1.4 | — | 系统 |
| Nano | 分类标签 | 18rpx | 9px | 500 | 1.4 | — | 系统 |

### 3.3 字号缩放系统

```
scaleMap = [1.0, 1.15, 1.3, 1.5]
META_SCALE_CAP = 1.15（元信息不跟随放大超过此值）

tier 0 (标准): --fs=1     — 默认
tier 1 (大):   --fs=1.15  — 对标系统 18px 级
tier 2 (特大): --fs=1.3   — 对标系统 20px 级
tier 3 (超大): --fs=1.5   — 对标系统 24px+ 级
```

所有文字字号：`calc(Xrpx * var(--fs))`
所有元信息字号：`calc(Xrpx * var(--fsm))`，其中 `--fsm = min(--fs, 1.15)`

---

## 4. Component Stylings（组件样式）

### 4.1 底部操作栏（详情页）

```css
.detail-bottom-bar {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 20;
  display: flex;
  height: calc(64px + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--bottom-bar-bg);                /* rgba(250,249,247,0.55) */
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: 1px solid var(--divider);
}

.bottom-bar-btn {
  flex: 1;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 3px;
  font-size: calc(12px * var(--fsm));
  color: var(--text-secondary);
  transition: transform 0.12s;
}
.bottom-bar-btn:active { transform: scale(0.92); }

/* 已收藏态 */
.bottom-bar-btn.faved {
  background: var(--color-favorite-tint);
}
.bottom-bar-btn.faved .icon { color: var(--color-favorite); }
.bottom-bar-btn.faved .label { color: var(--color-favorite); font-weight: 600; }

/* 心跳动画 */
@keyframes heartBeat {
  0%   { transform: scale(1); }
  30%  { transform: scale(1.3); }
  60%  { transform: scale(0.9); }
  100% { transform: scale(1); }
}
.bottom-bar-btn.beat .icon { animation: heartBeat 0.3s ease-out; }
```

### 4.2 按钮变体

| 变体 | 背景 | 文字色 | 边框 | 圆角 | padding | hover | active |
|------|------|--------|------|------|---------|-------|--------|
| Primary | `--primary` | `#FFF` | 无 | 8px | 7px 14px | — | scale(0.96) |
| Secondary | `--panel` | `--panel-text` | `1px solid --panel-line` | 8px | 7px 14px | border→`--primary` | — |
| Ghost | transparent | `--panel-text` | 无 | 8px | 7px 14px | — | `--tag-bg` |

### 4.3 卡片（首页全屏卡）

```css
.fs-card {
  background: var(--bg-card);
  border-radius: 10px;
  /* 无边框、无阴影 — 全屏沉浸 */
}
.fs-card .title { font-size: 26px; font-weight: 700; line-height: 1.35; }
.fs-card .meta { font-size: 11px; color: var(--text-secondary); }
.fs-card .summary { font-size: 16px; color: var(--text-body); line-height: 1.85; font-family: var(--serif); }
```

### 4.4 列表项（侧边栏列表）

```css
.list-item {
  margin: 0 12px;
  padding: 8px 16px;
  cursor: pointer;
}
.list-item h4 { font-size: 14px; color: var(--text-primary); font-weight: 600; line-height: 1.4; }
.list-item.current h4 { color: var(--primary); }  /* v5.3-final: 仅文字色，无背景 */
.list-item:active { background: var(--tag-bg); }
```

### 4.5 收藏卡片（收藏页列表）

```css
.fav-card {
  display: flex; gap: 12px;
  padding: 13px 0;
  border-bottom: 1px solid var(--divider);
  /* 无缩略图（owner 决策） */
}
.fav-card .title { font-size: calc(16px * var(--fs)); color: var(--text-primary); line-height: 1.4; }
.fav-card .meta { margin-top: 8px; font-size: calc(12px * var(--fsm)); color: var(--text-secondary); }
.fav-card .chip { padding: 1px 8px; border-radius: 8px; background: var(--tag-bg); font-size: 11px; font-weight: 500; }
/* 分类色：.c-tech { color: --flash-tech } .c-world { color: --flash-world } 等 */
```

### 4.6 分类筛选胶囊

```css
.fav-filters .fc {
  flex-shrink: 0; font-size: 13px;
  padding: 6px 14px; border-radius: 16px;
  background: var(--tag-bg); color: var(--tag-text);
  transition: all 0.15s;
}
.fav-filters .fc.on { background: var(--primary); color: #fff; }
```

### 4.7 AI 摘要胶囊（UI-B8 A-1）

```css
.ai-chip {
  display: inline-block; vertical-align: middle;
  margin: 0 6px 0 0;           /* 仅右边距，防撑开行盒 */
  padding: 1.5px 7px;          /* 3rpx 14rpx */
  border-radius: 8px;          /* 16rpx */
  font-size: calc(11px * var(--fsm));
  font-weight: 500; line-height: 1.4; letter-spacing: 0;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
  /* A-1：主题色轻胶囊 */
  color: var(--primary);
  background: var(--primary-subtle);
  /* 无边框、无阴影、无动效、不可点击 */
}
```

### 4.8 iOS 开关

```css
.switch { width: 51px; height: 31px; border-radius: 16px; background: var(--switch-off); }
.switch.on { background: var(--primary); }
.switch .knob { width: 27px; height: 27px; border-radius: 50%; background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.22);
  position: absolute; top: 2px; left: 2px;
  transition: left 0.22s; }
.switch.on .knob { left: 22px; }
```

### 4.9 分段控制器

```css
.seg { display: flex; background: var(--seg-bg); border-radius: 9px; padding: 2px; }
.seg button { flex: 1; border: none; background: transparent;
  font-size: 13px; padding: 7px 0; border-radius: 7px;
  color: var(--text-primary); }
.seg button.on {
  background: var(--seg-on-bg); color: var(--seg-on-text);
  box-shadow: 0 1px 3px rgba(0,0,0,0.14); font-weight: 600; }
```

### 4.10 ActionSheet（长按取消收藏）

```css
.sheet-mask { position: absolute; inset: 0; background: var(--overlay); z-index: 50; }
.sheet { position: absolute; left: 0; right: 0; bottom: 0;
  background: var(--bg-card); border-radius: 16px 16px 0 0;
  padding: 8px 0 18px; z-index: 51;
  transform: translateY(100%); transition: transform 0.25s; }
.sheet.show { transform: translateY(0); }
.sheet .si { padding: 15px; text-align: center; font-size: 16px; color: var(--text-primary); }
.sheet .si.danger { color: var(--color-favorite); }
.sheet .si.cancel { color: var(--text-secondary); border-top: 8px solid var(--bg-page); }
```

### 4.11 Toast

```css
.toast {
  position: absolute; left: 50%; bottom: 28px;
  transform: translateX(-50%) translateY(8px);
  background: rgba(0, 0, 0, 0.82); color: #fff;
  padding: 10px 18px; border-radius: 10px;
  font-size: 13px;
  opacity: 0; transition: all 0.22s;
  z-index: 200; white-space: nowrap;
}
.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
```

---

## 5. Layout Principles（布局原则）

### 5.1 间距系统

```
基准单位：4px（8rpx）

常用间距：
  xs:   8rpx  (4px)   — 图标与文字间距
  sm:  16rpx  (8px)   — 紧凑间距
  md:  24rpx  (12px)  — 卡片内边距
  lg:  32rpx  (16px)  — 区块间距
  xl:  48rpx  (24px)  — 大区块间距
 2xl:  64rpx  (32px)  — 页面内边距
```

### 5.2 页面框架

```
手机宽度：375px（750rpx）
内容区 padding：16px（32rpx）两侧
详情页正文 padding：28px（56rpx）两侧
```

### 5.3 容器约束

| 容器 | max-width | padding |
|------|-----------|---------|
| 正文内容 | — | 0 28px |
| 卡片内容 | — | 0 32px（全屏卡） |
| 列表内容 | — | 0 16px |
| 设置页组 | — | 0 16px |

### 5.4 留白哲学

- **内容优先**：正文区宽松留白（28px 两侧），最大化阅读舒适度
- **分组清晰**：设置页用 22px 间距 + 圆角卡片分组，信息层次一目了然
- **底部呼吸**：scroll-view 底部预留操作栏高度 + 32rpx 额外空间
- **卡片不拥挤**：收藏列表卡片间距 13px 上下内边距 + 分割线

---

## 6. Depth & Elevation（深度与层级）

### 6.1 阴影系统

```css
/* 手机外框阴影（原型展示用，非实际 app） */
--phone-shadow: 0 4px 22px rgba(0, 0, 0, 0.10);

/* 底部操作栏 — 无阴影，仅毛玻璃 */
/* 设置面板 — 无阴影，仅毛玻璃 + 顶部分割线 */

/* 分段控制器选中态 */
--seg-shadow: 0 1px 3px rgba(0, 0, 0, 0.14);

/* iOS 开关 knob */
--knob-shadow: 0 1px 3px rgba(0, 0, 0, 0.22);
```

### 6.2 表面层级

```
Z-index 层级：
  0-9:   内容层（正文、列表）
  10:    底部滑动提示
  19:    滑动提示渐隐层
  20:    底部操作栏
  25:    网络兜底 Toast
  30:    导航/进度条
  40-41: 设置面板（遮罩+面板）
  50-51: ActionSheet（遮罩+面板）
  55-58: Dock 菜单
  60:    FAB 浮动按钮
  70-71: 侧边列表面板
  90:    全局 Toast
  200:   手机内 Toast
```

### 6.3 毛玻璃效果

```css
backdrop-filter: blur(20px);
-webkit-backdrop-filter: blur(20px);
/* 使用场景：底部操作栏、设置半屏面板、Dock 菜单 */
```

---

## 7. Do's and Don'ts（设计规范与禁忌）

### Do's

1. ✅ **所有色值走 CSS 变量** — 禁止硬编码 HEX 值，必须通过 `var(--token)` 引用
2. ✅ **字号统一用 `calc()` 包裹** — 正文 `calc(16px * var(--fs))`，元信息 `calc(12px * var(--fsm))`
3. ✅ **收藏色统一 `#FF3B30`（浅色）/ `#FF453A`（暗色）** — 不再使用 `#FF4D4F`
4. ✅ **底部操作栏用毛玻璃** — `backdrop-filter: blur(20px)` + `rgba` 半透明背景
5. ✅ **收藏页不展示缩略图** — owner 决策：仅标题 + 分类标签 + 来源·时间
6. ✅ **列表页选中项仅文字变色** — v5.3-final：`color: var(--primary)`，无背景/边框
7. ✅ **AI 摘要胶囊不可点击** — 不绑 bindtap、不加 hover-class
8. ✅ **设置页为独立全屏页** — `/pages/settings/`，不再用半屏面板

### Don'ts

1. ❌ **不要给底部操作栏纯白背景** — 必须用毛玻璃 `rgba(250,249,247,0.55)` + `blur(20px)`
2. ❌ **不要用 `#FF4D4F` 作为收藏色** — 权威值是 `#FF3B30`
3. ❌ **不要在收藏列表展示缩略图** — owner 已明确决策
4. ❌ **不要给侧栏列表选中项加背景色** — 仅文字变色（v5.3-final）
5. ❌ **不要把"关于·反馈"放在操作栏底部** — 应在设置页「关于」组
6. ❌ **不要给 AI 摘要胶囊加点击事件** — 它是静态标识
7. ❌ **不要在设置面板加 3 秒自动关闭** — 用户自主返回
8. ❌ **不要给列表页加关闭按钮** — v5.3-final 已移除，右滑关闭即可

---

## 8. Responsive Behavior（响应式行为）

### 8.1 设计基准

```
设计基准宽度：375px（750rpx）
1rpx = 0.5px（在 375px 屏宽下）
所有尺寸使用 rpx 单位，微信框架自动缩放
```

### 8.2 安全区域

```css
/* 底部安全区 */
padding-bottom: env(safe-area-inset-bottom);
/* 使用场景：底部操作栏、设置面板、ActionSheet */

/* 顶部安全区 */
padding-top: env(safe-area-inset-top);
/* 使用场景：状态栏区域 */
```

### 8.3 触摸目标

```
最小触摸热区：88rpx（44px）— 符合 iOS HIG
通过 padding 扩大热区（如底部栏按钮 padding: 20rpx 0）
```

### 8.4 字号缩放适配

```
所有正文/标题：跟随 --fs（1.0 / 1.15 / 1.3 / 1.5）
元信息（时间/来源/标签）：封顶 --fsm = min(--fs, 1.15)
图标/结构尺寸：固定 rpx 值，不缩放
行高：随字号同步缩放 calc(Y * var(--fs))
```

---

## 9. Agent Prompt Guide（AI 代理提示指南）

### 9.1 快速参考

```
项目：一页 One-News 微信小程序
设计基准：375px 屏宽，rpx 单位
主色：#007AFF（浅色）/ #0A84FF（暗色）
收藏色：#FF3B30（浅色）/ #FF453A（暗色）
底部栏：毛玻璃 rgba(250,249,247,0.55) + blur(20px)
字号缩放：--fs ∈ {1, 1.15, 1.3, 1.5}，元信息封顶 1.15
字体：系统无衬线（UI）/ PingFang SC + 衬线（正文）
```

### 9.2 组件生成 Prompt 示例

**详情页底部操作栏**：
```
生成微信小程序详情页底部固定操作栏：
- 高度 calc(64px + env(safe-area-inset-bottom))
- 毛玻璃背景 rgba(250,249,247,0.55) + blur(20px)
- 左：收藏按钮（♡→♥，#FF3B30，heartBeat 300ms）
- 右：分享按钮（↗，open-type="share"）
- 已收藏态：label「已收藏」+ 淡红底色 + 图标实心
```

**AI 摘要胶囊**：
```
在摘要首段行首内联 AI 摘要胶囊：
- 文案「AI 摘要」（含半角空格）
- 样式：inline-block，淡蓝底 rgba(0,122,255,0.12)，蓝字 #007AFF
- 尺寸：padding 1.5px 7px，border-radius 8px，font-size 11px
- 不可点击，无边框无阴影
- 多段仅首段出现，摘要为空不渲染
```

**收藏页列表**：
```
生成收藏页卡片化列表：
- 无缩略图（owner 决策）
- 标题 2 行截断 + 分类标签（彩色文字）+ 来源·时间
- 顶部分类筛选胶囊（全部/科技/国际/体育/生活）
- 长按→ActionSheet「取消收藏」
- 空态：「还没有收藏任何新闻」+ 引导按钮
```

**设置页**：
```
生成独立全屏设置页 /pages/settings/：
- 显示组：跟随系统开关 + 深色模式开关
- 阅读组：分段控制器（标准/大/特大/超大）+ 实时预览卡
- 关于组：版本号 + 意见反馈 + 联系开发者（可展开）
- 导航返回（不自动关闭）
```

**列表页侧边栏**：
```
生成侧边新闻列表面板（左滑进入）：
- 左侧分类滚轮：选中项固定第二行，淡蓝底色 highlight-bg
- 右侧列表：仅标题 14px，当前项仅主题色文字（无背景）
- 无关闭按钮（右滑关闭）
- 分类间无分割线
```

### 9.3 AI 生成 UI 迭代建议

1. 所有色值必须通过 CSS 变量引用，禁止硬编码 HEX
2. 字号必须用 calc() 包裹以支持缩放
3. 底部栏背景必须用毛玻璃，不能是纯色
4. 收藏色统一 #FF3B30，不用 #FF4D4F
5. 列表选中态仅文字变色，不加背景
6. AI 摘要胶囊不可点击
7. 设置页是独立全屏页，不是半屏面板
8. 收藏列表无缩略图
9. 触摸热区 ≥ 88rpx
10. 暗色模式所有 token 同步适配

---

> **DESIGN.md v2.0** — 以交互原型库前五个原型为唯一权威依据
> **原型来源**：UI-B11（详情）/ UI-B10（收藏）/ UI-B9（设置）/ UI-B8（AI摘要）/ UI-B7（列表）
> **关联文档**：D-02 交互原型 | D-03 视觉设计 | A-12b 交互评审 | A-12c 视觉评审
