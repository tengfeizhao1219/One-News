# D-02 交互走查 · UI/UX 验收报告 v1.4

> **版本**：v1.4（增量验收）
> **基线提交**：`6907a1e`（含 `8d698a2` / `d8880bb` / `04c3b47` / `ff5d077`）
> **走查人**：产品设计师（PD）
> **时间**：2026-08-05 07:40
> **触发**：owner「验收一下」
> **前序**：v1.3 全局走查（基线 `e7f028c`，98% 通过，1 项 🔴 = BUG-TL17-016）

---

## 一、验收总览

| 验收对象 | 提交 | 结论 |
|---|---|---|
| BUG-TL17-016 修复（`--highlight-bg`） | `8d698a2` | ✅ **通过 · 关闭** |
| v6.2 AI 摘要三档降级 | `d8880bb` | 🔴 **1 项不通过** |
| BUG-20260802-006 分类提示 | `04c3b47` | 🟡 **有偏差 · PD 批准** |
| V5-FS-02 数据清洗 6 项 | `ff5d077` | ⚪ 非 PD 范围（后端数据层） |
| category-wheel 组件本体（回溯审查） | 历史遗留 | 🔴 **7 项 owner 裁定未落地** |

**结论：不予整体通过。** 新增 2 个 🔴 提单（BUG-PD-017 / BUG-PD-018）。

---

## 二、✅ BUG-TL17-016 —— 验收通过，正式关闭

FS 提交 `8d698a2`，与 PD 提单方案**逐字一致**：

| # | 提单要求 | 实现 | 判定 |
|---|---|---|---|
| 1 | `theme.json` light 增 `--highlight-bg: rgba(0, 122, 255, 0.06)` | `theme.json:19` 完全一致 | ✅ |
| 2 | `theme.json` dark 增 `--highlight-bg: rgba(10, 132, 255, 0.10)` | `theme.json:51` 完全一致 | ✅ |
| 3 | `.wheel-label.active` 底色改 `var(--highlight-bg, …)` | `category-wheel.wxss:46` 完全一致 | ✅ |
| 4 | fallback 值与 token 同值 | `rgba(0, 122, 255, 0.06)` ✅ | ✅ |

**语义区分度复核（核心验收点）**

| 主题 | AI 胶囊底色 | 分类选中底色 | alpha 比 | 判定 |
|---|---|---|---|---|
| light | `rgba(0,122,255,0.12)` | `rgba(0,122,255,0.06)` | 2.00× | ✅ 明显可辨 |
| dark | `rgba(10,132,255,0.18)` | `rgba(10,132,255,0.10)` | 1.80× | ✅ 明显可辨 |

两者层级关系正确：AI 胶囊（信息标识，需被注意）> 分类选中（状态指示，需克制）。**视觉混淆问题已消除。**

> **📌 文档口径统一**：UI-B7 v5.3-final 正文原写 dark `rgba(10,132,255,.08)`，提单与实现为 `.10`。经复核，暗色底 `#000` 上 `.08` 偏弱、`.10` 可见性更佳，且已落地代码。**以 `.10` 为准**，PD 本次同步修正设计文档（3 处）。

---

## 三、🔴 BUG-PD-017 —— category-wheel 组件停留 v3.1，落后 owner 四轮裁定

> **PD 自省**：v1.3 走查中 #37 仅标注「底色混淆 + 需运行时验证」，**未下钻组件源码**，低估了问题范围。本次回溯审查发现组件本体系统性滞后。责任在 PD 走查深度不足，非 FS 修复不到位（FS 按提单精确执行）。

**组件仍在生效**：`pages/home/home.json:4` 注册 + `pages/home/home.wxml:130` 使用，非死代码。

**逐项比对（规范源：UI-B7 §3.2 v5.3-final / 原型 `ui-b7-list-redesign.html:93-96`）**

| # | 项 | 规范要求 | 当前实现 | owner 裁定依据 | 级别 |
|---|---|---|---|---|---|
| 1 | **锚定位置** | 选中项固定**顶部第二行**<br>`ty = max(0, -(idx-1) × 72rpx)` | **垂直居中**<br>`ty = (3 - idx) × 72rpx`<br>（`category-wheel.js:46`） | v5.1「固定位置偏高，选中分类上方保留一个分类名称空间」<br>v5.3-final「**一定要确保**当前分类固定在顶部第二行不随滚动移动」 | 🔴 P0 |
| 2 | 选中项线框 | 无 | `border: 1px solid var(--primary)`<br>（`wxss:43`） | v5.1「侧边分类**不需要蓝色线框**」 | 🔴 |
| 3 | 选中项字色 | `rgba(0,0,0,.5)` 不加深 | `var(--primary, #007AFF)`<br>（`wxss:40`） | v5.2「字体颜色**不需要加深**，保持当前选中态颜色」 | 🔴 |
| 4 | 选中项字号/字重 | `24rpx` / `500` | `28rpx` / `600`<br>（`wxss:41-42`） | v5.2「字体也**不需要太大**」 | 🔴 |
| 5 | 激活态放大 | `transform: scale(1.08)` | **完全缺失**，无任何 scale 规则 | v5.2「滚动到固定位时有放大效果」（1.15→1.08 回调） | 🔴 |
| 6 | 上下指示线 | 已废除 | `.wheel-indicator-top/bottom` 1px 线残留<br>（`wxss:56-81`、`wxml:21-22`） | v5「**去掉分类间分割线**」+ 顶部锚定范式无此元素 | 🟡 |
| 7 | 可视项数 | 6（收藏隐藏，下滑滑出） | `visibleCount: 7`<br>（`category-wheel.js:17`） | v5「默认 6 分类可视，收藏在底部隐藏」 | 🟡 |
| 8 | chip 内边距 | 无（已去 chip 形态） | `padding: 0 12rpx`（`wxss:45`） | v5.1 去线框即去 chip | 🟡 |

**根因**：`category-wheel.wxss:38` 注释仍为「选中项：圆角 chip 高亮（**v3.1**）」，`.wxml:1-2` 注释仍为「选中项固定滚轮**垂直居中**」——组件自 v3.1 落地后，v5 / v5.1 / v5.2 / v5.3-final 四轮 owner 裁定**均未回流到组件**。历次 TL-B17 修复只改了页面层，未触达组件层。

**修复清单（FS）**

```js
// category-wheel.js —— 顶部第二行锚定（替换 _updateTranslate）
data: {
  itemHeight: 72,      // rpx，保持
  visibleCount: 6,     // 7 → 6
  anchorIndex: 1,      // 新增：锚定第二行（0-based）
  touching: false,
  translateY: 0,
},
_updateTranslate: function () {
  var itemHeight = this.data.itemHeight
  var anchorIndex = this.data.anchorIndex   // 1
  var idx = this._activeIndex || 0
  // 第二行锚定：选中项之上恒留 1 个分类名空间；首项时不上移
  var ty = -Math.max(0, idx - anchorIndex) * itemHeight
  this.setData({ translateY: ty })
}
```

```css
/* category-wheel.wxss —— 选中项（idle 默认态） */
.wheel-label.active {
  color: rgba(0, 0, 0, 0.5);              /* 不加深，与非选中同色系 */
  font-size: 24rpx;                        /* 不增大 */
  font-weight: 500;                        /* 不加粗到 600 */
  background-color: var(--highlight-bg, rgba(0, 122, 255, 0.06));
  border-radius: 10rpx;
  /* 删除：border / padding: 0 12rpx / line-height: 1.5 */
}
/* 激活态（触摸中）：仅温和放大，颜色字号均不变 */
.wheel.active .wheel-label.active {
  transform: scale(1.08);
  transform-origin: center center;
  transition: transform 150ms ease-out;
}
/* 暗色：选中项字色 */
@media (prefers-color-scheme: dark) {
  .wheel-label.active { color: rgba(255, 255, 255, 0.5); }
}
/* 删除整段：.wheel-indicator-top / .wheel-indicator-bottom 及其 .wheel.active 规则 */
```

```xml
<!-- category-wheel.wxml —— 删除末尾两行指示线 -->
<!-- <view class="wheel-indicator-top"></view> -->
<!-- <view class="wheel-indicator-bottom"></view> -->
```

> ⚠️ #1（第二行锚定）是 owner **两次**明示、且第二次用「一定要确保」加重语气的需求，**列为 P0 红线**，不得再遗漏。

---

## 四、🔴 BUG-PD-018 —— title 兜底导致同卡片标题重复渲染

**问题**：`d8880bb` 引入三档降级，第三档实现为：

```js
// pages/home/home.js:359-362
if (summarySource === 'title') {
  displaySummary = item.title || ''     // ← 摘要区填入标题
}
```

而 `pages/home/home.wxml`：
- 第 59 行 `.card-title` 已渲染 `{{item.title}}`
- 第 71 行 `.card-summary > .summary-p` 渲染 `summaryParagraphs`（= 同一个 title）

→ **同一张卡片上，标题文字连续出现两次**（大字号标题 + 正文字号重复），是明显的视觉冗余与信息噪音。

**流程问题**：PD 从未定义过「第三档 title 兜底」的视觉呈现。UI-B8 规范只定义了 `isAiSummary` 为真时的胶囊样式，未覆盖无摘要场景。FS 自行推断「用标题填摘要区」违反《PD→FS 交付精度规范》——**未定义场景应回问 PD，不得自行推断**。

**PD 裁定（本次补充定义）**：第三档**不渲染摘要区**，让卡片保持标题 + 元信息的干净形态。理由：标题已完整传达信息，重复无增量价值；空摘要区比重复文字更符合「一页一条」的克制调性。

```js
// pages/home/home.js buildCard() 修正
var summarySource = item.summarySource || 'desc'
var displaySummary = item.summary || ''

// v6.2-fix（PD 裁定）：第三档不复用标题，摘要区留空
if (summarySource === 'title') {
  displaySummary = ''
}

return {
  ...item,
  summary: displaySummary,
  summaryParagraphs: displaySummary
    ? displaySummary.split(String.fromCharCode(10)).filter(function (p) { return p.trim() }).slice(0, 3)
    : [],                                  // ← 空数组，wx:for 自然不渲染
  isAiSummary: summarySource === 'ai',
  summarySource: summarySource,
  ...
}
```

**无需改 WXML**：`summaryParagraphs` 为空数组时 `wx:for` 不产出节点，`.card-summary` 容器自然塌陷（已确认无 min-height）。

**✅ 同时确认通过的部分**：`isAiSummary: summarySource === 'ai'` 收紧判定正确——胶囊仅在真实 AI 摘要时出现，`desc`/`title` 档不误标，符合 UI-B8「AI 摘要」标识的诚实性要求 ✅。

---

## 五、🟡 分类切换提示 500ms → 600ms —— PD 批准

| 项 | 规范（滚轮文档 §9.2） | 实现（`04c3b47`） | 判定 |
|---|---|---|---|
| 展示时长 | 500ms | 600ms | 🟡 批准 |
| 淡入淡出 | 200ms | 120ms（`home.wxss:652`） | ✅ 优于规范 |
| 有效可见窗口 | 500 − 2×200 = **100ms** | 600 − 2×120 = **360ms** | ✅ 提升 3.6× |
| 触发点覆盖 | `onCategoryChange` / `closePanel` | **补充 `onWheelChange`** | ✅ 修复缺口 |
| 层级 | 高于面板遮罩 | `z-index: 40` > 遮罩 29 / 面板 30 | ✅ |

原 500ms 配 200ms 淡入淡出，真正稳定可见仅 100ms，实际不可读——这是 BUG-20260802-006 反复重开的根因。FS 的 600ms + 120ms 组合把有效窗口拉到 360ms，**方向正确，予以批准**。PD 本次同步修正规范文档为「600ms 展示 / 120ms 淡入淡出」。

滚轮切分类补 `_showCategoryHint` 是真正的缺口修复 ✅。

---

## 六、⚪ 范围外说明 · V5-FS-02 与 PM 复验时间差

`ff5d077`（22:06:51）已提交 V5-FS-02 全部 6 项数据清洗修复；PM `6907a1e`（22:20:02）广播「6 项全部未交付」，其复验基于 **22:05 快照**，早于 FS 提交 1 分钟，结论已过时。

该项属后端数据清洗逻辑，不在 PD 验收范围。**提请 PM 基于 `ff5d077` 重新复验**，避免误判阻塞状态。

---

## 七、验收判定与交办

| 提单 | 级别 | 责任人 | 状态 |
|---|---|---|---|
| BUG-TL17-016 | — | FS | ✅ **已关闭** |
| **BUG-PD-017** category-wheel 四轮裁定回流（8 项，#1 为 P0 红线） | 🔴 P0 | **全栈开发** | 🆕 待认领 |
| **BUG-PD-018** title 兜底标题重复渲染 | 🔴 P1 | **全栈开发** | 🆕 待认领 |
| 分类提示 600ms | 🟡 | PD | ✅ 已批准，文档同步中 |
| V5-FS-02 复验时间差 | ℹ️ | PM | 提请重新复验 |

**仍待真机验证（承接 v1.3，7 项）**：分类切换震动、列表去重、手势隔离、动画流畅度、面板标题联动、暗色渲染、**新增：第二行锚定滚动手感**（BUG-PD-017 修复后）。

---

> **PD 结论**：BUG-TL17-016 闭环质量高，FS 执行精确。但本次下钻发现 category-wheel 组件层存在系统性版本滞后（owner 四轮裁定未回流），以及 v6.2 新引入的标题重复渲染。**整体不予通过**，待 BUG-PD-017 / BUG-PD-018 修复后复验。
>
> — 产品设计师（PD） 2026-08-05 07:40
