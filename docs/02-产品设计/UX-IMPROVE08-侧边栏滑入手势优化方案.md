# UX-IMPROVE08 · 侧边栏滑入手势优化方案

> **任务 ID**：UX-IMPROVE08 | **角色**：交互设计师 | **日期**：2026-08-02
> **状态**：✅ 方案交付（待研发评审）
> **依赖**：无（独立于其他在途任务）
> **输入**：`线框图与交互原型.md` §三（侧边栏现状）、`pages/home/touch.wxs`（当前手势实现）、`home.js`（showPanel 机制）
> **输出**：左滑阈值检测 + 触觉反馈的完整交互规格 + 前端实现指引（WXS ES5 约束）

---

## 一、背景与问题

### 1.1 现状（代码实测）

当前侧边栏由 `home.js` 的 `showPanel` 布尔量驱动，通过 CSS class `.slide-panel.show` 切换：

```
左滑 → touch.wxs 检测方向锁 → onWxsTouchEnd → JS setData({showPanel:true}) → CSS 动画弹出
```

`touch.wxs` 水平分支（第 84-86 行）**是空操作**：

```js
if (touchState.isDragging && Math.abs(dx) > Math.abs(dy)) {
  // 水平滑动中，不处理垂直逻辑   ← 仅占位，不跟手、不判定阈值
}
```

### 1.2 三个核心缺口

| # | 缺口 | 用户感知 | 严重度 |
|---|------|----------|:----:|
| G1 | **无跟手反馈** | 面板不随手指移动，滑到一半松手面板"凭空弹出"，缺乏操控感 | 中 |
| G2 | **无 commit/abort 阈值** | 任何 >10rpx 的水平滑动都触发打开；误触（如滚动列表时轻微横移）也会弹出 | 高 |
| G3 | **无触觉反馈** | 跨过"是否打开"的临界点时没有任何物理确认，尤其对视障/单手用户不友好 | 中 |

---

## 二、设计目标

1. **精确触发**：引入双阈值（位移 + 速度），区分"有意打开"与"误触"，误触率降至 < 5%
2. **跟手操控**：面板实时跟随手指位移，遮罩透明度随进度渐变，用户随时可见"滑到哪算够"
3. **触觉确认**：跨过打开/关闭阈值的瞬间触发一次轻震动，提供物理锚点
4. **零回归**：垂直滑动（卡片切换）逻辑完全不动；axis-lock 机制保留

---

## 三、核心设计决策

### 3.1 双阈值模型（Displacement + Velocity）

单一位移阈值在"慢拖未达标"和"快甩位移小"两种场景会误判。采用**位移 OR 速度**的复合判定：

| 参数 | 值 | 说明 |
|------|:---:|------|
| 面板宽 `W` | 屏宽 × 80% | 实测 ≈ 300rpx @375 逻辑屏 |
| 提交阈值 `T_open` | `W × 30%` | 运行时计算，约 90rpx；跨过即"将打开" |
| 速度阈值 `V_commit` | **0.5 px/ms** | 快速一甩（fling）意图明确，放宽位移要求 |
| 方向锁 `LOCK` | 水平位移 > 10rpx 且 `|dx| > |dy|` | 沿用现状，首帧锁定 |

**判定逻辑（松手时）**：

```
打开（左滑松手）：
  IF |dx| ≥ T_open  OR  瞬时速度 ≥ V_commit  →  提交打开
  ELSE                                            →  取消，回弹关闭

关闭（右滑松手，面板已开）：
  IF |dx| ≥ T_open  OR  瞬时速度 ≥ V_commit  →  提交关闭
  ELSE                                            →  取消，回弹保持打开
```

### 3.2 跟手（Follow-Finger）

拖拽中面板 `translateX` 实时等于 `-offsetX`（从 100% 向 0 收敛），遮罩 `opacity` 随进度 `p = |offsetX| / W` 从 0 → 0.4 渐变。

```
p < 0.3  → 面板半透、未"吸附"
p ≥ 0.3  → 面板"贴附"感：轻微缓动微调（视觉提示已越过临界点）
```

### 3.3 触觉反馈（Haptic）

| 触发时机 | API | 档位 | 次数 |
|----------|-----|:----:|:----:|
| **左滑跨过 `T_open` 瞬间** | `wx.vibrateShort` | `light` | 1 |
| **右滑跨过 `T_open` 瞬间**（关闭） | `wx.vibrateShort` | `light` | 1 |

**约束**：
- 同一拖拽过程只触发**一次**（标志位 `hapticFired`，跨过瞬间置位，touchend 重置）
- WXS 视图层**不能**直接调 `wx.vibrateShort` → 必须在跨阈值帧 `callMethod('onWxsThresholdCross', {dir})` 通知 JS 层执行
- 失败兜底：`try` 包裹，Android 不支持 `type` 参数或系统关闭震动时不报错
- 设置项「手势震动反馈」默认开，用户可关（关后保留跟手，仅不震）

---

## 四、交互状态机

```
                  ┌─────────────────────────────────────────┐
                  │           空闲态 (showPanel=false)        │
                  └───────────────────┬─────────────────────┘
                                      │ touchstart
                                      ▼
                          ┌───────────────────────┐
                          │  等待方向锁 (LOCK=10rpx) │
                          └───┬───────────────┬─────┘
                  水平优先    │               │  垂直优先
                              ▼               ▼
                  ┌──────────────────┐  ┌──────────────────┐
                  │ 水平拖拽中        │  │ 垂直拖拽中        │
                  │ 面板跟手 translateX│  │ (卡片切换逻辑不变) │
                  │ 遮罩 opacity=p    │  └──────────────────┘
                  │ p跨0.3→震动1次    │
                  └───┬──────────┬───┘
              松手     │          │  松手
        |dx|≥T 或 V≥Vc │          │ |dx|<T 且 V<Vc
                      ▼          ▼
              ┌────────────┐  ┌────────────┐
              │ 提交打开    │  │ 取消回弹    │
              │ 300ms ease │  │ 250ms ease │
              └─────┬──────┘  └─────┬──────┘
                    ▼              ▼
           ┌──────────────────────────────┐
           │   打开态 (showPanel=true)      │◄── 右滑同理可关闭
           └──────────────────────────────┘
```

---

## 五、详细参数表

| 项目 | 值 | 备注 |
|------|:---:|------|
| 方向锁触发 | 水平位移 > 10rpx 且 `|dx| > |dy|` | 沿用现状 |
| 提交位移阈值 `T_open` | `面板宽 × 30%` | 运行时算，约 90rpx |
| 速度阈值 `V_commit` | 0.5 px/ms | fling 意图判定 |
| 跟手位移上限 | 面板宽 `W`（不超出屏幕） | clamp |
| 遮罩透明度 | `0 → 0.4 × p` | 随进度线性 |
| 打开动画 | translateX 100%→0, 300ms ease-out | 对齐设计语言 |
| 回弹动画 | translateX → 100%, 250ms ease-out | 对齐设计语言 |
| 触觉档位 | `light` | iOS 三档/Android 忽略 type |
| 触觉次数 | 单次（每拖拽） | `hapticFired` 防重 |
| 速度采样窗口 | 末 3 帧 `dx` 均值 / `dt` | 防抖动 |

---

## 六、手势冲突处理（与卡片切换共存）

现状 `touch.wxs` 的 axis-lock 机制**保持不变**：

```js
// 水平优先
if (!isDragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) isDragging = true
// 垂直优先
if (!isDragging && Math.abs(dy) > 5) { isDragging = true; direction = dy<0?1:-1 }
```

**本方案仅扩展水平分支**，垂直分支（卡片上滑切换）零改动。一旦方向锁定，整段拖拽归属该轴，不会在中途切换。

---

## 七、动效参数（对齐设计语言 v2.0）

| 动效 | 属性 | 起始 | 结束 | 时长 | 缓动 |
|------|------|------|------|:----:|------|
| 面板跟手 | translateX | 实时 `offsetX` | — | — | 无 transition（跟手） |
| 提交打开 | translateX | 当前 `offsetX` | 0 | 300ms | ease-out |
| 取消回弹 | translateX | 当前 `offsetX` | 100% | 250ms | ease-out |
| 遮罩渐变 | opacity | `0.4×p` | 0.4 / 0 | 跟随位移 | linear |
| 触觉 | vibrateShort | — | — | 15ms | light |

> 来源：设计语言 v2.0 §圆角 & 动效 — `--ease-normal: 300ms ease` 复用。

---

## 八、无障碍 & 暗色模式

| 维度 | 处理 |
|------|------|
| **视障用户** | 震动是关键的导航物理锚点；建议设置项默认开「手势震动反馈」 |
| **减少动态效果** | 若系统 `prefers-reduced-motion: reduce`，保留跟手位移，但回弹/打开动画缩短至 150ms |
| **暗色模式** | 面板背景、遮罩透明度沿用 `theme.json` 双模式变量，无需额外适配 |
| **单手操作** | 阈值 30% 宽 + 速度放宽，确保拇指根部小幅滑动也能触发 |

---

## 九、前端实现指引（WXS ES5 约束）

> ⚠️ WXS 仅支持 ES5 子集：**禁用** `let/const/箭头函数/模板字符串/解构/try-catch`。
> 触觉必须由 JS 层执行（WXS 不能调 `wx.*`）。

### 9.1 touch.wxs 水平分支扩展（伪代码，ES5 安全）

```js
// 在 touchState 新增：
//   offsetX: 0, panelWidth: 300, hapticFired: false, lastX: 0, lastT: 0, vel: 0

function handleTouchMove(event, ownerInstance) {
  var touch = event.touches[0]
  var dx = touch.clientX - touchState.startX
  var dy = touch.clientY - touchState.startY

  // 水平优先锁（沿用）
  if (!touchState.isDragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
    touchState.isDragging = true
    touchState.axis = 'h'
  }
  // 垂直优先锁（沿用，direction 判定不动）

  // —— 新增：水平跟手 + 阈值 + 触觉 ——
  if (touchState.isDragging && touchState.axis === 'h') {
    var clamped = dx
    if (clamped > 0) clamped = 0            // 左滑为负，限制不向右越界
    if (clamped < -touchState.panelWidth) clamped = -touchState.panelWidth
    touchState.offsetX = clamped
    var p = Math.abs(clamped) / touchState.panelWidth
    // 跨过 30% 阈值瞬间触发一次触觉
    if (!touchState.hapticFired && p >= 0.3) {
      touchState.hapticFired = true
      ownerInstance.callMethod('onWxsThresholdCross', { dir: 'open' })
    }
    // 速度采样（末帧）
    var now = Date.now()
    if (touchState.lastT) {
      touchState.vel = Math.abs(dx - touchState.lastX) / (now - touchState.lastT)
    }
    touchState.lastX = dx
    touchState.lastT = now
  }
  // 垂直分支现状不动 …
  ownerInstance.callMethod('onWxsTouchMove', { /* …现状… */ , offsetX: touchState.offsetX })
}

function handleTouchEnd(event, ownerInstance) {
  touchState.isDragging = false
  var dx = event.changedTouches[0].clientX - touchState.startX
  var p = Math.abs(dx) / touchState.panelWidth
  var commit = (p >= 0.3) || (touchState.vel >= 0.5)
  ownerInstance.callMethod('onWxsTouchEnd', {
    dx: dx, offsetX: touchState.offsetX, commit: commit, axis: touchState.axis
  })
  // 重置
  touchState.offsetX = 0
  touchState.hapticFired = false
  touchState.vel = 0
  touchState.lastT = 0
  touchState.axis = ''
}
```

### 9.2 home.js 新增回调

```js
onWxsThresholdCross(e) {
  if (e.dir === 'open') wx.vibrateShort({ type: 'light' })  // 失败静默
},
onWxsTouchEnd(e) {
  if (e.axis === 'h') {
    if (e.commit) this.setData({ showPanel: true })
    // 取消：由 WXS 跟手位移回弹（CSS transition 处理）
  }
  // 垂直分支现状不动
}
```

### 9.3 WXML 绑定（面板跟手）

```xml
<view class="slide-panel {{showPanel ? 'show' : ''}}"
      style="transform: translateX({{touch.isDragging && touch.axis==='h' ? touch.offsetX : (showPanel ? 0 : '100%')}}rpx);">
```

---

## 十、验收标准（EARS）

| 类型 | 需求描述 |
|------|----------|
| **Ubiquitous** | 系统应始终在侧边栏水平手势的首帧执行 axis-lock 判定（`|dx|>10 且 |dx|>|dy|`） |
| **Event-driven** | 当水平拖拽位移跨过面板宽 30% 阈值时，系统应触发一次 `light` 级震动 |
| **Event-driven** | 当用户左滑松手且 `|dx| ≥ 30%宽` 或瞬时速度 ≥ 0.5px/ms 时，系统应打开侧边栏 |
| **Unwanted** | 若水平位移 < 30% 宽 且 速度 ≤ 0.5px/ms，则系统应取消打开并使面板回弹关闭 |
| **State-driven** | 当侧边栏处于打开态时，右滑跨过 30% 阈值应触发关闭震动并收起面板 |
| **Optional** | 当用户在设置中关闭「手势震动反馈」时，系统可不触发触觉反馈但仍保留跟手位移 |

---

## 十一、边界场景

| 场景 | 预期行为 |
|------|----------|
| 列表内横向滚动（收藏 Tab） | axis-lock 判定为水平，但位移小不跨阈值 → 不打开面板（仅滚动列表） |
| 快速一甩（fling）位移仅 40rpx | 速度 ≥ 0.5px/ms → 仍打开 |
| 慢拖到 25% 松手 | 未达阈值且速度低 → 回弹关闭 |
| 拖到 35% 后往回拖到 10% 松手 | 末态 10% < 30% → 回弹（但跨过瞬间已震一次，符合预期） |
| 面板已开，右滑到 20% 松手 | 未达关闭阈值 → 回弹保持打开 |
| 系统关闭震动 / Android 不支持 type | 静默失败，不影响跟手与打开 |
| 垂直滑动中误带横向 | axis 已锁垂直 → 水平分支不介入 |

---

## 十二、依赖 & 风险

| 项 | 说明 |
|----|------|
| **依赖** | 无（独立任务） |
| **风险 R1** | WXS ES5 约束易踩坑（禁用 let/const/箭头）→ 研发需严格按 §9.1 写法 |
| **风险 R2** | 跟手位移走 WXML 内联 style 绑定，需确认 `touch.offsetX` 在 data 中实时更新（建议 WXS 变量 + `callMethod` 低频同步） |
| **风险 R3** | 与现有 `onWxsTouchEnd` 垂直逻辑共用，需保证 `axis` 字段不影响原卡片切换分支 |
| **验证建议** | 真机测试覆盖：iPhone SE（小屏）、iPhone Pro Max（大屏 rpx 缩放）、Android 中端机 |

---

> **交互设计师** | 2026-08-02 | UX-IMPROVE08 侧边栏滑入手势优化方案
>
> **关联**：线框图与交互原型 §三 | touch.wxs | 设计语言 v2.0 §圆角&动效 | D-03 视觉稿（毛玻璃/遮罩变量）
