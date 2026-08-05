# 一页 One-News · 优化项详细设计文档（DRD）

> **角色**：产品设计师（PD）｜**受众**：前端开发（FS）｜**状态**：已裁定，待落地
> **范围**：收藏页（UI-B10）· 详情页（UI-B11）· 设置页（UI-B9）· 首页修复项
> **前置依赖**：`theme.json` 双主题 token、现有 `pages/home` / `pages/detail` / `pages/favorites` / 设置面板

---

## 0. 总纲与手机端硬约束（FS 必须前置遵守）

本小程序运行于**手机端微信**，所有交互/展示逻辑以**真机手势 + 小屏竖屏**为前提，**禁止**用桌面 Web 思维落地。

1. **单位与基准**：视觉尺寸统一用 `rpx`（750 设计基准 = 屏幕宽）。安全区底部统一 `env(safe-area-inset-bottom)`，浮层/底栏按钮必须避让。
2. **颜色即 token**：所有色值取自 `theme.json`，开发**不得硬编码 HEX**（主题 token 已覆盖的语义色一律用变量）。暗色模式由主题切换自动接管，组件不得写死颜色分支。
3. **翻页手势语义**：列表/详情均为**整屏上滑=下一条、下滑=上一条**，判定 `70px + 500ms` 的 flick-only（慢拖不翻）。面板/菜单为点击或左滑呼出。
4. **动效时长约定**：整屏翻页 `350ms ease`；浮层/提示淡入淡出 `120–500ms`；心跳 `350ms`。
5. **图标机制（真机坑）**：SVG 图标全部走 `mask` + `background-color` 透出形状。**图标可见色 = 该元素的 background-color**，绝不能设为「与底色近似的浅色」，否则真机浅色模式下图标不可见（见 §4.1 事故）。

---

## 1. 收藏页 `pages/favorites`（UI-B10）

### 1.1 核心决策（owner 直裁）
- **不展示缩略图**。列表项 = 纯文字（标题 + 分类标签 + 来源·时间）。理由：收藏是「回顾清单」，文字密度 > 图文流；且省去 `thumbUrl` 存储与兜底复杂度。

### 1.2 页面结构
```
nav-bar:  「我的收藏」  ............  共 N 条（实时计数）
筛选胶囊: [全部][科技][世界][体育][生活]  (横滑，当前项 = --primary 实底白字)
列表:
  ┌──────────────────────────────────────┐
  │ 标题（最多 2 行截断）                    │
  │ [科技] 来源 · 2 小时前                  │
  └──────────────────────────────────────┘
  （每项 13rpx 上下 padding，底部 1rpx --divider 分隔）
空态 A（无收藏）:  📑 还没有收藏任何新闻 / 收藏后这里会按分类整理 / [去首页看看]
空态 B（筛选无结果）: 🔍 该分类下暂无收藏
```

### 1.3 交互规格
| 维度 | 规格 |
|---|---|
| 计数 | nav 右侧「共 N 条」；随筛选联动（全部=N / 某类=该类数）。数据源 `localCache.favorites.length` 实时派生 |
| 分类筛选 | 顶部横滑胶囊，纯前端 `filter` 数组，**不改底层 list**；当前项 `--primary` 实底白字，其余 `--tag-bg` 底 `--tag-text` 字 |
| 删除交互 | **长按列表项 500ms → ActionSheet「取消收藏 / 取消」**（微信原生习惯，零破坏）。ActionSheet 非长按菜单，不阻挡点击 |
| 取消收藏写入 | 乐观更新：先本地 `localCache.favorites` 移除 + 列表即时重渲染；再云端 `setUserFavorite(false)`；云端失败回滚并 toast |
| 长按 vs 点击 | 长按 500ms 触发删除；<500ms 松开视为普通点击（进详情）。用 `pointerdown` 起计时、`pointerup/leave/cancel` 清计时 |
| 空态 | 区分「无收藏」与「筛选无结果」两种文案 |

### 1.4 token 引用
`--text-primary`（标题）· `--text-secondary`（来源时间）· `--flash-tech/world/sports/life`（分类文字色，不套底色）· `--divider`（分隔线）· `--tag-bg`/`--tag-text`（胶囊未选中）· `--primary`（胶囊选中、空态引导按钮）

---

## 2. 详情页 `pages/detail`（UI-B11）

### 2.1 顶部阅读进度细条（**新增**，owner 反馈①：颜色调浅但需可见）
- 位置：紧贴 nav-bar 下方，`height: 3rpx`，底色 `--divider`。
- **进度色用新增 token `--progress`**（实色 `--primary` 太深，真机刺眼；过浅会完全看不见）：
  - light: `--progress: rgba(0, 122, 255, 0.55)`
  - dark:  `--progress: rgba(10, 132, 255, 0.60)`
  - ⚠️ **FS 需在 `theme.json` 的 light/dark 两处各加 `--progress`**，否则变量未定义。
- 宽度绑定：`width = scrollTop / (scrollHeight - clientHeight) * 100%`，在 `onContentScroll` 实时 `setData`，过渡 `width .08s linear`。

### 2.2 底部滑动提示（**与首页一致**，owner 反馈④）
- 文本「上滑阅读下一条」，位置在操作栏上方，`pointer-events: none`。
- **行为（home 与 detail 必须完全一致）**：
  1. 页面 `ready` 即显示；
  2. **停留 3.5s 后淡出**（`opacity` 过渡 `0.5s`）；
  3. **用户首次有效滑动（任意 flick）立即消失**；
  4. **同一页面会话内只出现一次**：detail 翻到下一条、home 切分类/刷新后均不再复现。
- 实现：数据态 `showSwipeHint`（默认 `true`）；`_startSwipeHintTimer()` 在 `ready` 后启动 3.5s 定时器置 `false`；`onTouchEnd` 在确认是有效 flick 后置 `false`。淡出用 `.fixed-swipe-hint.hide { opacity: 0; }`，**不要 `wx:if` 直接销毁**（需保留 DOM 完成过渡）。同会话内已消失后通过 `_swipeHintDismissed` 标记阻止再次触发。

### 2.3 收藏态强化（底部操作栏）
- 未收藏：图标 `favorite.svg` 描边 + label「收藏」。
- 已收藏（`is-favorited`）：label 改「已收藏」+ 图标填充 + 微高亮；点击切换时触发 `heart-anim`（心跳 `350ms`）。
- 色：`--color-favorite`（红），暗色 `--color-favorite` 已定义。

### 2.4 跨分类与边界（既有，保持不变）
- 跨分类翻页时分类闪烁条（`flashColor`）+ `positionText`（如 3/7）+ 分类名提示，逻辑沿用，不回退。

---

## 3. 设置页（UI-B9）

### 3.1 分组
显示组（跟随系统 + 深色模式）｜阅读组（4 档分段控制器 + 迷你新闻卡实时预览）｜关于组（版本 + 反馈 + 联系开发者）。**已移除 3 秒自动关闭**。

### 3.2 实时预览卡缩小（owner 反馈③：占空间太大）
迷你新闻卡用于「字号档位实时预览」，但原 padding/字号过大挤占设置项。缩小规格：

| token/选择器 | 原值 | 落地值 |
|---|---|---|
| `.preview-wrap` padding | `4rpx 16rpx 16rpx` | `2rpx 16rpx 10rpx` |
| `.preview-label` margin | `2rpx 2rpx 9rpx` | `2rpx 2rpx 6rpx` |
| `.preview-card` padding | `14rpx 16rpx` | `10rpx 14rpx` |
| `.pv-title` font-size | `calc(21rpx * --fs)` | `calc(17rpx * --fs)` |
| `.pv-meta` margin | `9rpx 0` | `6rpx 0` |
| `.pv-summary` | 全文 | 追加 `-webkit-line-clamp: 2` 截断为 2 行 |

> 仅缩小视觉占位，**不改变预览的实时缩放联动逻辑**（档位切换仍驱动 `--fs`）。

### 3.3 字体档位控制器
分段控制器 4 档：`标准 / 大 / 特大 / 超大`（tier 0–3，对应 `--fs` 1.0 / 1.15 / 1.3 / 1.5）；元信息 `--fsm` 封顶 1.15（UX-FIX-F12）。

---

## 4. 首页 `pages/home`（修复项）

### 4.1 ⚙ 浮动按钮空白圆圈（owner 反馈④：真机 bug，已定位根因）
- **根因**：`.floating-more`（FAB 本体）底色 `var(--tag-bg)`（浅灰）；其内部 `.more-icon` 用 `background-color: var(--bg-page)` 做「反色」透出 `settings.svg` 形状。但 `--bg-page` 也是浅色，与 FAB 浅灰近似 → 真机浅色模式下图标与底色融为一体 = **只剩一个空白圆圈**。
- **修复（已落地 `home.wxss`）**：
  ```css
  .more-icon {
    background-color: var(--text-secondary); /* 改前 var(--bg-page) */
  }
  ```
  与 `.more-item-icon` 同色，浅色/暗色模式均清晰可见。
- **规则**：任何 SVG-mask 图标的 `background-color` 必须取「与所在容器底色**强对比**」的语义色（如 `--text-secondary` / `--primary`），禁止取 `--bg-page` / `--tag-bg` 这类浅底。

### 4.2 底部滑动提示（owner 反馈④：与详情页一致）
- 完全复用 §2.2 的逻辑：进入 `ready` 显示 → 3.5s 淡出 → 首次有效滑动消失。
- 实现已在 `home.wxml / home.wxss / home.js` 落地：
  - `home.wxml`：`<view class="fixed-swipe-hint {{showSwipeHint ? '' : 'hide'}}" wx:if="...ready && !showPanel">`
  - `home.wxss`：`.fixed-swipe-hint { opacity:1; transition: opacity .5s }` + `.hide { opacity:0 }`
  - `home.js`：`data.showSwipeHint` + `_startSwipeHintTimer()`（3.5s）+ `onTouchEnd` 在有效 flick / 左滑呼出面板时置 `false`。

### 4.3 侧边栏面板修复（BUG-PD-019，owner 反馈"侧边列表不对 + 无法滑动返回"）
- **问题 A：列表显示"暂无新闻"**
  - 根因：`_syncPanelList()` 被调用时不传 `list` 参数，内部 `src` fallback 到 `this.data.newsList`，但此时 `setData({panelCategory})` 已异步执行，`newsList` 仍是旧分类数据 → filter 全量过滤 → 空列表。
  - 修复：`onWheelChange` 和 `onCategoryChange` 中同源切换分支，显式传入 `this.data.newsList` 调用 `_syncPanelList(this.data.newsList)`。
- **问题 B：侧边栏打开后无法右滑关闭**
  - 根因：`card-stage` 在 `showPanel=true` 时加 `.hidden { display: none }`，导致所有 `onTouchStart/onTouchEnd` 事件消失。
  - 修复：在 `slide-panel` 自身绑定 `bindtouchstart="onPanelTouchStart"` + `bindtouchend="onPanelTouchEnd"`，右滑 >50px 且横向位移大于纵向时触发 `closePanel()`。
- **附加修复**：切分类关闭面板时，`_swipeHintDismissed` 复位为 `false`，允许新分类的滑动提示再次出现。

### 4.4 其余保持不变
卡片流整屏翻页、左侧分类滚轮 + 右侧标题列表侧栏、dock 菜单（浏览记录/收藏/设置/扩展位）逻辑沿用 UI-B7 / TL-B16。

---

## 5. 主题 Token 速查（以 `theme.json` 为准）

| 语义 | light | dark |
|---|---|---|
| 页面底 | `--bg-page #F5F3F0` | `#000000` |
| 卡片底 | `--bg-card #FAF9F7` | `#0D0D0D` |
| 主文本 | `--text-primary #1C1C1E` | `#FFFFFF` |
| 次文本 | `--text-secondary #6B6B70` | `#999999` |
| 三级文本 | `--text-tertiary #8A8A8E` | `#666666` |
| 分隔线 | `--divider #E8E6E1` | `#1C1C1E` |
| 标签底 | `--tag-bg #EEECE8` | `#1C1C1E` |
| 主题蓝 | `--primary #007AFF` | `#0A84FF` |
| 进度蓝(新) | `--progress rgba(0,122,255,.55)` | `rgba(10,132,255,.60)` |
| 收藏红 | `--color-favorite #FF3B30` | `#FF453A` |
| 分类色 | `--flash-tech/world/sports/life` | 同 light 族 |

> FS 改色前先确认 token 是否已存在；新增语义色（如 `--progress`）须在 light/dark 双节点补齐。

---

## 6. 验收清单（Dev 自测，真机优先）

- [ ] **收藏页**：无缩略图；计数实时且随筛选联动；横滑胶囊选中态正确；**长按 500ms 出 ActionSheet**；取消收藏乐观更新 + 云端双写；两种空态文案区分；暗色全 token 生效。
- [ ] **详情页**：顶部 3rpx 进度条用 `--progress`（浅蓝可见，非实色）；宽度随滚动实时；**滑动提示 3.5s 淡出 + 首次滑动消失 + 同会话不重复出现**；收藏态 label/心跳正确；暗色 `--progress` 生效。
- [ ] **设置页**：实时预览卡明显缩小（padding/字号/2 行摘要）；档位切换预览实时缩放；暗色切换正常。
- [ ] **首页**：⚙ 按钮**真机浅色 + 暗色均可见齿轮**（无空白圆圈）；滑动提示 3.5s 淡出 + 首次滑动消失，与详情页表现一致；**侧边栏列表正确显示（非"暂无新闻"）+ 右滑可关闭面板**；其余交互无回归。
- [ ] **通用**：所有色值引用 token，无硬编码 HEX；安全区 `env(safe-area-inset-bottom)` 避让；动效时长符合 §0 约定。

---
*关联演示（已同步更新）：`docs/showcase/favorites-redesign.html` · `detail-redesign.html` · `settings-redesign.html` · 看板 `docs/index.html` → 🎨 交互原型*
