# AI 情报官 · 小程序模块接入说明

> 配套交付：`/workspace/AI情报官_pages/intel/`（新建模块 12 文件）
> 设计依据：`/workspace/AI情报官_UI规范_v1.md`、已确认 demo `/workspace/AI情报官_UI_Demo.html`
> 本说明只讲「怎么把模块接进你的 One News 仓库」，不动 One News 任何既有业务逻辑。

---

## 一、硬前提（已落地的契约）

| 原则 | 落地方式 |
|---|---|
| **One News 原有东西一律不改** | 新建模块全部落在独立目录 `pages/intel/`，与 `pages/home`、`pages/detail` 等完全隔离 |
| **复用能力必须标记 + 可整体摘除** | 仅 2 处极小改动触碰 One News，均带 `INTEL-BRIDGE` 标记、独立开关/独立代码段，删除即还原 |
| **设计令牌零新增 hex** | WXSS 全部引用 `theme.json` 变量（`--primary`/`--tag-bg`/`--text-*`/`--color-warning*`/`--flash-life` 等），与 One News 风格一致 |

---

## 二、新建文件（直接复制，无需改 One News）

把 `/workspace/AI情报官_pages/intel/` 整个目录复制到你的 One News 仓库根目录即可：

```
pages/intel/
├── home/      # 情报首页：右滑入口落地页
│   ├── home.wxml / home.wxss / home.js / home.json
├── detail/    # 情报详情：叙事弧线（发生了什么 / 落到你这里 / 了解更多 / 上手试试）
│   ├── detail.wxml / detail.wxss / detail.js / detail.json
└── mine/      # 我的：FAB 入口落地页（占位，待后端联调）
    ├── mine.wxml / mine.wxss / mine.js / mine.json
```

> FAB 图标**复用 One News 既有资产** `/assets/icons/settings.svg`（含 `-dark` 变体），不新增任何图标资源。

---

## 三、仅有的 2 处 One News 改动（均已标记、可摘除）

### 改动 1：`app.json` —— 注册 3 个新页面

在 `"pages/home/home",` 之后插入 3 行（其余完全不动）：

```json
    "pages/home/home",
    "pages/intel/home/home",
    "pages/intel/detail/detail",
    "pages/intel/mine/mine",
    "pages/detail/detail",
```

### 改动 2：`pages/home/home.js` —— 右滑桥接（最小可摘除）

**2.1 顶部常量**（在 `home.js` 文件顶部 `require` 区任意位置新增一行即可，本实现放在常量 `require` 之后；阈值 60rpx，与 `PANEL_SWIPE_THRESHOLD` 同级）：

```js
const INTEL_ENTER_SWIPE_THRESHOLD = 60 // INTEL-BRIDGE: 右滑进入 AI 情报阈值（与 PANEL_SWIPE_THRESHOLD 同级）
```

**2.2 data 总开关**（在 `isDark: false,` 之后插入；置 `false` 即摘除入口，不影响其他手势）：

```js
    isDark: false,
    _intelBridgeEnabled: true, // INTEL-BRIDGE: 右滑入口总开关，置 false 即摘除（不影响 One News 既有手势）
```

**2.3 `onTouchEnd` 内插入桥接逻辑**（放在「左滑呼出面板」`return` 之后、「纵向翻页判定」`if (Math.abs(dy) < SWIPE_THRESHOLD ...)` 之前）：

```js
    // ============ INTEL-BRIDGE (START): AI 情报模块入口——右滑进入（最小可摘除） ============
    // 隔离说明：本段为 AI 情报官模块新增，独立于 One News 既有业务。
    //  - 仅处理「右滑」(dx > 0 且 |dx| > |dy|)；原 onTouchEnd 对右滑无行为，故为纯增量，不影响左滑/纵向手势。
    //  - 置于纵向早退之前，确保横向右滑不被纵向判定吃掉。
    //  - 命名空间 intel_*；将 _intelBridgeEnabled 置 false 或整段删除即可摘除。
    if (dx > INTEL_ENTER_SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) && this._intelBridgeEnabled) {
      wx.navigateTo({ url: '/pages/intel/home/home', fail: (err) => console.warn('[intel-bridge] navigate fail:', err) })
      return
    }
    // ============ INTEL-BRIDGE (END) ============
```

---

## 四、摘除方式（为后续彻底拆分预留）

- **仅关入口**：把 `home.js` 的 `_intelBridgeEnabled` 设为 `false`，或删除 2.3 整段 `INTEL-BRIDGE` 代码；One News 手势零影响。
- **整体移除模块**：删除 `pages/intel/` 目录 + `app.json` 的 3 行注册 + 上述 2.2/2.3 两处标记代码，仓库即完全回到「只含 One News」状态。

---

## 五、主题与深浅色（已对齐 One News 机制）

- 页面根节点 `class="page {{themeClass}}"`，`themeClass` 取自 `app.globalData.themeClass`；
- `isDark`（FAB 图标深浅切换）复刻 One News `_isSystemDark()`，读 `effectiveTheme`；
- 因此情报模块自动跟随 One News 的浅/深主题，无需单独维护。

---

## 六、当前为占位态，待联调

- 情报首页 `items`、详情页 `claude1m` 以外情报点均为**演示数据**，由后端 `intelProcess` 云函数下发后替换。
- 「我的」页为**结构占位**，画像/信源/推送/合规配置项待后端联调。
- 详情页「上手试试」的示例内容基于**真实联网调研**（Claude 1M 上下文），链接指向已验证可达的 Anthropic 官方文档；生产环境须由情报官对每个技术点先做真实调研再生成，禁止编造步骤/链接。

---

## 七、一处必要的视觉偏差说明

One News 原 FAB 用 `position: absolute`（其首页整页滚动）。情报首页用 `scroll-view`，故 intel FAB 改为 `position: fixed` 以钉在视口底部——**外观参数（96rpx 圆、tag-bg 浅灰底、floatY 动画、active 缩放、settings 图标）与原 FAB 完全一致**，仅定位策略因布局不同必需调整。
