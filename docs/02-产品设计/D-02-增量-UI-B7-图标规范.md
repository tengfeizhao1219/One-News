# D-02 增量 · UI-B7 图标规范（统一描边 SVG）

> **编号**：UI-B7 | **角色**：产品设计师 | **日期**：2026-08-04
> **关联**：UI-B7 列表页重新设计 v4；本规范与 `docs/showcase/ui-b7-list-redesign.html` **1:1 一致**，供前端直接复用
> **状态**：v1 初版，随 v4 原型同步交付
> **owner 要求**：原型内图标需设计好、与 demo 完全一致、去掉 emoji —— 本文档即开发可直接取用的图标清单

---

## 1. 设计原则

- 全部图标统一为**描边式（stroke）线性图标**，**禁止 emoji**、**禁止填充式（fill）图标**。
- 统一描边宽度 `--icon-stroke: 2`，圆角端点 `stroke-linecap: round`、`stroke-linejoin: round`，`fill: none`。
- 颜色**跟随主题 token**（亮/暗双模式），不硬编码色值。
- 与全局圆角语言一致（按钮/卡片/高亮均为圆角），图标无锋利直角冲突。

---

## 2. 全局 Token

| Token | 值 | 说明 |
|-------|----|------|
| `--icon-stroke` | `2` | 描边宽度（px，基于 `viewBox="0 0 24 24"`） |
| `fill` | `none` | 禁止填充 |
| `stroke-linecap` | `round` | 端点圆角 |
| `stroke-linejoin` | `round` | 转角圆角 |
| `--radius` | `10px` | 全局圆角基准（高亮 chip / 卡片 / 按钮统一） |

---

## 3. 图标清单（共 6 枚）

> 所有图标 `viewBox="0 0 24 24"`。下表 `SVG path` 为可直接复制的内容（置于 `<svg viewBox="0 0 24 24">…</svg>` 内）。

| # | 名称 | 用途 | 尺寸 | 颜色 token | SVG path（含子元素） |
|---|------|------|------|-----------|----------------------|
| 1 | 设置齿轮 Settings | ① 首页右下 ⚙ 浮动按钮（fab）；② dock「设置」项 | fab 26px / dock 18px | fab: `var(--bg-page)`<br>dock: `var(--text-body)` | `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>` |
| 2 | 浏览记录 History | dock「浏览记录」项 | 18px | `var(--text-body)` | `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>` |
| 3 | 我的收藏 Favorite | dock「我的收藏」项 | 18px | `var(--text-body)`（强调可用 `var(--color-favorite)`） | `<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>` |
| 4 | 扩展位 Plus | dock「扩展位」项 | 18px | `var(--text-body)` | `<path d="M5 12h14"/><path d="M12 5v14"/>` |
| 5 | 返回主页 Home | 详情页左上「返回主页」按钮 | 22px | `var(--home-icon)` | `<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>` |
| 6 | 关闭列表 Close | 列表页右上「关闭」按钮 | 16px | `var(--text-primary)` | `<path d="M18 6 6 18"/><path d="m6 6 12 12"/>` |

---

## 4. 落地参考（微信小程序）

微信小程序不支持原生 `<svg>` 标签，建议两种落地方式：

**方式 A · 导出 `.svg` 资源 + `<image>` 引入（推荐，颜色随主题两套）**
```
<!-- WXML -->
<image class="ico" src="/assets/icons/settings.svg" mode="aspectFit"/>
```
```
/* WXSS（亮色） */
.ico { width:18px; height:18px; }
```
需为亮/暗各导出一套（描边色分别为对应 token 的解析值），或用方式 B 染色。

**方式 B · 单色 SVG + CSS mask 染色（一套资源随主题变色）**
```
.ico {
  width:18px; height:18px;
  background-color: var(--text-body);
  -webkit-mask: url(/assets/icons/settings.svg) no-repeat center / contain;
  mask: url(/assets/icons/settings.svg) no-repeat center / contain;
}
```
注意：mask 方式下 SVG 自身 `fill/stroke` 不生效，仅用其**形状**做遮罩，颜色由 `background-color` 决定 → 天然跟随主题 token。

**统一描边样式（HTML 原型内的等价写法，供参考）**
```css
.ico {
  fill: none;
  stroke: var(--text-body);
  stroke-width: var(--icon-stroke);   /* 2 */
  stroke-linecap: round;
  stroke-linejoin: round;
}
```

---

## 5. 导出清单（供前端直接取用）

建议导出至 `assets/icons/`，文件名与下表一致：

| 文件名 | 内容（完整 SVG） |
|--------|------------------|
| `settings.svg` | `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>` |
| `history.svg` | `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>` |
| `favorite.svg` | `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>` |
| `plus.svg` | `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>` |
| `home.svg` | `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>` |
| `close.svg` | `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>` |

> 说明：导出文件统一用 `stroke="currentColor"`，由引入处的 `color` / `background-color`（方式 B）驱动，从而跟随 `theme.json` 的亮/暗 token。

---

## 6. 验收

- [x] 原型内 6 枚图标全部为描边式（stroke），无 emoji、无 fill 图标
- [x] 暗色模式描边色正确跟随主题 token
- [x] 与本文档 1:1 一致（path / 尺寸 / 颜色 token 完全对应）
- [ ] 真机导出 `assets/icons/*.svg` 6 枚并完成 `<image>` / mask 落地（待研发）
- [ ] 同步 `theme.json` `--setting-panel-bg` 至 `.78`（见 UI-B7 设计文档 §3.4 待办）
