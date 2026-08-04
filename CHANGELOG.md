# Changelog

> 本项目所有发版记录。每次发版必须在此文件追加版本条目，并附 Release Note。
> 格式遵循 [Keep a Changelog](https://keepachangelog.com/)。
> 版本号规范见 `docs/00-规划/发版机制与版本管理规范.md`（语义化版本 SemVer）。

---

## [v1.0.1] - 2026-08-04

**发版类型**：全栈增量（FS 批量交付）  
**发版人**：全栈开发（FS）  
**Commit**：`e7f028c`

### 变更内容
- **新增**：
  - TL-B18：AI 摘要首页展示链路 + 主题色轻胶囊（`--primary-subtle` + `--primary`，非点击纯视觉）
  - TL-B12：RQ-16 数据保留策略（`news_cache` 分级 TTL 7/30 天 + 分级清理 + `setNewsRetained` → `news_cache` 改造）
  - TL-B13：RQ-03 收藏上云 + RQ-07 分享上报（`setUserFavorite`/`getUserFavorites` 云函数 + 前端双写 + 待同步队列）
  - TL-B14：RQ-06 浏览记录页（`pages/history` + `recordBrowse`/`getBrowseHistory` 云函数 + ⚙ dock 菜单入口）
  - TL-B15：RQ-17 全局返回主页入口（3 页面 🏠 图标，`wx.reLaunch` + 防抖 + 降级 `navigateBack`）
  - TL-B16：方案 F ⚙ 浮动按钮升级「更多功能」dock 栈菜单（4 项入口 + 毛玻璃遮罩）
  - TL-B8：P0-Q3 恢复一层兜底（ADR-003 + 三层降级 + 备份集合自动创建 + 竞态修复 + 分类对齐）
  - TL-B9/B10/B11：V5-ACCEPT 阻塞项全部修复（回滚 tag `v3-ai-dual-engine` + 清洗规则缺口 + 后端残留分类清理）
- **优化**：
  - TL-B17：UI-B7 v5.3-final 列表页前端修复（12 Bug 全部闭环，面板宽 90%、fab 纯色、nav-dots 移除、SVG 图标落地）
  - TL-B1/B2：B-08~B-14 整批清理裁定（v3.x 架构 → 7 任务集体作废，唯一有效后端任务 = B-16）
- **修复**：
  - 滑动提示 `⇅` emoji → 描边 SVG `assets/icons/swipe.svg`
  - 收藏空态 `♡` emoji → 描边 SVG mask `favorite.svg`

### 影响范围
首页卡片流 / 详情页 / 收藏列表页 / 浏览记录页 / 云函数 refreshNews / setUserFavorite / getUserFavorites / recordBrowse / getBrowseHistory / setNewsRetained

### 验证方式
微信开发者工具预览 + 云函数日志 + PD 按 UI-B7 §5 / UI-B8 §5 走查验收

### 回滚方案
`git revert e7f028c` + 云函数版本回退

---

<!-- 后续发版请在此处（v1.0.1 上方）追加新条目 -->

## [v1.0.0] - 2026-08-02

**发版类型**：全量发版（首版）  
**发版人**：项目经理（协调）  
**状态**：🟡 审核准备中（Q-06.3）

### 变更内容
- **新增**：极简新闻阅读小程序首版
  - 8 大分类卡片流阅读
  - 跨分类阅读引擎（智谱+DeepSeek 双引擎）
  - 内容安全审核接入
  - 字体面板 / 收藏 / 分享
  - 暗色模式
  - 侧边栏分类切换
- **优化**：UX 体验（14 项 UX-BUG + 8 项 UX-IMPROVE 修复）
- **修复**：BUG-001~006、BUG-007/009（数据一致性）

### 影响范围
全部用户

### 验证方式
微信开发者工具真机预览 + 云函数日志检查

### 回滚方案
小程序回退上一版本 + 云函数版本回退

---

<!-- 后续发版请在此处（v1.0.0 上方）追加新条目，模板如下：

## [v1.0.1] - YYYY-MM-DD

**发版类型**：前端热修 / 后端热修 / 全量发版 / 灰度
**发版人**：<角色名>
**版本号**：v1.0.1

### 变更内容
- **新增**：
- **优化**：
- **修复**：

### 影响范围
<受影响页面 / 云函数 / 用户群>

### 验证方式
<如何在真机/测试环境验证>

### 回滚方案
<如何回滚>

-->
