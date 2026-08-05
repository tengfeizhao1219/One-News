# D-03-增量 · UI-B9 设置页重构设计

> **编号**：UI-B9 | **角色**：产品设计师 | **日期**：2026-08-05
> **原型来源**：https://tengfeizhao1219.github.io/One-News/showcase/settings-redesign.html
> **状态**：✅ 以交互原型库为唯一权威依据

---

## 1. 概述

**方案 A：独立全屏设置页** `/pages/settings/`，替代现有半屏面板。

针对 5 项问题：

| 问题 | 优化 |
|------|------|
| 字体与关于挤同一半屏 | 三组独立分组：显示 / 阅读 / 关于 |
| 3 秒自动关闭 | **移除**，改为导航返回（用户自主） |
| 4 行 radio 无预览 | 分段控制器 + 迷你新闻卡实时预览 |
| 无暗色模式入口 | 「显示」组：跟随系统 + 深色模式双开关 |
| 关于降格为 footer | 「关于」组：版本 / 反馈 / 联系开发者 |

---

## 2. 页面结构

```
┌──────────────────────────────────────────┐
│  9:41                    ●●● ▮ 100%     │ ← 状态栏
├──────────────────────────────────────────┤
│  ‹  设置                                 │ ← 导航栏
├──────────────────────────────────────────┤
│                                          │
│  显示                                    │ ← 分组标题
│  ┌────────────────────────────────────┐  │
│  │ 跟随系统                     [开关] │  │ ← 开启时深色模式由系统决定
│  │ 关闭时可由下方手动切换              │  │
│  ├────────────────────────────────────┤  │
│  │ 深色模式                     [开关] │  │ ← 手动覆盖外观
│  │ 手动覆盖外观                        │  │
│  └────────────────────────────────────┘  │
│                                          │
│  阅读                                    │
│  ┌────────────────────────────────────┐  │
│  │ 字体大小                            │  │
│  │ ┌──────┬──────┬──────┬──────┐      │  │
│  │ │ 标准 │  大  │ 特大 │ 超大 │      │  │ ← 分段控制器
│  │ └──────┴──────┴──────┴──────┘      │  │
│  ├────────────────────────────────────┤  │
│  │ 实时预览（随上方档位缩放）           │  │
│  │ ┌──────────────────────────────┐   │  │
│  │ │ 量子计算机首次实现千比特纠错…  │   │  │ ← 预览卡片
│  │ │ 科技 科技日报 · 2小时前       │   │  │
│  │ │ [AI摘要] 研究团队宣布在超导…   │   │  │
│  │ └──────────────────────────────┘   │  │
│  └────────────────────────────────────┘  │
│                                          │
│  关于                                    │
│  ┌────────────────────────────────────┐  │
│  │ 版本                    v6.2.0     │  │
│  ├────────────────────────────────────┤  │
│  │ 意见反馈                       ›   │  │
│  ├────────────────────────────────────┤  │
│  │ 联系开发者                     ›   │  │ ← 点击展开
│  └────────────────────────────────────┘  │
│  ┌────────────────────────────────────┐  │
│  │ 邮箱  ztengfei@hotmail.com  [复制] │  │ ← 展开面板
│  │ 微信  jiaowotengfei         [复制] │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

---

## 3. 精确规格

### 3.1 页面框架

| 属性 | 值 |
|------|-----|
| 页面路径 | `/pages/settings/` |
| 导航 | `‹ 设置`，返回图标 `22px` `var(--primary)`，标题 `17px` `font-weight: 600` |
| 内容区 | `padding: 6px 0 28px` |
| 入口 | dock 菜单 `settings` 项 → `wx.navigateTo /pages/settings/` |

### 3.2 分组卡片

| 属性 | 值 |
|------|-----|
| 分组间距 | `margin: 0 16px 22px` |
| 分组标题 | `font-size: 12px; color: var(--text-secondary); margin: 0 4px 7px; font-weight: 500; letter-spacing: 0.2px` |
| 卡片背景 | `var(--bg-card)`，`border-radius: 12px` |
| 行高 | `min-height: 48px; padding: 11px 16px` |
| 行分割 | `border-top: 1px solid var(--divider)` |
| 标签 | `font-size: 16px; color: var(--text-primary)` |
| 值 | `font-size: 15px; color: var(--text-secondary)` |
| 箭头 | `›`，`font-size: 17px; color: var(--text-tertiary)` |
| 副标题 | `font-size: 12px; color: var(--text-tertiary); margin-top: 2px` |

### 3.3 iOS 开关

```css
.switch {
  width: 51px; height: 31px; border-radius: 16px;
  background: var(--switch-off);       /* #E9E9EA 浅色 / #39393D 暗色 */
  transition: background 0.22s;
}
.switch.on { background: var(--primary); }
.switch .knob {
  width: 27px; height: 27px; border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.22);
  position: absolute; top: 2px; left: 2px;
  transition: left 0.22s;
}
.switch.on .knob { left: 22px; }
.switch.disabled { opacity: 0.35; pointer-events: none; }
```

### 3.4 跟随系统 + 深色模式双开关联动

```
跟随系统 ON：
  → 深色模式开关 disabled（opacity 0.35）
  → 副标题：「开启时深色模式由系统决定」
  → 实际外观跟随 wx.getSystemInfoSync().theme

跟随系统 OFF：
  → 深色模式开关 enabled
  → 副标题：「关闭时可由下方手动切换」
  → 手动切换时立即生效（setTheme）
```

### 3.5 分段控制器

| 属性 | 值 |
|------|-----|
| 容器 | `display: flex; background: var(--seg-bg); border-radius: 9px; padding: 2px; margin-top: 4px` |
| 按钮 | `flex: 1; font-size: 13px; padding: 7px 0; border-radius: 7px; color: var(--text-primary)` |
| 选中态 | `background: var(--seg-on-bg); color: var(--seg-on-text); box-shadow: 0 1px 3px rgba(0,0,0,0.14); font-weight: 600` |
| 档位 | 标准(1.0) / 大(1.15) / 特大(1.3) / 超大(1.5) |

### 3.6 实时预览卡

| 属性 | 值 |
|------|-----|
| 标签 | `font-size: 11px; color: var(--text-tertiary); margin: 2px 2px 6px; letter-spacing: 0.3px` |
| 卡片 | `background: var(--preview-bg); border: 1px solid var(--divider); border-radius: 12px; padding: 10px 14px` |
| 标题 | 衬线，`calc(17px * var(--fs))`，`font-weight: 600`，`line-height: 1.45` |
| 元信息 | `calc(11px * var(--fsm))`，`var(--text-secondary)` |
| 摘要 | 衬线，`calc(16px * var(--fs))`，`var(--text-body)`，`line-height: calc(1.8 * var(--fs))`，2行截断 |
| AI 标签 | `inline-block`，`padding: 1.5px 7px`，`border-radius: 8px`，`var(--primary)` 色 |

### 3.7 联系开发者展开面板

| 属性 | 值 |
|------|-----|
| 容器 | `background: var(--bg-subtle); border-radius: 10px; margin: 0 16px 16px; padding: 6px 14px` |
| 展开/收起 | 点击「联系开发者」行 toggle，箭头 › ↔ ⌄ |
| 行 | `display: flex; justify-content: space-between; padding: 9px 0; font-size: 14px` |
| 标签 | `font-size: 12px; color: var(--text-tertiary)` |
| 复制按钮 | `font-size: 12px; color: var(--primary); background: var(--primary-subtle); padding: 4px 11px; border-radius: 6px` |
| 内容 | 邮箱：`ztengfei@hotmail.com` / 微信：`jiaowotengfei` |

---

## 4. 暗色模式

| 属性 | 浅色 | 暗色 |
|------|------|------|
| 分段底 | `#E4E4E6` | `#2C2C2E` |
| 分段选中 | `#FFFFFF` | `#636366` |
| 开关关闭 | `#E9E9EA` | `#39393D` |
| 预览卡背景 | `#FFFFFF` | `#141416` |
| 联系面板背景 | `#F0EEEA` | `#1A1A1C` |

---

## 5. 向后兼容

- `app.js` 的 `setFontScale / _applyFontScale` 逻辑不变
- 仅 UI 承载位置从 `components/font-panel` 迁移到 `/pages/settings/`
- `--font-scale` 变量注入方式不变

---

## 6. 验收清单

| 验收项 | 标准 |
|--------|------|
| 三组分组清晰 | 显示 / 阅读 / 关于 |
| 跟随系统 ON → 深色模式 disabled | opacity 0.35 |
| 分段控制器切换 → 预览卡实时缩放 | 4 档即时响应 |
| 联系开发者展开/收起 | 箭头切换 › ↔ ⌄ |
| 复制按钮 → Toast「已复制」 | 邮箱/微信均可复制 |
| 意见反馈 → 唤起评分 | Toast 占位 |
| 暗色模式全部 token 生效 | 开关/分段/预览卡/联系面板 |
| 导航返回（不自动关闭） | 用户自主 |

---

> **UI-B9 设置页重构设计 v1.0** — 以原型 `settings-redesign.html` 为唯一权威依据
