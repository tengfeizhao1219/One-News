# 「关注后续」前端自测清单

> 模块：One News 详情页 / 情报官详情页长按关注 + 首页长按进「我的关注」+ 聚合页四态
> 关联需求：需求文档 v1.0 §5.1–5.3、§5.5
> 本期范围：**纯前端**，关注关系走本地 `localCache`；后端每日 AI 定时检索留待后续（§九）

---

## 一、自动化逻辑自测（Node 可跑，已通过）

运行：`node test/followUp.test.js`
结果：**PASS 25 / FAIL 0**

| 用例组 | 覆盖点 | 结论 |
| --- | --- | --- |
| 关注 / 幂等 / 取消 | `addFollow` 成功、`isFollowed` 同步、重复关注幂等、`removeFollow` 生效 | ✓ |
| 双模块隔离与排序 | 合并 3 条、带 `module` 字段、按创建时间倒序（最近关注排最前）、intel/onenews key 隔离 | ✓ |
| 模拟更新 / 已读 | `addUpdate` 生成未读 update、`sourcesCount∈[1,4]`、`date` 为今日、`markRead` / `markAllRead` 置已读 | ✓ |
| 改追踪时间 | `setTrackTime` 写入生效 | ✓ |
| 边界 | `addFollow(null)` / 缺 `itemId` / `isFollowed('')` 均安全不崩 | ✓ |
| 四态派生 | 无更新→灰、有未读→红且计数正确、全读→绿、多未读文案正确 | ✓ |
| 容量上限 | 塞满 200 条后超容 `addFollow` 返回 `full:true` 且不写入 | ✓ |

---

## 二、微信开发者工具手动走查（沙箱无法运行小程序，需真机/模拟器）

### 2.1 One News 详情页 —— 长按关注（三重反馈）
- [ ] 打开任意资讯详情，内容区**按住不动 ≥0.5s**
- [ ] 按压点出现**进度环** `.lp-ring` 并在 0.5s 内充满
- [ ] 触发后：内容区**左右抖动**一次（`.lpshake`，约 0.42s）
- [ ] 屏幕**中央轻提示**「🔔 已关注，每天 12:00 为你追踪」（约 1.5s）
- [ ] 标题下方出现**常驻小标**「🔔 已关注 · 每天 12:00 追踪」
- [ ] 长按期间**滚动内容** → 长按被取消（无小标、无提示、无抖动）
- [ ] 长按**不足 0.5s 松手** → 不触发（不冲突翻页/右滑手势）
- [ ] 退出再进入该详情 → 小标仍在（关注关系持久化）
- [ ] 已关注状态再长按 → 不再重复触发（幂等保护）

### 2.2 情报官详情页 —— 长按关注（对齐 One News）
- [ ] 同上 9 项，模块为 `intel`，常驻小标配色为情报官紫（`--flash-world`）
- [ ] 内容区 `user-select:none`，长按不弹出微信「复制」菜单

### 2.3 首页 —— 长按进入「我的关注」（圆形绽放）
- [ ] One News 首页**空白处按住不动 ≥0.5s** → 进度环 → 圆形绽放进入聚合页（clip-path 从按压点 0%→150%）
- [ ] 情报官首页**同款长按** → 进入聚合页
- [ ] 长按期间**移动 >20px** → 取消，让位给翻页/右滑/呼出面板
- [ ] 进入后 `app.globalData.followEnterPoint` 已记录按压坐标，过场从按压点展开

### 2.4 「我的关注」聚合页 —— 四态与操作
- [ ] 空状态：无关注时显示空态 + 「去首页看看」
- [ ] 四态配色：有更新(红 dot) / 无更新(灰 dot) / 已读(绿 dot)
- [ ] 点击卡片：**展开时间线**，且自动 `"标记已读"`（红→绿）
- [ ] 长按卡片：**ActionSheet**（模拟收到新更新 / 标记已读 / 改追踪时间 / 取消关注）
- [ ] 「模拟收到新更新」→ 该条变红、顶部未读数 +1
- [ ] 「改追踪时间」→ 子菜单 08:00/12:00/18:00/21:00 生效
- [ ] 「取消关注」→ 从列表移除
- [ ] 顶部「全部标为已读」（仅未读>0 显示）→ 所有红转绿、未读清零
- [ ] 返回：反向圆形收回按压点，再 `navigateBack`

### 2.5 跨模块聚合
- [ ] One News 与情报官各自关注后，聚合页**并列**展示，来源标签分别标注「资讯」/「情报官」
- [ ] 列表按关注时间倒序（最近关注在最上）

---

## 三、静态接线核对（已通过，无需运行）

| 页面 | 起计时 | 滚动/移动取消 | 松手清除 | 触发 | 备注 |
| --- | --- | --- | --- | --- | --- |
| One News 详情 | `onTouchStart`→`_startFollowPress` | `onContentScroll`(>12px) | `onTouchEnd`→`_cancelLongPress` | `_fireFollow` | 与翻页手势共存 |
| 情报官详情 | `onTouchStart`→`_startFollowPress` | `onContentScroll`(>12px) | `onTouchEnd`→`_cancelLongPress` | `_fireFollow` | 补齐了原本缺失的 touch 绑定 |
| One News 首页 | `onTouchStart`→`_startFollowPress` | `onTouchMove`(>20px) | `onTouchEnd`→`_cancelLongPress` | `_enterFollow` | 与翻页/右滑/面板共存 |
| 情报官首页 | `onSlideTouchStart`→`_startFollowPress` | `onSlideTouchMove`(>20px) | `onSlideTouchEnd`→`_cancelLongPress` | `_enterFollow` | 与左滑返回共存 |

- `app.wxss`：`.lp-ring` / `.lpshake` / `@keyframes lpShake` 关键帧齐备
- `detail.wxss` / `intel/detail.wxss`：`.follow-badge` + `.no-select { user-select:none }` 齐备
- `followup.wxml`：卡片 `data-id` / `data-module` + `bindtap` / `bindlongpress` 绑定正确
- 全量 JS `node --check` 通过：followUp / followup / detail×2 / home×2 / test

---

## 四、已知限制（本期不做）
- 后端「每日 AI 定时检索」未实现（需求文档 §九），四态需手动「模拟收到新更新」触发，遵守 intel「前端不放假数据」约定。
- 圆形绽放仅做**目标页 reveal**，未做首页微缩景深（作为后续增强）。
- 沙箱无法运行微信小程序，UI 手势/过场需在开发者工具或真机验证；逻辑层已用 Node 单测覆盖。
