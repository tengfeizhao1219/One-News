# AI 情报官 · 深浅色模式展示规范（v1）

> **目的**：统一深浅色下所有视觉元素的展示规则，消除"改一个坏一个"。本文件是唯一事实来源，任何涉及主题的改动必须先对照本规范。
> **核心原则**：**所有视觉元素统一跟随 `themeClass`（page--dark / page--light）这一个信号**，它由 One News 设置（effectiveTheme：跟随系统或手动开关）决定——**禁止用 `isDark` 做图标/颜色切换**（isDark 是 JS 一次性快照，会与 CSS 信号脱节，这是此前反复出问题的根源）。

---

## 1. 主题信号

```
One News 设置（followSystem ? 系统主题 : darkMode）
        → effectiveTheme（'light' | 'dark'）
        → themeClass（'page--light' | 'page--dark'）注入页面根 class
        → ① CSS 变量（app.wxss .page--dark { --xxx }）继承
        → ② .page--dark 类选择器（硬编码兜底）
```

**所有元素只用 ①② 两个机制，不用 isDark。**

---

## 2. 展示规则总表

| 元素 | 亮色（page--light） | 暗色（page--dark） | 机制 |
|---|---|---|---|
| 页面背景（根 + 内容区） | `var(--bg-page)` = #F5F3F0 | #000000 | CSS 变量 + `.page--dark` 硬编码兜底 |
| 卡片背景 | `var(--bg-card)` = #FAF9F7 | #0D0D0D | CSS 变量 |
| 文字（标题/正文/次要） | `var(--text-primary/body/secondary)` | 对应暗色值 | CSS 变量 |
| 高亮块（"对你"浅蓝底） | `var(--highlight-bg)` | 对应暗色值 | CSS 变量 |
| **Home 返回图标** | `home.svg`（黑色） | `home-dark.svg`（白色） | **CSS 双图标**（`.page--dark` 切换显隐） |
| **FAB 悬浮图标** | `settings.svg`（深色） | `settings-dark.svg`（白色） | **CSS 双图标** |
| 状态栏文字（时间/电池） | 黑色 `#000000` | 白色 `#ffffff` | `app.setNavBarColor(effectiveTheme)`（JS，4 页 onLoad + intel-stage active 切换） |
| 下拉刷新指示器 | black | white | `refresher-default-style`（isDark——**唯一允许的 isDark 使用点**，因为该 API 需要 JS 传值） |

---

## 3. 实现要点（防止回归）

1. **图标一律 CSS 双图标**：wxml 同时渲染 `xxx.svg` + `xxx-dark.svg`，CSS：
   ```css
   .nav-dark { display: none; }
   .page--dark .nav-light { display: none; }
   .page--dark .nav-dark { display: block; }
   ```
2. **背景一律 `var(--bg-page)` + `.page--dark` 硬编码兜底**（部分真机 var() 解析不可靠）。
3. **状态栏**：每个页面 `onLoad` 调 `app.setNavBarColor(effectiveTheme)`；右滑面板在 `active` 变化时同步。
4. **新增任何带图标的元素**：复制上面 CSS 双图标模式，不要用 `{{isDark ? ...}}`。
5. **新增任何颜色**：只允许 `var(--xxx)` 或 `.page--dark` 硬编码兜底，禁止凭空 hex。

---

## 4. 历史教训（为什么会有这份规范）

| 日期 | 问题 | 根因 | 修复 |
|---|---|---|---|
| 2026-08-19 | 暗色背景白 | 背景硬编码浅色 + 类选择器未覆盖组件 | var + 类兜底 |
| 2026-08-19 | FAB 图标暗色下仍是暗色 | isDark 一次性判断/currentColor 继承 | CSS 双图标 |
| 2026-08-19 | Home 图标亮色下变白 | home.svg currentColor 无 color 上下文 | 显式 color + 本次改 CSS 双图标 |
| 2026-08-19 | 手动切主题右滑面板不跟随 | 组件 themeClass 不实时 | property + observers + onShow |
| 2026-08-19 | 亮色下状态栏白字 | intel 页未调 setNavBarColor | 4 页 + 组件补调用 |
| 2026-08-19 | **首页返回图标随系统而非 One News 设置** | 图标用 isDark JS 快照，与 CSS 信号脱节 | **本次：统一 CSS 双图标，禁 isDark 于视觉** |
