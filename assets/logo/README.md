# 一页 One News · Logo 资产库

> 版本：v1.0（2026-08-09 owner 拍板确认）· 设计稿迭代 v19 → v34.2
> 品牌色：`#0A84FF` 装饰蓝 / `#0D0D0D` 主标黑 / `#8E8E93` 副标灰 / `#FAF9F7` 浅底 / `#1C1C1E` 深底
> 字体：SF Pro Display Black（主标）/ PingFang SC Regular（中文副标）/ SF Pro Display Bold（英文副标）

## 文件清单（8 个 SVG）

| 文件 | 场景 | 尺寸 |
|---|---|---|
| `logo-wordmark-light.svg` | 主标 wordmark · 浅底（关于页 / 品牌区 / 文档封面） | 640×200 |
| `logo-wordmark-dark.svg` | 主标 wordmark · 深底（夜间 / 视频片头 / 深色品牌区） | 640×200 |
| `logo-avatar-120-light.svg` | 微信小程序头像 · 浅底 | 120×120 |
| `logo-avatar-120-dark.svg` | 微信小程序头像 · 深底（**深色模式主推**） | 120×120 |
| `logo-avatar-circle-light.svg` | 圆形社交头像 · 浅底（公众号 / 知乎 / 微博） | 120×120 |
| `logo-avatar-circle-dark.svg` | 圆形社交头像 · 深底 | 120×120 |
| `logo-splash-light.svg` | 启动屏横排 · 浅底（分享卡片顶部 / 加载页） | 640×120 |
| `logo-splash-dark.svg` | 启动屏横排 · 深底 | 640×120 |

## 版式规范（勿改）

- **主标 wordmark**：One 大字居中 → 蓝线 + `ONE · NEWS` 同行（蓝线左、文字右）→ 中文副副标「每天 · 一页 · 极致阅读体验」居中
- **头像 avatar**：One 居中上方 → 蓝线 + `NEWS` 紧贴蓝线右端（左右结构，非上下叠）
- **启动屏横排**：左侧主标（One + 蓝线 + ONE·NEWS）**左对齐 24px**、纵向居中；右侧 slogan「一页，让阅读轻松一点」+ 副标 `Pure reading, One News` **右对齐 24px**（左右两侧文字距离边缘严格相等）
- **最小尺寸**：头像 32×32 时只保留「O」单字；64×64 保留完整 One+NEWS

## 使用规则

1. **SVG 是源文件**。微信小程序 `image` 组件可直引本地 SVG（基础库 2.3.0+），但字体依赖设备，主标渲染在非 Apple 设备会回退系统字体——**关键场景（微信头像、分享卡片）必须导出 PNG/JPG 使用**
2. **微信小程序头像**（小程序管理后台设置）：需 144×144 PNG/JPG，建议用 `logo-avatar-120-dark.svg` 导出 2x（240×240 PNG，圆角保留 rx=22/120 比例）
3. **深浅色切换**：页面跟随系统 darkmode（项目 `theme.json` 已配置），用 `{{isDark ? '-dark' : ''}}` 模式引用，与 `assets/icons/` 现有图标同一套引用约定
4. **slogan 文案锁定**：主标副副标「每天 · 一页 · 极致阅读体验」、启动屏「一页，让阅读轻松一点 / Pure reading, One News」——均为 owner 拍板文案，改动需 owner 确认

## 自动应用（新增页面）

新增页面自动带上品牌 Logo：新建 `components/logo/` 自定义组件，封装三种形态（wordmark / avatar / splash），读取全局 `themeClass` 自动切换浅深底，新页面引入组件即可，无需每个页面重复写 image 引用。详见设计文档。
